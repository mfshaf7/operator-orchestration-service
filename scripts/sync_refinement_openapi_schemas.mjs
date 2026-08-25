import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";
import {
  projectRefinementSchemaForOpenApi,
  REFINEMENT_OPENAPI_SCHEMA_BINDINGS,
  refinementExternalRefMap,
} from "./refinement_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "refinement");
const schemas = REFINEMENT_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8")),
}));
const externalRefMap = refinementExternalRefMap(schemas);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projectRefinementSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: spec.components.schemas[componentName],
    }),
  );
}

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const packageParameter = {
  name: "package_id",
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 512 },
};
const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/RefinementErrorV1" } } },
});
const operationExample = {
  operation_id: "delivery-package:909-governance",
  kind: "governance",
  label: "Update Initiative Governance",
  detail: "Apply accepted package-level governance values.",
  target: "openproject://work_packages/884",
  oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
  status: "planned",
};
const packetExample = {
  schema_version: 1,
  packet_id: "refinement-packet:delivery-package:909",
  packet_revision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  status: "ready_for_review",
  active_step: "readiness_review",
  source: {
    delivery_id: "delivery-884",
    package_ref: "delivery-package:909",
    source_ref: "openproject://work_packages/909",
    source_revision: "version-5",
    source_work_design_receipt_id: "work-design-application:receipt-1",
    tree_snapshot_ref: "tree://work-design/receipt-1",
    finalized_brief_ref: "brief://work-design/receipt-1/final",
  },
  target_tree: {
    id: "884",
    kind: "Epic",
    title: "Deliver Refinement runtime",
    description: "",
    draft_body: "",
    remark: "",
    children: [],
  },
  draft_groups: [{
    group_id: "delivery-package:909-governance",
    title: "Initiative Governance",
    summary: "Review package-level metadata.",
    fields: [{
      field_key: "initiative-target-pi",
      backend_field: "target_pi",
      label: "Target PI",
      field_kind: "select",
      required: true,
      status: "complete",
      value: "PI-2026-03",
      allowed_values: ["PI-2026-03", "PI-2026-04"],
      target_node_ids: ["884"],
      target_values: { "884": "PI-2026-03" },
      validation_hint: "Target PI must resolve for the selected initiative.",
      route_binding: {
        operation_kind: "governance",
        oos_route: "POST /v1/delivery-initiatives/{delivery_id}/governance",
        payload_key: "target_pi",
        target: "initiative",
      },
    }],
  }],
  readiness_gates: [{
    gate_id: "delivery-package:909-metadata-review",
    label: "Metadata Review",
    detail: "Every required metadata target has a current value.",
    status: "passed",
  }],
  apply_plan: {
    summary: "Apply reviewed metadata.",
    expected_routes: ["POST /v1/delivery-initiatives/{delivery_id}/governance"],
    operations: [operationExample],
  },
  last_saved_at: "2026-08-26T01:00:00Z",
};
const runExample = {
  schema_version: 1,
  request_id: "refinement-apply-1",
  correlation_id: "correlation-1",
  run_id: "refinement-run:example-1",
  state: "accepted",
  replayed: false,
  submitted_at: "2026-08-26T01:00:00Z",
  updated_at: "2026-08-26T01:00:00Z",
  poll_ref: "/v1/delivery-refinement/delivery-package:909/runs/refinement-run:example-1",
  events: [],
  receipt: null,
  failure: null,
};
const adviceExample = {
  schema_version: 1,
  request_id: "refinement-assist-1",
  correlation_id: "correlation-1",
  response_id: "refinement-response:example-1",
  status: "ready",
  confidence: "medium",
  required_operator_action: "review",
  suggestion: {
    field_key: "initiative-target-pi",
    value: "PI-2026-04",
    summary: "Use the next admitted increment.",
    rationale: "The operator requested a bounded alternative.",
    resolution: "ai_drafted",
  },
  evidence: {
    generated_at: "2026-08-26T01:00:00Z",
    model_profile_id: "delivery-refinement-advisor-v1",
    task_contract_ref: "oos.delivery-refinement.v1",
    output_schema_ref: "platform-engineering/security/schemas/delivery-refinement-advice.schema.json",
    cgg_packet_ref: "/v1/context/packets/refinement-packet-1",
    redaction_receipt_ref: "/v1/context/receipts/refinement-receipt-1",
    gateway_audit_ref: "local-ledger:refinement-1",
  },
};
const paths = {
  "/v1/delivery-refinement/{package_id}/projection": {
    get: {
      tags: ["Delivery Refinement"],
      summary: "Read the canonical Refinement packet and durable run state",
      description: "Projects the current Work Design handoff, canonical Delivery tree, Refinement packet, and OOS-owned run history without fixture fallback.",
      operationId: "projectDeliveryRefinement",
      security,
      parameters: [
        packageParameter,
        {
          name: "source_ref",
          in: "query",
          required: true,
          schema: { type: "string", pattern: "^openproject://work_packages/[1-9][0-9]*$" },
        },
      ],
      responses: {
        200: {
          description: "Current canonical Refinement packet and durable run projection.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefinementProjectionResultV1" },
              example: {
                schema_version: 1,
                package_ref: "delivery-package:909",
                source_revision: "version-5",
                packet: packetExample,
                active_run: null,
                latest_run: null,
                history: [],
                projected_at: "2026-08-26T01:00:00Z",
              },
            },
          },
        },
        400: errorResponse("Invalid projection request."),
        502: errorResponse("Canonical packet or durable receipt history could not be projected safely."),
        503: errorResponse("Canonical Refinement dependencies are unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-refinement",
    },
  },
  "/v1/delivery-refinement/{package_id}/assist": {
    post: {
      tags: ["Delivery Refinement"],
      summary: "Request governed advice for one Refinement field",
      description: "Verifies the exact packet field, admits only its model-safe context through CGG, and returns suggestion-only advice for operator review.",
      operationId: "assistDeliveryRefinement",
      security,
      parameters: [packageParameter],
      requestBody: {
        required: true,
        description: "Provide the exact current packet and one selected metadata target for suggestion-only advice.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefinementAssistRequestV1" },
            example: {
              schema_version: 1,
              request_id: "refinement-assist-1",
              correlation_id: "correlation-1",
              delivery_id: "delivery-884",
              package_ref: "delivery-package:909",
              source_ref: "openproject://work_packages/909",
              source_revision: "version-5",
              operator: { id: "operator:workspace-owner" },
              task: { kind: "metadata_advice", contract_ref: "oos.delivery-refinement.v1", version: "1.0" },
              packet: {
                packet_id: "refinement-packet:delivery-package:909",
                packet_revision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                source_work_design_receipt_id: "work-design-application:receipt-1",
              },
              target: {
                field_key: "initiative-target-pi",
                field_label: "Target PI",
                field_kind: "select",
                required: true,
                source_value: "PI-2026-03",
                draft_value: "",
                selected_node_ids: ["884"],
                allowed_values: ["PI-2026-03", "PI-2026-04"],
              },
              operator_prompt: "Check the selected planning increment.",
            },
          },
        },
      },
      responses: {
        200: {
          description: "Typed, receipt-bound Refinement advice.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefinementAssistResultV1" },
              example: adviceExample,
            },
          },
        },
        400: errorResponse("The request or operator binding is invalid."),
        409: errorResponse("The packet changed before advice was requested."),
        502: errorResponse("CGG or governed model output violated the admitted binding."),
        503: errorResponse("The governed profile or provider is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-refinement",
    },
  },
  "/v1/delivery-refinement/{package_id}/apply": {
    post: {
      tags: ["Delivery Refinement"],
      summary: "Start durable application of one operator-accepted Refinement packet",
      description: "Verifies immutable packet custody and explicit operator acceptance before starting the versioned recoverable Temporal definition. Success remains pending until canonical readback and receipt persistence complete.",
      operationId: "applyDeliveryRefinement",
      security,
      parameters: [packageParameter],
      requestBody: {
        required: true,
        description: "Provide the immutable accepted packet, metadata resolutions, idempotency key, and explicit operator acceptance.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefinementApplyRequestV1" },
            example: {
              schema_version: 1,
              request_id: "refinement-apply-1",
              correlation_id: "correlation-1",
              idempotency_key: "refinement-apply-909-version-5",
              delivery_id: "delivery-884",
              package_ref: "delivery-package:909",
              source_ref: "openproject://work_packages/909",
              source_revision: "version-5",
              operator: { id: "operator:workspace-owner" },
              acceptance: {
                decision: "apply",
                accepted_at: "2026-08-26T01:00:00Z",
                accepted_by: "operator:workspace-owner",
                note: "Apply reviewed metadata.",
              },
              accepted_draft: {
                packet_id: "refinement-packet:delivery-package:909",
                packet_revision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                draft_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                source_work_design_receipt_id: "work-design-application:receipt-1",
                metadata_values: { target_pi: "PI-2026-03" },
                metadata_resolutions: { target_pi: "accepted" },
                apply_plan: {
                  summary: "Apply reviewed metadata.",
                  expected_routes: ["POST /v1/delivery-initiatives/{delivery_id}/governance"],
                  operations: [operationExample],
                },
              },
            },
          },
        },
      },
      responses: {
        202: {
          description: "Durable Refinement run accepted or replayed.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefinementRunProjectionV1" },
              example: runExample,
            },
          },
        },
        400: errorResponse("The accepted draft or operator acceptance is invalid."),
        409: errorResponse("The accepted packet is stale or the idempotency binding conflicts."),
        503: errorResponse("The durable Refinement runtime is inactive or unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-refinement",
    },
  },
  "/v1/delivery-refinement/{package_id}/runs/{run_id}": {
    get: {
      tags: ["Delivery Refinement"],
      summary: "Read one durable Refinement run",
      description: "Returns the queryable run timeline, terminal failure, or canonical readback receipt for one package-bound run.",
      operationId: "getDeliveryRefinementRun",
      security,
      parameters: [
        packageParameter,
        { name: "run_id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 512 } },
      ],
      responses: {
        200: {
          description: "Current durable Refinement run projection.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefinementRunProjectionV1" },
              example: { ...runExample, state: "running" },
            },
          },
        },
        404: errorResponse("The package-bound Refinement run does not exist."),
        503: errorResponse("The durable runtime is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-refinement",
    },
  },
};
for (const [routePath, operation] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, routePath, operation);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "ERROR: Refinement OpenAPI schemas are not synchronized; " +
      "run npm run sync:refinement-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("Refinement OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized Refinement OpenAPI schemas");
}
