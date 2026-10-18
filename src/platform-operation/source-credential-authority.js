import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { assertSourceCredentialReceipt, assertSourceCredentialTimestamp, normalizeSourceCredentialInput } from "./source-credentials.js";
import { platformOperationIdFor } from "./contracts.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
function fail(code, message, status = 409) { throw new HttpError(status, code, message); }
function closed(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    fail("platform_source_preparation_invalid", "Source preparation contains invalid fields.", 400);
  }
}
function selector(value) {
  if (value?.kind === "delivery") {
    closed(value, ["kind", "work_item_ref"]);
    if (!/^work-item-[1-9][0-9]*$/.test(value.work_item_ref ?? "")) fail("platform_source_preparation_invalid", "Actual Delivery work item is required.", 400);
  } else if (value?.kind === "prototype") {
    closed(value, ["kind", "prototype_id", "source_request_id"]);
    if (!/^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.prototype_id ?? "") || !ID.test(value.source_request_id ?? "")) {
      fail("platform_source_preparation_invalid", "Actual Prototype and source request are required.", 400);
    }
  } else {
    fail("platform_source_preparation_invalid", "Only explicit Delivery and Prototype source subjects are admitted.", 400);
  }
}

function publicPreparation(record, now) {
  return {
    schema_version: 1, workflow_id: "source-credential-preparation",
    intent_id: record.source_intent.intent_id,
    source_intent: structuredClone(record.source_intent), source_intent_digest: record.source_intent_digest,
    session_id: record.session_id, created_at: record.created_at,
    start_decision: record.source_intent.subject.kind === "delivery" ? structuredClone(record.proof.decision) : null,
    operation_refs: {
      issue: record.approval?.command_id ? platformOperationIdFor(record.approval.command_id) : null,
      revoke: record.revocation_requested?.command_id ? platformOperationIdFor(record.revocation_requested.command_id) : null,
    },
    authorization: {
      state: record.credential_receipt?.action === "agent-source.revoke" ? "revoked" : record.revocation_requested ? "revocation-requested"
        : Date.parse(record.source_intent.expires_at) <= now.getTime() ? "expired" : record.approval ? "approved" : "prepared",
      approval_ref: record.approval?.decision_ref ?? null,
      credential_receipt: structuredClone(record.credential_receipt ?? null),
    },
    authority: "operator-orchestration-service", secret_values_embedded: false,
  };
}

export function sourceCredentialUsable(record, now, rotation = record.current_rotation_seconds ?? record.proof?.rotate_before_expiry_seconds) {
  if (!Number.isSafeInteger(rotation) || rotation < 0) fail("platform_source_policy_unavailable", "Canonical source credential rotation policy is unavailable.", 503);
  const receipt = record.credential_receipt;
  return Boolean(receipt && receipt.action !== "agent-source.revoke" && Date.parse(receipt.token_expires_at) > now.getTime() + rotation * 1000);
}

