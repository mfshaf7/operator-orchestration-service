import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ORCHESTRATION_API_PROCESS_ROLE,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../config.js";
import {
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
} from "./constants.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,255}$/;
const URI_PATTERN =
  /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/@+%-]{2,511}$/;
const MAX_MANIFEST_BYTES = 64 * 1024;

export const ACTIVATION_EVIDENCE_PATH_KEY =
  "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH";
export const ACTIVATION_EVIDENCE_DIGEST_KEY =
  "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST";

export const ACTIVATION_EVIDENCE_GATES = Object.freeze([
  evidenceGate("contract-valid", "workspace-governance"),
  evidenceGate("implementation-reviewed", "operator-orchestration-service"),
  evidenceGate(
    "deterministic-replay-tested",
    "operator-orchestration-service",
  ),
  evidenceGate(
    "activity-idempotency-tested",
    "workspace-governance-control-fabric",
  ),
  evidenceGate(
    "failure-and-control-tested",
    "operator-orchestration-service",
  ),
  evidenceGate("dev-integration-profile-active", "platform-engineering"),
  evidenceGate("platform-runtime-accepted", "platform-engineering"),
  evidenceGate("security-review-accepted", "security-architecture"),
  evidenceGate(
    "source-projection-verified",
    "workspace-governance-control-fabric",
  ),
  evidenceGate("rollback-and-suspension-proven", "platform-engineering"),
]);

export function resolveActivationEvidence(
  config,
  {
    now = Date.now(),
    processRole = config?.orchestration?.processRole,
  } = {},
) {
  const loaded = loadPinnedManifest(config);
  if (!loaded.valid) {
    return loaded;
  }

  try {
    assertManifestEnvelope(loaded.manifest, config, processRole);
    const evidence = assertCurrentEvidence(
      loaded.manifest,
      loaded.manifestPath,
      now,
    );
    return {
      digest: loaded.digest,
      evidence,
      manifestId: loaded.manifest.manifest_id,
      status: "verified",
      temporalTarget: loaded.manifest.temporal_target,
      valid: true,
    };
  } catch {
    return unresolved(
      "invalid-manifest",
      "The activation evidence manifest is invalid.",
    );
  }
}

export function resolveActivationTarget(
  config,
  { processRole = config?.orchestration?.processRole } = {},
) {
  const loaded = loadPinnedManifest(config);
  if (!loaded.valid) {
    return loaded;
  }

  try {
    assertManifestEnvelope(loaded.manifest, config, processRole);
    return {
      digest: loaded.digest,
      evidence: null,
      manifestId: loaded.manifest.manifest_id,
      status: "target-verified",
      temporalTarget: loaded.manifest.temporal_target,
      valid: true,
    };
  } catch {
    return unresolved(
      "invalid-target",
      "The activation evidence does not admit this Temporal process target.",
    );
  }
}

