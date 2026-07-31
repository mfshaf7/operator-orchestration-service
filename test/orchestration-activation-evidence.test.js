import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import {
  orchestrationActivationGates,
  getOrchestrationActivationMissingConfig,
} from "../src/orchestration/catalog.js";
import { resolveActivationEvidence } from "../src/orchestration/activation-evidence.js";
import {
  orchestrationActivationEnvForManifest,
  validOrchestrationActivationEvidenceRecords,
  validOrchestrationActivationEnv,
  validOrchestrationActivationManifest,
} from "../test-fixtures/orchestration.js";

test("digest-pinned Platform activation evidence admits every evidence gate", () => {
  const config = loadConfig(validOrchestrationActivationEnv());
  const resolved = resolveActivationEvidence(config);
  const admission = orchestrationActivationGates(config);

  assert.equal(resolved.valid, true);
  assert.equal(resolved.status, "verified");
  assert.equal(admission.start_allowed, true);
  assert.equal(admission.gates.every((entry) => entry.satisfied), true);
  assert.deepEqual(getOrchestrationActivationMissingConfig(config), []);
});

test("runtime switches and arbitrary reference strings cannot bypass the manifest", () => {
  const config = loadConfig({
    OOS_ORCHESTRATION_RUNTIME_ENABLED: "true",
    OOS_ORCHESTRATION_WORKER_ENABLED: "true",
    OOS_ORCHESTRATION_EXECUTION_AUTHORIZED: "true",
    OOS_ORCHESTRATION_IMPLEMENTATION_REVIEW_REF: "x",
    OOS_ORCHESTRATION_PLATFORM_ACCEPTANCE_REF: "x",
    OOS_ORCHESTRATION_SECURITY_ACTIVATION_REVIEW_REF: "x",
  });

  assert.equal(orchestrationActivationGates(config).start_allowed, false);
  assert.deepEqual(getOrchestrationActivationMissingConfig(config), [
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH",
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST",
    "CALLER_AUTH_SHARED_SECRET",
    "CALLER_ALLOWED_IDS",
  ]);
});

test("manifest records must resolve to exact accepted owner evidence", () => {
  const manifest = validOrchestrationActivationManifest();
  const records = validOrchestrationActivationEvidenceRecords();
  records["platform-runtime-accepted"].owner =
    "operator-orchestration-service";
  records["security-review-accepted"].record_ref = "x";
  const config = loadConfig(
    orchestrationActivationEnvForManifest(manifest, {}, records),
  );

  assert.equal(resolveActivationEvidence(config).valid, false);
  assert.equal(orchestrationActivationGates(config).start_allowed, false);
});

test("activation evidence is bound to the configured Temporal target", () => {
  for (const overrides of [
    { OOS_TEMPORAL_ADDRESS: "other-temporal.temporal.svc:7233" },
    { OOS_TEMPORAL_NAMESPACE: "other-namespace" },
    { OOS_TEMPORAL_IDENTITY: "unadmitted-worker" },
  ]) {
    const config = loadConfig(validOrchestrationActivationEnv(overrides));

    assert.equal(resolveActivationEvidence(config).valid, false);
    assert.equal(orchestrationActivationGates(config).start_allowed, false);
  }
});

test("activation evidence binds each Temporal identity to its process role", () => {
  const apiWithWorkerIdentity = loadConfig(
    validOrchestrationActivationEnv({
      OOS_TEMPORAL_IDENTITY: "oos-workflow-worker",
    }),
  );
  const workerWithApiIdentity = loadConfig(
    validOrchestrationActivationEnv({
      OOS_TEMPORAL_IDENTITY: "operator-orchestration-service-api",
    }),
    { orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE },
  );
  const admittedWorker = loadConfig(
    validOrchestrationActivationEnv(),
    { orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE },
  );

  assert.equal(resolveActivationEvidence(apiWithWorkerIdentity).valid, false);
  assert.equal(resolveActivationEvidence(workerWithApiIdentity).valid, false);
  assert.equal(resolveActivationEvidence(admittedWorker).valid, true);
});

test("activation evidence rejects shared API and worker identities", () => {
  const manifest = validOrchestrationActivationManifest();
  manifest.temporal_target.identities.workflow_worker =
    manifest.temporal_target.identities.api;
  const config = loadConfig(orchestrationActivationEnvForManifest(manifest));

  assert.equal(resolveActivationEvidence(config).valid, false);
});

test("resolved evidence records are denied after their digest changes", () => {
  const env = validOrchestrationActivationEnv();
  appendFileSync(
    join(
      dirname(env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH),
      "records",
      "implementation-reviewed.json",
    ),
    "tampered",
    "utf8",
  );
  const config = loadConfig(env);

  assert.equal(resolveActivationEvidence(config).valid, false);
  assert.equal(orchestrationActivationGates(config).start_allowed, false);
});

test("manifest content is denied after its pinned digest no longer matches", () => {
  const env = validOrchestrationActivationEnv();
  appendFileSync(
    env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH,
    "tampered",
    "utf8",
  );
  const config = loadConfig(env);

  assert.equal(resolveActivationEvidence(config).status, "digest-mismatch");
  assert.equal(orchestrationActivationGates(config).start_allowed, false);
});

test("expired activation evidence is denied even when its digest is valid", () => {
  const manifest = validOrchestrationActivationManifest();
  manifest.issued_at = "2026-01-01T00:00:00.000Z";
  manifest.expires_at = "2026-01-02T00:00:00.000Z";
  const config = loadConfig(orchestrationActivationEnvForManifest(manifest));

  assert.equal(resolveActivationEvidence(config).valid, false);
  assert.equal(orchestrationActivationGates(config).start_allowed, false);
});
