import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import {
  DELIVERY_CHANGE_OPENAPI_SCHEMA_BINDINGS,
  deliveryChangeExternalRefMap,
  projectDeliveryChangeSchemaForOpenApi,
} from "./delivery_change_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "delivery-change");
const schemas = DELIVERY_CHANGE_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8")),
}));
const externalRefMap = deliveryChangeExternalRefMap(schemas);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projectDeliveryChangeSchemaForOpenApi({
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
      schema: { $ref: "#/components/schemas/DeliveryChangeErrorV1" },
    },
  },
});
const revisionBefore = `delivery-package:sha256:${"a".repeat(64)}`;
const revisionAfter = `delivery-package:sha256:${"b".repeat(64)}`;
const projectionExample = {
  schema_version: 1,
  delivery_id: "delivery-886",
  record_ref: "openproject://work_packages/886",
  source_revision: revisionBefore,
  projection_state: "current",
  package: {
    execution_tree: {
      id: 886,
      record_ref: "openproject://work_packages/886",
      status: "in progress",
      subject: "Governed Console Execution",
      type: "Epic",
      children: [],
    },
    dependency_relations: [],
  },
  last_event_ref: null,
  projected_at: "2026-08-29T00:00:00Z",
};
const commandExample = {
  schema_version: 1,
  command_id: "delivery-change-command:1028-1",
  delivery_id: "delivery-886",
  expected_source_revision: revisionBefore,
  operator: { id: "operator:workspace-owner" },
  acceptance: {
    decision: "apply",
    accepted_at: "2026-08-29T00:00:00Z",
    accepted_by: "operator:workspace-owner",
    note: "Apply the reviewed subject correction.",
  },
  operation: {
    type: "revise_work_item",
    payload: {
      work_item_id: "work-item-1028",
      changes: { subject: "Authoritative Delivery change contracts" },
    },
  },
};
const nextAction = {
  code: "refresh_delivery_package",
  label: "Refresh Delivery Package",
  authority: "operator-orchestration-service",
};
const receipt = {
  ref: "oos://delivery-change-receipts/delivery-change-command:1028-1",
  digest: `sha256:${"c".repeat(64)}`,
};
const eventExample = {
  schema_version: 1,
  event_id: "delivery-change-event:delivery-change-command:1028-1",
  command_id: "delivery-change-command:1028-1",
  command_digest: `sha256:${"d".repeat(64)}`,
  delivery_id: "delivery-886",
  operation_type: "revise_work_item",
  status: "applied",
  occurred_at: "2026-08-29T00:00:01Z",
  operator_id: "operator:workspace-owner",
  source_revision_before: revisionBefore,
  source_revision_after: revisionAfter,
  effect: { work_item_id: "work-item-1028" },
  rollback: {
    mode: "compensating_command_required",
    reason: "Rollback requires a new reviewed command against the current package revision.",
  },
  next_action: nextAction,
  receipt,
};
const resultExample = {
  schema_version: 1,
  command_id: "delivery-change-command:1028-1",
  status: "applied",
  replayed: false,
  before: {
    record_ref: "openproject://work_packages/886",
    source_revision: revisionBefore,
  },
  after: {
    record_ref: "openproject://work_packages/886",
    source_revision: revisionAfter,
  },
  event: eventExample,
  receipt,
  next_action: nextAction,
};
const paths = {
  "/v1/delivery-initiatives/{delivery_id}/change-control": {
    get: {
      tags: ["Delivery Change Control"],
      summary: "Read the authoritative in-flight Delivery package",
      description: "Returns the current Delivery tree, dependencies, durable event reference, and canonical semantic source revision used to prepare reviewed mutation commands.",
      operationId: "getDeliveryChangeProjection",
      security,
      parameters: [deliveryId],
      responses: {
        200: {
          description: "Current revision-bound Delivery package projection.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryChangeProjectionV1" }, example: projectionExample } },
        },
        404: errorResponse("Delivery initiative was not found."),
        502: errorResponse("Canonical Delivery package truth could not be projected."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-change-control",
    },
  },
  "/v1/delivery-initiatives/{delivery_id}/change-control/commands": {
    post: {
      tags: ["Delivery Change Control"],
      summary: "Apply one reviewed in-flight Delivery change",
      description: "Validates exact package revision, durable command identity, operator acceptance, and owner boundaries before composing one existing Delivery or Catalog authority. Returns before/after revision evidence, durable receipt, rollback disposition, and exact next action.",
      operationId: "applyDeliveryChangeCommand",
      security,
      parameters: [deliveryId],
      requestBody: {
        required: true,
        description: "Provide one typed change, the exact current package revision, a durable command id, and explicit accountable-operator acceptance.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryChangeCommandV1" }, example: commandExample } },
      },
      responses: {
        200: {
          description: "Idempotently replayed command result.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryChangeResultV1" }, example: { ...resultExample, replayed: true } } },
        },
        201: {
          description: "Applied, routed, partially applied, or explicitly rejected command result.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/DeliveryChangeResultV1" }, example: resultExample } },
        },
        400: errorResponse("Command contract, target, or operator acceptance is invalid."),
        404: errorResponse("Delivery initiative or work item was not found."),
        409: errorResponse("Package revision or canonical mutation state conflicts with the command."),
        502: errorResponse("An owning backend failed or returned incoherent evidence."),
        503: errorResponse("A required owner authority is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-change-control",
    },
  },
};

for (const [route, pathItem] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, route, pathItem);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Delivery change schemas or paths are stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
