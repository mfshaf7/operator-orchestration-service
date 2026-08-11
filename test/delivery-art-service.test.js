import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactContentDigest,
  deliveryArtContentProjection,
} from "../src/delivery-art/contracts.js";
import { canonicalStringify } from "../src/delivery-art/canonical-json.js";
import {
  createDeliveryArtArtifactService,
  DeliveryArtServiceError,
} from "../src/delivery-art/service.js";

const FIXTURE_DIR = fileURLToPath(
  new URL("../contracts/delivery-art/fixtures/", import.meta.url),
);
const CALLER_ID = "operator:workspace-owner";

function fixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

function artifactIdentifier(artifact) {
  return artifact.artifact_id ?? artifact.packet_id ?? artifact.receipt_id;
}

function sourceArtifactReference(artifact) {
  return {
    digest: artifact.integrity.content_digest,
    uri: artifact.custody.uri,
  };
}

function localCandidate(artifact, name, { supersedes = artifact.custody?.supersedes ?? null } = {}) {
  const candidate = structuredClone(artifact);
  candidate.custody = {
    backend: "local-filesystem",
    persisted_at: null,
    receipt_ref: null,
    state: "local-draft",
    supersedes,
    uri: `local://delivery-art/${name}.json`,
  };
  candidate.integrity.content_digest = artifactContentDigest(candidate);
  return candidate;
}

