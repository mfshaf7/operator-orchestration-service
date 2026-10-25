import { sourceEditorSchemas, mergeSourceEditorPaths } from "./source_editor_openapi_tools.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { addConsoleSourceProjectionMedia } from "./console_source_authority_openapi_tools.mjs";
import { SOURCE_INTENT_REFERENCE } from "../src/platform-operation/source-credentials.js";
import { sourceCredentialSchemas } from "./source_credential_openapi_schemas.mjs";
import { prototypeDeliveryPreparationSchema } from "../src/source-authoring/prototype-delivery-preparation.js";

const target = new URL("../docs/api/openapi.json", import.meta.url);
const original = readFileSync(target, "utf8");
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$" };
const timestamp = { type: "string", format: "date-time" };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const nullable = value => ({ oneOf: [value, { type: "null" }] });
const closed = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const ownedEvidence = { type: "object", description: "Secret-free evidence from the named existing owner adapter; this is never caller-supplied authority." };
const sourceIntent = { type: "string", pattern: SOURCE_INTENT_REFERENCE.source };
const nextAction = closed({ code: id, authority: id, reason: { type: "string" } }, ["code", "authority"]);
const failure = nullable(closed({ code: id, message: { type: "string" }, retryable: { type: "boolean" } }));
const sourceScope = closed({ source_root: { type: "string" }, design_profile: { type: "string" } });
const pr = closed({ url: { type: "string", format: "uri", pattern: "^https://github.com/" }, head_commit: commit });
const commandFields = { schema_version: { const: 1 }, command_id: id, expected_revision: timestamp, requested_at: timestamp };
const summaryOperation = closed({ action: { enum: ["create", "replace", "delete"] }, path: { type: "string", maxLength: 240 },
  expected_digest: nullable(digest), content_digest: nullable(digest) });
const control = closed({ command: closed({ ...commandFields, expected_pull_request: nullable(pr) }), command_id: id, command_digest: digest, state: { enum: ["pending", "unknown", "succeeded"] }, requested_at: timestamp,
  failure, completed_at: timestamp, validation: ownedEvidence, publication: ownedEvidence, pull_request: ownedEvidence, revocation: ownedEvidence, cleanup: ownedEvidence },
  ["command", "command_id", "command_digest", "state", "requested_at", "failure"]);
const properties = { schema_version: { const: 1 }, workflow_id: { const: "prototype-source-authoring" }, request_id: { type: "string", pattern: "^prototype-source-request:" },
  prototype_id: { type: "string", pattern: "^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$" }, subject: ref("PrototypeSourceSubject"), source_start_digest: digest,
  source_scope: sourceScope, landing_unit: closed({ landing_unit_id: id, branch: { type: "string" }, fetched_base: commit }), session_id: nullable(id),
  state: { enum: ["prepared", "source-authorization-required", "source-work", "succeeded"] }, created_at: timestamp, updated_at: timestamp,
  next_action: nextAction, canonical_mutation: { const: false }, runtime_activation: { const: false }, source_intent_ref: nullable(sourceIntent),
  source_request: ref("PrototypeSourceRequest"),
  source_delivery: closed({ publish: control, review: control, merge: control, close: control }, []), realization: nullable(ref("PrototypeSourceRealization")), replayed: { type: "boolean" } };
