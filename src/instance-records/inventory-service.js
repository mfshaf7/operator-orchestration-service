import { projectInstanceRegistryRecord } from "./inventory-projection.js";
import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
import { assertInstanceInventoryRequest } from "./contracts.js";

const terminal = new Set(["succeeded", "cancelled", "blocked"]);
const fail = (code, message, status = 409) => new HttpError(status, `workspace_inventory_${code}`, message);
const targetFor = input => {
  if (!input || Object.keys(input).join(",") !== "target" || !input.target ||
      Object.keys(input.target).sort().join(",") !== "kind,name" || input.target.kind !== "repo" ||
      !/^[a-z0-9][a-z0-9._-]{0,185}$/.test(input.target.name ?? "")) throw fail("preparation_invalid", "Select one exact repository registration.", 400);
  return { ...input.target, record_id: `repo:${input.target.name}` };
};
const familyFor = request => request.action === "promote" ? "workspace-inventory-promotion" : "workspace-inventory-lifecycle";
function bound(record, callerId, family) {
  if (!record || record.caller_id !== callerId || familyFor(record.request) !== family) throw fail("not_found", "The original inventory request was not found.", 404);
  if (record.authority_kind !== "internal-instance-record" || record.binding_digest !== intakeDigest({ caller_id: callerId, evaluation: record.evaluation })) {
    throw fail("storage_invalid", "Saved inventory input failed its original binding.", 503);
  }
}
function project(record) {
  const workflow = familyFor(record.request), complete = record.status === "succeeded";
  return { schema_version: 1, workflow_id: workflow, authority_kind: "internal-instance-record", canonical_authority: record.canonical_authority,
    request_id: record.request.request_id, request: record.request, session_ref: record.evaluation.session_ref, execution_ref: record.evaluation.execution_ref,
    status: record.status, revision: record.history.length, history: record.history,
    next_action: complete || record.status === "cancelled" ? "complete" : record.status === "blocked"
      ? workflow === "workspace-inventory-promotion" ? "submit-corrected-promotion" : "submit-corrected-request"
      : record.failure ? "restore-dependency-and-retry" : "continue",
    canonical_mutation: complete, cancel_allowed: !terminal.has(record.status) && !record.commit_attempted,
    review: null, readiness: null, readback: record.native_result, receipt: record.native_result?.receipt ?? null,
    ...(workflow === "workspace-inventory-lifecycle" ? { merged_state: null } : {}), failure: record.failure };
}

