import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { digest } from "../src/model-operations/contracts.js";

const file = new URL("../docs/api/openapi.json", import.meta.url);
const original = readFileSync(file, "utf8"); let source = original;
const check = process.argv.includes("--check");
// Keep the three closed consumer metadata schemas on one canonical definition.
// Provider/business output schemas are unchanged; historical records omit it.
const selectionSchema = JSON.parse(readFileSync(new URL("../contracts/governed-ai/effective-selection.schema.json", import.meta.url), "utf8"));
delete selectionSchema.$id; delete selectionSchema.$schema;
for (const [path, target] of [
  ["work-design/assist-result.schema.json", schema => schema.properties.evidence.properties],
  ["refinement/assist-result.schema.json", schema => schema.properties.evidence.properties],
  ["agent-console/session-projection.schema.json", schema => schema.$defs.invocation.properties.model.anyOf.find(item => item.type === "object").properties],
]) {
  const location = new URL(`../contracts/${path}`, import.meta.url);
  const prior = readFileSync(location, "utf8"), schema = JSON.parse(prior);
  target(schema).effective_selection = selectionSchema;
  const next = JSON.stringify(schema, null, 2) + "\n";
  if (JSON.stringify(JSON.parse(prior)) !== JSON.stringify(schema)) {
    if (check) throw new Error(`Effective selection consumer schema is stale: ${path}`);
    writeFileSync(location, next);
  }
  if (path.startsWith("agent-console/")) {
    const manifestFile = new URL("../contracts/agent-console/manifest.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const expected = createHash("sha256").update(readFileSync(location)).digest("hex");
    if (manifest.files["session-projection.schema.json"] !== expected) {
      if (check) throw new Error("Agent Console selection metadata contract digest is stale.");
      manifest.files["session-projection.schema.json"] = expected;
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    }
  }
}
const ref = name => ({ $ref: `#/components/schemas/ModelOperations${name}` });
const string = { type: "string", minLength: 1, maxLength: 200 };
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,180}$" };
const hash = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const integer = { type: "integer", minimum: 0 };
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const map = schema => ({ type: "object", additionalProperties: schema });
const array = (schema, extra = {}) => ({ type: "array", items: schema, ...extra });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const effort = { anyOf: [string, { type: "boolean" }, { type: "null" }] };
const actionInputs = {
  "backend.register": object({ backend_id: string }), "backend.remove": object({ backend_id: string }),
  "model.register": object({ backend_id: string, model: string }), "model.remove": object({ model_id: hash }),
  "routing.save": object({ default: ref("Route"), overrides: { ...map(ref("Route")), maxProperties: 100 } }),
  "routing.rollback": object({ revision: integer }), "account.login.start": object({ backend_id: string }),
  "account.login.cancel": object({ login_command_id: id }),
};
const request = object({ schema_version: { const: 1 }, request_id: id, idempotency_key: id,
  expected_configuration_revision: integer, action: { enum: Object.keys(actionInputs) }, input: { type: "object" } });
request.allOf = Object.entries(actionInputs).map(([action, input]) => ({ if: { properties: { action: { const: action } } }, then: { properties: { input } } }));
const healthObservation = { state: { enum: ["available", "unavailable", "verification-needed", "unknown"] },
  code: { enum: ["connection-not-probed", "check-budget-exhausted", "metadata-available", "account-sign-in-required",
    "account-present-connection-unprobed", "provider-metadata-invalid", "provider-unavailable", "provider-busy",
    "model-not-advertised", "registration-changed", "metadata-matched", "connection-verified",
    "last-request-failed", "recent-model-success", "model-verification-required"] } };
