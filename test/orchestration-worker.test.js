import assert from "node:assert/strict";
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
    loadConfig(validOrchestrationActivationEnv()),
  );

  assert.equal(status.activation_ready, true);
  assert.equal(status.run_allowed, true);
  assert.deepEqual(status.missing_activation_gates, []);
});
