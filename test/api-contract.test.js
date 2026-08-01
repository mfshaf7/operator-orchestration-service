import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApp } from "../src/app.js";
import {
  loadOpenApiSpec,
  resolveRefObject,
  resolveOperation,
  validateExampleAgainstMediaType,
  validateValueAgainstSchema,
} from "../scripts/api_contract_tools.mjs";

function createBaseConfig() {
  return {
    callerAuth: {
      allowedIds: ["openclaw-telegram-enhanced", "codex-local"],
      sharedSecret: "test-secret",
    },
    openProject: {
      apiToken: "test-token",
      baseUrl: "http://example.test",
      capturedStatusId: 81,
      customFieldDeliveryRefId: 11,
      triagedStatusId: 82,
      parkedStatusId: 83,
      acceptedStatusId: 85,
      rejectedStatusId: 80,
      implementedStatusId: 86,
      deliveryCustomFieldOriginIdeaRefId: 12,
      deliveryCustomFieldPm2PhaseId: 13,
      deliveryCustomFieldTargetPiId: 14,
      deliveryNewStatusId: 88,
      deliveryProjectIdentifier: "workspace-delivery-art",
      deliveryTopLevelTypeId: 51,
      customFieldAffectedScopeId: 4,
      customFieldAiAssistLaneId: 9,
      customFieldSuspectedOwnerId: 3,
      customFieldSourceReferenceId: 2,
      customFieldSourceSurfaceId: 1,
      customFieldTriageConfidenceId: 8,
      customFieldTrustBoundaryAreasId: 5,
      hostHeader: "example.test",
      ideaTypeId: 41,
      projectIdentifier: "workspace-proposals",
    },
    ideaEvaluation: {
      ownerTokens: ["repo:operator-orchestration-service"],
      scopeTokens: ["repo:operator-orchestration-service"],
    },
    service: {
      gitCommit: "abc123",
      name: "operator-orchestration-service",
      version: "0.1.0-test",
    },
  };
}

async function executeRequest(app, { body, headers = {}, method, url }) {
  const request =
    body === undefined
      ? Readable.from([])
      : Readable.from([Buffer.from(JSON.stringify(body))]);

  request.method = method;
  request.url = url;
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  let statusCode = 200;
  let responseHeaders = {};
  let responseBody = "";

  const response = {
    end(chunk = "") {
      responseBody += chunk;
    },
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      responseHeaders = nextHeaders;
    },
  };

  await app(request, response);

  return {
    body: responseBody ? JSON.parse(responseBody) : null,
    headers: responseHeaders,
    statusCode,
  };
}

function getJsonMediaType(spec, method, routePath, kind) {
  const resolved = resolveOperation(spec, method, routePath);
  assert.ok(resolved, `expected documented route ${method} ${routePath}`);
  if (kind === "request") {
    return resolved.operation.requestBody?.content?.["application/json"] ?? null;
  }

  return resolved.operation.responses?.["200"]?.content?.["application/json"] ?? null;
}

test("documented /v1 examples conform to their OpenAPI schemas", () => {
  const spec = loadOpenApiSpec();

  for (const [routePath, operations] of Object.entries(spec.paths ?? {})) {
    if (!routePath.startsWith("/v1/")) {
      continue;
    }

    for (const [method, operation] of Object.entries(operations)) {
      if (!operation || typeof operation !== "object") {
        continue;
      }

      const requestJson = operation.requestBody?.content?.["application/json"];
      if (requestJson) {
        const requestErrors = validateExampleAgainstMediaType(
          spec,
          requestJson,
          `${method.toUpperCase()} ${routePath} request`,
        );
        assert.deepEqual(requestErrors, []);
      }

      const responseJson = operation.responses?.["200"]?.content?.["application/json"];
      if (responseJson) {
        const responseErrors = validateExampleAgainstMediaType(
          spec,
          responseJson,
          `${method.toUpperCase()} ${routePath} response`,
        );
        assert.deepEqual(responseErrors, []);
      }
    }
  }
});