const baseFields = Object.keys(properties).filter(field => !["source_intent_ref", "source_request", "source_delivery", "realization", "replayed"].includes(field));
const changeSet = JSON.parse(readFileSync(new URL("../contracts/delivery-art-work-session/source-realization-change-set.schema.json", import.meta.url), "utf8"));
delete changeSet.$id; delete changeSet.$schema;
// Keep the native bounded change-set definitions local when embedded in OpenAPI.
const fixRefs = value => {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) value.$ref = `#/components/schemas/PrototypeSourceChangeSet/$defs/${value.$ref.slice(8)}`;
  for (const child of Object.values(value)) fixRefs(child);
};
fixRefs(changeSet);
const deliveryPreparation = structuredClone(prototypeDeliveryPreparationSchema);
function fixDeliveryPreparationRefs(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) value.$ref = `#/components/schemas/PrototypeDeliveryPreparation/$defs/${value.$ref.slice(8)}`;
  for (const child of Object.values(value)) fixDeliveryPreparationRefs(child);
}
fixDeliveryPreparationRefs(deliveryPreparation);
const schemas = {
  ...sourceEditorSchemas,
  PrototypeDeliveryPreparation: deliveryPreparation,
  PrototypeOwnerPreparation: { oneOf: [ref("PrototypeDeliveryPreparation"), closed({ kind: { const: "preview-profile" }, port: { type: "integer", minimum: 1024, maximum: 65535 },
    support_profile: { enum: ["interactive", "unattended"] }, runtime_activation: { type: "boolean" },
    ttl_seconds: { type: "integer", minimum: 300, maximum: 86400 }, decision_ref: { type: "string", pattern: "^record://[A-Za-z0-9._:/-]+$", maxLength: 512 } })] },
  PrototypeSourceSubject: sourceCredentialSchemas.SourceCredentialSubject.oneOf[1],
  PrototypeSourceChangeSet: changeSet,
  PrototypeSourceRequest: closed({ schema_version: { const: 1 }, request_id: { type: "string", pattern: "^prototype-source-request:[A-Za-z0-9][A-Za-z0-9._:-]{0,230}$", maxLength: 256 },
    prototype_id: properties.prototype_id, expected_registry_revision: commit, expected_source_revision: commit,
    objective: { type: "string", minLength: 8, maxLength: 16384 }, requested_at: timestamp, owner_preparation: ref("PrototypeOwnerPreparation") },
    ["schema_version", "request_id", "prototype_id", "expected_registry_revision", "expected_source_revision", "objective", "requested_at"]),
  PrototypeSourceProjection: closed(properties, [...baseFields, "source_request", "source_intent_ref", "source_delivery", "realization"]),
  PrototypeSourceSummary: closed(Object.fromEntries(Object.entries(properties).filter(([key]) => baseFields.includes(key)))),
  PrototypeSourceSummaryList: closed({ workflow_id: { const: "prototype-source-authoring-list" }, requests: { type: "array", maxItems: 200, items: ref("PrototypeSourceSummary") } }),
  PrototypeSourceRealization: closed({ schema_version: { const: 1 }, workflow_id: { const: "prototype-source-realization" }, session_id: id, revision: timestamp,
    state: { enum: ["not-started", "accepted", "draft-ready", "applying", "apply-unknown", "source-created", "failed", "cancelled"] }, replayed: { type: "boolean" }, next_action: nextAction,
    attempt: nullable(closed({ request: { oneOf: [ref("PrototypeSourceGeneration"), ref("OperatorSourceDraftRequestSummary")] }, operator_draft: ref("OperatorSourceDraftProvenance"), request_id: id, execution_id: id, retry_of: nullable(id), state: id, requested_at: timestamp, completed_at: nullable(timestamp), objective_digest: digest,
      context: nullable(ownedEvidence), model: nullable(ownedEvidence), owner_preparation: closed({ plan_digest: digest, request_digest: digest,
        authority: { const: "workspace-prototype-studio" }, model_invoked: { const: false }, runtime_activated: { const: false } }),
      change_set: nullable(closed({ digest, change_set_id: id, commit_message: { type: "string" }, operations: { type: "array", maxItems: 64, items: summaryOperation } })),
      source_receipt: nullable(ownedEvidence), failure }, ["request", "request_id", "execution_id", "retry_of", "state", "requested_at", "completed_at", "objective_digest", "context", "model", "change_set", "source_receipt", "failure"])) }),
  PrototypeSourceSessionStart: closed({ schema_version: { const: 1 }, command_id: id, source_intent_ref: sourceIntent, requested_at: timestamp }),
  PrototypeSourceGeneration: closed({ schema_version: { const: 1 }, request_id: id, execution_id: id, expected_revision: timestamp,
    budget_tokens: { type: "integer", minimum: 1, maximum: 8000 }, retry_of: nullable(id), requested_at: timestamp, source_intent_ref: sourceIntent }),
  PrototypeSourceAcceptance: closed({ command: closed({ ...commandFields, accepted_change_set_digest: digest }), source_intent_ref: sourceIntent }),
  PrototypeSourceRecovery: closed({ command: closed(commandFields), source_intent_ref: sourceIntent }),
  PrototypeSourceCancellation: closed({ ...commandFields, reason: { type: "string", minLength: 20, maxLength: 4096 } }),
  PrototypeSourceDeliveryControl: closed({ command: closed({ ...commandFields, expected_pull_request: pr }) }),
  PrototypeSourcePublication: closed({ command: closed({ ...commandFields, expected_pull_request: { type: "null" } }), source_intent_ref: sourceIntent }),
  PrototypeSourceDraft: closed({ schema_version: { const: 1 }, workflow_id: { const: "prototype-source-draft" }, request_id: id, session_id: id, revision: timestamp,
    digest, change_set: ref("PrototypeSourceChangeSet"), accepted: { type: "boolean" }, operator_draft: nullable(ref("OperatorSourceDraftProvenance")) }, ["schema_version", "workflow_id", "request_id", "session_id", "revision", "digest", "change_set", "accepted"]),
};
const NOW = "2026-10-18T14:00:00Z"; const SHA = `sha256:${"a".repeat(64)}`; const BASE = "a".repeat(40);
const requestExample = { schema_version: 1, request_id: "prototype-source-request:sample:1", prototype_id: "prototype:sample",
  expected_registry_revision: BASE, expected_source_revision: BASE, objective: "Draft a minimal synthetic browser-local prototype.", requested_at: NOW };
