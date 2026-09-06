import {
  assertInventory,
  createInventoryLifecycleEvaluation,
  inventoryDigest,
  inventoryError,
  inventoryReference,
} from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "blocked", "stale"]);
const NEXT = {
  accepted: "continue",
  evaluating: "continue",
  preparing: "continue",
  "review-required": "review-and-merge",
  cancelling: "continue",
  cancelled: "complete",
  rejected: "submit-corrected-request",
  blocked: "submit-corrected-request",
  stale: "refresh-and-resubmit",
  succeeded: "complete",
};
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TARGET_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TARGET_KINDS = new Set(["repo", "product", "component"]);
const INVENTORY_PATHS = {
  repo: "contracts/repos.yaml",
  product: "contracts/products.yaml",
  component: "contracts/components.yaml",
};
const HISTORY_PATH = "contracts/workspace-inventory-history.yaml";

function targetFromPreparation(input) {
  if (!input || Array.isArray(input) || Object.keys(input).join(",") !== "target") {
    throw inventoryError("lifecycle_preparation_invalid", "Lifecycle preparation requires exactly one target.", 400);
  }
  const target = input.target;
  if (!target || Array.isArray(target) || Object.keys(target).sort().join(",") !== "kind,name" ||
      !TARGET_KINDS.has(target.kind) || typeof target.name !== "string" || !TARGET_NAME.test(target.name)) {
    throw inventoryError("lifecycle_preparation_invalid", "Lifecycle target must identify one valid repository, product, or component.", 400);
  }
  return { kind: target.kind, name: target.name };
}

function assertPreparationState(value, target) {
  const recordId = `${target.kind}:${target.name}`;
  if (!SHA.test(value?.authority_revision) || value?.target?.kind !== target.kind || value?.target?.name !== target.name ||
      value?.target?.record_id !== recordId || !DIGEST.test(value?.active_inventory_digest) ||
      !DIGEST.test(value?.history_digest) || !Number.isInteger(value?.record_version) || value.record_version < 1 ||
      !DIGEST.test(value?.record_digest) || !["active", "suspended", "retired"].includes(value?.posture) ||
      !value.record || inventoryDigest(value.record) !== value.record_digest) {
    throw inventoryError("lifecycle_authority_invalid", "Workspace Inventory authority returned invalid lifecycle state.", 503);
  }
  if (value.latest_event_ref !== null &&
      (typeof value.latest_event_ref?.id !== "string" || !DIGEST.test(value.latest_event_ref?.digest))) {
    throw inventoryError("lifecycle_history_invalid", "Workspace Inventory authority returned an invalid latest history event.", 503);
  }
  return value;
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "workspace-inventory-lifecycle",
    request_id: record.request.request_id,
    session_ref: record.evaluation.session_ref,
    execution_ref: record.evaluation.execution_ref,
    status: record.status,
    next_action: record.failure
      ? (record.failure.retryable ? "restore-dependency-and-retry" : "inspect-review-or-cancel")
      : NEXT[record.status],
    revision: record.history.length,
    request: record.request,
    readiness: record.readiness,
    review: record.review,
    readback: record.preparation?.readback ?? null,
    receipt: record.preparation?.receipt ?? null,
    merged_state: record.merged_state,
    failure: record.failure,
    history: record.history,
    canonical_mutation: record.status === "succeeded",
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw inventoryError("lifecycle_not_found", "Inventory lifecycle request was not found.", 404);
  if (record.binding_digest !== inventoryDigest({ caller_id: record.caller_id, evaluation: record.evaluation })) {
    throw inventoryError("lifecycle_storage_invalid", "Stored inventory lifecycle binding is invalid.", 503);
  }
}

