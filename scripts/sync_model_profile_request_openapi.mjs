import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  addConsoleSourceProjectionMedia,
  upsertConsoleCompatibleOpenApiPath,
} from "./console_source_authority_openapi_tools.mjs";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const original = readFileSync(openapiPath, "utf8");
let source = original;
const check = process.argv.includes("--check");
const componentNames = {
  "request.schema.json": "ModelProfileRequest",
  "command.schema.json": "ModelProfileRequestCommand",
  "fulfillment.schema.json": "ModelProfileRequestFulfillment",
  "receipt.schema.json": "ModelProfileRequestReceipt",
  "projection.schema.json": "ModelProfileRequestProjection",
};
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function project(value, currentName) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, currentName));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["$schema", "$id"].includes(key))
      .map(([key, entry]) => {
        if (key !== "$ref") return [key, project(entry, currentName)];
        if (entry.startsWith("#/$defs/")) {
          return [key, `#/components/schemas/${currentName}/$defs/${entry.slice(8)}`];
        }
        const [file, suffix] = entry.split("#");
        const target = componentNames[file];
        if (!target) throw new Error(`Unknown model-profile schema reference: ${entry}`);
        return [
          key,
          suffix?.startsWith("/$defs/")
            ? `#/components/schemas/${target}/$defs/${suffix.slice(7)}`
            : `#/components/schemas/${target}`,
        ];
      }),
  );
}