const summary = { schema_version: 1, workflow_id: "prototype-source-authoring", request_id: requestExample.request_id, prototype_id: requestExample.prototype_id,
  subject: { kind: "prototype", prototype_id: "prototype:sample", registry_ref: "record://prototypes/sample", registry_revision: BASE, source_ref: "repo://workspace-prototype-studio/prototypes/sample", source_revision: BASE },
  source_start_digest: SHA, source_scope: { source_root: "prototypes/sample", design_profile: "docs/prototypes/sample/design-profile.md" },
  landing_unit: { landing_unit_id: "prototype-authoring-sample", branch: "feature/prototype-sample", fetched_base: BASE }, session_id: null, state: "prepared", created_at: NOW, updated_at: NOW,
  next_action: { code: "prototype-source-authorization-required", authority: "platform-engineering" }, canonical_mutation: false, runtime_activation: false };
const projection = { ...summary, source_request: requestExample, source_intent_ref: null, source_delivery: {}, realization: null };
const generationExample = { schema_version: 1, request_id: "prototype-generation:sample:1", execution_id: "prototype-execution:sample:1", expected_revision: NOW,
  budget_tokens: 4000, retry_of: null, requested_at: NOW, source_intent_ref: "source-intent:prototype-sample:1" };
const realization = { schema_version: 1, workflow_id: "prototype-source-realization", session_id: "prototype-source-session:sample", revision: NOW, state: "draft-ready", replayed: false,
  next_action: { code: "prototype-source-acceptance-required", authority: "operator-orchestration-service" },
  attempt: { request: generationExample, request_id: "prototype-generation:sample:1", execution_id: "prototype-execution:sample:1", retry_of: null, state: "draft-ready", requested_at: NOW, completed_at: NOW,
    objective_digest: SHA, context: { packet_ref: "/v1/context/packets/sample" }, model: { profile_id: "prototype-source-authoring-v1" },
    change_set: { digest: SHA, change_set_id: "prototype-draft:sample:1", commit_message: "feat: draft synthetic prototype source", operations: [{ action: "create", path: "prototypes/sample/index.html", expected_digest: null, content_digest: SHA }] }, source_receipt: null, failure: null } };
const command = { schema_version: 1, command_id: "prototype-command:sample:1", expected_revision: NOW, requested_at: NOW };
const intent = "source-intent:prototype-sample:1";
const auth = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const errors = Object.fromEntries([["400", "ValidationError"], ["401", "UnauthorizedError"], ["403", "ForbiddenError"], ["404", "NotFoundError"], ["409", "ConflictError"]].map(([status, name]) => [status, { $ref: `#/components/responses/${name}` }]));
errors["503"] = { description: "The exact source-authoring composition, identity, context or model purpose is unavailable or not activated.", content: { "application/json": { schema: ref("ErrorResponse"),
  example: { error: "prototype_source_authoring_not_active", message: "Prototype source authoring awaits reviewed activation.", details: null } } } };
errors["502"] = { description: "The isolated-source, context or governed-model owner rejected the bounded upstream operation.",
  content: { "application/json": { schema: ref("ErrorResponse"), example: { error: "prototype_source_authoring_upstream_rejected", message: "Inspect the same retained Prototype request before retrying.", details: { owner_code: "owner_rejected", retryable: true } } } } };
const response = (schema, example) => ({ "200": { description: "Caller-owned bounded source workflow projection; documentation examples are not operating evidence.", content: { "application/json": { schema: ref(schema), example } } }, ...errors });
const common = { tags: ["Prototype Source Authoring"], security: auth, "x-oos-owner": "operator-orchestration-service",
  "x-oos-primary-caller": "governance-operations-console", "x-oos-surface": "operator-facing", "x-oos-workflow-family": "prototype-source-authoring" };
const parameter = [{ name: "request_id", in: "path", required: true, schema: { type: "string", pattern: "^prototype-source-request:" } }];
const operation = (name, summaryText, schema, example, output = "PrototypeSourceRealization") => ({ ...common, operationId: `prototypeSource${name}`, summary: summaryText,
  description: "Bounded real-Prototype source workflow. Requires caller identity and reviewed activation; no fake ART identity, source-coordinate injection, raw-context fallback or CLI-only completion is admitted.", parameters: parameter,
  requestBody: { required: true, description: "Exact immutable workflow input. Retain command/request identifiers and expected revision for lost-acknowledgement recovery.", content: { "application/json": { schema: ref(schema), example } } },
  responses: response(output, output === "PrototypeSourceProjection" ? projection : realization) });
