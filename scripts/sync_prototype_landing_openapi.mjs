import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { commandFixture } from "../test-fixtures/prototype-landing/fixture.js";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
let source = readFileSync(openapiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const date = { type: "string", format: "date-time" };
const nullable = (shape) => ({ oneOf: [shape, { type: "null" }] });
const object = (properties, extra = {}) => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties, ...extra });

function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "$id"].includes(key)).map(([key, entry]) => [key,
    key === "$ref" && entry.startsWith("#/$defs/") ? `#/components/schemas/${name}/${entry.slice(2)}` : project(entry, name),
  ]));
}

const artifactSchemas = {
  PrototypeLandingEntryPacket: "prototype-landing-entry-packet.schema.json",
  PrototypeLandingRequest: "prototype-landing-request.schema.json",
  PrototypeLandingPlan: "prototype-landing-plan.schema.json",
  PrototypeLandingReadiness: "prototype-landing-readiness.schema.json",
  PrototypeLandingApply: "prototype-landing-apply.schema.json",
  PrototypeLandingReadback: "prototype-landing-readback.schema.json",
  PrototypeLandingReceipt: "prototype-landing-receipt.schema.json",
};
const requestSchema = JSON.parse(readFileSync(new URL("contracts/prototype-landing/prototype-landing-request.schema.json", root), "utf8"));
for (const [name, file] of Object.entries(artifactSchemas)) {
  source = upsertOpenApiComponent(source, name, project(JSON.parse(readFileSync(new URL(`contracts/prototype-landing/${file}`, root), "utf8")), name));
}

