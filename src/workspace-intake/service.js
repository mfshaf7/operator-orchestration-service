import { assertIntake, bindIntake, createIntakeEvaluation, intakeDigest, intakeError, intakeReference } from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "requires-action"]);
const NEXT = {
  accepted: "continue", evaluating: "continue", preparing: "continue", "review-required": "review-and-merge",
  cancelling: "continue", cancelled: "complete", rejected: "submit-corrected-request", "requires-action": "submit-corrected-request", succeeded: "complete",
};

function publicResult(record) {
  return {
    schema_version: 1, workflow_id: "workspace-intake", request_id: record.request.request_id,
    session_ref: record.evaluation.session_ref, execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure ? (record.failure.retryable ? "restore-dependency-and-retry" : "inspect-review-or-cancel") : NEXT[record.status],
    revision: record.history.length,
    request: record.request, decision: record.evaluation.decision, readiness: record.readiness,
    review: record.review, readback: record.readback, receipt: record.receipt, failure: record.failure,
    history: record.history, canonical_mutation: record.status === "succeeded",
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw intakeError("not_found", "Intake request was not found.", 404);
  if (record.binding_digest !== intakeDigest({ caller_id: record.caller_id, evaluation: record.evaluation })) {
    throw intakeError("storage_invalid", "Stored intake command binding is invalid.", 503);
  }
}

export function createWorkspaceIntakeService({ store, readinessClient, sourceClient, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function submit({ callerId, input }) {
    const evaluation = createIntakeEvaluation(input, callerId);
    const binding = intakeDigest({ caller_id: callerId, evaluation });
    return store.transact(async (tx) => {
      const current = tx.get(input.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) throw intakeError("idempotency_conflict", "Request identity is bound to different input.");
        return publicResult(current);
      }
      const record = {
        caller_id: callerId, binding_digest: binding, evaluation, request: evaluation.request,
        status: "accepted", preparation: null, readiness: null, review: null, readback: null, receipt: null, failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await tx.put(record);
      return publicResult(record);
    });
  }

  async function finish(tx, record, merged) {
    const { request, evaluation, preparation } = record;
    const readback = assertIntake("readback", merged.readback);
    const expected = preparation.readback;
    if (readback.authority_state !== "merged-authority" || readback.record_digest !== expected.record_digest ||
        intakeDigest(readback.record) !== readback.record_digest ||
        intakeDigest(readback.mutation_ref) !== intakeDigest(intakeReference(preparation.mutation, "mutation")) ||
        intakeDigest(readback.target) !== intakeDigest(request.target)) {
      throw intakeError("merged_readback_mismatch", "Merged authority does not match the approved intake record.");
    }
    record.readback = readback;
    record.review = merged.review;
    record.receipt = assertIntake("receipt", bindIntake({
      schema_version: 2, artifact_type: "workspace-intake-receipt",
      receipt_id: `intake-merged:${intakeDigest({ readback: readback.readback_digest, binding: record.binding_digest }).slice(7)}`,
      completed_at: clock().toISOString(), request_ref: intakeReference(request, "request"),
      decision_ref: intakeReference(evaluation.decision, "decision"), mutation_ref: intakeReference(preparation.mutation, "mutation"),
      readback_ref: intakeReference(readback, "readback"), target: request.target,
      phase: "merged-authority", outcome: "succeeded", idempotency_key: request.idempotency_key,
      canonical_authority: { repo: "workspace-governance", path: "contracts/intake-register.yaml", branch: "main" },
    }, "receipt_digest"));
    await transition(tx, record, "succeeded", { merge_commit: merged.review.merge_commit, receipt_digest: record.receipt.receipt_digest });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw intakeError("action_invalid", "Unsupported intake action.", 400);
    return store.transact(async (tx) => {
      const record = tx.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(tx, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, tx.assertHeld);
          if (outcome?.readback) await finish(tx, record, outcome);
          else await transition(tx, record, "cancelled");
          return publicResult(record);
        }
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") await transition(tx, record, "evaluating");
          record.readiness = await readinessClient.evaluate(record.evaluation);
          if (record.readiness.receipt.outcome !== "allowed") {
            await transition(tx, record, record.readiness.receipt.outcome === "denied" ? "rejected" : "requires-action");
            return publicResult(record);
          }
          await transition(tx, record, "preparing");
        }
        if (record.status === "preparing") {
          if (!record.preparation) {
            record.preparation = await sourceClient.prepare(record, tx.assertHeld);
            assertIntake("mutation", record.preparation.mutation);
            assertIntake("readback", record.preparation.readback);
            await tx.put(record);
          }
          record.review = await sourceClient.openReview(record, tx.assertHeld);
          await transition(tx, record, "review-required");
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(record, tx.assertHeld);
          if (observed.readback) await finish(tx, record, observed);
          else if (observed.review.state === "closed") await transition(tx, record, "rejected");
          else if (record.failure) await transition(tx, record, "review-required", { recovered: true });
        }
        return publicResult(record);
      } catch (error) {
        // Keep the last durable phase so a transport timeout cannot erase a
        // remotely completed operation or issue a different command on retry.
        record.failure = { code: error?.code?.startsWith("workspace_intake_") ? error.code : "workspace_intake_dependency_unavailable", retryable: !error?.statusCode || error.statusCode >= 500, message: "Intake could not advance. Inspect the current review or correct the reported dependency before retrying." };
        await tx.put(record);
        audit?.emit({ actor: callerId, event_type: "workspace.intake.advance.failed", outcome: record.status, request_id: requestId, code: record.failure.code });
        if (error?.code?.startsWith("workspace_intake_")) throw error;
        throw intakeError("dependency_unavailable", "An intake dependency failed; the last durable phase was retained for retry.", 503);
      }
    });
  }

  return { submit, advance, async project(requestId, { callerId }) { const record = await store.get(requestId); assertCaller(record, callerId); return publicResult(record); } };
}
