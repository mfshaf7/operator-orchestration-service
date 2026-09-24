import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  buildDeliveryArtLifecycleSources,
  createDeliveryArtLifecycleContextService,
} from "../src/delivery-art/lifecycle-context.js";
import {
  createDeliveryArtLifecycleContextClient,
} from "../src/delivery-art/lifecycle-context-client.js";
import { createDeliveryArtWorkSessionStore } from
  "../src/delivery-art/work-session-store.js";

const NOW = "2026-09-24T01:00:00.000Z";

function valid() {
  return { errors: [], valid: true };
}

function session() {
  return {
    schema_version: 1,
    artifact_type: "delivery_art_work_session",
    session_id: "work-session:delivery-1154:delivery-1154-oos-lifecycle-context",
    delivery_id: "delivery-1154",
    landing_unit_id: "delivery-1154-oos-lifecycle-context",
    covered_work_item_ids: ["work-item-1165"],
    aliases: ["delivery-1154-oos-lifecycle-context", "work-item-1165"],
    owner_repo: "operator-orchestration-service",
    target_pi: "PI-2026-04",
    caller_id: "governance-operations-console",
    operator: { id: "operator:workspace-owner", decision_source: "operator" },
    landing_unit: {
      decision: "child_isolated_landing_unit",
      split_reason: "The CGG consumer is independently reviewable.",
      base_ref: "origin/main",
      base_commit: "a".repeat(40),
      branch: "feature/1165-lifecycle-context-consumer",
      rollback_boundary: "Revert the OOS lifecycle-context consumer.",
    },
    architecture: { required: true, artifact_file: "artifacts/architecture.json" },
    artifacts: {
      work_start_file: "artifacts/work-start.json",
      review_packet_file: "artifacts/review-packet.json",
      readiness_receipt_file: "artifacts/readiness-receipt.json",
      evidence_file: "artifacts/evidence.json",
      resource_manifest_file: "resource-manifest.json",
    },
    human_gate_work_item_ids: { security_acceptance: [] },
    state: "source-work",
    created_at: NOW,
    updated_at: NOW,
  };
}

function workSessionProjection() {
  return {
    workflow_id: "delivery-art-work-session",
    delivery_id: "delivery-1154",
    work_item_id: "work-item-1165",
    landing_unit_id: "delivery-1154-oos-lifecycle-context",
    session_id: "work-session:delivery-1154:delivery-1154-oos-lifecycle-context",
    session_revision: NOW,
    state: "source-work",
    next_action: {
      code: "source-work-required",
      command: "git status",
      reason: "Complete the source change.",
      authority: "operator-orchestration-service",
    },
    agent_source: {
      definition_digest: `sha256:${"b".repeat(64)}`,
      identity_id: "agent-source-github-app-v1",
      logical_agent_id: "agent-gary",
      provider_principal: "mfshaf7-agent-gary[bot]",
      repository: "mfshaf7/operator-orchestration-service",
      state: "ready",
    },
    facts: {
      architecture: "ready",
      art: "open",
      evidence: "invalid",
      readiness_receipt: "missing",
      review_packet: "missing",
      work_start: "implementation-ready",
    },
    projection: {
      complete: false,
      gate: "source-work",
      state: "source-work-required",
      summary: "Complete the source change.",
    },
    pull_request: { state: "missing" },
    source: {
      base_commit: "a".repeat(40),
      branch: "feature/1165-lifecycle-context-consumer",
      changed_files: ["src/delivery-art/lifecycle-context.js"],
      head_commit: "c".repeat(40),
      state: "unpushed",
      upstream_commit: null,
    },
  };
}

