import test from "node:test";
import assert from "node:assert/strict";

import { OpenProjectError } from "../src/errors.js";
import {
  buildPrototypeDeliveryDescription,
  createPrototypeDeliveryIngressAdapter,
  decodePrototypeDeliveryTargetMarker,
  prototypeDeliveryTargetMarker,
} from "../src/delivery-ingress/prototype-adapter.js";
import {
  buildPrototypeDeliveryApplicationEvent,
  prototypeDeliveryApplicationId,
  prototypeDeliveryIngressEnvelope,
} from "../src/delivery-ingress/prototype-application-model.js";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { encodePrototypeDeliveryApplicationEvent } from
  "../src/delivery-ingress/prototype-event-codec.js";

const NOW = "2026-08-25T06:00:00.000Z";

function packet() {
  const content = {
    intent: "governed-delivery",
    target: "workspace-delivery-art",
    source: {
      kind: "prototype",
      prototype_id: "adapter-proof",
      record_ref: "record://prototypes/adapter-proof",
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
      record_ref: "record://design-baselines/adapter-proof-v1",
      baseline_id: "adapter-proof-v1",
      schema_version: 1,
      version: "adapter-proof-v1@sha256:proof",
      record_digest: `sha256:${"4".repeat(64)}`,
    },
    work: {
      title: "Adapter proof",
      objective: "Prove target application through the OpenProject adapter.",
      included_scope: ["One Delivery Epic"],
      excluded_scope: [],
      remaining_work: ["Continue governed implementation"],
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
      rationale: "Source custody is resolved.",
    },
    authorization: {
      decision: "approved",
      operator_id: "codex-local",
      decision_ref: "record://prototype-decisions/adapter-proof",
    },
    evidence_refs: ["record://evidence/adapter-proof"],
    rationale: "The approved prototype requires governed continuation.",
  };
  const packetDigest = canonicalDigest(content);
  const packetId = `adapter-proof-${packetDigest.slice(7)}`;
  return {
    schema_version: 1,
    packet_id: packetId,
    packet_ref: `record://delivery-packets/${packetId}`,
    packet_digest: packetDigest,
    content,
  };
}

function readiness() {
  return {
    reference: {
      uri:
        `wgcf://receipts/prototype-ingress-readiness/` +
        `prototype-ingress-readiness-receipt-${"6".repeat(24)}-${"5".repeat(64)}.json`,
      digest: `sha256:${"5".repeat(64)}`,
    },
    receipt: {
      receipt_id: `prototype-ingress-readiness-receipt:${"6".repeat(24)}`,
      decision: {
        outcome: "allow",
        target_application_allowed: true,
        mutation_authority: "none",
        reason_codes: ["eligible"],
        evaluated_at: NOW,
      },
    },
  };
}

function applicationContext() {
  const sourcePacket = packet();
  const operatorDecision = {
    decision: "apply",
    operator_id: "codex-local",
    decision_ref: "record://delivery-decisions/adapter-proof",
  };
  const applicationId = prototypeDeliveryApplicationId(sourcePacket);
  const envelope = prototypeDeliveryIngressEnvelope({
    applicationId,
    operatorDecision,
    packet: sourcePacket,
  });
  const readinessResult = readiness();
  const marker = prototypeDeliveryTargetMarker({
    envelope,
    operatorDecision,
    readiness: readinessResult,
  });
  return {
    applicationId,
    envelope,
    marker,
    operatorDecision,
    packet: sourcePacket,
    readiness: readinessResult,
  };
}

