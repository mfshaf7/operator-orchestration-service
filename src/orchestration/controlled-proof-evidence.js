import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ORCHESTRATION_API_PROCESS_ROLE,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../config.js";
import {
  assertControlledProofExecutionContext,
  assertControlledProofOwnerReceipt,
  controlledProofExecutionFor,
} from "./controlled-proof-contracts.js";
import { assertControlledProofRunProjection } from "./controlled-proof-run-projection.js";
import { canonicalRfc3339Timestamp } from "./timestamps.js";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_CONTEXT_BYTES = 64 * 1024;

export const CONTROLLED_PROOF_CONTEXT_PATH_KEY =
  "OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_PATH";
export const CONTROLLED_PROOF_CONTEXT_DIGEST_KEY =
  "OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_DIGEST";

export function resolveControlledProofContext(
  config,
  {
    allowExpired = false,
    now = new Date(),
    processRole = config?.orchestration?.processRole,
  } = {},
) {
  if (!config?.orchestration?.controlledProof?.enabled) {
    return unresolved(
      "disabled",
      "Controlled proof execution is disabled.",
    );
  }

  const loaded = loadPinnedContext(config);
  if (!loaded.valid) {
    return loaded;
  }

  try {
    const context = assertControlledProofExecutionContext(loaded.context, {
      allowExpired,
      now,
    });
    assertRuntimeTarget(context, config, processRole);
    assertSourceRevision(context, config);
    return {
      context,
      contextDigest: loaded.contextDigest,
      contextPath: loaded.contextPath,
      status: allowExpired
        ? "retained-context-verified"
        : "execution-context-verified",
      valid: true,
    };
  } catch (error) {
    return unresolved(
      "invalid-context",
      error instanceof Error
        ? error.message
        : "The controlled proof context is invalid.",
    );
  }
}

export function controlledProofContextRevocationReasons(
  config,
  expected,
  {
    allowExpired = false,
    now = new Date(),
    processRole = config?.orchestration?.processRole,
  } = {},
) {
  const current = resolveControlledProofContext(config, {
    allowExpired,
    now,
    processRole,
  });
  if (!current.valid) {
    return [current.reason];
  }

  const reasons = [];
  if (current.contextDigest !== expected.contextDigest) {
    reasons.push("controlled-proof-context-digest-changed");
  }
  if (current.context.context_id !== expected.contextId) {
    reasons.push("controlled-proof-context-id-changed");
  }
  if (
    current.context.authorization.authorization_digest !==
    expected.authorizationDigest
  ) {
    reasons.push("controlled-proof-authorization-changed");
  }
  if (
    current.context.commissioning_session.commissioning_session_id !==
    expected.commissioningSessionId
  ) {
    reasons.push("controlled-proof-session-changed");
  }
  return reasons;
}

export function createControlledProofOwnerReceipt({
  context,
  contextDigest,
  projection,
  recordedAt = projection?.completed_at,
}) {
  assertControlledProofExecutionContext(context, { allowExpired: true });
  assertControlledProofRunProjection(projection);
  if (projection.completed_at === null) {
    throw new TypeError(
      "A controlled proof owner receipt requires a terminal workflow projection.",
    );
  }
  const canonicalRecordedAt = canonicalRfc3339Timestamp(recordedAt);
  if (canonicalRecordedAt === null) {
    throw new TypeError("A controlled proof owner receipt requires recorded_at.");
  }

  const execution = controlledProofExecutionFor(
    context,
    projection.controlled_proof_execution.scenario_execution_id,
    { contextDigest },
  );
  if (
    canonicalJson(execution) !==
    canonicalJson(projection.controlled_proof_execution)
  ) {
    throw new TypeError(
      "The terminal workflow projection does not match the pinned controlled proof context.",
    );
  }

  const evidenceRefs = ownerReceiptEvidence({
    context,
    contextDigest,
    projection,
  });
  const receiptRef =
    `oos-controlled-proof://receipts/${encodeURIComponent(
      execution.commissioning_session_id,
    )}/${encodeURIComponent(execution.scenario_execution_id)}`;
  const unsigned = {
    owner_repo: "operator-orchestration-service",
    authorization_id: execution.authorization_id,
    authorization_digest: execution.authorization_digest,
    commissioning_session_id: execution.commissioning_session_id,
    scenario_id: execution.scenario_id,
    scenario_execution_id: execution.scenario_execution_id,
    owner_execution: {
      execution_type: "workflow",
      execution_id: projection.runtime.execution_run_id,
    },
    owner_result: ownerResultFor(projection),
    evidence_refs: evidenceRefs,
    receipt_ref: receiptRef,
    recorded_at: canonicalRecordedAt,
  };
  const receipt = {
    ...unsigned,
    receipt_digest: sha256Digest(canonicalJson(unsigned)),
  };
  assertControlledProofOwnerReceipt(receipt);
  return deepFreeze(receipt);
}