export function createInstanceInventoryService({ instanceId, journal, reader, writer, legacyRequestReader,
  enabled = true, family = "workspace-inventory-promotion", clock = () => new Date() }) {
  if (!["workspace-inventory-promotion", "workspace-inventory-lifecycle"].includes(family)) throw new TypeError("Select an existing Inventory workflow family.");
  const active = () => { if (!enabled) throw fail("internal_disabled", "Internal inventory changes are disabled; existing history is retained.", 503); };
  const readState = name => reader.prepare(name, { operation: "inventory" });
  function transition(record, status, details = null) {
    record.status = status; record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
  }
  return {
    async prepare({ callerId: _callerId, input }) {
      const target = targetFor(input), state = await readState(target.name);
      if (state.canonical_authority.kind === "legacy-git") return state;
      active();
      const current = state.current, phase = family === "workspace-inventory-promotion" ? "intake" : "inventory";
      if (!current || current.record.phase !== phase || phase === "intake" && current.record.status !== "admitted") {
        throw fail("target_not_eligible", phase === "intake" ? "Promote only an admitted registration." : "Select an existing inventory repository.");
      }
      const { phase: _phase, ...domain } = current.record;
      return { schema_version: 1, workflow_id: family, authority_kind: "internal-instance-record", authority_revision: state.policy_ref.revision,
        canonical_authority: state.canonical_authority, policy_ref: state.policy_ref, expected_state: state.expected_state,
        target, current_record: domain, latest_receipt_ref: { version: current.receipt.version, digest: current.receipt.receipt_digest, action: current.receipt.action },
        ...(phase === "intake" ? { intake_entry_ref: { id: target.record_id, version: current.receipt.version, digest: current.receipt.record_digest },
          candidate: projectInstanceRegistryRecord(current, { kind: "internal-instance-record", instance_id: instanceId }).value } : {}),
        canonical_mutation: false };
    },
    async submit({ callerId, input }) {
      active();
      if (!input || Object.keys(input).sort().join(",") !== "authority_revision,execution_ref,request,session_ref") throw fail("command_invalid", "Submit only the exact reviewed inventory change.", 400);
      const request = assertInstanceInventoryRequest(input.request, instanceId, callerId);
      if (familyFor(request) !== family || input.authority_revision !== request.policy_ref.revision ||
          ![input.session_ref, input.execution_ref].every(value => typeof value === "string" && value.trim())) throw fail("command_invalid", "Inventory input changed its workflow or review binding.", 400);
      const evaluation = structuredClone(input), binding = intakeDigest({ caller_id: callerId, evaluation });
      return journal.transact(request.request_id, async tx => {
        if (await legacyRequestReader(request.request_id)) throw fail("request_conflict", "This identity belongs to its original source-backed inventory request.");
        if (tx.current) {
          bound(tx.current, callerId, family);
          if (tx.current.binding_digest !== binding) throw fail("idempotency_conflict", "This request already binds different accepted input.");
          return project(tx.current);
        }
        const state = await readState(request.target.name);
        if (state.canonical_authority.kind !== "internal-instance-record" || intakeDigest(state.expected_state) !== intakeDigest(request.expected_state) ||
            intakeDigest(state.policy_ref) !== intakeDigest(request.policy_ref)) throw fail("review_stale", "Inventory changed after review; refresh its current record.");
        const record = { schema_version: 1, authority_kind: "internal-instance-record", caller_id: callerId, canonical_authority: state.canonical_authority,
          request, evaluation, binding_digest: binding, status: "accepted", commit_attempted: false, native_result: null, failure: null,
          history: [{ sequence: 1, status: "accepted", at: clock().toISOString(), details: null }] };
        tx.put(record); return project(record);
      });
    },
    async advance({ callerId, requestId, action = "continue" }) {
      if (!["continue", "cancel"].includes(action)) throw fail("action_invalid", "Continue or cancel the original inventory request.", 400);
      return journal.transact(requestId, async tx => {
        const record = tx.current; bound(record, callerId, family);
        if (terminal.has(record.status)) return project(record);
        if (action === "cancel") {
          if (record.commit_attempted) throw fail("outcome_unconfirmed", "Resolve the original inventory outcome; its write has already been attempted.");
          transition(record, "cancelled"); tx.put(record); return project(record);
        }
        active();
        const original = { request: record.request, operator_ref: callerId };
        try {
          let result = await reader.resolve(record.request.target.name, original, { operation: "inventory" });
          if (!result) {
            record.commit_attempted = true;
            transition(record, "preparing"); tx.put(record);
            result = await writer.accept(record.request.target.name, { schema_version: 1, ...original }, { operation: "inventory" });
          }
          record.native_result = result;
          transition(record, "succeeded", { receipt_digest: result.receipt.receipt_digest });
        } catch (error) {
          const retryable = !error?.statusCode || error.statusCode >= 500 || [401, 403, 404, 405, 408, 429].includes(error.statusCode);
          record.failure = { code: error?.code ?? "instance_inventory_unavailable", retryable,
            message: retryable ? "The original inventory request is retained. Restore its connection and retry." : "Inventory needs a fresh review of its state or requested metadata. The original request is retained." };
          if (!retryable) record.status = "blocked";
          record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status: record.status, details: { failure: record.failure.code } });
        }
        tx.put(record); return project(record);
      });
    },
    async project(requestId, { callerId }) { const record = journal.get(requestId); bound(record, callerId, family); return project(record); },
    async records({ callerId, target }) { return journal.list({ callerId, target }).filter(record => familyFor(record.request) === family); },
  };
}
