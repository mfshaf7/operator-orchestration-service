import {
  GENERATION_RETIREMENT_MAX_AUTHORIZATION_LIFETIME_MS,
  GENERATION_START_REGISTRY_MAX_REGISTRATIONS,
  GENERATION_START_REGISTRY_UPDATE_ID_PREFIX,
  GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  generationStartRegistryTaskQueueFor,
  generationStartRegistryWorkflowIdFor,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import { parseRfc3339Timestamp } from "./timestamps.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^oos:validation-readiness-run:v1:[A-Za-z0-9._:/@+-]+$/;
const URI_PATTERN =
  /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/@+%-]{2,511}$/;

const INPUT_FIELDS = new Set([
  "activation_evidence_digest",
  "business_workflow_task_queue",
  "maximum_registration_count",
  "registration_update_id_scheme",
  "registry_id",
  "registry_task_queue",
  "schema_version",
]);
const REGISTRATION_FIELDS = new Set([
  "activation_evidence_digest",
  "schema_version",
  "workflow_id",
]);
const SEAL_FIELDS = new Set([
  "expires_at",
  "issued_at",
  "retirement_evidence_digest",
  "retirement_id",
  "schema_version",
]);
const RESULT_FIELDS = new Set([
  "activation_evidence_digest",
  "business_workflow_task_queue",
  "invalid_registration_count",
  "maximum_registration_count",
  "registration_update_id_scheme",
  "registered_workflow_ids",
  "registry_id",
  "registry_task_queue",
  "registry_workflow_type",
  "schema_version",
  "seal_ref",
  "seal_authorization_digest",
  "sealed_at",
]);

export function generationStartRegistryInputFor(activationEvidenceDigest) {
  requireDigest(activationEvidenceDigest, "activation_evidence_digest");
  return Object.freeze({
    activation_evidence_digest: activationEvidenceDigest,
    business_workflow_task_queue:
      validationReadinessWorkflowQueueFor(activationEvidenceDigest),
    maximum_registration_count:
      GENERATION_START_REGISTRY_MAX_REGISTRATIONS,
    registration_update_id_scheme:
      GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
    registry_id:
      generationStartRegistryWorkflowIdFor(activationEvidenceDigest),
    registry_task_queue:
      generationStartRegistryTaskQueueFor(activationEvidenceDigest),
    schema_version: 1,
  });
}

export function generationStartRegistrationFor(
  activationEvidenceDigest,
  workflowId,
) {
  return assertGenerationStartRegistration({
    activation_evidence_digest: activationEvidenceDigest,
    schema_version: 1,
    workflow_id: workflowId,
  });
}

export function generationStartRegistrationUpdateIdFor(
  activationEvidenceDigest,
  workflowId,
) {
  const registration = generationStartRegistrationFor(
    activationEvidenceDigest,
    workflowId,
  );
  return `${GENERATION_START_REGISTRY_UPDATE_ID_PREFIX}:${registration.workflow_id}`;
}

export function assertGenerationStartRegistrationUpdateId(
  candidate,
  updateId,
) {
  const registration = assertGenerationStartRegistration(candidate);
  if (
    updateId !==
    generationStartRegistrationUpdateIdFor(
      registration.activation_evidence_digest,
      registration.workflow_id,
    )
  ) {
    throw new TypeError(
      "The generation start registration update ID is invalid.",
    );
  }
  return registration;
}

export function assertGenerationStartRegistryInput(candidate) {
  requireObject(candidate, "generation start registry input");
  requireExactFields(candidate, INPUT_FIELDS, "generation start registry input");
  requireEqual(candidate.schema_version, 1, "schema_version");
  requireDigest(
    candidate.activation_evidence_digest,
    "activation_evidence_digest",
  );
  requireEqual(
    candidate.maximum_registration_count,
    GENERATION_START_REGISTRY_MAX_REGISTRATIONS,
    "maximum_registration_count",
  );
  requireEqual(
    candidate.registration_update_id_scheme,
    GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
    "registration_update_id_scheme",
  );
  requireEqual(
    candidate.business_workflow_task_queue,
    validationReadinessWorkflowQueueFor(candidate.activation_evidence_digest),
    "business_workflow_task_queue",
  );
  requireEqual(
    candidate.registry_id,
    generationStartRegistryWorkflowIdFor(candidate.activation_evidence_digest),
    "registry_id",
  );
  requireEqual(
    candidate.registry_task_queue,
    generationStartRegistryTaskQueueFor(candidate.activation_evidence_digest),
    "registry_task_queue",
  );
  return Object.freeze({ ...candidate });
}

export function assertGenerationStartRegistration(candidate) {
  requireObject(candidate, "generation start registration");
  requireExactFields(
    candidate,
    REGISTRATION_FIELDS,
    "generation start registration",
  );
  requireEqual(candidate.schema_version, 1, "schema_version");
  requireDigest(
    candidate.activation_evidence_digest,
    "activation_evidence_digest",
  );
  if (
    typeof candidate.workflow_id !== "string" ||
    !RUN_ID_PATTERN.test(candidate.workflow_id) ||
    candidate.workflow_id.length > 256
  ) {
    throw new TypeError("workflow_id must identify a bounded OOS durable run.");
  }
  return Object.freeze({ ...candidate });
}

