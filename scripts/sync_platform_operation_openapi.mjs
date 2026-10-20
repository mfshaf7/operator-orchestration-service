import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import { PLATFORM_OPERATION_ACTIONS } from "../src/platform-operation/contracts.js";
import { SOURCE_CREDENTIAL_ACTIONS } from "../src/platform-operation/source-credentials.js";
import { sourceCredentialSchemas, sourcePreparationExample, sourcePreparationRequestExample } from "./source_credential_openapi_schemas.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const original = readFileSync(openApiPath, "utf8");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const auth = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const errors = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "401": { $ref: "#/components/responses/UnauthorizedError" },
  "403": { $ref: "#/components/responses/ForbiddenError" },
  "409": { $ref: "#/components/responses/ConflictError" },
  "503": {
    description: "The Platform operation adapter or owner is unavailable.",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
        example: {
          details: null,
          error: "platform_operation_provider_unavailable",
          message: "Platform operation provider could not be reached.",
        },
      },
    },
  },
};
const actions = PLATFORM_OPERATION_ACTIONS;
const identifier = { type: "string", minLength: 1, maxLength: 256 };

const commandExample = {
  schema_version: 1,
  command_id: "command:accepted-idea-delivery:start:1",
  idempotency_key: "idempotency:accepted-idea-delivery:start:1",
  correlation_id: "correlation:accepted-idea-delivery:1",
  causation_id: null,
  actor_ref: "operator:workspace-owner",
  subject: {
    kind: "dev-integration-profile",
    ref: "profile:accepted-idea-delivery",
    expected_source_version: "version:42",
  },
  capability_id: "dev-integration.accepted-idea-delivery.start",
  action: "dev-integration.start",
  input: {},
  requested_at: "2026-10-15T00:00:00.000Z",
  intent_digest: `sha256:${"a".repeat(64)}`,
  approval: {
    decision: "approved",
    operator_id: "operator:workspace-owner",
    decision_ref: "approval:accepted-idea-delivery:start:1",
    decided_at: "2026-10-15T00:00:00.000Z",
    intent_digest: `sha256:${"a".repeat(64)}`,
  },
};
const ownerProjectionExample = {
  schema_version: 1,
  operation_id: "platform-owner-operation:accepted-idea-delivery:start:1",
  command_id: commandExample.command_id,
  correlation_id: commandExample.correlation_id,
  state: "succeeded",
  attempt: 1,
  subject_ref: commandExample.subject.ref,
  capability_id: commandExample.capability_id,
  action: commandExample.action,
  retryable: false,
  cancel_available: false,
  blocker: null,
  failure: null,
  receipt: {
    receipt_ref: "platform://receipts/accepted-idea-delivery-start-1",
    outcome: "succeeded",
    recorded_at: "2026-10-15T00:00:01.000Z",
    source_version: "version:43",
    effect: "verified",
  },
  safe_log_ref: "cgg:packet:platform-operation-1",
  updated_at: "2026-10-15T00:00:01.000Z",
  events: [{
    event_id: "event:accepted-idea-delivery:start:1",
    sequence: 1,
    state: "succeeded",
    occurred_at: "2026-10-15T00:00:01.000Z",
    summary: "Platform owner projected current operation state.",
  }],
};
const recordExample = {
  schema_version: 1,
  workflow_id: "platform-operation",
  operation_id: "platform-operation:0123456789abcdef01234567",
  command: commandExample,
  state: "succeeded",
  provider_operation: ownerProjectionExample,
  security_decision: {
    uri: "github://mfshaf7/security-architecture/commit/review.md",
    digest: `sha256:${"b".repeat(64)}`,
    revision: "b".repeat(40),
  },
  controls: [],
  next_action: {
    code: "complete",
    authority: "operator",
    reason: "Platform receipt and owner readback are terminal.",
  },
  created_at: "2026-10-15T00:00:00.000Z",
  updated_at: "2026-10-15T00:00:01.000Z",
  reconciled: false,
  replayed: false,
};
const catalogExample = {
  schema_version: 1,
  catalog_id: "platform-console-operations",
  source_version: "version:42",
  observed_at: "2026-10-15T00:00:00.000Z",
  freshness: "current",
  subjects: [{
    kind: "dev-integration-profile",
    ref: "profile:accepted-idea-delivery",
    source_version: "version:42",
    owner: "platform-engineering",
    capabilities: [{
      capability_id: "dev-integration.accepted-idea-delivery.start",
      action: "dev-integration.start",
      available: true,
      unavailable_reason: null,
      required_capability: "platform.dev-integration.start",
      approval_required: true,
      destructive: false,
    }],
  }],
};

