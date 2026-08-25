import assert from "node:assert/strict";
import test from "node:test";

import { CatalogUpstreamError } from "../src/catalog/http-client.js";
import { CatalogServiceError, createCatalogService } from "../src/catalog/service.js";
import { HttpError } from "../src/errors.js";

const timestamp = "2026-08-26T00:00:00Z";
const digest = `sha256:${"b".repeat(64)}`;

function binding() {
  return {
    repo_name: "operator-orchestration-service",
    repo_ref: "repo://operator-orchestration-service",
    catalog_value_key: "operator-orchestration-service",
    receipt: {
      receipt_id: "repository-readiness-receipt:1234567890abcdef12345678",
      uri: `wgcf://receipts/repository-readiness/repository-readiness-receipt-1234567890abcdef12345678-${"b".repeat(64)}.json`,
      digest,
      issuer: "workspace-governance-control-fabric",
      target_scope: "repo:operator-orchestration-service",
      outcome: "ready",
      evaluated_at: timestamp,
      generation: 1,
    },
  };
}

function item(overrides = {}) {
  return {
    catalog_item_id: "owner-repo",
    group_id: "organization",
    label: "Owner Repo",
    description: "Admitted repository identity used by Delivery.",
    value_key: "owner_repo",
    source_authority: "workspace-governance-control-fabric",
    backend_route: "/v1/delivery-catalog/owner-repo/mutations",
    owner_route: "repository-operation",
    create_authority: "repository-operation",
    console_capability: "request",
    gap_status: "console_requestable",
    lifecycle_state: "active",
    usage_count: 0,
    usage_summary: "No Delivery package uses this Catalog value yet.",
    evidence_refs: ["contract://workspace-governance/repos"],
    last_projected_at: timestamp,
    next_action_label: "Link Repository",
    next_action_detail: "Select an admitted Repository record.",
    ...overrides,
  };
}

function value(overrides = {}) {
  return {
    catalog_item_id: "owner-repo",
    catalog_value_id: "owner-repo-oos",
    value_key: "operator-orchestration-service",
    label: "Operator Orchestration Service",
    description: "Shared operator workflow broker.",
    lifecycle_state: "admitted",
    usage_count: 0,
    usage_summary: "No Delivery package uses this value yet.",
    evidence_refs: ["repo://operator-orchestration-service"],
    last_projected_at: timestamp,
    parent_catalog_item_id: null,
    parent_catalog_value_key: null,
    repository_binding: binding(),
    ...overrides,
  };
}

function projection({ revision = "catalog-version-1", values = [] } = {}) {
  return {
    schema_version: 1,
    source_revision: revision,
    projection_status: "ready",
    summary: {
      total_items: 1,
      requestable_count: 1,
      owner_routed_count: 0,
      missing_route_count: 0,
      drift_count: 0,
    },
    groups: [{
      group_id: "organization",
      title: "Organization",
      description: "Ownership vocabulary.",
      source_authority: "openproject://projects/workspace-delivery-art",
      expected_route: "/v1/delivery-catalog/owner-repo/mutations",
      route_status: "implemented",
      item_ids: ["owner-repo"],
    }],
    items: [item()],
    values,
    projected_at: timestamp,
  };
}

function request(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    idempotency_key: "owner-repo-oos-v1",
    source_revision: "catalog-version-1",
    catalog_item_id: "owner-repo",
    mode: "add",
    target_value_id: null,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Link the admitted repository.",
    },
    draft: {
      value_key: "operator-orchestration-service",
      label: "Operator Orchestration Service",
      description: "Shared operator workflow broker.",
      parent_catalog_value_key: null,
      planning_window_start_date: null,
      planning_window_end_date: null,
      repository_binding: binding(),
    },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1",
    correlation_id: "correlation-1",
    mutation_id: "catalog-mutation-result-1",
    status: "applied",
    replayed: false,
    applied_at: timestamp,
    applied_by: "operator:workspace-owner",
    value: value(),
    related_values: [],
    source_revision: "catalog-version-2",
    readback_complete: true,
    receipt: { ref: "openproject://catalog-receipts/1", digest },
    ...overrides,
  };
}

