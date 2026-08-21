import {
  artifactContentDigest,
  reviewPacketReadinessSubjectDigest,
  validateDeliveryArtArtifact,
  workStartScopeFingerprint,
} from "./contracts.js";
import { canonicalDigest } from "./canonical-json.js";

const INVALIDATION_INPUTS = Object.freeze([
  "art-descendant-or-dependency-change",
  "owner-or-rollback-boundary-change",
  "base-ref-or-commit-change",
  "architecture-decision-or-digest-change",
  "validation-or-security-obligation-change",
]);

export class DeliveryArtAuthoringError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtAuthoringError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return structuredClone(value);
}

function artifactReference(artifact) {
  return {
    digest: artifact?.integrity?.content_digest,
    uri: artifact?.custody?.uri,
  };
}

function localCustody(artifactId, supersedes = null) {
  return {
    backend: "local-filesystem",
    persisted_at: null,
    receipt_ref: null,
    state: "local-draft",
    supersedes: supersedes ? clone(supersedes) : null,
    uri: `local://delivery-art/${artifactId}.json`,
  };
}

function integrity() {
  return {
    algorithm: "sha256",
    canonicalization: "RFC8785",
    content_digest: `sha256:${"0".repeat(64)}`,
  };
}

function assertTimestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_authoring_timestamp_invalid",
      `${field} must be an ISO date-time string.`,
    );
  }
  return value;
}

function assertArtifactValid(artifact) {
  artifact.integrity.content_digest = artifactContentDigest(artifact);
  const validation = validateDeliveryArtArtifact(artifact);
  if (!validation.valid) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_authoring_contract_invalid",
      "Generated Delivery ART candidate failed its canonical contract.",
      validation,
    );
  }
  return artifact;
}

function sameValues(left, right) {
  const normalizedLeft = [...new Set(left ?? [])].sort();
  const normalizedRight = [...new Set(right ?? [])].sort();
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function assertDurableWorkStart(workStart) {
  if (
    workStart?.artifact_type !== "delivery_art_work_start_record" ||
    workStart?.readiness?.level !== "implementation-ready" ||
    workStart?.custody?.state !== "durable" ||
    workStart?.custody?.backend !== "wgcf-artifact-registry"
  ) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_work_start_not_ready",
      "Review Packet authoring requires one durable implementation-ready work-start record.",
    );
  }
}

function reviewPacketSourceRevision(landingUnit) {
  const repos = (landingUnit?.repos ?? [])
    .map((repo) => ({
      base_commit: repo.base_commit ?? null,
      base_ref: repo.base_ref ?? null,
      branch: repo.branch ?? null,
      head_commit: repo.head_commit ?? null,
      pr_url: repo.pr_url ?? null,
      repo_name: repo.repo_name ?? null,
    }))
    .sort((left, right) => String(left.repo_name).localeCompare(String(right.repo_name)));
  return canonicalDigest({
    evidence_kind: landingUnit?.evidence_kind ?? null,
    repos,
  }).replace(/^sha256:/, "");
}

export function deliveryArtPreMergeReviewPacketId(workStart, landingUnit) {
  return [
    workStart.artifact_id.replace(/^work-start:/, "review-packet:"),
    "source",
    reviewPacketSourceRevision(landingUnit),
  ].join("-");
}

export function createDeliveryArtWorkStartDraft({
  architecture,
  createdAt,
  deliveryId,
  landingUnit,
  operator,
  sourceSnapshot,
  coveredWorkItemIds,
}) {
  const timestamp = assertTimestamp(createdAt, "createdAt");
  const orderedWorkItems = [...new Set(coveredWorkItemIds ?? [])].sort();
  const artifactId = `work-start:${deliveryId}-${orderedWorkItems.join("-")}`;
  const candidate = {
    schema_version: 1,
    artifact_type: "delivery_art_work_start_record",
    artifact_id: artifactId,
    delivery_id: deliveryId,
    covered_work_item_ids: orderedWorkItems,
    created_at: timestamp,
    operator: clone(operator),
    landing_unit: clone(landingUnit),
    architecture: clone(architecture),
    source_snapshot: clone(sourceSnapshot),
    scope_fingerprint: `sha256:${"0".repeat(64)}`,
    invalidation_inputs: [...INVALIDATION_INPUTS],
    readiness: {
      level: "draft",
      evaluated_at: null,
      blockers: [],
    },
    integrity: integrity(),
    custody: localCustody(artifactId),
  };
  candidate.scope_fingerprint = workStartScopeFingerprint(candidate);
  return assertArtifactValid(candidate);
}

