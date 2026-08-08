import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { artifactContentDigest } from "../src/delivery-art/contracts.js";
import { canonicalStringify } from "../src/delivery-art/canonical-json.js";
import {
  createDeliveryArtArtifactService,
  DeliveryArtServiceError,
} from "../src/delivery-art/service.js";

const FIXTURE_ROOT = new URL("../test-fixtures/delivery-art/", import.meta.url);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function createHarness({ externalResolver = true, stale = false } = {}) {
  const attachments = new Map();
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
    async persistDeliveryArtAttachment({ content, deliveryRecordId, filename }) {
      const key = `${deliveryRecordId}/${filename}`;
      const existing = attachments.get(key);
      if (existing && existing !== content) {
        throw new Error("test artifact collision");
      }
      attachments.set(key, content);
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
  };
  const service = createDeliveryArtArtifactService({
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
    openProjectClient,
  });
  return { attachments, externalArtifacts, service, writes };
}

test("Delivery ART service persists the governed architecture, work-start, and Review Packet chain", async () => {
  const { externalArtifacts, service, writes } = createHarness();
  const callerId = "operator:workspace-owner";

  const architecture = await service.persistArchitecturePacket({
    artifact: fixture("architecture-packet.valid.json"),
    callerId,
  });
  assert.equal(architecture.artifact.custody.state, "durable");
  assert.equal(architecture.owner_receipt.replayed, false);

  const workStartInput = fixture("work-start-record.valid.json");
  workStartInput.architecture.packet_ref = architecture.artifact.custody.uri;
  workStartInput.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  const workStart = await service.evaluateWorkStart({
    artifact: workStartInput,
    callerId,
  });
  assert.equal(workStart.artifact.readiness.level, "implementation-ready");
  assert.deepEqual(workStart.artifact.readiness.blockers, []);

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
  });
  assert.equal(mergeReady.artifact.status, "merge-ready");
  assert.match(mergeReady.artifact.custody.uri, /-merge-ready-[0-9a-f]{64}\.json$/);

  const postMerge = structuredClone(mergeReady.artifact);
  postMerge.landing_unit.evidence_kind = "merged_pr";
  postMerge.landing_unit.repos[0].merge_commit = "4444444444444444444444444444444444444444";
  const prepared = await service.prepareReviewPacketFinalization({
    artifact: postMerge,
    callerId,
  });
  assert.equal(prepared.finalization_candidate.status, "finalized");
  assert.equal(prepared.readiness_request.digest_kind, "readiness-subject");

  const receipt = fixture("readiness-receipt.valid.json");
  receipt.subject.artifact_id = prepared.finalization_candidate.packet_id;
  receipt.subject.digest = prepared.finalization_candidate.readiness.subject_digest;
  receipt.readiness.evaluated_at = prepared.finalization_candidate.readiness.evaluated_at;
  receipt.custody.persisted_at = prepared.finalization_candidate.readiness.evaluated_at;
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
  });
  assert.equal(finalized.artifact.status, "finalized");
  assert.equal(finalized.artifact.custody.supersedes.uri, mergeReady.artifact.custody.uri);
  assert.equal(finalized.owner_receipt.content_digest, finalized.artifact.integrity.content_digest);
  assert.equal(writes.length, 4);

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
