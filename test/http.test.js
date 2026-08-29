import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { OpenProjectError } from "../src/errors.js";
import {
  createOrchestrationService,
  OrchestrationServiceError,
} from "../src/orchestration/service.js";
import { ControlledProofContractError } from "../src/orchestration/controlled-proof-contracts.js";
import {
  OrchestrationGenerationCapacityExhaustedError,
} from "../src/orchestration/temporal-adapter.js";
import {
  TEST_ACTIVATION_EVIDENCE_DIGEST,
  validOrchestrationActivationEnv,
  validOrchestrationRequest,
} from "../test-fixtures/orchestration.js";

function createBaseConfig() {
  return {
    callerAuth: {
      allowedIds: ["openclaw-telegram-enhanced"],
      sharedSecret: "test-secret",
    },
    deliveryArt: {
      workSession: {
        callerOperatorBindings: {},
      },
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
      customFieldProposalWorkflowStateId: 52,
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
    orchestration: {
      runtimeEnabled: false,
      workerEnabled: false,
      executionAuthorized: false,
      activationEvidence: {
        manifestPath: "",
        manifestDigest: "",
      },
      temporal: {
        address: "temporal.test:7233",
        namespace: "default",
        identity: "oos-test-worker",
      },
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

test("Proposal workflow routes expose the typed service without bypassing caller identity", async () => {
  const calls = [];
  const proposalWorkflowService = {
    async applyCommand(input) {
      calls.push(["apply", input]);
      return { replayed: false, receipt: { receipt_ref: "receipt:1" } };
    },
    async applyHandoff(input) {
      calls.push(["applyHandoff", input]);
      return { replayed: false, receipt: { receipt_ref: "receipt:handoff" } };
    },
    async getEvent(input) {
      calls.push(["event", input]);
      return { event_id: input.eventId };
    },
    async getHistory(input) {
      calls.push(["history", input]);
      return { cursor: input.cursor, events: [] };
    },
    async getProjection(input) {
      calls.push(["projection", input]);
      return { proposal_id: input.proposalId };
    },
  };
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {},
    proposalWorkflowService,
  });
  const headers = {
    "Content-Type": "application/json",
    "x-oos-caller-id": "openclaw-telegram-enhanced",
    "x-oos-caller-secret": "test-secret",
  };

  const projection = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/proposals/idea-851/projection",
  });
  const command = await executeRequest(app, {
    body: { schema_version: 1 },
    headers,
    method: "POST",
    url: "/v1/proposals/idea-851/commands",
  });
  const handoff = await executeRequest(app, {
    body: { schema_version: 1 },
    headers,
    method: "POST",
    url: "/v1/proposals/idea-851/handoff/apply",
  });
  const event = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/proposals/idea-851/events/proposal-event%3A851%3A1",
  });
  const history = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/proposals/idea-851/history?cursor=cursor%3A2",
  });

  assert.equal(projection.statusCode, 200);
  assert.equal(command.statusCode, 201);
  assert.equal(handoff.statusCode, 201);
  assert.equal(event.statusCode, 200);
  assert.equal(history.statusCode, 200);
  assert.equal(calls.length, 5);
  assert.equal(calls[0][1].callerId, "openclaw-telegram-enhanced");
  assert.equal(calls[1][1].proposalId, "idea-851");
  assert.equal(calls[2][0], "applyHandoff");
  assert.equal(calls[2][1].proposalId, "idea-851");
  assert.equal(calls[3][1].eventId, "proposal-event:851:1");
  assert.equal(calls[4][1].cursor, "cursor:2");
});

test("Delivery change routes preserve caller identity and initiative binding", async () => {
  const calls = [];
  const deliveryChangeService = {
    async getProjection(input) {
      calls.push(["projection", input]);
      return { delivery_id: input.deliveryId };
    },
    async applyCommand(input) {
      calls.push(["command", input]);
      return { command_id: input.command.command_id, replayed: false };
    },
  };
  const app = createApp({
    config: createBaseConfig(),
    deliveryChangeService,
    ideaService: {},
    openProjectClient: {},
  });
  const headers = {
    "Content-Type": "application/json",
    "x-oos-caller-id": "openclaw-telegram-enhanced",
    "x-oos-caller-secret": "test-secret",
  };

  const projection = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/delivery-initiatives/delivery-886/change-control",
  });
  const command = await executeRequest(app, {
    body: { command_id: "delivery-change-command:1028-1" },
    headers,
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-886/change-control/commands",
  });

  assert.equal(projection.statusCode, 200);
  assert.equal(command.statusCode, 201);
  assert.deepEqual(calls, [
    ["projection", {
      callerId: "openclaw-telegram-enhanced",
      deliveryId: "delivery-886",
    }],
    ["command", {
      callerId: "openclaw-telegram-enhanced",
      command: { command_id: "delivery-change-command:1028-1" },
      deliveryId: "delivery-886",
    }],
  ]);
});

test("Delivery closeout routes preserve caller, revision command, and replay status", async () => {
  const calls = [];
  const deliveryCloseoutService = {
    async getProjection(input) {
      calls.push(["projection", input]);
      return { delivery_id: input.deliveryId };
    },
    async applyCommand(input) {
      calls.push(["command", input]);
      return { command_id: input.command.command_id, replayed: false };
    },
  };
  const app = createApp({
    config: createBaseConfig(),
    deliveryCloseoutService,
    ideaService: {},
    openProjectClient: {},
  });
  const headers = {
    "Content-Type": "application/json",
    "x-oos-caller-id": "openclaw-telegram-enhanced",
    "x-oos-caller-secret": "test-secret",
  };

  const projection = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/delivery-initiatives/delivery-886/closeout",
  });
  const command = await executeRequest(app, {
    body: { command_id: "delivery-closeout-command:1030-1" },
    headers,
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-886/closeout/commands",
  });

  assert.equal(projection.statusCode, 200);
  assert.equal(command.statusCode, 201);
  assert.equal(calls[0][0], "projection");
  assert.equal(calls[0][1].callerId, "openclaw-telegram-enhanced");
  assert.equal(calls[0][1].deliveryId, "delivery-886");
  assert.match(calls[0][1].correlationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[1], ["command", {
    callerId: "openclaw-telegram-enhanced",
    command: { command_id: "delivery-closeout-command:1030-1" },
    deliveryId: "delivery-886",
  }]);
});

