import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { at, inputFixture } from "../test-fixtures/workspace-intake/fixture.js";

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
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "$id"].includes(key)).map(([key, entry]) => [key,
    key === "$ref" && entry.startsWith("#/$defs/") ? `#/components/schemas/${name}/${entry.slice(2)}` : project(entry, name),
  ]));
}
for (const kind of ["request", "decision", "mutation", "readback", "receipt", "readiness"]) {
  const name = `WorkspaceIntake${kind[0].toUpperCase()}${kind.slice(1)}`;
  source = upsertOpenApiComponent(source, name, project(JSON.parse(readFileSync(new URL(`contracts/workspace-intake/${kind}.schema.json`, root), "utf8")), name));
}
const schemas = {
  WorkspaceIntakePreparationCommand: object({ target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName }) }),
  WorkspaceIntakePreparation: object({
    schema_version: { const: 1 }, workflow_id: { const: "workspace-intake" }, authority_revision: commit,
    target: object({ kind: { enum: ["repo", "product", "component"] }, name: targetName, record_id: { type: "string", pattern: "^(repo|product|component):[a-z0-9][a-z0-9._-]*$" } }),
    expected_state: { oneOf: [
      object({ register_digest: digest, record_version: { type: "null" }, record_digest: { type: "null" } }),
      object({ register_digest: digest, record_version: { type: "integer", minimum: 1 }, record_digest: digest }),
    ] },
    canonical_authority: object({ repo: { const: "workspace-governance" }, path: { const: "contracts/intake-register.yaml" }, branch: { const: "main" } }),
    canonical_mutation: { const: false },
  }),
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
    canonical_mutation: { type: "boolean" },
  }),
};
for (const [name, schema] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, schema);
const input = inputFixture();
const example = { schema_version: 1, workflow_id: "workspace-intake", request_id: input.request.request_id, session_ref: input.session_ref, execution_ref: input.execution_ref,
  status: "accepted", next_action: "continue", revision: 1, request: input.request, decision: input.decision,
  readiness: null, review: null, readback: null, receipt: null, failure: null, history: [{ sequence: 1, at, status: "accepted", details: null }], canonical_mutation: false };
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
source = upsertOpenApiPath(source, "/v1/workspace-intake/preparations", { post: { ...common,
  operationId: "prepareWorkspaceIntake", summary: "Read current canonical bindings for one Workspace Intake target",
  description: "Caller-bound, non-mutating preparation from current committed Workspace Governance source. This does not accept an operator decision, create workflow state, or authorize canonical mutation.",
  requestBody: { description: "One target identity whose current optimistic-concurrency bindings are required.", required: true, content: { "application/json": { schema: ref("WorkspaceIntakePreparationCommand"), example: preparationInput } } },
  responses: {
    "200": { description: "Current canonical bindings; no workflow or authority state was mutated.", content: { "application/json": { schema: ref("WorkspaceIntakePreparation"), example: preparationExample } } },
    ...Object.fromEntries([400, 401, 403, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization or dependency failure." }])),
  },
} });
source = upsertOpenApiPath(source, "/v1/workspace-intake/requests", { post: { ...common, operationId: "submitWorkspaceIntake", summary: "Accept one immutable Workspace Intake request and operator decision", requestBody: { description: "Exact source-bound request, accepted decision and execution context.", required: true, content: { "application/json": { schema: ref("WorkspaceIntakeCommand"), example: input } } }, responses: responses("202") } });
source = upsertOpenApiPath(source, "/v1/workspace-intake/requests/{request_id}", { get: { ...common, operationId: "readWorkspaceIntake", summary: "Read caller-owned intake progress, findings, review and receipts", parameters: [requestId], responses: responses() } });
for (const action of ["continue", "cancel"]) source = upsertOpenApiPath(source, `/v1/workspace-intake/requests/{request_id}/${action}`, { post: { ...common,
  operationId: `${action}WorkspaceIntake`, summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged intake workflow`, parameters: [requestId],
  requestBody: { description: "No replacement input; continue or cancel the immutable acknowledged command.", required: true, content: { "application/json": { schema: object({}), example: {} } } }, responses: responses(),
} });
if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Workspace Intake OpenAPI projection is stale.");
} else writeFileSync(openapiPath, source);
console.log("Workspace Intake OpenAPI projection is current.");