export function createSourceCredentialAuthority({ clock = () => new Date(), providerCallerId, resolvers, store }) {
  if (!providerCallerId || !store || typeof store.transactSourcePreparation !== "function") {
    throw new Error("Source credential authority requires the existing private Platform-operation store and provider caller.");
  }
  function resolver(kind) {
    const value = resolvers?.[kind];
    if (!value || typeof value.prepare !== "function" || typeof value.verify !== "function") {
      fail("platform_source_subject_unavailable", "The canonical source workflow for this subject is unavailable.", 503);
    }
    return value;
  }
  function retained(intentId, callerId, operatorId) {
    if (typeof intentId !== "string" || !ID.test(intentId)) fail("platform_source_intent_invalid", "Source intent identity is invalid.", 400);
    const record = store.sourcePreparation(intentId);
    if (!record) fail("platform_source_intent_not_found", "Prepare the source credential intent through its canonical workflow first.", 404);
    if (record.caller_id !== callerId || record.source_intent.operator_id !== operatorId) {
      fail("platform_source_intent_forbidden", "Source preparation belongs to a different caller or operator.", 403);
    }
    normalizeSourceCredentialInput({ source_intent: record.source_intent, session_id: record.session_id });
    if (canonicalDigest(record.source_intent) !== record.source_intent_digest || canonicalDigest(record.request) !== record.request_digest || canonicalDigest(record.proof) !== record.proof_digest) {
      fail("platform_source_preparation_corrupt", "Source preparation integrity could not be verified.", 503);
    }
    if (record.credential_receipt) {
      assertSourceCredentialReceipt(record.credential_receipt);
      if (record.credential_receipt.source_intent_digest !== record.source_intent_digest) fail("platform_source_preparation_corrupt", "Retained credential receipt belongs to a different source intent.", 503);
    }
    return record;
  }
  async function prepare({ callerId, operatorId, input }) {
    closed(input, ["preparation_id", "subject", "decision", "expires_at", "supersedes_intent_digest"]);
    if (typeof input.preparation_id !== "string" || input.preparation_id.length > 190 || !ID.test(input.preparation_id)) fail("platform_source_preparation_invalid", "Preparation identity is invalid.", 400);
    selector(input.subject);
    assertSourceCredentialTimestamp(input.expires_at, "expires_at");
    if (input.supersedes_intent_digest !== null && !DIGEST.test(input.supersedes_intent_digest ?? "")) fail("platform_source_preparation_invalid", "Predecessor digest is invalid.", 400);
    const intentId = `source-intent:${input.preparation_id}`;
    const requestDigest = canonicalDigest(input);
    return store.transactSourcePreparation(intentId, async ({ current, put }) => {
      if (current) {
        const existing = retained(intentId, callerId, operatorId);
        if (existing.request_digest !== requestDigest) fail("platform_source_preparation_conflict", "Preparation identity is already bound to another request.");
        return publicPreparation(existing, clock());
      }
      if (Date.parse(input.expires_at) <= clock().getTime()) fail("platform_source_intent_expired", "Source approval expiry must be in the future.");
      const resolved = await resolver(input.subject.kind).prepare({ callerId, operatorId, subject: input.subject, decision: input.decision });
      const sourceIntent = normalizeSourceCredentialInput({ session_id: resolved.session_id, source_intent: {
        schema_version: 1, purpose: "ordinary-source", intent_id: intentId, caller_id: providerCallerId,
        operator_id: operatorId, subject: resolved.subject, source_start_digest: resolved.source_start_digest,
        repository: resolved.repository, repository_id: resolved.repository_id, installation_id: resolved.installation_id,
        landing_unit_id: resolved.landing_unit_id, branch: resolved.branch, fetched_base: resolved.fetched_base,
        human_reviewer_id: resolved.human_reviewer_id, expires_at: input.expires_at,
        supersedes_intent_digest: input.supersedes_intent_digest,
      } }).source_intent;
      const record = {
        schema_version: 1, caller_id: callerId, request: structuredClone(input), request_digest: requestDigest,
        source_intent: sourceIntent, source_intent_digest: canonicalDigest(sourceIntent), session_id: resolved.session_id,
        // Trusted, non-secret source-workflow proof, never browser-selected source coordinates.
        proof: structuredClone(resolved.proof), proof_digest: canonicalDigest(resolved.proof), created_at: clock().toISOString(),
      };
      put(record);
      return publicPreparation(record, clock());
    });
  }
  async function assertAuthorized({ callerId, operatorId, command }) {
    const value = normalizeSourceCredentialInput(command.input);
    const record = retained(value.source_intent.intent_id, callerId, operatorId);
    if (canonicalDigest(value.source_intent) !== record.source_intent_digest) {
      fail("platform_source_intent_mismatch", "Command does not match its immutable server-derived source intent.");
    }
    // Stopping an owned intent must remain possible after its subject closes,
    // a session is retired, approval expires, or the canonical backend is down.
    if (command.action === "agent-source.revoke") {
      if (value.session_id !== record.session_id) {
        if (record.session_id !== null || value.session_id === null) fail("platform_source_session_mismatch", "Revocation cannot change the bound source session.");
        const resolved = await resolver(record.request.subject.kind).verify({ callerId, operatorId, record, action: command.action });
        if (value.session_id !== resolved.session_id) fail("platform_source_session_mismatch", "Revocation session does not match its source intent.");
      }
      // Stop locally before dispatch. An unavailable provider or an uncertain
      // revocation response must never leave this intent usable for new writes.
      await store.transactSourcePreparation(record.source_intent.intent_id, ({ current, put }) => {
        assertSessionBinding(current, value.session_id);
        put({ ...current, session_id: value.session_id,
          revocation_requested: {
            command_id: current.revocation_requested?.command_id ?? command.command_id,
            requested_at: current.revocation_requested?.requested_at ?? clock().toISOString(),
          },
        });
      });
      return;
    }
    assertOpen(record);
    const resolved = await resolver(record.request.subject.kind).verify({ callerId, operatorId, record, action: command.action });
    if (value.session_id !== resolved.session_id) fail("platform_source_session_mismatch", "Credential action does not match the actual source session.");
    assertResolvedBinding(record, resolved);
    // Persist the actual session binding once, so terminal revocation no longer
    // depends on a live session or backend. It does not create a session.
    await store.transactSourcePreparation(record.source_intent.intent_id, ({ current, put }) => {
      assertOpen(current);
      assertSessionBinding(current, resolved.session_id);
      if (command.action === "agent-source.renew" && !current.approval) {
        fail("platform_source_approval_required", "Issue this source intent with exact operator approval before renewing it.");
      }
      // Preparation alone is not authorization. Retain the original exact
      // approved issue command so subsequent renewal cannot expand its scope.
      put({ ...current, session_id: resolved.session_id,
        approval: current.approval ?? {
          command_id: command.command_id, intent_digest: command.intent_digest,
          decision_ref: command.approval.decision_ref, decided_at: command.approval.decided_at,
          operator_id: operatorId,
        },
      });
    });
  }
  function assertOpen(record) {
    if (record.revocation_requested) fail("platform_source_intent_revoked", "This source intent has been stopped; issue a separately approved successor if source work must resume.");
    if (Date.parse(record.source_intent.expires_at) <= clock().getTime()) fail("platform_source_intent_expired", "Approved source intent has expired; it cannot issue, renew, or authorize source writes.");
  }
  function assertSessionBinding(record, sessionId) {
    if (record.session_id !== null && record.session_id !== sessionId) {
      fail("platform_source_session_mismatch", "Source intent cannot change its bound session.");
    }
  }
  function assertResolvedBinding(record, resolved) {
    if (resolved.source_start_digest !== record.source_intent.source_start_digest ||
        canonicalDigest(resolved.subject) !== canonicalDigest(record.source_intent.subject)) {
      fail("platform_source_start_changed", "The approved prospective source start has changed or been superseded.");
    }
    for (const field of ["repository", "repository_id", "installation_id", "landing_unit_id", "branch", "fetched_base", "human_reviewer_id"]) {
      if (resolved[field] !== record.source_intent[field]) fail("platform_source_start_changed", "Canonical source binding no longer matches the approved source intent.");
    }
  }
  async function observe({ command, projection }) {
    if (projection.state !== "succeeded") return;
    const receipt = assertSourceCredentialReceipt(projection.receipt?.source_credential, command);
    const intentId = receipt.source_intent_id;
    await store.transactSourcePreparation(intentId, ({ current, put }) => {
      if (!current || current.source_intent_digest !== receipt.source_intent_digest) {
        fail("platform_source_intent_mismatch", "Credential receipt has no matching canonical source preparation.");
      }
      // An older prospective receipt is still valid historical evidence after
      // a session binds, but cannot unbind it or undo a later stop.
      if (receipt.session_id !== null) assertSessionBinding(current, receipt.session_id);
      const previous = current.credential_receipt;
      const replace = !previous || receipt.action === "agent-source.revoke" ||
        (previous.action !== "agent-source.revoke" && Date.parse(receipt.token_expires_at) > Date.parse(previous.token_expires_at));
      put({ ...current,
        session_id: current.session_id ?? receipt.session_id,
        credential_receipt: replace ? receipt : previous,
        ...(receipt.action === "agent-source.revoke" ? {
          revocation_requested: current.revocation_requested ?? { command_id: command.command_id, requested_at: receipt.recorded_at },
        } : {}),
      });
    });
  }
  async function withSourceLease({ callerId, operatorId, intentId, sessionId, operation }) {
    if (typeof operation !== "function") throw new TypeError("A bounded source effect is required.");
    return store.transactSourcePreparation(intentId, async () => {
      const record = retained(intentId, callerId, operatorId);
      assertOpen(record);
      if (!record.approval) fail("platform_source_approval_required", "Prepared source scope has not received exact operator approval.");
      if (record.session_id !== sessionId) fail("platform_source_session_mismatch", "The source effect does not match its bound session.");
      const receipt = record.credential_receipt;
      if (!sourceCredentialUsable(record, clock())) {
        fail("platform_source_renewal_required", "Renew this approved source intent through Platform operations before attempting the source effect.");
      }
      assertSourceCredentialReceipt(receipt);
      const resolved = await resolver(record.request.subject.kind).verify({ callerId, operatorId, record, action: "source-effect" });
      assertResolvedBinding(record, resolved);
      if (resolved.session_id !== sessionId) fail("platform_source_session_mismatch", "Canonical source session no longer matches this effect.");
      // Canonical readback may take time; recheck expiry immediately before the
      // bounded effect. Revocation shares this lock and serializes with writes.
      assertOpen(record);
      if (!sourceCredentialUsable(record, clock(), resolved.proof?.rotate_before_expiry_seconds)) fail("platform_source_renewal_required", "Source credential expired during canonical readback; renew before writing.");
      return operation((session) => {
        assertOpen(record);
        if (!sourceCredentialUsable(record, clock(), resolved.proof?.rotate_before_expiry_seconds)) fail("platform_source_renewal_required", "Source credential entered its owner-required rotation window before the source effect.");
        if (!session || session.session_id !== sessionId || session.landing_unit_id !== record.source_intent.landing_unit_id ||
            session.landing_unit?.branch !== record.source_intent.branch || session.landing_unit?.base_commit !== record.source_intent.fetched_base) {
          fail("platform_source_session_mismatch", "The actual executor source effect does not match its approved lease.");
        }
      });
    });
  }
  async function leaseContext({ callerId, operatorId, intentId, sessionId, workItemId = null, requestedStartDigest = null, stopping = false }) {
    const record = retained(intentId, callerId, operatorId);
    if (!record.approval) fail("platform_source_approval_required", "Prepared source scope has not received exact operator approval.");
    if (workItemId !== null && (record.source_intent.subject.kind !== "delivery" || record.source_intent.subject.work_item_ref !== workItemId)) {
      fail("platform_source_subject_mismatch", "The source command does not match its approved canonical Delivery subject.");
    }
    if (stopping) {
      assertSessionBinding(record, sessionId);
      return structuredClone(record);
    }
    assertOpen(record);
    if (requestedStartDigest !== null && requestedStartDigest !== record.source_intent.source_start_digest) {
      fail("platform_source_start_changed", "The requested source-start decision differs from its approved source intent.");
    }
    const resolved = await resolver(record.request.subject.kind).verify({ callerId, operatorId, record, action: "source-effect" });
    assertResolvedBinding(record, resolved);
    if (resolved.session_id !== sessionId) fail("platform_source_session_mismatch", "The requested source effect does not match the canonical source session.");
    return store.transactSourcePreparation(intentId, ({ current, put }) => {
      assertOpen(current);
      assertSessionBinding(current, sessionId);
      if (current.session_id === null && sessionId !== null) put({ ...current, session_id: sessionId });
      return structuredClone({ ...current, session_id: sessionId, current_rotation_seconds: resolved.proof?.rotate_before_expiry_seconds });
    });
  }
  return {
    prepare, assertAuthorized, observe, withSourceLease, leaseContext,
    assertApprovedSuccessor({ callerId, operatorId, intentId, previousIntentId, sessionId }) {
      const previous = retained(previousIntentId, callerId, operatorId);
      const current = retained(intentId, callerId, operatorId);
      assertOpen(current);
      const subjectKey = previous.source_intent.subject.kind === "delivery" ? "work_item_ref" : "prototype_id";
      if (intentId === previousIntentId || !previous.revocation_requested || !current.approval || !current.credential_receipt ||
          current.credential_receipt.action === "agent-source.revoke" || current.source_intent.supersedes_intent_digest !== previous.source_intent_digest ||
          current.session_id !== sessionId || sessionId === null || (previous.session_id !== null && previous.session_id !== sessionId) ||
          current.source_intent.subject.kind !== previous.source_intent.subject.kind ||
          current.source_intent.subject[subjectKey] !== previous.source_intent.subject[subjectKey] ||
          ["repository", "repository_id", "installation_id", "landing_unit_id", "branch", "fetched_base", "human_reviewer_id"].some(field => current.source_intent[field] !== previous.source_intent[field])) {
        fail("platform_source_successor_unconfirmed", "Replacing an active session's authorization requires fresh explicit approval, verified issuance and its exact stopped predecessor; it cannot change the source session or scope.");
      }
    },
    async requestStop({ callerId, operatorId, intentId }) {
      retained(intentId, callerId, operatorId);
      return store.transactSourcePreparation(intentId, ({ current, put }) => {
        put({ ...current, revocation_requested: current.revocation_requested ?? {
          command_id: null, requested_at: clock().toISOString(),
        } });
      });
    },
    read({ callerId, operatorId, intentId }) { return publicPreparation(retained(intentId, callerId, operatorId), clock()); },
    list({ callerId, operatorId, limit = 100 }) {
      return store.listSourcePreparations({ limit }).filter(record => record.caller_id === callerId && record.source_intent.operator_id === operatorId)
        .map(record => publicPreparation(retained(record.source_intent.intent_id, callerId, operatorId), clock()));
    },
  };
}
