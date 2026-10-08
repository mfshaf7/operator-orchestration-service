import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import { upsertConsoleCompatibleOpenApiPath as upsertOpenApiPath } from "./console_source_authority_openapi_tools.mjs";

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
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "$id"].includes(key)).map(([key, entry]) => [key, key === "$ref" && entry.startsWith("#/$defs/") ? `#/components/schemas/${name}/${entry.slice(2)}` : project(entry, name)]));
}

const artifacts = {
  ProposalPrototypeApplication: "request.schema.json",
  ProposalPrototypeApplicationResult: "result.schema.json",
  ProposalRoutedPrototypeCapture: "record.schema.json",
};
for (const [name, file] of Object.entries(artifacts)) source = upsertOpenApiComponent(source, name, project(JSON.parse(readFileSync(new URL(`contracts/proposal-target-application/${file}`, root), "utf8")), name));

const sourceBinding = object({ proposal_id: { type: "string", pattern: "^idea-[1-9][0-9]*$" }, record_ref: { type: "string", pattern: "^openproject://work_packages/[1-9][0-9]*$" }, record_version: { type: "string", pattern: "^version-[1-9][0-9]*$" }, handoff_packet_ref: { type: "string", pattern: "^(proposal-packet:[1-9][0-9]*|proposal-handoff:idea-[1-9][0-9]*:version-[1-9][0-9]*)$" }, handoff_packet_digest: digest });
const expected = project(JSON.parse(readFileSync(new URL("contracts/proposal-target-application/request.schema.json", root), "utf8")).properties.target.properties.expected_state, "ProposalPrototypeApplication");
const review = object({ repository: { const: "workspace-prototype-studio" }, number: { type: "integer", minimum: 1 }, url: { type: "string", format: "uri" }, state: { enum: ["open", "closed"] }, branch: text, base_branch: { const: "main" }, base_commit: commit, head_commit: commit, merged: { type: "boolean" }, merge_commit: nullable(commit), human_reviewed: { type: "boolean" } });
const schemas = {
  ProposalTargetPreparationCommand: object({ proposal_id: { type: "string", pattern: "^idea-[1-9][0-9]*$" } }),
  ProposalTargetPreparation: object({ schema_version: { const: 1 }, workflow_id: { const: "proposal-target-application" }, proposal: { type: "object", additionalProperties: true }, prototype_id: { type: "string", pattern: "^prototype:proposal-[1-9][0-9]*$" }, authority_revision: commit, expected_state: expected, canonical_authority: object({ repo: { const: "workspace-prototype-studio" }, branch: { const: "main" }, record_root: { const: "records/prototype-captures" } }), canonical_mutation: { const: false } }),
  ProposalTargetCommand: object({ application_id: { type: "string", pattern: "^proposal-prototype-application:proposal-[1-9][0-9]*:[1-9][0-9]*$" }, correlation_id: text, execution_ref: text, idempotency_key: text, operator_approval_ref: text, proposal: sourceBinding, prototype: object({ id: { type: "string", pattern: "^prototype:proposal-[1-9][0-9]*$" } }), session_ref: text, target: object({ authority_revision: commit, expected_state: expected }) }),
  ProposalTargetReview: review,
  ProposalTargetSourcePreparation: object({ branch: text, base_commit: commit, file_count: { const: 2 }, changed_paths: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: text }, content_digest: digest, request: ref("ProposalPrototypeApplication"), result: ref("ProposalPrototypeApplicationResult") }),
  ProposalTargetFailure: object({ code: text, retryable: { type: "boolean" }, message: text }),
  ProposalTargetHistoryEvent: object({ sequence: { type: "integer", minimum: 1 }, at: date, status: text, details: nullable({ type: "object", additionalProperties: true }) }),
  ProposalTargetAcknowledgement: object({ replayed: { type: "boolean" }, projection: ref("ProposalWorkflowProjectionV1"), event: ref("ProposalWorkflowEventV1"), history: ref("ProposalWorkflowHistoryV1") }),
  ProposalTargetResult: object({
    schema_version: { const: 1 }, workflow_id: { const: "proposal-target-application" }, application_id: { type: "string", pattern: "^proposal-prototype-application:proposal-[1-9][0-9]*:[1-9][0-9]*$" }, proposal_id: { type: "string", pattern: "^idea-[1-9][0-9]*$" }, prototype_id: { type: "string", pattern: "^prototype:proposal-[1-9][0-9]*$" }, session_ref: text, execution_ref: text,
    status: { enum: ["accepted", "preparing", "review-required", "cancelling", "cancelled", "rejected", "requires-action", "succeeded"] }, next_action: { enum: ["continue", "review-and-merge", "complete", "submit-corrected-request", "prototype-landing", "restore-dependency-and-retry", "inspect-review-or-cancel"] }, revision: { type: "integer", minimum: 1 }, proposal: { type: "object", additionalProperties: true }, target: object({ authority_revision: commit, expected_state: expected }), preparation: nullable(ref("ProposalTargetSourcePreparation")), review: nullable(ref("ProposalTargetReview")), target_result: nullable(ref("ProposalPrototypeApplicationResult")), proposal_acknowledgement: nullable(ref("ProposalTargetAcknowledgement")), failure: nullable(ref("ProposalTargetFailure")), history: { type: "array", minItems: 1, items: ref("ProposalTargetHistoryEvent") }, canonical_target_mutation: { type: "boolean" }, proposal_mutation: { type: "boolean" }, runtime_activation: { const: false },
  }),
};
for (const [name, schema] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, schema);

