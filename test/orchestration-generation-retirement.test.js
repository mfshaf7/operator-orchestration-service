import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import {
  createGenerationRetirementReceipt,
  resolveGenerationRetirement,
} from "../src/orchestration/generation-retirement.js";
import {
  orchestrationRetirementEnvForManifest,
  validGenerationStartRegistryResult,
  validOrchestrationActivationEnv,
  validOrchestrationRetirementEnv,
  validOrchestrationRetirementManifest,
} from "../test-fixtures/orchestration.js";

const RETIREMENT_START = Date.parse("2026-07-31T12:01:00.000Z");

test("Platform retirement evidence admits one exact drained generation", () => {
  const retirement = resolveGenerationRetirement(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    { now: RETIREMENT_START },
  );

  assert.equal(retirement.valid, true);
  assert.equal(retirement.status, "verified");
  assert.match(retirement.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    retirement.workflowTaskQueue,
    retirement.manifest.workflow_task_queue,
  );
  assertMatchesPublishedSchema(
    retirement.manifest,
    "generation-retirement-manifest.schema.json",
  );
});

test("retirement evidence is denied without both pinned configuration values", () => {
  const missing = resolveGenerationRetirement(
    loadWorkerConfig(validOrchestrationActivationEnv()),
  );
  assert.equal(missing.valid, false);
  assert.equal(missing.status, "missing-path");

  const env = validOrchestrationRetirementEnv({
    OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_DIGEST: "",
  });
  const missingDigest = resolveGenerationRetirement(loadWorkerConfig(env));
  assert.equal(missingDigest.valid, false);
  assert.equal(missingDigest.status, "missing-digest");
});

test("retirement evidence rejects changed bytes after digest pinning", () => {
  const env = validOrchestrationRetirementEnv();
  appendFileSync(
    env.OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_PATH,
    "tampered",
    "utf8",
  );

  const retirement = resolveGenerationRetirement(loadWorkerConfig(env));
  assert.equal(retirement.valid, false);
  assert.equal(retirement.status, "digest-mismatch");
});

test("retirement evidence rejects non-quiesced ingress and ordinary pollers", () => {
  for (const mutate of [
    (manifest) => { manifest.start_ingress.state = "active"; },
    (manifest) => { manifest.start_ingress.active_replicas = 1; },
    (manifest) => { manifest.start_ingress.in_flight_starts = 1; },
    (manifest) => { manifest.workflow_poller.state = "active"; },
    (manifest) => { manifest.workflow_poller.active_replicas = 1; },
  ]) {
    assertInvalidManifest(mutate);
  }
});

test("retirement evidence rejects a mismatched generation, queue, or target", () => {
  for (const mutate of [
    (manifest) => {
      manifest.activation_evidence_digest = `sha256:${"f".repeat(64)}`;
    },
    (manifest) => { manifest.workflow_task_queue += ".other"; },
    (manifest) => { manifest.start_registry.task_queue += ".other"; },
    (manifest) => { manifest.start_registry.workflow_id += ".other"; },
    (manifest) => { manifest.temporal_target.namespace = "other"; },
    (manifest) => {
      manifest.temporal_target.workflow_worker_identity = "other-worker";
    },
    (manifest) => { manifest.issued_by = "operator-orchestration-service"; },
    (manifest) => {
      manifest.activation_manifest_ref =
        "platform-engineering://activation/other";
    },
  ]) {
    assertInvalidManifest(mutate);
  }
});

test("retirement evidence rejects expired, future, and post-issuance observations", () => {
  assertInvalidManifest((manifest) => {
    manifest.issued_at = "2026-01-01T00:00:00.000Z";
    manifest.expires_at = "2026-01-02T00:00:00.000Z";
  });
  assertInvalidManifest((manifest) => {
    manifest.issued_at = "2098-01-01T00:00:00.000Z";
  });
  assertInvalidManifest((manifest) => {
    manifest.start_ingress.observed_at = "2026-08-01T00:00:00.000Z";
  });
});

test("retirement evidence rejects drain observations stale at worker start", () => {
  assertInvalidManifest((manifest) => {
    manifest.start_ingress.observed_at = "2026-07-31T11:55:59.000Z";
  });
});

