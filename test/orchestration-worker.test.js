import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  orchestrationWorkerStatus,
  runOrchestrationWorker,
} from "../src/orchestration/worker.js";
import { validOrchestrationActivationEnv } from "../test-fixtures/orchestration.js";

test("workflow worker reports every missing activation gate by default", () => {
  const status = orchestrationWorkerStatus(loadConfig({}));

  assert.equal(status.activation_ready, false);
  assert.equal(status.run_allowed, false);
  assert.deepEqual(status.missing_activation_gates, [
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH",
    "OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST",
    "OOS_ORCHESTRATION_RUNTIME_ENABLED",
    "OOS_ORCHESTRATION_WORKER_ENABLED",
    "OOS_ORCHESTRATION_EXECUTION_AUTHORIZED",
  ]);
});

test("workflow worker refuses to connect when activation is incomplete", async () => {
  await assert.rejects(runOrchestrationWorker(loadConfig({})), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });
});

test("workflow worker reports run allowance only when every gate is present", () => {
  const status = orchestrationWorkerStatus(
    loadConfig(
      validOrchestrationActivationEnv({
        CALLER_ALLOWED_IDS: "",
        CALLER_AUTH_SHARED_SECRET: "",
      }),
    ),
  );

  assert.equal(status.activation_ready, true);
  assert.equal(status.run_allowed, true);
  assert.deepEqual(status.missing_activation_gates, []);
});

test("workflow worker shuts down when activation evidence is revoked", async () => {
  const env = validOrchestrationActivationEnv();
  const config = loadConfig(env);
  let closeCount = 0;
  let shutdownCount = 0;
  let resolveRun;
  const worker = {
    run() {
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    shutdown() {
      shutdownCount += 1;
      resolveRun();
    },
  };
  let markWorkerCreated;
  const workerCreated = new Promise((resolve) => {
    markWorkerCreated = resolve;
  });

  const run = runOrchestrationWorker(config, {
    activationRecheckIntervalMs: 5,
    clearIntervalImpl(monitor) {
      clearInterval(monitor.handle);
    },
    connect: async () => ({
      async close() {
        closeCount += 1;
      },
    }),
    createWorker: async () => {
      markWorkerCreated();
      return worker;
    },
    setIntervalImpl(callback, milliseconds) {
      return {
        handle: setInterval(callback, milliseconds),
        unref() {},
      };
    },
  });

  await workerCreated;
  writeFileSync(
    env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH,
    "{}\n",
    "utf8",
  );

  await assert.rejects(run, (error) => {
    assert.equal(error.code, "orchestration_worker_activation_revoked");
    return true;
  });
  assert.equal(shutdownCount, 1);
  assert.equal(closeCount, 1);
});
