import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
let source = readFileSync(openapiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 };
const object = (properties, required = Object.keys(properties)) => ({
  type: "object", additionalProperties: false, required, properties,
});
const requestSchema = JSON.parse(readFileSync(new URL("contracts/prototype-closure/request.schema.json", root), "utf8"));
function project(value) {
  if (Array.isArray(value)) return value.map(project);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$schema").map(([key, entry]) => [
    key,
    key === "$ref" && entry.startsWith("#/$defs/")
      ? `#/components/schemas/PrototypeClosureRequest/${entry.slice(2)}`
      : project(entry),
  ]));
}
source = upsertOpenApiComponent(source, "PrototypeClosureRequest", project(requestSchema));
source = upsertOpenApiComponent(source, "PrototypeClosurePreparationCommand", object({
  prototype_id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
}));
source = upsertOpenApiComponent(source, "PrototypeClosurePreparation", object({
  schema_version: { const: 1 },
  workflow_id: { const: "prototype-closure" },
  prototype_id: text,
  authority_revision: { type: "string", pattern: "^[0-9a-f]{40}$" },
  expected_state: object({
    source_revision: { type: "string", pattern: "^[0-9a-f]{40}$" },
    record_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    lifecycle: { enum: ["exploring", "candidate", "baseline-approved", "graduating", "retired", "graduated"] },
    source_custody: { enum: ["incubation-repo", "dedicated-owner-repo", "shared-owner-repo", null] },
    design_baseline_ref: { type: ["string", "null"] },
    delivery_packet_ref: { type: ["string", "null"] },
    accepted_delivery_target_receipt_ref: { type: ["string", "null"] },
    retirement_ref: { type: ["string", "null"] },
    project_phase: { type: ["string", "null"] },
  }),
  history: { type: "array", maxItems: 256, items: object({
    event_id: text,
    event_type: { enum: ["delivery-accepted", "source-graduated", "incubation-retired", "incubation-reopened"] },
    request_ref: text,
    expected_source_revision: { type: "string", pattern: "^[0-9a-f]{40}$" },
    previous_lifecycle: { enum: ["exploring", "candidate", "baseline-approved", "graduating", "retired"] },
    observed_lifecycle: { enum: ["exploring", "graduating", "graduated", "retired"] },
    previous_source_custody: { enum: ["incubation-repo", "dedicated-owner-repo", "shared-owner-repo"] },
    observed_source_custody: { enum: ["incubation-repo", "dedicated-owner-repo", "shared-owner-repo"] },
    recorded_at: { type: "string", format: "date-time" },
  }) },
  canonical_authority: object({
    repo: { const: "workspace-prototype-studio" }, branch: { const: "main" }, registry_path: { const: "prototypes.yaml" },
  }),
  canonical_mutation: { const: false },
}));
source = upsertOpenApiComponent(source, "PrototypeClosureCommand", object({
  expected_record_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  request: ref("PrototypeClosureRequest"),
}));
source = upsertOpenApiComponent(source, "PrototypeClosureProjection", {
  type: "object", required: ["schema_version", "workflow_id", "request_id", "prototype_id", "action", "status", "next_action", "canonical_mutation", "runtime_activation"],
  properties: {
    schema_version: { const: 1 }, workflow_id: { const: "prototype-closure" },
    request_id: text, prototype_id: text,
    action: { enum: ["apply-delivery", "graduate-source", "retire-incubation", "reopen-incubation"] },
    status: { enum: ["accepted", "evaluating", "decision-required", "reconciling", "preparing", "review-required", "pending-readback", "pending-runtime-disposition", "cancelling", "succeeded", "denied", "failed"] },
    next_action: text, canonical_mutation: { type: "boolean" }, runtime_activation: { const: false },
  },
});

