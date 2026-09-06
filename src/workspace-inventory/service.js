import {
  assertInventoryRegistry,
  assertInventory,
  bindInventory,
  createInventoryEvaluation,
  inventoryDigest,
  inventoryError,
  inventoryReference,
  registryProjectionDigest,
} from "./contracts.js";

const TERMINAL = new Set(["succeeded", "cancelled", "rejected", "blocked", "stale"]);
const NEXT = {
  accepted: "continue",
  evaluating: "continue",
  preparing: "continue",
  "review-required": "review-and-merge",
  cancelling: "continue",
  cancelled: "complete",
  rejected: "submit-corrected-promotion",
  blocked: "submit-corrected-promotion",
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

function preparationTarget(input) {
  if (!input || Array.isArray(input) || Object.keys(input).join(",") !== "target") {
    throw inventoryError("preparation_invalid", "Preparation requires exactly one target.", 400);
  }
  const target = input.target;
  if (!target || Array.isArray(target) || Object.keys(target).sort().join(",") !== "kind,name" ||
      !TARGET_KINDS.has(target.kind) || typeof target.name !== "string" || !TARGET_NAME.test(target.name)) {
    throw inventoryError("preparation_invalid", "Preparation target must identify one valid repository, product, or component.", 400);
  }
  return { kind: target.kind, name: target.name };
}

function assertPreparationState(value, requestedTarget) {
  const expectedRecordId = `${requestedTarget.kind}:${requestedTarget.name}`;
  if (!SHA.test(value?.authority_revision) || value?.target?.kind !== requestedTarget.kind ||
      value?.target?.name !== requestedTarget.name || value?.target?.record_id !== expectedRecordId ||
      !DIGEST.test(value?.intake_register_digest) || !DIGEST.test(value?.active_inventory_digest)) {
    throw inventoryError("authority_invalid", "Workspace Inventory authority returned invalid preparation state.", 503);
  }
  if (!Number.isInteger(value.intake_entry_version) || value.intake_entry_version < 1 || !DIGEST.test(value.intake_entry_digest)) {
    throw inventoryError("target_not_admitted", "Only a current admitted Workspace Intake entry can start inventory promotion.", 409);
  }
  if (value.active_record_version !== null || value.active_record_digest !== null) {
    throw inventoryError("target_already_active", "The target already exists in active inventory; use a lifecycle operation.", 409);
  }
  return value;
}

function publicResult(record) {
  return {
    schema_version: 1,
    workflow_id: "workspace-inventory-promotion",
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
    readback: record.readback,
    receipt: record.receipt,
    failure: record.failure,
    history: record.history,
    canonical_mutation: record.status === "succeeded",
  };
}

function assertCaller(record, callerId) {
  if (!record || record.caller_id !== callerId) throw inventoryError("not_found", "Inventory promotion was not found.", 404);
  if (record.binding_digest !== inventoryDigest({ caller_id: record.caller_id, evaluation: record.evaluation })) {
    throw inventoryError("storage_invalid", "Stored inventory command binding is invalid.", 503);
  }
}

export function createWorkspaceInventoryService({ store, readinessClient, sourceClient, clock = () => new Date(), audit }) {
  async function transition(transaction, record, status, details = null) {
    transaction.assertHeld();
    record.status = status;
    record.failure = null;
    record.history.push({ sequence: record.history.length + 1, at: clock().toISOString(), status, details });
    await transaction.put(record);
  }

  async function submit({ callerId, input }) {
    const evaluation = createInventoryEvaluation(input, callerId);
    const binding = inventoryDigest({ caller_id: callerId, evaluation });
    return store.transact(async (transaction) => {
      const current = transaction.get(input.request.request_id);
      if (current) {
        assertCaller(current, callerId);
        if (current.binding_digest !== binding) throw inventoryError("idempotency_conflict", "Request identity is bound to different promotion input.");
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
        readback: null,
        receipt: null,
        failure: null,
        history: [{ sequence: 1, at: clock().toISOString(), status: "accepted", details: null }],
      };
      await transaction.put(record);
      audit?.emit({
        actor: callerId,
        event_type: "workspace.inventory.promotion.accepted",
        outcome: "accepted",
        request_id: record.request.request_id,
        target: record.request.target.record_id,
      });
      return publicResult(record);
    });
  }

  async function prepare({ callerId, input }) {
    const target = preparationTarget(input);
    const state = assertPreparationState(await sourceClient.state(target), target);
    const expectedState = {
      intake_register_digest: state.intake_register_digest,
      active_inventory_digest: state.active_inventory_digest,
      intake_entry_version: state.intake_entry_version,
      intake_entry_digest: state.intake_entry_digest,
      active_record_version: null,
      active_record_digest: null,
    };
    const result = {
      schema_version: 1,
      workflow_id: "workspace-inventory-promotion",
      authority_revision: state.authority_revision,
      target: structuredClone(state.target),
      intake_entry_ref: {
        id: state.target.record_id,
        version: state.intake_entry_version,
        digest: state.intake_entry_digest,
      },
      expected_state: expectedState,
      canonical_authority: {
        repo: "workspace-governance",
        intake_path: "contracts/intake-register.yaml",
        inventory_path: INVENTORY_PATHS[target.kind],
        branch: "main",
      },
      canonical_mutation: false,
    };
    audit?.emit({
      actor: callerId,
      event_type: "workspace.inventory.promotion.preparation.read",
      outcome: "succeeded",
      target: result.target.record_id,
      authority_revision: result.authority_revision,
    });
    return result;
  }

  async function finish(transaction, record, merged) {
    const readback = assertInventory("readback", merged.readback);
    const expected = record.preparation.readback;
    if (readback.authority_state !== "merged-authority" || readback.source_branch !== "main" ||
        readback.intake_entry_present !== false ||
        inventoryDigest(readback.target) !== inventoryDigest(record.request.target) ||
        inventoryDigest(readback.mutation_ref) !== inventoryDigest(inventoryReference(record.preparation.mutation, "mutation")) ||
        inventoryDigest(readback.active_record) !== inventoryDigest(expected.active_record)) {
      throw inventoryError("merged_readback_mismatch", "Merged authority does not match the approved inventory promotion.");
    }
    record.readback = readback;
    record.review = merged.review;
    record.receipt = assertInventory("receipt", bindInventory({
      schema_version: 1,
      artifact_type: "workspace-inventory-promotion-receipt",
      receipt_id: `workspace-inventory-merged:${inventoryDigest({ readback: readback.readback_digest, binding: record.binding_digest }).slice(7)}`,
      request_ref: inventoryReference(record.request, "request"),
      readiness_ref: inventoryReference(record.readiness.readiness, "readiness"),
      mutation_ref: inventoryReference(record.preparation.mutation, "mutation"),
      readback_ref: inventoryReference(readback, "readback"),
      target: record.request.target,
      operator_ref: record.request.operator_ref,
      correlation_ref: record.request.correlation_ref,
      idempotency_key: record.request.idempotency_key,
      completed_at: clock().toISOString(),
      phase: "merged-authority",
      outcome: "succeeded",
    }, "receipt_digest"));
    await transition(transaction, record, "succeeded", {
      merge_commit: merged.review.merge_commit,
      receipt_digest: record.receipt.receipt_digest,
    });
  }

  async function advance({ callerId, requestId, action = "continue" }) {
    if (!["continue", "cancel"].includes(action)) throw inventoryError("action_invalid", "Unsupported inventory action.", 400);
    return store.transact(async (transaction) => {
      const record = transaction.get(requestId);
      assertCaller(record, callerId);
      if (TERMINAL.has(record.status)) return publicResult(record);
      try {
        if (action === "cancel" && record.status !== "cancelling") await transition(transaction, record, "cancelling");
        if (record.status === "cancelling") {
          const outcome = await sourceClient.cancel(record, transaction.assertHeld);
          if (outcome?.readback) await finish(transaction, record, outcome);
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
            record.preparation = await sourceClient.prepare(record, transaction.assertHeld);
            assertInventory("mutation", record.preparation.mutation);
            assertInventory("readback", record.preparation.readback);
            assertInventory("receipt", record.preparation.receipt);
            await transaction.put(record);
          }
          record.review = await sourceClient.openReview(record, transaction.assertHeld);
          await transition(transaction, record, "review-required");
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
          code: typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")
            ? error.code
            : "workspace_inventory_dependency_unavailable",
          retryable: !error?.statusCode || error.statusCode >= 500,
          message: "Inventory promotion could not advance. Inspect the current review or correct the reported dependency before retrying.",
        };
        await transaction.put(record);
        audit?.emit({
          actor: callerId,
          event_type: "workspace.inventory.promotion.advance.failed",
          outcome: record.status,
          request_id: requestId,
          code: record.failure.code,
        });
        if (typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")) throw error;
        throw inventoryError("dependency_unavailable", "An inventory dependency failed; the last durable phase was retained for retry.", 503);
      }
    });
  }

  return {
    async registry({ callerId }) {
      const source = await sourceClient.registry();
      if (!SHA.test(source?.authority_revision) || !Array.isArray(source?.records) || !Array.isArray(source?.eligible_promotions)) {
        throw inventoryError("registry_source_invalid", "Workspace Inventory authority returned an invalid registry projection.", 503);
      }
      const base = {
        schema_version: 1,
        workflow_id: "workspace-inventory-registry",
        authority_revision: source.authority_revision,
        canonical_authority: {
          repo: "workspace-governance",
          branch: "main",
          intake_path: "contracts/intake-register.yaml",
          inventory_paths: {
            repo: INVENTORY_PATHS.repo,
            product: INVENTORY_PATHS.product,
            component: INVENTORY_PATHS.component,
          },
        },
        canonical_mutation: false,
        records: structuredClone(source.records),
        eligible_promotions: structuredClone(source.eligible_promotions),
      };
      const projectionDigest = registryProjectionDigest(base);
      const result = assertInventoryRegistry({
        ...base,
        projection_id: `workspace-inventory-registry:${projectionDigest.slice(7, 31)}`,
        projection_digest: projectionDigest,
        projected_at: clock().toISOString(),
      });
      audit?.emit({
        actor: callerId,
        event_type: "workspace.inventory.registry.read",
        outcome: "succeeded",
        authority_revision: result.authority_revision,
        projection_digest: result.projection_digest,
        record_count: result.records.length,
        eligible_promotion_count: result.eligible_promotions.length,
      });
      return result;
    },
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