test("representative broker responses conform to documented response schemas", async () => {
  const spec = loadOpenApiSpec();
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryWorkItemContinuationContext: async () => ({
        continuation_context: {
          delivery_epic: {
            architecture_anchor_ref: null,
            id: 38,
            initiative_family: "governed-ai-control-plane",
            lineage_role: "architecture-anchor",
            pm2_phase: "Executing",
            record_ref: "openproject://work_packages/38",
            required_upstream_ref: null,
            status: "in-progress",
            subject: "Productize governed local-agent platform",
            type: "Epic",
          },
          open_siblings: [],
          parent_chain: [],
          previously_completed_related_items: [],
          target_item: {
            execution_classification: null,
            id: 177,
            record_ref: "openproject://work_packages/177",
            status: "in-progress",
            subject:
              "Add supporting-component readiness contracts for shared stage and prod services",
            type: "Task",
          },
        },
        delivery_id: "delivery-38",
        delivery_record_ref: "openproject://work_packages/38",
        delivery_record_system: "openproject",
        work_item_id: "work-item-177",
        work_item_record_ref: "openproject://work_packages/177",
        work_item_record_system: "openproject",
        workflow_id: "delivery-work-item-continuation-context",
      }),
    },
    ideaService: {
      captureIdea: async (input) => ({
        idea_id: "idea-12",
        record_ref: "openproject://work_packages/12",
        record_system: "openproject",
        status: "captured",
        workflow_id: "idea-capture",
        title: input.title,
      }),
      listWorkflows: async () => ({
        workflows: [
          {
            summary:
              "Broker-owned command-family descriptor for creating and reading idea records without exposing backend-specific semantics to source adapters.",
            supports: {
              capture: true,
            },
            title: "Idea workflow",
            workflow_id: "idea-command",
          },
        ],
      }),
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const [workflowResponse, captureResponse, continuationResponse] = await Promise.all([
    executeRequest(app, {
      headers: {
        "x-oos-caller-id": "openclaw-telegram-enhanced",
        "x-oos-caller-secret": "test-secret",
      },
      method: "GET",
      url: "/v1/workflows",
    }),
    executeRequest(app, {
      body: {
        operator: {
          id: "1338752889",
        },
        source: {
          surface: "telegram",
        },
        title: "Need a durable place to store deferred ideas",
      },
      headers: {
        "Content-Type": "application/json",
        "x-oos-caller-id": "openclaw-telegram-enhanced",
        "x-oos-caller-secret": "test-secret",
      },
      method: "POST",
      url: "/v1/ideas/capture",
    }),
    executeRequest(app, {
      headers: {
        "x-oos-caller-id": "codex-local",
        "x-oos-caller-secret": "test-secret",
      },
      method: "GET",
      url: "/v1/delivery-work-items/work-item-177/continuation-context",
    }),
  ]);

  assert.equal(workflowResponse.statusCode, 200);
  assert.equal(captureResponse.statusCode, 200);
  assert.equal(continuationResponse.statusCode, 200);

  const workflowSchema = getJsonMediaType(spec, "GET", "/v1/workflows", "response").schema;
  const captureSchema = getJsonMediaType(spec, "POST", "/v1/ideas/capture", "response").schema;
  const continuationSchema = getJsonMediaType(
    spec,
    "GET",
    "/v1/delivery-work-items/{work_item_id}/continuation-context",
    "response",
  ).schema;

  assert.deepEqual(validateValueAgainstSchema(spec, workflowSchema, workflowResponse.body, "$workflow"), []);
  assert.deepEqual(validateValueAgainstSchema(spec, captureSchema, captureResponse.body, "$capture"), []);
  assert.deepEqual(
    validateValueAgainstSchema(spec, continuationSchema, continuationResponse.body, "$continuation"),
    [],
  );
});

test("non-200 response refs resolve for live probe validation", () => {
  const spec = loadOpenApiSpec();
  const resolved = resolveOperation(
    spec,
    "GET",
    "/v1/delivery-work-items/{work_item_id}/continuation-context",
  );
  assert.ok(resolved);

  const validationResponse = resolveRefObject(
    spec,
    resolved.operation.responses?.["422"],
  );
  const mediaType = validationResponse?.content?.["application/json"];
  assert.ok(mediaType);

  assert.deepEqual(
    validateValueAgainstSchema(
      spec,
      mediaType.schema,
      {
        error: "validation_failure",
        message: "Top-level delivery Epic shells are not executable work items.",
        details: "initiative_epic_not_executable",
      },
      "$response",
    ),
    [],
  );
});

