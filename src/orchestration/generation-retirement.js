import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";

import { ORCHESTRATION_WORKER_PROCESS_ROLE } from "../config.js";
import { resolveActivationControlTarget } from "./activation-evidence.js";
import {
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
  GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION,
  GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  generationStartRegistryTaskQueueFor,
  generationStartRegistryWorkflowIdFor,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import {
  assertGenerationStartRegistryMatches,
} from "./generation-start-registry.js";
import { parseRfc3339Timestamp } from "./timestamps.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,255}$/;
const URI_PATTERN =
  /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/@+%-]{2,511}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_KEY_BYTES = 16 * 1024;
const MAX_DRAIN_OBSERVATION_AGE_MS = 300_000;
const MAX_RETIREMENT_LIFETIME_MS = 900_000;

export const RETIREMENT_EVIDENCE_PATH_KEY =
  "OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_PATH";
export const RETIREMENT_EVIDENCE_DIGEST_KEY =
  "OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_DIGEST";

export function resolveGenerationRetirement(config, { now = Date.now() } = {}) {
  const loaded = loadPinnedRetirementManifest(config);
  if (!loaded.valid) {
    return loaded;
  }

  const activationTarget = resolveActivationControlTarget(config, {
    now,
    processRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  if (!activationTarget.valid) {
    return unresolved(
      "invalid-activation-target",
      "The retired activation generation cannot be verified.",
    );
  }

  try {
    assertRetirementManifest(
      loaded.manifest,
      loaded.digest,
      activationTarget,
      config,
      now,
    );
    return {
      activationEvidenceDigest: activationTarget.digest,
      digest: loaded.digest,
      manifest: loaded.manifest,
      receiptVerification: loaded.manifest.receipt_verification,
      registrySealResume: loaded.manifest.registry_seal_resume,
      retirementId: loaded.manifest.retirement_id,
      startRegistry: loaded.manifest.start_registry,
      status: "verified",
      temporalTarget: loaded.manifest.temporal_target,
      valid: true,
      workflowTaskQueue: loaded.manifest.workflow_task_queue,
    };
  } catch {
    return unresolved(
      "invalid-manifest",
      "The generation-retirement manifest is invalid.",
    );
  }
}

export function createGenerationRetirementReceipt(
  config,
  retirement,
  {
    cancelSignalTargetCount,
    matchedExecutionCount,
    recordedAt = new Date().toISOString(),
    registryResult,
    registryResultDigest,
    retirementStartedAt,
    terminalProjectionCount,
    uncommittedRegistrationCount,
  },
  { attest = createGenerationRetirementReceiptAttestor(config, retirement) } = {},
) {
  if (!retirement?.valid) {
    throw new TypeError("Verified generation-retirement evidence is required.");
  }
  for (const [name, value] of Object.entries({
    cancelSignalTargetCount,
    matchedExecutionCount,
    terminalProjectionCount,
    uncommittedRegistrationCount,
  })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`Invalid generation-retirement receipt count: ${name}.`);
    }
  }
  const manifest = retirement.manifest;
  const registry = assertGenerationStartRegistryMatches(
    registryResult,
    retirement.activationEvidenceDigest,
  );
  if (!DIGEST_PATTERN.test(registryResultDigest)) {
    throw new TypeError(
      "The generation start registry result digest is invalid.",
    );
  }
  if (
    matchedExecutionCount + uncommittedRegistrationCount !==
      registry.registered_workflow_ids.length ||
    terminalProjectionCount !== matchedExecutionCount ||
    cancelSignalTargetCount > matchedExecutionCount
  ) {
    throw new TypeError(
      "Generation-retirement reconciliation counts are inconsistent.",
    );
  }
  const issuedAt = requireTimestamp(manifest.issued_at);
  const expiresAt = requireTimestamp(manifest.expires_at);
  const startedAt = requireTimestamp(retirementStartedAt);
  const completedAt = requireTimestamp(recordedAt);
  if (startedAt < issuedAt || startedAt >= expiresAt) {
    throw new TypeError(
      "Generation retirement must start within the authorized manifest lifetime.",
    );
  }
  if (completedAt < startedAt) {
    throw new TypeError(
      "Generation retirement completion must not precede its start.",
    );
  }
  assertGenerationStartRegistryAuthorization(
    retirement,
    registry,
    retirementStartedAt,
  );
  assertObservationFreshAtStart(
    manifest.start_ingress.observed_at,
    issuedAt,
    startedAt,
  );
  assertObservationFreshAtStart(
    manifest.workflow_poller.observed_at,
    issuedAt,
    startedAt,
  );

  const payload = {
    schema_version: 1,
    receipt_id:
      `receipt:generation-retirement:${retirement.digest.slice(7, 39)}`,
    retirement_id: manifest.retirement_id,
    retirement_started_at: retirementStartedAt,
    retirement_evidence_digest: retirement.digest,
    activation_evidence_digest: manifest.activation_evidence_digest,
    activation_manifest_ref: manifest.activation_manifest_ref,
    definition_id: manifest.definition_id,
    definition_version: manifest.definition_version,
    environment: manifest.environment,
    workflow_task_queue: manifest.workflow_task_queue,
    temporal_target: {
      address: manifest.temporal_target.address,
      namespace: manifest.temporal_target.namespace,
    },
    start_ingress_evidence_ref: manifest.start_ingress.evidence_ref,
    poller_evidence_ref: manifest.workflow_poller.evidence_ref,
    ordinary_poller_stopped: true,
    start_registry: {
      registration_update_id_scheme:
        registry.registration_update_id_scheme,
      workflow_id: registry.registry_id,
      workflow_type: registry.registry_workflow_type,
      task_queue: registry.registry_task_queue,
      seal_ref: registry.seal_ref,
      sealed_at: registry.sealed_at,
      result_digest: registryResultDigest,
      seal_authorization_digest: registry.seal_authorization_digest,
      registered_workflow_count: registry.registered_workflow_ids.length,
      matched_execution_count: matchedExecutionCount,
      uncommitted_registration_count: uncommittedRegistrationCount,
    },
    cancel_signal_target_count: cancelSignalTargetCount,
    terminal_projection_count: terminalProjectionCount,
    outcome: "retired",
    recorded_at: recordedAt,
  };
  return attest(payload);
}

