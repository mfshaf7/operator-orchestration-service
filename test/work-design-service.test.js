import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { OpenProjectError } from "../src/errors.js";
import {
  createWorkDesignService,
  WorkDesignServiceError,
} from "../src/work-design/service.js";
import { WorkDesignUpstreamError } from "../src/work-design/http-client.js";

const NOW = new Date("2026-08-25T03:00:00Z");

function workDesignNode(overrides = {}) {
  return {
    id: "feature-1",
    kind: "Feature",
    title: "Deliver operator-visible planning",
    description: "One bounded planning outcome.",
    draft_body: "## What This Achieves\n\nA reviewable package plan.",
    remark: "Keep execution-only metadata out of Work Design.",
    children: [],
    ...overrides,
  };
}

function assistRequest(kind = "tree_advice") {
  const request = {
    schema_version: 1,
    request_id: `work-design-${kind}-1`,
    correlation_id: "correlation-1",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:908",
    source_ref: "openproject://work_packages/908",
    source_revision: "version-17",
    operator: { id: "operator:workspace-owner", handle: "mfshaf7" },
    task: {
      kind,
      contract_ref: "oos.delivery-work-design.v1",
      version: "1.0",
    },
    operator_prompt: "Check whether this package has a coherent outcome boundary.",
  };
  if (kind === "context_advice") {
    request.context_draft = {
      decision: "proceed",
      note: "Continue into a bounded Work Design draft.",
    };
  } else {
    const tree = workDesignNode();
    request.tree_draft = {
      selected_node_id: tree.id,
      tree,
      tree_digest: canonicalDigest(tree),
    };
  }
  return request;
}

function applyRequest(overrides = {}) {
  const tree = workDesignNode({
    kind: "Epic",
    children: [
      workDesignNode({
        id: "story-1",
        kind: "User story",
        title: "Apply one bounded plan",
        draft_body: "## What This Achieves\n\nApplies one operator-accepted plan.",
      }),
    ],
  });
  return {
    schema_version: 1,
    request_id: "work-design-apply-1",
    correlation_id: "correlation-1",
    idempotency_key: "work-design-908-version-17",
    delivery_id: "delivery-884",
    package_ref: "delivery-package:908",
    source_ref: "openproject://work_packages/908",
    source_revision: "version-17",
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: "2026-08-25T03:05:00Z",
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed tree.",
    },
    accepted_draft: {
      draft_id: "work-design-draft-1",
      draft_digest: canonicalDigest(tree),
      tree,
    },
    ...overrides,
  };
}

function sourceClient(sourceRevision = "version-17") {
  return {
    async getWorkDesignSourceRevision({ recordId }) {
      return {
        recordId,
        recordRef: `openproject://work_packages/${recordId}`,
        sourceRevision,
      };
    },
  };
}

function readyProjection(request) {
  return {
    schema_version: 1,
    status: "ready",
    replayed: false,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    request_digest: `sha256:${"b".repeat(64)}`,
    binding: {
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      idempotency_key: request.idempotency_key,
      workflow_session_id: request.workflow_session_id,
      execution_id: request.execution_id,
      delivery_id: request.delivery_id,
      package_ref: request.package_ref,
      source_ref: request.source_ref,
      source_revision: request.source_revision,
      caller_id: "operator-orchestration-service",
      operator_id: request.operator.id,
      task: request.task,
      requested_at: request.requested_at,
      context_digest: request.context_digest,
      budget_tokens: request.budget_tokens,
    },
    artifact_id: "artifact-1",
    artifact_digest: `sha256:${"c".repeat(64)}`,
    packet_ref: "/v1/context/packets/work-design-1",
    redaction_receipt_ref: "/v1/context/receipts/work-design-1",
    projection_receipt_ref: "/v1/context/work-design/projections/work-design-1",
    content: "Model-safe Work Design context.",
    admission_decision: {
      profile: "developer",
      raw_projection: "not_requested",
      redaction_safe: true,
    },
    timeline: {
      requested_at: request.requested_at,
      projected_at: request.requested_at,
    },
    authority: {
      may_select_or_invoke_model: false,
      may_approve_suggestion: false,
      may_mutate_delivery: false,
    },
  };
}

