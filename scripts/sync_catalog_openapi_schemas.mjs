import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import {
  CATALOG_OPENAPI_SCHEMA_BINDINGS,
  catalogExternalRefMap,
  projectCatalogSchemaForOpenApi,
} from "./catalog_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "catalog");
const schemas = CATALOG_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8")),
}));
const externalRefMap = catalogExternalRefMap(schemas);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projectCatalogSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: spec.components.schemas[componentName],
    }),
  );
}

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCatalogErrorV1" } } },
});
const repositoryBinding = {
  repo_name: "operator-orchestration-service",
  repo_ref: "repo://operator-orchestration-service",
  catalog_value_key: "operator-orchestration-service",
  receipt: {
    receipt_id: "repository-readiness-receipt:1234567890abcdef12345678",
    uri: `wgcf://receipts/repository-readiness/repository-readiness-receipt-1234567890abcdef12345678-${"b".repeat(64)}.json`,
    digest: `sha256:${"b".repeat(64)}`,
    issuer: "workspace-governance-control-fabric",
    target_scope: "repo:operator-orchestration-service",
    outcome: "ready",
    evaluated_at: "2026-08-26T00:00:00Z",
    generation: 1,
  },
};
const catalogValue = {
  catalog_item_id: "owner-repo",
  catalog_value_id: "owner-repo-oos",
  value_key: "operator-orchestration-service",
  label: "Operator Orchestration Service",
  description: "Shared operator workflow broker.",
  lifecycle_state: "admitted",
  usage_count: 0,
  usage_summary: "No Delivery package uses this value yet.",
  evidence_refs: ["repo://operator-orchestration-service"],
  last_projected_at: "2026-08-26T00:00:00Z",
  parent_catalog_item_id: null,
  parent_catalog_value_key: null,
  repository_binding: repositoryBinding,
};
const projectionExample = {
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
  groups: [{
    group_id: "organization",
    title: "Organization",
    description: "Ownership and repository vocabulary.",
    source_authority: "openproject://projects/workspace-delivery-art",
    expected_route: "/v1/delivery-catalog/owner-repo/mutations",
    route_status: "implemented",
    item_ids: ["owner-repo"],
  }],
  items: [{
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
    usage_count: 0,
    usage_summary: "No Delivery package uses this Catalog yet.",
    evidence_refs: ["contract://workspace-governance/repos"],
    last_projected_at: "2026-08-26T00:00:00Z",
    next_action_label: "Link Repository",
    next_action_detail: "Select an admitted ready Repository record.",
  }],
  values: [catalogValue],
  projected_at: "2026-08-26T00:00:00Z",
};
const mutationExample = {
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
    accepted_at: "2026-08-26T00:00:00Z",
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
    repository_binding: repositoryBinding,
  },
};
const mutationResultExample = {
  schema_version: 1,
  request_id: "catalog-mutation-1",
  correlation_id: "correlation-1",
  mutation_id: "catalog-mutation-result-1",
  status: "applied",
  replayed: false,
  applied_at: "2026-08-26T00:00:01Z",
  applied_by: "operator:workspace-owner",
  value: catalogValue,
  related_values: [],
  source_revision: "catalog-version-5",
  readback_complete: true,
  receipt: {
    ref: "openproject://catalog-receipts/catalog-mutation-result-1",
    digest: `sha256:${"c".repeat(64)}`,
  },
};

const paths = {
  "/v1/delivery-catalog/projection": {
    get: {
      tags: ["Delivery Catalog"],
      summary: "Read the canonical Delivery Catalog projection",
      description: "Returns backend-derived Catalog groups, items, values, usage, capabilities, source revision, and evidence without fixture fallback.",
      operationId: "projectDeliveryCatalog",
      security,
      responses: {
        200: {
          description: "Current canonical Catalog projection.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCatalogProjectionV1" }, example: projectionExample } },
        },
        502: errorResponse("Canonical Catalog state could not be projected safely."),
        503: errorResponse("The privileged Catalog control route is inactive or unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-catalog",
    },
  },
  "/v1/delivery-catalog/{catalog_item_id}/mutations": {
    post: {
      tags: ["Delivery Catalog"],
      summary: "Apply one accepted Delivery Catalog mutation",
      description: "Validates current source revision and operator acceptance, re-verifies WGCF repository readiness when applicable, delegates one idempotent canonical mutation, and requires backend readback plus durable evidence.",
      operationId: "mutateDeliveryCatalog",
      security,
      parameters: [{
        name: "catalog_item_id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]*$" },
      }],
      requestBody: {
        required: true,
        description: "Provide one typed Catalog draft, the current source revision, an idempotency key, and explicit operator acceptance.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCatalogMutationRequestV1" }, example: mutationExample } },
      },
      responses: {
        200: {
          description: "Applied or idempotently replayed mutation with canonical readback.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCatalogMutationResultV1" }, example: mutationResultExample } },
        },
        400: errorResponse("Invalid Catalog mutation request."),
        409: errorResponse("Catalog source, value, usage, or repository readiness conflicts with the request."),
        502: errorResponse("Canonical mutation or readback failed."),
        503: errorResponse("Catalog control or readiness authority is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-catalog",
    },
  },
};

for (const [route, pathItem] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, route, pathItem);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Catalog schemas or paths are stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