const errorResponses = Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), { description: "Bounded validation, authorization, conflict or dependency failure." }]));
const response = (status = "200") => ({ [status]: { description: status === "202" ? "Durable acknowledgement without target mutation." : "Caller-bound Proposal target workflow projection.", content: { "application/json": { schema: ref("ProposalTargetResult") } } }, ...errorResponses });
const common = { tags: ["Proposal Target Application"], security: [{ CallerIdHeader: [], CallerSecretHeader: [] }], description: "Caller-bound Proposal-to-Prototype coordination. OOS owns durable progression and Proposal acknowledgement; Prototype Studio owns target mutation and evidence. Runtime remains inactive until Security and Platform activation.", "x-oos-surface": "proposal-target-application", "x-oos-primary-caller": "governance-operations-console", "x-oos-owner": "operator-orchestration-service", "x-oos-workflow-family": "proposal-target-application" };
const applicationId = { name: "application_id", in: "path", required: true, schema: text };
const expectedExample = { source_revision: "1".repeat(40), registry_digest: `sha256:${"2".repeat(64)}`, record_present: false, record_digest: null };
const proposalExample = { proposal_id: "idea-851", record_ref: "openproject://work_packages/851", record_version: "version-21", handoff_packet_ref: "proposal-handoff:idea-851:version-21", handoff_packet_digest: `sha256:${"3".repeat(64)}` };
const preparationExample = { schema_version: 1, workflow_id: "proposal-target-application", proposal: { ...proposalExample, route: {} }, prototype_id: "prototype:proposal-851", authority_revision: "1".repeat(40), expected_state: expectedExample, canonical_authority: { repo: "workspace-prototype-studio", branch: "main", record_root: "records/prototype-captures" }, canonical_mutation: false };
const commandExample = { application_id: "proposal-prototype-application:proposal-851:1", correlation_id: "correlation:proposal-target:851", execution_ref: "execution:proposal-target:851", idempotency_key: "proposal-target:851:1", operator_approval_ref: "approval:operator:851", proposal: proposalExample, prototype: { id: "prototype:proposal-851" }, session_ref: "session:proposal-target:851", target: { authority_revision: "1".repeat(40), expected_state: expectedExample } };
const resultExample = { schema_version: 1, workflow_id: "proposal-target-application", application_id: commandExample.application_id, proposal_id: "idea-851", prototype_id: "prototype:proposal-851", session_ref: commandExample.session_ref, execution_ref: commandExample.execution_ref, status: "accepted", next_action: "continue", revision: 1, proposal: { ...proposalExample, route: {} }, target: commandExample.target, preparation: null, review: null, target_result: null, proposal_acknowledgement: null, failure: null, history: [{ sequence: 1, at: "2026-10-04T18:00:00Z", status: "accepted", details: null }], canonical_target_mutation: false, proposal_mutation: false, runtime_activation: false };
const responseWithExample = (status = "200") => ({ ...response(status), [status]: { ...response(status)[status], content: { "application/json": { schema: ref("ProposalTargetResult"), example: resultExample } } } });
source = upsertOpenApiPath(source, "/v1/proposal-target-applications/preparations", { post: { ...common, operationId: "prepareProposalTargetApplication", summary: "Read current Proposal and Prototype Studio target bindings", requestBody: { required: true, description: "Identify one current accepted Proposal; OOS derives its public-safe Prototype identity without mutation.", content: { "application/json": { schema: ref("ProposalTargetPreparationCommand"), example: { proposal_id: "idea-851" } } } }, responses: { "200": { description: "Current source and target bindings without mutation.", content: { "application/json": { schema: ref("ProposalTargetPreparation"), example: preparationExample } } }, ...errorResponses } } });
source = upsertOpenApiPath(source, "/v1/proposal-target-applications", { post: { ...common, operationId: "submitProposalTargetApplication", summary: "Accept one bounded Proposal target command", requestBody: { required: true, description: "Submit the exact prepared Proposal and Prototype Studio bindings with explicit operator approval and replay identities. A cancelled zero-mutation application may restart only with an unchanged command identity and a freshly prepared target-authority binding.", content: { "application/json": { schema: ref("ProposalTargetCommand"), example: commandExample } } }, responses: responseWithExample("202") } });
source = upsertOpenApiPath(source, "/v1/proposal-target-applications/{application_id}", { get: { ...common, operationId: "readProposalTargetApplication", summary: "Read Proposal target progress and evidence", parameters: [applicationId], responses: responseWithExample() } });
for (const action of ["continue", "cancel"]) source = upsertOpenApiPath(source, `/v1/proposal-target-applications/{application_id}/${action}`, { post: { ...common, operationId: `${action}ProposalTargetApplication`, summary: `${action === "cancel" ? "Cancel" : "Continue"} an acknowledged Proposal target application`, parameters: [applicationId], requestBody: { required: true, description: `${action === "cancel" ? "Cancel" : "Continue"} the caller-bound application without accepting replacement workflow data.`, content: { "application/json": { schema: object({}), example: {} } } }, responses: responseWithExample() } });

if (process.argv.includes("--check")) {
  if (source !== readFileSync(openapiPath, "utf8")) throw new Error("Proposal target application OpenAPI projection is stale.");
} else writeFileSync(openapiPath, source);
console.log("Proposal target application OpenAPI projection is current.");
