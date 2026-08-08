import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { artifactContentDigest } from "../src/delivery-art/contracts.js";
import { canonicalStringify } from "../src/delivery-art/canonical-json.js";
import {
  createDeliveryArtArtifactService,
  DELIVERY_ART_MUTATION_OPERATIONS,
  DeliveryArtServiceError,
} from "../src/delivery-art/service.js";

const FIXTURE_ROOT = new URL("../test-fixtures/delivery-art/", import.meta.url);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function createHarness({
  externalResolver = true,
  mutationAdmitted = true,
  stale = false,
} = {}) {
  const auditEvents = [];
  const attachments = new Map();
  const attachmentDescriptions = new Map();
  const externalArtifacts = new Map();
  const writes = [];
  const times = [
    "2026-08-08T02:06:00.000Z",
    "2026-08-08T02:10:00.000Z",
    "2026-08-08T02:11:00.000Z",
    "2026-08-08T03:15:00.000Z",
    "2026-08-08T03:16:00.000Z",
    "2026-08-08T03:30:00.000Z",
    "2026-08-08T03:31:00.000Z",
  ];
  let timeIndex = 0;
  const openProjectClient = {
    async captureDeliveryArtScope({ workItemRecordIds }) {
      const expected = workItemRecordIds.length === 2
        ? "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        : "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      return {
        artDigest: stale
          ? "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
          : expected,
      };
    },
    async persistDeliveryArtAttachment({ content, deliveryRecordId, description, filename }) {
      const key = `${deliveryRecordId}/${filename}`;
      const existing = attachments.get(key);
      if (existing && existing !== content) {
        throw new Error("test artifact collision");
      }
      attachments.set(key, content);
      attachmentDescriptions.set(key, description);
      writes.push(key);
      return {
        recovered: false,
        replayed: Boolean(existing),
      };
    },
    async readDeliveryArtAttachment({ deliveryRecordId, filename }) {
      const content = attachments.get(`${deliveryRecordId}/${filename}`);
      if (!content) {
        const error = new Error(`missing test artifact ${deliveryRecordId}/${filename}`);
        error.errorClass = "not_found";
        throw error;
      }
      return { content };
    },
    async readDeliveryArtOperationAttachment({ deliveryRecordId, operationKey }) {
      const marker = `Delivery ART operation: ${operationKey}`;
      const matches = [...attachmentDescriptions.entries()].filter(([key, description]) =>
        key.startsWith(`${deliveryRecordId}/`) &&
        description.split(/\r?\n/).some((line) => line.trim() === marker)
      );
      if (matches.length === 0) {
        const error = new Error(`missing test operation ${operationKey}`);
        error.errorClass = "not_found";
        throw error;
      }
      if (matches.length > 1) {
        throw new Error(`ambiguous test operation ${operationKey}`);
      }
      return { content: attachments.get(matches[0][0]) };
    },
  };
  const service = createDeliveryArtArtifactService({
    audit: {
      emit(event) {
        auditEvents.push(event);
      },
    },
    clock() {
      const value = times[timeIndex] ?? times.at(-1);
      timeIndex += 1;
      return new Date(value);
    },
    externalArtifactResolver: externalResolver
      ? (reference) => {
          const artifact = externalArtifacts.get(reference.uri);
          if (!artifact) {
            throw new Error(`missing external test artifact ${reference.uri}`);
          }
          return { artifact };
        }
      : null,
    mutationAdmission: {
      admitted: mutationAdmitted,
      reason: mutationAdmitted ? "test_admission" : "delivery_art_runtime_activation_pending",
    },
    openProjectClient,
  });
  return { attachments, auditEvents, externalArtifacts, service, writes };
}

