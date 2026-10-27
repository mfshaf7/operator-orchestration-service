import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseAllDocuments } from "yaml";
import { ACTIVATION_MOUNT, orchestrationWorkerReplicas } from "../dev-integration/profiles/accepted-idea-delivery/scripts/orchestration_settings.mjs";
import { orchestrationActivationEnvForManifest, validOrchestrationActivationEnv,
  validOrchestrationActivationManifest } from "../test-fixtures/orchestration.js";

function mounted(env) {
  return { env: { ...env, OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH: `${ACTIVATION_MOUNT}/manifest.json` },
    root: dirname(env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH) };
}

test("the native launcher has no default worker or activation-file dependency", () => {
  assert.equal(orchestrationWorkerReplicas({}, "/does-not-exist/disabled-activation"), 0);
});

test("only the existing exact bundle accepted for both process identities admits one worker", () => {
  const input = mounted(validOrchestrationActivationEnv());
  assert.equal(orchestrationWorkerReplicas(input.env, input.root), 1);
  // An ordinary restart validates the same bytes and keeps the generation.
  assert.equal(orchestrationWorkerReplicas(input.env, input.root), 1);
});

test("partial switches, missing/corrupt/expired evidence, wrong target and shared identities deny launch", () => {
  const good = mounted(validOrchestrationActivationEnv());
  for (const change of [
    { OOS_ORCHESTRATION_RUNTIME_ENABLED: "false" },
    { OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST: "" },
    { OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST: `sha256:${"0".repeat(64)}` },
    { OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH: "/another/manifest.json" },
    { OOS_TEMPORAL_NAMESPACE: "another-namespace" },
  ]) assert.throws(() => orchestrationWorkerReplicas({ ...good.env, ...change }, good.root));
  assert.throws(() => orchestrationWorkerReplicas(good.env, "/does-not-exist/missing-activation"));
  for (const change of [
    { expires_at: "2026-08-01T00:00:00.000Z" },
    { temporal_target: { ...validOrchestrationActivationManifest().temporal_target,
      identities: { api: "operator-orchestration-service-api", workflow_worker: "operator-orchestration-service-api" } } },
  ]) {
    const input = mounted(orchestrationActivationEnvForManifest({ ...validOrchestrationActivationManifest(), ...change }));
    assert.throws(() => orchestrationWorkerReplicas(input.env, input.root));
  }
});

test("the actual native up command rejects unaccepted execution before any runtime mutation", t => {
  const root = mkdtempSync(join(tmpdir(), "oos-native-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"), invoked = join(root, "runtime-invoked"), state = join(root, "state");
  mkdirSync(bin);
  for (const command of ["helm", "k3s"]) {
    const file = join(bin, command);
    writeFileSync(file, '#!/bin/sh\ntouch "$TEST_RUNTIME_INVOKED"\nexit 77\n');
    chmodSync(file, 0o700);
  }
  const result = spawnSync("bash", [fileURLToPath(new URL("../dev-integration/profiles/accepted-idea-delivery/scripts/up.sh", import.meta.url))], {
    encoding: "utf8", timeout: 10000,
    env: { PATH: `${bin}:${process.env.PATH}`, TEST_RUNTIME_INVOKED: invoked,
      DEVINT_PROFILE_ID: "accepted-idea-delivery", DEVINT_NAMESPACE: "devint-accepted-idea-delivery-test",
      DEVINT_OPERATOR: "test", DEVINT_STATE_ROOT: state, DEVINT_SESSION_FILE: join(root, "session.json"),
      DEVINT_WORKSPACE_ROOT: root, DEVINT_REPO_PATHS_JSON: "{}", DEVINT_REPO_STATES_JSON: "{}",
      DEVINT_PROMOTION_REPORT: join(root, "promotion.json"), DEVINT_PROFILE_FILE: join(root, "profile.json"),
      DEVINT_PROFILE_JSON: "{}", OOS_ORCHESTRATION_RUNTIME_ENABLED: "true",
      OOS_ORCHESTRATION_WORKER_ENABLED: "true", OOS_ORCHESTRATION_EXECUTION_AUTHORIZED: "true",
      OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH: `${ACTIVATION_MOUNT}/manifest.json`,
      OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST: `sha256:${"a".repeat(64)}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /activation validator denied/);
  assert.equal(existsSync(invoked), false);
  assert.equal(existsSync(state), false);
});

test("native API and worker manifests share the read-only bundle without sharing API credentials or request storage", () => {
  const source = readFileSync(new URL("../dev-integration/profiles/accepted-idea-delivery/scripts/up.sh", import.meta.url), "utf8");
  const template = source.split('cat >"${RENDERED_DIR}/broker.yaml" <<EOF\n')[1]?.split("\nEOF")[0];
  assert.ok(template, "Use the actual native manifest, not another file list.");
  for (const replicas of [0, 1]) {
    const values = { BROKER_DEPLOYMENT: "synthetic-api", ORCHESTRATION_WORKER_DEPLOYMENT: "synthetic-worker",
      orchestration_worker_replicas: String(replicas), ORCHESTRATION_ACTIVATION_ROOT: "/synthetic/private/activation",
      MODEL_PROFILE_REQUEST_STATE: "/synthetic/private/model-profile-requests" };
    const rendered = template.replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g,
      (_, name) => values[name] ?? `synthetic-${name.toLowerCase().replaceAll("_", "-")}`);
    const documents = parseAllDocuments(rendered);
    for (const document of documents) assert.deepEqual(document.errors, []);
    const resources = documents.map(document => document.toJSON());
    const api = resources.find(value => value.kind === "Deployment" && value.metadata.name === "synthetic-api").spec.template.spec;
    const deployment = resources.find(value => value.kind === "Deployment" && value.metadata.name === "synthetic-worker");
    assert.equal(deployment.spec.replicas, replicas);
    const worker = deployment.spec.template.spec, process = worker.containers[0];
    for (const spec of [api, worker]) {
      assert.deepEqual(spec.containers[0].volumeMounts.find(value => value.name === "orchestration-activation"),
        { name: "orchestration-activation", mountPath: ACTIVATION_MOUNT, readOnly: true });
      assert.equal(spec.volumes.find(value => value.name === "orchestration-activation").hostPath.path, values.ORCHESTRATION_ACTIVATION_ROOT);
    }
    assert.equal(api.containers[0].volumeMounts.find(value => value.name === "model-profile-request-state").mountPath,
      "/var/lib/oos/model-profile-requests");
    assert.equal(worker.volumes.some(value => value.name === "model-profile-request-state"), false);
    assert.equal(process.envFrom, undefined);
    assert.equal(process.env.some(value => /CALLER|OPENPROJECT|MODEL_PROFILE/.test(value.name)), false);
    assert.equal(process.env.find(value => value.name === "OOS_TEMPORAL_IDENTITY").value, "oos-workflow-worker");
    for (const key of ["OOS_ORCHESTRATION_RUNTIME_ENABLED", "OOS_ORCHESTRATION_WORKER_ENABLED",
      "OOS_ORCHESTRATION_EXECUTION_AUTHORIZED", "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH",
      "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST", "OOS_TEMPORAL_ADDRESS", "OOS_TEMPORAL_NAMESPACE"]) {
      assert.equal(process.env.find(value => value.name === key).valueFrom.secretKeyRef.key, key);
    }
  }
});