const schemas = {
  ...sourceCredentialSchemas,
  PlatformOperationCommand: {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "command_id", "idempotency_key", "correlation_id", "causation_id", "actor_ref", "subject", "capability_id", "action", "input", "requested_at", "intent_digest", "approval"],
    allOf: [{ if: { properties: { action: { enum: SOURCE_CREDENTIAL_ACTIONS } }, required: ["action"] },
      then: { properties: { input: ref("SourceCredentialOperationInput"), subject: { properties: { kind: { const: "dev-integration-profile" } } } } } }],
    properties: {
      schema_version: { const: 1 },
      command_id: identifier,
      idempotency_key: identifier,
      correlation_id: identifier,
      causation_id: { oneOf: [identifier, { type: "null" }] },
      actor_ref: identifier,
      subject: {
        type: "object", additionalProperties: false,
        required: ["kind", "ref", "expected_source_version"],
        properties: {
          kind: { enum: ["dev-integration-profile", "profile-request", "product-release", "product-runtime-lifecycle"] },
          ref: identifier,
          expected_source_version: identifier,
        },
      },
      capability_id: identifier,
      action: { enum: actions },
      input: { type: "object" },
      requested_at: { type: "string", format: "date-time" },
      intent_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      approval: {
        type: "object", additionalProperties: false,
        required: ["decision", "operator_id", "decision_ref", "decided_at", "intent_digest"],
        properties: {
          decision: { const: "approved" }, operator_id: identifier, decision_ref: identifier,
          decided_at: { type: "string", format: "date-time" },
          intent_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
        },
      },
    },
  },
  PlatformOperationControl: {
    type: "object", additionalProperties: false,
    required: ["schema_version", "control_id", "idempotency_key", "action", "operator_id", "reason", "requested_at"],
    properties: {
      schema_version: { const: 1 }, control_id: identifier, idempotency_key: identifier,
      action: { enum: ["retry", "cancel"] }, operator_id: identifier,
      reason: { type: "string", minLength: 1, maxLength: 1024 },
      requested_at: { type: "string", format: "date-time" },
    },
  },
  PlatformOperationCatalog: {
    type: "object", additionalProperties: false,
    required: ["schema_version", "catalog_id", "source_version", "observed_at", "freshness", "subjects"],
    properties: {
      schema_version: { const: 1 }, catalog_id: identifier, source_version: identifier,
      observed_at: { type: "string", format: "date-time" }, freshness: { enum: ["current", "stale", "unavailable"] },
      subjects: { type: "array", maxItems: 512, items: { type: "object" } },
    },
  },
  PlatformOwnerOperationProjection: {
    type: "object", additionalProperties: false,
    required: Object.keys(ownerProjectionExample),
    properties: {
      schema_version: { const: 1 }, operation_id: identifier, command_id: identifier, correlation_id: identifier,
      state: { enum: ["requested", "queued", "running", "blocked", "succeeded", "failed", "cancelled"] },
      attempt: { type: "integer", minimum: 1 }, subject_ref: identifier, capability_id: identifier,
      action: { enum: actions }, retryable: { type: "boolean" }, cancel_available: { type: "boolean" },
      blocker: { oneOf: [{ type: "object" }, { type: "null" }] },
      failure: { oneOf: [{ type: "object" }, { type: "null" }] },
      receipt: { oneOf: [{ type: "object" }, { type: "null" }] },
      safe_log_ref: { oneOf: [identifier, { type: "null" }] },
      updated_at: { type: "string", format: "date-time" },
      events: { type: "array", maxItems: 1024, items: { type: "object" } },
    },
  },
  PlatformOperationRecord: {
    type: "object", additionalProperties: false,
    required: Object.keys(recordExample),
    properties: {
      schema_version: { const: 1 }, workflow_id: { const: "platform-operation" }, operation_id: identifier,
      command: ref("PlatformOperationCommand"),
      state: { enum: ["requested", "queued", "running", "blocked", "succeeded", "failed", "cancelled"] },
      provider_operation: ref("PlatformOwnerOperationProjection"),
      security_decision: { type: "object" }, controls: { type: "array", items: { type: "object" } },
      next_action: { type: "object" }, created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" }, reconciled: { type: "boolean" }, replayed: { type: "boolean" },
    },
  },
  PlatformOperationList: {
    type: "object", additionalProperties: false, required: ["workflow_id", "operations"],
    properties: { workflow_id: { const: "platform-operation-list" }, operations: { type: "array", maxItems: 200, items: ref("PlatformOperationRecord") } },
  },
};