function offsetTimestamp(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function sourcePersistedAt(artifact) {
  if (artifact.artifact_type === "delivery_art_architecture_packet") {
    return "2026-08-08T10:06:00+08:00";
  }
  if (artifact.artifact_type === "delivery_art_work_start_record") {
    return "2026-08-08T10:11:00+08:00";
  }
  if (artifact.status === "merge-ready") {
    return "2026-08-08T11:16:00+08:00";
  }
  return "2026-08-08T11:33:00+08:00";
}

function durableEnvelope(artifactContent, contentDigest, resolution) {
  const artifact = structuredClone(artifactContent);
  const artifactUri =
    `wgcf://artifacts/delivery-art/sha256/${contentDigest.slice("sha256:".length)}`;
  const persistedAt = sourcePersistedAt(artifact);
  const token = contentDigest.slice("sha256:".length, "sha256:".length + 24);
  const receipt = {
    artifact_type: "delivery_art_custody_receipt",
    custody: {
      backend: "wgcf-receipt-ledger",
      persisted_at: offsetTimestamp(persistedAt, -1_000),
      state: "durable",
      supersedes: null,
      uri: "pending",
    },
    integrity: {
      algorithm: "sha256",
      canonicalization: "RFC8785",
      content_digest: `sha256:${"0".repeat(64)}`,
    },
    issuer: {
      implementation_ref: "f".repeat(40),
      owner_repo: "workspace-governance-control-fabric",
      service_identity_ref:
        "service-identity://workspace-governance-control-fabric/dev-integration",
    },
    receipt_id: `artifact-custody-receipt:${token}`,
    schema_version: 1,
    storage: {
      persisted_at: offsetTimestamp(persistedAt, -2_000),
      receipt_ref: `platform-storage://receipts/delivery-art-${token}`,
      runtime_owner: "platform-engineering",
    },
    subject: {
      artifact_id: artifactIdentifier(artifact),
      artifact_type: artifact.artifact_type,
      content_digest: contentDigest,
      delivery_id: artifact.delivery_id,
      registry_uri: artifactUri,
    },
  };
  receipt.integrity.content_digest = artifactContentDigest(receipt);
  receipt.custody.uri = [
    "wgcf://receipts/artifact-custody/",
    token,
    "-",
    receipt.integrity.content_digest.slice("sha256:".length),
    ".json",
  ].join("");

  artifact.integrity.content_digest = contentDigest;
  artifact.custody = {
    backend: "wgcf-artifact-registry",
    persisted_at: persistedAt,
    receipt_ref: {
      digest: receipt.integrity.content_digest,
      uri: receipt.custody.uri,
    },
    state: "durable",
    supersedes: artifactContent.custody?.supersedes ?? null,
    uri: artifactUri,
  };
  return {
    artifact,
    custody_receipt: receipt,
    registry: {
      artifact_ref: {
        digest: contentDigest,
        uri: artifactUri,
      },
      custody_receipt_ref: {
        digest: receipt.integrity.content_digest,
        uri: receipt.custody.uri,
      },
      generation: 1,
      resolution,
      state: "durable",
    },
  };
}

function createRegistry({ mutateResponse = null, registerError = null } = {}) {
  const records = new Map();
  const registrations = [];
  return {
    records,
    registrations,
    client: {
      async read({ contentDigest }) {
        const response = records.get(contentDigest);
        if (!response) {
          throw new DeliveryArtServiceError(
            "test_registry_not_found",
            "test registry record not found",
            404,
          );
        }
        return structuredClone({
          ...response,
          registry: { ...response.registry, resolution: "read" },
        });
      },
      async register({ artifactContent, contentDigest }) {
        registrations.push({
          artifactContent: structuredClone(artifactContent),
          contentDigest,
        });
        if (registerError) {
          throw registerError;
        }
        const existing = records.get(contentDigest);
        const response = existing ?? durableEnvelope(artifactContent, contentDigest, "created");
        records.set(contentDigest, response);
        const replayable = existing
          ? { ...response, registry: { ...response.registry, resolution: "reused" } }
          : response;
        return mutateResponse
          ? mutateResponse(structuredClone(replayable))
          : structuredClone(replayable);
      },
    },
  };
}

function createHarness({
  mutateRegistryResponse = null,
  projectionFailures = 0,
  registerError = null,
  snapshotSequence = null,
  withReadinessResolver = true,
} = {}) {
  const registry = createRegistry({
    mutateResponse: mutateRegistryResponse,
    registerError,
  });
  const projections = [];
  const snapshotCalls = [];
  let failuresRemaining = projectionFailures;
  const openProjectClient = {
    async captureDeliveryArtScope({ deliveryRecordId, workItemRecordIds }) {
      snapshotCalls.push({ deliveryRecordId, workItemRecordIds });
      if (snapshotSequence?.length) {
        return { artDigest: snapshotSequence.shift() };
      }
      return {
        artDigest: workItemRecordIds.length === 2
          ? `sha256:${"a".repeat(64)}`
          : `sha256:${"e".repeat(64)}`,
      };
    },
    async projectDeliveryArtReference(input) {
      projections.push(structuredClone(input));
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        const error = new Error("sensitive backend detail");
        error.errorClass = "update_conflict";
        throw error;
      }
      return { projected: true, replayed: false };
    },
  };
  const readiness = fixture("readiness-receipt.valid.json");
  const service = createDeliveryArtArtifactService({
    clock: () => new Date("2026-08-08T11:20:00+08:00"),
    mutationAdmission: {
      admitted: true,
      reason: "test",
      writerTopology: "single-writer",
    },
    openProjectClient,
    readinessReceiptResolver: withReadinessResolver
      ? async ({ reference }) => {
          assert.equal(reference.uri, readiness.custody.uri);
          assert.equal(reference.digest, readiness.integrity.content_digest);
          return structuredClone(readiness);
        }
      : null,
    registryClient: registry.client,
  });
  return {
    projections,
    readiness,
    registry,
    service,
    snapshotCalls,
  };
}