export function createGenerationRetirementReceiptAttestor(
  config,
  retirement,
) {
  if (!retirement?.valid) {
    throw new TypeError("Verified generation-retirement evidence is required.");
  }
  const verification = retirement.receiptVerification;
  const attestationConfig =
    config?.orchestration?.retirementReceiptAttestation;
  requireObject(verification);
  requireEqual(verification.algorithm, "Ed25519");
  requireEqual(verification.issuer, "operator-orchestration-service");
  requireEqual(
    verification.canonicalization,
    GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION,
  );
  requireEqual(
    verification.signed_content,
    GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT,
  );
  requireIdentifier(verification.key_id);
  if (!DIGEST_PATTERN.test(verification.public_key_digest)) {
    throw new TypeError("The receipt public-key digest is invalid.");
  }
  requireEqual(attestationConfig?.keyId, verification.key_id);

  const publicKeyRaw = readBoundedKey(
    attestationConfig?.publicKeyPath,
    "public",
  );
  const publicKeyDigest =
    `sha256:${createHash("sha256").update(publicKeyRaw).digest("hex")}`;
  requireEqual(publicKeyDigest, verification.public_key_digest);
  const privateKeyRaw = readBoundedKey(
    attestationConfig?.privateKeyPath,
    "private",
  );
  const privateKey = createPrivateKey(privateKeyRaw);
  const publicKey = createPublicKey(publicKeyRaw);
  if (
    privateKey.asymmetricKeyType !== "ed25519" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError("The retirement receipt key pair must use Ed25519.");
  }
  const probe = Buffer.from("oos-generation-retirement-receipt-key-check");
  if (!verify(null, probe, publicKey, sign(null, probe, privateKey))) {
    throw new TypeError(
      "The configured retirement receipt keys do not form one key pair.",
    );
  }

  return (payload) => {
    const encodedPayload = encodeGenerationRetirementReceiptPayloadV1(payload);
    const signature = sign(null, encodedPayload, privateKey);
    return {
      ...payload,
      attestation: {
        algorithm: verification.algorithm,
        canonicalization: verification.canonicalization,
        issuer: verification.issuer,
        key_id: verification.key_id,
        payload_digest:
          `sha256:${createHash("sha256").update(encodedPayload).digest("hex")}`,
        signed_content: verification.signed_content,
        signature: signature.toString("base64"),
      },
    };
  };
}

