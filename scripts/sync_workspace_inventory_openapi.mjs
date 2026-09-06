import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { at, inputFixture, lifecycleInputFixture, readinessFixture, registryFixture } from "../test-fixtures/workspace-inventory/fixture.js";
import { createInventoryEvaluation } from "../src/workspace-inventory/contracts.js";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
let source = readFileSync(openapiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 };
const nullable = (shape) => ({ oneOf: [shape, { type: "null" }] });
const object = (properties) => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties });
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const date = { type: "string", format: "date-time" };
const targetName = { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" };

function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "$id"].includes(key))
    .map(([key, entry]) => [
      key,
      key === "$ref" && entry.startsWith("#/$defs/")
        ? `#/components/schemas/${name}/${entry.slice(2)}`
        : project(entry, name),
    ]));
}

for (const kind of ["request", "readiness", "mutation", "readback", "receipt"]) {
  const name = `WorkspaceInventory${kind[0].toUpperCase()}${kind.slice(1)}`;
  const schema = JSON.parse(readFileSync(new URL(`contracts/workspace-inventory/${kind}.schema.json`, root), "utf8"));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
for (const kind of ["request", "readiness", "mutation", "readback", "receipt"]) {
  const name = `WorkspaceInventoryLifecycle${kind[0].toUpperCase()}${kind.slice(1)}`;
  const schema = JSON.parse(readFileSync(new URL(`contracts/workspace-inventory/lifecycle-${kind}.schema.json`, root), "utf8"));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
source = upsertOpenApiComponent(
  source,
  "WorkspaceInventoryRegistry",
  project(
    JSON.parse(readFileSync(new URL("contracts/workspace-inventory/registry.schema.json", root), "utf8")),
    "WorkspaceInventoryRegistry",
  ),
);

const schemas = {
  WorkspaceInventoryPreparationCommand: object({
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName }),
  }),
  WorkspaceInventoryPreparation: object({
    schema_version: { const: 1 },
    workflow_id: { const: "workspace-inventory-promotion" },
    authority_revision: commit,
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName, record_id: text }),
    intake_entry_ref: object({ id: text, version: { type: "integer", minimum: 1 }, digest }),
    expected_state: ref("WorkspaceInventoryRequest/$defs/state"),
    canonical_authority: object({ repo: { const: "workspace-governance" }, intake_path: text, inventory_path: text, branch: { const: "main" } }),
    canonical_mutation: { const: false },
  }),
  WorkspaceInventoryCommand: object({
    request: ref("WorkspaceInventoryRequest"),
    authority_revision: commit,
    session_ref: text,
    execution_ref: text,
  }),
  WorkspaceInventoryReview: object({
    repository: { const: "workspace-governance" },
    number: { type: "integer", minimum: 1 },
    url: { type: "string", format: "uri" },
    state: { enum: ["open", "closed"] },
    branch: text,
    base_branch: { const: "main" },
    base_commit: commit,
    head_commit: commit,
    merged: { type: "boolean" },
    merge_commit: nullable(commit),
    human_reviewed: { type: "boolean" },
  }),
  WorkspaceInventoryReadinessEnvelope: object({
    readiness: ref("WorkspaceInventoryReadiness"),
    ledger: object({
      state: { const: "durable" },
      resolution: { enum: ["created", "reused", "read"] },
      ref: object({ uri: text, digest }),
    }),
  }),
  WorkspaceInventoryResult: object({
    schema_version: { const: 1 },
    workflow_id: { const: "workspace-inventory-promotion" },
    request_id: text,
    session_ref: text,
    execution_ref: text,
    status: { enum: ["accepted", "evaluating", "preparing", "review-required", "cancelling", "cancelled", "rejected", "blocked", "stale", "succeeded"] },
    next_action: { enum: ["continue", "review-and-merge", "complete", "submit-corrected-promotion", "refresh-and-resubmit", "restore-dependency-and-retry", "inspect-review-or-cancel"] },
    revision: { type: "integer", minimum: 1 },
    request: ref("WorkspaceInventoryRequest"),
    readiness: nullable(ref("WorkspaceInventoryReadinessEnvelope")),
    review: nullable(ref("WorkspaceInventoryReview")),
    readback: nullable(ref("WorkspaceInventoryReadback")),
    receipt: nullable(ref("WorkspaceInventoryReceipt")),
    failure: nullable(object({ code: text, retryable: { type: "boolean" }, message: text })),
    history: {
      type: "array",
      minItems: 1,
      items: object({
        sequence: { type: "integer", minimum: 1 },
        at: date,
        status: text,
        details: nullable({ type: "object", additionalProperties: true }),
      }),
    },
    canonical_mutation: { type: "boolean" },
  }),
};
for (const [name, schema] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, schema);

