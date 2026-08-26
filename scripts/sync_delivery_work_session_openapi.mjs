import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const decisionPath = path.join(
  repoRoot,
  "contracts",
  "delivery-art-work-session",
  "decision.schema.json",
);
const original = readFileSync(openApiPath, "utf8");
let synchronized = original;

const decisionSchema = JSON.parse(readFileSync(decisionPath, "utf8"));
delete decisionSchema.$schema;
delete decisionSchema.$id;

const nullableRevision = {
  oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
};
const commandId = {
  type: "string",
  pattern: "^work-session-command:[A-Za-z0-9._:-]+$",
  maxLength: 200,
};
const workItemId = {
  type: "string",
  pattern: "^(?:work-item-)?[1-9][0-9]*$",
};

const components = {
  DeliveryArtWorkSessionDecisionV1: decisionSchema,
  DeliveryArtWorkSessionStartRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "object",
        additionalProperties: false,
        required: ["command_id", "expected_session_revision"],
        properties: {
          command_id: commandId,
          expected_session_revision: nullableRevision,
          decision: { $ref: "#/components/schemas/DeliveryArtWorkSessionDecisionV1" },
        },
      },
    },
  },
  DeliveryArtWorkSessionCommandRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "object",
        additionalProperties: false,
        required: ["command_id", "expected_session_revision"],
        properties: {
          command_id: commandId,
          expected_session_revision: { type: "string", format: "date-time" },
        },
      },
    },
  },
  DeliveryArtWorkSessionNextActionV1: {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["authority", "code", "reason"],
    properties: {
      authority: { type: "string", minLength: 1 },
      code: { type: "string", minLength: 1 },
      reason: { type: "string", minLength: 1 },
    },
    description: "Exact next-action projection without a host shell command.",
  },
  DeliveryArtSourceObservationV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "base_commit",
      "branch",
      "changed_files",
      "head_commit",
      "state",
      "upstream_commit",
    ],
    properties: {
      base_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
      branch: { type: "string", minLength: 1 },
      changed_files: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
      head_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
      state: { type: "string", minLength: 1 },
      upstream_commit: {
        oneOf: [
          { type: "string", pattern: "^[0-9a-f]{40}$" },
          { type: "null" },
        ],
      },
    },
  },
  DeliveryArtWorkSessionCommandReceiptV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "command_id",
      "completed_at",
      "caller_id",
      "digest",
      "executor_id",
      "operator_id",
      "ref",
      "request_digest",
      "result_state",
      "work_item_id",
    ],
    properties: {
      caller_id: { type: "string", minLength: 1 },
      command_id: commandId,
      completed_at: { type: "string", format: "date-time" },
      digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      executor_id: { type: "string", minLength: 1 },
      operator_id: { type: "string", minLength: 1 },
      ref: { type: "string", pattern: "^oos://delivery-art/work-session-command-receipts/" },
      request_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      result_state: { type: "string", minLength: 1 },
      work_item_id: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
    },
  },
  DeliveryArtWorkSessionProjectionV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "delivery_id",
      "landing_unit_id",
      "next_action",
      "session_id",
      "session_revision",
      "state",
      "work_item_id",
      "workflow_id",
    ],
    properties: {
      workflow_id: { const: "delivery-art-work-session" },
      delivery_id: {
        oneOf: [
          { type: "string", pattern: "^delivery-[1-9][0-9]*$" },
          { type: "null" },
        ],
      },
      work_item_id: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      landing_unit_id: { type: ["string", "null"] },
      session_id: { type: ["string", "null"] },
      session_revision: nullableRevision,
      state: { type: "string", minLength: 1 },
      next_action: { $ref: "#/components/schemas/DeliveryArtWorkSessionNextActionV1" },
      decision_draft: { $ref: "#/components/schemas/DeliveryArtWorkSessionDecisionV1" },
      cleanup_receipt: { type: "object", additionalProperties: true },
      cleanup: { type: "object", additionalProperties: true },
      facts: { type: "object", additionalProperties: { type: "string" } },
      projection: { type: "object", additionalProperties: true },
      pull_request: { type: "object", additionalProperties: true },
      source: { $ref: "#/components/schemas/DeliveryArtSourceObservationV1" },
      replayed: { type: "boolean" },
      command_receipt: {
        $ref: "#/components/schemas/DeliveryArtWorkSessionCommandReceiptV1",
      },
    },
  },
  DeliveryArtWorkSessionErrorV1: {
    type: "object",
    additionalProperties: false,
    required: ["error", "message", "details"],
    properties: {
      error: { type: "string", minLength: 1 },
      message: { type: "string", minLength: 1 },
      details: { type: ["object", "null"], additionalProperties: true },
    },
  },
};

