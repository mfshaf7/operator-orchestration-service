import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApp } from "../src/app.js";

function createBaseConfig() {
  return {
    callerAuth: {
      allowedIds: ["openclaw-telegram-enhanced"],
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
      ownerTokens: [
        "repo:operator-orchestration-service",
        "repo:openclaw-telegram-enhanced",
        "product:openclaw",
        "component:operator-orchestration-service",
      ],
      scopeTokens: [
        "repo:operator-orchestration-service",
        "repo:openclaw-telegram-enhanced",
        "product:openclaw",
        "component:operator-orchestration-service",
      ],
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

test("health and version endpoints are available without caller auth", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const [healthResponse, versionResponse] = await Promise.all([
    executeRequest(app, {
      method: "GET",
      url: "/healthz",
    }),
    executeRequest(app, {
      method: "GET",
      url: "/version",
    }),
  ]);

  assert.equal(healthResponse.statusCode, 200);
  assert.deepEqual(healthResponse.body, {
    ok: true,
    status: "live",
  });

  assert.equal(versionResponse.statusCode, 200);
  assert.deepEqual(versionResponse.body, {
    callerAuthMode: "required",
    gitCommit: "abc123",
    service: "operator-orchestration-service",
    version: "0.1.0-test",
  });
});

test("capture endpoint enforces caller auth before invoking the service", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      captureIdea: async () => {
        throw new Error("captureIdea should not be called");
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {},
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    url: "/v1/ideas/capture",
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, {
    details: null,
    error: "caller_auth_required",
    message: "Caller id header is required.",
  });
});

test("capture endpoint returns the broker response when the service succeeds", async () => {
  const captureCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      captureIdea: async (input) => {
        captureCalls.push(input);
        return {
          idea_id: "idea-12",
          record_ref: "openproject://work_packages/12",
          record_system: "openproject",
          status: "captured",
          workflow_id: "idea-capture",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      body: "One of the most common triggers for new ideas is discussion with Codex.",
      operator: {
        handle: "mfshaf7",
        id: "1338752889",
      },
      source: {
        context_ref: {
          conversation_id: "-1002519919856",
          thread_id: "1",
        },
        integration_id: "default",
        native_ref: {
          command: "idea",
          message_id: "123",
        },
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
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    idea_id: "idea-12",
    record_ref: "openproject://work_packages/12",
    record_system: "openproject",
    status: "captured",
    workflow_id: "idea-capture",
  });

  assert.equal(captureCalls.length, 1);
  assert.equal(captureCalls[0].callerId, "openclaw-telegram-enhanced");
  assert.equal(captureCalls[0].source.surface, "telegram");
  assert.equal(captureCalls[0].source.native_ref.message_id, "123");
  assert.equal(captureCalls[0].title, "Need a durable place to store deferred ideas");
  assert.match(captureCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("capture endpoint still accepts the legacy source plus source_ref payload", async () => {
  const captureCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      captureIdea: async (input) => {
        captureCalls.push(input);
        return {
          idea_id: "idea-14",
          record_ref: "openproject://work_packages/14",
          record_system: "openproject",
          status: "captured",
          workflow_id: "idea-capture",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      operator: {
        id: "1338752889",
      },
      source: "telegram",
      source_ref: {
        accountId: "default",
        chatId: "-1002519919856",
        chatType: "supergroup",
        command: "idea",
        messageId: "123",
        messageThreadId: "1",
      },
      title: "Legacy payload still works",
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/capture",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(captureCalls[0].source.surface, "telegram");
  assert.equal(captureCalls[0].source.integration_id, "default");
  assert.equal(captureCalls[0].source.context_ref.conversation_id, "-1002519919856");
  assert.equal(captureCalls[0].source.native_ref.message_id, "123");
});

test("workflow descriptor endpoint returns broker-owned guidance", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      getWorkflowDescriptor: async ({ workflowId }) => ({
        lifecycle_note:
          "The canonical backlog supports the full status model now. Telegram currently exposes capture, operator-authored triage, bounded decision for `parked`, `accepted`, and `rejected`, plus list, list all, and show. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet, and `owner-assigned` remains broker-managed until an explicit owner vocabulary is enabled.",
        lifecycle_statuses: [
          {
            meaning: "Raw record exists, but no approved triage or ownership decision exists yet.",
            next_step:
              "Review the captured record, then move it into triage or park it in the canonical backlog.",
            status: "captured",
          },
        ],
        summary: "Create the canonical record in OpenProject.",
        title: "Idea capture",
        workflow_id: workflowId,
      }),
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/workflows/idea-capture",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "idea-capture");
  assert.equal(response.body.title, "Idea capture");
  assert.equal(response.body.lifecycle_statuses[0].status, "captured");
});

test("idea read endpoint returns the normalized broker projection", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      getIdea: async ({ ideaId }) => ({
        body: "Need a bounded read path.",
        created_at: "2026-04-18T10:00:00Z",
        evaluation: {
          affected_scope: ["repo:operator-orchestration-service"],
          ai_assist_lane: "local",
          confidence: "medium",
          notes: "Broker owns the canonical workflow contract.",
          suspected_owner: "repo:operator-orchestration-service",
          trust_boundary_areas: ["runtime", "ai"],
        },
        idea_id: ideaId,
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
        operator_decision_notes: null,
        record_ref: "openproject://work_packages/40",
        record_system: "openproject",
        source: {
          native_ref: {
            message_id: "985",
          },
          surface: "telegram",
        },
        status: "captured",
        title: "Bounded read path",
        triage_summary: null,
        updated_at: "2026-04-18T10:05:00Z",
        workflow_id: "idea-capture",
      }),
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/ideas/idea-40",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.idea_id, "idea-40");
  assert.equal(response.body.source.surface, "telegram");
  assert.equal(
    response.body.evaluation.suspected_owner,
    "repo:operator-orchestration-service",
  );
});

test("idea list endpoint returns a bounded status-bearing projection", async () => {
  const listCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      listIdeas: async (input) => {
        listCalls.push(input);
        const { limit, offset, status } = input;
        return {
        ideas: [
          {
            body_preview: "Need a bounded read path.",
            created_at: "2026-04-18T10:00:00Z",
            idea_id: "idea-41",
            record_ref: "openproject://work_packages/41",
            record_system: "openproject",
            source: {
              surface: "telegram",
            },
            status: "captured",
            title: "Bounded read path",
            updated_at: "2026-04-18T10:05:00Z",
            workflow_id: "idea-capture",
          },
        ],
        page: {
          count: 1,
          has_more: false,
          limit,
          next_offset: null,
          offset,
          previous_offset: null,
          total: 1,
        },
      };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/ideas?limit=5&offset=1",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.page.limit, 5);
  assert.equal(response.body.ideas[0].idea_id, "idea-41");
  assert.equal(response.body.ideas[0].status, "captured");
  assert.equal(listCalls[0].status, null);
});

test("idea list endpoint forwards a normalized status filter", async () => {
  const listCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      listIdeas: async (input) => {
        listCalls.push(input);
        return {
          ideas: [],
          page: {
            count: 0,
            has_more: false,
            limit: input.limit,
            next_offset: null,
            offset: input.offset,
            previous_offset: null,
            total: 0,
          },
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/ideas?limit=5&offset=1&status=parked",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(listCalls[0].status, "parked");
});

test("idea list endpoint rejects unknown status filters", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      listIdeas: async () => {
        throw new Error("listIdeas should not be called");
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/ideas?status=unknown",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /status must be one of/);
});

test("idea triage endpoint forwards the operator-authored summary", async () => {
  const triageCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      triageIdea: async (input) => {
        triageCalls.push(input);
        return {
          idea_id: input.ideaId,
          record_ref: "openproject://work_packages/41",
          record_system: "openproject",
          status: "triaged",
          triage_summary: input.summary,
          updated_at: "2026-04-19T12:00:00Z",
          workflow_id: "idea-triage",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        summary: "Needs a bounded broker workflow before later decision handling.",
      },
      operator: {
        handle: "mfshaf7",
        id: "1338752889",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/idea-41/triage",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "triaged");
  assert.equal(
    triageCalls[0].summary,
    "Needs a bounded broker workflow before later decision handling.",
  );
  assert.equal(triageCalls[0].ideaId, "idea-41");
});

test("idea decision endpoint forwards the bounded status and notes", async () => {
  const decisionCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      decideIdea: async (input) => {
        decisionCalls.push(input);
        return {
          idea_id: input.ideaId,
          operator_decision_notes: input.notes,
          record_ref: "openproject://work_packages/41",
          record_system: "openproject",
          status: input.status,
          updated_at: "2026-04-19T12:30:00Z",
          workflow_id: "idea-decision",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        notes: "Revisit this after the owner-assigned vocabulary lands.",
        status: "parked",
      },
      operator: {
        handle: "mfshaf7",
        id: "1338752889",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/idea-41/decision",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "parked");
  assert.equal(
    decisionCalls[0].notes,
    "Revisit this after the owner-assigned vocabulary lands.",
  );
  assert.equal(decisionCalls[0].status, "parked");
  assert.equal(decisionCalls[0].ideaId, "idea-41");
});

test("idea evaluation endpoint records internal metadata with canonical tokens", async () => {
  const evaluationCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      recordIdeaEvaluation: async (input) => {
        evaluationCalls.push(input);
        return {
          evaluation: {
            affected_scope: [
              "repo:operator-orchestration-service",
              "repo:openclaw-telegram-enhanced",
            ],
            ai_assist_lane: "local",
            confidence: "medium",
            notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
            suspected_owner: "repo:operator-orchestration-service",
            trust_boundary_areas: ["runtime", "ai"],
          },
          idea_id: input.ideaId,
          record_ref: "openproject://work_packages/41",
          record_system: "openproject",
          status: "triaged",
          updated_at: "2026-04-19T13:00:00Z",
          workflow_id: "idea-evaluation-metadata",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        affected_scope: [
          "repo:operator-orchestration-service",
          "repo:openclaw-telegram-enhanced",
        ],
        ai_assist_lane: "local",
        confidence: "medium",
        notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
        suspected_owner: "repo:operator-orchestration-service",
        trust_boundary_areas: ["runtime", "ai"],
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/idea-41/evaluation",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.body.evaluation.suspected_owner,
    "repo:operator-orchestration-service",
  );
  assert.deepEqual(evaluationCalls[0].evaluation, {
    affectedScope: [
      "repo:operator-orchestration-service",
      "repo:openclaw-telegram-enhanced",
    ],
    aiAssistLane: "local",
    confidence: "medium",
    notes: "Broker owns the workflow contract and Telegram is a thin adapter.",
    suspectedOwner: "repo:operator-orchestration-service",
    trustBoundaryAreas: ["runtime", "ai"],
  });
  assert.equal(evaluationCalls[0].ideaId, "idea-41");
  assert.match(evaluationCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("idea consume endpoint forwards the operator context and optional target PI", async () => {
  const consumeCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      consumeIdea: async (input) => {
        consumeCalls.push(input);
        return {
          delivery_created: true,
          delivery_pm2_phase: "Initiating",
          delivery_record_ref: "openproject://work_packages/77",
          delivery_record_system: "openproject",
          delivery_status: "new",
          delivery_ref: "openproject://work_packages/77",
          idea_id: input.ideaId,
          record_ref: "openproject://work_packages/41",
          record_system: "openproject",
          source_updated: true,
          status: "accepted",
          target_pi: input.targetPi,
          updated_at: "2026-04-19T14:05:00Z",
          workflow_id: "accepted-idea-delivery-consume",
        };
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        target_pi: "PI-2026-02",
      },
      operator: {
        handle: "mfshaf7",
        id: "1338752889",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/idea-41/consume",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "accepted-idea-delivery-consume");
  assert.equal(response.body.delivery_record_ref, "openproject://work_packages/77");
  assert.equal(consumeCalls[0].ideaId, "idea-41");
  assert.equal(consumeCalls[0].targetPi, "PI-2026-02");
  assert.match(consumeCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("idea consume endpoint fails closed when delivery config is incomplete", async () => {
  const config = createBaseConfig();
  config.openProject.deliveryProjectIdentifier = "";

  const app = createApp({
    config,
    ideaService: {
      consumeIdea: async () => {
        throw new Error("consumeIdea should not be called");
      },
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
      operator: {
        id: "1338752889",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/idea-41/consume",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "accepted_idea_delivery_not_configured");
  assert.match(response.body.message, /OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER/);
});

test("idea lookup endpoint accepts normalized source input", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      lookupIdea: async ({ source }) => ({
        body: "Need a bounded read path.",
        created_at: "2026-04-18T10:00:00Z",
        idea_id: "idea-40",
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
        operator_decision_notes: null,
        record_ref: "openproject://work_packages/40",
        record_system: "openproject",
        source,
        status: "captured",
        title: "Bounded read path",
        triage_summary: null,
        updated_at: "2026-04-18T10:05:00Z",
        workflow_id: "idea-capture",
      }),
    },
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      source: {
        native_ref: {
          command: "idea",
          message_id: "985",
        },
        surface: "telegram",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/lookup",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.idea_id, "idea-40");
  assert.equal(response.body.source.native_ref.message_id, "985");
});