const paths = {
  "/v1/prototype-source-requests": {
    get: { ...common, operationId: "prototypeSourceList", summary: "List caller-owned source request metadata", description: "Bounded metadata only; listing never loads historical model drafts or source payloads.",
      parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } }], responses: response("PrototypeSourceSummaryList", { workflow_id: "prototype-source-authoring-list", requests: [summary] }) },
    post: { ...operation("Create", "Prepare canonical Prototype source authoring", "PrototypeSourceRequest", requestExample, "PrototypeSourceProjection"), parameters: [] },
  },
  "/v1/prototype-source-requests/{request_id}": { get: { ...common, operationId: "prototypeSourceRead", summary: "Recover one actual Prototype source workflow", description: "Reads retained state, exact next action and secret-free evidence without starting a source or model action.", parameters: parameter, responses: response("PrototypeSourceProjection", projection) } },
  "/v1/prototype-source-requests/{request_id}/draft": { get: { ...common, operationId: "prototypeSourceDraft", summary: "Inspect exact private source draft before acceptance", description: "Caller-bound operator review of bounded model-authored text. Render as inert source, never executable HTML. This read does not accept or apply the draft.", parameters: parameter,
    responses: response("PrototypeSourceDraft", { schema_version: 1, workflow_id: "prototype-source-draft", request_id: requestExample.request_id, session_id: realization.session_id, revision: NOW, digest: SHA, accepted: false,
      change_set: { schema_version: 1, change_set_id: "prototype-draft:sample:1", session_id: realization.session_id, base_commit: BASE, objective_digest: SHA,
        commit_message: "feat: draft synthetic prototype source", operations: [{ action: "create", path: "prototypes/sample/index.html", content: "Synthetic documentation example.", expected_digest: null }] } }) } },
  "/v1/prototype-source-requests/{request_id}/session": { post: operation("StartSession", "Start the actual source session under approved scope", "PrototypeSourceSessionStart", { schema_version: 1, command_id: command.command_id, source_intent_ref: intent, requested_at: NOW }, "PrototypeSourceProjection") },
  "/v1/prototype-source-requests/{request_id}/generate": { post: operation("Generate", "Generate a draft using governed Prototype context", "PrototypeSourceGeneration", { schema_version: 1, request_id: "prototype-generation:sample:1", execution_id: "prototype-execution:sample:1", expected_revision: NOW, budget_tokens: 4000, retry_of: null, requested_at: NOW, source_intent_ref: intent }) },
  "/v1/prototype-source-requests/{request_id}/accept": { post: operation("Accept", "Accept and apply the exact source draft digest", "PrototypeSourceAcceptance", { command: { ...command, accepted_change_set_digest: SHA }, source_intent_ref: intent }) },
  "/v1/prototype-source-requests/{request_id}/recover": { post: operation("Recover", "Reconcile the retained exact uncertain source apply", "PrototypeSourceRecovery", { command, source_intent_ref: intent }) },
  "/v1/prototype-source-requests/{request_id}/cancel-attempt": { post: operation("CancelAttempt", "Cancel an unapplied draft or interrupted generation", "PrototypeSourceCancellation", { ...command, reason: "Discard this unapplied attempt before a linked retry." }) },
  "/v1/prototype-source-requests/{request_id}/publish": { post: operation("Publish", "Validate and publish the committed Gary source", "PrototypeSourcePublication", { command: { ...command, expected_pull_request: null }, source_intent_ref: intent }, "PrototypeSourceProjection") },
};
for (const action of ["review", "merge", "close"]) paths[`/v1/prototype-source-requests/{request_id}/${action}`] = { post: operation(action[0].toUpperCase() + action.slice(1),
  { review: "Human-review the exact source PR head", merge: "Merge the exact approved source PR", close: "Revoke owned credentials and retire proven source resources" }[action], "PrototypeSourceDeliveryControl",
  { command: { ...command, expected_pull_request: { url: "https://github.com/example/workspace-prototype-studio/pull/1", head_commit: BASE } } }, "PrototypeSourceProjection") };
mergeSourceEditorPaths(paths, "prototype");
let synchronized = original;
for (const [name, value] of Object.entries(schemas)) synchronized = upsertOpenApiComponent(synchronized, name, value);
for (const [route, value] of Object.entries(paths)) synchronized = upsertOpenApiPath(synchronized, route, value.get ? addConsoleSourceProjectionMedia(value, "get") : value);
if (process.argv.includes("--check")) {
  if (synchronized !== original) { console.error("Prototype source authoring OpenAPI surface is stale"); process.exit(1); }
} else writeFileSync(target, synchronized);
process.stdout.write(`${JSON.stringify({ ok: true, paths: Object.keys(paths).length, mode: process.argv.includes("--check") ? "check" : "write" })}\n`);