test("Delivery ART service persists the governed architecture, work-start, and Review Packet chain", async () => {
  const { auditEvents, externalArtifacts, service, writes } = createHarness();
  const callerId = "operator:workspace-owner";

  const architecture = await service.persistArchitecturePacket({
    artifact: fixture("architecture-packet.valid.json"),
    callerId,
    correlationId: "correlation:architecture-persist",
  });
  assert.equal(architecture.artifact.custody.state, "durable");
  assert.equal(architecture.owner_receipt.replayed, false);

  const workStartInput = fixture("work-start-record.valid.json");
  workStartInput.architecture.packet_ref = architecture.artifact.custody.uri;
  workStartInput.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  const workStart = await service.evaluateWorkStart({
    artifact: workStartInput,
    callerId,
    correlationId: "correlation:work-start",
  });
  assert.equal(workStart.artifact.readiness.level, "implementation-ready");
  assert.deepEqual(workStart.artifact.readiness.blockers, []);
  const workStartReplay = await service.evaluateWorkStart({
    artifact: workStartInput,
    callerId,
    correlationId: "correlation:work-start-retry",
  });
  assert.deepEqual(workStartReplay.artifact, workStart.artifact);
  assert.equal(workStartReplay.owner_receipt.replayed, true);

  const reviewInput = fixture("review-packet-merge-ready.valid.json");
  reviewInput.status = "draft";
  reviewInput.readiness.level = "implementation-ready";
  reviewInput.work_start = {
    artifact_digest: workStart.artifact.integrity.content_digest,
    artifact_ref: workStart.artifact.custody.uri,
    scope_fingerprint: workStart.artifact.scope_fingerprint,
  };
  reviewInput.integrity.content_digest = artifactContentDigest(reviewInput);
  const mergeReady = await service.markReviewPacketMergeReady({
    artifact: reviewInput,
    callerId,
    correlationId: "correlation:merge-ready",
  });
  assert.equal(mergeReady.artifact.status, "merge-ready");
  assert.match(mergeReady.artifact.custody.uri, /-merge-ready-[0-9a-f]{64}\.json$/);
  const mergeReadyReplay = await service.markReviewPacketMergeReady({
    artifact: reviewInput,
    callerId,
    correlationId: "correlation:merge-ready-retry",
  });
  assert.deepEqual(mergeReadyReplay.artifact, mergeReady.artifact);
  assert.equal(mergeReadyReplay.owner_receipt.replayed, true);

  const postMerge = structuredClone(mergeReady.artifact);
  postMerge.landing_unit.evidence_kind = "merged_pr";
  postMerge.landing_unit.repos[0].merge_commit = "4444444444444444444444444444444444444444";
  const prepared = await service.prepareReviewPacketFinalization({
    artifact: postMerge,
    callerId,
    correlationId: "correlation:prepare-finalization",
  });
  assert.equal(prepared.finalization_candidate.status, "finalized");
  assert.equal(prepared.finalization_candidate.finalized_at, null);
  assert.equal(prepared.finalization_candidate.readiness.evaluated_at, null);
  assert.equal(prepared.readiness_request.digest_kind, "readiness-subject");

  const receipt = fixture("readiness-receipt.valid.json");
  receipt.subject.artifact_id = prepared.finalization_candidate.packet_id;
  receipt.subject.digest = prepared.finalization_candidate.readiness.subject_digest;
  receipt.readiness.evaluated_at = "2026-08-08T03:20:00.000Z";
  receipt.custody.persisted_at = "2026-08-08T03:21:00.000Z";
  receipt.integrity.content_digest = artifactContentDigest(receipt);
  receipt.custody.uri =
    `wgcf://receipts/art-readiness/${receipt.receipt_id.replace(":", "-")}-` +
    `${receipt.integrity.content_digest.slice("sha256:".length)}.json`;
  externalArtifacts.set(receipt.custody.uri, receipt);
  prepared.finalization_candidate.readiness.receipt_refs = [
    {
      digest: receipt.integrity.content_digest,
      uri: receipt.custody.uri,
    },
  ];
  prepared.finalization_candidate.integrity.content_digest = artifactContentDigest(
    prepared.finalization_candidate,
  );

  const finalized = await service.finalizeReviewPacket({
    artifact: prepared.finalization_candidate,
    callerId,
    correlationId: "correlation:finalize",
  });
  assert.equal(finalized.artifact.status, "finalized");
  assert.equal(finalized.artifact.custody.supersedes.uri, mergeReady.artifact.custody.uri);
  assert.equal(finalized.owner_receipt.content_digest, finalized.artifact.integrity.content_digest);
  assert.equal(writes.length, 4);
  assert.equal(finalized.artifact.readiness.evaluated_at, receipt.readiness.evaluated_at);
  assert.equal(finalized.artifact.finalized_at, "2026-08-08T03:30:00.000Z");
  const finalizedReplay = await service.finalizeReviewPacket({
    artifact: prepared.finalization_candidate,
    callerId,
    correlationId: "correlation:finalize-retry",
  });
  assert.deepEqual(finalizedReplay.artifact, finalized.artifact);
  assert.equal(finalizedReplay.owner_receipt.replayed, true);
  assert.ok(Date.parse(receipt.readiness.evaluated_at) <= Date.parse(receipt.custody.persisted_at));
  assert.ok(Date.parse(receipt.custody.persisted_at) <= Date.parse(finalized.artifact.finalized_at));
  assert.ok(Date.parse(finalized.artifact.finalized_at) <= Date.parse(finalized.artifact.custody.persisted_at));
  assert.deepEqual(
    auditEvents.map(({ correlation_id, operation, outcome }) => ({
      correlation_id,
      operation,
      outcome,
    })),
    [
      {
        correlation_id: "correlation:architecture-persist",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.persistArchitecturePacket,
        outcome: "success",
      },
      {
        correlation_id: "correlation:work-start",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.evaluateWorkStart,
        outcome: "success",
      },
      {
        correlation_id: "correlation:work-start-retry",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.evaluateWorkStart,
        outcome: "success",
      },
      {
        correlation_id: "correlation:merge-ready",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.markReviewPacketMergeReady,
        outcome: "success",
      },
      {
        correlation_id: "correlation:merge-ready-retry",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.markReviewPacketMergeReady,
        outcome: "success",
      },
      {
        correlation_id: "correlation:prepare-finalization",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.prepareReviewPacketFinalization,
        outcome: "success",
      },
      {
        correlation_id: "correlation:finalize",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.finalizeReviewPacket,
        outcome: "success",
      },
      {
        correlation_id: "correlation:finalize-retry",
        operation: DELIVERY_ART_MUTATION_OPERATIONS.finalizeReviewPacket,
        outcome: "success",
      },
    ],
  );

  const validation = await service.validateArtifact({ artifact: finalized.artifact });
  assert.equal(validation.valid, true);

  const resolved = await service.resolveArtifact({
    reference: {
      digest: finalized.artifact.integrity.content_digest,
      uri: finalized.artifact.custody.uri,
    },
  });
  assert.deepEqual(resolved.artifact, finalized.artifact);
});

