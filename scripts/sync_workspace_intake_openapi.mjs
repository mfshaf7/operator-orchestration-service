import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import { upsertConsoleCompatibleOpenApiPath as upsertOpenApiPath } from "./console_source_authority_openapi_tools.mjs";
import { at, inputFixture } from "../test-fixtures/workspace-intake/fixture.js";
import { bindWorkspaceIntakeSourceCandidate } from "../src/workspace-intake/source-candidate.js";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
let source = readFileSync(openapiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 };
const nullable = (shape) => ({ oneOf: [shape, { type: "null" }] });
const object = (properties) => ({ type: "object", required: Object.keys(properties), additionalProperties: false, properties });
const withOptional = (schema, properties) => ({ ...schema, properties: { ...schema.properties, ...properties } });
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const date = { type: "string", format: "date-time" };
const targetName = { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" };
function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "$id"].includes(key)).map(([key, entry]) => [key,
    key === "$ref" && entry.startsWith("#/$defs/") ? `#/components/schemas/${name}/${entry.slice(2)}` : project(entry, name),
  ]));
}
for (const kind of ["request", "decision", "mutation", "readback", "receipt", "readiness"]) {
  const name = `WorkspaceIntake${kind[0].toUpperCase()}${kind.slice(1)}`;
  source = upsertOpenApiComponent(source, name, project(JSON.parse(readFileSync(new URL(`contracts/workspace-intake/${kind}.schema.json`, root), "utf8")), name));
}
const schemas = {
  WorkspaceIntakeRequestPage: object({
    schema_version: { const: 1 }, workflow_id: { const: "workspace-intake" },
    target: object({ kind: { const: "repo" }, name: targetName, record_id: text }),
    custody_request_id: text, revision: { type: "integer", minimum: 0 }, pending_request_count: { type: "integer", minimum: 0 }, updated_at: nullable(date),
    next_cursor: nullable({ type: "string", pattern: "^[0-9a-f]{64}$" }),
    records: { type: "array", maxItems: 25, items: object({
      request_id: text, requested_at: date, updated_at: date, revision: { type: "integer", minimum: 1 },
      status: { $ref: "#/components/schemas/WorkspaceIntakeResult/properties/status" },
      classification: { enum: ["proposed", "admitted", "out-of-scope"] },
      candidate: ref("WorkspaceIntakeSourceCandidate"),
    }) },
  }),
  WorkspaceIntakeSourceCandidate: object({
    schema_version: { const: 1 }, artifact_type: { const: "workspace-intake-source-candidate" },
    source: object({ class: { enum: ["repository-custody", "prototype", "delivery"] }, ref: text, digest }),
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName, record_id: { type: "string", pattern: "^(repo|product|component):[a-z0-9][a-z0-9._-]*$" } }),
    requested_record: { type: "object", minProperties: 1 },
    evidence_refs: { type: "array", minItems: 1, uniqueItems: true, items: text },
    candidate_digest: digest,
  }),
  WorkspaceIntakeSourceAttestation: object({
    candidate: ref("WorkspaceIntakeSourceCandidate"), attested_at: date, attested_by: text,
  }),
  WorkspaceIntakeSourceBinding: object({
    candidate_digest: digest, evidence_refs: { type: "array", minItems: 1, uniqueItems: true, items: text },
    source: object({ class: { enum: ["repository-custody", "prototype", "delivery"] }, ref: text, digest }),
    attested_at: date, attested_by: text,
  }),
  WorkspaceIntakePreparationCommand: { oneOf: [
    object({ target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName }) }),
    object({ target: object({ kind: { const: "repo" }, name: targetName }),
      repository_custody: object({ request_id: text,
        requested_record: { $ref: "#/components/schemas/WorkspaceIntakeRequest/properties/requested_record" } }) }),
  ] },
  WorkspaceIntakePreparation: withOptional(object({
    schema_version: { const: 1 }, workflow_id: { const: "workspace-intake" }, authority_revision: commit,
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName, record_id: { type: "string", pattern: "^(repo|product|component):[a-z0-9][a-z0-9._-]*$" } }),
    expected_state: { oneOf: [
      object({ register_digest: digest, record_version: { type: "null" }, record_digest: { type: "null" } }),
      object({ register_digest: digest, record_version: { type: "integer", minimum: 1 }, record_digest: digest }),
    ] },
    canonical_authority: object({ repo: { const: "workspace-governance" }, path: { const: "contracts/intake-register.yaml" }, branch: { const: "main" } }),
    canonical_mutation: { const: false },
  }), { source_candidate: ref("WorkspaceIntakeSourceCandidate") }),
  WorkspaceIntakeCommand: object({ request: ref("WorkspaceIntakeRequest"), decision: ref("WorkspaceIntakeDecision"), authority_revision: commit, session_ref: text, execution_ref: text }),
  WorkspaceIntakeReview: object({ repository: { const: "workspace-governance" }, number: { type: "integer", minimum: 1 }, url: { type: "string", format: "uri" },
    state: { enum: ["open", "closed"] }, branch: text, base_branch: { const: "main" }, base_commit: commit, head_commit: commit,
    merged: { type: "boolean" }, merge_commit: nullable(commit), human_reviewed: { type: "boolean" },
  }),
  WorkspaceIntakeResult: object({
    schema_version: { const: 1 }, workflow_id: { const: "workspace-intake" }, request_id: text, session_ref: text, execution_ref: text,
    status: { enum: ["accepted", "evaluating", "preparing", "review-required", "cancelling", "cancelled", "rejected", "requires-action", "succeeded"] },
    next_action: { enum: ["continue", "review-and-merge", "complete", "submit-corrected-request", "restore-dependency-and-retry", "inspect-review-or-cancel"] }, revision: { type: "integer", minimum: 1 },
    request: ref("WorkspaceIntakeRequest"), decision: ref("WorkspaceIntakeDecision"),
    readiness: nullable(object({ receipt: ref("WorkspaceIntakeReadiness"), ledger: object({ state: { const: "durable" }, resolution: { enum: ["created", "reused", "read"] }, ref: object({ uri: text, digest }) }) })),
    review: nullable(ref("WorkspaceIntakeReview")), readback: nullable(ref("WorkspaceIntakeReadback")), receipt: nullable(ref("WorkspaceIntakeReceipt")),
    failure: nullable(object({ code: text, retryable: { type: "boolean" }, message: text })),
    history: { type: "array", minItems: 1, items: object({ sequence: { type: "integer", minimum: 1 }, at: date, status: text, details: nullable(object({ merge_commit: commit, receipt_digest: digest })) }) },
    source_attestation: nullable(ref("WorkspaceIntakeSourceBinding")),
    canonical_mutation: { type: "boolean" },
  }),
};
// Direct candidates project operator-authored commands; the attestation schema
// continues to admit only authenticated source-owner classes.
schemas.WorkspaceIntakeDirectCandidate = structuredClone(schemas.WorkspaceIntakeSourceCandidate);
schemas.WorkspaceIntakeDirectCandidate.properties.source.properties.class = { const: "direct" };
schemas.WorkspaceIntakeDirectCandidate.properties.target.properties.kind = { enum: ["product", "component"] };
const directPage = structuredClone(schemas.WorkspaceIntakeRequestPage);
directPage.required.push("source_class");
directPage.properties.source_class = { const: "direct" };
directPage.properties.custody_request_id = { type: "null" };
directPage.properties.target.properties.kind = { enum: ["product", "component"] };
directPage.properties.records.items.properties.candidate = ref("WorkspaceIntakeDirectCandidate");
schemas.WorkspaceIntakeRequestPage = { oneOf: [schemas.WorkspaceIntakeRequestPage, directPage] };
for (const [name, schema] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, schema);
const input = inputFixture();
const example = { schema_version: 1, workflow_id: "workspace-intake", request_id: input.request.request_id, session_ref: input.session_ref, execution_ref: input.execution_ref,
  status: "accepted", next_action: "continue", revision: 1, request: input.request, decision: input.decision,
  readiness: null, review: null, readback: null, receipt: null, failure: null, history: [{ sequence: 1, at, status: "accepted", details: null }], source_attestation: null, canonical_mutation: false };
