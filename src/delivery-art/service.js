import { randomUUID } from "node:crypto";

import {
  artifactContentDigest,
  architectureScopeFingerprint,
  assertValidDeliveryArtArtifact,
  deliveryArtContentProjection,
  reviewPacketReadinessSubjectDigest,
  validateDeliveryArtArtifact,
  validateDeliveryArtReferences,
  validateDeliveryArtSemanticProjection,
  workStartScopeFingerprint,
} from "./contracts.js";
import { canonicalStringify } from "./canonical-json.js";
import {
  createDeliveryArtReviewPacketFinalizationDraft,
  createDeliveryArtReviewPacketV2Draft,
  createDeliveryArtWorkStartDraft,
  DeliveryArtAuthoringError,
  projectDeliveryArtReviewPacketOperatingReadiness,
} from "./lifecycle-authoring.js";
import {
  DeliveryArtReviewEvidenceError,
  projectDeliveryArtReviewEvidence,
} from "./review-evidence.js";

const ARCHITECTURE_PACKET_TYPE = "delivery_art_architecture_packet";
const WORK_START_TYPE = "delivery_art_work_start_record";
const REVIEW_PACKET_TYPE = "art_review_packet";
const READINESS_RECEIPT_TYPE = "delivery_art_readiness_receipt";
const CUSTODY_RECEIPT_TYPE = "delivery_art_custody_receipt";
const SOURCE_BACKED_DECISIONS = new Set([
  "child_isolated_landing_unit",
  "feature_single_landing_unit",
]);

export const DELIVERY_ART_MUTATION_OPERATIONS = Object.freeze({
  evaluateWorkStart: "delivery.artifact.work_start.evaluate",
  finalizeReviewPacket: "delivery.artifact.review_packet.finalize",
  issueReviewPacketOperatingReadiness:
    "delivery.artifact.review_packet.issue_operating_readiness",
  markReviewPacketMergeReady: "delivery.artifact.review_packet.mark_merge_ready",
  persistArchitecturePacket: "delivery.artifact.architecture_packet.persist",
  prepareReviewPacketFinalization: "delivery.artifact.review_packet.prepare_finalization",
});

export const DELIVERY_ART_ARTIFACT_TYPES = Object.freeze({
  architecture_packet: ARCHITECTURE_PACKET_TYPE,
  custody_receipt: CUSTODY_RECEIPT_TYPE,
  readiness_receipt: READINESS_RECEIPT_TYPE,
  review_packet: REVIEW_PACKET_TYPE,
  work_start: WORK_START_TYPE,
});

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

function artifactIdentifier(artifact) {
  return artifact?.artifact_id ?? artifact?.packet_id ?? artifact?.receipt_id ?? null;
}

function deliveryRecordId(deliveryId) {
  const match = String(deliveryId ?? "").match(/^delivery-([1-9][0-9]*)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function workItemRecordIds(workItemIds) {
  return (workItemIds ?? []).map((workItemId) => {
    const match = String(workItemId ?? "").match(/^work-item-([1-9][0-9]*)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  });
}

function stableTimestamp(value, code, message) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DeliveryArtServiceError(code, message);
  }
  return value;
}

function timestampAfter(value, milliseconds = 1_000) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new DeliveryArtServiceError(
      "delivery_art_readiness_receipt_custody_invalid",
      "The operating-readiness receipt has no valid durable custody time.",
    );
  }
  return new Date(parsed + milliseconds).toISOString();
}

function sourceArtifactReference(artifact) {
  return {
    digest: artifact?.integrity?.content_digest,
    uri: artifact?.custody?.uri,
  };
}

function sameStringValues(left, right) {
  return canonicalStringify([...(left ?? [])].sort()) ===
    canonicalStringify([...(right ?? [])].sort());
}

function assertOperatingReadinessReceipt(
  receipt,
  readinessRequest,
  { requireMutationAllowed = false } = {},
) {
  if (
    receipt?.artifact_type !== READINESS_RECEIPT_TYPE ||
    receipt.delivery_id !== readinessRequest.delivery_id ||
    !sameStringValues(
      receipt.covered_work_item_ids,
      readinessRequest.covered_work_item_ids,
    ) ||
    receipt.subject?.artifact_type !== readinessRequest.artifact_type ||
    receipt.subject?.artifact_id !== readinessRequest.artifact_id ||
    receipt.subject?.digest_kind !== readinessRequest.digest_kind ||
    receipt.subject?.digest !== readinessRequest.digest ||
    receipt.readiness?.level !== readinessRequest.readiness_level
  ) {
    throw new DeliveryArtServiceError(
      "delivery_art_readiness_receipt_binding_invalid",
      "WGCF returned an operating-readiness receipt for a different Review Packet subject.",
      502,
    );
  }
  if (
    requireMutationAllowed &&
    (receipt.readiness?.outcome !== "ready" ||
      receipt.readiness?.mutation_allowed !== true)
  ) {
    throw new DeliveryArtServiceError(
      "delivery_art_operating_readiness_not_ready",
      "The WGCF operating-readiness decision does not permit Review Packet finalization.",
      409,
      {
        findings: clone(receipt.findings ?? []),
        outcome: receipt.readiness?.outcome ?? null,
      },
    );
  }
}

function assertReference(reference, code = "delivery_art_reference_invalid") {
  const digest = reference?.digest;
  const uri = reference?.uri;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(String(digest ?? "")) ||
    typeof uri !== "string" ||
    !uri.trim()
  ) {
    throw new DeliveryArtServiceError(
      code,
      "Delivery ART dependency references require an exact URI and SHA-256 digest.",
    );
  }
  return { digest, uri };
}

