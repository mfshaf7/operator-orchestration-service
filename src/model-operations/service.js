import {
  assertBackends, assertProviderHealth, assertCatalogue, assertConfiguration, assertControl, assertLogin,
  assertOwnerReceipt, assertRequest, digest, fail, identifier, TERMINAL,
} from "./contracts.js";
import { ModelOwnerError } from "./platform-client.js";

const RETRYABLE = new Set(["provider-unavailable", "provider-busy", "login-busy", "management-credential-unavailable"]);
const LOGIN_TERMINAL = new Set(["connected", "cancelled", "failed", "interrupted"]);

function projection(record, { live = false } = {}) {
  const next = {
    queued: "await-progress", running: "await-progress", "awaiting-account": "complete-account-sign-in",
    retryable: "retry-or-cancel", unknown: "reconcile-original-operation", blocked: "review-owner-evidence",
    completed: "complete", cancelled: "complete", rejected: "refresh-and-create-corrected-request",
  };
  return {
    schema_version: 1, workflow_id: "model-operations", request_id: record.request.request_id,
    revision: record.revision, request: structuredClone(record.request), state: record.state,
    owner_command_id: record.command.command_id, attempt: record.attempt,
    owner_receipt: structuredClone(record.owner_receipt), applied_configuration: structuredClone(record.applied_configuration),
    account_login: structuredClone(record.account_login), failure: structuredClone(record.failure),
    history: structuredClone(record.history), next_action: !live && ["queued", "running"].includes(record.state) ? "reconcile-original-operation" : next[record.state],
  };
}

