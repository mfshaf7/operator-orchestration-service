import { readFileSync, writeFileSync } from "node:fs";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { addConsoleSourceProjectionMedia } from "./console_source_authority_openapi_tools.mjs";

const target = new URL("../docs/api/openapi.json", import.meta.url);
const original = readFileSync(target, "utf8");
const closed = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: "string" }, timestamp = { type: "string", format: "date-time" }, digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const nullable = value => ({ oneOf: [value, { type: "null" }] });
const raw = { type: "string", maxLength: 2097152, description: "Exact bounded UTF-8 payload. Canvas fractional coordinates remain JSON text; this is not a formal governance artifact." };
const schemas = {
  SavedWorkCommand: closed({ command_id: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,160}$" }, expected_revision: { type: "integer", minimum: 0 }, payload_json: raw, origin: { enum: ["operator-edit", "browser-import"] } }),
  SavedWorkOriginal: closed({ storage_key: text, raw_value: raw }),
  SavedWorkRecovery: closed({ recovery_id: { type: "string", pattern: "^[0-9a-f]{64}$" }, storage_key: text, content_digest: digest, preserved_at: timestamp }),
  SavedWorkRecord: closed({ revision: { type: "integer", minimum: 1 }, saved_at: timestamp, content_digest: digest, payload_json: raw,
    acknowledgement_id: { type: "string", pattern: "^saved-work:" }, origin: { enum: ["operator-edit", "browser-import"] } }),
  SavedWorkSnapshot: closed({ schema_version: { const: 1 }, kind: { enum: ["work-design", "refinement", "orchestration"] }, subject_id: text,
    record: nullable(ref("SavedWorkRecord")), recoveries: { type: "array", maxItems: 100, items: ref("SavedWorkRecovery") }, recovery: nullable(ref("SavedWorkOriginal")) }),
};
let source = original;
for (const [name, value] of Object.entries(schemas)) source = upsertOpenApiComponent(source, name, value);
const parameters = [{ name: "kind", in: "path", required: true, schema: schemas.SavedWorkSnapshot.properties.kind },
  { name: "subject_id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,200}$" } },
  { name: "x-oos-operator-id", in: "header", required: true, schema: text }];
const common = { tags: ["Saved Operator Work"], security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  "x-oos-owner": "operator-orchestration-service", "x-oos-primary-caller": "governance-operations-console", "x-oos-surface": "operator-facing", "x-oos-workflow-family": "operator-saved-work" };
const example = { schema_version: 1, kind: "refinement", subject_id: "delivery-42", record: null, recoveries: [], recovery: null };
const responses = { 200: { description: "Exact owner snapshot and save acknowledgement, separate from canonical workflow approval or apply.",
  content: { "application/json": { schema: ref("SavedWorkSnapshot"), example } } },
  400: { $ref: "#/components/responses/ValidationError" }, 401: { $ref: "#/components/responses/UnauthorizedError" },
  403: { description: "Caller or bound operator is not admitted." }, 409: { description: "Revision, replay or finalized-version conflict; original content retained." },
  413: { description: "Bounded payload limit exceeded." }, 503: { description: "Private storage, integrity or accepted runtime unavailable." } };
source = upsertOpenApiPath(source, "/v1/operator-saved-work/{kind}/{subject_id}", addConsoleSourceProjectionMedia({
  get: { ...common, operationId: "readOperatorSavedWork", summary: "Recover one operator's saved workflow draft",
    description: "Reads one caller/operator-bound subject and bounded browser-original metadata. An optional recovery selector retrieves exact original bytes. This never applies work or reconstructs missing originals.",
    parameters: [...parameters, { name: "recovery_id", in: "query", required: false, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } }], responses },
  post: { ...common, operationId: "saveOperatorWork", summary: "Save inert workflow content or preserve original browser bytes",
    description: "Default saves compare an expected revision and acknowledge exact durable content. action=preserve retains raw current/older browser records separately. Neither action approves a brief, applies ART, executes definitions, invokes models, or attests historical authorship.",
    parameters: [...parameters, { name: "action", in: "query", required: false, schema: { const: "preserve" } }], responses,
    requestBody: { required: true, description: "A revision-bound save command, or exact original-record preservation input when action=preserve.",
      content: { "application/json": { schema: { oneOf: [ref("SavedWorkCommand"), ref("SavedWorkOriginal")] }, example: { command_id: "save-example", expected_revision: 0,
        payload_json: JSON.stringify({ schemaVersion: 1, packageId: "delivery-42", metadata: { draftValues: {} } }), origin: "browser-import" } } } } },
}, "get"));
if (process.argv.includes("--check")) {
  if (source !== original) { console.error("Saved-work OpenAPI is stale."); process.exitCode = 1; }
  else console.log("Saved-work OpenAPI is current.");
} else { writeFileSync(target, source); console.log("Saved-work OpenAPI synchronized."); }
