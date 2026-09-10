import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";
import { commandFixture } from "../test-fixtures/prototype-maturity/fixture.js";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
let source = readFileSync(openapiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const date = { type: "string", format: "date-time" };
const nullable = (shape) => ({ oneOf: [shape, { type: "null" }] });
const object = (properties, extra = {}) => ({
  type: "object",
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
  ...extra,
});

function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["$schema", "$id"].includes(key))
      .map(([key, entry]) => [
        key,
        key === "$ref" && entry.startsWith("#/$defs/")
          ? `#/components/schemas/${name}/${entry.slice(2)}`
          : project(entry, name),
      ]),
  );
}

const artifactSchemas = {
  PrototypeMaturityRequest: "prototype-maturity-request.schema.json",
  PrototypeMaturityPacket: "prototype-maturity-packet.schema.json",
  PrototypeMaturityReadiness: "prototype-maturity-readiness.schema.json",
  PrototypeMaturityDecision: "prototype-maturity-decision.schema.json",
  PrototypeMaturityReadback: "prototype-maturity-readback.schema.json",
  PrototypeMaturityReceipt: "prototype-maturity-receipt.schema.json",
  PrototypeMaturitySourceResult: "prototype-maturity-source-result.schema.json",
};
const requestSchema = JSON.parse(
  readFileSync(
    new URL("contracts/prototype-maturity/prototype-maturity-request.schema.json", root),
    "utf8",
  ),
);
for (const [name, file] of Object.entries(artifactSchemas)) {
  source = upsertOpenApiComponent(
    source,
    name,
    project(
      JSON.parse(
        readFileSync(new URL(`contracts/prototype-maturity/${file}`, root), "utf8"),
      ),
      name,
    ),
  );
}

