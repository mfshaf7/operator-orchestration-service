import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCatalogError,
  assertCatalogMutationRequest,
  assertCatalogMutationResult,
  assertCatalogProjectionResult,
  assertRepositoryReadinessReference,
} from "../src/catalog/contracts.js";

const contractRoot = new URL("../contracts/catalog/", import.meta.url);
const digest = `sha256:${"b".repeat(64)}`;
const timestamp = "2026-08-26T00:00:00Z";

function repositoryBinding() {
  return {
    repo_name: "operator-orchestration-service",
    repo_ref: "repo://operator-orchestration-service",
    catalog_value_key: "operator-orchestration-service",
    receipt: {
      receipt_id: "repository-readiness-receipt-1",
      uri: "wgcf://receipts/repository-readiness/repository-readiness-receipt-1.json",
      digest,
      issuer: "workspace-governance-control-fabric",
      target_scope: "repo:operator-orchestration-service",
      outcome: "ready",
      evaluated_at: timestamp,
      generation: 3,
    },
  };
}

function catalogValue(overrides = {}) {
  return {
    catalog_item_id: "owner-repo",
    catalog_value_id: "owner-repo-oos",
    value_key: "operator-orchestration-service",
    label: "Operator Orchestration Service",
    description: "Shared operator workflow broker.",
    lifecycle_state: "admitted",
    usage_count: 1,
    usage_summary: "Used by Delivery Feature 909.",
    evidence_refs: ["repo://operator-orchestration-service"],
    last_projected_at: timestamp,
    parent_catalog_item_id: null,
    parent_catalog_value_key: null,
    repository_binding: repositoryBinding(),
    ...overrides,
  };
}

function projection() {
  return {
    schema_version: 1,
    source_revision: "catalog-version-4",
    projection_status: "ready",
    summary: {
      total_items: 1,
      requestable_count: 1,
      owner_routed_count: 0,
      missing_route_count: 0,
      drift_count: 0,
    },
    groups: [
      {
        group_id: "organization",
        title: "Organization",
        description: "Ownership and repository vocabulary.",
        source_authority: "openproject://projects/workspace-delivery-art",
        expected_route: "/v1/delivery-catalog/owner-repo/mutations",
        route_status: "planned",
        item_ids: ["owner-repo"],
      },
    ],
    items: [
      {
        catalog_item_id: "owner-repo",
        group_id: "organization",
        label: "Owner Repo",
        description: "Admitted repository identity used by Delivery.",
        value_key: "owner_repo",
        source_authority: "workspace-governance-control-fabric",
        backend_route: "/v1/delivery-catalog/owner-repo/mutations",
        owner_route: "governance-operations-console/repository-operation",
        create_authority: "governance-operations-console/repository-operation",
        console_capability: "request",
        gap_status: "console_requestable",
        lifecycle_state: "active",
        usage_count: 1,
        usage_summary: "One active Delivery package uses this Catalog.",
        evidence_refs: ["contract://workspace-governance/repos"],
        last_projected_at: timestamp,
        next_action_label: "Link Repository",
        next_action_detail: "Select an admitted ready Repository record.",
      },
    ],
    values: [catalogValue()],
    projected_at: timestamp,
  };
}

function mutationRequest() {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    idempotency_key: "catalog-owner-repo-oos-version-4",
    source_revision: "catalog-version-4",
    catalog_item_id: "owner-repo",
    mode: "add",
    target_value_id: null,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Link the admitted repository value.",
    },
    draft: {
      value_key: "operator-orchestration-service",
      label: "Operator Orchestration Service",
      description: "Shared operator workflow broker.",
      parent_catalog_value_key: null,
      planning_window_start_date: null,
      planning_window_end_date: null,
      repository_binding: repositoryBinding(),
    },
  };
}