test("planning repair request contract accepts risk posture fields", () => {
  const spec = loadOpenApiSpec();
  const requestSchema = getJsonMediaType(
    spec,
    "POST",
    "/v1/delivery-initiatives/{delivery_id}/plan/repair",
    "request",
  ).schema;

  const body = {
    input: {
      schema_version: 1,
      repairs: [
        {
          action: "execution_posture_correction",
          reason: "Record mitigated risk posture through the bounded repair path.",
          risk_disposition: "Mitigated by proportional work-home controls.",
          risk_owner: "Workspace Governance",
          risk_review_date: "2026-04-29",
          roam_state: "mitigated",
          target_work_item_id: "work-item-372",
        },
      ],
    },
  };

  assert.deepEqual(validateValueAgainstSchema(spec, requestSchema, body, "$request"), []);
});

test("idea consume response contract accepts intentionally blank target PI", () => {
  const spec = loadOpenApiSpec();
  const responseSchema = getJsonMediaType(
    spec,
    "POST",
    "/v1/ideas/{idea_id}/consume",
    "response",
  ).schema;

  const body = {
    delivery_created: true,
    delivery_pm2_phase: "Initiating",
    delivery_record_ref: "openproject://work_packages/650",
    delivery_record_system: "openproject",
    delivery_ref: "openproject://work_packages/650",
    delivery_status: "new",
    idea_id: "idea-649",
    owner_repo: "operator-orchestration-service",
    record_ref: "openproject://work_packages/649",
    record_system: "openproject",
    source_updated: true,
    status: "accepted",
    target_pi: null,
    updated_at: "2026-05-06T00:03:05.553Z",
    workflow_id: "accepted-idea-delivery-consume",
  };

  assert.deepEqual(validateValueAgainstSchema(spec, responseSchema, body, "$response"), []);
});

test("orchestration run-control identifiers enforce canonical API bounds", () => {
  const spec = loadOpenApiSpec();
  const schema = spec.components.schemas.OrchestrationRunControl;
  const validControl = {
    schema_version: 1,
    control_id: "control:retry:1",
    action: "retry",
    operator_id: "operator:mfshaf7",
    reason_ref: "decision:retry:1",
    idempotency_key: "control-retry-1",
  };

  assert.deepEqual(
    validateValueAgainstSchema(spec, schema, validControl, "$control"),
    [],
  );

  for (const field of [
    "control_id",
    "operator_id",
    "reason_ref",
    "idempotency_key",
  ]) {
    for (const invalidValue of ["", "identifier:unicode:\u00f8", "a".repeat(257)]) {
      const errors = validateValueAgainstSchema(
        spec,
        schema,
        { ...validControl, [field]: invalidValue },
        "$control",
      );
      assert.ok(errors.some((entry) => entry.startsWith(`$control.${field}:`)));
    }
  }

  for (const [field, reservedValue] of [
    [
      "control_id",
      "control:generation-retirement:0123456789abcdef0123456789abcdef",
    ],
    [
      "idempotency_key",
      "idempotency:generation-retirement:0123456789abcdef0123456789abcdef",
    ],
  ]) {
    const errors = validateValueAgainstSchema(
      spec,
      schema,
      { ...validControl, [field]: reservedValue },
      "$control",
    );
    assert.ok(errors.includes(`$control.${field}: value matches a forbidden schema`));
  }
});

test("orchestration run projection enforces nested canonical structures", () => {
  const spec = loadOpenApiSpec();
  const schema = spec.components.schemas.OrchestrationRunProjection;

  assert.deepEqual(
    validateValueAgainstSchema(spec, schema, schema.example, "$projection"),
    [],
  );

  const cases = [
    {
      expectedPath: "$projection.current_node",
      mutate(projection) {
        delete projection.current_node.node_id;
      },
    },
    {
      expectedPath: "$projection.events[0]",
      mutate(projection) {
        projection.events[0].raw_backend_payload = "not-admitted";
      },
    },
    {
      expectedPath: "$projection.controls[0]",
      mutate(projection) {
        projection.controls.push({});
      },
    },
    {
      expectedPath: "$projection.runtime",
      mutate(projection) {
        projection.runtime.unbounded_target = "not-admitted";
      },
    },
  ];

  for (const { expectedPath, mutate } of cases) {
    const projection = structuredClone(schema.example);
    mutate(projection);
    const errors = validateValueAgainstSchema(
      spec,
      schema,
      projection,
      "$projection",
    );
    assert.ok(errors.some((entry) => entry.startsWith(`${expectedPath}:`)));
  }
});