test("retirement receipt binds the exact authorization and drain evidence", () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: RETIREMENT_START },
  );
  const receipt = createGenerationRetirementReceipt(config, retirement, {
    cancelSignalTargetCount: 1,
    matchedExecutionCount: 1,
    recordedAt: "2026-07-31T12:02:00.000Z",
    registryResult: validGenerationStartRegistryResult(
      undefined,
      retirement.activationEvidenceDigest,
      retirement.digest,
    ),
    registryResultDigest: `sha256:${"c".repeat(64)}`,
    retirementStartedAt: "2026-07-31T12:01:00.000Z",
    terminalProjectionCount: 1,
    uncommittedRegistrationCount: 0,
  });

  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.ordinary_poller_stopped, true);
  assert.equal(receipt.retirement_evidence_digest, retirement.digest);
  assert.equal(
    receipt.activation_evidence_digest,
    retirement.activationEvidenceDigest,
  );
  assert.equal(receipt.cancel_signal_target_count, 1);
  assert.equal(receipt.terminal_projection_count, 1);
  assert.equal(receipt.start_registry.registered_workflow_count, 1);
  assert.equal(receipt.start_registry.matched_execution_count, 1);
  assert.equal(receipt.start_registry.uncommitted_registration_count, 0);
  assert.equal(receipt.retirement_started_at, "2026-07-31T12:01:00.000Z");
  const payload = { ...receipt };
  delete payload.attestation;
  const encodedPayload = Buffer.from(canonicalJson(payload));
  assert.equal(
    receipt.attestation.payload_digest,
    `sha256:${createHash("sha256").update(encodedPayload).digest("hex")}`,
  );
  assert.equal(
    verify(
      null,
      encodedPayload,
      createPublicKey(
        readFileSync(
          config.orchestration.retirementReceiptAttestation.publicKeyPath,
        ),
      ),
      Buffer.from(receipt.attestation.signature, "base64"),
    ),
    true,
  );
  assertMatchesPublishedSchema(
    receipt,
    "generation-retirement-receipt.schema.json",
  );
});

test("retirement receipt requires a start inside the manifest lifetime", () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: RETIREMENT_START },
  );
  const receiptInput = {
    cancelSignalTargetCount: 0,
    matchedExecutionCount: 0,
    recordedAt: "2026-07-31T12:20:00.000Z",
    registryResult: validGenerationStartRegistryResult(
      [],
      retirement.activationEvidenceDigest,
      retirement.digest,
    ),
    registryResultDigest: `sha256:${"c".repeat(64)}`,
    retirementStartedAt: retirement.manifest.expires_at,
    terminalProjectionCount: 0,
    uncommittedRegistrationCount: 0,
  };

  assert.throws(
    () => createGenerationRetirementReceipt(config, retirement, receiptInput),
    /must start within the authorized manifest lifetime/,
  );
});

test("retirement receipt rejects a registry sealed by another authorization", () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: RETIREMENT_START },
  );
  const registryResult = {
    ...validGenerationStartRegistryResult(
      [],
      retirement.activationEvidenceDigest,
      retirement.digest,
    ),
    seal_ref:
      "platform-engineering://retirement/validation-readiness-run/v1/dev-integration/other",
  };

  assert.throws(
    () =>
      createGenerationRetirementReceipt(config, retirement, {
        cancelSignalTargetCount: 0,
        matchedExecutionCount: 0,
        recordedAt: "2026-07-31T12:02:00.000Z",
        registryResult,
        registryResultDigest: `sha256:${"c".repeat(64)}`,
        retirementStartedAt: "2026-07-31T12:01:00.000Z",
        terminalProjectionCount: 0,
        uncommittedRegistrationCount: 0,
      }),
    /seal does not match this retirement authorization/,
  );
});

test("retirement receipt rejects a registry sealed before authorization", () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: RETIREMENT_START },
  );
  const registryResult = {
    ...validGenerationStartRegistryResult(
      [],
      retirement.activationEvidenceDigest,
      retirement.digest,
    ),
    sealed_at: "2026-07-31T11:59:59.000Z",
  };

  assert.throws(
    () =>
      createGenerationRetirementReceipt(config, retirement, {
        cancelSignalTargetCount: 0,
        matchedExecutionCount: 0,
        recordedAt: "2026-07-31T12:02:00.000Z",
        registryResult,
        registryResultDigest: `sha256:${"c".repeat(64)}`,
        retirementStartedAt: "2026-07-31T12:01:00.000Z",
        terminalProjectionCount: 0,
        uncommittedRegistrationCount: 0,
      }),
    /sealed inside this authorization/,
  );
});