test("Prototype adapter creates a versioned Delivery Epic with durable source markers", async () => {
  const targets = [];
  const openProjectClient = {
    async createPrototypeDeliveryApplicationTarget(input) {
      const target = {
        description: input.description,
        ownerRepo: input.ownerRepo,
        recordId: 901,
        recordRef: "openproject://work_packages/901",
        recordVersion: 1,
        title: input.title,
      };
      targets.push(target);
      return target;
    },
    async getPrototypeDeliveryAutomationUserRef() {
      return "/api/v3/users/7";
    },
    async listPrototypeDeliveryApplicationActivities() {
      return { items: [], pageSize: 100, total: 0 };
    },
    async listPrototypeDeliveryApplicationTargets() {
      return targets;
    },
  };
  const adapter = createPrototypeDeliveryIngressAdapter({ openProjectClient });
  const context = applicationContext();
  const applied = await adapter.apply({
    envelope: context.envelope,
    sourceContext: {
      marker: context.marker,
      operatorDecision: context.operatorDecision,
      packet: context.packet,
      readiness: context.readiness,
    },
  });

  assert.equal(applied.target.application_state, "created");
  assert.equal(targets.length, 1);
  assert.equal(
    decodePrototypeDeliveryTargetMarker(targets[0].description).application_id,
    context.applicationId,
  );
  assert.match(targets[0].description, /## What This Enables/);
  assert.match(targets[0].description, /## Evidence Expectation/);
  assert.match(targets[0].description, /## Execution Context/);
  assert.doesNotMatch(targets[0].description, /origin idea ref/i);
});

test("Prototype adapter trusts only OOS-authored application events", async () => {
  const context = applicationContext();
  const target = {
    description: buildPrototypeDeliveryDescription({
      envelope: context.envelope,
      marker: context.marker,
      packet: context.packet,
    }),
    ownerRepo: "workspace-prototype-studio",
    recordId: 901,
    recordRef: "openproject://work_packages/901",
    recordVersion: 1,
    title: "Adapter proof",
  };
  const event = buildPrototypeDeliveryApplicationEvent({
    applicationId: context.applicationId,
    ingressId: context.envelope.ingress_id,
    operatorDecision: context.operatorDecision,
    packet: context.packet,
    readiness: context.readiness,
    recordedAt: NOW,
    target: {
      application_state: "created",
      owner_repo: target.ownerRepo,
      record_ref: target.recordRef,
      record_version: target.recordVersion,
    },
  });
  const openProjectClient = {
    async getPrototypeDeliveryAutomationUserRef() {
      return "/api/v3/users/7";
    },
    async listPrototypeDeliveryApplicationActivities() {
      return {
        items: [
          {
            comment: encodePrototypeDeliveryApplicationEvent(event),
            id: 70,
            userRef: "/api/v3/users/99",
          },
          {
            comment: encodePrototypeDeliveryApplicationEvent(event),
            id: 71,
            userRef: "/api/v3/users/7",
          },
        ],
        pageSize: 100,
        total: 2,
      };
    },
    async listPrototypeDeliveryApplicationTargets() {
      return [target];
    },
  };
  const inspected = await createPrototypeDeliveryIngressAdapter({
    openProjectClient,
  }).inspect(context.applicationId);
  assert.equal(inspected.appliedEvent.activityId, 71);
});

test("Prototype adapter rejects a trusted event whose receipt digest was altered", async () => {
  const context = applicationContext();
  const target = {
    description: buildPrototypeDeliveryDescription({
      envelope: context.envelope,
      marker: context.marker,
      packet: context.packet,
    }),
    ownerRepo: "workspace-prototype-studio",
    recordId: 901,
    recordRef: "openproject://work_packages/901",
    recordVersion: 1,
    title: "Adapter proof",
  };
  const event = buildPrototypeDeliveryApplicationEvent({
    applicationId: context.applicationId,
    ingressId: context.envelope.ingress_id,
    operatorDecision: context.operatorDecision,
    packet: context.packet,
    readiness: context.readiness,
    recordedAt: NOW,
    target: {
      application_state: "created",
      owner_repo: target.ownerRepo,
      record_ref: target.recordRef,
      record_version: target.recordVersion,
    },
  });
  event.receipt.content_digest = `sha256:${"9".repeat(64)}`;
  const adapter = createPrototypeDeliveryIngressAdapter({
    openProjectClient: {
      async getPrototypeDeliveryAutomationUserRef() {
        return "/api/v3/users/7";
      },
      async listPrototypeDeliveryApplicationActivities() {
        return {
          items: [{
            comment: encodePrototypeDeliveryApplicationEvent(event),
            id: 71,
            userRef: "/api/v3/users/7",
          }],
          pageSize: 100,
          total: 1,
        };
      },
      async listPrototypeDeliveryApplicationTargets() {
        return [target];
      },
    },
  });
  await assert.rejects(
    () => adapter.inspect(context.applicationId),
    (error) => error?.code === "prototype_delivery_event_invalid",
  );
});

test("Prototype adapter recovers a committed event when the write response is lost", async () => {
  const context = applicationContext();
  const event = buildPrototypeDeliveryApplicationEvent({
    applicationId: context.applicationId,
    ingressId: context.envelope.ingress_id,
    operatorDecision: context.operatorDecision,
    packet: context.packet,
    readiness: context.readiness,
    recordedAt: NOW,
    target: {
      application_state: "created",
      owner_repo: "workspace-prototype-studio",
      record_ref: "openproject://work_packages/901",
      record_version: 1,
    },
  });
  const activities = [];
  const openProjectClient = {
    async addPrototypeDeliveryApplicationEvent({ raw }) {
      activities.push({ id: 71, comment: raw, userRef: "/api/v3/users/7" });
      throw new OpenProjectError(
        "backend_unavailable",
        "response lost",
        503,
        "network_error",
      );
    },
    async getPrototypeDeliveryAutomationUserRef() {
      return "/api/v3/users/7";
    },
    async listPrototypeDeliveryApplicationActivities() {
      return { items: activities, pageSize: 100, total: activities.length };
    },
  };
  const recorded = await createPrototypeDeliveryIngressAdapter({
    openProjectClient,
  }).recordEvent({ event, recordId: 901 });
  assert.equal(recorded.activityId, 71);
  assert.deepEqual(recorded.event, event);
});