const providerHealth = nullable(object({ configuration_revision: integer, configuration_digest: hash,
  checked_at: { type: "string", format: "date-time" }, expires_at: { type: "string", format: "date-time" },
  backends: array(object({ backend_id: string, ...healthObservation }), { maxItems: 32 }),
  models: array(object({ model_id: hash, ...healthObservation, observed_runtime_version: nullable({ ...string, maxLength: 2048 }),
    observed_model_digest: nullable(string), last_success: nullable(object({ kind: { enum: ["verification", "request"] },
      at: { type: "string", format: "date-time" }, reference: { type: "string", pattern: "^(sha256:|ai-routing-selection:)[0-9a-f]{64}$" } }))
    }, ["model_id", "state", "code", "observed_runtime_version", "observed_model_digest"]), { maxItems: 256 }) }));
const components = {
  ProviderHealth: providerHealth,
  Selection: object({ model_id: hash, effort }),
  Route: nullable(object({ primary: ref("Selection"), fallbacks: array(ref("Selection"), { maxItems: 4 }), on_exhausted: { const: "fail-closed" } })),
  Request: request,
  Control: object({ control_id: id, expected_revision: { type: "integer", minimum: 1 }, action: { enum: ["retry", "reconcile", "cancel"] } }),
  VerifiedModel: object({ backend_id: string, model: string, supported_efforts: array(effort, { minItems: 1 }), model_digest: nullable(string), runtime_version: { ...string, maxLength: 2048 }, verification_ref: hash }),
  Configuration: object({ revision: integer, current_revision: integer, digest: hash, history: array(object({ revision: integer, digest: hash })),
    configuration: object({ backends: map(object({ backend_id: string })), models: map(ref("VerifiedModel")), default: ref("Route"), overrides: map(ref("Route")) }) }),
  Receipt: object({ command_id: id, command_digest: hash, actor: string, action: { enum: Object.keys(actionInputs).filter(name => !name.startsWith("account.")) }, previous_revision: integer, revision: { type: "integer", minimum: 1 }, configuration_digest: hash, receipt_digest: hash }),
  Login: object({ command_id: id, request_digest: hash, backend_id: string, actor: string,
    state: { enum: ["starting", "waiting-for-operator", "cancel-requested", "connected", "cancelled", "failed", "interrupted"] },
    verification_url: nullable({ type: "string", format: "uri", maxLength: 2048 }), user_code: nullable({ ...string, maxLength: 128 }), failure: nullable(string) }),
  Projection: object({ schema_version: { const: 1 }, workflow_id: { const: "model-operations" }, request_id: id, revision: { type: "integer", minimum: 1 }, request: ref("Request"),
    state: { enum: ["queued", "running", "awaiting-account", "retryable", "unknown", "blocked", "completed", "cancelled", "rejected"] },
    owner_command_id: id, attempt: { type: "integer", minimum: 1 }, owner_receipt: nullable(ref("Receipt")), applied_configuration: nullable(ref("Configuration")), account_login: nullable(ref("Login")),
    failure: nullable(object({ code: string, retryable: { type: "boolean" } })),
    history: array(object({ sequence: { type: "integer", minimum: 1 }, type: string, state: string, occurred_at: { type: "string", format: "date-time" } }), { maxItems: 128 }),
    next_action: { enum: ["await-progress", "complete-account-sign-in", "retry-or-cancel", "reconcile-original-operation", "review-owner-evidence", "complete", "refresh-and-create-corrected-request"] } }),
  Registry: object({ schema_version: { const: 1 }, tasks: array(string), backends: array(object({ backend_id: string, provider: string, allowed_tasks: array(string), registered: { type: "boolean" }, account_login_supported: { type: "boolean" }, availability: { const: "not-probed" } })), configuration: ref("Configuration"), health: ref("ProviderHealth") }, ["schema_version", "tasks", "backends", "configuration"]),
  Catalogue: object({ backend_id: string, models: array(object({ model: string, supported_efforts: nullable(array(effort, { minItems: 1 })), model_digest: nullable(string), runtime_version: { ...string, maxLength: 2048 } })) }),
  List: object({ requests: array(ref("Projection"), { maxItems: 100 }), next_cursor: nullable(id) }),
};
for (const [name, schema] of Object.entries(components)) source = upsertOpenApiComponent(source, `ModelOperations${name}`, schema);

