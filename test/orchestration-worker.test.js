import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  orchestrationWorkerStatus,
  runOrchestrationWorker,
  terminateOutstandingOrchestrationRuns,
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
  let fenceCount = 0;
  await assert.rejects(runOrchestrationWorker(loadConfig({}), {
    fenceConfirmationScans: 2,
    async sleep() {},
    async terminateOutstandingRuns() {
      fenceCount += 1;
      return 0;
    },
  }), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });
  assert.equal(fenceCount, 2);
});

test("denied startup resets fence confirmation when a late run appears", async () => {
  const terminationCounts = [0, 1, 0, 0];
  let fenceCount = 0;

  await assert.rejects(runOrchestrationWorker(loadConfig({}), {
    fenceConfirmationScans: 2,
    async sleep() {},
    async terminateOutstandingRuns() {
      const terminated = terminationCounts[fenceCount];
      fenceCount += 1;
      return terminated;
    },
  }), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });

  assert.equal(fenceCount, 4);
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
  let terminationCount = 0;
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
    fenceConfirmationScans: 2,
    setIntervalImpl(callback, milliseconds) {
      return {
        handle: setInterval(callback, milliseconds),
        unref() {},
      };
    },
    reportFenceRetry() {},
    async sleep() {},
    async terminateOutstandingRuns() {
      terminationCount += 1;
      if (terminationCount === 1) {
        throw new Error("temporary Temporal RPC failure");
      }
      return 0;
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
  assert.equal(terminationCount, 3);
  assert.equal(closeCount, 1);
});

test("activation revocation terminates every running definition execution", async () => {
  const listCalls = [];
  const terminations = [];
  let connectionCloseCount = 0;
  const connection = {
    async close() {
      connectionCloseCount += 1;
    },
  };
  const client = {
    workflow: {
      getHandle(workflowId, runId) {
        return {
          async terminate(reason) {
            terminations.push({ reason, runId, workflowId });
          },
        };
      },
      list(options) {
        listCalls.push(options);
        return (async function* runningExecutions() {
          yield { workflowId: "oos:validation-readiness-run:v1:one", runId: "run-1" };
          yield { workflowId: "oos:validation-readiness-run:v1:two", runId: "run-2" };
        })();
      },
    },
  };

  const terminated = await terminateOutstandingOrchestrationRuns(
    loadConfig(validOrchestrationActivationEnv()),
    {
      connect: async ({ address }) => {
        assert.equal(address, "temporal-frontend.temporal.svc:7233");
        return connection;
      },
      createClient: (options) => {
        assert.equal(options.connection, connection);
        return client;
      },
    },
  );

  assert.equal(terminated, 2);
  assert.deepEqual(listCalls, [
    {
      query:
        "WorkflowType = 'validationReadinessRunV1' AND ExecutionStatus = 'Running'",
    },
  ]);
  assert.deepEqual(
    terminations.map(({ workflowId, runId }) => ({ workflowId, runId })),
    [
      { workflowId: "oos:validation-readiness-run:v1:one", runId: "run-1" },
      { workflowId: "oos:validation-readiness-run:v1:two", runId: "run-2" },
    ],
  );
  assert.ok(
    terminations.every(({ reason }) => reason.includes("activation was revoked")),
  );
  assert.equal(connectionCloseCount, 1);
});