function loadPinnedManifest(config) {
  const manifestPath = normalize(
    config?.orchestration?.activationEvidence?.manifestPath,
  );
  const expectedDigest = normalize(
    config?.orchestration?.activationEvidence?.manifestDigest,
  );

  if (!manifestPath) {
    return unresolved(
      "missing-path",
      "No Platform-issued activation evidence manifest is configured.",
    );
  }
  if (!expectedDigest) {
    return unresolved(
      "missing-digest",
      "No digest is configured for the activation evidence manifest.",
    );
  }
  if (!DIGEST_PATTERN.test(expectedDigest)) {
    return unresolved(
      "invalid-digest",
      "The activation evidence manifest digest is invalid.",
    );
  }

  try {
    const raw = readFileSync(manifestPath);
    if (raw.byteLength === 0 || raw.byteLength > MAX_MANIFEST_BYTES) {
      return unresolved(
        "invalid-manifest",
        "The activation evidence manifest is invalid.",
      );
    }

    const actualDigest =
      `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    if (actualDigest !== expectedDigest) {
      return unresolved(
        "digest-mismatch",
        "The activation evidence manifest does not match its configured digest.",
      );
    }

    const manifest = JSON.parse(raw.toString("utf8"));
    return {
      digest: actualDigest,
      manifest,
      manifestPath,
      valid: true,
    };
  } catch {
    return unresolved(
      "invalid-manifest",
      "The activation evidence manifest is invalid.",
    );
  }
}

function evidenceGate(gateId, owner) {
  return Object.freeze({ gateId, owner });
}

function assertManifestEnvelope(manifest, config, processRole) {
  requireObject(manifest);
  requireExactFields(manifest, [
    "decision",
    "decision_ref",
    "definition_id",
    "definition_version",
    "environment",
    "evidence",
    "expires_at",
    "issued_at",
    "issued_by",
    "manifest_id",
    "profile_id",
    "profile_lifecycle",
    "schema_version",
    "temporal_target",
  ]);
  requireEqual(manifest.schema_version, 1);
  requireEqual(manifest.definition_id, VALIDATION_READINESS_DEFINITION_ID);
  requireEqual(
    manifest.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
  );
  requireEqual(manifest.environment, "dev-integration");
  requireEqual(manifest.profile_id, "temporal");
  requireEqual(manifest.profile_lifecycle, "active");
  requireEqual(manifest.issued_by, "platform-engineering");
  requireEqual(manifest.decision, "accepted");
  requireUri(manifest.manifest_id);
  requireUri(manifest.decision_ref);
  requireTemporalTarget(manifest.temporal_target, config, processRole);

  requireTimestamp(manifest.issued_at);
  requireTimestamp(manifest.expires_at);
  requireObject(manifest.evidence);
  requireExactFields(
    manifest.evidence,
    ACTIVATION_EVIDENCE_GATES.map((entry) => entry.gateId),
  );
}

function assertCurrentEvidence(manifest, manifestPath, now) {
  const issuedAt = requireTimestamp(manifest.issued_at);
  const expiresAt = requireTimestamp(manifest.expires_at);
  if (issuedAt > now || expiresAt <= issuedAt || expiresAt <= now) {
    throw new Error("activation evidence is not currently valid");
  }

  const resolvedEvidence = {};
  for (const { gateId, owner } of ACTIVATION_EVIDENCE_GATES) {
    resolvedEvidence[gateId] = resolveEvidenceRecord(
      manifestPath,
      gateId,
      owner,
      manifest.evidence[gateId],
    );
  }
  return resolvedEvidence;
}

function requireTemporalTarget(target, config, processRole) {
  requireObject(target);
  requireExactFields(target, ["address", "identities", "namespace"]);
  requireIdentifier(target.address);
  requireIdentifier(target.namespace);
  requireObject(target.identities);
  requireExactFields(target.identities, ["api", "workflow_worker"]);
  requireIdentifier(target.identities.api);
  requireIdentifier(target.identities.workflow_worker);

  const configured = config?.orchestration?.temporal;
  requireEqual(target.address, normalize(configured?.address));
  requireEqual(target.namespace, normalize(configured?.namespace));
  requireEqual(
    normalize(configured?.identity),
    identityForProcessRole(target.identities, processRole),
  );
}

function identityForProcessRole(identities, processRole) {
  if (processRole === ORCHESTRATION_API_PROCESS_ROLE) {
    return identities.api;
  }
  if (processRole === ORCHESTRATION_WORKER_PROCESS_ROLE) {
    return identities.workflow_worker;
  }
  throw new Error("unsupported orchestration process role");
}

function resolveEvidenceRecord(manifestPath, gateId, owner, pointer) {
  requireObject(pointer);
  requireExactFields(pointer, ["artifact_digest", "artifact_path"]);
  const expectedPath = `records/${gateId}.json`;
  requireEqual(pointer.artifact_path, expectedPath);
  if (!DIGEST_PATTERN.test(pointer.artifact_digest)) {
    throw new Error("evidence digest is invalid");
  }

  const raw = readFileSync(join(dirname(manifestPath), expectedPath));
  if (raw.byteLength === 0 || raw.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("evidence record is invalid");
  }
  const actualDigest =
    `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  requireEqual(actualDigest, pointer.artifact_digest);

  const record = JSON.parse(raw.toString("utf8"));
  requireObject(record);
  requireExactFields(record, [
    "gate_id",
    "outcome",
    "owner",
    "record_ref",
    "schema_version",
    "source_version",
  ]);
  requireEqual(record.schema_version, 1);
  requireEqual(record.gate_id, gateId);
  requireEqual(record.owner, owner);
  requireEqual(record.outcome, "accepted");
  requireUri(record.record_ref);
  requireIdentifier(record.source_version);
  return record;
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
    throw new Error("unexpected manifest fields");
  }
}

function requireEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error("manifest value mismatch");
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
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error("UTC timestamp required");
  }
  return Date.parse(value);
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unresolved(status, detail) {
  return {
    detail,
    digest: null,
    evidence: null,
    manifestId: null,
    status,
    temporalTarget: null,
    valid: false,
  };
}
