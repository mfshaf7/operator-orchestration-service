import {
  assertPrototypeMaturityArtifact,
  createPrototypeMaturityDecision,
  createPrototypeMaturityEvaluation,
  createPrototypeMaturityReceipt,
  prototypeMaturityDigest,
  prototypeMaturityError,
  prototypeMaturityReference,
} from "./contracts.js";

const TERMINAL = new Set([
  "blocked",
  "cancelled",
  "rejected",
  "requires-action",
  "routed-closeout",
  "succeeded",
]);
const PROMOTION = new Set(["promote-candidate", "approve-baseline"]);
const NEXT = {
  accepted: "continue",
  evaluating: "continue",
  "decision-required": "record-decision",
  preparing: "continue",
  "review-required": "review-and-merge",
  cancelling: "continue",
  cancelled: "complete",
  rejected: "submit-corrected-request",
  "requires-action": "submit-corrected-request",
};

function publicPreparation(value) {
  if (!value) return null;
  return {
    branch: value.branch,
    base_commit: value.base_commit,
    file_count: value.file_count,
    changed_paths: structuredClone(value.changed_paths),
    content_digest: value.content_digest,
    source_result: structuredClone(value.source_result),
    readback: structuredClone(value.readback),
  };
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "prototype-maturity",
    request_id: record.evaluation.request.request_id,
    prototype_id: record.evaluation.request.prototype_id,
    transition: record.evaluation.request.transition,
    session_ref: record.evaluation.session_ref,
    execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure
      ? record.failure.retryable
        ? "restore-dependency-and-retry"
        : "inspect-review-or-cancel"
      : record.receipt?.next_action?.code ?? NEXT[record.status],
    revision: record.history.length,
    request: structuredClone(record.evaluation.request),
    packet: structuredClone(record.evaluation.packet),
    readiness: structuredClone(record.readiness),
    decision: structuredClone(record.decision),
    preparation: publicPreparation(record.preparation),
    review: structuredClone(record.review),
    readback: structuredClone(record.readback),
    receipt: structuredClone(record.receipt),
    failure: structuredClone(record.failure),
    history: structuredClone(record.history),
    canonical_mutation:
      record.status === "succeeded" &&
      PROMOTION.has(record.decision?.decision),
    runtime_activation: false,
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) {
    throw prototypeMaturityError(
      "not_found",
      "Prototype Maturity request was not found.",
      404,
    );
  }
  if (
    record.binding_digest !==
    prototypeMaturityDigest({
      caller_id: record.caller_id,
      evaluation: record.evaluation,
    })
  ) {
    throw prototypeMaturityError(
      "storage_invalid",
      "Stored Prototype Maturity command binding is invalid.",
      503,
    );
  }
}

function preparationInput(input) {
  const keys = Object.keys(input ?? {}).sort().join(",");
  if (
    !input ||
    Array.isArray(input) ||
    keys !== "prototype_id,transition" ||
    typeof input.prototype_id !== "string" ||
    !/^prototype:[a-z0-9][a-z0-9._-]*$/.test(input.prototype_id) ||
    !["candidate-promotion", "baseline-promotion"].includes(input.transition)
  ) {
    throw prototypeMaturityError(
      "preparation_invalid",
      "Preparation requires exactly one Prototype identity and maturity transition.",
      400,
    );
  }
  return input;
}

function decisionInput(input) {
  const blocking = ["block-promotion", "block-baseline"].includes(input?.decision);
  const keys = Object.keys(input ?? {}).sort().join(",");
  if (
    !input ||
    Array.isArray(input) ||
    keys !== (blocking ? "blocker,decision" : "decision")
  ) {
    throw prototypeMaturityError(
      "decision_invalid",
      "Record exactly one maturity decision and its required blocker, if any.",
      400,
    );
  }
  return { decision: input.decision, blocker: input.blocker ?? null };
}

function sameDecision(record, input, callerId) {
  return (
    record.decision?.decision === input.decision &&
    record.decision?.operator_ref === callerId &&
    prototypeMaturityDigest(record.decision?.blocker) ===
      prototypeMaturityDigest(input.blocker)
  );
}