export function createWorkspaceInventoryLifecycleService({ store, readinessClient, sourceClient, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function prepare({ callerId, input }) {
    const target = targetFromPreparation(input);
    const state = assertPreparationState(await sourceClient.lifecycleState(target), target);
    const result = {
      schema_version: 1,
      workflow_id: "workspace-inventory-lifecycle",
      authority_revision: state.authority_revision,
      target: structuredClone(state.target),
      expected_state: {
        active_inventory_digest: state.active_inventory_digest,
        history_digest: state.history_digest,
        record_version: state.record_version,
        record_digest: state.record_digest,
        posture: state.posture,
      },
      current_record: structuredClone(state.record),
      latest_event_ref: structuredClone(state.latest_event_ref),
      canonical_authority: {
        repo: "workspace-governance",
        inventory_path: INVENTORY_PATHS[target.kind],
        history_path: HISTORY_PATH,
        branch: "main",
      },
      canonical_mutation: false,
    };
    audit?.emit({
      actor: callerId,
      event_type: "workspace.inventory.lifecycle.preparation.read",
      outcome: "succeeded",
      target: result.target.record_id,
      authority_revision: result.authority_revision,
    });
    return result;
  }

  async function submit({ callerId, input }) {
    const evaluation = createInventoryLifecycleEvaluation(input, callerId);
    const binding = inventoryDigest({ caller_id: callerId, evaluation });
    return store.transact(async (transaction) => {
      const current = transaction.get(input.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) throw inventoryError("idempotency_conflict", "Request identity is bound to different lifecycle input.");
        return publicResult(current);
      }
      const record = {
        caller_id: callerId,
        binding_digest: binding,
        evaluation,
        request: evaluation.request,
        status: "accepted",
        preparation: null,
        readiness: null,
        review: null,
        merged_state: null,
        failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await transaction.put(record);
      audit?.emit({
        actor: callerId,
        event_type: "workspace.inventory.lifecycle.accepted",
        outcome: "accepted",
        request_id: record.request.request_id,
        target: record.request.target.record_id,
        action: record.request.action,
      });
      return publicResult(record);
    });
  }

  async function finish(transaction, record, merged) {
    const preparedReadback = assertInventory("lifecycle-readback", record.preparation.readback);
    const state = merged.mergedState;
    if (state.authority_revision !== merged.review.merge_commit ||
        inventoryDigest(state.target) !== inventoryDigest(record.request.target) ||
        state.action !== record.request.action ||
        state.active_inventory_digest !== preparedReadback.active_inventory_digest ||
        state.history_digest !== preparedReadback.history_digest ||
        inventoryDigest(state.record) !== inventoryDigest(preparedReadback.record) ||
        inventoryDigest(state.history_event_ref) !== inventoryDigest(preparedReadback.history_event_ref)) {
      throw inventoryError("merged_readback_mismatch", "Merged authority does not match the approved inventory lifecycle change.");
    }
    record.review = merged.review;
    record.merged_state = structuredClone(state);
    await transition(transaction, record, "succeeded", {
      merge_commit: merged.review.merge_commit,
      receipt_digest: record.preparation.receipt.receipt_digest,
      history_event: state.history_event_ref.id,
    });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw inventoryError("lifecycle_action_invalid", "Unsupported inventory lifecycle action.", 400);
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(transaction, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancelLifecycle(record, transaction.assertHeld);
          if (outcome?.mergedState) await finish(transaction, record, outcome);
          else await transition(transaction, record, "cancelled");
          return publicResult(record);
        }
        if (["accepted", "evaluating"].includes(record.status)) {
          if (record.status === "accepted") await transition(transaction, record, "evaluating");
          record.readiness = await readinessClient.evaluate(record.evaluation);
          if (record.readiness.readiness.outcome !== "ready") {
            await transition(transaction, record, record.readiness.readiness.outcome);
            return publicResult(record);
          }
          await transition(transaction, record, "preparing");
        }
        if (record.status === "preparing") {
          if (!record.preparation) {
            record.preparation = await sourceClient.prepareLifecycle(record, transaction.assertHeld);
            assertInventory("lifecycle-mutation", record.preparation.mutation);
            assertInventory("lifecycle-readback", record.preparation.readback);
            assertInventory("lifecycle-receipt", record.preparation.receipt);
            await transaction.put(record);
          }
          record.review = await sourceClient.openLifecycleReview(record, transaction.assertHeld);
          await transition(transaction, record, "review-required");
          return publicResult(record);
        }
        if (record.status === "review-required") {
          const observed = await sourceClient.observeLifecycle(record, transaction.assertHeld);
          if (observed.mergedState) await finish(transaction, record, observed);
          else if (observed.review.state === "closed") await transition(transaction, record, "rejected");
          else if (record.failure) await transition(transaction, record, "review-required", { recovered: true });
        }
        return publicResult(record);
      } catch (error) {
        if (error?.code === "workspace_inventory_authority_stale") {
          await transition(transaction, record, "stale", { code: error.code });
          return publicResult(record);
        }
        record.failure = {
          code: typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")
            ? error.code
            : "workspace_inventory_lifecycle_dependency_unavailable",
          retryable: !error?.statusCode || error.statusCode >= 500,
          message: "Inventory lifecycle could not advance. Inspect the current review or correct the reported dependency before retrying.",
        };
        await transaction.put(record);
        audit?.emit({
          actor: callerId,
          event_type: "workspace.inventory.lifecycle.advance.failed",
          outcome: record.status,
          request_id: requestId,
          code: record.failure.code,
        });
        if (typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")) throw error;
        throw inventoryError("lifecycle_dependency_unavailable", "An inventory lifecycle dependency failed; the last durable phase was retained for retry.", 503);
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
