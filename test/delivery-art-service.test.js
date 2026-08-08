import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  artifactContentDigest,
  reviewPacketReadinessSubjectDigest,
  validateDeliveryArtArtifact,
} from "../src/delivery-art/contracts.js";
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

function localCandidate(artifact, filename) {
  const candidate = structuredClone(artifact);
  candidate.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: artifact.custody?.supersedes ?? null,
    uri: `local://delivery-art/${filename}`,
  };
  return candidate;
}

function createHarness({
  externalResolver = true,
  mutationAdmitted = true,
  stale = false,
  staleAfterWrite = false,
  writerTopology = mutationAdmitted ? "single-writer" : null,
} = {}) {
  const auditEvents = [];
  const attachments = new Map();
  const attachmentDescriptions = new Map();
  const externalArtifacts = new Map();
  const writes = [];
  const times = [
    "2026-08-08T02:06:00.000Z",
    "2026-08-08T02:11:00.000Z",
    "2026-08-08T03:16:00.000Z",
    "2026-08-08T03:31:00.000Z",
  ];
  let staleArchitectureScope = false;
  let staleScope = stale;
  let timeIndex = 0;
  const openProjectClient = {
    async captureDeliveryArtScope({ workItemRecordIds }) {
      const expected = workItemRecordIds.length === 2
        ? "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        : "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      return {
        artDigest: staleScope ||
            (staleArchitectureScope && workItemRecordIds.length === 2)
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
      if (staleAfterWrite) {
        staleScope = true;
      }
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
      return {
        attachment: { filename },
        content,
      };
    },
    async readDeliveryArtArtifactFamily({ artifactId, artifactType, deliveryRecordId }) {
      return [...attachments.entries()]
        .filter(([key]) => key.startsWith(`${deliveryRecordId}/`))
        .flatMap(([key, content]) => {
          const artifact = JSON.parse(content);
          const identifier = artifact.artifact_id ?? artifact.packet_id ?? artifact.receipt_id;
          return artifact.artifact_type === artifactType && identifier === artifactId
            ? [{
                attachment: { filename: key.slice(`${deliveryRecordId}/`.length) },
                content,
                filename: key.slice(`${deliveryRecordId}/`.length),
              }]
            : [];
        });
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
      const [key] = matches[0];
      return {
        attachment: {
          filename: key.slice(`${deliveryRecordId}/`.length),
        },
        content: attachments.get(key),
      };
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
      writerTopology,
    },
    openProjectClient,
  });
  return {
    attachments,
    attachmentDescriptions,
    auditEvents,
    externalArtifacts,
    service,
    setArchitectureStale(value) {
      staleArchitectureScope = value;
    },
    setStale(value) {
      staleScope = value;
    },
    writes,
  };
}

test("Delivery ART service persists the governed architecture, work-start, and Review Packet chain", async () => {
  const { auditEvents, externalArtifacts, service, writes } = createHarness();
  const callerId = "operator:workspace-owner";

  const architecture = await service.persistArchitecturePacket({
    artifact: localCandidate(
      fixture("architecture-packet.valid.json"),
      "architecture-packet.json",
    ),
    callerId,
    correlationId: "correlation:architecture-persist",
  });
  assert.equal(architecture.artifact.custody.state, "durable");
  assert.equal(architecture.owner_receipt.replayed, false);

  const workStartInput = fixture("work-start-record.valid.json");
  workStartInput.architecture.packet_ref = architecture.artifact.custody.uri;
  workStartInput.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  workStartInput.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  workStartInput.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: null,
    uri: "local://delivery-art/work-start.json",
  };
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
  reviewInput.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: null,
    uri: "local://delivery-art/review-packet.json",
  };
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
  assert.equal(finalized.artifact.finalized_at, "2026-08-08T03:21:00.000Z");
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