export function createPrototypeMaturityService({
  store,
  readinessClient,
  sourceClient,
  clock = () => new Date(),
  audit,
}) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({
      sequence: record.history.length + 1,
      at: clock().toISOString(),
      status,
      details,
    });
    await transaction.put(record);
  }

  async function prepare({ callerId, input }) {
    const command = preparationInput(input);
    const state = await sourceClient.state(command.prototype_id);
    if (
      !/^[0-9a-f]{40}$/.test(state.authority_revision) ||
      state.prototype_id !== command.prototype_id ||
      state.expected_state?.source_revision !== state.authority_revision ||
      typeof state.expected_state?.record_digest !== "string"
    ) {
      throw prototypeMaturityError(
        "authority_invalid",
        "Prototype Studio returned invalid maturity preparation state.",
        503,
      );
    }
    const result = {
      schema_version: 1,
      workflow_id: "prototype-maturity",
      prototype_id: command.prototype_id,
      transition: command.transition,
      authority_revision: state.authority_revision,
      expected_state: structuredClone(state.expected_state),
      canonical_authority: {
        repo: "workspace-prototype-studio",
        branch: "main",
        registry_path: "prototypes.yaml",
      },
      canonical_mutation: false,
    };
    audit?.emit({
      actor: callerId,
      event_type: "prototype.maturity.preparation.read",
      outcome: "succeeded",
      prototype_id: command.prototype_id,
      transition: command.transition,
      authority_revision: result.authority_revision,
    });
    return result;
  }

  async function submit({ callerId, input }) {
    const evaluation = createPrototypeMaturityEvaluation(input, callerId);
    const binding = prototypeMaturityDigest({
      caller_id: callerId,
      evaluation,
    });
    return store.transact(async (transaction) => {
      const current = transaction.get(evaluation.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) {
          throw prototypeMaturityError(
            "idempotency_conflict",
            "Request identity is bound to different maturity input.",
          );
        }
        return publicResult(current);
      }
      const record = {
        caller_id: callerId,
        binding_digest: binding,
        evaluation,
        status: "accepted",
        readiness: null,
        decision: null,
        preparation: null,
        review: null,
        readback: null,
        receipt: null,
        failure: null,
        history: [
          {
            sequence: 1,
            at: clock().toISOString(),
            status: "accepted",
            details: null,
          },
        ],
      };
      await transaction.put(record);
      audit?.emit({
        actor: callerId,
        event_type: "prototype.maturity.accepted",
        outcome: "accepted",
        request_id: evaluation.request.request_id,
        prototype_id: evaluation.request.prototype_id,
        transition: evaluation.request.transition,
      });
      return publicResult(record);
    });
  }

  async function decide({ callerId, requestId, input }) {
    const command = decisionInput(input);
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (record.decision) {
        if (!sameDecision(record, command, callerId)) {
          throw prototypeMaturityError(
            "decision_conflict",
            "The maturity request is already bound to a different decision.",
          );
        }
        return publicResult(record);
      }
      if (record.status !== "decision-required") {
        throw prototypeMaturityError(
          "decision_not_ready",
          "A maturity decision requires current ready evidence.",
        );
      }
      if (Date.parse(record.readiness.ledger.expires_at) <= clock().getTime()) {
        await transition(transaction, record, "requires-action", {
          readiness_outcome: "stale",
        });
        return publicResult(record);
      }
      record.decision = createPrototypeMaturityDecision({
        evaluation: record.evaluation,
        readiness: record.readiness.readiness,
        operatorRef: callerId,
        decision: command.decision,
        blocker: command.blocker,
        sourceBranch: sourceClient.branch(record),
        decidedAt: clock().toISOString(),
      });
      await transition(transaction, record, "preparing", {
        decision: record.decision.decision,
      });
      audit?.emit({
        actor: callerId,
        event_type: "prototype.maturity.decision.recorded",
        outcome: record.decision.decision,
        request_id: requestId,
      });
      return publicResult(record);
    });
  }

  function validateReadback(record, readback, { merged, review = null }) {
    assertPrototypeMaturityArtifact(readback);
    const promoted = PROMOTION.has(record.decision.decision);
    const expectedLifecycle = promoted
      ? record.evaluation.request.target_lifecycle
      : record.evaluation.request.source_lifecycle;
    if (
      prototypeMaturityDigest(readback.decision_ref) !==
        prototypeMaturityDigest(prototypeMaturityReference(record.decision)) ||
      readback.prototype_id !== record.evaluation.request.prototype_id ||
      readback.transition !== record.evaluation.request.transition ||
      readback.decision !== record.decision.decision ||
      readback.authority_state !==
        (promoted ? "merged-authority" : "unchanged-authority") ||
      readback.observed_lifecycle !== expectedLifecycle ||
      readback.record_digest !== record.preparation.source_result.record_digest ||
      (merged && readback.source_revision !== review?.merge_commit) ||
      (!merged &&
        readback.source_revision !== record.evaluation.authority_revision)
    ) {
      throw prototypeMaturityError(
        "readback_mismatch",
        "Prototype Studio readback does not match the approved maturity decision.",
      );
    }
    return readback;
  }

  async function finish(transaction, record, readback, status, details) {
    record.readback = validateReadback(record, readback, {
      merged: status === "succeeded",
      review: record.review,
    });
    record.receipt = createPrototypeMaturityReceipt({
      decision: record.decision,
      readback: record.readback,
      completedAt: clock().toISOString(),
    });
    await transition(transaction, record, status, {
      ...details,
      receipt_digest: record.receipt.receipt_digest,
    });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) {
      throw prototypeMaturityError(
        "action_invalid",
        "Unsupported Prototype Maturity action.",
        400,
      );
    }
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") {
          await transition(transaction, record, "cancelling");
        }
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, transaction.assertHeld);
          if (outcome?.readback) {
            record.review = outcome.review;
            await finish(transaction, record, outcome.readback, "succeeded", {
              merge_commit: outcome.review.merge_commit,
            });
          } else {
            await transition(
              transaction,
              record,
              "cancelled",
              outcome?.retained_branch
                ? { retained_branch: outcome.retained_branch }
                : null,
            );
          }
          return publicResult(record);
        }
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") {
            await transition(transaction, record, "evaluating");
          }
          record.readiness = await readinessClient.evaluate(record.evaluation);
          await transaction.put(record);
          if (record.readiness.readiness.outcome !== "ready") {
            await transition(transaction, record, "requires-action", {
              readiness_outcome: record.readiness.readiness.outcome,
            });
            return publicResult(record);
          }
          await transition(transaction, record, "decision-required");
          return publicResult(record);
        }
        if (record.status === "decision-required") return publicResult(record);
        if (record.status === "preparing") {
          if (Date.parse(record.readiness.ledger.expires_at) <= clock().getTime()) {
            await transition(transaction, record, "requires-action", {
              readiness_outcome: "stale",
            });
            return publicResult(record);
          }
          if (!record.preparation) {
            record.preparation = await sourceClient.prepare(
              record,
              transaction.assertHeld,
            );
            await transaction.put(record);
          }
          if (!PROMOTION.has(record.decision.decision)) {
            const status = record.decision.decision === "route-closeout"
              ? "routed-closeout"
              : "blocked";
            await finish(
              transaction,
              record,
              record.preparation.readback,
              status,
              { source_outcome: "unchanged" },
            );
            return publicResult(record);
          }
          record.review = await sourceClient.openReview(
            record,
            transaction.assertHeld,
          );
          await transition(transaction, record, "review-required", {
            review_number: record.review.number,
            head_commit: record.review.head_commit,
          });
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observe(
            record,
            transaction.assertHeld,
          );
          if (observed.readback) {
            record.review = observed.review;
            await finish(transaction, record, observed.readback, "succeeded", {
              merge_commit: observed.review.merge_commit,
            });
          } else if (observed.review.state === "closed") {
            await transition(transaction, record, "rejected");
          } else if (record.failure) {
            await transition(transaction, record, "review-required", {
              recovered: true,
            });
          }
        }
        return publicResult(record);
      } catch (error) {
        record.failure = {
          code:
            typeof error?.code === "string" &&
            error.code.startsWith("prototype_maturity_")
              ? error.code
              : "prototype_maturity_dependency_unavailable",
          retryable: !error?.statusCode || error.statusCode >= 500,
          message:
            "Prototype Maturity could not advance. Inspect the current review or correct the reported dependency before retrying.",
        };
        await transaction.put(record);
        audit?.emit({
          actor: callerId,
          event_type: "prototype.maturity.advance.failed",
          outcome: record.status,
          request_id: requestId,
          code: record.failure.code,
        });
        if (
          typeof error?.code === "string" &&
          error.code.startsWith("prototype_maturity_")
        ) {
          throw error;
        }
        throw prototypeMaturityError(
          "dependency_unavailable",
          "A Prototype Maturity dependency failed; the last durable phase was retained for retry.",
          503,
        );
      }
    });
  }

  return {
    prepare,
    submit,
    decide,
    advance,
    async project(requestId, { callerId }) {
      const record = await store.get(requestId);
      assertCaller(record, callerId);
      return publicResult(record);
    },
  };
}