export function assertGenerationStartRegistrySeal(candidate) {
  requireObject(candidate, "generation start registry seal");
  requireExactFields(candidate, SEAL_FIELDS, "generation start registry seal");
  requireEqual(candidate.schema_version, 1, "schema_version");
  requireUri(candidate.retirement_id, "retirement_id");
  requireDigest(
    candidate.retirement_evidence_digest,
    "retirement_evidence_digest",
  );
  const issuedAt = requireTimestamp(candidate.issued_at, "issued_at");
  const expiresAt = requireTimestamp(candidate.expires_at, "expires_at");
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt >
      GENERATION_RETIREMENT_MAX_AUTHORIZATION_LIFETIME_MS
  ) {
    throw new TypeError(
      "The generation start registry seal authorization lifetime is invalid.",
    );
  }
  return Object.freeze({ ...candidate });
}

export function assertGenerationStartRegistrySealAuthorizedAt(
  candidate,
  handledAt,
) {
  const seal = assertGenerationStartRegistrySeal(candidate);
  const handledAtTimestamp = requireTimestamp(handledAt, "handled_at");
  const issuedAt = parseRfc3339Timestamp(seal.issued_at);
  const expiresAt = parseRfc3339Timestamp(seal.expires_at);
  if (handledAtTimestamp < issuedAt || handledAtTimestamp >= expiresAt) {
    throw new TypeError(
      "The generation start registry seal authorization is not current.",
    );
  }
  return seal;
}

export function assertGenerationStartRegistryResult(candidate) {
  requireObject(candidate, "generation start registry result");
  requireExactFields(candidate, RESULT_FIELDS, "generation start registry result");
  const input = assertGenerationStartRegistryInput({
    activation_evidence_digest: candidate.activation_evidence_digest,
    business_workflow_task_queue: candidate.business_workflow_task_queue,
    maximum_registration_count: candidate.maximum_registration_count,
    registration_update_id_scheme:
      candidate.registration_update_id_scheme,
    registry_id: candidate.registry_id,
    registry_task_queue: candidate.registry_task_queue,
    schema_version: candidate.schema_version,
  });
  requireEqual(
    candidate.registry_workflow_type,
    GENERATION_START_REGISTRY_WORKFLOW_TYPE,
    "registry_workflow_type",
  );
  requireUri(candidate.seal_ref, "seal_ref");
  requireDigest(
    candidate.seal_authorization_digest,
    "seal_authorization_digest",
  );
  requireTimestamp(candidate.sealed_at, "sealed_at");
  if (
    !Number.isInteger(candidate.invalid_registration_count) ||
    candidate.invalid_registration_count < 0
  ) {
    throw new TypeError(
      "invalid_registration_count must be a non-negative integer.",
    );
  }
  if (!Array.isArray(candidate.registered_workflow_ids)) {
    throw new TypeError("registered_workflow_ids must be an array.");
  }
  const registrations = candidate.registered_workflow_ids.map((workflowId) =>
    assertGenerationStartRegistration({
      activation_evidence_digest: input.activation_evidence_digest,
      schema_version: 1,
      workflow_id: workflowId,
    }).workflow_id,
  );
  const canonical = [...new Set(registrations)].sort();
  if (canonical.length > input.maximum_registration_count) {
    throw new TypeError(
      "registered_workflow_ids exceeds the generation capacity.",
    );
  }
  if (JSON.stringify(registrations) !== JSON.stringify(canonical)) {
    throw new TypeError(
      "registered_workflow_ids must be unique and canonically sorted.",
    );
  }
  return Object.freeze({
    ...candidate,
    registered_workflow_ids: Object.freeze(canonical),
  });
}

export function assertGenerationStartRegistryMatches(
  result,
  activationEvidenceDigest,
) {
  const normalized = assertGenerationStartRegistryResult(result);
  const expected = generationStartRegistryInputFor(activationEvidenceDigest);
  for (const field of [
    "activation_evidence_digest",
    "business_workflow_task_queue",
    "maximum_registration_count",
    "registration_update_id_scheme",
    "registry_id",
    "registry_task_queue",
    "schema_version",
  ]) {
    requireEqual(normalized[field], expected[field], field);
  }
  if (normalized.invalid_registration_count !== 0) {
    throw new TypeError(
      "The generation start registry contains invalid registrations.",
    );
  }
  return normalized;
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function requireExactFields(value, expected, name) {
  const actualFields = Object.keys(value).sort();
  const expectedFields = [...expected].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    throw new TypeError(`${name} fields do not match the versioned contract.`);
  }
}

function requireEqual(actual, expected, name) {
  if (actual !== expected) {
    throw new TypeError(`${name} does not match the generation boundary.`);
  }
}

function requireDigest(value, name) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a SHA-256 digest.`);
  }
}

function requireUri(value, name) {
  if (typeof value !== "string" || !URI_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a bounded URI.`);
  }
}

function requireTimestamp(value, name) {
  const timestamp = parseRfc3339Timestamp(value);
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    timestamp === null
  ) {
    throw new TypeError(`${name} must be a canonical UTC timestamp.`);
  }
  return timestamp;
}