const meta = {
  security: auth,
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-surface": "operator-facing",
  "x-oos-workflow-family": "platform-operation",
};
const success = (description, schema, example, status = "200") => ({
  [status]: { description, content: { "application/json": { schema, example } } },
  ...errors,
});
const paths = {
  "/v1/platform-operations/source-preparations": {
    get: { ...meta, tags: ["Platform Operations"], summary: "List caller-owned source credential preparations", operationId: "listSourceCredentialPreparations",
      description: "Reads bounded canonical source preparations and retained secret-free authorization metadata. It never issues or renews credentials.",
      parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } }],
      responses: success("Caller-owned source preparations.", ref("SourceCredentialPreparationList"), { workflow_id: "source-credential-preparation-list", preparations: [sourcePreparationExample] }) },
    post: { ...meta, tags: ["Platform Operations"], summary: "Prepare canonical source scope before explicit issue approval", operationId: "prepareSourceCredential",
      description: "Derives immutable source coordinates from an actual Delivery work-start decision or admitted Prototype source request. Preparation is read-only with respect to source repositories and provider credentials; it is not approval or issuance.",
      requestBody: { required: true, description: "Stable preparation identity and canonical workflow selector; repository/provider coordinates cannot be supplied by the browser.", content: { "application/json": { schema: ref("SourceCredentialPreparationRequest"), example: sourcePreparationRequestExample } } },
      responses: success("Immutable preparation with current secret-free authorization state.", ref("SourceCredentialPreparation"), sourcePreparationExample, "201") },
  },
  "/v1/platform-operations/source-preparations/{intent_id}": { get: { ...meta, tags: ["Platform Operations"], summary: "Recover one caller-owned canonical source preparation", operationId: "getSourceCredentialPreparation",
    description: "Reads the original immutable scope and retained approval/receipt metadata without issuing, renewing or altering source state.", parameters: [{ name: "intent_id", in: "path", required: true, schema: identifier }],
    responses: { ...success("Retained canonical source preparation.", ref("SourceCredentialPreparation"), sourcePreparationExample), "404": { $ref: "#/components/responses/NotFoundError" } } } },
  "/v1/platform-operations/catalog": { get: { ...meta, tags: ["Platform Operations"], summary: "Read current Platform operation capabilities", description: "Returns the bounded Platform-owned capability projection used to bind commands to exact subjects and source versions. Stale or unavailable truth is visible but cannot admit a command.", operationId: "getPlatformOperationCatalog", responses: success("Current Platform capability projection.", ref("PlatformOperationCatalog"), catalogExample) } },
  "/v1/platform-operations/commands": { post: { ...meta, tags: ["Platform Operations"], summary: "Submit one approved Platform operation", description: "Persists one exact operator-approved command before dispatch to the Platform owner. Replays return the retained record; conflicts fail closed.", operationId: "submitPlatformOperation", requestBody: { required: true, description: "Exact command, canonical intent digest, idempotency binding, and operator approval.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["command"], properties: { command: ref("PlatformOperationCommand") } }, example: { command: commandExample } } } }, responses: success("Accepted durable operation record.", ref("PlatformOperationRecord"), recordExample, "202") } },
  "/v1/platform-operations": { get: { ...meta, tags: ["Platform Operations"], summary: "List durable Platform operations", description: "Returns bounded OOS-retained operations and exact next actions without exposing provider credentials or raw logs.", operationId: "listPlatformOperations", parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } }], responses: success("Bounded operation list.", ref("PlatformOperationList"), { workflow_id: "platform-operation-list", operations: [recordExample] }) } },
  "/v1/platform-operations/{operation_id}": { get: { ...meta, tags: ["Platform Operations"], summary: "Read and reconcile one Platform operation", description: "Reads one retained operation and reconciles non-terminal owner state by immutable command identity. Terminal receipts are served from durable OOS state.", operationId: "getPlatformOperation", parameters: [{ name: "operation_id", in: "path", required: true, schema: identifier }], responses: { ...success("Current operation record.", ref("PlatformOperationRecord"), { ...recordExample, reconciled: true }), "404": { $ref: "#/components/responses/NotFoundError" } } } },
  "/v1/platform-operations/{operation_id}/controls": { post: { ...meta, tags: ["Platform Operations"], summary: "Retry or cancel one Platform operation", description: "Persists an idempotent retry or cancel request before dispatch. Unknown outcomes remain blocked for owner reconciliation and may only be replayed with the same immutable control binding.", operationId: "controlPlatformOperation", parameters: [{ name: "operation_id", in: "path", required: true, schema: identifier }], requestBody: { required: true, description: "One bounded operator control with its own idempotency binding.", content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["control"], properties: { control: ref("PlatformOperationControl") } }, example: { control: { schema_version: 1, control_id: "control:cancel:1", idempotency_key: "idempotency:control:cancel:1", action: "cancel", operator_id: "operator:workspace-owner", reason: "Stop before another owner effect.", requested_at: "2026-10-15T00:00:02.000Z" } } } } }, responses: { ...success("Updated operation record.", ref("PlatformOperationRecord"), recordExample), "404": { $ref: "#/components/responses/NotFoundError" } } } },
};

let synchronized = original;
for (const [name, schema] of Object.entries(schemas)) synchronized = upsertOpenApiComponent(synchronized, name, schema);
for (const [route, operation] of Object.entries(paths)) synchronized = upsertOpenApiPath(synchronized, route, operation);

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Platform operation surface is stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
