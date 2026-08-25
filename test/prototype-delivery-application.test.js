import test from "node:test";
import assert from "node:assert/strict";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { HttpError } from "../src/errors.js";
import { createPrototypeDeliveryApplicationService } from
  "../src/delivery-ingress/prototype-application-service.js";
import {
  prototypeDeliveryApplicationId,
  prototypeDeliveryIngressEnvelope,
} from "../src/delivery-ingress/prototype-application-model.js";
import { prototypeDeliveryTargetMarker } from
  "../src/delivery-ingress/prototype-adapter.js";

const NOW = "2026-08-25T06:00:00.000Z";

function prototypePacket() {
  const content = {
    intent: "governed-delivery",
    target: "workspace-delivery-art",
    source: {
      kind: "prototype",
      prototype_id: "sample-prototype",
      record_ref: "record://prototypes/sample-prototype",
      record_version: "1".repeat(40),
      lifecycle: "baseline-approved",
      owner: "Workspace Owner",
      repository: "workspace-prototype-studio",
      revision: {
        ref: "refs/heads/main",
        base_commit: "2".repeat(40),
        head_commit: "1".repeat(40),
        tree: "3".repeat(40),
      },
    },
    baseline: {
      record_ref: "record://design-baselines/sample-prototype-v1",
      baseline_id: "sample-prototype-v1",
      schema_version: 1,
      version: "sample-prototype-v1@sha256:baseline",
      record_digest: `sha256:${"4".repeat(64)}`,
    },
    work: {
      title: "Sample prototype continuation",
      objective: "Continue the approved prototype as governed Delivery work.",
      included_scope: ["Preserve the approved operator workflow."],
      excluded_scope: ["Do not authorize production deployment."],
      remaining_work: ["Wire the durable backend adapter."],
    },
    posture: {
      visibility_tier: "operator-review",
      data_mode: "synthetic",
      mutation_boundary: "prototype-local",
    },
    custody: {
      classification: "existing-repo",
      repository_mode: "existing",
      repository_gate_state: "resolved",
      owner: "workspace-prototype-studio",
      source_ref: "repo://workspace-prototype-studio@main",
      rationale: "The source already has durable repository custody.",
    },
    authorization: {
      decision: "approved",
      operator_id: "codex-local",
      decision_ref: "record://prototype-decisions/sample-delivery-handoff",
    },
    evidence_refs: ["record://evidence/sample-preview-proof"],
    rationale: "The approved baseline requires governed continuation.",
  };
  const packetDigest = canonicalDigest(content);
  const packetId = `sample-prototype-${packetDigest.slice("sha256:".length)}`;
  return {
    schema_version: 1,
    packet_id: packetId,
    packet_ref: `record://delivery-packets/${packetId}`,
    packet_digest: packetDigest,
    content,
  };
}

function applicationRequest() {
  return {
    schema_version: 1,
    packet: prototypePacket(),
    operator_decision: {
      decision: "apply",
      operator_id: "codex-local",
      decision_ref: "record://delivery-decisions/sample-apply",
    },
  };
}

function readiness({ outcome = "allow" } = {}) {
  const allow = outcome === "allow";
  const digest = `sha256:${"5".repeat(64)}`;
  const uri =
    `wgcf://receipts/prototype-ingress-readiness/` +
    `prototype-ingress-readiness-receipt-${"6".repeat(24)}-${digest.slice(7)}.json`;
  return {
    reference: { uri, digest },
    receipt: {
      receipt_id: `prototype-ingress-readiness-receipt:${"6".repeat(24)}`,
      decision: {
        outcome,
        target_application_allowed: allow,
        mutation_authority: "none",
        reason_codes: allow ? ["eligible"] : ["policy-profile-denied"],
        evaluated_at: NOW,
      },
    },
  };
}

function createHarness({ readinessOutcome = "allow" } = {}) {
  const state = {
    event: null,
    ingressCalls: 0,
    issueCalls: 0,
    readCalls: 0,
    target: null,
  };
  const adapter = {
    async inspect() {
      return state.target
        ? { ...state.target, appliedEvent: state.event }
        : null;
    },
    async recordEvent({ event }) {
      state.event = { activityId: 71, event };
      return state.event;
    },
  };
  const readinessClient = {
    async issue() {
      state.issueCalls += 1;
      return readiness({ outcome: readinessOutcome });
    },
    async read() {
      state.readCalls += 1;
      return readiness({ outcome: readinessOutcome });
    },
  };
  const deliveryIngressService = {
    async apply({ envelope, sourceContext }) {
      state.ingressCalls += 1;
      const targetExisted = Boolean(state.target);
      state.target ??= {
        marker: sourceContext.marker,
        target: { recordId: 901 },
      };
      return {
        adapterResult: {
          detailedTarget: {
            application_state: targetExisted ? "reused" : "created",
            owner_repo: "workspace-prototype-studio",
            record_id: 901,
            record_ref: "openproject://work_packages/901",
            record_version: 3,
          },
        },
        result: { ingress_id: envelope.ingress_id },
      };
    },
  };
  const service = createPrototypeDeliveryApplicationService({
    adapter,
    clock: () => new Date(NOW),
    deliveryIngressService,
    readinessClient,
  });
  return { adapter, deliveryIngressService, readinessClient, service, state };
}

