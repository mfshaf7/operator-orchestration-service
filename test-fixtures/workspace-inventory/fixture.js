import {
  bindInventory,
  inventoryDigest,
  inventoryManifest,
  inventoryReference,
  registryProjectionDigest,
} from "../../src/workspace-inventory/contracts.js";

export const caller = "operator:test";
export const at = "2026-09-06T12:00:00.000Z";

export function activeValue(name = "inventory-proof") {
  return {
    posture: "active",
    lifecycle: "active",
    component_class: "service",
    owner_repo: "operator-orchestration-service",
    product: null,
    security_owner: "security-architecture",
    validation_behavior: {
      posture: "owner-validation",
      wgcf_graph_role: "workspace-component",
      catalog_refs: [],
      notes: `Validation for ${name}.`,
    },
  };
}

export function inputFixture(revision = "1".repeat(40)) {
  const expectedState = {
    intake_register_digest: inventoryDigest({ schema_version: 2, components: {} }),
    active_inventory_digest: inventoryDigest({ schema_version: 2, components: {} }),
    intake_entry_version: 1,
    intake_entry_digest: inventoryDigest({ status: "admitted" }),
    active_record_version: null,
    active_record_digest: null,
  };
  const target = { kind: "component", name: "inventory-proof", record_id: "component:inventory-proof" };
  const request = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-request",
    request_id: "inventory-request:test",
    requested_at: "2026-09-06T11:00:00Z",
    operator_ref: caller,
    correlation_ref: "delivery:890",
    idempotency_key: "inventory-proof:one",
    target,
    intake_entry_ref: { id: target.record_id, version: 1, digest: expectedState.intake_entry_digest },
    expected_state: expectedState,
    active_record: { kind: "component", id: target.record_id, value: activeValue() },
    approval_refs: ["approval:operator:test"],
  }, "request_digest");
  return {
    request,
    authority_revision: revision,
    session_ref: "session:test",
    execution_ref: "execution:test",
  };
}

export function registryFixture(revision = "1".repeat(40)) {
  const target = { kind: "component", name: "inventory-proof", record_id: "component:inventory-proof" };
  const intakeEntryRef = {
    id: target.record_id,
    version: 1,
    digest: `sha256:${"4".repeat(64)}`,
  };
  const candidate = {
    target,
    intake_entry_ref: intakeEntryRef,
    active_record: { kind: target.kind, id: target.record_id, value: activeValue() },
    owner_refs: ["operator-orchestration-service", "security-architecture"],
    approval_refs: ["approval:operator:test"],
  };
  candidate.candidate_digest = inventoryDigest(candidate);
  const base = {
    schema_version: 1,
    workflow_id: "workspace-inventory-registry",
    authority_revision: revision,
    canonical_authority: {
      repo: "workspace-governance",
      branch: "main",
      intake_path: "contracts/intake-register.yaml",
      inventory_paths: {
        repo: "contracts/repos.yaml",
        product: "contracts/products.yaml",
        component: "contracts/components.yaml",
      },
    },
    canonical_mutation: false,
    records: [],
    eligible_promotions: [candidate],
  };
  const projectionDigest = registryProjectionDigest(base);
  return {
    ...base,
    projection_id: `workspace-inventory-registry:${projectionDigest.slice(7, 31)}`,
    projection_digest: projectionDigest,
    projected_at: at,
  };
}

export function readinessFixture(evaluation, outcome = "ready") {
  const readiness = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-readiness",
    readiness_id: `workspace-inventory-readiness:${evaluation.evaluation_id}`,
    evaluated_at: at,
    request_ref: inventoryReference(evaluation.request, "request"),
    target: evaluation.request.target,
    observed_state: evaluation.request.expected_state,
    policy_ref: {
      id: `workspace-active-inventory@${evaluation.authority_revision}`,
      digest: `sha256:${inventoryManifest.files["workspace-active-inventory.yaml"].sha256}`,
    },
    outcome,
    findings: outcome === "ready" ? [] : [{ code: `promotion-${outcome}`, severity: "blocking", message: `Promotion is ${outcome}.` }],
  }, "readiness_digest");
  return {
    readiness,
    ledger: {
      state: "durable",
      resolution: "read",
      ref: {
        uri: `wgcf://readiness/workspace-inventory/${readiness.readiness_digest.slice(7)}`,
        digest: readiness.readiness_digest,
      },
    },
  };
}

export function preparationFixture(evaluation, readinessResult) {
  const mutation = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-mutation",
    mutation_id: "workspace-inventory-mutation:test:review-branch",
    request_ref: inventoryReference(evaluation.request, "request"),
    readiness_ref: inventoryReference(readinessResult.readiness, "readiness"),
    target: evaluation.request.target,
    source_branch: "inventory/test",
    applied_at: at,
    changes: { intake_entry_removed: true, active_record_added: true, active_record_version: 1 },
  }, "mutation_digest");
  const activeRecord = {
    ...evaluation.request.active_record.value,
    record: {
      id: evaluation.request.target.record_id,
      version: 1,
      lineage: {
        source: "workspace-intake",
        source_ref: evaluation.request.intake_entry_ref.id,
        source_digest: evaluation.request.intake_entry_ref.digest,
        intake_entry_version: evaluation.request.intake_entry_ref.version,
      },
      last_mutation: {
        id: "workspace-inventory-mutation:inventory-proof:one",
        action: "promote",
        idempotency_key: evaluation.request.idempotency_key,
        request_ref: evaluation.request.request_id,
        request_digest: evaluation.request.request_digest,
        readiness_ref: readinessResult.readiness.readiness_id,
        readiness_digest: readinessResult.readiness.readiness_digest,
        applied_at: at,
      },
    },
  };
  const readback = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-readback",
    readback_id: "workspace-inventory-readback:test:review-branch",
    mutation_ref: inventoryReference(mutation, "mutation"),
    target: evaluation.request.target,
    authority_state: "review-branch",
    source_branch: "inventory/test",
    observed_at: at,
    intake_register_digest: inventoryDigest({ empty: true }),
    active_inventory_digest: inventoryDigest({ active: true }),
    intake_entry_present: false,
    active_record: activeRecord,
  }, "readback_digest");
  const receipt = bindInventory({
    schema_version: 1,
    artifact_type: "workspace-inventory-promotion-receipt",
    receipt_id: "workspace-inventory-receipt:test:review-branch",
    request_ref: inventoryReference(evaluation.request, "request"),
    readiness_ref: inventoryReference(readinessResult.readiness, "readiness"),
    mutation_ref: inventoryReference(mutation, "mutation"),
    readback_ref: inventoryReference(readback, "readback"),
    target: evaluation.request.target,
    operator_ref: evaluation.request.operator_ref,
    correlation_ref: evaluation.request.correlation_ref,
    idempotency_key: evaluation.request.idempotency_key,
    completed_at: at,
    phase: "review-branch",
    outcome: "prepared",
  }, "receipt_digest");
  return { mutation, readback, receipt, inventory_path: "contracts/components.yaml" };
}