function gatewayResult(overrides = {}) {
  return {
    profile_id: "delivery-work-design-advisor-v1",
    policy_status: "active",
    policy_decision: "allow",
    decision_id: "correlation-1",
    generated_at: NOW.toISOString(),
    caller_id: "operator-orchestration-service/work-design-assist",
    invocation_path: "governed-ai-gateway",
    binding_selection_ref: "platform://profiles/delivery-work-design-advisor-v1",
    task: {
      kind: "tree_advice",
      contract_ref: "oos.delivery-work-design.v1",
      version: "1.0",
    },
    output: {
      confidence: "medium",
      required_operator_action: "review",
      text: "Keep one bounded outcome under the delivery epic.",
      affected_node_id: "feature-1",
      patch_proposal: {
        patch_type: "tree_shape",
        summary: "Keep one outcome per Feature branch.",
      },
    },
    audit_ref: "local-ledger:work-design-1",
    ...overrides,
  };
}

function service(overrides = {}) {
  return createWorkDesignService({
    clock: () => NOW,
    contextClient: {
      async project(request) {
        return readyProjection(request);
      },
    },
    deliveryService: {
      async applyDeliveryPlan() {
        return {
          delivery_id: "delivery-884",
          delivery_record_ref: "openproject://work_packages/884",
          plan_result: {
            created: [{ record_ref: "openproject://work_packages/1001" }],
            updated: [],
            reused: [],
            retired: [],
          },
        };
      },
    },
    gatewayClient: {
      async invoke() {
        return gatewayResult();
      },
    },
    openProjectClient: sourceClient(),
    ...overrides,
  });
}

test("Work Design assist binds current source, CGG projection, and governed advice", async () => {
  let projectionRequest;
  let gatewayRequest;
  const runtime = service({
    contextClient: {
      async project(request) {
        projectionRequest = request;
        return readyProjection(request);
      },
    },
    gatewayClient: {
      async invoke(request) {
        gatewayRequest = request;
        return gatewayResult();
      },
    },
  });

  const result = await runtime.assist({
    callerId: "governance-operations-console",
    packageId: "delivery-package:908",
    request: assistRequest(),
  });

  assert.equal(result.status, "ready");
  assert.equal(result.evidence.gateway_audit_ref, "local-ledger:work-design-1");
  assert.equal(
    projectionRequest.context_digest,
    `sha256:${createHash("sha256").update(projectionRequest.context).digest("hex")}`,
  );
  assert.equal(projectionRequest.task.model_profile_id, "delivery-work-design-advisor-v1");
  assert.equal(gatewayRequest.profile_id, "delivery-work-design-advisor-v1");
  assert.equal(gatewayRequest.operator_acceptance_state, "not-recorded");
  assert.equal(
    gatewayRequest.input.model_safe_packet.content,
    "Model-safe Work Design context.",
  );
});

test("Work Design assist fails closed when the governed profile is inactive", async () => {
  const runtime = service({
    gatewayClient: {
      async invoke() {
        throw new WorkDesignUpstreamError("upstream_rejected", "denied", {
          payload: {
            reasons: ["profile-not-active"],
            audit_ref: "local-ledger:denied-1",
          },
          statusCode: 403,
        });
      },
    },
  });

  await assert.rejects(
    runtime.assist({
      callerId: "governance-operations-console",
      packageId: "delivery-package:908",
      request: assistRequest(),
    }),
    (error) =>
      error instanceof WorkDesignServiceError &&
      error.code === "ai_profile_inactive" &&
      error.auditRef === "local-ledger:denied-1",
  );
});

test("Work Design assist rejects stale source and malformed model output", async () => {
  const digestMismatch = assistRequest();
  digestMismatch.tree_draft.tree_digest = `sha256:${"d".repeat(64)}`;
  await assert.rejects(
    service().assist({
      callerId: "governance-operations-console",
      packageId: "delivery-package:908",
      request: digestMismatch,
    }),
    (error) => error.code === "request_invalid",
  );

  await assert.rejects(
    service({ openProjectClient: sourceClient("version-18") }).assist({
      callerId: "governance-operations-console",
      packageId: "delivery-package:908",
      request: assistRequest(),
    }),
    (error) => error.code === "accepted_draft_stale" && error.statusCode === 409,
  );

  await assert.rejects(
    service({
      gatewayClient: {
        async invoke() {
          return gatewayResult({ output: { text: "Missing typed fields." } });
        },
      },
    }).assist({
      callerId: "governance-operations-console",
      packageId: "delivery-package:908",
      request: assistRequest(),
    }),
    (error) => error.code === "ai_output_invalid" && error.statusCode === 502,
  );
});

test("Work Design assist preserves a CGG admission denial as a bounded error", async () => {
  const runtime = service({
    contextClient: {
      async project() {
        throw new WorkDesignUpstreamError("upstream_rejected", "unsafe", {
          payload: {
            detail: {
              code: "context_projection_unsafe",
              message: "Projection is not safe.",
              retryable: false,
            },
          },
          statusCode: 400,
        });
      },
    },
  });

  await assert.rejects(
    runtime.assist({
      callerId: "governance-operations-console",
      packageId: "delivery-package:908",
      request: assistRequest(),
    }),
    (error) =>
      error.code === "context_admission_denied" && error.retryable === false,
  );
});

