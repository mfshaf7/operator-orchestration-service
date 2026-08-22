import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactContentDigest,
  deliveryArtContentProjection,
  workStartScopeFingerprint,
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

function deliveryArtScopeProjection(deliveryRecordId, workItemRecordIds, overrides = {}) {
  const coveredIds = [...workItemRecordIds].sort((left, right) => left - right);
  const records = coveredIds.map((recordId) => ({
    id: recordId,
    owner_repo: recordId === 802
      ? "operator-orchestration-service"
      : "workspace-governance",
    parent_id: recordId === 802 ? 801 : 698,
    type: recordId === 802 ? "Defect" : "Enabler",
    ...overrides.records?.[recordId],
  }));
  return {
    covered_work_item_ids: coveredIds.map((recordId) => `work-item-${recordId}`),
    delivery_id: `delivery-${deliveryRecordId}`,
    records,
    relations: coveredIds.includes(801) && coveredIds.includes(802)
      ? [{
          from_work_item_id: "work-item-801",
          relation_type: "follows",
          to_work_item_id: "work-item-802",
        }]
      : [],
    schema_version: 2,
    ...overrides.projection,
  };
}

function createHarness({
  mutateRegistryResponse = null,
  projectionFailures = 0,
  readinessArtifact = null,
  registerError = null,
  snapshotSequence = null,
  withReadinessClient = false,
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
        const next = snapshotSequence.shift();
        return typeof next === "string"
          ? {
              artDigest: next,
              projection: deliveryArtScopeProjection(
                deliveryRecordId,
                workItemRecordIds,
              ),
            }
          : next;
      }
      return {
        artDigest: workItemRecordIds.length === 2
          ? `sha256:${"a".repeat(64)}`
          : `sha256:${"e".repeat(64)}`,
        projection: deliveryArtScopeProjection(
          deliveryRecordId,
          workItemRecordIds,
        ),
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
  const readiness = structuredClone(
    readinessArtifact ?? fixture("readiness-receipt.valid.json"),
  );
  const readinessIssues = [];
  const readinessClient = withReadinessClient
    ? {
        async issue({ finalizationCandidate, readinessRequest }) {
          readinessIssues.push({
            finalizationCandidate: structuredClone(finalizationCandidate),
            readinessRequest: structuredClone(readinessRequest),
          });
          return {
            artifact: structuredClone(readiness),
            receipt: {
              generation: 1,
              ref: sourceArtifactReference(readiness),
              resolution: "created",
              state: "durable",
            },
          };
        },
        async read({ reference }) {
          assert.deepEqual(reference, sourceArtifactReference(readiness));
          return {
            artifact: structuredClone(readiness),
            receipt: {
              generation: 1,
              ref: sourceArtifactReference(readiness),
              resolution: "read",
              state: "durable",
            },
          };
        },
      }
    : null;
  const service = createDeliveryArtArtifactService({
    clock: () => new Date("2026-08-08T11:20:00+08:00"),
    mutationAdmission: {
      admitted: true,
      reason: "test",
      writerTopology: "single-writer",
    },
    openProjectClient,
    readinessClient,
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
    readinessIssues,
    registry,
    service,
    snapshotCalls,
  };
}

async function persistChain(
  harness,
  { finalize = true, issueOperatingReadiness = false } = {},
) {
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
  const operatingReadiness = issueOperatingReadiness
    ? await harness.service.issueReviewPacketOperatingReadiness({
        artifact: prepared.finalization_candidate,
        callerId: CALLER_ID,
      })
    : null;
  const finalized = finalize
    ? await harness.service.finalizeReviewPacket({
        artifact:
          operatingReadiness?.finalization_candidate ?? prepared.finalization_candidate,
        callerId: CALLER_ID,
        readinessReceiptRef:
          operatingReadiness?.readiness_receipt_ref ??
          sourceArtifactReference(harness.readiness),
      })
    : null;
  return {
    architecture,
    finalized,
    mergeReady,
    operatingReadiness,
    prepared,
    workStart,
  };
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

test("historical artifact resolution remains valid after the ART snapshot advances", async () => {
  const originalDigest = `sha256:${"a".repeat(64)}`;
  const snapshots = [originalDigest, originalDigest];
  const harness = createHarness({ snapshotSequence: snapshots });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );
  const persisted = await harness.service.persistArchitecturePacket({
    artifact: candidate,
    callerId: CALLER_ID,
  });
  snapshots.push(`sha256:${"f".repeat(64)}`);

  const resolved = await harness.service.resolveArtifact({
    reference: sourceArtifactReference(persisted.artifact),
  });

  assert.equal(
    resolved.artifact.integrity.content_digest,
    persisted.artifact.integrity.content_digest,
  );
  assert.equal(harness.snapshotCalls.length, 2);
});

test("lifecycle transitions accept ordinary progress after durable architecture approval", async () => {
  const originalDigest = `sha256:${"a".repeat(64)}`;
  const harness = createHarness({
    snapshotSequence: [
      originalDigest,
      originalDigest,
      `sha256:${"f".repeat(64)}`,
    ],
  });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );
  const persisted = await harness.service.persistArchitecturePacket({
    artifact: candidate,
    callerId: CALLER_ID,
  });

  const result = await harness.service.draftWorkStart({
    callerId: CALLER_ID,
    input: {
      architecture: {
        reference: sourceArtifactReference(persisted.artifact),
        required: true,
      },
      covered_work_item_ids: ["work-item-801"],
      delivery_id: "delivery-698",
      landing_unit: fixture("work-start-record.valid.json").landing_unit,
      operator: { decision_source: "operator" },
    },
  });

  assert.equal(result.work_start.architecture.readiness, "architecture-ready");
  assert.equal(harness.snapshotCalls.length, 4);
});

test("lifecycle transitions reject material structural drift in durable architecture", async () => {
  const originalDigest = `sha256:${"a".repeat(64)}`;
  const harness = createHarness({
    snapshotSequence: [
      originalDigest,
      originalDigest,
      {
        artDigest: `sha256:${"f".repeat(64)}`,
        projection: deliveryArtScopeProjection(698, [801, 802], {
          records: {
            802: {
              owner_repo: "security-architecture",
              parent_id: 698,
              type: "Task",
            },
          },
          projection: {
            covered_work_item_ids: ["work-item-801"],
            relations: [],
          },
        }),
      },
    ],
  });
  const candidate = localCandidate(
    fixture("architecture-packet.valid.json"),
    "architecture",
  );
  const persisted = await harness.service.persistArchitecturePacket({
    artifact: candidate,
    callerId: CALLER_ID,
  });

  await assert.rejects(
    () => harness.service.draftWorkStart({
      callerId: CALLER_ID,
      input: {
        architecture: {
          reference: sourceArtifactReference(persisted.artifact),
          required: true,
        },
        covered_work_item_ids: ["work-item-801"],
        delivery_id: "delivery-698",
        landing_unit: fixture("work-start-record.valid.json").landing_unit,
        operator: { decision_source: "operator" },
      },
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_snapshot_stale" &&
      error.details.freshness_class === "historical-material-semantics" &&
      error.details.material_errors.includes("covered work-item scope changed") &&
      error.details.material_errors.includes("work-item-802 owner changed") &&
      error.details.material_errors.includes("work-item-802 type changed") &&
      error.details.material_errors.includes("work-item-802 parent changed") &&
      error.details.material_errors.includes(
        "dependency or merge-order topology changed",
      ),
  );
  assert.equal(harness.snapshotCalls.length, 3);
});

test("Delivery ART service issues and resolves the exact WGCF operating-readiness receipt", async () => {
  const harness = createHarness({
    withReadinessClient: true,
    withReadinessResolver: false,
  });
  const chain = await persistChain(harness, { issueOperatingReadiness: true });

  assert.equal(harness.readinessIssues.length, 1);
  assert.deepEqual(
    harness.readinessIssues[0].readinessRequest,
    chain.prepared.readiness_request,
  );
  assert.equal(
    harness.readinessIssues[0].finalizationCandidate.integrity.content_digest,
    chain.prepared.finalization_candidate.integrity.content_digest,
  );
  assert.deepEqual(
    chain.operatingReadiness.readiness_receipt_ref,
    sourceArtifactReference(harness.readiness),
  );
  assert.equal(chain.finalized.artifact.status, "finalized");
});

test("Delivery ART service authors lifecycle candidates without claiming durable custody", async () => {
  const harness = createHarness();
  const workStartFixture = fixture("work-start-record.valid.json");
  const reviewFixture = fixture("review-packet-merge-ready.valid.json");
  const finalizedFixture = fixture("review-packet-finalized.valid.json");

  const workStartDraft = await harness.service.draftWorkStart({
    callerId: CALLER_ID,
    input: {
      architecture: { reference: null, required: false },
      covered_work_item_ids: ["work-item-801"],
      delivery_id: "delivery-698",
      landing_unit: workStartFixture.landing_unit,
      operator: { decision_source: "operator" },
    },
  });
  assert.equal(workStartDraft.work_start.custody.state, "local-draft");
  assert.equal(workStartDraft.work_start.readiness.level, "draft");
  assert.equal(harness.registry.registrations.length, 0);
  assert.equal(harness.projections.length, 0);

  const chain = await persistChain(harness, { finalize: false });
  const registrationCount = harness.registry.registrations.length;
  const projectionCount = harness.projections.length;
  const reviewDraft = await harness.service.draftReviewPacket({
    callerId: CALLER_ID,
    input: {
      evidence: reviewFixture.evidence,
      exceptions: [],
      landing_unit: reviewFixture.landing_unit,
      operator: { decision_source: "operator" },
      work_start_ref: sourceArtifactReference(chain.workStart.artifact),
    },
  });
  assert.equal(reviewDraft.review_packet.schema_version, 2);
  assert.equal(reviewDraft.review_packet.status, "draft");
  assert.equal(reviewDraft.review_packet.custody.state, "local-draft");

  const postMergeEvidence = structuredClone(finalizedFixture.evidence);
  const postMergeValidation = {
    ...structuredClone(postMergeEvidence.validations[0]),
    id: "evidence:post-merge-validation",
    name: "Post-merge validation",
    summary: "The merged source head passed its post-merge validation.",
  };
  postMergeEvidence.runtime_and_live.push(postMergeValidation);
  postMergeEvidence.acceptance_mapping[0].evidence_ids.push(
    postMergeValidation.id,
  );
  const finalizationDraft = await harness.service.draftReviewPacketFinalization({
    callerId: CALLER_ID,
    input: {
      evidence: postMergeEvidence,
      exceptions: finalizedFixture.exceptions,
      merge_ready_ref: sourceArtifactReference(chain.mergeReady.artifact),
      merged_repos: finalizedFixture.landing_unit.repos,
    },
  });
  assert.equal(finalizationDraft.finalization_candidate.status, "draft");
  assert.deepEqual(
    finalizationDraft.finalization_candidate.custody.supersedes,
    sourceArtifactReference(chain.mergeReady.artifact),
  );
  assert.ok(
    finalizationDraft.finalization_candidate.evidence.runtime_and_live.some(
      (entry) => entry.id === postMergeValidation.id,
    ),
  );
  assert.equal(harness.registry.registrations.length, registrationCount);
  assert.equal(harness.projections.length, projectionCount);
});

test("post-merge authoring cannot replace merge-ready evidence", async () => {
  const harness = createHarness();
  const chain = await persistChain(harness, { finalize: false });
  const finalizedFixture = fixture("review-packet-finalized.valid.json");
  const replacementEvidence = structuredClone(finalizedFixture.evidence);
  const originalTestId = replacementEvidence.tests[0].id;
  replacementEvidence.tests[0].id = "evidence:replacement-test";
  replacementEvidence.acceptance_mapping[0].evidence_ids =
    replacementEvidence.acceptance_mapping[0].evidence_ids.map((evidenceId) =>
      evidenceId === originalTestId ? replacementEvidence.tests[0].id : evidenceId);

  await assert.rejects(
    () => harness.service.draftReviewPacketFinalization({
      callerId: CALLER_ID,
      input: {
        evidence: replacementEvidence,
        exceptions: finalizedFixture.exceptions,
        merge_ready_ref: sourceArtifactReference(chain.mergeReady.artifact),
        merged_repos: finalizedFixture.landing_unit.repos,
      },
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_artifact_invalid" &&
      error.details.errors.some((entry) =>
        entry.includes(`did not preserve merge-ready evidence ${originalTestId}`)),
  );
});

test("Delivery ART service preserves a blocked readiness receipt but refuses finalization", async () => {
  const blockedReceipt = fixture("readiness-receipt.valid.json");
  blockedReceipt.findings = [
    {
      authority_ref: "https://example.test/delivery-art-authority",
      id: "required-evidence-failed",
      severity: "blocker",
      summary: "A required evidence result failed.",
    },
  ];
  blockedReceipt.readiness.mutation_allowed = false;
  blockedReceipt.readiness.outcome = "blocked";
  blockedReceipt.integrity.content_digest = artifactContentDigest(blockedReceipt);
  blockedReceipt.custody.uri = [
    "wgcf://receipts/art-readiness/art-readiness-receipt-",
    blockedReceipt.receipt_id.split(":")[1],
    "-",
    blockedReceipt.integrity.content_digest.slice("sha256:".length),
    ".json",
  ].join("");
  const harness = createHarness({
    readinessArtifact: blockedReceipt,
    withReadinessClient: true,
    withReadinessResolver: false,
  });
  const chain = await persistChain(harness, {
    finalize: false,
    issueOperatingReadiness: true,
  });

  assert.equal(
    chain.operatingReadiness.readiness_receipt.readiness.outcome,
    "blocked",
  );
  const registrationCount = harness.registry.registrations.length;
  await assert.rejects(
    () => harness.service.finalizeReviewPacket({
      artifact: chain.operatingReadiness.finalization_candidate,
      callerId: CALLER_ID,
      readinessReceiptRef: chain.operatingReadiness.readiness_receipt_ref,
    }),
    (error) =>
      error instanceof DeliveryArtServiceError &&
      error.statusCode === 409 &&
      error.code === "delivery_art_operating_readiness_not_ready",
  );
  assert.equal(harness.registry.registrations.length, registrationCount);
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

test("service rejects its transformed candidate before registry custody", async () => {
  const harness = createHarness();
  const candidate = localCandidate(
    fixture("work-start-record.valid.json"),
    "invalid-transformed-work-start",
  );
  candidate.architecture = {
    packet_digest: null,
    packet_ref: null,
    readiness: "not-required",
    required: false,
  };
  candidate.source_snapshot.captured_at = "2026-08-08T10:11:00+08:00";
  candidate.readiness = {
    blockers: [],
    evaluated_at: null,
    level: "draft",
  };
  candidate.scope_fingerprint = workStartScopeFingerprint(candidate);
  candidate.integrity.content_digest = artifactContentDigest(candidate);

  await assert.rejects(
    () => harness.service.evaluateWorkStart({
      artifact: candidate,
      callerId: CALLER_ID,
    }),
    (error) => error instanceof DeliveryArtServiceError &&
      error.code === "delivery_art_candidate_invalid" &&
      error.details.errors.some((entry) =>
        entry.includes("source_snapshot.captured_at must be no later than readiness.evaluated_at")),
  );
  assert.equal(harness.registry.registrations.length, 0);
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