test("Delivery ART service denies mutation until runtime admission is complete", async () => {
  const { auditEvents, service, writes } = createHarness({ mutationAdmitted: false });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: fixture("architecture-packet.valid.json"),
      callerId: "operator:workspace-owner",
      correlationId: "correlation:admission-denied",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_mutation_not_admitted" &&
      error.statusCode === 503,
  );

  assert.deepEqual(writes, []);
  assert.deepEqual(auditEvents, [{
    backend: {
      result: "blocked",
      system: "openproject",
      target_ref: "openproject://work_packages/698",
    },
    caller: {
      id: "operator:workspace-owner",
    },
    correlation_id: "correlation:admission-denied",
    error_class: "delivery_art_mutation_not_admitted",
    event_type: "delivery.artifact.mutation",
    operation: DELIVERY_ART_MUTATION_OPERATIONS.persistArchitecturePacket,
    outcome: "blocked",
    runtime_admission: {
      admitted: false,
      reason: "delivery_art_runtime_activation_pending",
    },
    status: "runtime_admission_pending",
  }]);
});

test("Delivery ART service fails before persistence when the scoped ART snapshot changed", async () => {
  const { service, writes } = createHarness({ stale: true });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: fixture("architecture-packet.valid.json"),
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409,
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service binds durable decisions to the authenticated caller", async () => {
  const { service, writes } = createHarness();

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: fixture("architecture-packet.valid.json"),
      callerId: "operator:different",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_decision_authority_mismatch" &&
      error.statusCode === 403,
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service returns canonical persisted content on idempotent replay", async () => {
  const { attachments, service } = createHarness();
  const input = fixture("architecture-packet.valid.json");
  const first = await service.persistArchitecturePacket({
    artifact: input,
    callerId: "operator:workspace-owner",
  });
  const second = await service.persistArchitecturePacket({
    artifact: input,
    callerId: "operator:workspace-owner",
  });

  assert.equal(second.owner_receipt.replayed, true);
  const stored = attachments.get(
    `698/${first.artifact.custody.uri.split("/").at(-1)}`,
  );
  assert.equal(stored, canonicalStringify(first.artifact));
});

test("Delivery ART service resolves the complete durable supersession chain", async () => {
  const { attachments, externalArtifacts, service } = createHarness();
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  const readinessReceipt = fixture("readiness-receipt.valid.json");
  const olderMergeReady = structuredClone(mergeReady);
  olderMergeReady.custody.uri =
    `openproject://work_packages/698/attachments/review-packet-prior-${olderMergeReady.integrity.content_digest.slice("sha256:".length)}.json`;
  olderMergeReady.custody.persisted_at = "2026-08-08T11:10:00+08:00";
  mergeReady.custody.supersedes = {
    digest: olderMergeReady.integrity.content_digest,
    uri: olderMergeReady.custody.uri,
  };

  for (const artifact of [architecture, workStart, olderMergeReady, mergeReady, finalized]) {
    const filename = artifact.custody.uri.split("/").at(-1);
    attachments.set(`698/${filename}`, canonicalStringify(artifact));
  }
  externalArtifacts.set(readinessReceipt.custody.uri, readinessReceipt);

  const dependencies = await service.resolveDependencies(finalized);

  assert.ok(dependencies.some((entry) => entry.custody.uri === mergeReady.custody.uri));
  assert.ok(dependencies.some((entry) => entry.custody.uri === olderMergeReady.custody.uri));
});

test("Delivery ART finalization fails closed without a trusted readiness-receipt resolver", async () => {
  const { attachments, service, writes } = createHarness({ externalResolver: false });
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");

  for (const artifact of [architecture, workStart, mergeReady]) {
    const filename = artifact.custody.uri.split("/").at(-1);
    attachments.set(`698/${filename}`, canonicalStringify(artifact));
  }

  await assert.rejects(
    () => service.finalizeReviewPacket({
      artifact: finalized,
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_dependency_resolver_unavailable" &&
      error.statusCode === 503,
  );
  assert.deepEqual(writes, []);
});