const schemas = {
  PrototypeLandingPreparationCommand: object({ prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" } }),
  PrototypeLandingPreparation: object({
    schema_version: { const: 1 },
    workflow_id: { const: "prototype-landing" },
    prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" },
    authority_revision: commit,
    expected_state: project(requestSchema.properties.expected_state, "PrototypeLandingRequest"),
    canonical_authority: object({ repo: { const: "workspace-prototype-studio" }, branch: { const: "main" }, registry_path: { const: "prototypes.yaml" } }),
    canonical_mutation: { const: false },
  }),
  PrototypeLandingCommand: object({
    authority_revision: commit,
    entry_packet: ref("PrototypeLandingEntryPacket"),
    request: ref("PrototypeLandingRequest"),
    plan: ref("PrototypeLandingPlan"),
    operator_approval_ref: text,
    session_ref: text,
    execution_ref: text,
  }),
  PrototypeLandingReview: object({
    repository: { const: "workspace-prototype-studio" }, number: { type: "integer", minimum: 1 }, url: { type: "string", format: "uri" }, state: { enum: ["open", "closed"] },
    branch: text, base_branch: { const: "main" }, base_commit: commit, head_commit: commit,
    merged: { type: "boolean" }, merge_commit: nullable(commit), human_reviewed: { type: "boolean" },
  }),
  PrototypeLandingReadinessEnvelope: object({
    readiness: ref("PrototypeLandingReadiness"),
    ledger: object({
      resolution: { enum: ["created", "reused", "read"] }, state: { enum: ["durable", "expired"] },
      ref: object({ uri: text, digest }), authority_revision: commit, contract_digest: digest,
      implementation_ref: commit, service_identity_ref: text, policy_version: text, expires_at: date,
    }),
  }),
  PrototypeLandingSourcePreparation: object({
    branch: text, base_commit: commit, file_count: { type: "integer", minimum: 1, maximum: 520 },
    changed_paths: { type: "array", minItems: 1, maxItems: 520, uniqueItems: true, items: text }, content_digest: digest,
    readback: ref("PrototypeLandingReadback"), receipt: ref("PrototypeLandingReceipt"),
  }),
  PrototypeLandingFailure: object({ code: text, retryable: { type: "boolean" }, message: text }),
  PrototypeLandingHistoryEvent: object({ sequence: { type: "integer", minimum: 1 }, at: date, status: text, details: nullable({ type: "object", additionalProperties: true }) }),
  PrototypeLandingResult: object({
    schema_version: { const: 1 }, workflow_id: { const: "prototype-landing" }, request_id: text,
    prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" }, session_ref: text, execution_ref: text,
    status: { enum: ["accepted", "evaluating", "preparing", "review-required", "cancelling", "cancelled", "rejected", "requires-action", "succeeded"] },
    next_action: { enum: ["continue", "review-and-merge", "complete", "submit-corrected-request", "candidate-promotion", "restore-dependency-and-retry", "inspect-review-or-cancel"] },
    revision: { type: "integer", minimum: 1 }, entry_packet: ref("PrototypeLandingEntryPacket"), request: ref("PrototypeLandingRequest"), plan: ref("PrototypeLandingPlan"),
    readiness: nullable(ref("PrototypeLandingReadinessEnvelope")), apply: nullable(ref("PrototypeLandingApply")), preparation: nullable(ref("PrototypeLandingSourcePreparation")),
    review: nullable(ref("PrototypeLandingReview")), readback: nullable(ref("PrototypeLandingReadback")), receipt: nullable(ref("PrototypeLandingReceipt")), failure: nullable(ref("PrototypeLandingFailure")),
    history: { type: "array", minItems: 1, items: ref("PrototypeLandingHistoryEvent") }, canonical_mutation: { type: "boolean" }, runtime_activation: { const: false },
  }),
};
for (const [name, schema] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, schema);

const input = commandFixture();
const example = {
  schema_version: 1, workflow_id: "prototype-landing", request_id: input.request.request_id, prototype_id: input.request.prototype.id,
  session_ref: input.session_ref, execution_ref: input.execution_ref, status: "accepted", next_action: "continue", revision: 1,
  entry_packet: input.entry_packet, request: input.request, plan: input.plan, readiness: null, apply: null, preparation: null,
  review: null, readback: null, receipt: null, failure: null,
  history: [{ sequence: 1, at: input.request.requested_at, status: "accepted", details: null }], canonical_mutation: false, runtime_activation: false,
};
const errorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization, conflict or dependency failure." }]));
const responses = (success = "200") => ({
  [success]: { description: success === "202" ? "Durable acknowledgement; no source mutation yet." : "Caller-owned durable Landing projection.", content: { "application/json": { schema: ref("PrototypeLandingResult"), example } } },
  ...errorResponses,
});
const common = {
  tags: ["Prototype Landing"], security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound Prototype Landing coordination. OOS owns durable progression but not Prototype source truth, readiness policy, runtime activation, lifecycle promotion or direct-main mutation.",
  "x-oos-surface": "prototype-landing", "x-oos-primary-caller": "governance-operations-console", "x-oos-owner": "operator-orchestration-service", "x-oos-workflow-family": "prototype-landing",
};
const requestId = { name: "request_id", in: "path", required: true, schema: text };
const preparationExample = {
  schema_version: 1, workflow_id: "prototype-landing", prototype_id: input.request.prototype.id, authority_revision: input.authority_revision,
  expected_state: input.request.expected_state, canonical_authority: { repo: "workspace-prototype-studio", branch: "main", registry_path: "prototypes.yaml" }, canonical_mutation: false,
};
source = upsertOpenApiPath(source, "/v1/prototype-landings/preparations", { post: { ...common, operationId: "preparePrototypeLanding", summary: "Read current Prototype Studio Landing bindings", requestBody: { required: true, description: "Identify the Prototype Studio record whose current committed Landing bindings should be read without mutation.", content: { "application/json": { schema: ref("PrototypeLandingPreparationCommand"), example: { prototype_id: input.request.prototype.id } } } }, responses: { "200": { description: "Current committed bindings without mutation.", content: { "application/json": { schema: ref("PrototypeLandingPreparation"), example: preparationExample } } }, ...errorResponses } } });
source = upsertOpenApiPath(source, "/v1/prototype-landings", { post: { ...common, operationId: "submitPrototypeLanding", summary: "Accept one immutable Prototype Landing command", requestBody: { required: true, description: "Submit the exact operator-approved Entry, Request and Plan chain against its committed Prototype Studio revision.", content: { "application/json": { schema: ref("PrototypeLandingCommand"), example: input } } }, responses: responses("202") } });
source = upsertOpenApiPath(source, "/v1/prototype-landings/{request_id}", { get: { ...common, operationId: "readPrototypeLanding", summary: "Read durable Prototype Landing progress and evidence", parameters: [requestId], responses: responses() } });
for (const action of ["continue", "cancel"]) source = upsertOpenApiPath(source, `/v1/prototype-landings/{request_id}/${action}`, { post: { ...common, operationId: `${action}PrototypeLanding`, summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged Prototype Landing`, parameters: [requestId], requestBody: { required: true, description: `${action === "cancel" ? "Cancel" : "Continue"} the caller-bound request without accepting replacement workflow data.`, content: { "application/json": { schema: object({}), example: {} } } }, responses: responses() } });

if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Prototype Landing OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log("Prototype Landing OpenAPI projection is current.");