const blocker = object({ issue_ref: text, owner_ref: text, required_fix: text });
const schemas = {
  PrototypeMaturityPreparationCommand: object({
    prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" },
    transition: { enum: ["candidate-promotion", "baseline-promotion"] },
  }),
  PrototypeMaturityPreparation: object({
    schema_version: { const: 1 },
    workflow_id: { const: "prototype-maturity" },
    prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" },
    transition: { enum: ["candidate-promotion", "baseline-promotion"] },
    authority_revision: commit,
    expected_state: project(requestSchema.properties.expected_state, "PrototypeMaturityRequest"),
    canonical_authority: object({
      repo: { const: "workspace-prototype-studio" },
      branch: { const: "main" },
      registry_path: { const: "prototypes.yaml" },
    }),
    canonical_mutation: { const: false },
  }),
  PrototypeMaturityCommand: object({
    authority_revision: commit,
    execution_ref: text,
    packet: ref("PrototypeMaturityPacket"),
    request: ref("PrototypeMaturityRequest"),
    session_ref: text,
  }),
  PrototypeMaturityDecisionCommand: {
    type: "object",
    required: ["decision"],
    additionalProperties: false,
    properties: {
      decision: { enum: ["promote-candidate", "block-promotion", "approve-baseline", "block-baseline", "route-closeout"] },
      blocker: blocker,
    },
  },
  PrototypeMaturityReview: object({
    repository: { const: "workspace-prototype-studio" },
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
  PrototypeMaturityReadinessEnvelope: object({
    readiness: ref("PrototypeMaturityReadiness"),
    ledger: object({
      resolution: { enum: ["created", "reused", "read"] },
      state: { enum: ["durable", "expired"] },
      ref: object({ uri: text, digest }),
      authority_revision: commit,
      contract_digest: digest,
      implementation_ref: commit,
      service_identity_ref: text,
      policy_version: text,
      expires_at: date,
    }),
  }),
  PrototypeMaturitySourcePreparation: object({
    branch: text,
    base_commit: commit,
    file_count: { type: "integer", minimum: 0, maximum: 8 },
    changed_paths: { type: "array", maxItems: 8, uniqueItems: true, items: text },
    content_digest: digest,
    source_result: ref("PrototypeMaturitySourceResult"),
    readback: nullable(ref("PrototypeMaturityReadback")),
  }),
  PrototypeMaturityFailure: object({
    code: text,
    retryable: { type: "boolean" },
    message: text,
  }),
  PrototypeMaturityHistoryEvent: object({
    sequence: { type: "integer", minimum: 1 },
    at: date,
    status: text,
    details: nullable({ type: "object", additionalProperties: true }),
  }),
  PrototypeMaturityResult: object({
    schema_version: { const: 1 },
    workflow_id: { const: "prototype-maturity" },
    request_id: text,
    prototype_id: { type: "string", pattern: "^prototype:[a-z0-9][a-z0-9._-]*$" },
    transition: { enum: ["candidate-promotion", "baseline-promotion"] },
    session_ref: text,
    execution_ref: text,
    status: { enum: ["accepted", "evaluating", "decision-required", "preparing", "review-required", "cancelling", "cancelled", "rejected", "requires-action", "blocked", "routed-closeout", "succeeded"] },
    next_action: text,
    revision: { type: "integer", minimum: 1 },
    request: ref("PrototypeMaturityRequest"),
    packet: ref("PrototypeMaturityPacket"),
    readiness: nullable(ref("PrototypeMaturityReadinessEnvelope")),
    decision: nullable(ref("PrototypeMaturityDecision")),
    preparation: nullable(ref("PrototypeMaturitySourcePreparation")),
    review: nullable(ref("PrototypeMaturityReview")),
    readback: nullable(ref("PrototypeMaturityReadback")),
    receipt: nullable(ref("PrototypeMaturityReceipt")),
    failure: nullable(ref("PrototypeMaturityFailure")),
    history: { type: "array", minItems: 1, items: ref("PrototypeMaturityHistoryEvent") },
    canonical_mutation: { type: "boolean" },
    runtime_activation: { const: false },
  }),
};
for (const [name, schema] of Object.entries(schemas)) {
  source = upsertOpenApiComponent(source, name, schema);
}

const input = commandFixture();
const example = {
  schema_version: 1,
  workflow_id: "prototype-maturity",
  request_id: input.request.request_id,
  prototype_id: input.request.prototype_id,
  transition: input.request.transition,
  session_ref: input.session_ref,
  execution_ref: input.execution_ref,
  status: "accepted",
  next_action: "continue",
  revision: 1,
  request: input.request,
  packet: input.packet,
  readiness: null,
  decision: null,
  preparation: null,
  review: null,
  readback: null,
  receipt: null,
  failure: null,
  history: [{ sequence: 1, at: input.request.requested_at, status: "accepted", details: null }],
  canonical_mutation: false,
  runtime_activation: false,
};
const errorResponses = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 502, 503].map((status) => [
    String(status),
    { description: "Bounded validation, authorization, conflict or dependency failure." },
  ]),
);
const responses = (success = "200") => ({
  [success]: {
    description: success === "202"
      ? "Durable acknowledgement; no source mutation yet."
      : "Caller-owned durable maturity projection.",
    content: { "application/json": { schema: ref("PrototypeMaturityResult"), example } },
  },
  ...errorResponses,
});
const common = {
  tags: ["Prototype Maturity"],
  security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound Candidate and Baseline Promotion coordination. OOS owns durable progression, decision binding and receipts but not Prototype source truth, readiness policy, runtime, Delivery, Security or publication authority.",
  "x-oos-surface": "prototype-maturity",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-workflow-family": "prototype-maturity",
};
const requestId = { name: "request_id", in: "path", required: true, schema: text };
const preparationExample = {
  schema_version: 1,
  workflow_id: "prototype-maturity",
  prototype_id: input.request.prototype_id,
  transition: input.request.transition,
  authority_revision: input.authority_revision,
  expected_state: input.request.expected_state,
  canonical_authority: { repo: "workspace-prototype-studio", branch: "main", registry_path: "prototypes.yaml" },
  canonical_mutation: false,
};
source = upsertOpenApiPath(source, "/v1/prototype-maturity/preparations", {
  post: {
    ...common,
    operationId: "preparePrototypeMaturity",
    summary: "Read current Prototype maturity bindings",
    requestBody: { required: true, description: "Identify the Prototype and transition whose current committed source binding should be read without mutation.", content: { "application/json": { schema: ref("PrototypeMaturityPreparationCommand"), example: { prototype_id: input.request.prototype_id, transition: input.request.transition } } } },
    responses: { "200": { description: "Current committed maturity bindings without mutation.", content: { "application/json": { schema: ref("PrototypeMaturityPreparation"), example: preparationExample } } }, ...errorResponses },
  },
});
source = upsertOpenApiPath(source, "/v1/prototype-maturity/requests", {
  post: {
    ...common,
    operationId: "submitPrototypeMaturity",
    summary: "Accept one immutable maturity request and packet",
    requestBody: { required: true, description: "Submit one exact maturity request and evidence packet against the current Prototype Studio revision.", content: { "application/json": { schema: ref("PrototypeMaturityCommand"), example: input } } },
    responses: responses("202"),
  },
});
source = upsertOpenApiPath(source, "/v1/prototype-maturity/requests/{request_id}", {
  get: { ...common, operationId: "readPrototypeMaturity", summary: "Read durable maturity progress and evidence", parameters: [requestId], responses: responses() },
});
source = upsertOpenApiPath(source, "/v1/prototype-maturity/requests/{request_id}/decisions", {
  post: {
    ...common,
    operationId: "decidePrototypeMaturity",
    summary: "Record the operator maturity decision",
    parameters: [requestId],
    requestBody: { required: true, description: "Record the explicit operator decision after current WGCF readiness is available.", content: { "application/json": { schema: ref("PrototypeMaturityDecisionCommand"), example: { decision: "promote-candidate" } } } },
    responses: responses(),
  },
});
for (const action of ["continue", "cancel"]) {
  source = upsertOpenApiPath(source, `/v1/prototype-maturity/requests/{request_id}/${action}`, {
    post: {
      ...common,
      operationId: `${action}PrototypeMaturity`,
      summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged maturity request`,
      parameters: [requestId],
      requestBody: { required: true, description: `${action === "cancel" ? "Cancel" : "Continue"} the caller-bound request without accepting replacement workflow data.`, content: { "application/json": { schema: object({}), example: {} } } },
      responses: responses(),
    },
  });
}

if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) {
    throw new Error("Prototype Maturity OpenAPI projection is stale.");
  }
} else {
  writeFileSync(openapiPath, source);
}
console.log("Prototype Maturity OpenAPI projection is current.");