function cggResult(request, overrides = {}) {
  const binding = {
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    workflow_session_id: request.workflow_session_id,
    execution_id: request.execution_id,
    delivery_id: request.delivery_id,
    work_item_ref: request.work_item_ref,
    landing_unit_id: request.landing_unit_id,
    caller_id: "operator-orchestration-service",
    operator_id: request.operator.id,
    lifecycle: request.lifecycle,
    requested_at: request.requested_at,
    sources_digest: request.sources_digest,
    budget_tokens: request.budget_tokens,
  };
  return {
    schema_version: 1,
    status: "ready",
    replayed: false,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    idempotency_key: request.idempotency_key,
    request_digest: canonicalDigest({ binding, lifecycle_sources: request.sources }),
    binding,
    artifact_id: "lifecycle-context-artifact-1165",
    artifact_digest: `sha256:${"d".repeat(64)}`,
    packet_ref: "/v1/context/packets/lifecycle-1165",
    redaction_receipt_ref: "/v1/context/receipts/lifecycle-1165-redaction",
    projection_receipt_ref: "/v1/context/lifecycle/projections/lifecycle-1165",
    content: "bounded lifecycle context",
    admission_decision: {
      profile: "developer",
      raw_projection: "not_requested",
      redaction_safe: true,
    },
    timeline: { requested_at: request.requested_at, projected_at: NOW },
    authority: {
      may_select_or_invoke_model: false,
      may_approve_suggestion: false,
      may_mutate_delivery: false,
    },
    lifecycle_context: request.lifecycle,
    source_bindings: request.sources.map(({ content: _content, ...source }) => source),
    source_summary: {
      total: request.sources.length,
      available: request.sources.filter((source) => source.availability === "available").length,
      unavailable: request.sources.filter((source) => source.availability === "unavailable").length,
      classes: request.sources.map((source) => source.source_class).sort(),
    },
    classification: {
      context_type: "lifecycle",
      source_classes: request.sources.map((source) => source.source_class).sort(),
      signal_ids: [],
    },
    budget: {
      requested_tokens: request.budget_tokens,
      estimated_tokens: 10,
      truncated: false,
    },
    projection_safety: {
      raw_context_exposed: false,
      redaction_applied: true,
      custody_bound: true,
    },
    lifecycle_authority: {
      may_choose_action: false,
      may_mutate_art: false,
      may_mutate_source: false,
      may_invoke_model: false,
      may_choose_raw_fallback: false,
    },
    ...overrides,
  };
}

async function harness({ client = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "oos-lifecycle-context-"));
  const store = createDeliveryArtWorkSessionStore({
    root,
    validateArchitectureSupersessionReceipt: valid,
    validateCleanupReceipt: valid,
    validateDecision: valid,
    validateRecoveryReceipt: valid,
    validateResourceManifest: valid,
    validateSession: valid,
  });
  store.writeSession(session());
  const requests = [];
  const contextClient = client ? {
    callerId: "operator-orchestration-service",
    ...client,
  } : {
    callerId: "operator-orchestration-service",
    configured: true,
    async project(request) {
      requests.push(request);
      return cggResult(request);
    },
  };
  const service = createDeliveryArtLifecycleContextService({
    clock: () => new Date(NOW),
    contextClient,
    store,
    workSessionController: { async status() { return workSessionProjection(); } },
  });
  return { requests, service, store };
}

function request(overrides = {}) {
  return {
    schema_version: 1,
    request_id: "lifecycle-context-request-1165-1",
    execution_id: "lifecycle-context-execution-1165-1",
    operation: "continue",
    mode: "packet",
    budget_tokens: 3000,
    fallback_reason: null,
    ...overrides,
  };
}

test("OOS derives all lifecycle source classes without exposing action commands", () => {
  const sources = buildDeliveryArtLifecycleSources(workSessionProjection(), NOW);
  assert.deepEqual(sources.map((source) => source.source_class), [
    "art", "repository", "validation", "runtime",
  ]);
  assert.equal(sources.every((source) => source.availability === "available"), true);
  assert.doesNotMatch(sources[0].content, /git status/);
});

test("OOS projects CGG context by default and binds safe packet references to the session", async () => {
  const { requests, service, store } = await harness();
  const result = await service.project({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: request(),
    workItemId: "work-item-1165",
  });

  assert.equal(result.mode, "packet");
  assert.equal(result.content, "bounded lifecycle context");
  assert.equal(result.authority.lifecycle_authority, "operator-orchestration-service");
  assert.equal(result.measurements.packet_count, 1);
  assert.equal(result.measurements.raw_fallback_count, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sources.length, 4);
  assert.equal(requests[0].lifecycle.next_action, "source-work-required");

  const ledger = store.readLifecycleContextLedger(session().session_id);
  assert.equal(ledger.bindings[0].packet_ref, "/v1/context/packets/lifecycle-1165");
  assert.equal(JSON.stringify(ledger).includes("bounded lifecycle context"), false);
  assert.equal(JSON.stringify(ledger).includes("changed_files"), false);
});