test("Proposal workflow routes fail early when machine-state persistence is absent", async () => {
  const config = createBaseConfig();
  config.openProject.customFieldProposalWorkflowStateId = null;
  const app = createApp({
    config,
    ideaService: {},
    openProjectClient: {},
    proposalWorkflowService: {
      async getProjection() {
        throw new Error("service must not be called");
      },
    },
  });

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/proposals/idea-851/projection",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "proposal_workflow_not_configured");
  assert.match(
    response.body.message,
    /OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID/,
  );
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

test("delivery mutation draft endpoints create and validate broker-owned route drafts", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const createResponse = await executeRequest(app, {
    body: {
      input: {
        operation: "work-item.complete",
        target_id: "381",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/mutation-drafts",
  });

  assert.equal(createResponse.statusCode, 200);
  assert.equal(createResponse.body.workflow_id, "delivery-art-mutation-draft-create");
  assert.deepEqual(createResponse.body.mutation_draft.route, {
    method: "POST",
    path: "/v1/delivery-work-items/work-item-381/complete",
  });

  const validateResponse = await executeRequest(app, {
    body: {
      mutation_draft: createResponse.body.mutation_draft,
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/mutation-drafts/validate",
  });

  assert.equal(validateResponse.statusCode, 200);
  assert.equal(validateResponse.body.validation.valid, true);
});

test("WGCF mutation draft endpoint imports receipt refs without submitting ART mutations", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("workspace-governance-control-fabric");
  const app = createApp({
    config,
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        schema_version: 1,
        source_system: "workspace-governance-control-fabric",
        receipt: {
          digest: "sha256:receipt",
          kind: "art_readiness_receipt",
          ref: "wgcf://receipts/art-readiness/522",
        },
        recommendation: {
          action: "record_blocker",
          reason: "WGCF detected a blocker recommendation that requires OOS handling.",
        },
        draft: {
          operation: "work-item.blocker",
          target_id: "522",
          payload_input: {
            action: "record",
            blocker_decision_path: "remove",
            blocker_impact: "WGCF detected a readiness blocker.",
            blocker_owner: "Workflow Integration",
            blocker_statement: "WGCF recommends blocker recording before closeout.",
          },
        },
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "workspace-governance-control-fabric",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/wgcf/mutation-drafts",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-art-wgcf-mutation-draft-create");
  assert.equal(response.body.authority.direct_mutation_allowed, false);
  assert.equal(response.body.mutation_draft.status, "draft");
  assert.equal(response.body.mutation_draft.submission.result, null);
  assert.equal(response.body.mutation_draft.payload.input.action, "set");
  assert.equal(
    response.body.mutation_draft.route.path,
    "/v1/delivery-work-items/work-item-522/blocker",
  );
});

test("WGCF caller cannot use direct ART mutation endpoints", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("workspace-governance-control-fabric");
  const app = createApp({
    config,
    deliveryService: {
      completeDeliveryWorkItem: async () => {
        throw new Error("direct ART mutation should not be called for WGCF");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        changed_surfaces: "- `src/app.js`: should not be accepted.",
        completion_summary: "This direct mutation must be denied.",
        test_result_evidence: "- PASS: not reached",
        validation_evidence: "- PASS: not reached",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "workspace-governance-control-fabric",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-522/complete",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "caller_recommendation_only");
});

test("WGCF mutation draft endpoint rejects raw context payloads", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("workspace-governance-control-fabric");
  const app = createApp({
    config,
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        schema_version: 1,
        source_system: "workspace-governance-control-fabric",
        receipt: {
          digest: "sha256:receipt",
          kind: "art_readiness_receipt",
          ref: "wgcf://receipts/art-readiness/522",
        },
        raw_context: "full unredacted terminal output",
        draft: {
          operation: "work-item.update",
          target_id: "522",
        },
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "workspace-governance-control-fabric",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/wgcf/mutation-drafts",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /raw_context is not allowed/);
});

test("delivery review packet finalization fails closed on non-durable tmp evidence", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      review_packet: {
        artifact_type: "art_review_packet",
        covered_work_item_ids: ["work-item-381"],
        delivery_id: "delivery-378",
        evidence: {
          validations: ["- PASS: npm test"],
        },
        landing_unit: {
          evidence_kind: "merged_pr",
          merge_commit: "abc123",
          pr_url: "https://github.example/pull/1",
          repos: [
            {
              changed_files: [".tmp/complete-381.json"],
              repo_name: "operator-orchestration-service",
            },
          ],
          rollback_boundary: "One OOS PR.",
        },
        schema_version: 1,
        status: "draft",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/review-packets/finalize",
  });

  assert.equal(response.statusCode, 422);
  assert.equal(
    response.body.validation.errors.includes(
      "review packets must not use .tmp scratch files as durable evidence",
    ),
    true,
  );
});

test("delivery review packet readiness fails before incomplete source merge", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      review_packet: {
        artifact_type: "art_review_packet",
        covered_work_item_ids: ["work-item-471"],
        delivery_id: "delivery-420",
        evidence: {
          changed_surfaces: [],
          test_results: [],
          validations: [],
        },
        landing_unit: {
          evidence_kind: "pending",
          repos: [],
          rollback_boundary: "CHECK: add rollback.",
        },
        packet_id: "review-packet-readiness",
        schema_version: 1,
        status: "draft",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/review-packets/readiness",
  });

  assert.equal(response.statusCode, 422);
  assert.equal(response.body.validation.ready, false);
  assert.equal(
    response.body.validation.errors.some((entry) =>
      entry.includes("landing_unit.evidence_kind must be open_pr"),
    ),
    true,
  );
});

test("Delivery ART v2 mutation routes require caller-specific identity binding", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds = ["operator:workspace-owner"];
  config.callerAuth.callerSecrets = {
    "operator:another-owner": "another-operator-secret",
  };
  let called = false;
  const app = createApp({
    config,
    deliveryArtArtifactService: {
      async persistArchitecturePacket() {
        called = true;
        return {};
      },
    },
    ideaService: {},
    openProjectClient: {},
  });
  const artifact = {
    artifact_id: "architecture-packet:delivery-698-v1",
    artifact_type: "delivery_art_architecture_packet",
    delivery_id: "delivery-698",
  };

  const sharedCredential = await executeRequest(app, {
    body: { artifact },
    headers: {
      "x-oos-caller-id": "operator:workspace-owner",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/architecture-packets/persist",
  });
  assert.equal(sharedCredential.statusCode, 403);
  assert.equal(sharedCredential.body.error, "delivery_art_caller_identity_unbound");
  assert.equal(called, false);

  config.callerAuth.callerSecrets["operator:workspace-owner"] =
    "operator-specific-secret";
  const callerBound = await executeRequest(app, {
    body: { artifact },
    headers: {
      "x-oos-caller-id": "operator:workspace-owner",
      "x-oos-caller-secret": "operator-specific-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/architecture-packets/persist",
  });
  assert.equal(callerBound.statusCode, 200);
  assert.equal(callerBound.body.workflow_id, "delivery-art-architecture-packet-persist");
  assert.equal(called, true);
});

test("Delivery ART canonical routes reject oversized bodies before service invocation", async () => {
  let called = false;
  const app = createApp({
    config: createBaseConfig(),
    deliveryArtArtifactService: {
      async validateArtifact() {
        called = true;
        return { errors: [], valid: true };
      },
    },
    ideaService: {},
    openProjectClient: {},
  });

  const response = await executeRequest(app, {
    body: {
      artifact: {
        padding: "x".repeat(1_048_576 + 8_192),
      },
    },
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/artifacts/validate",
  });

  assert.equal(response.statusCode, 413);
  assert.equal(response.body.error, "request_body_too_large");
  assert.equal(called, false);
});

test("Delivery ART v2 Review Packet routes preserve prepare and finalize boundaries", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds = ["operator:workspace-owner"];
  config.callerAuth.callerSecrets = {
    "operator:workspace-owner": "operator-specific-secret",
  };
  const calls = [];
  const service = {
    async finalizeReviewPacket(input) {
      calls.push({ input, operation: "finalize" });
      return { artifact: { status: "finalized" } };
    },
    async markReviewPacketMergeReady(input) {
      calls.push({ input, operation: "readiness" });
      return { artifact: { status: "merge-ready" } };
    },
    async issueReviewPacketOperatingReadiness(input) {
      calls.push({ input, operation: "operating-readiness" });
      return {
        finalization_candidate: input.artifact,
        readiness_receipt: {
          readiness: { mutation_allowed: true, outcome: "ready" },
        },
      };
    },
    async prepareReviewPacketFinalization(input) {
      calls.push({ input, operation: "prepare" });
      return {
        finalization_candidate: input.artifact,
        readiness_request: { digest_kind: "readiness-subject" },
      };
    },
  };
  const app = createApp({
    config,
    deliveryArtArtifactService: service,
    ideaService: {},
    openProjectClient: {},
  });
  const headers = {
    "x-oos-caller-id": "operator:workspace-owner",
    "x-oos-caller-secret": "operator-specific-secret",
  };
  const reviewPacket = {
    artifact_type: "art_review_packet",
    delivery_id: "delivery-698",
    operator: { id: "operator:workspace-owner" },
    packet_id: "review-packet:delivery-698-work-item-802",
    schema_version: 2,
  };

  const readiness = await executeRequest(app, {
    body: { review_packet: reviewPacket },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets/readiness",
  });
  const prepared = await executeRequest(app, {
    body: { review_packet: reviewPacket },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets/prepare-finalization",
  });
  const operatingReadiness = await executeRequest(app, {
    body: { review_packet: reviewPacket },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets/operating-readiness",
  });
  const receiptRef = {
    digest: `sha256:${"a".repeat(64)}`,
    uri: `wgcf://receipts/art-readiness/receipt-${"a".repeat(64)}.json`,
  };
  const finalized = await executeRequest(app, {
    body: {
      readiness_receipt_ref: receiptRef,
      review_packet: reviewPacket,
    },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets/finalize",
  });

  assert.equal(readiness.statusCode, 200);
  assert.equal(readiness.body.workflow_id, "delivery-art-review-packet-v2-readiness");
  assert.equal(prepared.statusCode, 200);
  assert.equal(
    prepared.body.workflow_id,
    "delivery-art-review-packet-v2-prepare-finalization",
  );
  assert.equal(operatingReadiness.statusCode, 200);
  assert.equal(
    operatingReadiness.body.workflow_id,
    "delivery-art-review-packet-v2-operating-readiness",
  );
  assert.equal(finalized.statusCode, 200);
  assert.equal(finalized.body.workflow_id, "delivery-art-review-packet-v2-finalize");
  assert.deepEqual(calls.map((entry) => entry.operation), [
    "readiness",
    "prepare",
    "operating-readiness",
    "finalize",
  ]);
  assert.deepEqual(calls.at(-1).input.readinessReceiptRef, receiptRef);
  assert.equal(calls.every((entry) => entry.input.callerId === "operator:workspace-owner"), true);
});

test("Delivery ART Review evidence projection exposes one authenticated API for Console and CLI clients", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds = ["operator:workspace-owner"];
  config.callerAuth.callerSecrets = {
    "operator:workspace-owner": "operator-specific-secret",
  };
  const calls = [];
  const app = createApp({
    config,
    deliveryArtArtifactService: {
      async projectReviewEvidence(input) {
        calls.push(input);
        return {
          evidence_document: { evidence: {}, projection: { schema_version: 1 } },
          readiness: { finding_count: 1, findings: [], ready: false },
          requirements: { required_evidence_kinds: ["tests"] },
        };
      },
    },
    ideaService: {},
    openProjectClient: {},
  });
  const input = {
    source: { head_commit: "1".repeat(40) },
    work_start_ref: {
      digest: `sha256:${"a".repeat(64)}`,
      uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
    },
  };

  const response = await executeRequest(app, {
    body: { input },
    headers: {
      "x-oos-caller-id": "operator:workspace-owner",
      "x-oos-caller-secret": "operator-specific-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/review-evidence/project",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.body.workflow_id,
    "delivery-art-review-evidence-projection",
  );
  assert.deepEqual(calls, [{ callerId: "operator:workspace-owner", input }]);
});

test("Delivery ART lifecycle authoring routes preserve non-mutating service boundaries", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds = ["operator:workspace-owner"];
  config.callerAuth.callerSecrets = {
    "operator:workspace-owner": "operator-specific-secret",
  };
  const calls = [];
  const app = createApp({
    config,
    deliveryArtArtifactService: {
      async draftReviewPacket(input) {
        calls.push({ input, operation: "review-packet" });
        return { review_packet: { schema_version: 2, status: "draft" } };
      },
      async draftReviewPacketFinalization(input) {
        calls.push({ input, operation: "finalization" });
        return { finalization_candidate: { schema_version: 2, status: "draft" } };
      },
      async draftWorkStart(input) {
        calls.push({ input, operation: "work-start" });
        return {
          source_snapshot: { covered_record_count: 1 },
          work_start: { readiness: { level: "draft" } },
        };
      },
    },
    ideaService: {},
    openProjectClient: {},
  });
  const headers = {
    "x-oos-caller-id": "operator:workspace-owner",
    "x-oos-caller-secret": "operator-specific-secret",
  };

  const capabilities = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/delivery-art/lifecycle/capabilities",
  });
  const workStart = await executeRequest(app, {
    body: { input: { delivery_id: "delivery-698" } },
    headers,
    method: "POST",
    url: "/v1/delivery-art/work-start/draft",
  });
  const reviewPacket = await executeRequest(app, {
    body: { input: { schema_version: 2 } },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets",
  });
  const finalization = await executeRequest(app, {
    body: { input: { merge_ready_ref: {}, merged_repos: [] } },
    headers,
    method: "POST",
    url: "/v1/delivery-art/review-packets/finalization-drafts",
  });

  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.body.capabilities.owner_repo, "operator-orchestration-service");
  assert.equal(workStart.body.workflow_id, "delivery-art-work-start-draft");
  assert.equal(reviewPacket.body.workflow_id, "delivery-art-review-packet-v2-draft");
  assert.equal(
    finalization.body.workflow_id,
    "delivery-art-review-packet-v2-finalization-draft",
  );
  assert.deepEqual(calls.map((entry) => entry.operation), [
    "work-start",
    "review-packet",
    "finalization",
  ]);
  assert.equal(
    calls.every((entry) => entry.input.callerId === "operator:workspace-owner"),
    true,
  );
});

test("Delivery ART Review Packet authoring requires an explicit schema version", async () => {
  let called = false;
  const app = createApp({
    config: createBaseConfig(),
    deliveryArtArtifactService: {
      async draftReviewPacket() {
        called = true;
        return {};
      },
    },
    ideaService: {},
    openProjectClient: {},
  });

  const response = await executeRequest(app, {
    body: { input: { delivery_id: "delivery-698" } },
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-art/review-packets",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /schema_version must be 2.*or 1/i);
  assert.equal(called, false);
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

test("idea consume endpoint forwards the operator context, optional target PI, and owner repo", async () => {
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
          owner_repo: input.ownerRepo,
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
        owner_repo: "operator-orchestration-service",
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
  assert.equal(response.body.owner_repo, "operator-orchestration-service");
  assert.equal(consumeCalls[0].ideaId, "idea-41");
  assert.equal(consumeCalls[0].ownerRepo, "operator-orchestration-service");
  assert.equal(consumeCalls[0].targetPi, "PI-2026-02");
  assert.match(consumeCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("idea consume endpoint treats intentionally blank target PI as uncommitted", async () => {
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
          owner_repo: input.ownerRepo,
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
        owner_repo: "operator-orchestration-service",
        target_pi: "   ",
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
  assert.equal(consumeCalls[0].targetPi, null);
  assert.equal(response.body.owner_repo, "operator-orchestration-service");
  assert.equal(response.body.target_pi, null);
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

test("idea closeout endpoint forwards the operator context and closeout notes", async () => {
  const closeoutCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      closeoutIdea: async (input) => {
        closeoutCalls.push(input);
        return {
          delivery_closeout_notes: input.closeoutNotes,
          delivery_record_ref: "openproject://work_packages/77",
          delivery_record_system: "openproject",
          delivery_status: "done",
          delivery_ref: "openproject://work_packages/77",
          idea_id: input.ideaId,
          operator_decision_notes: "Ready to move this into tracked delivery.",
          record_ref: "openproject://work_packages/41",
          record_system: "openproject",
          status: "implemented",
          updated_at: "2026-04-21T09:00:00Z",
          workflow_id: "accepted-idea-delivery-closeout",
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
        closeout_notes: "Delivered through the first bounded execution slice.",
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
    url: "/v1/ideas/idea-41/closeout",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "accepted-idea-delivery-closeout");
  assert.equal(response.body.status, "implemented");
  assert.equal(closeoutCalls[0].ideaId, "idea-41");
  assert.equal(
    closeoutCalls[0].closeoutNotes,
    "Delivered through the first bounded execution slice.",
  );
  assert.match(closeoutCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("idea closeout endpoint fails closed when implemented status config is incomplete", async () => {
  const config = createBaseConfig();
  config.openProject.implementedStatusId = null;

  const app = createApp({
    config,
    ideaService: {
      closeoutIdea: async () => {
        throw new Error("closeoutIdea should not be called");
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
        closeout_notes: "Delivered through the first bounded execution slice.",
      },
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
    url: "/v1/ideas/idea-41/closeout",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(
    response.body.error,
    "accepted_idea_delivery_closeout_not_configured",
  );
  assert.match(response.body.message, /OPENPROJECT_IMPLEMENTED_STATUS_ID/);
});

test("idea delivery closeout reconciliation defaults to dry-run", async () => {
  const calls = [];
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      reconcileIdeaDeliveryCloseouts: async (input) => {
        calls.push(input);
        return {
          applied: input.apply,
          items: [],
          summary: { scanned_count: 0 },
          workflow_id: "accepted-idea-delivery-closeout-reconcile",
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
      input: {},
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
    url: "/v1/ideas/delivery-closeouts/reconcile",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.applied, false);
  assert.equal(calls[0].apply, false);
  assert.equal(calls[0].operator.id, "1338752889");
});

test("idea delivery closeout reconciliation requires notes before apply", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      reconcileIdeaDeliveryCloseouts: async () => {
        throw new Error("reconciliation should not run");
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
      input: { mode: "apply" },
      operator: { id: "1338752889" },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/ideas/delivery-closeouts/reconcile",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
});

test("idea delivery closeout reconciliation rejects an unauthenticated caller", async () => {
  const app = createApp({
    config: createBaseConfig(),
    ideaService: {
      reconcileIdeaDeliveryCloseouts: async () => {
        throw new Error("reconciliation should not run");
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
      operator: { id: "1338752889" },
    },
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url: "/v1/ideas/delivery-closeouts/reconcile",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "caller_auth_required");
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

test("delivery execution summary endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryExecutionSummary: async (input) => {
        deliveryCalls.push(input);
        return {
          delivery_id: "delivery-38",
          delivery_record_ref: "openproject://work_packages/38",
          delivery_record_system: "openproject",
          execution_summary: {
            epic: {
              id: 38,
              status: "in-progress",
              subject: "Productize governed local-agent platform",
            },
            summary: {
              blocked_count: 1,
              total_items: 3,
            },
          },
          workflow_id: "delivery-execution-summary",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-initiatives/delivery-38/execution-summary?include_done=false&include_parked=true",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-execution-summary");
  assert.equal(response.body.delivery_id, "delivery-38");
  assert.equal(deliveryCalls[0].deliveryId, "delivery-38");
  assert.equal(deliveryCalls[0].includeDone, false);
  assert.equal(deliveryCalls[0].includeParked, true);
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery session bootstrap endpoint returns the broker response", async () => {
  const bootstrapCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliverySessionBootstrap: async (input) => {
        bootstrapCalls.push(input);
        return {
          active_fronts: {
            initiatives: [],
            summary: {
              active_initiative_count: 0,
              active_item_count: 0,
              next_ready_count: 0,
            },
          },
          assignables: {
            principals: [],
            project: {
              identifier: "workspace-delivery-art",
              record_ref: "openproject://projects/workspace-delivery-art",
            },
            summary: {
              assignable_count: 0,
            },
          },
          caller: {
            auth_mode: "required",
            id: input.callerId,
          },
          review_backlog: {
            blocked_initiatives: [],
            ready_for_closing: [],
            ready_for_closeout: [],
            ready_for_retirement: [],
            summary: {
              blocked_count: 0,
              ready_for_closing_count: 0,
              ready_for_closeout_count: 0,
              ready_for_retirement_count: 0,
            },
          },
          runtime: {
            broker_service: {
              git_commit: "abc123",
              name: "operator-orchestration-service",
              version: "0.1.0-test",
            },
            delivery_project_identifier: "workspace-delivery-art",
            openproject_runtime: {
              cluster_domain: "cluster.local",
              host: "openproject.devint-accepted-idea-delivery-mfshaf7.svc.cluster.local",
              namespace: "devint-accepted-idea-delivery-mfshaf7",
              service_name: "openproject",
            },
          },
          workflow_id: "delivery-session-bootstrap",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-session/bootstrap",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-session-bootstrap");
  assert.equal(response.body.caller.id, "openclaw-telegram-enhanced");
  assert.equal(bootstrapCalls[0].callerId, "openclaw-telegram-enhanced");
  assert.match(bootstrapCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery initiative review-pack endpoint returns the broker response", async () => {
  const reviewPackCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryInitiativeReviewPack: async (input) => {
        reviewPackCalls.push(input);
        return {
          delivery_id: "delivery-304",
          delivery_record_ref: "openproject://work_packages/304",
          delivery_record_system: "openproject",
          review_pack: {
            epic: {
              id: 304,
              status: "in-progress",
              subject: "Establish seamless broker-owned ART workflow",
            },
            initiative_review: {
              closing_transition_ready: false,
              completion_transition_ready: false,
              retirement_transition_ready: true,
            },
            quality_drift: {
              ready_without_contract: [],
              completed_with_weak_evidence: [],
              completed_with_weak_done_narrative: [],
              completed_without_evidence: [],
              completed_without_owner: [],
            },
            stale_open_candidates: [
              {
                item: {
                  id: 308,
                  record_ref: "openproject://work_packages/308",
                  status: "in-progress",
                  subject: "Provide broker-native ART session resume and status reads",
                  type: "Feature",
                },
                reason: "children_terminal_but_parent_open",
              },
            ],
            summary: {
              ready_for_closing: false,
              ready_for_closeout: false,
              ready_for_retirement: true,
              stale_open_candidate_count: 1,
            },
          },
          workflow_id: "delivery-initiative-review-pack",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-initiatives/delivery-304/review-pack",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-initiative-review-pack");
  assert.equal(response.body.delivery_id, "delivery-304");
  assert.equal(reviewPackCalls[0].deliveryId, "delivery-304");
  assert.match(reviewPackCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery initiative active-session packet endpoint returns the broker response", async () => {
  const calls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryInitiativeActiveSessionPacket: async (input) => {
        calls.push(input);
        return {
          active_session_packet: {
            active_fronts: {
              next_ready_items: [
                {
                  id: 657,
                  status: "ready",
                  subject: "Produce compact active-session packets",
                  type: "User story",
                },
              ],
              summary: {
                next_ready_count: 1,
              },
            },
            initiative: {
              id: 650,
              status: "in-progress",
              subject: "Build the 90 percent ART working-model optimization foundation",
              type: "Epic",
            },
            packet_kind: "art_active_session_packet",
          },
          delivery_id: "delivery-650",
          delivery_record_ref: "openproject://work_packages/650",
          delivery_record_system: "openproject",
          workflow_id: "delivery-initiative-active-session-packet",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-initiatives/delivery-650/active-session-packet",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-initiative-active-session-packet");
  assert.equal(response.body.active_session_packet.active_fronts.summary.next_ready_count, 1);
  assert.equal(calls[0].deliveryId, "delivery-650");
  assert.match(calls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery initiative evidence packet endpoint returns the broker response", async () => {
  const calls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryInitiativeEvidencePacket: async (input) => {
        calls.push(input);
        return {
          delivery_id: "delivery-650",
          delivery_record_ref: "openproject://work_packages/650",
          delivery_record_system: "openproject",
          evidence_packet: {
            evidence_state: {
              system_demo_evidence_present: false,
            },
            initiative: {
              id: 650,
              status: "in-progress",
              subject: "Build the 90 percent ART working-model optimization foundation",
              type: "Epic",
            },
            packet_kind: "art_initiative_evidence_packet",
          },
          workflow_id: "delivery-initiative-evidence-packet",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-initiatives/delivery-650/evidence-packet",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-initiative-evidence-packet");
  assert.equal(response.body.evidence_packet.packet_kind, "art_initiative_evidence_packet");
  assert.equal(calls[0].deliveryId, "delivery-650");
  assert.match(calls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery session workflow-health endpoint returns the broker response", async () => {
  const workflowHealthCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliverySessionWorkflowHealth: async (input) => {
        workflowHealthCalls.push(input);
        return {
          portfolio_summary: {
            active_initiatives: 2,
            total_initiatives: 3,
          },
          project: {
            identifier: "workspace-delivery-art",
          },
          workflow_health: {
            compatible_views: {
              roadmap: {
                canonical_field: "Target PI",
                projected_field: "version",
                truthful: false,
                unassigned_bucket: "Not yet committed to a PI",
                retired_bucket: "Retired scope",
              },
            },
            pm2_phase: {
              drift: [],
              healthy: true,
            },
            roadmap: {
              drift: [
                {
                  issue_type: "target_pi_version_drift",
                },
              ],
              healthy: false,
              unassigned_bucket: "Not yet committed to a PI",
              retired_bucket: "Retired scope",
            },
            summary: {
              healthy: false,
              roadmap_projection_drift_count: 1,
            },
          },
          workflow_id: "delivery-session-workflow-health",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-session/workflow-health",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-session-workflow-health");
  assert.equal(response.body.project.identifier, "workspace-delivery-art");
  assert.equal(response.body.workflow_health.summary.healthy, false);
  assert.equal(workflowHealthCalls[0].callerId, "openclaw-telegram-enhanced");
  assert.match(workflowHealthCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item continuation endpoint returns the broker response", async () => {
  const continuationCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryWorkItemContinuationContext: async (input) => {
        continuationCalls.push(input);
        return {
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
              subject: "Add supporting-component readiness contracts for shared stage and prod services",
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
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-work-items/work-item-177/continuation-context",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-continuation-context");
  assert.equal(response.body.work_item_id, "work-item-177");
  assert.equal(
    response.body.continuation_context.delivery_epic.initiative_family,
    "governed-ai-control-plane",
  );
  assert.equal(continuationCalls[0].callerId, "openclaw-telegram-enhanced");
  assert.equal(continuationCalls[0].workItemId, "work-item-177");
  assert.match(continuationCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item evidence packet endpoint returns the broker response", async () => {
  const calls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryWorkItemEvidencePacket: async (input) => {
        calls.push(input);
        return {
          continuation_context: {
            parent_chain: [],
            summary: {
              open_child_count: 0,
            },
            target_item: {
              id: 657,
              status: "ready",
              subject: "Produce compact active-session packets",
              type: "User story",
            },
          },
          delivery_id: "delivery-650",
          delivery_record_ref: "openproject://work_packages/650",
          delivery_record_system: "openproject",
          evidence_packet: {
            evidence_state: {
              completion_evidence_present: true,
            },
            packet_kind: "art_work_item_evidence_packet",
            target_item: {
              id: 657,
              status: "ready",
              subject: "Produce compact active-session packets",
              type: "User story",
            },
          },
          work_item_id: "work-item-657",
          work_item_record_ref: "openproject://work_packages/657",
          work_item_record_system: "openproject",
          workflow_id: "delivery-work-item-evidence-packet",
        };
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-work-items/work-item-657/evidence-packet",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-evidence-packet");
  assert.equal(response.body.work_item_id, "work-item-657");
  assert.equal(response.body.evidence_packet.packet_kind, "art_work_item_evidence_packet");
  assert.equal(calls[0].workItemId, "work-item-657");
  assert.match(calls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item continuation endpoint preserves validation failure status", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryWorkItemContinuationContext: async () => {
        throw new OpenProjectError(
          "validation_failure",
          "Top-level delivery Epic shells are not executable work items.",
          422,
          "initiative_epic_not_executable",
        );
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-work-items/work-item-362/continuation-context",
  });

  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.body, {
    error: "validation_failure",
    message: "Top-level delivery Epic shells are not executable work items.",
    details: "initiative_epic_not_executable",
  });
});

test("delivery work-item continuation endpoint still treats upstream auth failures as backend failures", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryWorkItemContinuationContext: async () => {
        throw new OpenProjectError(
          "authentication_failure",
          "OpenProject token rejected.",
          403,
          "urn:openproject-org:api:v3:errors:Unauthenticated",
        );
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-work-items/work-item-362/continuation-context",
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.error, "authentication_failure");
});

test("delivery PI review endpoint accepts documented integer target id", async () => {
  const piReviewCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      recordDeliveryPiReview: async (input) => {
        piReviewCalls.push(input);
        return {
          delivery_id: "delivery-420",
          delivery_record_ref: "openproject://work_packages/420",
          delivery_record_system: "openproject",
          summary: {
            actualBusinessValueTotal: 8,
            byReviewOutcome: {
              Met: 1,
            },
            updatedCount: 1,
          },
          updated: [],
          workflow_id: "delivery-pi-review",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        pi_review_date: "2026-04-30",
        reviews: [
          {
            actual_business_value: 8,
            review_outcome: "Met",
            target_work_package_id: 476,
          },
        ],
        target_pi: "PI-2026-03",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-420/pi-review",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-pi-review");
  assert.equal(piReviewCalls[0].deliveryId, "delivery-420");
  assert.equal(piReviewCalls[0].reviews[0].targetWorkPackageId, 476);
});

test("delivery work-item stale-open close endpoint returns the broker response", async () => {
  const staleOpenCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      closeStaleOpenDeliveryWorkItem: async (input) => {
        staleOpenCalls.push(input);
        return {
          action_applied: "close_stale_open",
          completion_evidence_state: {
            formattingValid: true,
          },
          stale_open_closeout: {
            childStatusSummary: {
              done: 1,
            },
            completedChildCount: 1,
            justification: input.staleOpenJustification,
            retiredChildCount: 0,
          },
          work_item: {
            id: 310,
            recordRef: "openproject://work_packages/310",
            status: "done",
            subject: "Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows",
            type: "Feature",
          },
          work_item_id: "work-item-310",
          work_item_record_ref: "openproject://work_packages/310",
          work_item_record_system: "openproject",
          workflow_id: "delivery-work-item-stale-open-close",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        completion_summary: "Closed the stale-open parent through one broker workflow.",
        changed_surfaces:
          "- `src/openproject-client.js`: implements the stale-open closeout route.",
        stale_open_justification:
          "Completed child scope already satisfies the parent read surface.",
        test_result_evidence: "- PASS: `npm test`",
        validation_evidence: "- PASS: live stale-open closeout proof recorded.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-310/stale-open-close",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-stale-open-close");
  assert.equal(response.body.work_item_id, "work-item-310");
  assert.equal(
    staleOpenCalls[0].staleOpenJustification,
    "Completed child scope already satisfies the parent read surface.",
  );
  assert.equal(staleOpenCalls[0].workItemId, "work-item-310");
  assert.match(staleOpenCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery initiative close endpoint returns the broker response", async () => {
  const closeCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      closeDeliveryInitiative: async (input) => {
        closeCalls.push(input);
        return {
          action_applied: "close_initiative",
          completion_evidence_state: {
            formattingValid: true,
          },
          delivery_id: "delivery-304",
          delivery_initiative: {
            id: 304,
            pm2_phase: "Closing",
            recordRef: "openproject://work_packages/304",
            status: "done",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
          },
          delivery_record_ref: "openproject://work_packages/304",
          delivery_record_system: "openproject",
          inspect_and_adapt_entry: {
            actionItems: input.actionItems,
            date: input.inspectDate,
            followUp: input.inspectFollowUp,
            summary: input.inspectSummary,
          },
          steps_applied: {
            inspect_and_adapt_recorded: true,
            initiative_completed: true,
            pm2_closing_entered: true,
            system_demo_recorded: true,
          },
          system_demo_entry: {
            date: input.demoDate,
            evidence: input.demoEvidence,
            followUp: input.demoFollowUp,
            outcome: input.demoOutcome,
            summary: input.demoSummary,
          },
          workflow_id: "delivery-initiative-close",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        changed_surfaces:
          "- `src/openproject-client.js`: implements the initiative closeout route.",
        completion_summary: "Closed the initiative through one broker workflow.",
        demo_evidence: "Live devint initiative closed through one route.",
        demo_outcome: "reviewed",
        demo_summary: "Broker preserved the full closeout sequence.",
        inspect_action_items: "- Keep initiative closeout broker-owned.",
        inspect_summary: "Closeout workflow landed cleanly.",
        test_result_evidence: "- PASS: `npm test`",
        validation_evidence: "- PASS: live initiative closeout proof recorded."
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-304/close",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-initiative-close");
  assert.equal(response.body.delivery_id, "delivery-304");
  assert.equal(closeCalls[0].deliveryId, "delivery-304");
  assert.equal(closeCalls[0].demoOutcome, "reviewed");
  assert.equal(closeCalls[0].actionItems, "- Keep initiative closeout broker-owned.");
  assert.match(closeCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery execution summary endpoint rejects invalid boolean query values", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryExecutionSummary: async () => {
        throw new Error("getDeliveryExecutionSummary should not be called");
      },
    },
    ideaService: {},
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
    url: "/v1/delivery-initiatives/delivery-38/execution-summary?include_done=maybe",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /include_done must be true or false/);
});

test("delivery initiative governance endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      updateDeliveryInitiative: async (input) => {
        deliveryCalls.push(input);
        return {
          changes_applied: {
            pm2_phase: {
              from: "Planning",
              to: "Executing",
            },
          },
          delivery_id: "delivery-38",
          delivery_initiative: {
            architectureAnchorRef: "openproject://work_packages/277",
            initiativeFamily: "delivery-art-operator-surfaces",
            lineageRole: "control-hardening",
            owner_repo: "platform-engineering",
            pm2Phase: "Executing",
            requiredUpstreamRef: null,
            status: "in-progress",
            subject: "Productize governed local-agent platform",
            targetPi: "PI-2026-02",
            type: "Epic",
          },
          delivery_record_ref: "openproject://work_packages/38",
          delivery_record_system: "openproject",
          workflow_id: "delivery-initiative-governance",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        architecture_anchor_ref: "openproject://work_packages/277",
        initiative_family: "delivery-art-operator-surfaces",
        lineage_role: "control-hardening",
        owner_repo: "platform-engineering",
        pm2_phase: "Executing",
        system_demo_evidence: "Broker governance route proved in devint.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-38/governance",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-initiative-governance");
  assert.equal(response.body.delivery_id, "delivery-38");
  assert.equal(deliveryCalls[0].recordId, "delivery-38");
  assert.equal(
    deliveryCalls[0].architectureAnchorRef,
    "openproject://work_packages/277",
  );
  assert.equal(
    deliveryCalls[0].initiativeFamily,
    "delivery-art-operator-surfaces",
  );
  assert.equal(deliveryCalls[0].lineageRole, "control-hardening");
  assert.equal(deliveryCalls[0].ownerRepo, "platform-engineering");
  assert.equal(deliveryCalls[0].pm2Phase, "Executing");
  assert.equal(response.body.delivery_initiative.owner_repo, "platform-engineering");
  assert.equal(
    deliveryCalls[0].systemDemoEvidence,
    "Broker governance route proved in devint.",
  );
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery initiative governance endpoint requires at least one field", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      updateDeliveryInitiative: async () => {
        throw new Error("updateDeliveryInitiative should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-38/governance",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(
    response.body.message,
    /must provide at least one initiative governance field/,
  );
});

test("delivery plan apply endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      applyDeliveryPlan: async (input) => {
        deliveryCalls.push(input);
        return {
          delivery_id: "delivery-38",
          delivery_record_ref: "openproject://work_packages/38",
          delivery_record_system: "openproject",
          plan_result: {
            created: [],
            deferred: [],
            epic: {
              id: 38,
              record_ref: "openproject://work_packages/38",
              subject: "Productize governed local-agent platform",
              target_pi: "PI-2026-02",
              updated: true,
            },
            retired: [],
            reused: [],
            summary: {
              created_count: 0,
              deferred_count: 0,
              reused_count: 1,
              retired_count: 0,
              total_requested: 2,
              updated_count: 1,
            },
            updated: [],
          },
          workflow_id: "delivery-plan-apply",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const plan = {
    schema_version: 1,
    items: [
      {
        subject: "Enabler: Brokerize delivery initiative governance update",
        type: "Task",
      },
      {
        description: "Broker route owns the operator plan path.",
        subject: "Enabler: Brokerize delivery plan apply and reconciliation",
        type: "Task",
      },
    ],
  };
  const response = await executeRequest(app, {
    body: {
      input: {
        plan,
        reconcile_decision: "retire",
        reconcile_missing: "ignore",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-38/plan/apply",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-plan-apply");
  assert.equal(response.body.delivery_id, "delivery-38");
  assert.equal(deliveryCalls[0].recordId, "delivery-38");
  assert.deepEqual(deliveryCalls[0].plan, plan);
  assert.equal(deliveryCalls[0].reconcileDecision, "retire");
  assert.equal(deliveryCalls[0].reconcileMissing, "ignore");
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery plan apply endpoint requires an object plan", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      applyDeliveryPlan: async () => {
        throw new Error("applyDeliveryPlan should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-38/plan/apply",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /input.plan must be an object/);
});

test("delivery plan repair endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      repairDeliveryPlan: async (input) => {
        deliveryCalls.push(input);
        return {
          delivery_id: "delivery-304",
          delivery_record_ref: "openproject://work_packages/304",
          delivery_record_system: "openproject",
          repair_result: {
            epic: {
              id: 304,
              record_ref: "openproject://work_packages/304",
              status: "in-progress",
              subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
              target_pi: "PI-2026-03",
              type: "Epic",
            },
            repairs: [
              {
                action: "execution_posture_correction",
                changes_applied: {
                  delivery_team: {
                    from: null,
                    to: "Operator Orchestration Service",
                  },
                },
                planning_posture_before: {
                  delivery_team: null,
                  iteration: "Program-wide / planning",
                  status: "new",
                  target_pi: "PI-2026-03",
                  type: "Feature",
                },
                reason: "Fill the missing delivery team.",
                work_item: {
                  deliveryTeam: "Operator Orchestration Service",
                  recordRef: "openproject://work_packages/311",
                  status: "new",
                  subject: "Enabler: Harden ART writes with safe retry, idempotency, and duplicate-note protection",
                  targetPi: "PI-2026-03",
                  type: "Feature",
                },
                work_item_id: "work-item-311",
                work_item_record_ref: "openproject://work_packages/311",
              },
            ],
            summary: {
              by_action: {
                decommit: 0,
                execution_posture_correction: 1,
                retarget: 0,
              },
              repair_count: 1,
              updated_count: 1,
            },
          },
          workflow_id: "delivery-plan-repair",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        schema_version: 1,
        repairs: [
          {
            action: "execution_posture_correction",
            delivery_team: "Operator Orchestration Service",
            reason: "Fill the missing delivery team.",
            target_work_item_id: "work-item-311",
          },
        ],
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-304/plan/repair",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-plan-repair");
  assert.equal(response.body.delivery_id, "delivery-304");
  assert.equal(deliveryCalls[0].recordId, "delivery-304");
  assert.equal(deliveryCalls[0].repairs[0].action, "execution_posture_correction");
  assert.equal(deliveryCalls[0].repairs[0].deliveryTeam, "Operator Orchestration Service");
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery plan repair endpoint forwards risk posture fields", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      repairDeliveryPlan: async (input) => {
        deliveryCalls.push(input);
        return {
          delivery_id: "delivery-304",
          delivery_record_ref: "openproject://work_packages/304",
          delivery_record_system: "openproject",
          repair_result: {
            epic: {
              id: 304,
              record_ref: "openproject://work_packages/304",
              status: "in-progress",
              subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
              target_pi: "PI-2026-03",
              type: "Epic",
            },
            repairs: [],
            summary: {
              by_action: {
                decommit: 0,
                execution_posture_correction: 1,
                retarget: 0,
              },
              repair_count: 1,
              updated_count: 1,
            },
          },
          workflow_id: "delivery-plan-repair",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        schema_version: 1,
        repairs: [
          {
            action: "execution_posture_correction",
            reason: "Normalize the risk posture through the governed repair path.",
            risk_disposition: "defer",
            risk_owner: "Platform Engineering",
            risk_review_date: "2026-04-25",
            roam_state: "accepted",
            target_work_item_id: "work-item-317",
          },
        ],
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-304/plan/repair",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(deliveryCalls[0].repairs[0].riskDisposition, "defer");
  assert.equal(deliveryCalls[0].repairs[0].riskOwner, "Platform Engineering");
  assert.equal(deliveryCalls[0].repairs[0].riskReviewDate, "2026-04-25");
  assert.equal(deliveryCalls[0].repairs[0].roamState, "accepted");
});

test("delivery plan repair endpoint requires a non-empty repair list", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      repairDeliveryPlan: async () => {
        throw new Error("repairDeliveryPlan should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        schema_version: 1,
        repairs: [],
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-initiatives/delivery-304/plan/repair",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /input.repairs must be a non-empty array/);
});

test("delivery work-item update endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      getDeliveryExecutionSummary: async () => {
        throw new Error("getDeliveryExecutionSummary should not be called");
      },
      updateDeliveryWorkItem: async (input) => {
        deliveryCalls.push(input);
        return {
          work_item_id: "work-item-56",
          work_item_record_ref: "openproject://work_packages/56",
          work_item_record_system: "openproject",
          work_item: {
            assigneeLogin: "admin",
            parentId: null,
            status: "in-progress",
            subject: "Add bounded delivery work-item update mapping",
            targetPi: "PI-2026-02",
            type: "Task",
          },
          changes_applied: {
            status: {
              from: "ready",
              to: "in-progress",
            },
          },
          workflow_id: "delivery-work-item-update",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        assignee_login: "admin",
        status: "in-progress",
        target_pi: "PI-2026-02",
        work_note: "Started implementation.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-56/update",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-update");
  assert.equal(response.body.work_item_id, "work-item-56");
  assert.equal(response.body.work_item.parentId, null);
  assert.equal(deliveryCalls[0].workItemId, "work-item-56");
  assert.equal(deliveryCalls[0].status, "in-progress");
  assert.equal(deliveryCalls[0].targetPi, "PI-2026-02");
  assert.equal(deliveryCalls[0].assigneeLogin, "admin");
  assert.equal(deliveryCalls[0].workNote, "Started implementation.");
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item update endpoint rejects an empty input object", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      updateDeliveryWorkItem: async () => {
        throw new Error("updateDeliveryWorkItem should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-56/update",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /must provide at least one delivery work-item update field/);
});

test("delivery work-item create endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      createDeliveryWorkItem: async (input) => {
        deliveryCalls.push(input);
        return {
          creation_applied: {
            status: "ready",
            subject: "Brokerize delivery work-item move",
            target_pi: "PI-2026-02",
            type: "Task",
          },
          parent_work_item_id: "work-item-61",
          work_item_id: "work-item-69",
          work_item_record_ref: "openproject://work_packages/69",
          work_item_record_system: "openproject",
          work_item: {
            parentId: 61,
            status: "ready",
            subject: "Brokerize delivery work-item move",
            targetPi: "PI-2026-02",
            type: "Task",
          },
          workflow_id: "delivery-work-item-create",
        };
      },
      updateDeliveryWorkItem: async () => {
        throw new Error("updateDeliveryWorkItem should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        acceptance_criteria: "- Operator can create one child task through the broker.",
        definition_of_done: "- Live proof recorded in devint.",
        definition_of_ready: "- Parent feature and PI are already active.",
        delivery_team: "Workflow Integration",
        iteration: "PI-2026-02 / Iteration 2",
        parent_work_item_id: "work-item-61",
        status: "ready",
        subject: "Brokerize delivery work-item move",
        target_pi: "PI-2026-02",
        type: "Task",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-create");
  assert.equal(response.body.work_item_id, "work-item-69");
  assert.equal(deliveryCalls[0].parentWorkItemId, "work-item-61");
  assert.equal(deliveryCalls[0].type, "Task");
  assert.equal(deliveryCalls[0].deliveryTeam, "Workflow Integration");
  assert.equal(deliveryCalls[0].targetPi, "PI-2026-02");
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item create endpoint requires parent, type, and subject", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      createDeliveryWorkItem: async () => {
        throw new Error("createDeliveryWorkItem should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        type: "Task",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /input.parent_work_item_id must be a non-empty string/);
});

test("delivery work-item move endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      moveDeliveryWorkItem: async (input) => {
        deliveryCalls.push(input);
        return {
          changes_applied: {
            parent: {
              from: 61,
              to: 75,
            },
          },
          parent_work_item_id: "work-item-75",
          previous_parent_work_item_id: "work-item-61",
          work_item_id: "work-item-63",
          work_item_record_ref: "openproject://work_packages/63",
          work_item_record_system: "openproject",
          work_item: {
            parentId: 75,
            status: "ready",
            subject: "Enabler: Brokerize delivery work-item move",
            targetPi: "PI-2026-02",
            type: "Task",
          },
          workflow_id: "delivery-work-item-move",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        new_parent_work_item_id: "work-item-75",
        work_note: "Move proof is running through the broker route.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-63/move",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-move");
  assert.equal(response.body.work_item_id, "work-item-63");
  assert.equal(deliveryCalls[0].workItemId, "work-item-63");
  assert.equal(deliveryCalls[0].newParentWorkItemId, "work-item-75");
  assert.equal(
    deliveryCalls[0].workNote,
    "Move proof is running through the broker route.",
  );
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item move endpoint requires a new parent work-item id", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      moveDeliveryWorkItem: async () => {
        throw new Error("moveDeliveryWorkItem should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-63/move",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(
    response.body.message,
    /input.new_parent_work_item_id must be a non-empty string/,
  );
});

test("delivery work-item blocker endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryBlocker: async (input) => {
        deliveryCalls.push(input);
        return {
          action_applied: "set",
          blocker: {
            decision_path: "workaround",
            discovered_on: "2026-04-21",
            follow_up_owner: "mfshaf7",
            impact: "Execution proof cannot continue until the blocker workflow is broker-owned.",
            justification: "Lift the existing blocker semantics behind the broker before continuing.",
            owner: "mfshaf7",
            review_date: "2026-04-24",
            statement: "Current blocker workflow still depends on the platform-side runner.",
          },
          work_item_id: "work-item-64",
          work_item_record_ref: "openproject://work_packages/64",
          work_item_record_system: "openproject",
          work_item: {
            status: "blocked",
            subject: "Enabler: Brokerize delivery blocker management",
            targetPi: "PI-2026-02",
            type: "Task",
          },
          workflow_id: "delivery-work-item-blocker",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        action: "set",
        blocker_decision_path: "workaround",
        blocker_discovered_on: "2026-04-21",
        blocker_follow_up_owner: "mfshaf7",
        blocker_impact: "Execution proof cannot continue until the blocker workflow is broker-owned.",
        blocker_justification: "Lift the existing blocker semantics behind the broker before continuing.",
        blocker_owner: "mfshaf7",
        blocker_review_date: "2026-04-24",
        blocker_statement: "Current blocker workflow still depends on the platform-side runner.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-64/blocker",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-blocker");
  assert.equal(response.body.work_item_id, "work-item-64");
  assert.equal(deliveryCalls[0].workItemId, "work-item-64");
  assert.equal(deliveryCalls[0].action, "set");
  assert.equal(deliveryCalls[0].blockerDecisionPath, "workaround");
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item blocker endpoint requires an action", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryBlocker: async () => {
        throw new Error("manageDeliveryBlocker should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-64/blocker",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /input.action must be a non-empty string/);
});

test("delivery work-item parking endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryParking: async (input) => {
        deliveryCalls.push(input);
        return {
          action_applied: "park",
          changes_applied: {
            status: {
              from: "new",
              to: "parked",
            },
          },
          parking: {
            decision: "defer",
            reason: "Hold this task outside active scope until the next slice starts.",
            review_date: "2026-05-01",
            retirement_reason: null,
          },
          work_item_id: "work-item-66",
          work_item_record_ref: "openproject://work_packages/66",
          work_item_record_system: "openproject",
          work_item: {
            status: "parked",
            subject: "Enabler: Brokerize delivery parking and resume",
            targetPi: "PI-2026-02",
            type: "Task",
          },
          workflow_id: "delivery-work-item-parking",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        action: "park",
        park_decision: "defer",
        park_reason: "Hold this task outside active scope until the next slice starts.",
        park_review_date: "2026-05-01",
        work_note: "Parking proof is running through the broker route.",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-66/parking",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-parking");
  assert.equal(response.body.work_item_id, "work-item-66");
  assert.equal(deliveryCalls[0].workItemId, "work-item-66");
  assert.equal(deliveryCalls[0].parkDecision, "defer");
  assert.equal(
    deliveryCalls[0].workNote,
    "Parking proof is running through the broker route.",
  );
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item parking endpoint requires an action", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryParking: async () => {
        throw new Error("manageDeliveryParking should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {},
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-66/parking",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(response.body.message, /input.action must be a non-empty string/);
});

test("delivery work-item dependency endpoint returns the broker response", async () => {
  const deliveryCalls = [];
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryDependency: async (input) => {
        deliveryCalls.push(input);
        return {
          action_applied: "set",
          created: true,
          depends_on_work_item_id: "work-item-67",
          relation: {
            description: "Dependency proof through the broker route.",
            depends_on: {
              id: 67,
              record_ref: "openproject://work_packages/67",
              status: "ready",
              subject: "Enabler: Brokerize delivery initiative governance update",
            },
            id: 12,
            lag: 2,
            relation_type: "follows",
            target: {
              id: 70,
              record_ref: "openproject://work_packages/70",
              status: "new",
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
            },
          },
          removed_duplicate_relation_ids: [],
          target_work_item_id: "work-item-70",
          updated: false,
          workflow_id: "delivery-work-item-dependency",
        };
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        action: "set",
        depends_on_work_item_id: "work-item-67",
        description: "Dependency proof through the broker route.",
        lag: 2,
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-70/dependency",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.workflow_id, "delivery-work-item-dependency");
  assert.equal(deliveryCalls[0].targetWorkItemId, "work-item-70");
  assert.equal(deliveryCalls[0].dependsOnWorkItemId, "work-item-67");
  assert.equal(deliveryCalls[0].lag, 2);
  assert.match(deliveryCalls[0].correlationId, /^[0-9a-f-]{36}$/);
});

test("delivery work-item dependency endpoint requires action and depends_on_work_item_id", async () => {
  const app = createApp({
    config: createBaseConfig(),
    deliveryService: {
      manageDeliveryDependency: async () => {
        throw new Error("manageDeliveryDependency should not be called");
      },
    },
    ideaService: {},
    openProjectClient: {
      checkProjectReachability: async () => ({
        targetRef: "openproject://projects/workspace-proposals",
      }),
    },
  });

  const response = await executeRequest(app, {
    body: {
      input: {
        action: "set",
      },
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/delivery-work-items/work-item-70/dependency",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "validation_failed");
  assert.match(
    response.body.message,
    /input.depends_on_work_item_id must be a non-empty string/,
  );
});

test("orchestration definition catalog is authenticated and readable before activation", async () => {
  const config = createBaseConfig();
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: createOrchestrationService({
      config,
      temporalAdapter: {},
    }),
  });

  const unauthorized = await executeRequest(app, {
    method: "GET",
    url: "/v1/orchestration/definitions",
  });
  assert.equal(unauthorized.statusCode, 401);

  const response = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "GET",
    url: "/v1/orchestration/definitions",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.definitions.length, 1);
  assert.equal(
    response.body.definitions[0].definition_id,
    "validation-readiness-run",
  );
  assert.equal(response.body.definitions[0].admission.start_allowed, false);
});

test("orchestration run start fails closed while activation gates are missing", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("governance-operations-console");
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: createOrchestrationService({
      config,
      temporalAdapter: {
        startRun() {
          throw new Error("disabled runtime must not be called");
        },
      },
    }),
  });
  const response = await executeRequest(app, {
    body: validOrchestrationRequest(),
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "governance-operations-console",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/orchestration/runs",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, "orchestration_not_admitted");
  assert.ok(
    response.body.details.some(
      (entry) => entry.gate_id === "security-review-accepted",
    ),
  );
});

test("orchestration run routes reject the caller development bypass", async () => {
  const config = loadConfig(
    validOrchestrationActivationEnv({
      CALLER_AUTH_SHARED_SECRET: "",
    }),
  );
  let startCount = 0;
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: createOrchestrationService({
      config,
      temporalAdapter: {
        async startRun() {
          startCount += 1;
        },
      },
    }),
  });

  const response = await executeRequest(app, {
    body: validOrchestrationRequest(),
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "governance-operations-console",
    },
    method: "POST",
    url: "/v1/orchestration/runs",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(
    response.body.error,
    "orchestration_caller_auth_not_configured",
  );
  assert.equal(startCount, 0);
});

test("orchestration run start returns a worker-independent admission receipt", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("governance-operations-console");
  const runId =
    "oos:validation-readiness-run:v1:validation-readiness-abc123";
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: {
      async startRun() {
        return { duplicate: false, run_id: runId, projection: null };
      },
    },
  });

  const response = await executeRequest(app, {
    body: validOrchestrationRequest(),
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "governance-operations-console",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/orchestration/runs",
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, {
    duplicate: false,
    run_id: runId,
    projection: null,
  });
});

test("orchestration run start publishes generation capacity exhaustion", async () => {
  const config = loadConfig(validOrchestrationActivationEnv());
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: createOrchestrationService({
      config,
      temporalAdapter: {
        async startRun() {
          throw new OrchestrationGenerationCapacityExhaustedError(
            TEST_ACTIVATION_EVIDENCE_DIGEST,
          );
        },
      },
    }),
  });

  const response = await executeRequest(app, {
    body: validOrchestrationRequest(),
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "governance-operations-console",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/orchestration/runs",
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error: "orchestration_generation_capacity_exhausted",
    message:
      "The active orchestration generation is full. Retire it and activate a fresh generation before retrying.",
    details: {
      activation_evidence_digest: TEST_ACTIVATION_EVIDENCE_DIGEST,
      maximum_registration_count: 512,
      required_action: "retire-and-activate-fresh-generation",
    },
  });
});

test("orchestration run routes preserve the aggregate projection boundary", async () => {
  const config = createBaseConfig();
  const calls = [];
  const projection = {
    run_id: "oos:validation-readiness-run:v1:key",
    state: "queued",
  };
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: {
      async listRuns({ limit }) {
        calls.push(["list", limit]);
        return [projection];
      },
      async getRun(runId) {
        calls.push(["get", runId]);
        return projection;
      },
      async controlRun(runId, control) {
        calls.push(["control", runId, control.action]);
        return { ...projection, state: "waiting" };
      },
    },
  });
  const headers = {
    "Content-Type": "application/json",
    "x-oos-caller-id": "openclaw-telegram-enhanced",
    "x-oos-caller-secret": "test-secret",
  };

  const listResponse = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/orchestration/runs?limit=10",
  });
  const getResponse = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/orchestration/runs/oos%3Avalidation-readiness-run%3Av1%3Akey",
  });
  const controlResponse = await executeRequest(app, {
    body: {
      schema_version: 1,
      control_id: "control:defer:1",
      action: "defer",
      operator_id: "operator:mfshaf7",
      reason_ref: "decision:defer:1",
      idempotency_key: "control-defer-1",
    },
    headers,
    method: "POST",
    url: "/v1/orchestration/runs/oos%3Avalidation-readiness-run%3Av1%3Akey/controls",
  });

  assert.equal(listResponse.body.runs.length, 1);
  assert.equal(getResponse.body.state, "queued");
  assert.equal(controlResponse.body.state, "waiting");
  assert.deepEqual(calls, [
    ["list", 10],
    ["get", "oos:validation-readiness-run:v1:key"],
    ["control", "oos:validation-readiness-run:v1:key", "defer"],
  ]);
});

test("orchestration control rejection preserves the service error at the HTTP boundary", async () => {
  const config = createBaseConfig();
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: {
      async controlRun(runId) {
        throw new OrchestrationServiceError(
          "orchestration_control_unavailable",
          "The retry control is not available in the current run state.",
          {
            statusCode: 409,
            details: {
              action: "retry",
              run_id: runId,
              state: "succeeded",
            },
          },
        );
      },
    },
  });

  const response = await executeRequest(app, {
    body: {
      schema_version: 1,
      control_id: "control:retry:1",
      action: "retry",
      operator_id: "operator:mfshaf7",
      reason_ref: "decision:retry:1",
      idempotency_key: "control-retry-1",
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "openclaw-telegram-enhanced",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/orchestration/runs/oos%3Avalidation-readiness-run%3Av1%3Akey/controls",
  });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, "orchestration_control_unavailable");
  assert.deepEqual(response.body.details, {
    action: "retry",
    run_id: "oos:validation-readiness-run:v1:key",
    state: "succeeded",
  });
});

test("controlled proof routes expose only start, retained read, and bound control operations", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("platform-controlled-proof-executor");
  const calls = [];
  const runId =
    "oos:controlled-proof:validation-readiness:v1:11111111111111111111111111111111:01:nominal-completion";
  const result = {
    schema_version: 1,
    duplicate: false,
    run_id: runId,
    commissioning_session_id: "commissioning-session-698-1",
    scenario_id: "nominal-completion",
    scenario_execution_id: "scenario-execution-01",
    projection: null,
    owner_receipt: null,
  };
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: {
      async startControlledProofExecution(payload, { callerId }) {
        calls.push(["start", payload.scenario_execution_id, callerId]);
        return result;
      },
      async getControlledProofExecution(selectedRunId, { callerId }) {
        calls.push(["get", selectedRunId, callerId]);
        return result;
      },
      async controlControlledProofExecution(selectedRunId, payload, { callerId }) {
        calls.push(["control", selectedRunId, payload.control.action, callerId]);
        return result;
      },
    },
  });
  const headers = {
    "Content-Type": "application/json",
    "x-oos-caller-id": "platform-controlled-proof-executor",
    "x-oos-caller-secret": "test-secret",
  };

  const start = await executeRequest(app, {
    body: { schema_version: 1, scenario_execution_id: "scenario-execution-01" },
    headers,
    method: "POST",
    url: "/v1/orchestration/controlled-proof/executions",
  });
  const encodedRunId = encodeURIComponent(runId);
  const read = await executeRequest(app, {
    headers,
    method: "GET",
    url: `/v1/orchestration/controlled-proof/executions/${encodedRunId}`,
  });
  const control = await executeRequest(app, {
    body: {
      schema_version: 1,
      commissioning_session_id: "commissioning-session-698-1",
      scenario_execution_id: "scenario-execution-01",
      scenario_evidence: null,
      control: {
        schema_version: 1,
        control_id: "control:controlled-proof:1",
        action: "cancel",
        operator_id: "operator:mfshaf7",
        reason_ref: "reason:controlled-proof-test",
        idempotency_key: "control-idempotency:controlled-proof:1",
      },
    },
    headers,
    method: "POST",
    url: `/v1/orchestration/controlled-proof/executions/${encodedRunId}/controls`,
  });

  assert.equal(start.statusCode, 202);
  assert.equal(read.statusCode, 200);
  assert.equal(control.statusCode, 200);
  assert.deepEqual(calls, [
    ["start", "scenario-execution-01", "platform-controlled-proof-executor"],
    ["get", runId, "platform-controlled-proof-executor"],
    ["control", runId, "cancel", "platform-controlled-proof-executor"],
  ]);
});

test("controlled proof contract failures are published as bounded client errors", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("platform-controlled-proof-executor");
  const app = createApp({
    config,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    orchestrationService: {
      async startControlledProofExecution() {
        throw new ControlledProofContractError(
          "invalid_controlled_proof_contract",
          "The controlled proof start request contains fields outside the admitted boundary.",
        );
      },
    },
  });

  const response = await executeRequest(app, {
    body: {
      schema_version: 1,
      scenario_execution_id: "scenario-execution-01",
      profile_lifecycle: "active",
    },
    headers: {
      "Content-Type": "application/json",
      "x-oos-caller-id": "platform-controlled-proof-executor",
      "x-oos-caller-secret": "test-secret",
    },
    method: "POST",
    url: "/v1/orchestration/controlled-proof/executions",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_controlled_proof_contract");
});

test("Delivery work-session routes preserve caller-bound service commands", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("operator:workspace-owner");
  config.callerAuth.callerSecrets = {
    "operator:workspace-owner": "operator-specific-secret",
  };
  config.deliveryArt.workSession.callerOperatorBindings = {
    "operator:workspace-owner": "operator:workspace-owner",
  };
  const calls = [];
  const deliveryArtWorkSessionService = {
    async read(input) {
      calls.push(["read", input]);
      return {
        workflow_id: "delivery-art-work-session",
        work_item_id: "work-item-1024",
        state: "source-work",
      };
    },
    async execute(input) {
      calls.push(["execute", input]);
      return {
        workflow_id: "delivery-art-work-session",
        work_item_id: "work-item-1024",
        state: "source-work",
        replayed: false,
      };
    },
  };
  const app = createApp({
    config,
    deliveryArtWorkSessionService,
    ideaService: {},
    openProjectClient: {},
  });
  const headers = {
    "x-oos-caller-id": "operator:workspace-owner",
    "x-oos-caller-secret": "operator-specific-secret",
    "x-oos-operator-id": "operator:workspace-owner",
  };

  const status = await executeRequest(app, {
    headers,
    method: "GET",
    url: "/v1/delivery-work-items/1024/work-session",
  });
  const command = await executeRequest(app, {
    body: {
      command: {
        command_id: "work-session-command:continue-1024-1",
        expected_session_revision: "2026-08-27T01:00:00.000Z",
      },
    },
    headers,
    method: "POST",
    url: "/v1/delivery-work-items/1024/work-session/continue",
  });

  assert.equal(status.statusCode, 200);
  assert.equal(command.statusCode, 200);
  assert.deepEqual(calls, [
    ["read", {
      callerId: "operator:workspace-owner",
      operatorId: "operator:workspace-owner",
      workItemId: "1024",
    }],
    ["execute", {
      action: "continue",
      callerId: "operator:workspace-owner",
      command: {
        command_id: "work-session-command:continue-1024-1",
        expected_session_revision: "2026-08-27T01:00:00.000Z",
      },
      operatorId: "operator:workspace-owner",
      workItemId: "1024",
    }],
  ]);
});

test("Delivery work-session routes fail closed for shared credentials and unavailable executors", async () => {
  const config = createBaseConfig();
  config.callerAuth.allowedIds.push("operator:workspace-owner");
  const sharedHeaders = {
    "x-oos-caller-id": "operator:workspace-owner",
    "x-oos-caller-secret": "test-secret",
  };
  const app = createApp({
    config,
    ideaService: {},
    openProjectClient: {},
  });

  const unbound = await executeRequest(app, {
    headers: sharedHeaders,
    method: "GET",
    url: "/v1/delivery-work-items/1024/work-session",
  });
  config.callerAuth.callerSecrets = {
    "operator:workspace-owner": "operator-specific-secret",
  };
  config.deliveryArt.workSession.callerOperatorBindings = {
    "operator:workspace-owner": "operator:workspace-owner",
  };
  const unavailable = await executeRequest(app, {
    headers: {
      "x-oos-caller-id": "operator:workspace-owner",
      "x-oos-caller-secret": "operator-specific-secret",
      "x-oos-operator-id": "operator:workspace-owner",
    },
    method: "GET",
    url: "/v1/delivery-work-items/1024/work-session",
  });

  assert.equal(unbound.statusCode, 403);
  assert.equal(unbound.body.error, "caller_identity_unbound");
  assert.equal(unavailable.statusCode, 503);
  assert.equal(
    unavailable.body.error,
    "delivery_art_work_session_executor_unavailable",
  );
});