async function persistChain(harness) {
  const architectureInput = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );
  const architecture = await harness.service.persistArchitecturePacket({
    artifact: architectureInput,
    callerId: CALLER_ID,
  });

  const workStartInput = localCandidate(
    fixture("work-start-record.valid.json"),
    "work-start",
  );
  workStartInput.architecture.packet_ref = architecture.artifact.custody.uri;
  workStartInput.architecture.packet_digest = architecture.artifact.integrity.content_digest;
  workStartInput.architecture.readiness = "architecture-ready";
  workStartInput.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  workStartInput.integrity.content_digest = artifactContentDigest(workStartInput);
  const workStart = await harness.service.evaluateWorkStart({
    artifact: workStartInput,
    callerId: CALLER_ID,
  });

  const reviewInput = localCandidate(
    fixture("review-packet-merge-ready.valid.json"),
    "review-packet",
  );
  reviewInput.status = "draft";
  reviewInput.readiness.level = "implementation-ready";
  reviewInput.work_start = {
    artifact_digest: workStart.artifact.integrity.content_digest,
    artifact_ref: workStart.artifact.custody.uri,
    scope_fingerprint: workStart.artifact.scope_fingerprint,
  };
  reviewInput.integrity.content_digest = artifactContentDigest(reviewInput);
  const mergeReady = await harness.service.markReviewPacketMergeReady({
    artifact: reviewInput,
    callerId: CALLER_ID,
  });

  const finalInput = localCandidate(
    fixture("review-packet-finalized.valid.json"),
    "review-packet-finalization",
    { supersedes: sourceArtifactReference(mergeReady.artifact) },
  );
  finalInput.status = "draft";
  finalInput.finalized_at = null;
  finalInput.readiness = {
    evaluated_at: mergeReady.artifact.readiness.evaluated_at,
    level: "implementation-ready",
    receipt_refs: [],
    subject_digest: null,
  };
  finalInput.work_start = structuredClone(mergeReady.artifact.work_start);
  finalInput.integrity.content_digest = artifactContentDigest(finalInput);
  const prepared = await harness.service.prepareReviewPacketFinalization({
    artifact: finalInput,
    callerId: CALLER_ID,
  });
  const finalized = await harness.service.finalizeReviewPacket({
    artifact: prepared.finalization_candidate,
    callerId: CALLER_ID,
    readinessReceiptRef: sourceArtifactReference(harness.readiness),
  });
  return { architecture, finalized, mergeReady, prepared, workStart };
}

test("Delivery ART service persists the complete WGCF custody chain before projection", async () => {
  const harness = createHarness();
  const chain = await persistChain(harness);

  assert.equal(chain.architecture.artifact.custody.backend, "wgcf-artifact-registry");
  assert.equal(chain.workStart.artifact.readiness.level, "implementation-ready");
  assert.equal(chain.mergeReady.artifact.status, "merge-ready");
  assert.equal(chain.finalized.artifact.status, "finalized");
  assert.equal(chain.finalized.artifact.readiness.level, "operating-ready");
  assert.deepEqual(
    chain.finalized.artifact.custody.supersedes,
    sourceArtifactReference(chain.mergeReady.artifact),
  );
  assert.equal(harness.registry.registrations.length, 4);
  assert.equal(harness.projections.length, 4);
  assert.equal(
    chain.prepared.readiness_request.digest,
    harness.readiness.subject.digest,
  );
  assert.equal(
    canonicalStringify(
      deliveryArtContentProjection(chain.finalized.artifact),
    ),
    canonicalStringify(
      harness.registry.registrations.at(-1).artifactContent,
    ),
  );
});

test("registry failure prevents any OpenProject projection", async () => {
  const harness = createHarness({
    registerError: new DeliveryArtServiceError(
      "test_registry_unavailable",
      "registry unavailable",
      503,
    ),
  });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );

  await assert.rejects(
    () => harness.service.persistArchitecturePacket({
      artifact: candidate,
      callerId: CALLER_ID,
    }),
    (error) => error.code === "test_registry_unavailable",
  );
  assert.equal(harness.projections.length, 0);
});