export function createModelOperationsService({ store, platform, operatorBindings, audit, now = () => new Date().toISOString() }) {
  const pending = new Set();
  let pumping = false;
  const active = new Set();
  const view = record => projection(record, { live: active.has(record.request.request_id) || pending.has(record.request.request_id) });
  // Coordinate this API process and its single dispatch worker around the
  // existing store's nonblocking inter-process lock. Never hold it over I/O
  // to Platform; another OOS process still gets the store's explicit busy error.
  let transactionTail = Promise.resolve();
  function transact(operation) {
    const result = transactionTail.then(() => store.transact(operation));
    transactionTail = result.catch(() => {});
    return result;
  }
  function bind(callerId, operatorId) {
    if (!operatorBindings[callerId] || operatorBindings[callerId] !== operatorId) {
      throw fail("operator_binding_invalid", "The authenticated caller is not bound to this operator.", 403);
    }
  }
  function own(record, callerId, operatorId) {
    bind(callerId, operatorId);
    if (!record || record.caller_id !== callerId || record.operator_id !== operatorId) throw fail("not_found", "Model operation was not found.", 404);
    return record;
  }
  function event(record, state, type, failure = null) {
    if (record.history.length >= 128) throw fail("history_limit", "This operation has reached its recovery limit; review its evidence.");
    record.state = state; record.failure = failure; record.revision += 1;
    record.history.push({ sequence: record.history.length + 1, type, state, occurred_at: now() });
  }
  function commandFor(record, attempt) {
    return {
      command_id: `oos-model:${digest({ caller: record.caller_id, request: record.request.request_id }).slice(7)}:${attempt}`,
      expected_revision: record.request.expected_configuration_revision,
      action: record.request.action, input: structuredClone(record.request.input),
    };
  }
  async function update(requestId, operation) {
    return transact(async tx => {
      const record = tx.get(requestId);
      if (!record) throw fail("not_found", "Model operation was not found.", 404);
      await operation(record, tx);
      await tx.put(record);
      return view(record);
    });
  }
  function schedule(requestId) {
    pending.add(requestId);
    if (!pumping) void pump();
  }
  async function pump() {
    pumping = true;
    try {
      while (pending.size) {
        const requestId = pending.values().next().value;
        pending.delete(requestId); active.add(requestId);
        try { await dispatch(requestId); }
        catch {
          // A storage failure leaves the retained command in place. Never
          // silently queue a replacement owner command after an uncertain write.
          audit?.emit({ event_type: "model.operation.storage-unavailable", request_id: requestId, outcome: "reconcile-required" });
        } finally { active.delete(requestId); }
      }
    } finally { pumping = false; }
  }
  async function dispatch(requestId) {
    let snapshot;
    await update(requestId, record => {
      if (record.state !== "queued") return;
      const priorDispatchPossible = record.dispatch_started;
      record.dispatch_started = true;
      event(record, "running", "owner-dispatch-started"); snapshot = { ...structuredClone(record), priorDispatchPossible };
    });
    if (!snapshot) return;
    try {
      const options = { operatorId: snapshot.operator_id };
      let receipt = snapshot.owner_receipt;
      let login = null, configuration = null;
      if (snapshot.command.action.startsWith("account.login.")) {
        const response = await platform.command({ ...options, command: snapshot.command });
        const originalId = snapshot.command.action === "account.login.start" ? snapshot.command.command_id : snapshot.command.input.login_command_id;
        assertLogin(response, originalId, snapshot.operator_id, snapshot.request.input.backend_id ?? null);
        // Start replies may be the original acknowledgement. Always read the
        // native owner's live journal before projecting connected/cancelled.
        login = assertLogin(await platform.login({ ...options, commandId: originalId }), originalId, snapshot.operator_id, response.backend_id);
      } else {
        if (!receipt) receipt = assertOwnerReceipt(await platform.command({ ...options, command: snapshot.command }), snapshot.command, snapshot.operator_id);
        // Retain the accepted receipt before readback, including if readback
        // fails. Later edits do not invalidate this operation's historical proof.
        await update(requestId, record => { record.owner_receipt = receipt; });
        configuration = assertConfiguration(await platform.configuration({ ...options, revision: receipt.revision }), receipt.revision);
        if (configuration.digest !== receipt.configuration_digest) throw fail("owner_response_invalid", "Platform receipt and retained configuration disagree.", 502);
      }
      await update(requestId, record => {
        record.owner_receipt = receipt; record.applied_configuration = configuration; record.account_login = login;
        const state = login ? login.state === "connected" ? "completed" : login.state === "cancelled" ? "cancelled" : LOGIN_TERMINAL.has(login.state) ? "rejected" : "awaiting-account" : "completed";
        event(record, state, "owner-readback-verified");
      });
      audit?.emit({ event_type: "model.operation.owner-verified", actor: snapshot.operator_id, request_id: requestId, action: snapshot.request.action, outcome: "readback-verified" });
    } catch (error) {
      const known = error instanceof ModelOwnerError && error.responseKnown;
      const code = error instanceof ModelOwnerError ? error.code : "owner-evidence-unverified";
      const effectFree = known && !["command-completion-unknown", "model-management-unavailable"].includes(code);
      let state = effectFree ? RETRYABLE.has(code) ? "retryable" : "rejected" : "unknown";
      if (error.code === "management-credential-unavailable") state = snapshot.priorDispatchPossible ? "unknown" : "retryable";
      if (error.code === "model_operations_owner_response_invalid") state = "blocked";
      await update(requestId, record => {
        // Once a mutation receipt exists only readback may be retried; no new
        // owner command or cancellation can undo an already accepted effect.
        if (record.owner_receipt) state = "unknown";
        if (!record.owner_receipt && (effectFree || error.code === "management-credential-unavailable" && !snapshot.priorDispatchPossible)) record.dispatch_started = false;
        event(record, state, "owner-progress-stopped", { code, retryable: state === "retryable" });
      });
    }
  }
  async function refreshLogin(record) {
    if (record.state !== "awaiting-account") return view(record);
    let login;
    try {
      login = assertLogin(await platform.login({ operatorId: record.operator_id, commandId: record.account_login.command_id }), record.account_login.command_id, record.operator_id, record.account_login.backend_id);
    } catch {
      return update(record.request.request_id, current => {
        if (current.state === "awaiting-account") event(current, "unknown", "account-progress-unavailable", { code: "owner-login-progress-unavailable", retryable: false });
      });
    }
    if (digest(login) === digest(record.account_login)) return view(record);
    return update(record.request.request_id, current => {
      if (current.state !== "awaiting-account" || current.command.command_id !== record.command.command_id) return;
      current.account_login = login;
      event(current, login.state === "connected" ? "completed" : login.state === "cancelled" ? "cancelled" : LOGIN_TERMINAL.has(login.state) ? "rejected" : "awaiting-account", "account-progress-verified");
    });
  }
  return {
    async registry({ callerId, operatorId }) {
      bind(callerId, operatorId);
      // Serial to avoid describing registrations from an older snapshot.
      const backends = assertBackends(await platform.backends({ operatorId }));
      const configuration = assertConfiguration(await platform.configuration({ operatorId }));
      for (const backend of backends.backends) backend.registered = Object.hasOwn(configuration.configuration.backends, backend.backend_id);
      let health = null;
      try { health = assertProviderHealth(backends.health, configuration); }
      catch { audit?.emit({ event_type: "model.provider-observation.invalid", outcome: "health-unknown" }); }
      // Observations cannot make owner configuration unavailable or authorize
      // an invocation. A concurrent configuration edit invalidates this check.
      return { schema_version: 1, ...backends, health, configuration };
    },
    async catalogue({ callerId, operatorId, backendId, model = null }) {
      bind(callerId, operatorId); identifier(backendId, "Backend");
      if (model !== null && (typeof model !== "string" || !model.length || model.length > 200)) throw fail("invalid_input", "Select a bounded advertised model.", 400);
      return assertCatalogue(await platform.catalogue({ operatorId, backendId, model }), backendId, model);
    },
    async create({ callerId, operatorId, input }) {
      bind(callerId, operatorId);
      const request = assertRequest(structuredClone(input)), fingerprint = digest(request);
      const result = await transact(async tx => {
        const replay = tx.idempotency(callerId, request.idempotency_key);
        const existing = tx.get(request.request_id);
        if (replay || existing) {
          const prior = own(tx.get(replay?.request_id ?? request.request_id), callerId, operatorId);
          if (prior.request_digest !== fingerprint || prior.request.request_id !== request.request_id) throw fail("idempotency_conflict", "This identity is already bound to different input.");
          return view(prior);
        }
        if (request.action === "account.login.cancel") {
          const source = tx.list().find(record => record.request.action === "account.login.start" &&
            (record.command.command_id === request.input.login_command_id || record.account_login?.command_id === request.input.login_command_id));
          own(source, callerId, operatorId);
          if (source.request.action !== "account.login.start") throw fail("invalid_input", "Select this caller's original account sign-in.", 400);
        }
        if (tx.list().filter(record => !TERMINAL.has(record.state)).length >= 32) throw fail("queue_full", "Resolve pending model operations before adding more.");
        const record = {
          request, request_digest: fingerprint, caller_id: callerId, operator_id: operatorId,
          revision: 0, attempt: 1, state: "queued", history: [], controls: {}, dispatch_started: false,
          owner_receipt: null, applied_configuration: null, account_login: null, failure: null,
        };
        record.command = commandFor(record, 1); event(record, "queued", "operator-intent-accepted");
        await tx.put(record, { createKey: `${callerId}:${request.idempotency_key}` });
        return view(record);
      });
      // Only a newly queued operation is dispatched; replay of running or
      // uncertain state never invents a replacement attempt.
      if (result.state === "queued") schedule(result.request_id);
      return result;
    },
    async get({ callerId, operatorId, requestId }) {
      return refreshLogin(own(await store.get(identifier(requestId)), callerId, operatorId));
    },
    async list({ callerId, operatorId, limit = 50, cursor = null }) {
      bind(callerId, operatorId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail("invalid_input", "List limit must be between one and 100.", 400);
      const records = (await store.list()).filter(r => r.caller_id === callerId && r.operator_id === operatorId).sort((a, b) => a.request.request_id.localeCompare(b.request.request_id));
      const start = cursor === null ? 0 : records.findIndex(r => r.request.request_id === cursor) + 1;
      if (cursor !== null && start === 0) throw fail("invalid_input", "The list cursor is not in this caller's records.", 400);
      const page = records.slice(start, start + limit);
      return { requests: page.map(view), next_cursor: records.length > start + limit ? page.at(-1).request.request_id : null };
    },
    async control({ callerId, operatorId, requestId, input }) {
      bind(callerId, operatorId); assertControl(input);
      let dispatchRequested = false;
      const result = await update(requestId, (record, tx) => {
        own(record, callerId, operatorId);
        const controlDigest = digest(input);
        const replay = record.controls[input.control_id];
        if (replay) {
          if (replay !== controlDigest) throw fail("idempotency_conflict", "Control identity is already bound to different input.");
          return;
        }
        if (record.revision !== input.expected_revision) throw fail("revision_conflict", "Refresh the model operation before controlling it.");
        if (TERMINAL.has(record.state)) throw fail("already_terminal", "This operation has already finished.");
        if (input.action === "cancel") {
          if (["queued", "retryable"].includes(record.state) && !record.owner_receipt && !record.dispatch_started) {
            event(record, "cancelled", "cancelled-before-owner-dispatch");
          } else if (record.state === "awaiting-account" && record.request.action === "account.login.start") {
            // Keep the original request/attempt identity. The separate owner
            // cancellation identity is stable and reconciles that same login.
            if (record.command.action !== "account.login.cancel") record.command = {
              ...record.command, command_id: `${record.command.command_id}:cancel`,
              action: "account.login.cancel", input: { login_command_id: record.account_login.command_id },
            };
            event(record, "queued", "account-cancellation-requested"); dispatchRequested = true;
          } else throw fail("cancellation_unconfirmed", "Owner dispatch may have completed. Reconcile its original result before cancelling.");
        } else {
          if (active.has(requestId)) throw fail("busy", "The original owner call is still running.");
          if (input.action === "retry") {
            if (record.state !== "retryable" || record.owner_receipt || record.dispatch_started) throw fail("retry_not_safe", "Only a known effect-free failure permits another attempt.");
            record.attempt += 1; record.command = commandFor(record, record.attempt);
          } else if (!["unknown", "running", "blocked", "awaiting-account", "queued"].includes(record.state)) {
            throw fail("reconcile_not_applicable", "Use the displayed next action for this operation.");
          }
          event(record, "queued", "operator-recovery-requested"); dispatchRequested = true;
        }
        record.controls[input.control_id] = controlDigest;
      });
      if (dispatchRequested) schedule(requestId);
      return result;
    },
    async idle() {
      while (pumping) await new Promise(resolve => setTimeout(resolve, 5));
    },
  };
}