test("Prototype Delivery application creates one target and replays from its trusted event", async () => {
  const { service, state } = createHarness();
  const request = applicationRequest();
  const created = await service.apply({
    callerId: "codex-local",
    correlationId: "correlation:create",
    request,
  });
  const replayed = await service.apply({
    callerId: "codex-local",
    correlationId: "correlation:replay",
    request,
  });

  assert.equal(created.resolution, "created");
  assert.equal(created.target.record_ref, "openproject://work_packages/901");
  assert.equal(created.receipt.custody.uri, "openproject://work_packages/901/activities/71");
  assert.equal(replayed.resolution, "reused");
  assert.equal(replayed.receipt.receipt_ref, created.receipt.receipt_ref);
  assert.equal(state.issueCalls, 1);
  assert.equal(state.readCalls, 0);
  assert.equal(state.ingressCalls, 1);
});

test("concurrent Prototype Delivery application requests serialize to one mutation", async () => {
  const { service, state } = createHarness();
  const request = applicationRequest();
  const [first, second] = await Promise.all([
    service.apply({
      callerId: "codex-local",
      correlationId: "correlation:concurrent-1",
      request,
    }),
    service.apply({
      callerId: "codex-local",
      correlationId: "correlation:concurrent-2",
      request,
    }),
  ]);
  assert.equal(first.receipt.receipt_ref, second.receipt.receipt_ref);
  assert.equal(state.issueCalls, 1);
  assert.equal(state.ingressCalls, 1);
});

test("Prototype Delivery application repairs a missing event from the target marker", async () => {
  const { service, state } = createHarness();
  const request = applicationRequest();
  const applicationId = prototypeDeliveryApplicationId(request.packet);
  const envelope = prototypeDeliveryIngressEnvelope({
    applicationId,
    operatorDecision: request.operator_decision,
    packet: request.packet,
  });
  state.target = {
    marker: prototypeDeliveryTargetMarker({
      envelope,
      operatorDecision: request.operator_decision,
      readiness: readiness(),
    }),
    target: { recordId: 901 },
  };

  const repaired = await service.apply({
    callerId: "codex-local",
    correlationId: "correlation:repair",
    request,
  });

  assert.equal(repaired.resolution, "reused");
  assert.equal(state.issueCalls, 0);
  assert.equal(state.readCalls, 1);
  assert.equal(state.ingressCalls, 1);
});

test("Prototype Delivery application denies mutation when WGCF denies readiness", async () => {
  const { service, state } = createHarness({ readinessOutcome: "deny" });
  await assert.rejects(
    () => service.apply({
      callerId: "codex-local",
      correlationId: "correlation:deny",
      request: applicationRequest(),
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "prototype_delivery_readiness_denied",
  );
  assert.equal(state.ingressCalls, 0);
  assert.equal(state.target, null);
});

test("Prototype Delivery application rejects caller and deterministic packet conflicts", async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.apply({
      callerId: "other-caller",
      correlationId: "correlation:caller",
      request: applicationRequest(),
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "prototype_delivery_operator_binding_mismatch",
  );

  const invalid = applicationRequest();
  invalid.packet.packet_digest = `sha256:${"9".repeat(64)}`;
  await assert.rejects(
    () => service.apply({
      callerId: "codex-local",
      correlationId: "correlation:packet",
      request: invalid,
    }),
    (error) =>
      error instanceof HttpError &&
      error.code === "prototype_delivery_packet_identity_mismatch",
  );
});

test("Prototype Delivery application GET returns a backend-derived read projection", async () => {
  const { service } = createHarness();
  const request = applicationRequest();
  const created = await service.apply({
    callerId: "codex-local",
    correlationId: "correlation:create",
    request,
  });
  const read = await service.get({
    applicationId: created.application_id,
    callerId: "codex-local",
    correlationId: "correlation:read",
  });
  assert.equal(read.resolution, "read");
  assert.equal(read.receipt.receipt_ref, created.receipt.receipt_ref);
});
