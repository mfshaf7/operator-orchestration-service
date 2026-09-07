import {
  assertPrototypeLandingArtifact,
  createPrototypeLandingApply,
  createPrototypeLandingEvaluation,
  prototypeLandingDigest,
  prototypeLandingError,
  prototypeLandingReference,
} from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const NEXT = {
  accepted: "continue",
  evaluating: "continue",
  preparing: "continue",
  "review-required": "review-and-merge",
  cancelling: "continue",
  cancelled: "complete",
  rejected: "submit-corrected-request",
  "requires-action": "submit-corrected-request",
  succeeded: "candidate-promotion",
};

function publicPreparation(value) {
  if (!value) return null;
  return {
    branch: value.branch,
    base_commit: value.base_commit,
    file_count: value.file_count,
    changed_paths: structuredClone(value.changed_paths),
    content_digest: value.content_digest,
    readback: structuredClone(value.readback),
    receipt: structuredClone(value.receipt),
  };
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "prototype-landing",
    request_id: record.evaluation.request.request_id,
    prototype_id: record.evaluation.request.prototype.id,
    session_ref: record.evaluation.session_ref,
    execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure ? (record.failure.retryable ? "restore-dependency-and-retry" : "inspect-review-or-cancel") : NEXT[record.status],
    revision: record.history.length,
    entry_packet: structuredClone(record.evaluation.entry_packet),
    request: structuredClone(record.evaluation.request),
    plan: structuredClone(record.evaluation.plan),
    readiness: structuredClone(record.readiness),
    apply: structuredClone(record.apply),
    preparation: publicPreparation(record.preparation),
    review: structuredClone(record.review),
    readback: structuredClone(record.readback),
    receipt: structuredClone(record.receipt),
    failure: structuredClone(record.failure),
    history: structuredClone(record.history),
    canonical_mutation: record.status === "succeeded",
    runtime_activation: false,
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw prototypeLandingError("not_found", "Prototype Landing request was not found.", 404);
  if (record.binding_digest !== prototypeLandingDigest({ caller_id: record.caller_id, evaluation: record.evaluation, operator_approval_ref: record.operator_approval_ref })) {
    throw prototypeLandingError("storage_invalid", "Stored Prototype Landing command binding is invalid.", 503);
  }
}

function preparationInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).join(",") !== "prototype_id" ||
      typeof input.prototype_id !== "string" || !/^prototype:[a-z0-9][a-z0-9._-]*$/.test(input.prototype_id)) {
    throw prototypeLandingError("preparation_invalid", "Preparation requires exactly one valid Prototype identity.", 400);
  }
  return input.prototype_id;
}

