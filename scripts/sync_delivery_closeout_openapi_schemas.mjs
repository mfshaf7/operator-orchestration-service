import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import {
  DELIVERY_CLOSEOUT_OPENAPI_SCHEMA_BINDINGS,
  deliveryCloseoutExternalRefMap,
  projectDeliveryCloseoutSchemaForOpenApi,
} from "./delivery_closeout_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "delivery-closeout");
const schemas = DELIVERY_CLOSEOUT_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8")),
}));
const externalRefMap = deliveryCloseoutExternalRefMap(schemas);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projectDeliveryCloseoutSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: spec.components.schemas[componentName],
    }),
  );
}

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const deliveryId = {
  name: "delivery_id",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^delivery-[1-9][0-9]*$" },
};
const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/DeliveryCloseoutErrorV1" },
    },
  },
});
const revisionBefore = `delivery-package:sha256:${"a".repeat(64)}`;
const revisionAfter = `delivery-package:sha256:${"b".repeat(64)}`;
const nextAction = {
  code: "inspect_delivery_outcome_history",
  label: "Inspect Outcome History",
  authority: "operator-orchestration-service",
};
const receipt = {
  ref: "oos://delivery-closeout-receipts/delivery-closeout-command:1030-1",
  digest: `sha256:${"c".repeat(64)}`,
};
const impact = { kind: "none" };
const eventExample = {
  schema_version: 1,
  event_id: "delivery-closeout-event:delivery-closeout-command:1030-1:result",
  command_id: "delivery-closeout-command:1030-1",
  command_digest: `sha256:${"d".repeat(64)}`,
  delivery_id: "delivery-886",
  operation_type: "apply_closeout",
  status: "applied",
  occurred_at: "2026-08-29T00:00:01Z",
  operator_id: "operator:workspace-owner",
  source_revision_before: revisionBefore,
  source_revision_after: revisionAfter,
  outcome_ref: "oos://delivery-closeout-outcomes/delivery-closeout-command:1030-1",
  impact,
  effect: { closeout: { action_applied: "close_initiative" } },
  next_action: nextAction,
  receipt,
};
const projectionExample = {
  schema_version: 1,
  delivery_id: "delivery-886",
  record_ref: "openproject://work_packages/886",
  source_revision: revisionBefore,
  projection_state: "ready",
  package: { subject: "Governed execution", status: "in-progress" },
  readiness: {
    readiness_ref: `openproject://work_packages/886#closeout-readiness@${revisionBefore}`,
    ready_for_closing: true,
    ready_for_closeout: true,
    reasons: [],
    counts: {
      blocked: 0,
      open_descendants: 0,
      weak_evidence: 0,
      weak_done_narrative: 0,
      without_evidence: 0,
      without_owner: 0,
    },
    evidence_refs: [],
  },
  outcome_history: [],
  last_event_ref: null,
  next_action: {
    code: "prepare_delivery_closeout",
    label: "Prepare Delivery Closeout",
    authority: "governance-operations-console",
  },
  projected_at: "2026-08-29T00:00:00Z",
};
const commandExample = {
  schema_version: 1,
  command_id: "delivery-closeout-command:1030-1",
  delivery_id: "delivery-886",
  expected_source_revision: revisionBefore,
  operator: { id: "operator:workspace-owner" },
  acceptance: {
    decision: "apply",
    accepted_at: "2026-08-29T00:00:00Z",
    accepted_by: "operator:workspace-owner",
    note: "Apply the reviewed Delivery closeout.",
  },
  operation: {
    type: "apply_closeout",
    payload: {
      evidence: {
        changed_surfaces: "- Delivery closeout API.",
        completion_summary: "Delivery work is complete.",
        demo_evidence: "System demo receipt.",
        demo_outcome: "reviewed",
        demo_summary: "Completed behavior was demonstrated.",
        evidence_refs: ["review-packet://delivery-886/final"],
        inspect_action_items: "- Retain outcome history.",
        inspect_summary: "Closeout evidence was inspected.",
        test_result_evidence: "- PASS: npm test",
        validation_evidence: "- PASS: composed closeout proof",
      },
      impact,
    },
  },
};
const resultExample = {
  schema_version: 1,
  command_id: commandExample.command_id,
  status: "applied",
  replayed: false,
  before: {
    record_ref: projectionExample.record_ref,
    source_revision: revisionBefore,
  },
  after: {
    record_ref: projectionExample.record_ref,
    source_revision: revisionAfter,
  },
  event: eventExample,
  receipt,
  next_action: nextAction,
};
const paths = {
  "/v1/delivery-initiatives/{delivery_id}/closeout": {
    get: {
      tags: ["Delivery Closeout"],
      summary: "Read authoritative Delivery closeout state",
      description: "Returns normalized canonical readiness, exact package revision, durable outcome history, and the next allowed closeout action. It does not project browser-derived completion or downstream release and Portfolio success.",
      operationId: "getDeliveryCloseoutProjection",
      security,
      parameters: [deliveryId],
      responses: {
        200: {
          description: "Current revision-bound Delivery closeout projection.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCloseoutProjectionV1" }, example: projectionExample } },
        },
        404: errorResponse("Delivery initiative was not found."),
        502: errorResponse("Canonical Delivery closeout truth could not be projected."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-closeout",
    },
  },
  "/v1/delivery-initiatives/{delivery_id}/closeout/commands": {
    post: {
      tags: ["Delivery Closeout"],
      summary: "Apply one reviewed Delivery closeout",
      description: "Validates exact package revision, current closeout readiness, durable command identity, evidence, typed impact, and accountable operator acceptance before composing the existing guided initiative close. Returns a replayable owner receipt and exact downstream action without performing Workspace Intake, release, or Portfolio mutation.",
      operationId: "applyDeliveryCloseoutCommand",
      security,
      parameters: [deliveryId],
      requestBody: {
        required: true,
        description: "Provide the exact projected revision, bounded closeout evidence, one typed impact classification, and explicit operator acceptance.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCloseoutCommandV1" }, example: commandExample } },
      },
      responses: {
        200: {
          description: "Idempotently replayed closeout result.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCloseoutResultV1" }, example: { ...resultExample, replayed: true } } },
        },
        201: {
          description: "Applied, partially completed, or explicitly rejected closeout result.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryCloseoutResultV1" }, example: resultExample } },
        },
        400: errorResponse("Command contract, target, evidence, impact, or operator acceptance is invalid."),
        404: errorResponse("Delivery initiative was not found."),
        409: errorResponse("Package revision, readiness, or accepted closeout state conflicts with the command."),
        502: errorResponse("An owning backend failed or returned incoherent evidence."),
        503: errorResponse("A required owner authority is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-closeout",
    },
  },
};

for (const [route, pathItem] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, route, pathItem);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Delivery closeout schemas or paths are stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