const input = { schema_version: 1, request_id: "model-operation:register-local", idempotency_key: "register-local-v1", expected_configuration_revision: 0, action: "backend.register", input: { backend_id: "local" } };
const queued = { schema_version: 1, workflow_id: "model-operations", request_id: input.request_id, revision: 1, request: input,
  state: "queued", owner_command_id: `oos-model:${"a".repeat(64)}:1`, attempt: 1, owner_receipt: null, applied_configuration: null, account_login: null, failure: null,
  history: [{ sequence: 1, type: "operator-intent-accepted", state: "queued", occurred_at: "2026-10-24T09:00:00Z" }], next_action: "reconcile-original-operation" };
const config = { backends: {}, models: {}, default: null, overrides: {} };
const snapshot = { revision: 0, current_revision: 0, digest: digest(config), configuration: config, history: [{ revision: 0, digest: digest(config) }] };
const operator = { name: "x-oos-operator-id", in: "header", required: true, schema: string };
const requestId = { name: "request_id", in: "path", required: true, schema: id };
const query = (name, schema, required = false) => ({ name, in: "query", required, schema });
const metadata = { security: [{ CallerIdHeader: [], CallerSecretHeader: [] }], "x-oos-owner": "operator-orchestration-service", "x-oos-surface": "model-operations", "x-oos-workflow-family": "model-operations", "x-oos-primary-caller": "governance-operations-console", tags: ["Model Operations"] };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 500, 502, 503].map(status => [status, { description: "Bounded authorization, validation, conflict, integrity or availability failure." }]));
function operation(name, summary, responseName, example, { parameters = [], body = null, status = 200 } = {}) {
  return { ...metadata, operationId: name, summary, description: "Platform owns model-management effects. OOS authenticates and retains exact operator intent, owner evidence and recovery. Source availability does not commission runtime.",
    parameters: [operator, ...parameters], ...(body ? { requestBody: { required: true, description: "Exact operator-owned intent or revision-bound recovery control; caller and operator authority come from authenticated headers.", content: { "application/json": { schema: ref(body.name), example: body.example } } } } : {}),
    responses: { [status]: { description: "Read the business state and authoritative next action.", content: { "application/json": { schema: ref(responseName), example } } }, ...errors } };
}
const routes = {
  "/v1/model-operations/registry": { get: operation("readModelOperationsRegistry", "Read admitted backends and revisioned configuration", "Registry", { schema_version: 1, tasks: [], backends: [], configuration: snapshot }, { parameters: [query("include_health", { type: "boolean" })] }) },
  "/v1/model-operations/catalogue": { get: operation("readModelOperationsCatalogue", "Discover admitted provider models and native effort metadata", "Catalogue", { backend_id: "local", models: [] }, { parameters: [query("backend_id", string, true), query("model", string)] }) },
  "/v1/model-operations/requests": {
    get: operation("listModelOperations", "List caller-owned model operations", "List", { requests: [queued], next_cursor: null }, { parameters: [query("limit", { type: "integer", minimum: 1, maximum: 100 }), query("cursor", id)] }),
    post: operation("createModelOperation", "Submit or replay immutable model-management intent", "Projection", queued, { body: { name: "Request", example: input }, status: 202 }),
  },
  "/v1/model-operations/requests/{request_id}": { get: operation("readModelOperation", "Read actual owner progress and safe next action", "Projection", queued, { parameters: [requestId] }) },
  "/v1/model-operations/requests/{request_id}/controls": { post: operation("controlModelOperation", "Retry, reconcile or cancel the retained operation", "Projection", queued, { parameters: [requestId], body: { name: "Control", example: { control_id: "reconcile-v1", expected_revision: 1, action: "reconcile" } } }) },
};
for (const [route, operations] of Object.entries(routes)) source = upsertOpenApiPath(source, route, operations);
if (check) { if (source !== original) throw new Error("Model Operations OpenAPI projection is stale."); }
else writeFileSync(file, source);
console.log(`Model Operations OpenAPI ${check ? "verified" : "synchronized"}.`);