function assertArtifactType(artifact, expectedType) {
  if (artifact?.artifact_type !== expectedType) {
    throw new DeliveryArtServiceError(
      "delivery_art_type_mismatch",
      `Expected ${expectedType}, received ${artifact?.artifact_type ?? "no artifact type"}.`,
    );
  }
}

function assertReviewPacketV2(artifact) {
  if (artifact?.schema_version !== 2) {
    throw new DeliveryArtServiceError(
      "delivery_art_review_packet_version",
      "Durable Review Packet transitions require schema_version 2.",
    );
  }
}

function assertSourceBackedReviewPacket(artifact) {
  if (!SOURCE_BACKED_DECISIONS.has(artifact?.landing_unit?.decision)) {
    throw new DeliveryArtServiceError(
      "delivery_art_non_source_transition_unsupported",
      "This Review Packet transition requires a source-backed Landing Unit.",
      409,
    );
  }
}

function assertLocalCandidate(artifact, code, message) {
  if (
    artifact?.custody?.state !== "local-draft" ||
    artifact?.custody?.backend !== "local-filesystem" ||
    artifact?.custody?.receipt_ref !== null ||
    artifact?.custody?.persisted_at !== null ||
    !String(artifact?.custody?.uri ?? "").startsWith("local://delivery-art/")
  ) {
    throw new DeliveryArtServiceError(code, message, 409);
  }
}