export function assertGenerationStartRegistryAuthorization(
  retirement,
  registryResult,
  authorizationCheckedAt,
) {
  if (!retirement?.valid) {
    throw new TypeError("Verified generation-retirement evidence is required.");
  }
  const registry = assertGenerationStartRegistryMatches(
    registryResult,
    retirement.activationEvidenceDigest,
  );
  if (registry.seal_ref !== retirement.retirementId) {
    throw new TypeError(
      "The generation start registry seal does not match this retirement authorization.",
    );
  }
  const currentIssuedAt = requireTimestamp(retirement.manifest.issued_at);
  const currentExpiresAt = requireTimestamp(retirement.manifest.expires_at);
  const sealedAt = requireTimestamp(registry.sealed_at);
  const checkedAt = requireTimestamp(authorizationCheckedAt);
  let sealIssuedAt = currentIssuedAt;
  let sealExpiresAt = currentExpiresAt;
  if (registry.seal_authorization_digest !== retirement.digest) {
    const resume = retirement.registrySealResume;
    requireObject(resume);
    requireEqual(
      resume.retirement_evidence_digest,
      registry.seal_authorization_digest,
    );
    sealIssuedAt = requireTimestamp(resume.issued_at);
    sealExpiresAt = requireTimestamp(resume.expires_at);
  }
  if (
    sealedAt < sealIssuedAt ||
    sealedAt >= sealExpiresAt ||
    sealedAt > checkedAt ||
    checkedAt < currentIssuedAt ||
    checkedAt >= currentExpiresAt
  ) {
    throw new TypeError(
      "The generation start registry must be sealed inside this authorization before retirement starts.",
    );
  }
  return registry;
}

