import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const original = readFileSync(openapiPath, "utf8");
let source = original;
const check = process.argv.includes("--check");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "$id"].includes(key))
    .map(([key, entry]) => [
      key,
      key === "$ref" && entry.startsWith("#/$defs/")
        ? `#/components/schemas/${name}/$defs/${entry.slice(8)}`
        : project(entry, name),
    ]));
}

for (const [file, name] of [
  ["session-request.schema.json", "AgentConsoleSessionRequest"],
  ["invocation-request.schema.json", "AgentConsoleInvocationRequest"],
  ["session-projection.schema.json", "AgentConsoleSessionProjection"],
]) {
  const schema = JSON.parse(readFileSync(new URL(`contracts/agent-console/${file}`, root), "utf8"));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
const actionRequestName = "AgentConsoleActionRequest";
const actionRequest = JSON.parse(readFileSync(
  new URL("contracts/agent-action/schemas/agent-action-request.schema.json", root),
  "utf8",
));
source = upsertOpenApiComponent(source, actionRequestName, project(actionRequest, actionRequestName));
source = upsertOpenApiComponent(source, "AgentConsoleCloseRequest", {
  type: "object",
  additionalProperties: false,
  required: ["expected_revision", "closed_at"],
  properties: {
    expected_revision: { type: "integer", minimum: 1 },
    closed_at: { type: "string", format: "date-time" },
  },
});
source = upsertOpenApiComponent(source, "AgentConsoleActionOutcome", {
  type: "object",
  additionalProperties: false,
  required: ["action_receipt", "decision", "owner_receipt"],
  properties: {
    action_receipt: { type: "object", minProperties: 1 },
    decision: { type: "object", minProperties: 1 },
    owner_receipt: { oneOf: [{ type: "object", minProperties: 1 }, { type: "null" }] },
  },
});

const digest = (character) => `sha256:${character.repeat(64)}`;
const artifact = (uri, character) => ({ uri, digest: digest(character) });
const session = {
  schema_version: 1,
  session_id: "session-console-1",
  operator_id: "operator-1",
  agent: { logical_agent_id: "agent-console", instance_id: "agent-instance-1" },
  interaction_mode: "focused",
  opened_at: "2026-10-09T12:00:00Z",
  idempotency_key: "session-console-1",
};
const projection = {
  schema_version: 1,
  workflow_id: "agent-console",
  session_id: session.session_id,
  session_ref: artifact("oos://agent-console/sessions/session-console-1", "1"),
  revision: 1,
  state: "active",
  operator_id: session.operator_id,
  caller_id: "governance-operations-console",
  agent: session.agent,
  interaction_mode: session.interaction_mode,
  opened_at: session.opened_at,
  closed_at: null,
  current_invocation_id: null,
  current_action_id: null,
  invocation_count: 0,
  latest_invocation: null,
  latest_action_receipt_ref: null,
};
const invocation = {
  schema_version: 1,
  invocation_id: "invocation-console-1",
  correlation_id: "correlation-console-1",
  idempotency_key: "invocation-console-1",
  requested_at: "2026-10-09T12:00:01Z",
  prompt: "Summarize the admitted context.",
  candidate: {
    candidate_id: "candidate-console-1",
    scope: "page",
    source_authority: "governance-operations-console",
    source_mode: "live",
    source_ref: "console://pages/1",
    source_revision: "revision-7",
    captured_at: "2026-10-09T12:00:00Z",
    content: "Bounded visible page context.",
    content_digest: digest("2"),
  },
  budget_tokens: 1000,
};
const completed = structuredClone(projection);
completed.revision = 2;
completed.invocation_count = 1;
completed.latest_invocation = {
  invocation_id: invocation.invocation_id,
  correlation_id: invocation.correlation_id,
  state: "completed",
  requested_at: invocation.requested_at,
  completed_at: "2026-10-09T12:00:03Z",
  request_digest: digest("3"),
  context: {
    packet_ref: "/v1/context/packets/packet-1",
    redaction_receipt_ref: "/v1/context/receipts/redaction-1",
    projection_receipt_ref: "/v1/context/agent-console/projections/invocation-console-1",
    artifact_digest: digest("4"),
  },
  model: {
    profile_id: "agent-console-assistant-v1",
    binding_selection_ref: "platform://profiles/agent-console-assistant-v1",
    audit_ref: "local-ledger:agent-console-1",
  },
  result: { text: "The admitted context is healthy." },
  failure: null,
  receipt_ref: artifact("oos://agent-console/receipts/receipt-1", "5"),
  replayed: false,
};
const action = {
  schema_version: 1,
  artifact_type: "agent_action_request",
  request_id: "agent-action-request:console-1",
  requested_at: "2026-10-09T12:00:04Z",
  expires_at: "2026-10-09T12:05:04Z",
  action_class: "read",
  operator: {
    principal_id: "operator-1",
    session_ref: projection.session_ref,
    acceptance_ref: artifact("oos://agent-console/acceptance/1", "6"),
  },
  caller: {
    workload_id: "governance-operations-console",
    credential_binding_ref: artifact("oos://identities/console", "7"),
  },
  agent: session.agent,
  model_invocation_ref: null,
  workflow: {
    workflow_id: "agent-console",
    workflow_version: "1",
    execution_id: "agent-console-execution-1",
    command: "read-current-state",
  },
  target: {
    owner_repo: "operator-orchestration-service",
    resource_type: "agent-console-session",
    resource_id: session.session_id,
    source_version: "revision:2",
  },
  intent: { summary: "Read the current admitted session state.", digest: digest("8") },
  context: { packet_ref: null, receipt_ref: null },
  authority: {
    delegation_ref: artifact("wgcf://delegations/console", "b"),
    policy_profile_ref: artifact("wgcf://policy-profiles/agent-action-v1", "9"),
    approval_ref: null,
  },
  correlation: { correlation_id: invocation.correlation_id, causation_id: null },
  idempotency_key: "agent-console-action-1",
  integrity: { canonicalization: "RFC8785", algorithm: "sha256", content_digest: digest("a") },
};
const actionOutcome = {
  action_receipt: { receipt_id: "agent-action-receipt:console-1" },
  decision: { decision_id: "agent-action-decision:console-1", outcome: "allow" },
  owner_receipt: null,
};
const close = { expected_revision: 2, closed_at: "2026-10-09T12:00:04Z" };
const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const common = {
  tags: ["Agent Console"],
  security,
  description: "Caller- and operator-bound Agent Console orchestration. OOS admits only CGG model-safe packets, the governed AI access plane, and the canonical Agent Action enforcement path; route availability alone does not grant runtime activation or mutation authority.",
  "x-oos-surface": "agent-console",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-workflow-family": "agent-console",
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 502, 503].map((status) => [String(status), {
  description: "Bounded validation, authorization, conflict, integrity, or dependency failure.",
}]));
const operatorHeader = { name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } };
const sessionId = { name: "session_id", in: "path", required: true, schema: { type: "string" } };
const requestBody = (description, schema, example) => ({ required: true, description, content: { "application/json": { schema, example } } });
const response = (description, schema, example) => ({ description, content: { "application/json": { schema, example } } });

