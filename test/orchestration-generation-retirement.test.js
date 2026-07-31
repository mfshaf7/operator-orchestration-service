import assert from "node:assert/strict";
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
  const retirement = resolveGenerationRetirement(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    { now: RETIREMENT_START },
  );
  const receipt = createGenerationRetirementReceipt(retirement, {
    cancelSignalTargetCount: 2,
    drainCycleCount: 2,
    postStopEmptyScans: 7,
    recordedAt: "2026-07-31T12:02:00.000Z",
    retirementStartedAt: "2026-07-31T12:01:00.000Z",
    terminalProjectionCount: 2,
  });

  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.ordinary_poller_stopped, true);
  assert.equal(receipt.retirement_evidence_digest, retirement.digest);
  assert.equal(
    receipt.activation_evidence_digest,
    retirement.activationEvidenceDigest,
  );
  assert.equal(receipt.drain_cycle_count, 2);
  assert.equal(receipt.cancel_signal_target_count, 2);
  assert.equal(receipt.terminal_projection_count, 2);
  assert.equal(receipt.retirement_started_at, "2026-07-31T12:01:00.000Z");
  assertMatchesPublishedSchema(
    receipt,
    "generation-retirement-receipt.schema.json",
  );
});

test("retirement receipt requires a start inside the manifest lifetime", () => {
  const retirement = resolveGenerationRetirement(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    { now: RETIREMENT_START },
  );
  const receiptInput = {
    cancelSignalTargetCount: 0,
    drainCycleCount: 1,
    postStopEmptyScans: 7,
    recordedAt: "2026-07-31T12:20:00.000Z",
    retirementStartedAt: retirement.manifest.expires_at,
    terminalProjectionCount: 0,
  };

  assert.throws(
    () => createGenerationRetirementReceipt(retirement, receiptInput),
    /must start within the authorized manifest lifetime/,
  );
});

test("retirement receipt permits an authorized drain to finish after expiry", () => {
  const retirement = resolveGenerationRetirement(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    { now: RETIREMENT_START },
  );

  const receipt = createGenerationRetirementReceipt(retirement, {
    cancelSignalTargetCount: 0,
    drainCycleCount: 1,
    postStopEmptyScans: 7,
    recordedAt: "2026-07-31T12:20:00.000Z",
    retirementStartedAt: "2026-07-31T12:01:00.000Z",
    terminalProjectionCount: 0,
  });

  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.recorded_at, "2026-07-31T12:20:00.000Z");
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
