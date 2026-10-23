import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { planSourceOwnerBootstrap, sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { addConsoleSourceProjectionMedia } from "./console_source_authority_openapi_tools.mjs";

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,255}$" };
const owner = { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const timestamp = { type: "string", format: "date-time" };
const nullable = value => ({ oneOf: [value, { type: "null" }] });
const closed = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const no = { const: false };
const evidence = { type: "object", description: "Bounded secret-free owner evidence; never caller-supplied effect authority." };
const provider = closed({ provider: { const: "github" }, provider_repository_id: { type: "string", pattern: "^[1-9][0-9]*$" }, full_name: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*$" } });
const entry = closed({ id, version: { type: "integer", minimum: 1 }, digest });
const profile = JSON.parse(readFileSync(new URL("../contracts/delivery-art-work-session/evidence-profile.schema.json", import.meta.url), "utf8"));
const changeSet = JSON.parse(readFileSync(new URL("../contracts/delivery-art-work-session/source-realization-change-set.schema.json", import.meta.url), "utf8"));
function localSchema(value, name) {
  delete value.$schema; delete value.$id;
  function fix(item) {
    if (!item || typeof item !== "object") return;
    if (typeof item.$ref === "string" && item.$ref.startsWith("#/$defs/")) item.$ref = `#/components/schemas/${name}/$defs/${item.$ref.slice(8)}`;
    for (const child of Object.values(item)) fix(child);
  }
  fix(value); return value;
}
const file = closed({ path: { enum: sourceOwnerBootstrapPaths(true) }, action: { enum: ["create", "replace", "unchanged"] }, mode: { const: "100644" },
  content: { type: "string", maxLength: 65536 }, expected_digest: nullable(digest), content_digest: digest });
const template = closed({ id: { const: "source-owner-bootstrap-v1" }, owner_repo: { const: "operator-orchestration-service" }, digest });
const authority = closed({ owner_repo: owner, intake_entry_ref: entry, provider_repository: provider, classification: { enum: ["proposed", "admitted"] },
  inventory_posture: { type: "null" }, custody_receipt_digest: digest, source_bootstrap_eligible: { const: true }, ordinary_source_eligible: no,
  model_writes_allowed: no, canonical_mutation: no, runtime_activation: no });
const command = { schema_version: { const: 1 }, command_id: id, expected_revision: timestamp, requested_at: timestamp };
const pr = closed({ url: { type: "string", format: "uri" }, head_commit: commit });
const sourceIntent = { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" };
const ready = closed({ status: { const: "existing-owner-controls" }, owner_repo: owner, fetched_base: commit,
  evidence_profile: ref("OwnerBootstrapEvidenceProfile"), evidence_profile_digest: digest, source_change_required: no,
  ci_present: nullable({ type: "boolean" }), app_acceptance: no, inventory_admission: no, runtime_activation: no });
const preparationFields = { schema_version: { const: 1 }, workflow_id: { const: "repository-owner-bootstrap-preparation" },
  caller_id: id, operator_id: id, decision_ref: id, custody_request_id: id, custody_receipt_digest: digest,
  owner_authority: authority, plan: nullable(ref("OwnerBootstrapPlan")), existing_owner_controls: ready,
  next_action: { const: "admit-existing-owner-controls-no-bootstrap-review" }, authorization: { const: "preparation-only" },
  credential_issued: no, checkout_created: no, canonical_mutation: no, runtime_activation: no, preparation_digest: digest };
const projectionFields = { schema_version: { const: 1 }, workflow_id: { const: "repository-owner-bootstrap" }, request_id: id,
  owner_repo: owner, state: { enum: ["prepared", "existing-controls-inspected", "source-work", "source-created", "succeeded", "cancelled"] },
  revision: timestamp, created_at: timestamp, updated_at: timestamp, session_id: nullable(id), source_intent_ref: nullable(sourceIntent), source_start_digest: digest,
  next_action: closed({ code: id, authority: { const: "operator-orchestration-service" } }), request: ref("OwnerBootstrapRequest"), binding: evidence,
  source_delivery: evidence, draft: nullable(evidence), existing_owner_controls: nullable(ready), existing_checkout: evidence,
  prepared_source_intent_refs: { type: "array", items: sourceIntent }, cancellation: evidence,
  app_acceptance: no, inventory_admission: no, runtime_activation: no };
const basicProjectionFields = Object.keys(projectionFields).filter(key => !["request", "binding", "source_delivery", "draft", "existing_owner_controls", "existing_checkout", "prepared_source_intent_refs", "cancellation"].includes(key));
export const ownerBootstrapSchemas = {
  OwnerBootstrapEvidenceProfile: localSchema(profile, "OwnerBootstrapEvidenceProfile"),
  OwnerBootstrapChangeSet: localSchema(changeSet, "OwnerBootstrapChangeSet"),
  OwnerBootstrapPreparationInput: closed({ owner_repo: owner, custody_request_id: id, evidence_profile: ref("OwnerBootstrapEvidenceProfile"),
    application_markers: { type: "array", minItems: 1, maxItems: 48, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 255 } },
    with_ci: { type: "boolean" }, decision_ref: id }),
  OwnerBootstrapPlan: closed({ schema_version: { const: 1 }, workflow_id: { const: "repository-owner-bootstrap-plan" }, owner_repo: owner,
    provider_repository: provider, intake_entry_ref: entry, fetched_base: commit, template, evidence_profile_digest: digest,
    application_markers: { type: "array", minItems: 1, maxItems: 48, items: { type: "string" } }, ci_selected: { type: "boolean" },
    requires_workflow_permission: { type: "boolean" }, source_change_required: { type: "boolean" }, files: { type: "array", minItems: sourceOwnerBootstrapPaths(false).length, maxItems: sourceOwnerBootstrapPaths(true).length, items: file },
    model_invoked: no, app_import: no, canonical_mutation: no, runtime_activation: no, plan_digest: digest }),
  OwnerBootstrapPreparation: closed(preparationFields, Object.keys(preparationFields).filter(key => !["existing_owner_controls", "next_action"].includes(key))),
  OwnerBootstrapRequest: closed({ schema_version: { const: 1 }, request_id: id, preparation_input: ref("OwnerBootstrapPreparationInput"),
    expected_preparation_digest: digest, workflow_approval_ref: nullable(id), requested_at: timestamp }),
  OwnerBootstrapProjection: closed(projectionFields, basicProjectionFields),
  OwnerBootstrapList: closed({ schema_version: { const: 1 }, workflow_id: { const: "repository-owner-bootstrap-list" }, owner_repo: owner,
    pending_request: nullable(ref("OwnerBootstrapProjection")), records: { type: "array", maxItems: 100, items: ref("OwnerBootstrapProjection") } }),
  OwnerBootstrapDraft: closed({ schema_version: { const: 1 }, workflow_id: { const: "repository-owner-bootstrap-draft" }, request_id: id,
    revision: timestamp, digest, change_set: ref("OwnerBootstrapChangeSet") }),
  OwnerBootstrapStart: closed({ schema_version: { const: 1 }, command_id: id, source_intent_ref: sourceIntent, requested_at: timestamp }),
  OwnerBootstrapExistingCheckout: closed(command),
  OwnerBootstrapCancelUnapplied: closed({ ...command, reason: { type: "string", minLength: 20, maxLength: 4096 } }),
  OwnerBootstrapAccept: closed({ command: closed({ ...command, accepted_change_set_digest: digest }), source_intent_ref: sourceIntent }),
  OwnerBootstrapRecover: closed({ command: closed(command), source_intent_ref: sourceIntent }),
  OwnerBootstrapPublish: closed({ command: closed({ ...command, expected_pull_request: { type: "null" } }), source_intent_ref: sourceIntent }),
  OwnerBootstrapControl: closed({ command: closed({ ...command, expected_pull_request: pr }) }),
};

// Documentation-only fictional source owner. These examples are not custody,
// operator approval, credential issuance, source delivery or app proof.
const sha = `sha256:${"a".repeat(64)}`, base = "b".repeat(40), now = "2026-10-19T10:00:00.000Z";
const ownerName = "example-owner-source";
const exampleAuthority = { schema_version: 1, owner_repo: ownerName, classification: "proposed", inventory_posture: null,
  intake_entry_ref: { id: `repo:${ownerName}`, version: 1, digest: sha }, provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: `example-organization/${ownerName}` },
  owner_purpose: "Documentation-only synthetic project; not a control-plane or runtime admission.", source_bootstrap_eligible: true,
  ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
const input = { owner_repo: ownerName, custody_request_id: "custody:documentation-example", with_ci: false, decision_ref: "operator:documentation-example",
  application_markers: ["app/main.mjs"], evidence_profile: { schema_version: 1, owner_repo: ownerName, profile_id: "example-selected-project-profile-v1", commands: [
    { id: "tests", kind: "tests", name: "Selected real project tests", executable: "node", args: ["app/test.mjs"], fidelity: "pure-unit", conformance_binding: "none", timeout_seconds: 30 },
    { id: "validations", kind: "validations", name: "Selected source diff", executable: "git", args: ["diff", "--check"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 },
  ] } };
const plan = planSourceOwnerBootstrap({ authority: exampleAuthority, fetchedBase: base, profile: input.evidence_profile,
  applicationMarkers: input.application_markers, withCi: false, observedFiles: Object.fromEntries(sourceOwnerBootstrapPaths(false).map(name => [name, null])) });
const { schema_version: _schema, owner_purpose: _purpose, ...selectedAuthority } = exampleAuthority;
const preparationBody = { schema_version: 1, workflow_id: "repository-owner-bootstrap-preparation", caller_id: "example-console", operator_id: "operator:example",
  decision_ref: input.decision_ref, custody_request_id: input.custody_request_id, custody_receipt_digest: sha,
  owner_authority: { ...selectedAuthority, custody_receipt_digest: sha }, plan, authorization: "preparation-only", credential_issued: false,
  checkout_created: false, canonical_mutation: false, runtime_activation: false };
const preparation = { ...preparationBody, preparation_digest: canonicalDigest(preparationBody) };
const request = { schema_version: 1, request_id: "bootstrap-request:documentation-example", preparation_input: input,
  expected_preparation_digest: preparation.preparation_digest, workflow_approval_ref: null, requested_at: now };
const projection = { schema_version: 1, workflow_id: "repository-owner-bootstrap", request_id: request.request_id, owner_repo: ownerName,
  state: "prepared", revision: now, created_at: now, updated_at: now, session_id: "bootstrap-session:documentation-example", source_intent_ref: null,
  source_start_digest: sha, next_action: { code: "owner-bootstrap-authorization-and-start-required", authority: "operator-orchestration-service" },
  request, binding: {}, source_delivery: {}, draft: null, existing_owner_controls: null, app_acceptance: false, inventory_admission: false, runtime_activation: false };
export const ownerBootstrapExamples = { input, preparation, request, projection };
const control = { schema_version: 1, command_id: "command:documentation-example", expected_revision: now, requested_at: now };
const source = "source-intent:documentation-example";
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map(code => [String(code), {
  description: "Exact authentication, current authority, approval, source, recovery or activation prerequisite is not satisfied.",
  content: { "application/json": { schema: ref("ErrorResponse"), example: { error: "repository_owner_bootstrap_unavailable", message: "Inspect the named prerequisite; no fallback is authorized.", details: null } } },
}]));
const common = { tags: ["Repository Owner Bootstrap"], security: [{ CallerIdHeader: [], CallerSecretHeader: [] }], "x-oos-owner": "operator-orchestration-service",
  "x-oos-primary-caller": "governance-operations-console", "x-oos-surface": "operator-facing", "x-oos-workflow-family": "repository-owner-bootstrap" };
const parameter = [{ name: "request_id", in: "path", required: true, schema: id }];
const responses = (schema, example, status = "200") => ({ [status]: { description: "Bounded source-only workflow evidence; no app, admission or runtime acceptance is implied.", content: { "application/json": { schema: ref(schema), example } } }, ...errors });
const post = (name, schema, example, output = "OwnerBootstrapProjection", result = projection, status = "200") => ({ ...common, operationId: `ownerBootstrap${name}`,
  summary: `Repository owner bootstrap: ${name}`, description: "Authenticated, accountable source-only operation through existing owner controls. Retain original identifiers for lost-ack recovery; no model, arbitrary source import or CLI fallback.",
  parameters: parameter, requestBody: { required: true, description: "Closed bounded operator input; retain exact request/command identity and expected revision for recovery.",
    content: { "application/json": { schema: ref(schema), example } } }, responses: responses(output, result, status) });
const paths = {
  "/v1/repository-owner-bootstrap/preparations": { post: { ...post("Prepare", "OwnerBootstrapPreparationInput", input, "OwnerBootstrapPreparation", preparation), parameters: [] } },
  "/v1/repository-owner-bootstrap/requests": {
    post: { ...post("Create", "OwnerBootstrapRequest", request, "OwnerBootstrapProjection", projection, "201"), parameters: [] },
    get: { ...common, operationId: "ownerBootstrapList", summary: "List caller-bound bootstrap metadata and original pending owner request", description: "No source payloads, checkout or credentials are loaded or created by this bounded read.",
      parameters: [{ name: "owner_repo", in: "query", required: true, schema: owner }, { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }],
      responses: responses("OwnerBootstrapList", { schema_version: 1, workflow_id: "repository-owner-bootstrap-list", owner_repo: ownerName, pending_request: projection, records: [projection] }) },
  },
  "/v1/repository-owner-bootstrap/requests/{request_id}": { get: { ...common, operationId: "ownerBootstrapRead", summary: "Recover one original bootstrap request", description: "Read retained commands and source evidence without a write or credential effect.", parameters: parameter, responses: responses("OwnerBootstrapProjection", projection) } },
  "/v1/repository-owner-bootstrap/requests/{request_id}/draft": { get: { ...common, operationId: "ownerBootstrapDraft", summary: "Inspect the exact finite trusted control draft as inert text", description: "Read-only operator inspection; never model generation or app acceptance.", parameters: parameter,
    responses: responses("OwnerBootstrapDraft", { schema_version: 1, workflow_id: "repository-owner-bootstrap-draft", request_id: request.request_id, revision: now, digest: sha,
      change_set: { schema_version: 1, change_set_id: "bootstrap-plan:example", session_id: "bootstrap-session:documentation-example", base_commit: base, objective_digest: sha,
        commit_message: "chore: bootstrap reviewed source owner controls", operations: [{ action: "create", path: "AGENTS.md", content: "Documentation-only example.\n", expected_digest: null }] } }) } },
  "/v1/repository-owner-bootstrap/requests/{request_id}/session": { post: post("Start", "OwnerBootstrapStart", { schema_version: 1, command_id: control.command_id, source_intent_ref: source, requested_at: now }) },
  "/v1/repository-owner-bootstrap/requests/{request_id}/existing-checkout": { post: post("ExistingCheckout", "OwnerBootstrapExistingCheckout", control) },
  "/v1/repository-owner-bootstrap/requests/{request_id}/cancel-unapplied": { post: post("CancelUnapplied", "OwnerBootstrapCancelUnapplied", { ...control, reason: "Withdraw this unapplied source-only owner request." }) },
  "/v1/repository-owner-bootstrap/requests/{request_id}/accept": { post: post("Accept", "OwnerBootstrapAccept", { command: { ...control, accepted_change_set_digest: sha }, source_intent_ref: source }) },
  "/v1/repository-owner-bootstrap/requests/{request_id}/recover": { post: post("Recover", "OwnerBootstrapRecover", { command: control, source_intent_ref: source }) },
  "/v1/repository-owner-bootstrap/requests/{request_id}/publish": { post: post("Publish", "OwnerBootstrapPublish", { command: { ...control, expected_pull_request: null }, source_intent_ref: source }) },
};
for (const action of ["review", "merge", "close"]) paths[`/v1/repository-owner-bootstrap/requests/{request_id}/${action}`] = { post: post(action[0].toUpperCase() + action.slice(1), "OwnerBootstrapControl",
  { command: { ...control, expected_pull_request: { url: "https://github.com/example-organization/example-owner-source/pull/1", head_commit: base } } }) };

export function syncOwnerBootstrapOpenapi({ check = false } = {}) {
  const target = new URL("../docs/api/openapi.json", import.meta.url), original = readFileSync(target, "utf8");
  let synchronized = original;
  for (const [name, value] of Object.entries(ownerBootstrapSchemas)) synchronized = upsertOpenApiComponent(synchronized, name, value);
  for (const [route, value] of Object.entries(paths)) synchronized = upsertOpenApiPath(synchronized, route, value.get ? addConsoleSourceProjectionMedia(value, "get") : value);
  if (check && synchronized !== original) throw new Error("Repository owner bootstrap OpenAPI projection is stale");
  if (!check) writeFileSync(target, synchronized);
  return { ok: true, paths: Object.keys(paths).length, mode: check ? "check" : "write" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(`${JSON.stringify(syncOwnerBootstrapOpenapi({ check: process.argv.includes("--check") }))}\n`);