test("Work Design apply maps the accepted tree into the canonical Delivery writer", async () => {
  const calls = [];
  const runtime = service({
    deliveryService: {
      async applyDeliveryPlan(input) {
        calls.push(input);
        return {
          delivery_id: "delivery-884",
          delivery_record_ref: "openproject://work_packages/884",
          plan_result: {
            created: [{ record_ref: "openproject://work_packages/1001" }],
            updated: [],
            reused: [],
            retired: [],
          },
        };
      },
    },
  });
  const request = applyRequest();
  const result = await runtime.apply({
    callerId: "governance-operations-console",
    packageId: request.package_ref,
    request,
  });

  assert.equal(result.status, "applied");
  assert.equal(result.applied_at, request.acceptance.accepted_at);
  assert.deepEqual(result.target.created_refs, ["openproject://work_packages/1001"]);
  assert.equal(calls[0].recordId, "delivery-884");
  assert.equal(calls[0].reconcileMissing, "ignore");
  assert.equal(
    calls[0].plan.epic_updates.description,
    request.accepted_draft.tree.draft_body,
  );
  assert.deepEqual(calls[0].plan.items, [
    {
      type: "User story",
      subject: "Apply one bounded plan",
      description: "## What This Achieves\n\nApplies one operator-accepted plan.",
      children: [],
    },
  ]);
});

test("Work Design apply reconciles identical replay and rejects conflicting replay", async () => {
  let applyCount = 0;
  const runtime = service({
    deliveryService: {
      async applyDeliveryPlan() {
        applyCount += 1;
        return {
          delivery_id: "delivery-884",
          delivery_record_ref: "openproject://work_packages/884",
          plan_result: {
            created: [],
            updated: [],
            reused: [{ record_ref: "openproject://work_packages/1001" }],
            retired: [],
          },
        };
      },
    },
  });
  const request = applyRequest();
  const first = await runtime.apply({
    callerId: "governance-operations-console",
    packageId: request.package_ref,
    request,
  });
  const replay = await runtime.apply({
    callerId: "governance-operations-console",
    packageId: request.package_ref,
    request,
  });

  assert.equal(first.status, "reconciled");
  assert.equal(replay.status, "reconciled");
  assert.equal(replay.receipt.digest, first.receipt.digest);
  assert.equal(applyCount, 1);

  const conflict = structuredClone(request);
  conflict.acceptance.note = "A conflicting accepted request.";
  await assert.rejects(
    runtime.apply({
      callerId: "governance-operations-console",
      packageId: conflict.package_ref,
      request: conflict,
    }),
    (error) => error.code === "apply_conflict" && error.statusCode === 409,
  );
});

test("Work Design apply fails closed on invalid acceptance and backend outcomes", async () => {
  const mismatch = applyRequest();
  mismatch.acceptance.accepted_by = "another-operator";
  await assert.rejects(
    service().apply({
      callerId: "governance-operations-console",
      packageId: mismatch.package_ref,
      request: mismatch,
    }),
    (error) => error.code === "request_invalid" && error.statusCode === 400,
  );

  const request = applyRequest();
  await assert.rejects(
    service({
      deliveryService: {
        async applyDeliveryPlan() {
          throw new OpenProjectError(
            "validation_failure",
            "The accepted plan is not valid.",
            422,
          );
        },
      },
    }).apply({
      callerId: "governance-operations-console",
      packageId: request.package_ref,
      request,
    }),
    (error) =>
      error.code === "backend_application_failed" &&
      error.statusCode === 422 &&
      error.retryable === false,
  );

  await assert.rejects(
    service({
      deliveryService: {
        async applyDeliveryPlan() {
          return { delivery_id: "delivery-884", plan_result: null };
        },
      },
    }).apply({
      callerId: "governance-operations-console",
      packageId: request.package_ref,
      request,
    }),
    (error) => error.code === "backend_readback_incomplete",
  );

  await assert.rejects(
    service({
      deliveryService: {
        async applyDeliveryPlan() {
          return {
            delivery_id: "delivery-884",
            delivery_record_ref: null,
            plan_result: { created: [], updated: [], reused: [], retired: [] },
          };
        },
      },
    }).apply({
      callerId: "governance-operations-console",
      packageId: request.package_ref,
      request,
    }),
    (error) => error.code === "backend_readback_incomplete",
  );
});