const lifecycleSchemas = {
  WorkspaceInventoryLifecyclePreparationCommand: object({
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName }),
  }),
  WorkspaceInventoryLifecyclePreparation: object({
    schema_version: { const: 1 },
    workflow_id: { const: "workspace-inventory-lifecycle" },
    authority_revision: commit,
    target: ref("WorkspaceInventoryLifecycleRequest/$defs/target"),
    expected_state: ref("WorkspaceInventoryLifecycleRequest/$defs/expectedState"),
    current_record: { type: "object", minProperties: 1 },
    latest_event_ref: nullable(ref("WorkspaceInventoryLifecycleRequest/$defs/artifactRef")),
    canonical_authority: object({
      repo: { const: "workspace-governance" },
      inventory_path: text,
      history_path: { const: "contracts/workspace-inventory-history.yaml" },
      branch: { const: "main" },
    }),
    canonical_mutation: { const: false },
  }),
  WorkspaceInventoryLifecycleCommand: object({
    request: ref("WorkspaceInventoryLifecycleRequest"),
    authority_revision: commit,
    session_ref: text,
    execution_ref: text,
  }),
  WorkspaceInventoryLifecycleReadinessEnvelope: object({
    readiness: ref("WorkspaceInventoryLifecycleReadiness"),
    ledger: object({
      state: { const: "durable" },
      resolution: { enum: ["created", "reused", "read"] },
      ref: object({ uri: text, digest }),
    }),
  }),
  WorkspaceInventoryLifecycleMergedState: object({
    authority_revision: commit,
    observed_at: date,
    target: ref("WorkspaceInventoryLifecycleRequest/$defs/target"),
    action: { enum: ["update", "suspend", "restore", "retire"] },
    active_inventory_digest: digest,
    history_digest: digest,
    record: { type: "object", minProperties: 1 },
    history_event_ref: ref("WorkspaceInventoryLifecycleRequest/$defs/artifactRef"),
  }),
  WorkspaceInventoryLifecycleResult: object({
    schema_version: { const: 1 },
    workflow_id: { const: "workspace-inventory-lifecycle" },
    request_id: text,
    session_ref: text,
    execution_ref: text,
    status: { enum: ["accepted", "evaluating", "preparing", "review-required", "cancelling", "cancelled", "rejected", "blocked", "stale", "succeeded"] },
    next_action: { enum: ["continue", "review-and-merge", "complete", "submit-corrected-request", "refresh-and-resubmit", "restore-dependency-and-retry", "inspect-review-or-cancel"] },
    revision: { type: "integer", minimum: 1 },
    request: ref("WorkspaceInventoryLifecycleRequest"),
    readiness: nullable(ref("WorkspaceInventoryLifecycleReadinessEnvelope")),
    review: nullable(ref("WorkspaceInventoryReview")),
    readback: nullable(ref("WorkspaceInventoryLifecycleReadback")),
    receipt: nullable(ref("WorkspaceInventoryLifecycleReceipt")),
    merged_state: nullable(ref("WorkspaceInventoryLifecycleMergedState")),
    failure: nullable(object({ code: text, retryable: { type: "boolean" }, message: text })),
    history: {
      type: "array",
      minItems: 1,
      items: object({
        sequence: { type: "integer", minimum: 1 },
        at: date,
        status: text,
        details: nullable({ type: "object", additionalProperties: true }),
      }),
    },
    canonical_mutation: { type: "boolean" },
  }),
};
for (const [name, schema] of Object.entries(lifecycleSchemas)) source = upsertOpenApiComponent(source, name, schema);