source = upsertOpenApiPath(source, "/v1/agent-console/sessions", { post: {
  ...common, operationId: "createAgentConsoleSession", summary: "Create or replay one Agent Console session",
  parameters: [operatorHeader], requestBody: requestBody("Exact operator-bound session identity.", ref("AgentConsoleSessionRequest"), session),
  responses: { 201: response("Session projection.", ref("AgentConsoleSessionProjection"), projection), ...errors },
} });
source = upsertOpenApiPath(source, "/v1/agent-console/sessions/{session_id}", { get: {
  ...common, operationId: "readAgentConsoleSession", summary: "Read one caller-owned Agent Console session",
  parameters: [sessionId, operatorHeader], responses: { 200: response("Current session projection.", ref("AgentConsoleSessionProjection"), projection), ...errors },
} });
source = upsertOpenApiPath(source, "/v1/agent-console/sessions/{session_id}/invocations", { post: {
  ...common, operationId: "invokeAgentConsole", summary: "Run one governed Agent Console invocation",
  parameters: [sessionId, operatorHeader], requestBody: requestBody("One exact prompt and context candidate; admission is recomputed downstream.", ref("AgentConsoleInvocationRequest"), invocation),
  responses: { 200: response("Terminal session projection with receipt binding.", ref("AgentConsoleSessionProjection"), completed), ...errors },
} });
source = upsertOpenApiPath(source, "/v1/agent-console/sessions/{session_id}/actions", { post: {
  ...common, operationId: "executeAgentConsoleAction", summary: "Evaluate and execute one canonical Agent Action",
  parameters: [sessionId, operatorHeader], requestBody: requestBody("Canonical action request bound to the current session and operator.", ref("AgentConsoleActionRequest"), action),
  responses: { 200: response("Terminal policy, action, and optional owner receipt evidence.", ref("AgentConsoleActionOutcome"), actionOutcome), ...errors },
} });
source = upsertOpenApiPath(source, "/v1/agent-console/sessions/{session_id}/close", { post: {
  ...common, operationId: "closeAgentConsoleSession", summary: "Close one revision-bound Agent Console session",
  parameters: [sessionId, operatorHeader], requestBody: requestBody("Expected revision and terminal timestamp.", ref("AgentConsoleCloseRequest"), close),
  responses: { 200: response("Closed session projection.", ref("AgentConsoleSessionProjection"), { ...completed, revision: 3, state: "closed", closed_at: close.closed_at }), ...errors },
} });

if (check) {
  if (source !== original) throw new Error("Agent Console OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log(`Agent Console OpenAPI ${check ? "verified" : "synchronized"}.`);
