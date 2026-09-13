import {
  assertClosureArtifact,
  assertResolvedAuthority,
  closureDigest,
  closureError,
  createClosureEvaluation,
} from "./contracts.js";

const TERMINAL = new Set(["succeeded", "denied", "failed"]);
const EVENT_TYPE = {
  "apply-delivery": "delivery-accepted",
  "graduate-source": "source-graduated",
  "retire-incubation": "incubation-retired",
  "reopen-incubation": "incubation-reopened",
};
const NEXT = {
  accepted: "continue",
  evaluating: "continue",
  "decision-required": "record-decision",
  reconciling: "continue",
  cancelling: "continue-cancellation",
  preparing: "continue",
  "review-required": "review-and-merge",
  "pending-readback": "continue-reconciliation",
  "pending-runtime-disposition": "continue-runtime-disposition",
  succeeded: "inspect-receipt",
  denied: "submit-corrected-request",
  failed: "submit-corrected-request",
};

function publicPreparation(value) {
  if (!value) return null;
  return {
    branch: value.branch,
    base_commit: value.base_commit,
    file_count: value.files.length,
    changed_paths: value.files.map((file) => file.path),
    event_ref: value.event.event_id,
    event_digest: value.event_digest,
  };
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "prototype-closure",
    request_id: record.request.request_id,
    prototype_id: record.request.prototype_id,
    action: record.request.action,
    status: record.status,
    next_action: NEXT[record.status],
    revision: record.history.length,
    request: structuredClone(record.request),
    source_snapshot: structuredClone(record.source_snapshot),
    readiness: structuredClone(record.readiness),
    decision: structuredClone(record.decision),
    resolved_authority: structuredClone(record.resolved_authority),
    preparation: publicPreparation(record.preparation),
    review: structuredClone(record.review),
    readback: structuredClone(record.readback),
    runtime_disposition: structuredClone(record.runtime_disposition),
    receipt: structuredClone(record.receipt),
    failure: structuredClone(record.failure),
    history: structuredClone(record.history),
    canonical_mutation: record.status === "succeeded",
    runtime_activation: false,
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) {
    throw closureError("not_found", "Prototype Closure request was not found.", 404);
  }
  if (record.binding_digest !== closureDigest({ caller_id: record.caller_id, evaluation: record.evaluation })) {
    throw closureError("storage_invalid", "Stored Prototype Closure command binding is invalid.", 503);
  }
}

function terminalReceipt(record, outcome, now, { findingCode = null, nextAction = null } = {}) {
  const request = record.request;
  const event = record.preparation?.event;
  const readback = record.readback;
  const result = {
    schema_version: 2,
    artifact_type: "prototype-closure-receipt",
    receipt_id: `prototype-closure-receipt:${closureDigest({ request_id: request.request_id, outcome }).slice(7)}`,
    request_ref: request.request_id,
    request_digest: closureDigest(request, { ascii: true }),
    prototype_id: request.prototype_id,
    action: request.action,
    outcome,
    previous_lifecycle: event?.previous_lifecycle ?? request.expected_lifecycle,
    observed_lifecycle: outcome === "completed" ? event.observed_lifecycle : request.expected_lifecycle,
    previous_source_custody: event?.previous_source_custody ?? record.source_snapshot.source_custody,
    observed_source_custody: outcome === "completed" ? event.observed_source_custody : record.source_snapshot.source_custody,
    source_revision: request.expected_source_revision,
    operator_id: request.operator_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    recorded_at: now,
    evidence_refs: [...new Set([
      ...(record.resolved_authority?.verification?.evidence_refs ?? []),
      record.readiness?.ledger?.ref?.uri,
      ...(outcome === "completed" && request.action === "graduate-source" ? [record.runtime_disposition?.ref] : []),
      ...(outcome === "completed" ? [event.event_id, readback.readback_id] : []),
    ].filter(Boolean))],
  };
  if (outcome === "completed") {
    Object.assign(result, {
      merged_source_revision: readback.merged_source_revision,
      source_event_ref: event.event_id,
      source_event_digest: closureDigest(event, { ascii: true }),
      merged_studio_readback_ref: readback.readback_id,
      merged_studio_readback_digest: closureDigest(readback, { ascii: true }),
    });
    for (const field of [
      "accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref",
      "source_transfer_receipt_ref", "already_owned_source_proof_ref", "prior_retirement_receipt_ref",
    ]) {
      const value = record.resolved_authority?.[field] ?? request[field];
      if (value) result[field] = value;
    }
  } else {
    result.finding_code = findingCode;
    result.next_action = nextAction;
    if (outcome === "failed") result.failure_stage = "pre-merge";
  }
  assertClosureArtifact(result, "receipt");
  return result;
}