test("raw fallback is explicit, reasoned, measured, and replay-safe", async () => {
  const { service } = await harness();
  const input = request({
    mode: "raw-fallback",
    fallback_reason: "CGG is unavailable during bounded local recovery.",
  });
  const first = await service.project({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: input,
    workItemId: "1165",
  });
  const replay = await service.project({
    callerId: "governance-operations-console",
    operatorId: "operator:workspace-owner",
    request: input,
    workItemId: "1165",
  });

  assert.equal(first.mode, "raw-fallback");
  assert.equal(first.measurements.raw_fallback_count, 1);
  assert.equal(first.authority.raw_fallback_explicit, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.measurements.raw_fallback_count, 1);
});

test("CGG denial is measured and never silently downgraded to raw context", async () => {
  const error = Object.assign(new Error("CGG denied the projection."), {
    code: "context_projection_unsafe",
    statusCode: 422,
  });
  const { service, store } = await harness({
    client: { configured: true, async project() { throw error; } },
  });

  await assert.rejects(
    service.project({
      callerId: "governance-operations-console",
      operatorId: "operator:workspace-owner",
      request: request(),
      workItemId: "1165",
    }),
    error,
  );
  const ledger = store.readLifecycleContextLedger(session().session_id);
  assert.equal(ledger.measurements.denied_count, 1);
  assert.equal(ledger.measurements.raw_fallback_count, 0);
  assert.equal(ledger.bindings[0].mode, "denied");
});

test("CGG binding, source, and budget drift is denied before packet attachment", async () => {
  const { service, store } = await harness({
    client: {
      configured: true,
      async project(projectionRequest) {
        return cggResult(projectionRequest, {
          budget: {
            requested_tokens: projectionRequest.budget_tokens + 1,
            estimated_tokens: 10,
            truncated: false,
          },
        });
      },
    },
  });

  await assert.rejects(
    service.project({
      callerId: "governance-operations-console",
      operatorId: "operator:workspace-owner",
      request: request(),
      workItemId: "1165",
    }),
    { code: "delivery_art_lifecycle_context_response_invalid", statusCode: 502 },
  );
  const ledger = store.readLifecycleContextLedger(session().session_id);
  assert.equal(ledger.measurements.denied_count, 1);
  assert.equal(ledger.measurements.packet_count, 0);
});

test("caller and operator bindings are enforced before context projection", async () => {
  const { service } = await harness();
  await assert.rejects(
    service.project({
      callerId: "another-console",
      operatorId: "operator:workspace-owner",
      request: request(),
      workItemId: "1165",
    }),
    { code: "delivery_art_lifecycle_context_identity_mismatch", statusCode: 403 },
  );
});

test("CGG lifecycle client binds the dedicated caller identity and rejects implicit configuration", async () => {
  const unconfigured = createDeliveryArtLifecycleContextClient({});
  assert.equal(unconfigured.configured, false);
  await assert.rejects(
    unconfigured.project({}),
    { code: "lifecycle_context_not_configured", statusCode: 503 },
  );

  let observed = null;
  const client = createDeliveryArtLifecycleContextClient({
    baseUrl: "http://cgg.test",
    callerId: "operator-orchestration-service",
    callerSecret: "dedicated-lifecycle-secret",
    async fetchImpl(url, options) {
      observed = { url: String(url), options };
      return new Response(JSON.stringify({ status: "ready" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  });
  assert.deepEqual(await client.project({ request_id: "request-1" }), { status: "ready" });
  assert.equal(observed.url, "http://cgg.test/v1/context/lifecycle/projections");
  assert.equal(observed.options.headers["x-cgg-caller-id"], "operator-orchestration-service");
  assert.equal(observed.options.headers["x-cgg-caller-secret"], "dedicated-lifecycle-secret");
});

test("CGG lifecycle client bounds upstream errors before HTTP projection", async () => {
  const client = createDeliveryArtLifecycleContextClient({
    baseUrl: "http://cgg.test",
    callerSecret: "dedicated-lifecycle-secret",
    async fetchImpl() {
      return new Response(JSON.stringify({
        code: "context_projection_unsafe",
        message: "Projection denied.",
        internal_detail: "must-not-cross-the-OOS-boundary",
      }), {
        headers: { "Content-Type": "application/json" },
        status: 422,
      });
    },
  });
  await assert.rejects(client.project({ request_id: "request-1" }), (error) => {
    assert.deepEqual(error.toResponse(), {
      error: "context_projection_unsafe",
      message: "Projection denied.",
      details: { retryable: false },
    });
    assert.doesNotMatch(JSON.stringify(error.toResponse()), /internal_detail/);
    return true;
  });
});