function mutationResult() {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    mutation_id: "catalog-mutation-result-1",
    status: "applied",
    replayed: false,
    applied_at: timestamp,
    applied_by: "operator:workspace-owner",
    value: catalogValue(),
    related_values: [],
    source_revision: "catalog-version-5",
    readback_complete: true,
    receipt: {
      ref: "oos://receipts/catalog-mutation-result-1",
      digest,
    },
  };
}

test("Catalog manifest keeps Repository lifecycle outside Catalog", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", contractRoot), "utf8"),
  );
  assert.equal(manifest.contract_id, "oos.delivery-catalog.v1");
  assert.deepEqual(manifest.capabilities.live, []);
  assert.equal(manifest.authority_guards.repository_creation_allowed, false);
  assert.equal(manifest.authority_guards.repository_lifecycle_mutation_allowed, false);
  assert.equal(manifest.authority_guards.repository_binding_requires_current_readiness, true);
});

test("Repository readiness reference binds one exact admitted repository identity", () => {
  assert.equal(
    assertRepositoryReadinessReference(repositoryBinding()).repo_name,
    "operator-orchestration-service",
  );
  const mismatch = repositoryBinding();
  mismatch.receipt.target_scope = "repo:workspace-governance";
  assert.throws(
    () => assertRepositoryReadinessReference(mismatch),
    ({ code }) => code === "repository_readiness_identity_mismatch",
  );
});

test("Catalog projection preserves semantic Console data without presentation tone", () => {
  const value = projection();
  assert.equal(assertCatalogProjectionResult(value), value);
  const leakedTone = structuredClone(value);
  leakedTone.values[0].tone = "ok";
  assert.throws(
    () => assertCatalogProjectionResult(leakedTone),
    ({ code }) => code === "catalog_contract_invalid",
  );
  const falseCount = structuredClone(value);
  falseCount.summary.total_items = 9;
  assert.throws(
    () => assertCatalogProjectionResult(falseCount),
    ({ code }) => code === "catalog_projection_incoherent",
  );
});

test("runtime image includes the Catalog contract bundle", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(
    dockerfile,
    /COPY --chown=node:node contracts\/catalog \.\/contracts\/catalog/,
  );
});

test("Catalog mutation requires matching operator acceptance and readiness-bound repositories", () => {
  assert.equal(assertCatalogMutationRequest(mutationRequest()).mode, "add");
  const wrongOperator = structuredClone(mutationRequest());
  wrongOperator.acceptance.accepted_by = "system:catalog";
  assert.throws(
    () => assertCatalogMutationRequest(wrongOperator),
    ({ code }) => code === "catalog_operator_acceptance_mismatch",
  );
  const freeTextRepository = structuredClone(mutationRequest());
  freeTextRepository.draft.repository_binding = {
    repo_name: "operator-orchestration-service",
  };
  assert.throws(
    () => assertCatalogMutationRequest(freeTextRepository),
    ({ code }) => code === "catalog_contract_invalid",
  );
});

test("Catalog retirement cannot smuggle a repository lifecycle mutation", () => {
  const retirement = structuredClone(mutationRequest());
  retirement.mode = "retire";
  retirement.target_value_id = "owner-repo-oos";
  assert.throws(
    () => assertCatalogMutationRequest(retirement),
    ({ code }) => code === "catalog_contract_invalid",
  );
});

test("Catalog result requires backend readback and a durable receipt", () => {
  assert.equal(assertCatalogMutationResult(mutationResult()).readback_complete, true);
  const incomplete = structuredClone(mutationResult());
  incomplete.readback_complete = false;
  assert.throws(
    () => assertCatalogMutationResult(incomplete),
    ({ code }) => code === "catalog_contract_invalid",
  );
  assert.equal(
    assertCatalogError({
      schema_version: 1,
      correlation_id: "correlation-1",
      code: "repository_readiness_stale",
      message: "The readiness receipt is older than the current repository generation.",
      retryable: true,
    }).code,
    "repository_readiness_stale",
  );
});