test("retirement receipt permits an authorized drain to finish after expiry", () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: RETIREMENT_START },
  );

  const receipt = createGenerationRetirementReceipt(config, retirement, {
    cancelSignalTargetCount: 0,
    matchedExecutionCount: 0,
    recordedAt: "2026-07-31T12:20:00.000Z",
    registryResult: validGenerationStartRegistryResult(
      [],
      retirement.activationEvidenceDigest,
      retirement.digest,
    ),
    registryResultDigest: `sha256:${"c".repeat(64)}`,
    retirementStartedAt: "2026-07-31T12:01:00.000Z",
    terminalProjectionCount: 0,
    uncommittedRegistrationCount: 0,
  });

  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.recorded_at, "2026-07-31T12:20:00.000Z");
});

test("refreshed retirement evidence resumes an earlier authorized registry seal", () => {
  const activationEnv = validOrchestrationActivationEnv();
  const activationDigest =
    activationEnv.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST;
  const initialManifest = validOrchestrationRetirementManifest(
    activationDigest,
  );
  const initialConfig = loadWorkerConfig(
    orchestrationRetirementEnvForManifest(initialManifest, activationEnv),
  );
  const initialRetirement = resolveGenerationRetirement(initialConfig, {
    now: RETIREMENT_START,
  });
  assert.equal(initialRetirement.valid, true);

  const refreshedManifest = validOrchestrationRetirementManifest(
    activationDigest,
  );
  refreshedManifest.issued_at = "2026-07-31T12:16:00.000Z";
  refreshedManifest.expires_at = "2026-07-31T12:30:00.000Z";
  refreshedManifest.start_ingress.observed_at =
    "2026-07-31T12:15:00.000Z";
  refreshedManifest.workflow_poller.observed_at =
    "2026-07-31T12:15:30.000Z";
  refreshedManifest.registry_seal_resume = {
    retirement_evidence_digest: initialRetirement.digest,
    issued_at: initialManifest.issued_at,
    expires_at: initialManifest.expires_at,
  };
  const refreshedConfig = loadWorkerConfig(
    orchestrationRetirementEnvForManifest(refreshedManifest, activationEnv),
  );
  const refreshedRetirement = resolveGenerationRetirement(refreshedConfig, {
    now: Date.parse("2026-07-31T12:17:00.000Z"),
  });
  assert.equal(refreshedRetirement.valid, true);

  const receipt = createGenerationRetirementReceipt(
    refreshedConfig,
    refreshedRetirement,
    {
      cancelSignalTargetCount: 0,
      matchedExecutionCount: 0,
      recordedAt: "2026-07-31T12:18:00.000Z",
      registryResult: validGenerationStartRegistryResult(
        [],
        activationDigest,
        initialRetirement.digest,
      ),
      registryResultDigest: `sha256:${"c".repeat(64)}`,
      retirementStartedAt: "2026-07-31T12:17:00.000Z",
      terminalProjectionCount: 0,
      uncommittedRegistrationCount: 0,
    },
  );

  assert.equal(
    receipt.start_registry.seal_authorization_digest,
    initialRetirement.digest,
  );
  assert.equal(
    receipt.retirement_evidence_digest,
    refreshedRetirement.digest,
  );
});

function assertMatchesPublishedSchema(value, schemaName) {
  const schema = JSON.parse(
    readFileSync(
      new URL(`../contracts/orchestration/${schemaName}`, import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(value).sort(), [...schema.required].sort());
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...schema.required].sort(),
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertInvalidManifest(mutate) {
  const activationEnv = validOrchestrationActivationEnv();
  const manifest = validOrchestrationRetirementManifest(
    activationEnv.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST,
  );
  mutate(manifest);
  const env = orchestrationRetirementEnvForManifest(manifest, activationEnv);
  const retirement = resolveGenerationRetirement(loadWorkerConfig(env), {
    now: RETIREMENT_START,
  });
  assert.equal(retirement.valid, false);
  assert.equal(retirement.status, "invalid-manifest");
}

function loadWorkerConfig(env) {
  return loadConfig(env, {
    orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
}