for (const [name, schema] of Object.entries(components)) {
  synchronized = upsertOpenApiComponent(synchronized, name, schema);
}

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const parameter = {
  name: "work_item_id",
  in: "path",
  required: true,
  schema: workItemId,
};
const operatorParameter = {
  name: "x-oos-operator-id",
  in: "header",
  required: true,
  description:
    "Accountable human operator identity admitted for the authenticated application caller.",
  schema: { type: "string", minLength: 1 },
};
const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionErrorV1" },
    },
  },
});
const responseExample = {
  workflow_id: "delivery-art-work-session",
  delivery_id: "delivery-886",
  work_item_id: "work-item-1024",
  landing_unit_id: "delivery-886-oos-work-session-api",
  session_id: "work-session:delivery-886:delivery-886-oos-work-session-api",
  session_revision: "2026-08-27T01:00:00Z",
  state: "source-work",
  next_action: {
    code: "source-work-required",
    reason: "Complete and validate the bounded source change.",
    authority: "operator-orchestration-service",
  },
  facts: { source: "unpushed" },
  projection: {
    complete: false,
    gate: "source-work",
    state: "source-work-required",
    summary: "Source work remains open.",
  },
  pull_request: { state: "missing" },
  source: {
    base_commit: "a".repeat(40),
    branch: "feature/1024-delivery-work-session-api",
    changed_files: ["src/delivery-art/work-session-service.js"],
    head_commit: "b".repeat(40),
    state: "unpushed",
    upstream_commit: null,
  },
};
const commandExample = {
  command: {
    command_id: "work-session-command:continue-1024-1",
    expected_session_revision: "2026-08-27T01:00:00Z",
  },
};
const startCommandExample = {
  command: {
    command_id: "work-session-command:start-1024-1",
    expected_session_revision: null,
  },
};
const operationMetadata = {
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-surface": "operator-facing",
  "x-oos-workflow-family": "delivery-work-session",
};
const commandOperation = ({ action, description, schemaName }) => ({
  post: {
    tags: ["Delivery ART"],
    summary: `${action[0].toUpperCase()}${action.slice(1)} a Delivery work session`,
    description,
    operationId: `${action}DeliveryArtWorkSession`,
    security,
    parameters: [parameter, operatorParameter],
    requestBody: {
      required: true,
      description: action === "start"
        ? "Provide a unique command id, the expected session revision, and optionally the accepted Landing Unit decision. Omitting the decision returns a caller-bound draft."
        : "Provide a unique command id and the exact session revision shown by the latest authoritative projection.",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schemaName}` },
          example: action === "start" ? startCommandExample : commandExample,
        },
      },
    },
    responses: {
      200: {
        description: "Authoritative work-session projection and command receipt.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionProjectionV1" },
            example: responseExample,
          },
        },
      },
      400: errorResponse("The command envelope is invalid."),
      401: errorResponse("Caller authentication is missing or invalid."),
      403: errorResponse("Caller identity is not bound to this work session."),
      409: errorResponse("The command is stale, conflicting, blocked, or requires reconciliation."),
      503: errorResponse("The admitted source executor or an authoritative dependency is unavailable."),
    },
    ...operationMetadata,
  },
});

const paths = {
  "/v1/delivery-work-items/{work_item_id}/work-session": {
    get: {
      tags: ["Delivery ART"],
      summary: "Read a Delivery work session",
      description: "Returns OOS-owned session state, exact next action, bounded source observation, and evidence references. The browser never derives Git or completion truth.",
      operationId: "getDeliveryArtWorkSession",
      security,
      parameters: [parameter, operatorParameter],
      responses: {
        200: {
          description: "Authoritative work-session projection.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionProjectionV1" },
              example: responseExample,
            },
          },
        },
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller identity is not bound to this work session."),
        503: errorResponse("The admitted source executor or an authoritative dependency is unavailable."),
      },
      ...operationMetadata,
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/start": commandOperation({
    action: "start",
    description: "Drafts the caller-bound Landing Unit decision when no decision is supplied, or starts one reconstructable session from an accepted decision. Replays are content-bound and return the retained receipt.",
    schemaName: "DeliveryArtWorkSessionStartRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/continue": commandOperation({
    action: "continue",
    description: "Runs only the next deterministic transition already authorized by the session and exact source observation. A stale session revision fails without execution.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/close": commandOperation({
    action: "close",
    description: "Completes bounded ART closeout only after finalized evidence and closeout readiness exist. Terminal cleanup remains part of this command and is receipt-backed.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
};

for (const [route, pathItem] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, route, pathItem);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Delivery work-session contract is stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