test("projection failure preserves durable refs and retry reuses the same digest", async () => {
  const harness = createHarness({ projectionFailures: 1 });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );
  let firstError;
  await assert.rejects(
    () => harness.service.persistArchitecturePacket({
      artifact: candidate,
      callerId: CALLER_ID,
    }),
    (error) => {
      firstError = error;
      return error instanceof DeliveryArtServiceError &&
        error.code === "delivery_art_openproject_projection_failed";
    },
  );
  assert.match(firstError.details.artifact_ref.uri, /^wgcf:\/\/artifacts\/delivery-art/);
  assert.equal(firstError.details.projection_error, "update_conflict");
  assert.doesNotMatch(JSON.stringify(firstError), /sensitive backend detail/);

  const retried = await harness.service.persistArchitecturePacket({
    artifact: candidate,
    callerId: CALLER_ID,
  });
  assert.equal(retried.owner_receipt.replayed, true);
  assert.equal(harness.registry.registrations.length, 2);
  assert.equal(
    harness.registry.registrations[0].contentDigest,
    harness.registry.registrations[1].contentDigest,
  );
});

test("snapshot drift after registry custody fails before projection without deletion", async () => {
  const harness = createHarness({
    snapshotSequence: [
      `sha256:${"a".repeat(64)}`,
      `sha256:${"b".repeat(64)}`,
    ],
  });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );

  await assert.rejects(
    () => harness.service.persistArchitecturePacket({
      artifact: candidate,
      callerId: CALLER_ID,
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale",
  );
  assert.equal(harness.registry.registrations.length, 1);
  assert.equal(harness.registry.records.size, 1);
  assert.equal(harness.projections.length, 0);
});

test("caller mismatch is rejected before custody or projection", async () => {
  const harness = createHarness();
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );

  await assert.rejects(
    () => harness.service.persistArchitecturePacket({
      artifact: candidate,
      callerId: "operator:someone-else",
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_operator_mismatch" &&
      error.statusCode === 403,
  );
  assert.equal(harness.registry.registrations.length, 0);
  assert.equal(harness.projections.length, 0);
});

test("service rejects a registry response whose durable body differs from submitted content", async () => {
  const harness = createHarness({
    mutateRegistryResponse(response) {
      response.artifact.decision.rationale = "WGCF returned different content.";
      return response;
    },
  });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );

  await assert.rejects(
    () => harness.service.persistArchitecturePacket({
      artifact: candidate,
      callerId: CALLER_ID,
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_registry_content_mismatch",
  );
  assert.equal(harness.projections.length, 0);
});

test("finalization fails closed when no trusted readiness receipt resolver exists", async () => {
  const harness = createHarness({ withReadinessResolver: false });
  const architecture = durableEnvelope(
    deliveryArtContentProjection(fixture("architecture-packet.valid.json")),
    fixture("architecture-packet.valid.json").integrity.content_digest,
    "created",
  );
  const workStart = durableEnvelope(
    deliveryArtContentProjection(fixture("work-start-record.valid.json")),
    fixture("work-start-record.valid.json").integrity.content_digest,
    "created",
  );
  const mergeReady = durableEnvelope(
    deliveryArtContentProjection(fixture("review-packet-merge-ready.valid.json")),
    fixture("review-packet-merge-ready.valid.json").integrity.content_digest,
    "created",
  );
  for (const envelope of [architecture, workStart, mergeReady]) {
    harness.registry.records.set(envelope.artifact.integrity.content_digest, envelope);
  }

  const candidate = localCandidate(
    fixture("review-packet-finalized.valid.json"),
    "review-packet-finalization",
    { supersedes: sourceArtifactReference(mergeReady.artifact) },
  );
  candidate.status = "draft";
  candidate.finalized_at = null;
  candidate.readiness = {
    evaluated_at: mergeReady.artifact.readiness.evaluated_at,
    level: "implementation-ready",
    receipt_refs: [],
    subject_digest: null,
  };
  candidate.integrity.content_digest = artifactContentDigest(candidate);

  await assert.rejects(
    () => harness.service.finalizeReviewPacket({
      artifact: candidate,
      callerId: CALLER_ID,
      readinessReceiptRef: sourceArtifactReference(harness.readiness),
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_readiness_resolver_unavailable" &&
      error.statusCode === 503,
  );
  assert.equal(harness.registry.registrations.length, 0);
  assert.equal(harness.projections.length, 0);
});
