export const ORCHESTRATION_SCHEMA_VERSION = 1;

export const VALIDATION_READINESS_DEFINITION_ID =
  "validation-readiness-run";
export const VALIDATION_READINESS_DEFINITION_VERSION = 1;
export const VALIDATION_READINESS_WORKFLOW_TYPE =
  "validationReadinessRunV1";
export const VALIDATION_READINESS_WORKFLOW_QUEUE_PREFIX =
  "oos.validation-readiness-run.v1";
export const VALIDATION_READINESS_ACTIVITY_NAME =
  "wgcf.validation-readiness.evaluate";
export const VALIDATION_READINESS_ACTIVITY_QUEUE =
  "wgcf.validation-readiness.v1";
export const VALIDATION_READINESS_EXPECTED_RECEIPT =
  "orchestration-validation-readiness-receipt";
export const VALIDATION_READINESS_RETURN_PROJECTION =
  "oos.validation-readiness-run.v1";
export const VALIDATION_READINESS_REQUEST_TYPE =
  "validation-readiness";
export const VALIDATION_READINESS_SOURCE_DOMAIN =
  "workspace-governance-control-fabric";
export const VALIDATION_READINESS_VALIDATION_SCOPE =
  "component:workspace-governance";
export const VALIDATION_READINESS_TARGET =
  "repo:workspace-governance-control-fabric";
export const VALIDATION_READINESS_PROFILE = "local-read-only";
export const VALIDATION_READINESS_TIER = "smoke";
export const VALIDATION_READINESS_API_CALLER_ID =
  "governance-operations-console";
export const VALIDATION_READINESS_ACTIVITY_CALLER_ID =
  "operator-orchestration-service";
export const VALIDATION_READINESS_NODE_ID =
  "wgcf-validation-readiness";
export const VALIDATION_READINESS_MAX_MANUAL_ATTEMPTS = 3;

export const RUN_PROJECTION_QUERY = "oos.run.projection.v1";
export const RUN_CONTROL_SIGNAL = "oos.run.control.v1";
export const RUN_BINDING_MEMO_KEY = "oos.run.binding.v1";

export const GENERATION_START_REGISTRY_WORKFLOW_TYPE =
  "generationStartRegistryV1";
export const GENERATION_START_REGISTRY_QUEUE_PREFIX =
  "oos.generation-start-registry.v1";
export const GENERATION_START_REGISTRY_WORKFLOW_ID_PREFIX =
  "oos:generation-start-registry:v1";
export const GENERATION_START_REGISTRY_REGISTER_UPDATE =
  "oos.generation-start-registry.register.v1";
export const GENERATION_START_REGISTRY_UPDATE_ID_SCHEME =
  "business-workflow-id-prefixed-v1";
export const GENERATION_START_REGISTRY_UPDATE_ID_PREFIX =
  "oos:generation-start-registration:v1";
export const GENERATION_START_REGISTRY_SEAL_SIGNAL =
  "oos.generation-start-registry.seal.v1";
export const GENERATION_START_REGISTRY_MAX_REGISTRATIONS = 512;

export const GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION =
  "oos-canonical-json-v1";
export const GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT =
  "receipt-without-attestation";

export const ORCHESTRATION_RUN_STATES = Object.freeze([
  "queued",
  "running",
  "waiting",
  "blocked",
  "failed",
  "completed",
  "cancelled",
]);

export const ORCHESTRATION_CONTROL_ACTIONS = Object.freeze([
  "retry",
  "resume",
  "signal",
  "cancel",
  "defer",
]);

export const WGCF_TERMINAL_STATUS_CODES = Object.freeze([
  "ready",
  "blocked",
  "timed-out",
  "unavailable",
]);

export const WGCF_RETRYABLE_FAILURE_TYPES = Object.freeze([
  "WGCF_ACTIVITY_RETRYABLE",
  "WGCF_ACTIVITY_TIMED_OUT",
  "WGCF_ACTIVITY_UNAVAILABLE",
]);

export const WGCF_NON_RETRYABLE_FAILURE_TYPES = Object.freeze([
  "WGCF_CONTRACT_REJECTED",
  "WGCF_IDEMPOTENCY_CONFLICT",
]);

export const WGCF_CANCELLED_FAILURE_TYPE = "WGCF_ACTIVITY_CANCELLED";

const ACTIVATION_EVIDENCE_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;

export function validationReadinessWorkflowQueueFor(
  activationEvidenceDigest,
) {
  return `${VALIDATION_READINESS_WORKFLOW_QUEUE_PREFIX}.${activationDigestHex(
    activationEvidenceDigest,
  )}`;
}

export function generationStartRegistryTaskQueueFor(
  activationEvidenceDigest,
) {
  return `${GENERATION_START_REGISTRY_QUEUE_PREFIX}.${activationDigestHex(
    activationEvidenceDigest,
  )}`;
}

export function generationStartRegistryWorkflowIdFor(
  activationEvidenceDigest,
) {
  return `${GENERATION_START_REGISTRY_WORKFLOW_ID_PREFIX}:${activationDigestHex(
    activationEvidenceDigest,
  )}`;
}

export function isValidationReadinessWorkflowQueue(candidate) {
  return (
    typeof candidate === "string" &&
    candidate.startsWith(`${VALIDATION_READINESS_WORKFLOW_QUEUE_PREFIX}.`) &&
    /^[0-9a-f]{64}$/.test(
      candidate.slice(VALIDATION_READINESS_WORKFLOW_QUEUE_PREFIX.length + 1),
    )
  );
}

function activationDigestHex(activationEvidenceDigest) {
  const match = ACTIVATION_EVIDENCE_DIGEST_PATTERN.exec(
    activationEvidenceDigest,
  );
  if (!match) {
    throw new TypeError(
      "A valid activation evidence digest is required to derive a generation boundary.",
    );
  }
  return match[1];
}
