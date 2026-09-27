import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const schemaPath = new URL(
  "contracts/workflow-activity/workflow-activity-page.schema.json",
  root,
);
const original = readFileSync(openapiPath, "utf8");
const componentName = "WorkflowActivityPage";
const schema = projectReferences(
  JSON.parse(readFileSync(schemaPath, "utf8")),
  componentName,
);
delete schema.$schema;
delete schema.$id;
schema["x-oos-canonical-schema"] =
  "contracts/workflow-activity/workflow-activity-page.schema.json";

let source = upsertOpenApiComponent(original, componentName, schema);
source = upsertOpenApiPath(source, "/v1/workflow-activity", {
  get: {
    tags: ["Workflow Activity"],
    operationId: "listWorkflowActivity",
    summary: "Read bounded cross-workflow activity",
    description:
      "Caller-bound, read-only chronology composed from canonical OOS workflow owners. Partial or unavailable owners remain explicit and never fall back to browser-local receipts or raw logs.",
    security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
    parameters: [
      query("cursor", "Opaque cursor bound to the complete filter set."),
      query("source_id", "Registered canonical activity source."),
      query("category", "Activity category."),
      query("outcome", "Activity outcome."),
      query("subject_ref", "Exact canonical subject reference."),
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    ],
    responses: {
      "200": {
        description: "Bounded canonical activity page or explicit partial projection.",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${componentName}` },
            example: {
              schema_version: 1,
              artifact_type: "workflow-activity-page",
              projection_status: "current",
              observed_at: "2026-09-28T01:00:00.000Z",
              filters: {
                source_id: null,
                category: null,
                outcome: null,
                subject_ref: null,
              },
              events: [],
              next_cursor: null,
              sources: [],
            },
          },
        },
      },
      "400": { description: "Invalid filter, limit, or cursor binding." },
      "401": { description: "Caller authentication is missing or invalid." },
      "403": { description: "Caller identity is not admitted for canonical activity reads." },
      "502": { description: "Canonical owner projections conflict." },
      "503": { description: "Workflow activity projection is not configured." },
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "workflow-activity",
    "x-oos-workflow-family": "workflow-activity",
  },
});

if (process.argv.includes("--check")) {
  if (source !== original) {
    throw new Error("Workflow Activity OpenAPI projection is stale.");
  }
} else {
  writeFileSync(openapiPath, source, "utf8");
}
process.stdout.write("Workflow Activity OpenAPI projection is current.\n");

function query(name, description) {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema: { type: "string", minLength: 1 },
  };
}

function projectReferences(value, name) {
  if (Array.isArray(value)) return value.map((entry) => projectReferences(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (key === "$ref" && typeof entry === "string" && entry.startsWith("#/$defs/")) {
      return [key, `#/components/schemas/${name}/${entry.slice(2)}`];
    }
    return [key, projectReferences(entry, name)];
  }));
}
