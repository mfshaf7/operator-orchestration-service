import {
  artifactContentDigest,
  architectureScopeFingerprint,
  assertValidDeliveryArtArtifact,
  reviewPacketReadinessSubjectDigest,
  validateDeliveryArtArtifact,
  validateDeliveryArtReferences,
  workStartScopeFingerprint,
} from "./contracts.js";
import {
  canonicalStringify,
  parseCanonicalJson,
} from "./canonical-json.js";

const ARCHITECTURE_PACKET_TYPE = "delivery_art_architecture_packet";
const WORK_START_TYPE = "delivery_art_work_start_record";
const REVIEW_PACKET_TYPE = "art_review_packet";
const READINESS_RECEIPT_TYPE = "delivery_art_readiness_receipt";

export class DeliveryArtServiceError extends Error {
  constructor(code, message, statusCode = 422, details = null) {
    super(message);
    this.name = "DeliveryArtServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function deliveryRecordId(deliveryId) {
  const match = String(deliveryId ?? "").match(/^delivery-([1-9][0-9]*)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function workItemRecordIds(workItemIds) {
  return (workItemIds ?? []).map((workItemId) => {
    const match = String(workItemId).match(/^work-item-([1-9][0-9]*)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  });
}

function artifactIdentifier(artifact) {
  return artifact.artifact_id ?? artifact.packet_id ?? artifact.receipt_id ?? null;
}

function artifactFilename(artifact, digest) {
  const identifier = artifactIdentifier(artifact);
  if (!identifier) {
    throw new DeliveryArtServiceError(
      "delivery_art_identifier_missing",
      "Delivery ART artifact has no stable identifier.",
    );
  }
  const base = identifier.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const stateSuffix = artifact.artifact_type === REVIEW_PACKET_TYPE && artifact.status === "merge-ready"
    ? "-merge-ready"
    : "";
  return `${base}${stateSuffix}-${digest.slice("sha256:".length)}.json`;
}

function parseOpenProjectArtifactUri(uri) {
  const match = String(uri ?? "").match(
    /^openproject:\/\/work_packages\/([1-9][0-9]*)\/attachments\/([^/]+\.json)$/,
  );
  if (!match) {
    return null;
  }
  return {
    deliveryRecordId: Number.parseInt(match[1], 10),
    filename: match[2],
  };
}

function localCustody() {
  return {
    backend: "local-filesystem",
    persisted_at: null,
    state: "local-draft",
    supersedes: null,
    uri: "local://delivery-art/draft.json",
  };
}

function integrity() {
  return {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    content_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
}

function validateCallerBinding(artifact, callerId) {
  if (artifact?.operator?.id !== callerId) {
    throw new DeliveryArtServiceError(
      "delivery_art_operator_mismatch",
      "The artifact operator must match the authenticated broker caller.",
      403,
      {
        artifact_operator: artifact?.operator?.id ?? null,
        authenticated_caller: callerId,
      },
    );
  }
}

function assertArtifactType(artifact, expectedType) {
  if (artifact?.artifact_type !== expectedType) {
    throw new DeliveryArtServiceError(
      "delivery_art_type_mismatch",
      `Expected ${expectedType}, received ${artifact?.artifact_type ?? "no artifact type"}.`,
    );
  }
}

function sourceSnapshotFor(artifact, dependencies) {
  if (artifact.source_snapshot) {
    return artifact.source_snapshot;
  }
  if (artifact.artifact_type === REVIEW_PACKET_TYPE) {
    return dependencies.find((entry) => entry.artifact_type === WORK_START_TYPE)?.source_snapshot;
  }
  return null;
}

function validationFailure(error) {
  if (error?.code === "delivery_art_artifact_invalid") {
    return new DeliveryArtServiceError(
      "delivery_art_artifact_invalid",
      "Delivery ART artifact failed contract validation.",
      422,
      error.validation,
    );
  }
  return error;
}

export function createDeliveryArtArtifactService({
  clock = () => new Date(),
  externalArtifactResolver = null,
  openProjectClient,
} = {}) {
  if (!openProjectClient) {
    throw new Error("openProjectClient is required");
  }

  async function resolveArtifactReference(reference, cache) {
    if (!reference?.uri || !reference?.digest) {
      throw new DeliveryArtServiceError(
        "delivery_art_reference_invalid",
        "Delivery ART dependency references require both URI and digest.",
      );
    }
    if (cache.has(reference.uri)) {
      return cache.get(reference.uri);
    }

    let resolved;
    const openProjectRef = parseOpenProjectArtifactUri(reference.uri);
    if (openProjectRef) {
      resolved = await openProjectClient.readDeliveryArtAttachment(openProjectRef);
    } else if (typeof externalArtifactResolver === "function") {
      resolved = await externalArtifactResolver(reference);
    } else {
      throw new DeliveryArtServiceError(
        "delivery_art_dependency_resolver_unavailable",
        `No trusted resolver is configured for ${reference.uri}.`,
        503,
      );
    }

    const artifact = typeof resolved?.content === "string"
      ? parseCanonicalJson(resolved.content)
      : clone(resolved?.artifact ?? resolved);
    const validation = validateDeliveryArtArtifact(artifact);
    if (!validation.valid) {
      throw new DeliveryArtServiceError(
        "delivery_art_dependency_invalid",
        `Resolved dependency ${reference.uri} is invalid.`,
        422,
        validation,
      );
    }
    if (artifact.integrity.content_digest !== reference.digest) {
      throw new DeliveryArtServiceError(
        "delivery_art_dependency_digest_mismatch",
        `Resolved dependency ${reference.uri} does not match its declared digest.`,
        409,
      );
    }
    cache.set(reference.uri, artifact);
    return artifact;
  }

  async function resolveDependencies(artifact) {
    const cache = new Map();
    const dependencies = [];
    if (artifact.custody?.uri) {
      cache.set(artifact.custody.uri, artifact);
    }
    const add = async (reference) => {
      const dependency = await resolveArtifactReference(reference, cache);
      if (dependency !== artifact && !dependencies.includes(dependency)) {
        dependencies.push(dependency);
      }
      return dependency;
    };

    const visitedSupersessionUris = new Set(
      artifact.custody?.uri ? [artifact.custody.uri] : [],
    );
    const addSupersessionChain = async (candidate) => {
      const reference = candidate.custody?.supersedes;
      if (!reference || visitedSupersessionUris.has(reference.uri)) {
        return;
      }
      visitedSupersessionUris.add(reference.uri);
      const predecessor = await add(reference);
      await addSupersessionChain(predecessor);
    };

    const addArchitecture = async (workStart) => {
      if (workStart.architecture?.readiness !== "architecture-ready") {
        return null;
      }
      const architecture = await add({
        digest: workStart.architecture.packet_digest,
        uri: workStart.architecture.packet_ref,
      });
      await addSupersessionChain(architecture);
      return architecture;
    };

    await addSupersessionChain(artifact);
    if (artifact.artifact_type === WORK_START_TYPE) {
      await addArchitecture(artifact);
    } else if (artifact.artifact_type === REVIEW_PACKET_TYPE) {
      const workStart = await add({
        digest: artifact.work_start.artifact_digest,
        uri: artifact.work_start.artifact_ref,
      });
      await addSupersessionChain(workStart);
      await addArchitecture(workStart);
      for (const receiptRef of artifact.readiness?.receipt_refs ?? []) {
        const receipt = await add(receiptRef);
        await addSupersessionChain(receipt);
      }
    }
    return dependencies;
  }

  async function captureFreshSnapshot(artifact, dependencies) {
    const expected = sourceSnapshotFor(artifact, dependencies);
    const deliveryId = deliveryRecordId(artifact.delivery_id);
    const coveredIds = workItemRecordIds(artifact.covered_work_item_ids);
    if (!expected || !deliveryId || coveredIds.some((recordId) => !recordId)) {
      throw new DeliveryArtServiceError(
        "delivery_art_scope_invalid",
        "Delivery ART artifact does not declare a valid source snapshot and covered scope.",
      );
    }
    const snapshot = await openProjectClient.captureDeliveryArtScope({
      deliveryRecordId: deliveryId,
      workItemRecordIds: coveredIds,
    });
    if (snapshot.artDigest !== expected.art_digest) {
      throw new DeliveryArtServiceError(
        "delivery_art_snapshot_stale",
        "The Delivery ART target or dependency subset changed after the artifact snapshot was captured.",
        409,
        {
          expected_art_digest: expected.art_digest,
          fresh_art_digest: snapshot.artDigest,
        },
      );
    }
    return snapshot;
  }

  async function persistDurableArtifact({ artifact, callerId, dependencies = [] }) {
    validateCallerBinding(artifact, callerId);
    const candidate = clone(artifact);
    const persistedAt = clock().toISOString();
    candidate.integrity = integrity();
    const digest = artifactContentDigest(candidate);
    candidate.integrity.content_digest = digest;
    const filename = artifactFilename(candidate, digest);
    const deliveryId = deliveryRecordId(candidate.delivery_id);
    candidate.custody = {
      backend: "openproject-attachment",
      persisted_at: persistedAt,
      state: "durable",
      supersedes: candidate.custody?.supersedes ?? null,
      uri: `openproject://work_packages/${deliveryId}/attachments/${filename}`,
    };

    try {
      assertValidDeliveryArtArtifact(candidate, dependencies);
    } catch (error) {
      throw validationFailure(error);
    }
    const freshSnapshot = await captureFreshSnapshot(candidate, dependencies);
    const content = canonicalStringify(candidate);
    try {
      const existing = await openProjectClient.readDeliveryArtAttachment({
        deliveryRecordId: deliveryId,
        filename,
      });
      const existingArtifact = parseCanonicalJson(existing.content);
      if (existingArtifact.integrity?.content_digest !== digest) {
        throw new DeliveryArtServiceError(
          "delivery_art_artifact_collision",
          `Durable artifact ${candidate.custody.uri} exists with a different digest.`,
          409,
        );
      }
      try {
        assertValidDeliveryArtArtifact(existingArtifact, dependencies);
      } catch (error) {
        throw validationFailure(error);
      }
      return {
        artifact: existingArtifact,
        owner_receipt: {
          artifact_id: artifactIdentifier(existingArtifact),
          artifact_type: existingArtifact.artifact_type,
          content_digest: digest,
          covered_work_item_ids: existingArtifact.covered_work_item_ids,
          custody_uri: existingArtifact.custody.uri,
          delivery_id: existingArtifact.delivery_id,
          fresh_art_digest: freshSnapshot.artDigest,
          operator_id: callerId,
          persisted_at: existingArtifact.custody.persisted_at,
          recovered_after_interruption: false,
          replayed: true,
        },
      };
    } catch (error) {
      if (
        error instanceof DeliveryArtServiceError ||
        error?.errorClass !== "not_found"
      ) {
        throw error;
      }
    }
    const write = await openProjectClient.persistDeliveryArtAttachment({
      content,
      deliveryRecordId: deliveryId,
      description: `${candidate.artifact_type} ${artifactIdentifier(candidate)} ${digest}`,
      filename,
    });

    return {
      artifact: candidate,
      owner_receipt: {
        artifact_id: artifactIdentifier(candidate),
        artifact_type: candidate.artifact_type,
        content_digest: digest,
        covered_work_item_ids: candidate.covered_work_item_ids,
        custody_uri: candidate.custody.uri,
        delivery_id: candidate.delivery_id,
        fresh_art_digest: freshSnapshot.artDigest,
        operator_id: callerId,
        persisted_at: persistedAt,
        recovered_after_interruption: write.recovered,
        replayed: write.replayed,
      },
    };
  }

  async function persistArchitecturePacket({ artifact, callerId }) {
    assertArtifactType(artifact, ARCHITECTURE_PACKET_TYPE);
    if (artifact.decision?.status === "draft") {
      throw new DeliveryArtServiceError(
        "delivery_art_architecture_undecided",
        "Draft architecture packets remain local and cannot claim durable custody.",
        409,
      );
    }
    if (artifact.decision?.decided_by !== callerId) {
      throw new DeliveryArtServiceError(
        "delivery_art_decision_authority_mismatch",
        "The architecture decision authority must match the authenticated broker caller.",
        403,
      );
    }
    const candidate = clone(artifact);
    candidate.scope_fingerprint = architectureScopeFingerprint(candidate);
    return persistDurableArtifact({ artifact: candidate, callerId });
  }

  async function evaluateWorkStart({ artifact, callerId }) {
    assertArtifactType(artifact, WORK_START_TYPE);
    const candidate = clone(artifact);
    const evaluatedAt = clock().toISOString();
    const blockers = [];

    if (candidate.architecture?.required) {
      const hasRef = Boolean(candidate.architecture.packet_ref);
      const hasDigest = Boolean(candidate.architecture.packet_digest);
      if (hasRef !== hasDigest) {
        throw new DeliveryArtServiceError(
          "delivery_art_architecture_reference_incomplete",
          "Architecture packet ref and digest must be supplied together.",
        );
      }
      if (hasRef) {
        candidate.architecture.readiness = "architecture-ready";
      } else {
        candidate.architecture.packet_ref = null;
        candidate.architecture.packet_digest = null;
        candidate.architecture.readiness = "blocked";
        blockers.push("architecture decision is not ready");
      }
    } else {
      candidate.architecture.packet_ref = null;
      candidate.architecture.packet_digest = null;
      candidate.architecture.readiness = "not-required";
    }
    if (candidate.landing_unit?.decision === "defer_decision_blocked") {
      blockers.push("Landing Unit decision is deferred");
    }
    candidate.readiness = {
      blockers,
      evaluated_at: evaluatedAt,
      level: blockers.length === 0 ? "implementation-ready" : "blocked",
    };
    candidate.scope_fingerprint = workStartScopeFingerprint(candidate);
    const dependencies = await resolveDependencies(candidate);
    return persistDurableArtifact({ artifact: candidate, callerId, dependencies });
  }

  async function markReviewPacketMergeReady({ artifact, callerId }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    if (artifact.schema_version !== 2) {
      throw new DeliveryArtServiceError(
        "delivery_art_review_packet_version",
        "Durable Review Packet readiness requires schema_version 2.",
      );
    }
    const candidate = clone(artifact);
    candidate.status = "merge-ready";
    candidate.finalized_at = null;
    candidate.readiness = {
      evaluated_at: clock().toISOString(),
      level: "merge-ready",
      receipt_refs: [],
      subject_digest: null,
    };
    candidate.custody = {
      ...localCustody(),
      supersedes: null,
    };
    const dependencies = await resolveDependencies(candidate);
    return persistDurableArtifact({ artifact: candidate, callerId, dependencies });
  }

  async function prepareReviewPacketFinalization({ artifact, callerId }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    validateCallerBinding(artifact, callerId);
    if (artifact.status !== "merge-ready" || artifact.custody?.state !== "durable") {
      throw new DeliveryArtServiceError(
        "delivery_art_merge_ready_predecessor_required",
        "Finalization preparation requires a durable merge-ready Review Packet.",
        409,
      );
    }
    const evaluatedAt = clock().toISOString();
    const candidate = clone(artifact);
    candidate.status = "finalized";
    candidate.finalized_at = evaluatedAt;
    candidate.readiness = {
      evaluated_at: evaluatedAt,
      level: "operating-ready",
      receipt_refs: [],
      subject_digest: null,
    };
    candidate.custody = {
      ...localCustody(),
      supersedes: {
        digest: artifact.integrity.content_digest,
        uri: artifact.custody.uri,
      },
    };
    candidate.integrity = integrity();
    candidate.readiness.subject_digest = reviewPacketReadinessSubjectDigest(candidate);
    candidate.integrity.content_digest = artifactContentDigest(candidate);
    const dependencies = await resolveDependencies(candidate);
    const referenceErrors = validateDeliveryArtReferences(candidate, dependencies);
    if (referenceErrors.length > 0) {
      throw new DeliveryArtServiceError(
        "delivery_art_finalization_preflight_failed",
        "Review Packet finalization does not preserve its durable predecessor.",
        422,
        { errors: referenceErrors },
      );
    }
    if (
      candidate.landing_unit?.evidence_kind === "merged_pr" &&
      (candidate.landing_unit.repos ?? []).some((repo) => !repo.merge_commit)
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_merge_evidence_incomplete",
        "Merged Review Packet evidence requires a merge commit for every landing repo.",
        422,
      );
    }
    return {
      finalization_candidate: candidate,
      readiness_request: {
        artifact_id: candidate.packet_id,
        artifact_type: candidate.artifact_type,
        covered_work_item_ids: candidate.covered_work_item_ids,
        delivery_id: candidate.delivery_id,
        digest: candidate.readiness.subject_digest,
        digest_kind: "readiness-subject",
        readiness_level: "operating-ready",
      },
    };
  }

  async function finalizeReviewPacket({ artifact, callerId }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    if (artifact.status !== "finalized") {
      throw new DeliveryArtServiceError(
        "delivery_art_finalization_candidate_required",
        "Review Packet finalization requires a prepared finalized candidate.",
        409,
      );
    }
    if ((artifact.readiness?.receipt_refs ?? []).length === 0) {
      throw new DeliveryArtServiceError(
        "delivery_art_operating_receipt_required",
        "Review Packet finalization requires a durable operating-readiness receipt.",
        409,
      );
    }
    const dependencies = await resolveDependencies(artifact);
    return persistDurableArtifact({ artifact, callerId, dependencies });
  }

  async function resolveArtifact({ reference }) {
    const artifact = await resolveArtifactReference(reference, new Map());
    const dependencies = await resolveDependencies(artifact);
    try {
      assertValidDeliveryArtArtifact(artifact, dependencies);
    } catch (error) {
      throw validationFailure(error);
    }
    return { artifact };
  }

  async function validateArtifact({ artifact }) {
    const dependencies = await resolveDependencies(artifact);
    try {
      return assertValidDeliveryArtArtifact(artifact, dependencies);
    } catch (error) {
      throw validationFailure(error);
    }
  }

  return {
    evaluateWorkStart,
    finalizeReviewPacket,
    markReviewPacketMergeReady,
    persistArchitecturePacket,
    prepareReviewPacketFinalization,
    resolveArtifact,
    resolveDependencies,
    validateArtifact,
  };
}

export const DELIVERY_ART_ARTIFACT_TYPES = Object.freeze({
  architecture_packet: ARCHITECTURE_PACKET_TYPE,
  readiness_receipt: READINESS_RECEIPT_TYPE,
  review_packet: REVIEW_PACKET_TYPE,
  work_start: WORK_START_TYPE,
});