test("Delivery ART service serializes overlapping work-start retries", async () => {
  const { service, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const architecture = await service.persistArchitecturePacket({
    artifact: localCandidate(
      fixture("architecture-packet.valid.json"),
      "architecture-packet-overlap.json",
    ),
    callerId,
  });
  writes.length = 0;

  const input = fixture("work-start-record.valid.json");
  input.architecture.packet_ref = architecture.artifact.custody.uri;
  input.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  input.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  input.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: null,
    uri: "local://delivery-art/work-start-overlap.json",
  };

  const [first, second] = await Promise.all([
    service.evaluateWorkStart({ artifact: structuredClone(input), callerId }),
    service.evaluateWorkStart({ artifact: structuredClone(input), callerId }),
  ]);

  assert.deepEqual(second.artifact, first.artifact);
  assert.equal(first.artifact.readiness.evaluated_at, "2026-08-08T02:10:00.000Z");
  assert.equal(first.artifact.custody.persisted_at, "2026-08-08T02:11:00.000Z");
  assert.equal(writes.length, 1);
  assert.deepEqual(
    [first.owner_receipt.replayed, second.owner_receipt.replayed].sort(),
    [false, true],
  );
});

test("Delivery ART service requires explicit supersession for changed work-start intent", async () => {
  const { service, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const architecture = await service.persistArchitecturePacket({
    artifact: localCandidate(
      fixture("architecture-packet.valid.json"),
      "architecture-packet-work-start-claim.json",
    ),
    callerId,
  });
  const input = localCandidate(
    fixture("work-start-record.valid.json"),
    "work-start-claim.json",
  );
  input.architecture.packet_ref = architecture.artifact.custody.uri;
  input.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  input.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  const first = await service.evaluateWorkStart({ artifact: input, callerId });

  const changed = structuredClone(input);
  changed.landing_unit.split_reason =
    "The revised owner boundary still requires an isolated landing unit.";
  await assert.rejects(
    () => service.evaluateWorkStart({ artifact: changed, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_operation_intent_conflict" &&
      error.statusCode === 409,
  );
  assert.equal(writes.length, 2);

  changed.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  const successor = await service.evaluateWorkStart({ artifact: changed, callerId });

  assert.deepEqual(successor.artifact.custody.supersedes, changed.custody.supersedes);
  assert.equal(writes.length, 3);
});

test("Delivery ART service requires explicit supersession for changed Review Packet intent", async () => {
  const { service, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const architecture = await service.persistArchitecturePacket({
    artifact: localCandidate(
      fixture("architecture-packet.valid.json"),
      "architecture-packet-review-claim.json",
    ),
    callerId,
  });
  const workStartInput = localCandidate(
    fixture("work-start-record.valid.json"),
    "work-start-review-claim.json",
  );
  workStartInput.architecture.packet_ref = architecture.artifact.custody.uri;
  workStartInput.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  workStartInput.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  const workStart = await service.evaluateWorkStart({
    artifact: workStartInput,
    callerId,
  });
  const input = localCandidate(
    fixture("review-packet-merge-ready.valid.json"),
    "review-packet-claim.json",
  );
  input.status = "draft";
  input.readiness.level = "implementation-ready";
  input.work_start = {
    artifact_digest: workStart.artifact.integrity.content_digest,
    artifact_ref: workStart.artifact.custody.uri,
    scope_fingerprint: workStart.artifact.scope_fingerprint,
  };
  const first = await service.markReviewPacketMergeReady({ artifact: input, callerId });

  const changed = structuredClone(input);
  changed.evidence.tests[0].summary =
    "The revised exact-head test evidence remains complete and passing.";
  await assert.rejects(
    () => service.markReviewPacketMergeReady({ artifact: changed, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_operation_intent_conflict" &&
      error.statusCode === 409,
  );
  assert.equal(writes.length, 3);

  changed.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  const successor = await service.markReviewPacketMergeReady({
    artifact: changed,
    callerId,
  });

  assert.deepEqual(successor.artifact.custody.supersedes, changed.custody.supersedes);
  assert.equal(writes.length, 4);
});

test("Delivery ART service requires local architecture candidates and explicit supersession", async () => {
  const { service, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const durable = fixture("architecture-packet.valid.json");
  await assert.rejects(
    () => service.persistArchitecturePacket({ artifact: durable, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_architecture_input_not_local" &&
      error.statusCode === 409,
  );

  const input = localCandidate(durable, "architecture-packet-claim.json");
  const first = await service.persistArchitecturePacket({ artifact: input, callerId });
  const changed = structuredClone(input);
  changed.decision.rationale =
    "The revised decision keeps the owner boundaries and sequence explicit.";
  await assert.rejects(
    () => service.persistArchitecturePacket({ artifact: changed, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_operation_intent_conflict" &&
      error.statusCode === 409,
  );

  changed.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  const successor = await service.persistArchitecturePacket({
    artifact: changed,
    callerId,
  });

  assert.deepEqual(successor.artifact.custody.supersedes, changed.custody.supersedes);
  assert.equal(writes.length, 2);
});

test("Delivery ART service rejects edits to a durable merge-ready Review Packet", async () => {
  const { service, writes } = createHarness();

  await assert.rejects(
    () => service.markReviewPacketMergeReady({
      artifact: fixture("review-packet-merge-ready.valid.json"),
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_merge_ready_input_not_local" &&
      error.statusCode === 409,
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service denies mutation until runtime admission is complete", async () => {
  const { auditEvents, service, writes } = createHarness({ mutationAdmitted: false });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: localCandidate(
        fixture("architecture-packet.valid.json"),
        "architecture-packet-admission.json",
      ),
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
      writer_topology: null,
    },
    status: "runtime_admission_pending",
  }]);
});

test("Delivery ART service denies mutation for a non-single-writer topology", async () => {
  const { auditEvents, service, writes } = createHarness({ writerTopology: "multi-writer" });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: localCandidate(
        fixture("architecture-packet.valid.json"),
        "architecture-packet-topology.json",
      ),
      callerId: "operator:workspace-owner",
      correlationId: "correlation:topology-denied",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_mutation_not_admitted" &&
      error.statusCode === 503 &&
      error.details?.reason === "delivery_art_single_writer_topology_required" &&
      error.details?.writer_topology === "multi-writer",
  );

  assert.deepEqual(writes, []);
  assert.equal(auditEvents.length, 1);
  assert.deepEqual(auditEvents[0].runtime_admission, {
    admitted: false,
    reason: "delivery_art_single_writer_topology_required",
    writer_topology: "multi-writer",
  });
});

test("Delivery ART service binds resolved artifacts to the requested custody URI", async () => {
  const { attachments, service } = createHarness();
  const artifact = fixture("architecture-packet.valid.json");
  const aliasFilename = "architecture-packet-alias.json";
  const aliasUri = `openproject://work_packages/698/attachments/${aliasFilename}`;
  attachments.set(`698/${aliasFilename}`, canonicalStringify(artifact));

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: artifact.integrity.content_digest,
        uri: aliasUri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_dependency_custody_mismatch" &&
      error.statusCode === 409 &&
      error.details?.declared_custody_uri === artifact.custody.uri &&
      error.details?.requested_uri === aliasUri,
  );
});

test("Delivery ART service rejects a stale architecture packet during direct resolution", async () => {
  const { attachments, service, setStale } = createHarness();
  const architecture = fixture("architecture-packet.valid.json");
  const filename = architecture.custody.uri.split("/").at(-1);
  attachments.set(`698/${filename}`, canonicalStringify(architecture));
  setStale(true);

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: architecture.integrity.content_digest,
        uri: architecture.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409 &&
      error.details?.stale_artifact_id === architecture.artifact_id &&
      error.details?.stale_artifact_type === "delivery_art_architecture_packet",
  );
});

test("Delivery ART service rejects a stale work-start scope during direct resolution", async () => {
  const { attachments, service, setStale } = createHarness();
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  for (const artifact of [architecture, workStart]) {
    const filename = artifact.custody.uri.split("/").at(-1);
    attachments.set(`698/${filename}`, canonicalStringify(artifact));
  }
  setStale(true);

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: workStart.integrity.content_digest,
        uri: workStart.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409 &&
      error.details?.stale_artifact_id === workStart.artifact_id &&
      error.details?.stale_artifact_type === "delivery_art_work_start_record",
  );
});

test("Delivery ART service rejects stale referenced architecture during work-start resolution", async () => {
  const { attachments, service, setArchitectureStale } = createHarness();
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  for (const artifact of [architecture, workStart]) {
    const filename = artifact.custody.uri.split("/").at(-1);
    attachments.set(`698/${filename}`, canonicalStringify(artifact));
  }
  setArchitectureStale(true);

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: workStart.integrity.content_digest,
        uri: workStart.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409 &&
      error.details?.stale_artifact_id === architecture.artifact_id &&
      error.details?.stale_artifact_type === "delivery_art_architecture_packet",
  );
});

test("Delivery ART service binds idempotent replay to the selected attachment URI", async () => {
  const { attachments, attachmentDescriptions, service } = createHarness();
  const input = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-replay-custody.json",
  );
  const first = await service.persistArchitecturePacket({
    artifact: input,
    callerId: "operator:workspace-owner",
  });
  const key = `698/${first.artifact.custody.uri.split("/").at(-1)}`;
  const copiedArtifact = structuredClone(first.artifact);
  copiedArtifact.custody.uri =
    `openproject://work_packages/698/attachments/architecture-packet-alias-${first.artifact.integrity.content_digest.slice("sha256:".length)}.json`;
  attachments.set(key, canonicalStringify(copiedArtifact));
  attachmentDescriptions.delete(key);

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: input,
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_dependency_custody_mismatch" &&
      error.details?.declared_custody_uri === copiedArtifact.custody.uri &&
      error.details?.requested_uri === first.artifact.custody.uri,
  );
});

test("Delivery ART service binds operation recovery to the selected attachment URI", async () => {
  const { attachments, attachmentDescriptions, service } = createHarness();
  const input = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-operation-custody.json",
  );
  const first = await service.persistArchitecturePacket({
    artifact: input,
    callerId: "operator:workspace-owner",
  });
  const originalKey = `698/${first.artifact.custody.uri.split("/").at(-1)}`;
  const aliasFilename =
    `architecture-packet-operation-alias-${first.artifact.integrity.content_digest.slice("sha256:".length)}.json`;
  const aliasKey = `698/${aliasFilename}`;
  const content = attachments.get(originalKey);
  const description = attachmentDescriptions.get(originalKey);
  attachments.clear();
  attachmentDescriptions.clear();
  attachments.set(aliasKey, content);
  attachmentDescriptions.set(aliasKey, description);

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: input,
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_dependency_custody_mismatch" &&
      error.details?.declared_custody_uri === first.artifact.custody.uri &&
      error.details?.requested_uri ===
        `openproject://work_packages/698/attachments/${aliasFilename}`,
  );
});

test("Delivery ART service rejects non-source v2 finalization without a durable predecessor", async () => {
  const { service, writes } = createHarness();
  const artifact = localCandidate(
    fixture("review-packet-finalized.valid.json"),
    "review-packet-non-source.json",
  );
  artifact.landing_unit = {
    decision: "non_source_child",
    evidence_kind: "non_source_evidence",
    repos: [],
  };

  await assert.rejects(
    () => service.finalizeReviewPacket({
      artifact,
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_non_source_transition_unsupported" &&
      error.statusCode === 409,
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service rejects schema-valid non-source v2 packets during durable resolution", async () => {
  const { attachments, service } = createHarness();
  const artifact = fixture("review-packet-finalized.valid.json");
  artifact.landing_unit = {
    ...artifact.landing_unit,
    decision: "non_source_child",
    evidence_kind: "non_source_evidence",
    repos: [],
  };
  artifact.evidence.changed_surfaces = [];
  for (const section of ["tests", "validations", "runtime_and_live", "security_and_trust"]) {
    for (const entry of artifact.evidence[section]) {
      entry.source_revisions = [];
    }
  }
  for (const mapping of artifact.evidence.acceptance_mapping) {
    mapping.evidence_ids = mapping.evidence_ids.filter(
      (evidenceId) => evidenceId !== "evidence:contract",
    );
  }
  artifact.readiness.subject_digest = reviewPacketReadinessSubjectDigest(artifact);
  artifact.integrity.content_digest = artifactContentDigest(artifact);
  const filename =
    `review-packet-non-source-${artifact.integrity.content_digest.slice("sha256:".length)}.json`;
  artifact.custody.uri = `openproject://work_packages/698/attachments/${filename}`;
  assert.equal(validateDeliveryArtArtifact(artifact).valid, true);
  attachments.set(`698/${filename}`, canonicalStringify(artifact));

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: artifact.integrity.content_digest,
        uri: artifact.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_non_source_transition_unsupported" &&
      error.statusCode === 409,
  );
});

test("Delivery ART service rejects schema-v1 packets on v2 preparation", async () => {
  const { service, writes } = createHarness();
  const artifact = fixture("review-packet-merge-ready.valid.json");
  artifact.schema_version = 1;

  await assert.rejects(
    () => service.prepareReviewPacketFinalization({
      artifact,
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_review_packet_version",
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service revalidates the referenced architecture snapshot before work-start", async () => {
  const { service, setArchitectureStale, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const architecture = await service.persistArchitecturePacket({
    artifact: localCandidate(
      fixture("architecture-packet.valid.json"),
      "architecture-packet-stale-at-work-start.json",
    ),
    callerId,
  });
  writes.length = 0;
  setArchitectureStale(true);

  const workStart = localCandidate(
    fixture("work-start-record.valid.json"),
    "work-start-with-stale-architecture.json",
  );
  workStart.architecture.packet_ref = architecture.artifact.custody.uri;
  workStart.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  workStart.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };

  await assert.rejects(
    () => service.evaluateWorkStart({ artifact: workStart, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409 &&
      error.details?.stale_artifact_id === architecture.artifact.artifact_id &&
      error.details?.stale_artifact_type === "delivery_art_architecture_packet",
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service fails before persistence when the scoped ART snapshot changed", async () => {
  const { service, writes } = createHarness({ stale: true });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: localCandidate(
        fixture("architecture-packet.valid.json"),
        "architecture-packet-stale.json",
      ),
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409,
  );
  assert.deepEqual(writes, []);
});

test("Delivery ART service fails closed when the scoped ART snapshot changes during persistence", async () => {
  const { service, writes } = createHarness({ staleAfterWrite: true });

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: localCandidate(
        fixture("architecture-packet.valid.json"),
        "architecture-packet-stale-during-persistence.json",
      ),
      callerId: "operator:workspace-owner",
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409,
  );
  assert.equal(writes.length, 1);
});

test("Delivery ART service binds durable decisions to the authenticated caller", async () => {
  const { service, writes } = createHarness();

  await assert.rejects(
    () => service.persistArchitecturePacket({
      artifact: localCandidate(
        fixture("architecture-packet.valid.json"),
        "architecture-packet-caller.json",
      ),
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
  const input = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-replay.json",
  );
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

test("Delivery ART service resolves only the authoritative current artifact head", async () => {
  const { service } = createHarness();
  const callerId = "operator:workspace-owner";
  const input = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-current-head.json",
  );
  const first = await service.persistArchitecturePacket({ artifact: input, callerId });
  const changed = structuredClone(input);
  changed.decision.rationale =
    "The successor preserves the decision while replacing its durable artifact head.";
  changed.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  const successor = await service.persistArchitecturePacket({
    artifact: changed,
    callerId,
  });

  await assert.rejects(
    () => service.persistArchitecturePacket({ artifact: input, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_superseded" &&
      error.statusCode === 409 &&
      error.details?.current_head_uri === successor.artifact.custody.uri,
  );

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: first.artifact.integrity.content_digest,
        uri: first.artifact.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_superseded" &&
      error.statusCode === 409 &&
      error.details?.current_head_uri === successor.artifact.custody.uri,
  );
  const resolved = await service.resolveArtifact({
    reference: {
      digest: successor.artifact.integrity.content_digest,
      uri: successor.artifact.custody.uri,
    },
  });
  assert.deepEqual(resolved.artifact, successor.artifact);
});

test("Delivery ART service rejects a successor that branches from a superseded ancestor", async () => {
  const { attachmentDescriptions, service, writes } = createHarness();
  const callerId = "operator:workspace-owner";
  const input = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-branching-successor.json",
  );
  const first = await service.persistArchitecturePacket({ artifact: input, callerId });
  const successor = structuredClone(input);
  successor.decision.rationale = "The current successor preserves one durable head.";
  successor.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  const current = await service.persistArchitecturePacket({
    artifact: successor,
    callerId,
  });
  attachmentDescriptions.clear();
  const currentReplay = await service.persistArchitecturePacket({
    artifact: successor,
    callerId,
  });
  assert.deepEqual(currentReplay.artifact, current.artifact);
  assert.equal(currentReplay.owner_receipt.replayed, true);
  const branch = structuredClone(input);
  branch.decision.rationale = "This competing branch must not become durable.";
  branch.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };

  await assert.rejects(
    () => service.persistArchitecturePacket({ artifact: branch, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_superseded" &&
      error.statusCode === 409 &&
      error.details?.current_head_uri === current.artifact.custody.uri,
  );
  assert.equal(writes.length, 2);
});

test("Delivery ART service rejects active references to a superseded architecture", async () => {
  const { service } = createHarness();
  const callerId = "operator:workspace-owner";
  const architectureInput = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture-packet-reference-head.json",
  );
  const first = await service.persistArchitecturePacket({
    artifact: architectureInput,
    callerId,
  });
  const changed = structuredClone(architectureInput);
  changed.decision.rationale =
    "The successor invalidates active references to the prior architecture.";
  changed.custody.supersedes = {
    digest: first.artifact.integrity.content_digest,
    uri: first.artifact.custody.uri,
  };
  await service.persistArchitecturePacket({ artifact: changed, callerId });

  const workStart = localCandidate(
    fixture("work-start-record.valid.json"),
    "work-start-superseded-architecture.json",
  );
  workStart.architecture.packet_ref = first.artifact.custody.uri;
  workStart.architecture.packet_digest = first.artifact.integrity.content_digest;
  workStart.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };

  await assert.rejects(
    () => service.evaluateWorkStart({ artifact: workStart, callerId }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_superseded" &&
      error.statusCode === 409,
  );
});

test("Delivery ART service fails closed when an artifact family has competing heads", async () => {
  const { attachments, service } = createHarness();
  const first = fixture("architecture-packet.valid.json");
  const second = structuredClone(first);
  second.decision.rationale =
    "This competing durable artifact omits the required supersession link.";
  second.integrity.content_digest = artifactContentDigest(second);
  second.custody.persisted_at = "2026-08-08T03:30:00.000Z";
  second.custody.uri =
    `openproject://work_packages/698/attachments/architecture-packet-delivery-698-v1-${second.integrity.content_digest.slice("sha256:".length)}.json`;
  for (const artifact of [first, second]) {
    attachments.set(
      `698/${artifact.custody.uri.split("/").at(-1)}`,
      canonicalStringify(artifact),
    );
  }

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: first.integrity.content_digest,
        uri: first.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_head_ambiguous" &&
      error.statusCode === 409,
  );
});

test("Delivery ART service rejects a disconnected supersession cycle beside a valid head", async () => {
  const { attachments, service } = createHarness();
  const head = fixture("architecture-packet.valid.json");
  const cycleA = structuredClone(head);
  cycleA.decision.rationale = "Corrupted cycle member A.";
  cycleA.integrity.content_digest = artifactContentDigest(cycleA);
  cycleA.custody.persisted_at = "2026-08-08T03:30:00.000Z";
  cycleA.custody.uri =
    `openproject://work_packages/698/attachments/architecture-packet-cycle-a-${cycleA.integrity.content_digest.slice("sha256:".length)}.json`;
  const cycleB = structuredClone(head);
  cycleB.decision.rationale = "Corrupted cycle member B.";
  cycleB.integrity.content_digest = artifactContentDigest(cycleB);
  cycleB.custody.persisted_at = "2026-08-08T03:31:00.000Z";
  cycleB.custody.uri =
    `openproject://work_packages/698/attachments/architecture-packet-cycle-b-${cycleB.integrity.content_digest.slice("sha256:".length)}.json`;
  cycleA.custody.supersedes = {
    digest: cycleB.integrity.content_digest,
    uri: cycleB.custody.uri,
  };
  cycleB.custody.supersedes = {
    digest: cycleA.integrity.content_digest,
    uri: cycleA.custody.uri,
  };
  for (const artifact of [head, cycleA, cycleB]) {
    attachments.set(
      `698/${artifact.custody.uri.split("/").at(-1)}`,
      canonicalStringify(artifact),
    );
  }

  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: head.integrity.content_digest,
        uri: head.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_family_invalid" &&
      error.statusCode === 502 &&
      [cycleA.custody.uri, cycleB.custody.uri].includes(error.details?.cycle_uri),
  );
});

test("Delivery ART service resolves historical predecessors behind the current durable head", async () => {
  const { attachments, externalArtifacts, service, setStale } = createHarness();
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

  setStale(true);
  await assert.rejects(
    () => service.resolveArtifact({
      reference: {
        digest: finalized.integrity.content_digest,
        uri: finalized.custody.uri,
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.statusCode === 409,
  );
});

test("Delivery ART finalization fails closed without a trusted readiness-receipt resolver", async () => {
  const { attachments, service, writes } = createHarness({ externalResolver: false });
  const architecture = fixture("architecture-packet.valid.json");
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  finalized.finalized_at = null;
  finalized.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: finalized.custody.supersedes,
    uri: "local://delivery-art/review-packet-finalization.json",
  };

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