function loadPinnedContext(config) {
  const contextPath = normalize(
    config?.orchestration?.controlledProof?.contextPath,
  );
  const expectedDigest = normalize(
    config?.orchestration?.controlledProof?.contextDigest,
  );

  if (!contextPath) {
    return unresolved(
      "missing-path",
      "No controlled proof execution context is configured.",
    );
  }
  if (!DIGEST_PATTERN.test(expectedDigest)) {
    return unresolved(
      "invalid-digest",
      "The controlled proof execution context digest is missing or invalid.",
    );
  }

  try {
    const raw = readFileSync(contextPath);
    if (raw.byteLength === 0 || raw.byteLength > MAX_CONTEXT_BYTES) {
      return unresolved(
        "invalid-context",
        "The controlled proof execution context is empty or exceeds its size boundary.",
      );
    }
    const actualDigest = sha256Digest(raw);
    if (actualDigest !== expectedDigest) {
      return unresolved(
        "digest-mismatch",
        "The controlled proof execution context does not match its configured digest.",
      );
    }
    return {
      context: JSON.parse(raw.toString("utf8")),
      contextDigest: actualDigest,
      contextPath,
      valid: true,
    };
  } catch {
    return unresolved(
      "invalid-context",
      "The controlled proof execution context cannot be loaded.",
    );
  }
}

function assertRuntimeTarget(context, config, processRole) {
  const configured = config?.orchestration?.temporal;
  requireEqual(
    context.runtime.temporal_address,
    normalize(configured?.address),
    "The controlled proof Temporal address does not match this process.",
  );
  requireEqual(
    context.runtime.temporal_namespace,
    normalize(configured?.namespace),
    "The controlled proof Temporal namespace does not match this process.",
  );

  let expectedIdentity;
  if (processRole === ORCHESTRATION_API_PROCESS_ROLE) {
    expectedIdentity = context.runtime.api_identity;
  } else if (processRole === ORCHESTRATION_WORKER_PROCESS_ROLE) {
    expectedIdentity = context.runtime.workflow_worker_identity;
  } else {
    throw new Error("The controlled proof process role is unsupported.");
  }
  requireEqual(
    normalize(configured?.identity),
    expectedIdentity,
    "The controlled proof Temporal identity does not match this process role.",
  );
}

function assertSourceRevision(context, config) {
  requireEqual(
    normalize(config?.service?.gitCommit),
    context.source_revisions.operator_orchestration_service,
    "The running OOS revision does not match the controlled proof authorization.",
  );
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ownerReceiptEvidence({ context, contextDigest, projection }) {
  const projectionDigest = sha256Digest(canonicalJson(projection));
  const runKey = encodeURIComponent(projection.run_id);
  const evidence = [
    {
      artifact_ref: context.context_id,
      artifact_digest: contextDigest,
    },
    {
      artifact_ref: context.authorization.consumption_receipt_ref,
      artifact_digest: context.authorization.consumption_receipt_digest,
    },
    {
      artifact_ref: `oos-controlled-proof://runs/${runKey}/projection`,
      artifact_digest: projectionDigest,
    },
    ...(projection.scenario_evidence?.evidence_refs ?? []),
    ...projection.wgcf_evidence.receipt_refs.map((reference) => ({
      artifact_ref:
        `wgcf-controlled-proof://receipts/${encodeURIComponent(
          reference.receipt_id,
        )}`,
      artifact_digest: reference.digest,
    })),
    ...projection.wgcf_evidence.artifact_digests.map((digest, index) => ({
      artifact_ref:
        `wgcf-controlled-proof://runs/${runKey}/artifacts/${index + 1}`,
      artifact_digest: digest,
    })),
  ];
  const unique = new Map(
    evidence.map((entry) => [
      `${entry.artifact_ref}\u0000${entry.artifact_digest}`,
      entry,
    ]),
  );
  return [...unique.values()];
}

function ownerResultFor(projection) {
  if (projection.scenario_assertion.status === "passed") {
    return "passed";
  }
  if (projection.state === "cancelled") {
    return "cancelled";
  }
  if (projection.state === "blocked") {
    return "blocked";
  }
  if (
    projection.failure?.failure_type ===
    "WGCF_CONTROLLED_PROOF_IDENTITY_DENIED"
  ) {
    return "denied";
  }
  if (
    projection.failure?.failure_type === "WGCF_ACTIVITY_UNAVAILABLE" ||
    projection.wgcf_evidence.status_code === "unavailable"
  ) {
    return "unavailable";
  }
  return "failed";
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message);
  }
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unresolved(reason, message) {
  return {
    message,
    reason,
    valid: false,
  };
}