function loadPinnedRetirementManifest(config) {
  const manifestPath = normalize(
    config?.orchestration?.retirementEvidence?.manifestPath,
  );
  const expectedDigest = normalize(
    config?.orchestration?.retirementEvidence?.manifestDigest,
  );

  if (!manifestPath) {
    return unresolved(
      "missing-path",
      "No Platform-issued generation-retirement manifest is configured.",
    );
  }
  if (!expectedDigest) {
    return unresolved(
      "missing-digest",
      "No digest is configured for the generation-retirement manifest.",
    );
  }
  if (!DIGEST_PATTERN.test(expectedDigest)) {
    return unresolved(
      "invalid-digest",
      "The generation-retirement manifest digest is invalid.",
    );
  }

  try {
    const raw = readFileSync(manifestPath);
    if (raw.byteLength === 0 || raw.byteLength > MAX_MANIFEST_BYTES) {
      return unresolved(
        "invalid-manifest",
        "The generation-retirement manifest is invalid.",
      );
    }
    const actualDigest =
      `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    if (actualDigest !== expectedDigest) {
      return unresolved(
        "digest-mismatch",
        "The generation-retirement manifest does not match its configured digest.",
      );
    }
    return {
      digest: actualDigest,
      manifest: JSON.parse(raw.toString("utf8")),
      valid: true,
    };
  } catch {
    return unresolved(
      "invalid-manifest",
      "The generation-retirement manifest is invalid.",
    );
  }
}

function assertRetirementManifest(
  manifest,
  retirementDigest,
  activationTarget,
  config,
  now,
) {
  requireObject(manifest);
  requireExactFields(manifest, [
    "activation_evidence_digest",
    "activation_manifest_ref",
    "definition_id",
    "definition_version",
    "environment",
    "expires_at",
    "issued_at",
    "issued_by",
    "profile_id",
    "receipt_verification",
    "reason_ref",
    "registry_seal_resume",
    "retirement_id",
    "schema_version",
    "start_ingress",
    "start_registry",
    "temporal_target",
    "workflow_poller",
    "workflow_task_queue",
  ]);
  requireEqual(manifest.schema_version, 1);
  requireEqual(manifest.definition_id, VALIDATION_READINESS_DEFINITION_ID);
  requireEqual(
    manifest.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
  );
  requireEqual(manifest.environment, "dev-integration");
  requireEqual(manifest.profile_id, "temporal");
  requireEqual(manifest.issued_by, "platform-engineering");
  requireUri(manifest.retirement_id);
  requireUri(manifest.reason_ref);
  requireUri(manifest.activation_manifest_ref);
  requireEqual(manifest.activation_manifest_ref, activationTarget.manifestId);
  requireEqual(
    manifest.activation_evidence_digest,
    activationTarget.digest,
  );
  requireEqual(
    manifest.workflow_task_queue,
    validationReadinessWorkflowQueueFor(activationTarget.digest),
  );
  requireIdentifier(manifest.workflow_task_queue);
  if (!DIGEST_PATTERN.test(retirementDigest)) {
    throw new Error("retirement evidence digest is invalid");
  }

  const issuedAt = requireTimestamp(manifest.issued_at);
  const expiresAt = requireTimestamp(manifest.expires_at);
  if (
    issuedAt > now ||
    expiresAt <= issuedAt ||
    expiresAt <= now ||
    expiresAt - issuedAt > MAX_RETIREMENT_LIFETIME_MS
  ) {
    throw new Error("generation-retirement evidence is not current");
  }

  assertTemporalTarget(manifest.temporal_target, activationTarget, config);
  assertReceiptVerification(manifest.receipt_verification, config);
  assertRegistrySealResume(
    manifest.registry_seal_resume,
    retirementDigest,
  );
  assertStartIngress(manifest.start_ingress, issuedAt, now);
  assertStartRegistry(manifest.start_registry, activationTarget.digest);
  assertWorkflowPoller(manifest.workflow_poller, issuedAt, now);
}

function assertReceiptVerification(verification, config) {
  requireObject(verification);
  requireExactFields(verification, [
    "algorithm",
    "canonicalization",
    "issuer",
    "key_id",
    "public_key_digest",
    "signed_content",
  ]);
  requireEqual(verification.algorithm, "Ed25519");
  requireEqual(
    verification.canonicalization,
    GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION,
  );
  requireEqual(verification.issuer, "operator-orchestration-service");
  requireEqual(
    verification.signed_content,
    GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT,
  );
  requireIdentifier(verification.key_id);
  if (!DIGEST_PATTERN.test(verification.public_key_digest)) {
    throw new Error("receipt public-key digest is invalid");
  }
  requireEqual(
    verification.key_id,
    normalize(config?.orchestration?.retirementReceiptAttestation?.keyId),
  );
}

function assertRegistrySealResume(resume, retirementDigest) {
  if (resume === null) {
    return;
  }
  requireObject(resume);
  requireExactFields(resume, [
    "expires_at",
    "issued_at",
    "retirement_evidence_digest",
  ]);
  if (!DIGEST_PATTERN.test(resume.retirement_evidence_digest)) {
    throw new Error("registry seal resume digest is invalid");
  }
  const issuedAt = requireTimestamp(resume.issued_at);
  const expiresAt = requireTimestamp(resume.expires_at);
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_RETIREMENT_LIFETIME_MS ||
    resume.retirement_evidence_digest === retirementDigest
  ) {
    throw new Error("registry seal resume authorization is invalid");
  }
}

function assertStartRegistry(registry, activationEvidenceDigest) {
  requireObject(registry);
  requireExactFields(registry, [
    "registration_update_id_scheme",
    "task_queue",
    "workflow_id",
    "workflow_type",
  ]);
  requireEqual(
    registry.workflow_id,
    generationStartRegistryWorkflowIdFor(activationEvidenceDigest),
  );
  requireEqual(
    registry.workflow_type,
    GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  );
  requireEqual(
    registry.task_queue,
    generationStartRegistryTaskQueueFor(activationEvidenceDigest),
  );
  requireEqual(
    registry.registration_update_id_scheme,
    GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
  );
  requireIdentifier(registry.workflow_id);
  requireIdentifier(registry.task_queue);
}

function assertTemporalTarget(target, activationTarget, config) {
  requireObject(target);
  requireExactFields(target, [
    "address",
    "namespace",
    "workflow_worker_identity",
  ]);
  requireIdentifier(target.address);
  requireIdentifier(target.namespace);
  requireIdentifier(target.workflow_worker_identity);
  requireEqual(target.address, activationTarget.temporalTarget.address);
  requireEqual(target.namespace, activationTarget.temporalTarget.namespace);
  requireEqual(
    target.workflow_worker_identity,
    activationTarget.temporalTarget.identities.workflow_worker,
  );
  requireEqual(target.address, normalize(config?.orchestration?.temporal?.address));
  requireEqual(
    target.namespace,
    normalize(config?.orchestration?.temporal?.namespace),
  );
  requireEqual(
    target.workflow_worker_identity,
    normalize(config?.orchestration?.temporal?.identity),
  );
}

function assertStartIngress(evidence, issuedAt, startedAt) {
  requireObject(evidence);
  requireExactFields(evidence, [
    "active_replicas",
    "evidence_ref",
    "in_flight_starts",
    "observed_at",
    "state",
  ]);
  requireEqual(evidence.state, "drained");
  requireEqual(evidence.active_replicas, 0);
  requireEqual(evidence.in_flight_starts, 0);
  requireUri(evidence.evidence_ref);
  assertObservationFreshAtStart(evidence.observed_at, issuedAt, startedAt);
}

function assertWorkflowPoller(evidence, issuedAt, startedAt) {
  requireObject(evidence);
  requireExactFields(evidence, [
    "active_replicas",
    "evidence_ref",
    "observed_at",
    "state",
  ]);
  requireEqual(evidence.state, "drained");
  requireEqual(evidence.active_replicas, 0);
  requireUri(evidence.evidence_ref);
  assertObservationFreshAtStart(evidence.observed_at, issuedAt, startedAt);
}

function assertObservationFreshAtStart(value, issuedAt, startedAt) {
  const observedAt = requireTimestamp(value);
  if (observedAt > issuedAt) {
    throw new Error("retirement evidence observation follows issuance");
  }
  if (startedAt - observedAt > MAX_DRAIN_OBSERVATION_AGE_MS) {
    throw new Error("retirement evidence observation is stale at worker start");
  }
}

function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("object required");
  }
}

function requireExactFields(value, expectedFields) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("unexpected generation-retirement fields");
  }
}

function requireEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error("generation-retirement value mismatch");
  }
}

function requireIdentifier(value) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error("bounded identifier required");
  }
}

function requireUri(value) {
  if (typeof value !== "string" || !URI_PATTERN.test(value)) {
    throw new Error("bounded URI required");
  }
}

function requireTimestamp(value) {
  const timestamp = parseRfc3339Timestamp(value);
  if (timestamp === null || !value.endsWith("Z")) {
    throw new Error("UTC timestamp required");
  }
  return timestamp;
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoundedKey(pathValue, kind) {
  const path = normalize(pathValue);
  if (!path) {
    throw new TypeError(`The retirement receipt ${kind} key is not configured.`);
  }
  const raw = readFileSync(path);
  if (raw.byteLength === 0 || raw.byteLength > MAX_KEY_BYTES) {
    throw new TypeError(`The retirement receipt ${kind} key is invalid.`);
  }
  return raw;
}

export function encodeGenerationRetirementReceiptPayloadV1(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function canonicalJson(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        "Canonical retirement receipt numbers must be safe integers.",
      );
    }
    return String(value);
  }
  if (typeof value === "string") {
    requireCanonicalAscii(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        requireCanonicalAscii(key);
        return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
      })
      .join(",")}}`;
  }
  throw new TypeError("Unsupported canonical retirement receipt value.");
}

function requireCanonicalAscii(value) {
  if (!/^[\x20-\x7e]*$/.test(value)) {
    throw new TypeError(
      "Canonical retirement receipt strings must use printable ASCII.",
    );
  }
}

function unresolved(status, detail) {
  return {
    activationEvidenceDigest: null,
    detail,
    digest: null,
    manifest: null,
    receiptVerification: null,
    registrySealResume: null,
    retirementId: null,
    startRegistry: null,
    status,
    temporalTarget: null,
    valid: false,
    workflowTaskQueue: null,
  };
}