function assertPrepared(record, value) {
  const event = assertClosureArtifact(value?.event, "history-event");
  const fields = {
    "apply-delivery": ["accepted_baseline_receipt_ref", "accepted_delivery_target_receipt_ref"],
    "graduate-source": ["accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref", "source_transfer_receipt_ref", "already_owned_source_proof_ref"],
    "retire-incubation": ["retention_plan_ref", "runtime_disposition_proof_ref"],
    "reopen-incubation": ["prior_retirement_receipt_ref", "retained_source_readback_ref"],
  }[record.request.action];
  if (
    event.request_ref !== record.request.request_id ||
    event.request_digest !== closureDigest(record.request, { ascii: true }) ||
    event.prototype_id !== record.request.prototype_id ||
    event.event_type !== EVENT_TYPE[record.request.action] ||
    event.expected_source_revision !== record.request.expected_source_revision ||
    event.previous_lifecycle !== record.request.expected_lifecycle ||
    event.operator_id !== record.request.operator_id ||
    event.idempotency_key !== record.request.idempotency_key ||
    event.correlation_id !== record.request.correlation_id ||
    fields.some((field) => event[field] !== (record.resolved_authority[field] ?? record.request[field])) ||
    (record.request.action === "graduate-source" && event.observed_source_custody !== record.resolved_authority.observed_source_custody) ||
    value.event_digest !== closureDigest(event, { ascii: true }) ||
    typeof value.event_path !== "string"
  ) {
    throw closureError("source_event_mismatch", "Prepared Studio event does not bind the accepted Closure request.", 502);
  }
  return value;
}

function assertReadback(record, value) {
  const readback = assertClosureArtifact(value, "studio-readback");
  const event = record.preparation.event;
  if (
    readback.prototype_id !== record.request.prototype_id ||
    readback.source_event_ref !== event.event_id ||
    readback.source_event_digest !== record.preparation.event_digest ||
    readback.merged_source_revision !== record.review.merge_commit ||
    readback.observed_lifecycle !== event.observed_lifecycle ||
    readback.observed_source_custody !== event.observed_source_custody ||
    Date.parse(readback.observed_at) < Date.parse(event.recorded_at)
  ) {
    throw closureError("readback_mismatch", "Merged Studio readback differs from the reviewed Closure event.", 502);
  }
  return readback;
}

function assertSnapshot(record, value) {
  if (value?.source_revision !== record.request.expected_source_revision ||
      value?.record_digest !== record.evaluation.expected_record_digest ||
      value?.lifecycle !== record.request.expected_lifecycle ||
      !["incubation-repo", "dedicated-owner-repo", "shared-owner-repo"].includes(value?.source_custody)) {
    throw closureError("source_snapshot_mismatch", "Studio source snapshot differs from the Closure request.");
  }
  return value;
}

function assertRuntimeDisposition(record, proof) {
  if (proof?.owner_ref !== "platform-engineering" || proof?.state !== "accepted" ||
      !["revoked", "absent"].includes(proof?.disposition) ||
      proof?.prototype_id !== record.request.prototype_id ||
      proof?.merged_source_revision !== record.readback.merged_source_revision ||
      !/^sha256:[0-9a-f]{64}$/.test(proof?.digest ?? "") ||
      !proof?.ref?.endsWith(proof.digest.slice(7)) ||
      !/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/%+=-]*$/.test(proof?.ref ?? "")) {
    throw closureError("runtime_disposition_unproven", "Platform runtime disposition does not bind the merged Closure source.");
  }
  return {
    owner_ref: proof.owner_ref, state: proof.state, disposition: proof.disposition,
    prototype_id: proof.prototype_id, merged_source_revision: proof.merged_source_revision,
    ref: proof.ref, digest: proof.digest,
  };
}