const request = {
  schema_version: 2, artifact_type: "prototype-closure-request",
  request_id: "prototype-closure-request:sample-tool:apply-delivery", prototype_id: "sample-tool",
  action: "apply-delivery", expected_lifecycle: "baseline-approved",
  expected_source_revision: "a".repeat(40), operator_id: "governance-operations-console",
  correlation_id: "correlation:sample-tool", idempotency_key: "closure:sample-tool",
  accepted_baseline_receipt_ref: "receipt://baseline/sample-tool", target_kind: "new-delivery-epic",
  target_delivery_ref: "openproject://work_packages/900",
  accepted_delivery_target_receipt_ref: "receipt://delivery/target-accepted",
};
const result = {
  schema_version: 1, workflow_id: "prototype-closure", request_id: request.request_id,
  prototype_id: request.prototype_id, action: request.action, status: "accepted",
  next_action: "continue", canonical_mutation: false, runtime_activation: false,
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [
  String(status), { description: "Bounded validation, authorization, conflict, or dependency failure." },
]));
const responses = (success = "200") => ({
  [success]: { description: success === "202" ? "Durable acknowledgement; no Studio mutation." : "Caller-bound Closure workflow projection.",
    content: { "application/json": { schema: ref("PrototypeClosureProjection"), example: result } } },
  ...errors,
});
const common = {
  tags: ["Prototype Closure"],
  security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound Prototype exit coordination. OOS requires current WGCF readiness, verified target or runtime authority, exact-head human review, merged Studio readback, and a terminal receipt. Runtime activation remains disabled.",
  "x-oos-surface": "prototype-closure",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-workflow-family": "prototype-closure",
};
const requestId = { name: "request_id", in: "path", required: true, schema: text };
const body = (description, schema, example) => ({
  required: true, description, content: { "application/json": { schema, example } },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/preparations", {
  post: { ...common, operationId: "preparePrototypeClosure", summary: "Read current Prototype Closure bindings",
    requestBody: body("Read the exact current Studio source binding without mutation.", ref("PrototypeClosurePreparationCommand"), { prototype_id: "sample-tool" }),
    responses: {
      200: { description: "Current committed Studio source binding, without mutation.", content: { "application/json": {
        schema: ref("PrototypeClosurePreparation"),
        example: { schema_version: 1, workflow_id: "prototype-closure", prototype_id: "sample-tool",
          authority_revision: "a".repeat(40), expected_state: {
            source_revision: "a".repeat(40), record_digest: `sha256:${"b".repeat(64)}`,
            lifecycle: "candidate", source_custody: "incubation-repo", design_baseline_ref: null,
            delivery_packet_ref: null, accepted_delivery_target_receipt_ref: null, retirement_ref: null, project_phase: null,
          }, history: [], canonical_authority: { repo: "workspace-prototype-studio", branch: "main", registry_path: "prototypes.yaml" },
          canonical_mutation: false },
      } } }, ...errors,
    } },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/requests", {
  post: { ...common, operationId: "submitPrototypeClosure", summary: "Accept an exact Closure request",
    requestBody: body("Bind the request to the caller, Studio revision, and record digest.", ref("PrototypeClosureCommand"), { request, expected_record_digest: `sha256:${"b".repeat(64)}` }), responses: responses("202") },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/requests/{request_id}", {
  get: { ...common, operationId: "readPrototypeClosure", summary: "Read durable Closure progress", parameters: [requestId], responses: responses() },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/requests/{request_id}/decisions", {
  post: { ...common, operationId: "decidePrototypeClosure", summary: "Record an operator decision", parameters: [requestId],
    requestBody: body("Approve or deny only after current readiness is available.", object({ decision: { enum: ["approve", "deny"] } }), { decision: "approve" }), responses: responses() },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/requests/{request_id}/continue", {
  post: { ...common, operationId: "continuePrototypeClosure", summary: "Continue or reconcile an acknowledged Closure", parameters: [requestId],
    requestBody: body("Advance the caller-bound workflow without replacement inputs.", object({}), {}), responses: responses() },
});
source = upsertOpenApiPath(source, "/v1/prototype-closures/requests/{request_id}/cancel", {
  post: { ...common, operationId: "cancelPrototypeClosure", summary: "Cancel an unmerged Closure request", parameters: [requestId],
    requestBody: body("Request cancellation without replacement inputs; an already merged review remains pending readback.", object({}), {}), responses: responses() },
});

if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Prototype Closure OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log("Prototype Closure OpenAPI projection is current.");