for (const [file, name] of Object.entries(componentNames)) {
  const schema = JSON.parse(readFileSync(
    new URL(`contracts/model-profile-request/${file}`, root),
    "utf8",
  ));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
source = upsertOpenApiComponent(source, "ModelProfileRequestList", {
  type: "object",
  required: ["schema_version", "requests", "next_cursor"],
  additionalProperties: false,
  properties: {
    schema_version: { const: 1 },
    requests: { type: "array", items: ref("ModelProfileRequestProjection") },
    next_cursor: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
});

const artifact = (name) => ({ uri: `https://example.test/${name}`, digest: `sha256:${"a".repeat(64)}` });
const requestExample = {
  schema_version: 1,
  request_id: "model-profile-request:1203-refinement",
  intent: "create",
  requested_at: "2026-10-09T12:00:00Z",
  operator_id: "operator:mfshaf7",
  profile_intent: {
    profile_id: null,
    source: null,
    display_name: "Bounded refinement assistant",
    intended_purpose: "Produce structured refinement suggestions from admitted context.",
    requesting_owner: "operator-orchestration-service",
    registered_callers: [{ caller_id: "oos-refinement", owner_repo: "operator-orchestration-service" }],
    requested_environments: ["dev-integration"],
    input_data_classification: "internal",
    admitted_context_ref: artifact("context-contract"),
    required_output_schema_ref: { repo: "operator-orchestration-service", path: "contracts/refinement/output.schema.json", version: "v1" },
    human_approval_required: true,
    operational_expectations: ["Fail closed when admitted context is absent."],
    operator_justification: "Needed for the governed refinement workflow.",
  },
  delivery_ref: "openproject://work_packages/1240",
  correlation_id: "delivery-1203",
  causation_id: null,
  idempotency_key: "model-profile-request-1203-refinement-v1",
};
const receiptExample = {
  schema_version: 1,
  receipt_id: "model-profile-receipt:aaaaaaaaaaaaaaaaaaaaaaaa",
  request_id: requestExample.request_id,
  request_revision: 1,
  intent: "create",
  review_state: "draft",
  fulfillment_state: "not-started",
  profile_id: null,
  actor: { caller_id: "governance-operations-console", operator_id: "operator:mfshaf7" },
  routed_owners: { workflow_owner: "operator-orchestration-service", fulfillment_owner: "platform-engineering", security_owner: "security-architecture" },
  delivery_ref: requestExample.delivery_ref,
  source_ref: null,
  prior_receipt_ref: null,
  recorded_at: "2026-10-09T12:00:00Z",
  digest: `sha256:${"b".repeat(64)}`,
};
const historyExample = {
  sequence: 1,
  event_type: "request-created",
  occurred_at: "2026-10-09T12:00:00Z",
  actor_id: "operator:mfshaf7",
  command_id: requestExample.idempotency_key,
  review_state_before: null,
  review_state_after: "draft",
  fulfillment_state_before: null,
  fulfillment_state_after: "not-started",
  summary: "Model-profile request recorded as a draft; no profile lifecycle state changed.",
  receipt_ref: { uri: `oos://model-profile-receipts/${receiptExample.receipt_id}`, digest: receiptExample.digest },
};
const projectionExample = {
  schema_version: 1,
  workflow_id: "model-profile-request",
  request_id: requestExample.request_id,
  revision: 1,
  request: requestExample,
  review_state: "draft",
  fulfillment_state: "not-started",
  requirements: [],
  decision_ref: null,
  fulfillment: null,
  latest_receipt: receiptExample,
  history: [historyExample],
  next_action: "revise-or-submit",
  profile_lifecycle_changed: false,
};
const commandExample = {
  schema_version: 1,
  command_id: "submit-1203-refinement",
  request_id: requestExample.request_id,
  expected_revision: 1,
  action: "submit",
  operator_id: "operator:mfshaf7",
  issued_at: "2026-10-09T12:01:00Z",
  reason: null,
  decision_ref: null,
  requirements: [],
  revised_profile_intent: null,
  idempotency_key: "submit-1203-refinement-v1",
};
const fulfillmentExample = {
  schema_version: 1,
  fulfillment_id: "platform-start-1203-refinement",
  request_id: requestExample.request_id,
  expected_revision: 4,
  state: "implementing",
  actor_id: "platform-engineering",
  recorded_at: "2026-10-09T12:04:00Z",
  source: null,
  receipt_ref: null,
  failure: null,
  idempotency_key: "platform-start-1203-refinement-v1",
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 500, 503].map((status) => [String(status), {
  description: "Bounded validation, authorization, conflict, integrity, or availability failure.",
}]));
const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const metadata = {
  security,
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-surface": "model-profile-request",
  "x-oos-workflow-family": "model-profile-request",
  tags: ["Model Profile Requests"],
};
const requestId = { name: "request_id", in: "path", required: true, schema: { type: "string" } };
const response = (description, schema, example) => ({
  description,
  content: { "application/json": { schema, example } },
});
const requestBody = (description, schema, example) => ({
  required: true,
  description,
  content: { "application/json": { schema, example } },
});

source = upsertOpenApiPath(source, "/v1/model-profile-requests", {
  post: {
    ...metadata,
    operationId: "createModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Create or replay one governed model-profile request",
    description: "Records operator-authored intent and exact source bindings without selecting a provider or changing Platform profile lifecycle state.",
    parameters: [{ name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } }],
    requestBody: requestBody("Record one exact operator-bound request.", ref("ModelProfileRequest"), requestExample),
    responses: { 201: response("Request recorded.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
  get: {
    ...metadata,
    operationId: "listModelProfileRequests",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "List caller-owned model-profile requests",
    description: "Returns bounded caller-owned projections; it does not expose requests owned by another caller.",
    parameters: [
      { name: "cursor", in: "query", schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
    ],
    responses: { 200: response("Caller-owned request projections.", ref("ModelProfileRequestList"), { schema_version: 1, requests: [projectionExample], next_cursor: null }), ...errors },
  },
});

source = upsertConsoleCompatibleOpenApiPath(source, "/v1/model-profile-requests/{request_id}", addConsoleSourceProjectionMedia({
  get: {
    ...metadata,
    operationId: "getModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Read one caller-owned model-profile request",
    description: "Returns current review and fulfillment state, exact next action, immutable receipt coordinates, and an explicit no-lifecycle-mutation marker.",
    parameters: [requestId],
    responses: { 200: response("Current model-profile request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
}, "get"));

source = upsertOpenApiPath(source, "/v1/model-profile-requests/{request_id}/commands", {
  post: {
    ...metadata,
    operationId: "commandModelProfileRequest",
    "x-oos-primary-caller": "governance-operations-console",
    summary: "Apply one revision-bound review command",
    description: "Applies an admitted state transition with exact operator attribution, replay protection, and immutable receipt history.",
    parameters: [requestId, { name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } }],
    requestBody: requestBody("Apply one review command at the exact expected revision.", ref("ModelProfileRequestCommand"), commandExample),
    responses: { 200: response("Updated request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
});

source = upsertOpenApiPath(source, "/v1/model-profile-requests/{request_id}/fulfillment", {
  post: {
    ...metadata,
    operationId: "recordModelProfileRequestFulfillment",
    "x-oos-primary-caller": "platform-engineering",
    summary: "Record one Platform-owned fulfillment update",
    description: "Records implementation evidence from an explicitly admitted Platform caller after approval; it cannot mutate the Platform registry or profile lifecycle itself.",
    parameters: [requestId],
    requestBody: requestBody("Record a revision-bound Platform fulfillment update.", ref("ModelProfileRequestFulfillment"), fulfillmentExample),
    responses: { 200: response("Updated request projection.", ref("ModelProfileRequestProjection"), projectionExample), ...errors },
  },
});

if (check) {
  if (source !== original) throw new Error("Model-profile request OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log(`Model-profile request OpenAPI ${check ? "verified" : "synchronized"}.`);