export function createDeliveryArtReviewPacketV2Draft({
  createdAt,
  evidence,
  exceptions = [],
  landingUnit,
  operator,
  workStart,
}) {
  assertDurableWorkStart(workStart);
  const timestamp = assertTimestamp(createdAt, "createdAt");
  const workStartRepos = workStart.landing_unit?.owner_repos ?? [];
  const packetRepos = (landingUnit?.repos ?? []).map((repo) => repo.repo_name);
  if (!sameValues(workStartRepos, packetRepos)) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_review_packet_repo_mismatch",
      "Review Packet repositories must exactly match the durable work-start owner repositories.",
    );
  }
  const branchPlanByRepo = new Map(
    (workStart.landing_unit?.branch_plan ?? []).map((entry) => [entry.repo, entry]),
  );
  for (const repo of landingUnit.repos ?? []) {
    const planned = branchPlanByRepo.get(repo.repo_name);
    if (
      !planned ||
      planned.branch !== repo.branch ||
      planned.base_ref !== repo.base_ref ||
      planned.base_commit !== repo.base_commit
    ) {
      throw new DeliveryArtAuthoringError(
        "delivery_art_review_packet_source_mismatch",
        `Review Packet source evidence for ${repo.repo_name} does not match work-start.`,
      );
    }
  }

  const packetId = deliveryArtPreMergeReviewPacketId(workStart, landingUnit);
  const candidate = {
    schema_version: 2,
    artifact_type: "art_review_packet",
    packet_id: packetId,
    delivery_id: workStart.delivery_id,
    covered_work_item_ids: clone(workStart.covered_work_item_ids),
    created_at: timestamp,
    operator: clone(operator),
    work_start: {
      artifact_ref: workStart.custody.uri,
      artifact_digest: workStart.integrity.content_digest,
      scope_fingerprint: workStart.scope_fingerprint,
    },
    landing_unit: {
      decision: workStart.landing_unit.decision,
      evidence_kind: landingUnit.evidence_kind,
      rollback_boundary: landingUnit.rollback_boundary,
      repos: clone(landingUnit.repos),
    },
    evidence: clone(evidence),
    exceptions: clone(exceptions),
    status: "draft",
    readiness: {
      level: "implementation-ready",
      evaluated_at: timestamp,
      subject_digest: null,
      receipt_refs: [],
    },
    integrity: integrity(),
    custody: localCustody(packetId),
    finalized_at: null,
  };
  return assertArtifactValid(candidate);
}

export function createDeliveryArtReviewPacketFinalizationDraft({
  evidence,
  exceptions,
  mergeReadyPacket,
  mergedRepos,
}) {
  if (
    mergeReadyPacket?.schema_version !== 2 ||
    mergeReadyPacket?.artifact_type !== "art_review_packet" ||
    mergeReadyPacket?.status !== "merge-ready" ||
    mergeReadyPacket?.custody?.state !== "durable"
  ) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_merge_ready_packet_required",
      "Finalization authoring requires one durable merge-ready Review Packet.",
    );
  }
  const mergedByRepo = new Map(
    (mergedRepos ?? []).map((entry) => [entry.repo_name, entry]),
  );
  const candidate = clone(mergeReadyPacket);
  candidate.landing_unit.evidence_kind = "merged_pr";
  candidate.landing_unit.repos = candidate.landing_unit.repos.map((repo) => {
    const merged = mergedByRepo.get(repo.repo_name);
    if (!merged?.merge_commit) {
      throw new DeliveryArtAuthoringError(
        "delivery_art_merge_commit_missing",
        `Merged source evidence is missing for ${repo.repo_name}.`,
      );
    }
    return {
      ...repo,
      head_commit: merged.head_commit ?? repo.head_commit,
      merge_commit: merged.merge_commit,
      pr_url: merged.pr_url ?? repo.pr_url,
    };
  });
  if (mergedByRepo.size !== candidate.landing_unit.repos.length) {
    throw new DeliveryArtAuthoringError(
      "delivery_art_merged_repo_mismatch",
      "Merged repository evidence must exactly cover the Landing Unit.",
    );
  }
  candidate.status = "draft";
  if (evidence !== undefined) {
    candidate.evidence = clone(evidence);
  }
  if (exceptions !== undefined) {
    candidate.exceptions = clone(exceptions);
  }
  candidate.readiness = {
    level: "implementation-ready",
    evaluated_at: mergeReadyPacket.readiness.evaluated_at,
    subject_digest: null,
    receipt_refs: [],
  };
  candidate.finalized_at = null;
  candidate.custody = localCustody(
    candidate.packet_id,
    artifactReference(mergeReadyPacket),
  );
  candidate.integrity = integrity();
  return assertArtifactValid(candidate);
}

export function projectDeliveryArtReviewPacketOperatingReadiness(candidate) {
  const subject = clone(candidate);
  subject.status = "finalized";
  subject.finalized_at = null;
  subject.readiness = {
    evaluated_at: null,
    level: "operating-ready",
    receipt_refs: [],
    subject_digest: null,
  };
  subject.readiness.subject_digest = reviewPacketReadinessSubjectDigest(subject);
  return {
    readinessRequest: {
      artifact_id: subject.packet_id,
      artifact_type: subject.artifact_type,
      covered_work_item_ids: clone(subject.covered_work_item_ids),
      delivery_id: subject.delivery_id,
      digest: subject.readiness.subject_digest,
      digest_kind: "readiness-subject",
      readiness_level: "operating-ready",
    },
    subject,
  };
}