const responses = (success = "200") => ({
  [success]: { description: success === "202" ? "Durable acknowledgement; not canonical admission." : "Durable workflow projection.", content: { "application/json": { schema: ref("WorkspaceIntakeResult"), example } } },
  ...Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization, conflict or dependency failure." }])),
});
const common = { tags: ["Workspace Intake"], security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  description: "Caller-bound Workspace Intake coordination. No direct-main writes, automatic merge, runtime activation or fixture fallback. A succeeded receipt requires exact reviewed merged-source readback.",
  "x-oos-surface": "workspace-intake", "x-oos-primary-caller": "governance-operations-console", "x-oos-owner": "operator-orchestration-service", "x-oos-workflow-family": "workspace-intake" };
const requestId = { name: "request_id", in: "path", required: true, schema: text };
const preparationInput = { target: { kind: input.request.target.kind, name: input.request.target.name } };
const preparationExample = {
  schema_version: 1,
  workflow_id: "workspace-intake",
  authority_revision: input.authority_revision,
  target: input.request.target,
  expected_state: input.request.expected_state,
  canonical_authority: { repo: "workspace-governance", path: "contracts/intake-register.yaml", branch: "main" },
  canonical_mutation: false,
};
const sourceCandidateExample = bindWorkspaceIntakeSourceCandidate({
  schema_version: 1,
  artifact_type: "workspace-intake-source-candidate",
  source: {
    class: "prototype",
    ref: `record://prototype-baselines/${"a".repeat(64)}`,
    digest: `sha256:${"b".repeat(64)}`,
  },
  target: input.request.target,
  requested_record: input.request.requested_record,
  evidence_refs: ["record://prototype-baselines/intake-proof-v1"],
});
source = upsertOpenApiPath(source, "/v1/workspace-intake/preparations", { post: { ...common,
  operationId: "prepareWorkspaceIntake", summary: "Read current canonical bindings for one Workspace Intake target",
  description: "Caller-bound, non-mutating preparation from current committed Workspace Governance source. This does not accept an operator decision, create workflow state, or authorize canonical mutation.",
  requestBody: { description: "One target identity whose current optimistic-concurrency bindings are required.", required: true, content: { "application/json": { schema: ref("WorkspaceIntakePreparationCommand"), example: preparationInput } } },
  responses: {
    "200": { description: "Current canonical bindings; no workflow or authority state was mutated.", content: { "application/json": { schema: ref("WorkspaceIntakePreparation"), example: preparationExample } } },
    ...Object.fromEntries([400, 401, 403, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization or dependency failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-intake/source-candidates", { post: { ...common,
  operationId: "attestWorkspaceIntakeSourceCandidate", summary: "Retain one immutable source-owner Workspace Intake candidate",
  description: "Caller-bound source-owner handoff. Prototype Studio attests prototype candidates; OOS attests Delivery and repository-custody candidates. The candidate is coordination evidence, not canonical Workspace Governance state.",
  requestBody: { description: "Exact source candidate emitted by its authenticated owner.", required: true, content: { "application/json": { schema: ref("WorkspaceIntakeSourceCandidate"), example: sourceCandidateExample } } },
  responses: {
    "201": { description: "Immutable source-owner candidate retained.", content: { "application/json": { schema: ref("WorkspaceIntakeSourceAttestation"), example: { candidate: sourceCandidateExample, attested_at: at, attested_by: "workspace-prototype-studio" } } } },
    ...Object.fromEntries([400, 401, 403, 409, 413, 503].map((status) => [String(status), { description: "Bounded validation, caller binding, conflict or storage failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-intake/requests", {
  get: { ...common, operationId: "listCustodyWorkspaceIntakeRequests", summary: "Read retained caller-owned Intake requests for one exact custody or direct target",
    parameters: [
      { name: "target_kind", in: "query", required: true, schema: { enum: ["repo", "product", "component"] } },
      { name: "target_name", in: "query", required: true, schema: targetName },
      { name: "custody_request_id", in: "query", required: false, description: "Required for repo; mutually exclusive with source_class.", schema: text },
      { name: "source_class", in: "query", required: false, description: "Required direct selector for product/component; mutually exclusive with custody_request_id.", schema: { const: "direct" } },
      { name: "cursor", in: "query", required: false, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
    ], responses: {
      "200": { description: "Read-only caller/custody-scoped page; reopening does not resubmit classification.",
        content: { "application/json": { schema: ref("WorkspaceIntakeRequestPage"), example: {
          schema_version: 1, workflow_id: "workspace-intake", target: { kind: "repo", name: "example-repository", record_id: "repo:example-repository" },
          custody_request_id: "repository-custody-request:example", revision: 0, pending_request_count: 0, updated_at: null, records: [], next_cursor: null,
        } } } },
      ...Object.fromEntries([400, 401, 403, 404, 502, 503].map(status => [String(status), { description: "Invalid selector, denied caller/custody, or unavailable retained state." }])),
    },
  },
  post: { ...common, operationId: "submitWorkspaceIntake", summary: "Accept one immutable Workspace Intake request and operator decision", requestBody: { description: "Exact source-bound request, accepted decision and execution context.", required: true, content: { "application/json": { schema: ref("WorkspaceIntakeCommand"), example: input } } }, responses: responses("202") },
});
source = upsertOpenApiPath(source, "/v1/workspace-intake/requests/{request_id}", { get: { ...common, operationId: "readWorkspaceIntake", summary: "Read caller-owned intake progress, findings, review and receipts", parameters: [requestId], responses: responses() } });
for (const action of ["continue", "cancel"]) source = upsertOpenApiPath(source, `/v1/workspace-intake/requests/{request_id}/${action}`, { post: { ...common,
  operationId: `${action}WorkspaceIntake`, summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged intake workflow`, parameters: [requestId],
  requestBody: { description: "No replacement input; continue or cancel the immutable acknowledged command.", required: true, content: { "application/json": { schema: object({}), example: {} } } }, responses: responses(),
} });
if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Workspace Intake OpenAPI projection is stale.");
} else writeFileSync(openapiPath, source);
console.log("Workspace Intake OpenAPI projection is current.");