const input = inputFixture();
const evaluation = createInventoryEvaluation(input, input.request.operator_ref);
const readiness = readinessFixture(evaluation);
const example = {
  schema_version: 1,
  workflow_id: "workspace-inventory-promotion",
  request_id: input.request.request_id,
  session_ref: input.session_ref,
  execution_ref: input.execution_ref,
  status: "accepted",
  next_action: "continue",
  revision: 1,
  request: input.request,
  readiness: null,
  review: null,
  readback: null,
  receipt: null,
  failure: null,
  history: [{ sequence: 1, at, status: "accepted", details: null }],
  canonical_mutation: false,
};
const responses = (success = "200") => ({
  [success]: {
    description: success === "202" ? "Durable acknowledgement; not canonical promotion." : "Durable workflow projection.",
    content: { "application/json": { schema: ref("WorkspaceInventoryResult"), example } },
  },
  ...Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), {
    description: "Bounded validation, authorization, conflict or dependency failure.",
  }])),
});
const common = {
  tags: ["Workspace Inventory"],
  security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound active-inventory promotion. OOS prepares and coordinates; WGCF evaluates; only reviewed merged Workspace Governance source is canonical.",
  "x-oos-surface": "workspace-inventory",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-workflow-family": "workspace-inventory-promotion",
};
const requestId = { name: "request_id", in: "path", required: true, schema: text };
const preparationInput = { target: { kind: input.request.target.kind, name: input.request.target.name } };
const preparationExample = {
  schema_version: 1,
  workflow_id: "workspace-inventory-promotion",
  authority_revision: input.authority_revision,
  target: input.request.target,
  intake_entry_ref: input.request.intake_entry_ref,
  expected_state: input.request.expected_state,
  canonical_authority: {
    repo: "workspace-governance",
    intake_path: "contracts/intake-register.yaml",
    inventory_path: "contracts/components.yaml",
    branch: "main",
  },
  canonical_mutation: false,
};
source = upsertOpenApiPath(source, "/v1/workspace-inventory/registry", { get: {
  ...common,
  operationId: "readWorkspaceInventoryRegistry",
  summary: "Read canonical active inventory and eligible promotions",
  description: "Caller-authenticated, non-mutating projection of the exact committed Workspace Governance inventories and admitted promotion candidates. The projection does not create workflow state or authorize a promotion.",
  responses: {
    "200": {
      description: "Current canonical registry projection; no workflow or authority state changed.",
      content: { "application/json": { schema: ref("WorkspaceInventoryRegistry"), example: registryFixture() } },
    },
    ...Object.fromEntries([401, 403, 502, 503].map((status) => [String(status), { description: "Bounded authorization or authority dependency failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-inventory/preparations", { post: {
  ...common,
  operationId: "prepareWorkspaceInventoryPromotion",
  summary: "Read current promotion bindings for one admitted entrant",
  description: "Non-mutating preparation from current committed Workspace Governance source. Missing intake or existing active inventory is rejected as the wrong operation.",
  requestBody: {
    required: true,
    description: "Canonical target whose current promotion bindings should be read without mutation.",
    content: { "application/json": { schema: ref("WorkspaceInventoryPreparationCommand"), example: preparationInput } },
  },
  responses: {
    "200": { description: "Current canonical promotion bindings; no workflow or authority state changed.", content: { "application/json": { schema: ref("WorkspaceInventoryPreparation"), example: preparationExample } } },
    ...Object.fromEntries([400, 401, 403, 409, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization or dependency failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-inventory/promotions", { post: {
  ...common,
  operationId: "submitWorkspaceInventoryPromotion",
  summary: "Acknowledge one immutable active-inventory promotion",
  requestBody: {
    required: true,
    description: "Immutable promotion request and exact canonical authority bindings.",
    content: { "application/json": { schema: ref("WorkspaceInventoryCommand"), example: input } },
  },
  responses: responses("202"),
} });
source = upsertOpenApiPath(source, "/v1/workspace-inventory/promotions/{request_id}", { get: {
  ...common,
  operationId: "readWorkspaceInventoryPromotion",
  summary: "Read caller-owned promotion progress, review and receipts",
  parameters: [requestId],
  responses: responses(),
} });
for (const action of ["continue", "cancel"]) {
  source = upsertOpenApiPath(source, `/v1/workspace-inventory/promotions/{request_id}/${action}`, { post: {
    ...common,
    operationId: `${action}WorkspaceInventoryPromotion`,
    summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged inventory promotion`,
    parameters: [requestId],
    requestBody: {
      required: true,
      description: `${action === "cancel" ? "Cancellation" : "Continuation"} command with no mutable request fields.`,
      content: { "application/json": { schema: object({}), example: {} } },
    },
    responses: responses(),
  } });
}

const lifecycleFixture = lifecycleInputFixture();
const lifecycleExample = {
  schema_version: 1,
  workflow_id: "workspace-inventory-lifecycle",
  request_id: lifecycleFixture.input.request.request_id,
  session_ref: lifecycleFixture.input.session_ref,
  execution_ref: lifecycleFixture.input.execution_ref,
  status: "accepted",
  next_action: "continue",
  revision: 1,
  request: lifecycleFixture.input.request,
  readiness: null,
  review: null,
  readback: null,
  receipt: null,
  merged_state: null,
  failure: null,
  history: [{ sequence: 1, at, status: "accepted", details: null }],
  canonical_mutation: false,
};
const lifecycleResponses = (success = "200") => ({
  [success]: {
    description: success === "202" ? "Durable acknowledgement; not canonical mutation." : "Durable lifecycle workflow projection.",
    content: { "application/json": { schema: ref("WorkspaceInventoryLifecycleResult"), example: lifecycleExample } },
  },
  ...Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), {
    description: "Bounded validation, authorization, conflict or dependency failure.",
  }])),
});
const lifecycleCommon = {
  tags: ["Workspace Inventory"],
  security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound inventory lifecycle coordination. OOS durably coordinates; WGCF evaluates; only reviewed merged Workspace Governance inventory and append-only history are canonical.",
  "x-oos-surface": "workspace-inventory-lifecycle",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-workflow-family": "workspace-inventory-lifecycle",
};
const lifecycleRequestId = { name: "request_id", in: "path", required: true, schema: text };
const lifecyclePreparationExample = {
  schema_version: 1,
  workflow_id: "workspace-inventory-lifecycle",
  authority_revision: lifecycleFixture.input.authority_revision,
  target: lifecycleFixture.input.request.target,
  expected_state: lifecycleFixture.input.request.expected_state,
  current_record: lifecycleFixture.currentRecord,
  latest_event_ref: null,
  canonical_authority: {
    repo: "workspace-governance",
    inventory_path: "contracts/components.yaml",
    history_path: "contracts/workspace-inventory-history.yaml",
    branch: "main",
  },
  canonical_mutation: false,
};
source = upsertOpenApiPath(source, "/v1/workspace-inventory/lifecycle/preparations", { post: {
  ...lifecycleCommon,
  operationId: "prepareWorkspaceInventoryLifecycle",
  summary: "Read current lifecycle and history bindings for one active record",
  requestBody: {
    required: true,
    description: "Canonical active target whose lifecycle bindings should be read without mutation.",
    content: { "application/json": { schema: ref("WorkspaceInventoryLifecyclePreparationCommand"), example: { target: { kind: "component", name: "inventory-proof" } } } },
  },
  responses: {
    "200": { description: "Current canonical lifecycle bindings; no workflow or authority state changed.", content: { "application/json": { schema: ref("WorkspaceInventoryLifecyclePreparation"), example: lifecyclePreparationExample } } },
    ...Object.fromEntries([400, 401, 403, 409, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization or dependency failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-inventory/lifecycle/requests", { post: {
  ...lifecycleCommon,
  operationId: "submitWorkspaceInventoryLifecycle",
  summary: "Acknowledge one immutable inventory lifecycle request",
  requestBody: {
    required: true,
    description: "Immutable lifecycle request and exact canonical authority bindings.",
    content: { "application/json": { schema: ref("WorkspaceInventoryLifecycleCommand"), example: lifecycleFixture.input } },
  },
  responses: lifecycleResponses("202"),
} });
source = upsertOpenApiPath(source, "/v1/workspace-inventory/lifecycle/requests/{request_id}", { get: {
  ...lifecycleCommon,
  operationId: "readWorkspaceInventoryLifecycle",
  summary: "Read caller-owned lifecycle progress, review and receipts",
  parameters: [lifecycleRequestId],
  responses: lifecycleResponses(),
} });
for (const action of ["continue", "cancel"]) {
  source = upsertOpenApiPath(source, `/v1/workspace-inventory/lifecycle/requests/{request_id}/${action}`, { post: {
    ...lifecycleCommon,
    operationId: `${action}WorkspaceInventoryLifecycle`,
    summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged inventory lifecycle request`,
    parameters: [lifecycleRequestId],
    requestBody: {
      required: true,
      description: `${action === "cancel" ? "Cancellation" : "Continuation"} command with no mutable request fields.`,
      content: { "application/json": { schema: object({}), example: {} } },
    },
    responses: lifecycleResponses(),
  } });
}

if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Workspace Inventory OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log("Workspace Inventory OpenAPI projection is current.");