function service({
  after = projection({ revision: "catalog-version-2", values: [value()] }),
  before = projection(),
  mutateResult = result(),
  readinessError = null,
} = {}) {
  const calls = [];
  const projections = [before, after];
  return {
    calls,
    instance: createCatalogService({
      audit: { emit(event) { calls.push({ operation: "audit", event }); } },
      backendClient: {
        async mutate(catalogItemId, mutation) {
          calls.push({ operation: "mutate", catalogItemId, mutation });
          return mutateResult;
        },
        async project() {
          calls.push({ operation: "project" });
          return projections.shift() ?? after;
        },
      },
      readinessClient: {
        async verifyCurrent(reference) {
          calls.push({ operation: "readiness", reference });
          if (readinessError) throw readinessError;
          return reference;
        },
      },
    }),
  };
}

test("Catalog mutation verifies readiness, applies once, and proves canonical readback", async () => {
  const target = service();
  const output = await target.instance.mutate({
    callerId: "operator:workspace-owner",
    catalogItemId: "owner-repo",
    request: request(),
  });
  assert.equal(output.mutation_id, "catalog-mutation-result-1");
  assert.deepEqual(
    target.calls.filter((call) => call.operation !== "audit").map((call) => call.operation),
    ["project", "readiness", "mutate", "project"],
  );
});

test("Catalog mutation fails before write when source revision is stale", async () => {
  const target = service();
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request({ source_revision: "catalog-version-old" }),
    }),
    (error) => error instanceof CatalogServiceError && error.code === "source_revision_stale",
  );
  assert.equal(target.calls.some((call) => call.operation === "mutate"), false);
});

test("Catalog mutation keeps authenticated caller and accepted operator as separate identities", async () => {
  const target = service();
  const output = await target.instance.mutate({
    callerId: "governance-operations-console",
    catalogItemId: "owner-repo",
    request: request(),
  });
  assert.equal(output.applied_by, "operator:workspace-owner");
  assert.equal(
    target.calls.find((call) => call.operation === "audit").event.actor,
    "governance-operations-console",
  );
});

test("Catalog mutation fails closed when repository readiness is stale", async () => {
  const target = service({
    readinessError: new HttpError(409, "repository_readiness_stale", "Authority changed."),
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "repository_readiness_stale" &&
      error.readinessReceiptRef === binding().receipt.uri,
  );
  assert.equal(target.calls.some((call) => call.operation === "mutate"), false);
});

test("Catalog mutation rejects false backend readback", async () => {
  const target = service({
    after: projection({ revision: "catalog-version-2", values: [] }),
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "backend_readback_incomplete",
  );
});

test("Catalog retirement blocks a value still used by Delivery", async () => {
  const used = value({ usage_count: 2, usage_summary: "Used by two records." });
  const before = projection({ values: [used] });
  const target = service();
  target.instance = createCatalogService({
    backendClient: { async project() { return before; }, async mutate() { throw new Error("must not write"); } },
    readinessClient: { async verifyCurrent(reference) { return reference; } },
  });
  const retirement = request({
    mode: "retire",
    target_value_id: used.catalog_value_id,
    draft: { ...request().draft, repository_binding: null },
  });
  await assert.rejects(
    target.instance.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: retirement,
    }),
    (error) => error.code === "catalog_value_in_use",
  );
});

test("Owner Repo retirement does not re-authorize repository lifecycle", async () => {
  const retiredValue = value({ lifecycle_state: "retired", repository_binding: null });
  const target = service({
    after: projection({ revision: "catalog-version-2", values: [retiredValue] }),
    before: projection({ values: [value({ usage_count: 0 })] }),
    mutateResult: result({ value: retiredValue }),
  });
  const retirement = request({
    mode: "retire",
    target_value_id: "owner-repo-oos",
    draft: { ...request().draft, repository_binding: null },
  });

  const output = await target.instance.mutate({
    callerId: "operator:workspace-owner",
    catalogItemId: "owner-repo",
    request: retirement,
  });

  assert.equal(output.value.lifecycle_state, "retired");
  assert.equal(target.calls.some((call) => call.operation === "readiness"), false);
});

test("Catalog backend conflicts are bounded without exposing backend detail", async () => {
  const target = createCatalogService({
    backendClient: {
      async project() { return projection(); },
      async mutate() {
        throw new CatalogUpstreamError(
          "private_backend_conflict",
          "internal table and account detail",
          { statusCode: 409 },
        );
      },
    },
    readinessClient: { async verifyCurrent(reference) { return reference; } },
  });

  await assert.rejects(
    target.mutate({
      callerId: "operator:workspace-owner",
      catalogItemId: "owner-repo",
      request: request(),
    }),
    (error) => error.code === "catalog_conflict" &&
      error.statusCode === 409 &&
      !error.message.includes("internal table"),
  );
});