function assertCallerBinding(artifact, callerId) {
  if (typeof callerId !== "string" || !callerId.trim()) {
    throw new DeliveryArtServiceError(
      "delivery_art_caller_missing",
      "Delivery ART mutations require an authenticated broker caller.",
      401,
    );
  }
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

function assertDirectLandAuthority(artifact, atTime) {
  if (artifact?.landing_unit?.evidence_kind !== "approved_direct_land") {
    return;
  }
  const cutoff = Date.parse(atTime);
  const active = Number.isFinite(cutoff) && (artifact.exceptions ?? []).some((exception) =>
    exception?.kind === "direct-land" && Date.parse(exception.expires_at) > cutoff
  );
  if (!active) {
    throw new DeliveryArtServiceError(
      "delivery_art_direct_land_authority_expired",
      "Direct-land authority is not active for this Review Packet transition.",
      409,
    );
  }
}

function validationFailure(error, code = "delivery_art_artifact_invalid") {
  if (error?.code === "delivery_art_artifact_invalid") {
    return new DeliveryArtServiceError(
      code,
      "Delivery ART artifact failed contract validation.",
      422,
      error.validation,
    );
  }
  return error;
}

function reviewEvidenceFailure(error) {
  if (error instanceof DeliveryArtReviewEvidenceError) {
    return new DeliveryArtServiceError(
      error.code,
      error.message,
      422,
      error.details,
    );
  }
  return error;
}

function validateStandalone(artifact, code = "delivery_art_artifact_invalid") {
  const result = validateDeliveryArtArtifact(artifact);
  if (!result.valid) {
    throw new DeliveryArtServiceError(
      code,
      "Delivery ART artifact failed contract validation.",
      422,
      result,
    );
  }
  return result;
}

function findDependency(dependencies, reference) {
  return dependencies.find((candidate) =>
    candidate?.custody?.uri === reference?.uri &&
    candidate?.integrity?.content_digest === reference?.digest
  ) ?? null;
}

function sourceSnapshotArtifactsFor(artifact, dependencies) {
  const result = [];
  const add = (candidate) => {
    if (candidate?.source_snapshot && !result.includes(candidate)) {
      result.push(candidate);
    }
  };
  add(artifact);

  const workStart = artifact?.artifact_type === REVIEW_PACKET_TYPE
    ? findDependency(dependencies, {
        digest: artifact.work_start?.artifact_digest,
        uri: artifact.work_start?.artifact_ref,
      })
    : artifact?.artifact_type === WORK_START_TYPE
      ? artifact
      : null;
  add(workStart);
  if (workStart?.architecture?.readiness === "architecture-ready") {
    add(findDependency(dependencies, {
      digest: workStart.architecture.packet_digest,
      uri: workStart.architecture.packet_ref,
    }));
  }
  return result;
}

function materialRecordMap(projection) {
  return new Map(
    (projection?.records ?? []).map((record) => [
      `work-item-${record.id}`,
      record,
    ]),
  );
}

function normalizedArchitectureEdges(architecture) {
  if (architecture?.schema_version === 2) {
    return (architecture?.architecture?.work_dependency_graph?.edges ?? [])
      .map((edge) =>
        `${edge.prerequisite_work_item_id}->${edge.dependent_work_item_id}`)
      .sort();
  }
  return (architecture?.architecture?.dependency_merge_dag?.edges ?? [])
    .map((edge) => {
      const before = edge.relation === "depends_on" ? edge.to : edge.from;
      const after = edge.relation === "depends_on" ? edge.from : edge.to;
      return `${before}->${after}`;
    })
    .sort();
}

function normalizedProjectionEdges(projection, coveredWorkItemIds) {
  const covered = new Set(coveredWorkItemIds);
  return (projection?.relations ?? [])
    .filter((relation) =>
      relation.relation_type === "follows" &&
      covered.has(relation.from_work_item_id) &&
      covered.has(relation.to_work_item_id))
    .map((relation) =>
      `${relation.from_work_item_id}->${relation.to_work_item_id}`)
    .sort();
}

function architectureMaterialSnapshotErrors(artifact, projection) {
  const errors = [];
  const records = materialRecordMap(projection);
  const covered = [...(artifact.covered_work_item_ids ?? [])].sort();
  if (!sameStringValues(projection?.covered_work_item_ids, covered)) {
    errors.push("covered work-item scope changed");
  }
  if (projection?.delivery_id !== artifact.delivery_id) {
    errors.push("Delivery initiative changed");
  }

  for (const entry of artifact.architecture?.descendant_owner_map ?? []) {
    const record = records.get(entry.work_item_id);
    if (!record) {
      errors.push(`${entry.work_item_id} is missing from the current ART scope`);
      continue;
    }
    if (record.owner_repo !== entry.owner_repo) {
      errors.push(`${entry.work_item_id} owner changed`);
    }
    if (record.type !== entry.work_item_type) {
      errors.push(`${entry.work_item_id} type changed`);
    }
    if (
      entry.parent_work_item_id !== null &&
      `work-item-${record.parent_id}` !== entry.parent_work_item_id
    ) {
      errors.push(`${entry.work_item_id} parent changed`);
    }
  }

  if (!sameStringValues(
    normalizedProjectionEdges(projection, covered),
    normalizedArchitectureEdges(artifact),
  )) {
    errors.push("dependency or merge-order topology changed");
  }
  return errors;
}

function workStartMaterialSnapshotErrors(artifact, projection) {
  const errors = [];
  const covered = [...(artifact.covered_work_item_ids ?? [])].sort();
  if (!sameStringValues(projection?.covered_work_item_ids, covered)) {
    errors.push("covered work-item scope changed");
  }
  if (projection?.delivery_id !== artifact.delivery_id) {
    errors.push("Delivery initiative changed");
  }
  const records = materialRecordMap(projection);
  const owners = new Set(artifact.landing_unit?.owner_repos ?? []);
  for (const workItemId of covered) {
    const record = records.get(workItemId);
    if (!record) {
      errors.push(`${workItemId} is missing from the current ART scope`);
    } else if (!owners.has(record.owner_repo)) {
      errors.push(`${workItemId} owner changed`);
    }
  }
  return errors;
}

function historicalMaterialSnapshotErrors(artifact, projection) {
  if (!projection || projection.schema_version !== 2) {
    return ["fresh ART projection is unavailable for semantic comparison"];
  }
  if (artifact.artifact_type === ARCHITECTURE_PACKET_TYPE) {
    return architectureMaterialSnapshotErrors(artifact, projection);
  }
  if (artifact.artifact_type === WORK_START_TYPE) {
    return workStartMaterialSnapshotErrors(artifact, projection);
  }
  return ["artifact type has no historical material-snapshot policy"];
}

function artifactStatus(artifact) {
  if (artifact?.artifact_type === ARCHITECTURE_PACKET_TYPE) {
    return artifact.decision?.status ?? null;
  }
  if (artifact?.artifact_type === WORK_START_TYPE) {
    return artifact.readiness?.level ?? null;
  }
  if (artifact?.artifact_type === REVIEW_PACKET_TYPE) {
    return artifact.status ?? null;
  }
  return null;
}

function safeFailureCode(error) {
  return typeof error?.code === "string"
    ? error.code
    : typeof error?.errorClass === "string"
      ? error.errorClass
      : "unexpected_error";
}

function authoringFailure(error) {
  if (error instanceof DeliveryArtAuthoringError) {
    return new DeliveryArtServiceError(
      error.code,
      error.message,
      422,
      error.details,
    );
  }
  return error;
}

export function createDeliveryArtArtifactService({
  audit = null,
  clock = () => new Date(),
  mutationAdmission = {
    admitted: false,
    reason: "delivery_art_runtime_activation_pending",
    writerTopology: null,
  },
  openProjectClient,
  readinessClient = null,
  readinessReceiptResolver = null,
  registryClient,
} = {}) {
  if (!registryClient || typeof registryClient.register !== "function" || typeof registryClient.read !== "function") {
    throw new Error("registryClient with register and read methods is required");
  }
  if (
    !openProjectClient ||
    typeof openProjectClient.captureDeliveryArtScope !== "function" ||
    typeof openProjectClient.projectDeliveryArtReference !== "function"
  ) {
    throw new Error("openProjectClient with Delivery ART scope and projection methods is required");
  }

  const admitted = mutationAdmission?.admitted === true &&
    mutationAdmission?.writerTopology === "single-writer";
  const admissionReason = mutationAdmission?.admitted !== true
    ? mutationAdmission?.reason ?? "delivery_art_runtime_activation_pending"
    : mutationAdmission?.writerTopology !== "single-writer"
      ? "delivery_art_single_writer_topology_required"
      : mutationAdmission?.reason ?? "admitted";
  const resolveReadinessReceipt = typeof readinessReceiptResolver === "function"
    ? readinessReceiptResolver
    : typeof readinessClient?.read === "function"
      ? ({ reference }) => readinessClient.read({ reference })
      : null;
  const activeTransitions = new Map();

  function emitAudit(event) {
    if (typeof audit?.emit === "function") {
      audit.emit(event);
    }
  }

  async function serialize(key, operation) {
    while (activeTransitions.has(key)) {
      await activeTransitions.get(key);
    }
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    activeTransitions.set(key, pending);
    try {
      return await operation();
    } finally {
      activeTransitions.delete(key);
      release();
    }
  }

  function transitionKey(operation, artifact) {
    return [
      operation,
      artifact?.artifact_type ?? "unknown",
      artifact?.delivery_id ?? "unknown",
      artifactIdentifier(artifact) ?? "unknown",
      artifact?.custody?.supersedes?.digest ?? "root",
    ].join(":");
  }

  function controlledMutation(operation, handler) {
    return async (input = {}) => {
      const correlationId = typeof input.correlationId === "string" && input.correlationId.trim()
        ? input.correlationId.trim()
        : randomUUID();
      if (!admitted) {
        throw new DeliveryArtServiceError(
          "delivery_art_mutation_not_admitted",
          "Delivery ART artifact writes are unavailable until runtime admission is complete.",
          503,
          {
            reason: admissionReason,
            writer_topology: mutationAdmission?.writerTopology ?? null,
          },
        );
      }
      return serialize(transitionKey(operation, input.artifact), async () => {
        try {
          const result = await handler({ ...input, correlationId });
          emitAudit({
            artifact_id: artifactIdentifier(result?.artifact ?? input.artifact),
            backend: result?.owner_receipt
              ? "wgcf-artifact-registry"
              : result?.readiness_receipt
                ? "wgcf-readiness-ledger"
                : "operator-orchestration-service",
            caller_id: input.callerId ?? null,
            correlation_id: correlationId,
            event_type: "delivery.artifact.mutation",
            operation,
            outcome: "success",
            replayed: result?.owner_receipt?.replayed ?? false,
          });
          return result;
        } catch (error) {
          emitAudit({
            artifact_id: artifactIdentifier(input.artifact),
            backend: "operator-orchestration-service",
            caller_id: input.callerId ?? null,
            correlation_id: correlationId,
            error_class: safeFailureCode(error),
            event_type: "delivery.artifact.mutation",
            operation,
            outcome: error?.statusCode < 500 ? "blocked" : "failure",
          });
          throw error;
        }
      });
    };
  }

  function assertResolvedSource(reference, response) {
    const expected = assertReference(reference);
    const artifact = response?.artifact;
    const receipt = response?.custody_receipt;
    if (
      artifact?.custody?.uri !== expected.uri ||
      artifact?.integrity?.content_digest !== expected.digest ||
      receipt?.custody?.uri !== artifact?.custody?.receipt_ref?.uri ||
      receipt?.integrity?.content_digest !== artifact?.custody?.receipt_ref?.digest
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_dependency_binding_invalid",
        "WGCF returned a Delivery ART dependency that does not match its requested reference.",
        502,
      );
    }
    validateStandalone(artifact, "delivery_art_dependency_invalid");
    validateStandalone(receipt, "delivery_art_dependency_invalid");
    return { artifact, receipt };
  }

  async function resolveDependencies(artifact) {
    const byUri = new Map();
    const walkedSources = new Set();
    const walkedReceipts = new Set();

    const addDependency = (candidate) => {
      const uri = candidate?.custody?.uri;
      if (typeof uri === "string" && !byUri.has(uri)) {
        byUri.set(uri, candidate);
      }
    };

    const readReadinessReceipt = async (reference) => {
      const expected = assertReference(reference);
      if (byUri.has(expected.uri)) {
        return byUri.get(expected.uri);
      }
      if (typeof resolveReadinessReceipt !== "function") {
        throw new DeliveryArtServiceError(
          "delivery_art_readiness_resolver_unavailable",
          "A trusted operating-readiness receipt resolver is not configured.",
          503,
        );
      }
      const resolved = await resolveReadinessReceipt({ reference: clone(expected) });
      const receipt = clone(resolved?.artifact ?? resolved);
      if (
        receipt?.artifact_type !== READINESS_RECEIPT_TYPE ||
        receipt?.custody?.uri !== expected.uri ||
        receipt?.integrity?.content_digest !== expected.digest
      ) {
        throw new DeliveryArtServiceError(
          "delivery_art_readiness_receipt_binding_invalid",
          "The resolved operating-readiness receipt does not match its requested reference.",
          502,
        );
      }
      validateStandalone(receipt, "delivery_art_readiness_receipt_invalid");
      addDependency(receipt);
      if (!walkedReceipts.has(expected.uri)) {
        walkedReceipts.add(expected.uri);
        if (receipt.custody?.supersedes) {
          await readReadinessReceipt(receipt.custody.supersedes);
        }
      }
      return receipt;
    };

    const readSource = async (reference) => {
      const expected = assertReference(reference);
      if (byUri.has(expected.uri)) {
        return byUri.get(expected.uri);
      }
      const response = await registryClient.read({ contentDigest: expected.digest });
      const { artifact: resolved, receipt } = assertResolvedSource(expected, response);
      addDependency(resolved);
      addDependency(receipt);
      if (walkedSources.has(expected.uri)) {
        return resolved;
      }
      walkedSources.add(expected.uri);

      if (resolved.custody?.supersedes) {
        await readSource(resolved.custody.supersedes);
      }
      if (
        resolved.artifact_type === WORK_START_TYPE &&
        resolved.architecture?.readiness === "architecture-ready"
      ) {
        await readSource({
          digest: resolved.architecture.packet_digest,
          uri: resolved.architecture.packet_ref,
        });
      }
      if (resolved.artifact_type === REVIEW_PACKET_TYPE) {
        await readSource({
          digest: resolved.work_start?.artifact_digest,
          uri: resolved.work_start?.artifact_ref,
        });
        for (const receiptRef of resolved.readiness?.receipt_refs ?? []) {
          await readReadinessReceipt(receiptRef);
        }
      }
      return resolved;
    };

    if (artifact?.custody?.supersedes) {
      await readSource(artifact.custody.supersedes);
    }
    if (
      artifact?.artifact_type === WORK_START_TYPE &&
      artifact.architecture?.readiness === "architecture-ready"
    ) {
      await readSource({
        digest: artifact.architecture.packet_digest,
        uri: artifact.architecture.packet_ref,
      });
    }
    if (artifact?.artifact_type === REVIEW_PACKET_TYPE) {
      await readSource({
        digest: artifact.work_start?.artifact_digest,
        uri: artifact.work_start?.artifact_ref,
      });
      for (const receiptRef of artifact.readiness?.receipt_refs ?? []) {
        await readReadinessReceipt(receiptRef);
      }
    }
    return [...byUri.values()];
  }

  async function captureFreshSnapshot(
    artifact,
    dependencies,
    { currentCandidate = true } = {},
  ) {
    const snapshotArtifacts = sourceSnapshotArtifactsFor(artifact, dependencies);
    if (snapshotArtifacts.length === 0) {
      throw new DeliveryArtServiceError(
        "delivery_art_scope_invalid",
        "Delivery ART persistence requires a source snapshot bound to the current artifact chain.",
      );
    }

    const capturedByScope = new Map();
    let primary = null;
    for (const snapshotArtifact of snapshotArtifacts) {
      const deliveryId = deliveryRecordId(snapshotArtifact.delivery_id);
      const coveredIds = workItemRecordIds(snapshotArtifact.covered_work_item_ids);
      if (!deliveryId || coveredIds.length === 0 || coveredIds.some((recordId) => !recordId)) {
        throw new DeliveryArtServiceError(
          "delivery_art_scope_invalid",
          "Delivery ART artifact coverage cannot be mapped to a scoped ART read.",
        );
      }
      const key = `${deliveryId}:${[...coveredIds].sort((a, b) => a - b).join(",")}`;
      let captured = capturedByScope.get(key);
      if (!captured) {
        captured = await openProjectClient.captureDeliveryArtScope({
          deliveryRecordId: deliveryId,
          workItemRecordIds: coveredIds,
        });
        capturedByScope.set(key, captured);
      }
      primary ??= captured;
      if (captured.artDigest !== snapshotArtifact.source_snapshot.art_digest) {
        const historicalDependency = !currentCandidate || snapshotArtifact !== artifact;
        const materialErrors = historicalDependency
          ? historicalMaterialSnapshotErrors(snapshotArtifact, captured.projection)
          : [];
        if (historicalDependency && materialErrors.length === 0) {
          continue;
        }
        throw new DeliveryArtServiceError(
          "delivery_art_snapshot_stale",
          historicalDependency
            ? "The material ART scope changed after this historical Delivery ART artifact was approved."
            : "The scoped ART source changed after this Delivery ART transition candidate was prepared.",
          409,
          {
            expected_art_digest: snapshotArtifact.source_snapshot.art_digest,
            fresh_art_digest: captured.artDigest,
            freshness_class: historicalDependency
              ? "historical-material-semantics"
              : "transition-candidate-exact",
            ...(historicalDependency ? { material_errors: materialErrors } : {}),
            stale_artifact_id: artifactIdentifier(snapshotArtifact),
            stale_artifact_type: snapshotArtifact.artifact_type,
          },
        );
      }
    }
    return primary;
  }

  function assertRegisteredArtifact(candidate, content, digest, response, dependencies) {
    const artifact = response?.artifact;
    const receipt = response?.custody_receipt;
    if (
      canonicalStringify(deliveryArtContentProjection(artifact)) !== canonicalStringify(content) ||
      artifact?.integrity?.content_digest !== digest ||
      artifact?.artifact_type !== candidate.artifact_type ||
      artifactIdentifier(artifact) !== artifactIdentifier(candidate) ||
      artifact?.delivery_id !== candidate.delivery_id
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_registry_content_mismatch",
        "WGCF returned durable content that differs from the submitted Delivery ART artifact.",
        502,
      );
    }
    try {
      assertValidDeliveryArtArtifact(artifact, [receipt, ...dependencies]);
    } catch (error) {
      throw validationFailure(error, "delivery_art_registry_artifact_invalid");
    }
    return { artifact, receipt };
  }

  async function persistDurableArtifact({ artifact, callerId, dependencies = null }) {
    const candidate = clone(artifact);
    candidate.integrity.content_digest = artifactContentDigest(candidate);
    const content = deliveryArtContentProjection(candidate);
    const digest = candidate.integrity.content_digest;
    const resolvedDependencies = dependencies ?? await resolveDependencies(candidate);
    const semanticValidation = validateDeliveryArtSemanticProjection(candidate);
    if (!semanticValidation.valid) {
      throw new DeliveryArtServiceError(
        "delivery_art_candidate_invalid",
        "Delivery ART persistence candidate failed semantic validation.",
        422,
        semanticValidation,
      );
    }
    const firstSnapshot = await captureFreshSnapshot(candidate, resolvedDependencies);

    const response = await registryClient.register({
      artifactContent: content,
      contentDigest: digest,
    });
    const registered = assertRegisteredArtifact(
      candidate,
      content,
      digest,
      response,
      resolvedDependencies,
    );
    const finalSnapshot = await captureFreshSnapshot(
      registered.artifact,
      resolvedDependencies,
    );

    let projection;
    try {
      projection = await openProjectClient.projectDeliveryArtReference({
        artifact: response.registry.artifact_ref,
        artifactId: artifactIdentifier(registered.artifact),
        artifactStatus: artifactStatus(registered.artifact),
        artifactType: registered.artifact.artifact_type,
        custodyReceipt: response.registry.custody_receipt_ref,
        recordId: deliveryRecordId(registered.artifact.delivery_id),
      });
    } catch (error) {
      throw new DeliveryArtServiceError(
        "delivery_art_openproject_projection_failed",
        "Durable Delivery ART custody succeeded, but its OpenProject reference projection failed.",
        502,
        {
          artifact_ref: response.registry.artifact_ref,
          custody_receipt_ref: response.registry.custody_receipt_ref,
          projection_error: safeFailureCode(error),
        },
      );
    }

    return {
      artifact: registered.artifact,
      custody_receipt: registered.receipt,
      owner_receipt: {
        artifact_id: artifactIdentifier(registered.artifact),
        artifact_type: registered.artifact.artifact_type,
        content_digest: digest,
        covered_work_item_ids: registered.artifact.covered_work_item_ids,
        custody_uri: registered.artifact.custody.uri,
        delivery_id: registered.artifact.delivery_id,
        fresh_art_digest: finalSnapshot.artDigest ?? firstSnapshot.artDigest,
        operator_id: callerId,
        persisted_at: registered.artifact.custody.persisted_at,
        projected: projection.projected,
        projection_replayed: projection.replayed,
        registry_generation: response.registry.generation,
        replayed: response.registry.resolution !== "created",
      },
    };
  }

  async function persistArchitecturePacket({ artifact, callerId }) {
    assertArtifactType(artifact, ARCHITECTURE_PACKET_TYPE);
    assertLocalCandidate(
      artifact,
      "delivery_art_architecture_input_not_local",
      "Architecture persistence requires a local candidate.",
    );
    assertCallerBinding(artifact, callerId);
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
        "Architecture decision authority must match the authenticated broker caller.",
        403,
      );
    }
    const candidate = clone(artifact);
    candidate.scope_fingerprint = architectureScopeFingerprint(candidate);
    return persistDurableArtifact({ artifact: candidate, callerId });
  }

  async function evaluateWorkStart({ artifact, callerId }) {
    assertArtifactType(artifact, WORK_START_TYPE);
    assertLocalCandidate(
      artifact,
      "delivery_art_work_start_input_not_local",
      "Work-start evaluation requires a local draft candidate.",
    );
    assertCallerBinding(artifact, callerId);
    if (artifact.readiness?.level !== "draft") {
      throw new DeliveryArtServiceError(
        "delivery_art_work_start_input_not_draft",
        "Work-start evaluation requires draft readiness state.",
        409,
      );
    }

    const candidate = clone(artifact);
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
      evaluated_at: stableTimestamp(
        artifact.readiness?.evaluated_at ?? artifact.created_at,
        "delivery_art_work_start_timestamp_missing",
        "Work-start evaluation requires a stable creation or evaluation timestamp.",
      ),
      level: blockers.length === 0 ? "implementation-ready" : "blocked",
    };
    candidate.scope_fingerprint = workStartScopeFingerprint(candidate);
    return persistDurableArtifact({ artifact: candidate, callerId });
  }

  async function draftWorkStart({ input, callerId }) {
    const deliveryId = deliveryRecordId(input?.delivery_id);
    const coveredRecordIds = workItemRecordIds(input?.covered_work_item_ids);
    if (
      !deliveryId ||
      coveredRecordIds.length === 0 ||
      coveredRecordIds.some((recordId) => !recordId)
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_scope_invalid",
        "Work-start authoring requires one Delivery initiative and at least one covered work item.",
      );
    }

    const architecture = {
      packet_digest: null,
      packet_ref: null,
      readiness: input?.architecture?.required ? "blocked" : "not-required",
      required: input?.architecture?.required === true,
    };
    if (architecture.required) {
      const reference = assertReference(
        input?.architecture?.reference,
        "delivery_art_architecture_reference_required",
      );
      const resolved = await resolveArtifactForTransition({ reference });
      const packet = resolved.artifact;
      if (
        packet.artifact_type !== ARCHITECTURE_PACKET_TYPE ||
        packet.delivery_id !== input.delivery_id ||
        packet.decision?.status !== "architecture-ready" ||
        !(input.covered_work_item_ids ?? []).every((workItemId) =>
          packet.covered_work_item_ids?.includes(workItemId))
      ) {
        throw new DeliveryArtServiceError(
          "delivery_art_architecture_scope_mismatch",
          "The architecture reference must resolve to an architecture-ready packet covering this work-start scope.",
          409,
        );
      }
      architecture.packet_digest = reference.digest;
      architecture.packet_ref = reference.uri;
      architecture.readiness = "architecture-ready";
    }

    const capturedAt = clock().toISOString();
    const snapshot = await openProjectClient.captureDeliveryArtScope({
      deliveryRecordId: deliveryId,
      workItemRecordIds: coveredRecordIds,
    });
    let workStart;
    try {
      workStart = createDeliveryArtWorkStartDraft({
        architecture,
        coveredWorkItemIds: input.covered_work_item_ids,
        createdAt: capturedAt,
        deliveryId: input.delivery_id,
        landingUnit: input.landing_unit,
        operator: {
          decision_source: input?.operator?.decision_source ?? "operator",
          id: callerId,
        },
        sourceSnapshot: {
          art_digest: snapshot.artDigest,
          art_ref: `openproject://work_packages/${coveredRecordIds[0]}`,
          captured_at: capturedAt,
          repo_revisions: (input?.landing_unit?.branch_plan ?? []).map((entry) => ({
            base_ref: entry.base_ref,
            commit: entry.base_commit,
            repo: entry.repo,
          })),
        },
      });
    } catch (error) {
      throw authoringFailure(error);
    }
    await validateArtifact({ artifact: workStart });
    return {
      source_snapshot: {
        art_digest: snapshot.artDigest,
        covered_record_count: snapshot.coveredRecordCount,
        dependency_record_count: snapshot.dependencyRecordCount,
        relation_count: snapshot.relationCount,
      },
      work_start: workStart,
    };
  }

  async function draftReviewPacket({ input, callerId }) {
    const reference = assertReference(
      input?.work_start_ref,
      "delivery_art_work_start_reference_required",
    );
    const resolved = await resolveArtifactForTransition({ reference });
    const workStart = resolved.artifact;
    assertCallerBinding(workStart, callerId);
    let reviewPacket;
    try {
      reviewPacket = createDeliveryArtReviewPacketV2Draft({
        createdAt: input.created_at ?? clock().toISOString(),
        evidence: input.evidence,
        exceptions: input.exceptions ?? [],
        landingUnit: input.landing_unit,
        operator: {
          decision_source: input?.operator?.decision_source ?? "operator",
          id: callerId,
        },
        workStart,
      });
    } catch (error) {
      throw authoringFailure(error);
    }
    await validateArtifact({ artifact: reviewPacket });
    return { review_packet: reviewPacket };
  }

  async function projectReviewEvidence({ input, callerId }) {
    const reference = assertReference(
      input?.work_start_ref,
      "delivery_art_work_start_reference_required",
    );
    const { dependencies, resolved } = await readResolvedArtifact({ reference });
    const workStart = resolved.artifact;
    assertArtifactType(workStart, WORK_START_TYPE);
    assertCallerBinding(workStart, callerId);
    await captureFreshSnapshot(workStart, dependencies, {
      currentCandidate: false,
    });
    const architecture = workStart.architecture?.readiness === "architecture-ready"
      ? findDependency(dependencies, {
          digest: workStart.architecture.packet_digest,
          uri: workStart.architecture.packet_ref,
        })
      : null;
    try {
      return projectDeliveryArtReviewEvidence({
        architecture,
        currentDocument: input.current_document ?? null,
        source: input.source,
        workStart,
      });
    } catch (error) {
      throw reviewEvidenceFailure(error);
    }
  }

  async function draftReviewPacketFinalization({ input, callerId }) {
    const reference = assertReference(
      input?.merge_ready_ref,
      "delivery_art_merge_ready_reference_required",
    );
    const resolved = await resolveArtifactForTransition({ reference });
    assertCallerBinding(resolved.artifact, callerId);
    let finalizationCandidate;
    try {
      finalizationCandidate = createDeliveryArtReviewPacketFinalizationDraft({
        evidence: input.evidence,
        exceptions: input.exceptions,
        mergeReadyPacket: resolved.artifact,
        mergedRepos: input.merged_repos,
      });
    } catch (error) {
      throw authoringFailure(error);
    }
    await validateArtifact({ artifact: finalizationCandidate });
    return { finalization_candidate: finalizationCandidate };
  }

  async function markReviewPacketMergeReady({ artifact, callerId }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    assertReviewPacketV2(artifact);
    assertSourceBackedReviewPacket(artifact);
    assertLocalCandidate(
      artifact,
      "delivery_art_merge_ready_input_not_local",
      "Merge-ready evaluation requires a local Review Packet candidate.",
    );
    assertCallerBinding(artifact, callerId);
    if (artifact.status !== "draft") {
      throw new DeliveryArtServiceError(
        "delivery_art_merge_ready_input_not_draft",
        "Merge-ready evaluation requires draft Review Packet status.",
        409,
      );
    }
    const candidate = clone(artifact);
    candidate.status = "merge-ready";
    candidate.finalized_at = null;
    candidate.readiness = {
      evaluated_at: stableTimestamp(
        artifact.readiness?.evaluated_at,
        "delivery_art_merge_ready_timestamp_missing",
        "Merge-ready evaluation requires a stable evaluation timestamp.",
      ),
      level: "merge-ready",
      receipt_refs: [],
      subject_digest: null,
    };
    return persistDurableArtifact({ artifact: candidate, callerId });
  }

  async function prepareReviewPacketFinalization({ artifact, callerId }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    assertReviewPacketV2(artifact);
    assertSourceBackedReviewPacket(artifact);
    assertLocalCandidate(
      artifact,
      "delivery_art_finalization_input_not_local",
      "Finalization preparation requires a local post-merge Review Packet candidate.",
    );
    assertCallerBinding(artifact, callerId);
    if (
      artifact.status !== "draft" ||
      artifact.readiness?.level !== "implementation-ready" ||
      (artifact.readiness?.receipt_refs ?? []).length !== 0 ||
      !artifact.custody?.supersedes
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_finalization_candidate_invalid",
        "Finalization preparation requires a local draft that supersedes one durable merge-ready packet.",
        409,
      );
    }
    if (
      !["merged_pr", "approved_direct_land"].includes(artifact.landing_unit?.evidence_kind) ||
      (artifact.landing_unit?.repos ?? []).some((repo) => !/^[0-9a-f]{40}$/.test(repo.merge_commit ?? ""))
    ) {
      throw new DeliveryArtServiceError(
        "delivery_art_merge_evidence_incomplete",
        "Final Review Packet source evidence requires a merge commit for every landing repo.",
      );
    }

    const candidate = clone(artifact);
    candidate.integrity.content_digest = artifactContentDigest(candidate);
    validateStandalone(candidate, "delivery_art_finalization_preflight_failed");
    assertDirectLandAuthority(candidate, clock().toISOString());
    const dependencies = await resolveDependencies(candidate);
    await captureFreshSnapshot(candidate, dependencies);

    const {
      readinessRequest,
      subject: finalizationSubject,
    } = projectDeliveryArtReviewPacketOperatingReadiness(candidate);
    const referenceErrors = validateDeliveryArtReferences(finalizationSubject, dependencies)
      .filter((error) => !error.startsWith("dependency artifact "));
    if (referenceErrors.length > 0) {
      throw new DeliveryArtServiceError(
        "delivery_art_finalization_preflight_failed",
        "Review Packet finalization does not preserve its durable predecessor.",
        422,
        { errors: referenceErrors },
      );
    }

    return {
      finalization_candidate: candidate,
      readiness_request: readinessRequest,
    };
  }

  async function finalizeReviewPacket({ artifact, callerId, readinessReceiptRef }) {
    assertArtifactType(artifact, REVIEW_PACKET_TYPE);
    assertReviewPacketV2(artifact);
    assertSourceBackedReviewPacket(artifact);
    assertLocalCandidate(
      artifact,
      "delivery_art_finalization_input_not_local",
      "Review Packet finalization requires the prepared local candidate.",
    );
    assertCallerBinding(artifact, callerId);
    const receiptReference = assertReference(
      readinessReceiptRef,
      "delivery_art_operating_receipt_required",
    );

    const candidate = clone(artifact);
    candidate.status = "finalized";
    candidate.readiness = {
      evaluated_at: null,
      level: "operating-ready",
      receipt_refs: [receiptReference],
      subject_digest: null,
    };
    candidate.finalized_at = null;
    const dependencies = await resolveDependencies(candidate);
    const receipt = findDependency(dependencies, receiptReference);
    if (receipt?.artifact_type !== READINESS_RECEIPT_TYPE) {
      throw new DeliveryArtServiceError(
        "delivery_art_operating_receipt_required",
        "Review Packet finalization requires one trusted operating-readiness receipt.",
        409,
      );
    }
    candidate.readiness.evaluated_at = receipt.readiness?.evaluated_at;
    candidate.finalized_at = timestampAfter(receipt.custody?.persisted_at);
    candidate.readiness.subject_digest = reviewPacketReadinessSubjectDigest(candidate);
    candidate.integrity.content_digest = artifactContentDigest(candidate);
    assertDirectLandAuthority(candidate, candidate.finalized_at);
    assertOperatingReadinessReceipt(
      receipt,
      {
        artifact_id: candidate.packet_id,
        artifact_type: candidate.artifact_type,
        covered_work_item_ids: candidate.covered_work_item_ids,
        delivery_id: candidate.delivery_id,
        digest: candidate.readiness.subject_digest,
        digest_kind: "readiness-subject",
        readiness_level: candidate.readiness.level,
      },
      { requireMutationAllowed: true },
    );

    return persistDurableArtifact({
      artifact: candidate,
      callerId,
      dependencies,
    });
  }

  async function issueReviewPacketOperatingReadiness({ artifact, callerId }) {
    if (typeof readinessClient?.issue !== "function") {
      throw new DeliveryArtServiceError(
        "delivery_art_readiness_client_unavailable",
        "WGCF operating-readiness issuance is not configured.",
        503,
      );
    }
    const prepared = await prepareReviewPacketFinalization({ artifact, callerId });
    const result = await readinessClient.issue({
      finalizationCandidate: clone(prepared.finalization_candidate),
      readinessRequest: clone(prepared.readiness_request),
    });
    const receipt = clone(result?.artifact);
    validateStandalone(receipt, "delivery_art_readiness_receipt_invalid");
    assertOperatingReadinessReceipt(receipt, prepared.readiness_request);
    return {
      finalization_candidate: prepared.finalization_candidate,
      readiness: clone(result.receipt),
      readiness_receipt: receipt,
      readiness_receipt_ref: {
        digest: receipt.integrity.content_digest,
        uri: receipt.custody.uri,
      },
    };
  }

  async function readResolvedArtifact({ reference }) {
    const expected = assertReference(reference);
    const response = await registryClient.read({ contentDigest: expected.digest });
    const resolved = assertResolvedSource(expected, response);
    const dependencies = [resolved.receipt, ...await resolveDependencies(resolved.artifact)];
    try {
      assertValidDeliveryArtArtifact(resolved.artifact, dependencies);
    } catch (error) {
      throw validationFailure(error, "delivery_art_dependency_invalid");
    }
    return { dependencies, resolved };
  }

  async function resolveArtifact({ reference }) {
    const { resolved } = await readResolvedArtifact({ reference });
    return {
      artifact: resolved.artifact,
      custody_receipt: resolved.receipt,
    };
  }

  async function resolveArtifactForTransition({ reference }) {
    const { dependencies, resolved } = await readResolvedArtifact({ reference });
    if (sourceSnapshotArtifactsFor(resolved.artifact, dependencies).length > 0) {
      await captureFreshSnapshot(resolved.artifact, dependencies, {
        currentCandidate: false,
      });
    }
    return {
      artifact: resolved.artifact,
      custody_receipt: resolved.receipt,
    };
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
    draftReviewPacket,
    draftReviewPacketFinalization,
    draftWorkStart,
    evaluateWorkStart: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.evaluateWorkStart,
      evaluateWorkStart,
    ),
    finalizeReviewPacket: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.finalizeReviewPacket,
      finalizeReviewPacket,
    ),
    issueReviewPacketOperatingReadiness: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.issueReviewPacketOperatingReadiness,
      issueReviewPacketOperatingReadiness,
    ),
    markReviewPacketMergeReady: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.markReviewPacketMergeReady,
      markReviewPacketMergeReady,
    ),
    persistArchitecturePacket: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.persistArchitecturePacket,
      persistArchitecturePacket,
    ),
    prepareReviewPacketFinalization: controlledMutation(
      DELIVERY_ART_MUTATION_OPERATIONS.prepareReviewPacketFinalization,
      prepareReviewPacketFinalization,
    ),
    projectReviewEvidence,
    resolveArtifact,
    resolveDependencies,
    validateArtifact,
  };
}