export function createPrototypeLandingService({ store, readinessClient, sourceClient, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function prepare({ callerId, input }) {
    const prototypeId = preparationInput(input);
    const state = await sourceClient.state(prototypeId);
    if (!/^[0-9a-f]{40}$/.test(state.authority_revision) || state.prototype_id !== prototypeId ||
        state.expected_state?.source_revision !== state.authority_revision || typeof state.expected_state?.registry_digest !== "string") {
      throw prototypeLandingError("authority_invalid", "Prototype Studio returned invalid Landing preparation state.", 503);
    }
    const result = {
      schema_version: 1,
      workflow_id: "prototype-landing",
      prototype_id: prototypeId,
      authority_revision: state.authority_revision,
      expected_state: structuredClone(state.expected_state),
      canonical_authority: { repo: "workspace-prototype-studio", branch: "main", registry_path: "prototypes.yaml" },
      canonical_mutation: false,
    };
    audit?.emit({ actor: callerId, event_type: "prototype.landing.preparation.read", outcome: "succeeded", prototype_id: prototypeId, authority_revision: result.authority_revision });
    return result;
  }

  async function submit({ callerId, input }) {
    const evaluation = createPrototypeLandingEvaluation(input, callerId);
    const binding = prototypeLandingDigest({ caller_id: callerId, evaluation, operator_approval_ref: input.operator_approval_ref });
    return store.transact(async (transaction) => {
      const current = transaction.get(evaluation.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) throw prototypeLandingError("idempotency_conflict", "Request identity is bound to different Landing input.");
        return publicResult(current);
      }
      const record = {
        caller_id: callerId,
        binding_digest: binding,
        evaluation,
        operator_approval_ref: input.operator_approval_ref,
        status: "accepted",
        readiness: null,
        apply: null,
        preparation: null,
        review: null,
        readback: null,
        receipt: null,
        failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await transaction.put(record);
      audit?.emit({ actor: callerId, event_type: "prototype.landing.accepted", outcome: "accepted", request_id: evaluation.request.request_id, prototype_id: evaluation.request.prototype.id });
      return publicResult(record);
    });
  }

  async function finish(transaction, record, merged) {
    const readback = assertPrototypeLandingArtifact(merged.readback);
    const receipt = assertPrototypeLandingArtifact(merged.receipt);
    const expected = record.preparation.readback;
    const review = merged.review;
    if (review?.repository !== "workspace-prototype-studio" || review.number !== record.review?.number ||
        review.branch !== record.preparation.branch || review.base_branch !== "main" ||
        review.base_commit !== record.preparation.base_commit || review.head_commit !== record.review?.head_commit ||
        !review.merged || !review.human_reviewed || !/^[0-9a-f]{40}$/.test(review.merge_commit) ||
        readback.authority_state !== "merged-authority" || readback.source_branch !== "main" ||
        readback.source_revision !== review.merge_commit ||
        readback.prototype_id !== record.evaluation.request.prototype.id ||
        readback.registry_digest !== expected.registry_digest || readback.record_digest !== expected.record_digest ||
        prototypeLandingDigest(readback.apply_ref) !== prototypeLandingDigest(prototypeLandingReference(record.apply)) ||
        receipt.phase !== "merged-authority" || receipt.outcome !== "succeeded" ||
        receipt.prototype_id !== record.evaluation.request.prototype.id ||
        prototypeLandingDigest(receipt.entry_packet_ref) !== prototypeLandingDigest(prototypeLandingReference(record.evaluation.entry_packet)) ||
        prototypeLandingDigest(receipt.request_ref) !== prototypeLandingDigest(prototypeLandingReference(record.evaluation.request)) ||
        prototypeLandingDigest(receipt.plan_ref) !== prototypeLandingDigest(prototypeLandingReference(record.evaluation.plan)) ||
        prototypeLandingDigest(receipt.readiness_ref) !== prototypeLandingDigest(prototypeLandingReference(record.readiness.readiness)) ||
        prototypeLandingDigest(receipt.apply_ref) !== prototypeLandingDigest(prototypeLandingReference(record.apply)) ||
        prototypeLandingDigest(receipt.readback_ref) !== prototypeLandingDigest(prototypeLandingReference(readback)) ||
        receipt.source_result.repo !== "workspace-prototype-studio" || receipt.source_result.branch !== "main" ||
        receipt.source_result.revision !== review.merge_commit ||
        receipt.source_result.registry_digest !== readback.registry_digest || receipt.source_result.record_digest !== readback.record_digest ||
        receipt.next_action.code !== "candidate-promotion" || receipt.next_action.owner_ref !== "workspace-prototype-studio" ||
        receipt.correlation_id !== record.evaluation.request.correlation_id ||
        receipt.idempotency_key !== record.evaluation.request.idempotency_key) {
      throw prototypeLandingError("merged_readback_mismatch", "Merged Prototype Studio authority does not match the approved Landing source.");
    }
    record.review = merged.review;
    record.readback = readback;
    record.receipt = receipt;
    await transition(transaction, record, "succeeded", { merge_commit: merged.review.merge_commit, receipt_digest: receipt.receipt_digest });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw prototypeLandingError("action_invalid", "Unsupported Prototype Landing action.", 400);
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(transaction, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, transaction.assertHeld);
          if (outcome?.readback) await finish(transaction, record, outcome);
          else await transition(transaction, record, "cancelled", outcome?.retained_branch ? { retained_branch: outcome.retained_branch } : null);
          return publicResult(record);
        }
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") await transition(transaction, record, "evaluating");
          record.readiness = await readinessClient.evaluate(record.evaluation);
          await transaction.put(record);
          if (record.readiness.readiness.outcome !== "ready") {
            await transition(transaction, record, "requires-action", { readiness_outcome: record.readiness.readiness.outcome });
            return publicResult(record);
          }
          record.apply = createPrototypeLandingApply({
            evaluation: record.evaluation,
            readiness: record.readiness.readiness,
            operatorApprovalRef: record.operator_approval_ref,
            sourceBranch: sourceClient.branch(record),
            requestedAt: clock().toISOString(),
          });
          await transition(transaction, record, "preparing");
        }
        if (record.status === "preparing") {
          if (Date.parse(record.readiness.ledger.expires_at) <= clock().getTime()) {
            await transition(transaction, record, "requires-action", { readiness_outcome: "stale" });
            return publicResult(record);
          }
          if (!record.preparation) {
            record.preparation = await sourceClient.prepare(record, transaction.assertHeld);
            assertPrototypeLandingArtifact(record.preparation.readback);
            assertPrototypeLandingArtifact(record.preparation.receipt);
            await transaction.put(record);
          }
          record.review = await sourceClient.openReview(record, transaction.assertHeld);
          await transition(transaction, record, "review-required", { review_number: record.review.number, head_commit: record.review.head_commit });
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(record, transaction.assertHeld);
          if (observed.readback) await finish(transaction, record, observed);
          else if (observed.review.state === "closed") await transition(transaction, record, "rejected");
          else if (record.failure) await transition(transaction, record, "review-required", { recovered: true });
        }
        return publicResult(record);
      } catch (error) {
        record.failure = {
          code: typeof error?.code === "string" && error.code.startsWith("prototype_landing_") ? error.code : "prototype_landing_dependency_unavailable",
          retryable: !error?.statusCode || error.statusCode >= 500,
          message: "Prototype Landing could not advance. Inspect the current review or correct the reported dependency before retrying.",
        };
        await transaction.put(record);
        audit?.emit({ actor: callerId, event_type: "prototype.landing.advance.failed", outcome: record.status, request_id: requestId, code: record.failure.code });
        if (typeof error?.code === "string" && error.code.startsWith("prototype_landing_")) throw error;
        throw prototypeLandingError("dependency_unavailable", "A Prototype Landing dependency failed; the last durable phase was retained for retry.", 503);
      }
    });
  }

  return {
    prepare,
    submit,
    advance,
    async project(requestId, { callerId }) {
      const record = await store.get(requestId);
      assertCaller(record, callerId);
      return publicResult(record);
    },
  };
}
