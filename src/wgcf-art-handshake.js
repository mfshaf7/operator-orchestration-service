import { createMutationDraft } from "./art-workflow-artifacts.js";

export const WGCF_ART_HANDSHAKE_SCHEMA_VERSION = 1;
export const WGCF_SOURCE_SYSTEM = "workspace-governance-control-fabric";
export const WGCF_SOURCE_SYSTEM_ALIASES = new Set([
  WGCF_SOURCE_SYSTEM,
  "wgcf",
  "context-governance-gateway",
]);

export const RECOMMENDATION_ONLY_CALLER_IDS = new Set(
  WGCF_SOURCE_SYSTEM_ALIASES,
);

const ALLOWED_WGCF_DRAFT_OPERATIONS = new Set([
  "work-item.blocker",
  "work-item.complete",
  "work-item.create",
  "work-item.stale-open-close",
  "work-item.update",
]);

const DENIED_RAW_CONTEXT_KEYS = new Set([
  "artifact_body",
  "artifact_content",
  "context",
  "full_artifact",
  "full_output",
  "raw",
  "raw_artifact",
  "raw_context",
  "raw_output",
]);

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function normalizeOptionalObject(value, fieldName) {
  if (value === undefined || value === null) {
    return {};
  }
  assertPlainObject(value, fieldName);
  return value;
}

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredString(value, fieldName);
}

function normalizeSourceSystem(value) {
  const sourceSystem = normalizeRequiredString(value, "input.source_system");
  if (!WGCF_SOURCE_SYSTEM_ALIASES.has(sourceSystem)) {
    throw new Error(
      `input.source_system must be ${WGCF_SOURCE_SYSTEM}, wgcf, or context-governance-gateway`,
    );
  }
  return WGCF_SOURCE_SYSTEM;
}

function normalizeSourceReceipt(value, fieldName) {
  assertPlainObject(value, fieldName);
  return {
    digest: normalizeRequiredString(value.digest, `${fieldName}.digest`),
    kind: normalizeRequiredString(value.kind, `${fieldName}.kind`),
    produced_at: normalizeOptionalString(value.produced_at, `${fieldName}.produced_at`),
    ref: normalizeRequiredString(value.ref, `${fieldName}.ref`),
  };
}

function normalizeReviewPacketRefs(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("input.review_packet_refs must be an array");
  }
  return value.map((entry, index) =>
    normalizeSourceReceipt(entry, `input.review_packet_refs[${index}]`),
  );
}

function findDeniedRawContextPath(value, path = "input") {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findDeniedRawContextPath(value[index], `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase();
    if (DENIED_RAW_CONTEXT_KEYS.has(normalizedKey)) {
      return `${path}.${key}`;
    }
    const nested = findDeniedRawContextPath(entry, `${path}.${key}`);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeDraftRequest(input) {
  const draftInput = normalizeOptionalObject(input.draft, "input.draft");
  const operation = normalizeRequiredString(
    draftInput.operation ?? input.operation,
    "input.draft.operation",
  );
  if (!ALLOWED_WGCF_DRAFT_OPERATIONS.has(operation)) {
    throw new Error(
      `input.draft.operation is not allowed for WGCF handoff: ${operation}`,
    );
  }

  return {
    operation,
    payloadInput: normalizeOptionalObject(
      draftInput.payload_input ?? input.payload_input,
      "input.draft.payload_input",
    ),
    targetId: normalizeOptionalString(
      draftInput.target_id ?? input.target_id,
      "input.draft.target_id",
    ),
  };
}

function normalizeRecommendation(value) {
  const recommendation = normalizeOptionalObject(value, "input.recommendation");
  if (Object.keys(recommendation).length === 0) {
    return null;
  }

  return {
    action: normalizeRequiredString(
      recommendation.action,
      "input.recommendation.action",
    ),
    reason: normalizeRequiredString(
      recommendation.reason,
      "input.recommendation.reason",
    ),
    severity: normalizeOptionalString(
      recommendation.severity,
      "input.recommendation.severity",
    ),
  };
}

export function createWgcfMutationDraft({
  createdAt = new Date().toISOString(),
  input,
  operator = null,
} = {}) {
  assertPlainObject(input, "input");
  if (input.schema_version !== WGCF_ART_HANDSHAKE_SCHEMA_VERSION) {
    throw new Error(
      `input.schema_version must equal ${WGCF_ART_HANDSHAKE_SCHEMA_VERSION}`,
    );
  }

  const deniedPath = findDeniedRawContextPath(input);
  if (deniedPath) {
    throw new Error(
      `${deniedPath} is not allowed in the WGCF handoff; pass durable refs and digests only`,
    );
  }

  const sourceSystem = normalizeSourceSystem(input.source_system);
  const receipt = normalizeSourceReceipt(input.receipt, "input.receipt");
  const reviewPacketRefs = normalizeReviewPacketRefs(input.review_packet_refs);
  const draftRequest = normalizeDraftRequest(input);
  const recommendation = normalizeRecommendation(input.recommendation);

  const draft = createMutationDraft({
    createdAt,
    operation: draftRequest.operation,
    operator,
    targetId: draftRequest.targetId,
  });

  draft.payload = {
    ...draft.payload,
    input: {
      ...(draft.payload?.input ?? {}),
      ...draftRequest.payloadInput,
    },
  };
  draft.governance = {
    broker_submit_required: true,
    direct_mutation_allowed: false,
    mutation_authority: "operator-orchestration-service",
    source_authority: "recommendation_only",
  };
  draft.source = {
    receipt,
    recommendation,
    review_packet_refs: reviewPacketRefs,
    source_system: sourceSystem,
  };

  return {
    authority: {
      broker_submit_required: true,
      direct_mutation_allowed: false,
      mutation_authority: "operator-orchestration-service",
      source_authority: "recommendation_only",
      source_system: sourceSystem,
    },
    mutation_draft: draft,
    receipt_refs: [receipt, ...reviewPacketRefs],
    workflow_id: "delivery-art-wgcf-mutation-draft-create",
  };
}

export function assertCallerCanPerformDeliveryMutation(callerId) {
  if (RECOMMENDATION_ONLY_CALLER_IDS.has(String(callerId || "").trim())) {
    throw new Error(
      "workspace-governance-control-fabric is recommendation-only for ART; use /v1/delivery-art/wgcf/mutation-drafts and submit the resulting draft through an OOS-authorized operator path",
    );
  }
}