export function createPrototypeClosureService({ store, readinessClient, authorityResolver, sourceClient, platformClient, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function submit({ callerId, input }) {
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "expected_record_digest,request") {
      throw closureError("request_invalid", "Closure submission requires a request and exact record digest.", 400);
    }
    const request = assertClosureArtifact(input.request, "request");
    if (request.operator_id !== callerId) {
      throw closureError("caller_mismatch", "Closure operator differs from the authenticated caller.", 403);
    }
    const evaluation = createClosureEvaluation(request, input.expected_record_digest);
    const binding = closureDigest({ caller_id: callerId, evaluation });
    return store.transact(async (transaction) => {
      const existing = transaction.get(request.request_id);
      if (existing) {
        assertCaller(existing, callerId);
        if (existing.binding_digest !== binding) {
          throw closureError("idempotency_conflict", "Request identity is bound to different Closure input.");
        }
        return publicResult(existing);
      }
      const record = {
        caller_id: callerId, binding_digest: binding, request: structuredClone(request), evaluation,
        status: "accepted", source_snapshot: null, readiness: null, decision: null, resolved_authority: null,
        preparation: null, review: null, readback: null, runtime_disposition: null, receipt: null, failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await transaction.put(record);
      audit?.emit({ actor: callerId, event_type: "prototype.closure.accepted", outcome: "accepted", request_id: request.request_id });
      return publicResult(record);
    });
  }

  async function decide({ callerId, requestId, input }) {
    if (!input || Object.keys(input).sort().join(",") !== "decision" ||
        !["approve", "deny"].includes(input.decision)) {
      throw closureError("decision_invalid", "Record exactly one approve or deny decision.", 400);
    }
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (record.decision) {
        if (record.decision.value !== input.decision) throw closureError("decision_conflict", "Closure decision is already bound.");
        return publicResult(record);
      }
      if (record.status !== "decision-required") throw closureError("decision_not_ready", "Closure requires current ready evidence before decision.");
      if (Date.parse(record.readiness.ledger.expires_at) <= clock().getTime()) {
        record.receipt = terminalReceipt(record, "denied", clock().toISOString(), {
          findingCode: "readiness_expired", nextAction: "submit-corrected-request",
        });
        await transition(transaction, record, "denied", { finding_code: "readiness_expired" });
        return publicResult(record);
      }
      record.decision = {
        value: input.decision, operator_id: callerId, readiness_digest: record.readiness.readiness.readiness_digest,
        decided_at: clock().toISOString(),
      };
      if (input.decision === "deny") {
        record.receipt = terminalReceipt(record, "denied", clock().toISOString(), {
          findingCode: "operator_denied", nextAction: "submit-corrected-request",
        });
        await transition(transaction, record, "denied", { finding_code: "operator_denied" });
      } else {
        await transition(transaction, record, "reconciling", { decision: "approve" });
      }
      return publicResult(record);
    });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) {
      throw closureError("action_invalid", "Unsupported Closure action.", 400);
    }
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status) || ["pending-readback", "pending-runtime-disposition"].includes(record.status)) {
        if (action === "cancel") return publicResult(record);
      }
      try {
        if (action === "cancel" && !TERMINAL.has(record.status) && record.status !== "cancelling") {
          await transition(transaction, record, "cancelling");
        }
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, transaction.assertHeld);
          if (outcome?.review?.merged) {
            record.review = outcome.review;
            await transition(transaction, record, "pending-readback", { merge_commit: outcome.review.merge_commit });
          } else {
            if (!record.source_snapshot) {
              record.source_snapshot = assertSnapshot(record, await sourceClient.snapshot(record, transaction.assertHeld));
            }
            record.receipt = terminalReceipt(record, "denied", clock().toISOString(), {
              findingCode: "operator_cancelled", nextAction: "submit-corrected-request",
            });
            await transition(transaction, record, "denied", outcome?.retained_branch
              ? { finding_code: "operator_cancelled", retained_branch: outcome.retained_branch }
              : { finding_code: "operator_cancelled" });
          }
          return publicResult(record);
        }
        if (TERMINAL.has(record.status) || record.status === "decision-required") return publicResult(record);
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") await transition(transaction, record, "evaluating");
          if (!record.source_snapshot) {
            record.source_snapshot = assertSnapshot(record, await sourceClient.snapshot(record, transaction.assertHeld));
            await transaction.put(record);
          }
          record.readiness = await readinessClient.evaluate(record.evaluation);
          await transaction.put(record);
          if (record.readiness.readiness.outcome !== "ready") {
            const findingCode = record.readiness.readiness.findings?.[0]?.code ?? "readiness_not_ready";
            record.receipt = terminalReceipt(record, "denied", clock().toISOString(), {
              findingCode, nextAction: "submit-corrected-request",
            });
            await transition(transaction, record, "denied", { finding_code: findingCode });
          } else {
            await transition(transaction, record, "decision-required");
          }
          return publicResult(record);
        }
        if (record.status === "reconciling") {
          if (Date.parse(record.readiness.ledger.expires_at) <= clock().getTime()) {
            throw closureError("readiness_expired", "Closure readiness expired before source preparation.");
          }
          record.resolved_authority = assertResolvedAuthority(
            record.request,
            await authorityResolver.resolve(record.request, record.readiness, record.source_snapshot),
            record.readiness,
          );
          await transition(transaction, record, "preparing");
        }
        if (record.status === "preparing") {
          if (!record.preparation) {
            record.preparation = assertPrepared(record, await sourceClient.prepare(record, transaction.assertHeld));
            await transaction.put(record);
          }
          record.review = await sourceClient.openReview(record, transaction.assertHeld);
          if (record.review?.state !== "open" || !/^[0-9a-f]{40}$/.test(record.review.head_commit ?? "")) {
            throw closureError("review_invalid", "Closure review does not bind an open exact source head.", 502);
          }
          await transition(transaction, record, "review-required", { review_number: record.review.number });
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(record, transaction.assertHeld);
          if (observed.state === "closed" && !observed.merged) {
            record.receipt = terminalReceipt(record, "failed", clock().toISOString(), {
              findingCode: "review_closed", nextAction: "submit-corrected-request",
            });
            await transition(transaction, record, "failed", { finding_code: "review_closed" });
          } else if (observed.merged) {
            record.review = observed;
            await transition(transaction, record, "pending-readback", { merge_commit: observed.merge_commit });
          }
          return publicResult(record);
        }
        if (record.status === "pending-readback") {
          if (!record.review?.human_reviewed || !/^[0-9a-f]{40}$/.test(record.review.merge_commit ?? "")) {
            throw closureError("merge_unproven", "Closure merge lacks exact-head human review proof.", 503);
          }
          record.readback = assertReadback(record, await sourceClient.readback(record, transaction.assertHeld));
          if (record.request.action === "graduate-source") {
            await transition(transaction, record, "pending-runtime-disposition", { merged_source_revision: record.readback.merged_source_revision });
            return publicResult(record);
          }
          record.receipt = terminalReceipt(record, "completed", clock().toISOString());
          await transition(transaction, record, "succeeded", { receipt_digest: closureDigest(record.receipt, { ascii: true }) });
          return publicResult(record);
        }
        if (record.status === "pending-runtime-disposition") {
          if (typeof platformClient?.readDisposition !== "function") {
            throw closureError("platform_reader_missing", "Platform runtime disposition reader is not commissioned.", 503);
          }
          record.runtime_disposition = assertRuntimeDisposition(record, await platformClient.readDisposition({
            request: record.request, readback: record.readback,
          }));
          record.receipt = terminalReceipt(record, "completed", clock().toISOString());
          await transition(transaction, record, "succeeded", { receipt_digest: closureDigest(record.receipt, { ascii: true }) });
          return publicResult(record);
        }
        throw closureError("state_invalid", "Closure request has an unsupported durable phase.", 503);
      } catch (error) {
        record.failure = {
          code: typeof error?.code === "string" && error.code.startsWith("prototype_closure_")
            ? error.code : "prototype_closure_dependency_unavailable",
          retryable: ["pending-readback", "pending-runtime-disposition"].includes(record.status) || !error?.statusCode || error.statusCode >= 500,
          message: record.status === "pending-readback"
            ? "Merged source requires exact readback reconciliation; no new source change is allowed."
            : record.status === "pending-runtime-disposition"
              ? "Merged source requires exact Platform disposition proof; no new source change is allowed."
            : "Closure retained its last durable phase; inspect the dependency before retrying.",
        };
        await transaction.put(record);
        audit?.emit({ actor: callerId, event_type: "prototype.closure.advance.failed", outcome: record.status, request_id: requestId, code: record.failure.code });
        if (typeof error?.code === "string" && error.code.startsWith("prototype_closure_")) throw error;
        throw closureError("dependency_unavailable", record.failure.message, 503);
      }
    });
  }

  return {
    submit, decide, advance,
    async project(requestId, { callerId }) {
      const record = await store.get(requestId);
      assertCaller(record, callerId);
      return publicResult(record);
    },
  };
}
