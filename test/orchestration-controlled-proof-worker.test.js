import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import {
  controlledProofWorkerStatus,
  runControlledProofWorker,
} from "../src/orchestration/worker.js";
import { CONTROLLED_PROOF_WORKFLOW_TYPE } from "../src/orchestration/constants.js";
import {
  controlledProofEnvForContext,
  validControlledProofContext,
} from "../test-fixtures/orchestration.js";

test("controlled proof worker status is pinned to one build-admitted session and queue", () => {
  const context = validControlledProofContext();
  const config = workerConfig(context);
  const status = controlledProofWorkerStatus(config, {
    now: new Date("2026-08-01T00:03:00.000Z"),
  });

  assert.equal(status.context_ready, true);
  assert.equal(status.worker_allowed, true);
  assert.equal(status.new_execution_allowed, true);
  assert.equal(status.workflow_type, CONTROLLED_PROOF_WORKFLOW_TYPE);
  assert.equal(status.task_queue, context.runtime.workflow_task_queue);
  assert.equal(status.activity_task_queue, context.runtime.activity_task_queue);
  assert.equal(status.commissioning_session_id, "commissioning-session-698-1");
});

test("expired proof context can host retained cleanup but cannot admit a new execution", () => {
  const context = validControlledProofContext({
    expiresAt: "2026-08-01T00:05:00.000Z",
  });
  const status = controlledProofWorkerStatus(workerConfig(context), {
    now: new Date("2026-08-01T00:06:00.000Z"),
  });

  assert.equal(status.worker_allowed, true);
  assert.equal(status.new_execution_allowed, false);
  assert.equal(status.denial_reason, "authorization-expired-new-starts-denied");
});

test("controlled proof worker polls only the pinned workflow queue", async () => {
  const context = validControlledProofContext();
  const config = workerConfig(context);
  let workerOptions;
  let closed = false;
  let shutdown = false;

  await assert.rejects(
    runControlledProofWorker(config, {
      async connect(options) {
        assert.equal(options.address, context.runtime.temporal_address);
        return { async close() { closed = true; } };
      },
      async createWorker(options) {
        workerOptions = options;
        return {
          async run() {},
          async shutdown() { shutdown = true; },
        };
      },
      setIntervalImpl() {
        return { unref() {} };
      },
      clearIntervalImpl() {},
    }),
    /stopped before its context was revoked/,
  );

  assert.equal(workerOptions.taskQueue, context.runtime.workflow_task_queue);
  assert.equal(workerOptions.identity, context.runtime.workflow_worker_identity);
  assert.equal(shutdown, true);
  assert.equal(closed, true);
});

test("controlled proof worker fail-stops when its pinned context changes", async () => {
  const context = validControlledProofContext();
  const env = controlledProofEnvForContext(context);
  const config = loadConfig(env, {
    orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  let resolveRun;
  const runPromise = new Promise((resolve) => { resolveRun = resolve; });
  let shutdown = false;

  await assert.rejects(
    runControlledProofWorker(config, {
      async connect() {
        return { async close() {} };
      },
      async createWorker() {
        return {
          run() { return runPromise; },
          async shutdown() {
            shutdown = true;
            resolveRun();
          },
        };
      },
      setIntervalImpl(callback) {
        writeFileSync(
          config.orchestration.controlledProof.contextPath,
          "{}\n",
          "utf8",
        );
        queueMicrotask(callback);
        return { unref() {} };
      },
      clearIntervalImpl() {},
    }),
    (error) => error.code === "controlled_proof_worker_context_revoked",
  );
  assert.equal(shutdown, true);
});

function workerConfig(context) {
  return loadConfig(controlledProofEnvForContext(context), {
    orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
}
