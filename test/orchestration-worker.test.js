import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  normalizeValidationReadinessRequest,
  toTemporalWorkflowInput,
} from "../src/orchestration/contracts.js";
import {
  cancelRun,
  createRunProjection,
} from "../src/orchestration/run-projection.js";
import {
  cancelOutstandingOrchestrationRuns,
  orchestrationWorkerStatus,
  runOrchestrationWorker,
  verifyTerminalOrchestrationRuns,
} from "../src/orchestration/worker.js";
import {
  validOrchestrationActivationEnv,
  validOrchestrationRequest,
} from "../test-fixtures/orchestration.js";

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

test("workflow worker completes a durable recovery fence before denying startup", async () => {
  let fenceCount = 0;
  let closeCount = 0;
  let shutdownCount = 0;
  let resolveRun;
  await assert.rejects(runOrchestrationWorker(loadConfig({}), {
    connect: async () => ({
      async close() {
        closeCount += 1;
      },
    }),
    createWorker: async () => ({
      run() {
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      },
      shutdown() {
        shutdownCount += 1;
        resolveRun();
      },
    }),
    fenceConfirmationScans: 2,
    async sleep() {},
    async cancelOutstandingRuns() {
      fenceCount += 1;
      return [];
    },
    async verifyTerminalRuns(_config, executions) {
      assert.deepEqual(executions, []);
      return 0;
    },
  }), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });
  assert.equal(fenceCount, 4);
  assert.equal(shutdownCount, 1);
  assert.equal(closeCount, 1);
});

test("denied startup resets fence confirmation when a late run appears", async () => {
  const execution = {
    workflowId: "oos:validation-readiness-run:v1:late",
    runId: "run-late",
  };
  const observations = [[], [execution], [], [], [], []];
  let fenceCount = 0;
  let resolveRun;

  await assert.rejects(runOrchestrationWorker(loadConfig({}), {
    connect: async () => ({ async close() {} }),
    createWorker: async () => ({
      run() {
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      },
      shutdown() {
        resolveRun();
      },
    }),
    fenceConfirmationScans: 2,
    async sleep() {},
    async cancelOutstandingRuns() {
      const observed = observations[fenceCount] ?? [];
      fenceCount += 1;
      return observed;
    },
    async verifyTerminalRuns(_config, executions) {
      assert.deepEqual(executions, [execution]);
      return 1;
    },
  }), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });

  assert.equal(fenceCount, 6);
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
  let cancellationCount = 0;
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
    async cancelOutstandingRuns() {
      cancellationCount += 1;
      if (cancellationCount === 1) {
        throw new Error("temporary Temporal RPC failure");
      }
      return [];
    },
    async verifyTerminalRuns(_config, executions) {
      assert.deepEqual(executions, []);
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
  assert.equal(cancellationCount, 3);
  assert.equal(closeCount, 1);
});

test("activation revocation signals every running definition execution", async () => {
  const listCalls = [];
  const signals = [];
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
          async signal(signalName, control) {
            signals.push({ control, runId, signalName, workflowId });
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

  const observed = await cancelOutstandingOrchestrationRuns(
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

  assert.deepEqual(observed, [
    { workflowId: "oos:validation-readiness-run:v1:one", runId: "run-1" },
    { workflowId: "oos:validation-readiness-run:v1:two", runId: "run-2" },
  ]);
  assert.deepEqual(listCalls, [
    {
      query:
        "WorkflowType = 'validationReadinessRunV1' AND ExecutionStatus = 'Running'",
    },
  ]);
  assert.deepEqual(
    signals.map(({ workflowId, runId }) => ({ workflowId, runId })),
    [
      { workflowId: "oos:validation-readiness-run:v1:one", runId: "run-1" },
      { workflowId: "oos:validation-readiness-run:v1:two", runId: "run-2" },
    ],
  );
  assert.ok(
    signals.every(
      ({ control, signalName }) =>
        signalName === "oos.run.control.v1" &&
        control.action === "cancel" &&
        control.reason_ref === "policy:orchestration-activation-revoked",
    ),
  );
  assert.equal(connectionCloseCount, 1);
});

test("activation fence verifies the terminal durable projection", async () => {
  const projection = cancelledProjection();
  let connectionCloseCount = 0;
  const connection = {
    async close() {
      connectionCloseCount += 1;
    },
  };
  const execution = {
    workflowId: projection.workflow_id,
    runId: projection.runtime.execution_run_id,
  };

  const verified = await verifyTerminalOrchestrationRuns(
    loadConfig(validOrchestrationActivationEnv()),
    [execution],
    {
      connect: async () => connection,
      createClient: () => ({
        workflow: {
          getHandle(workflowId, runId) {
            assert.equal(workflowId, execution.workflowId);
            assert.equal(runId, execution.runId);
            return {
              async result() {
                return projection;
              },
            };
          },
        },
      }),
    },
  );

  assert.equal(verified, 1);
  assert.equal(connectionCloseCount, 1);
});

function cancelledProjection() {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );
  const runId = "oos:validation-readiness-run:v1:fence-test";
  const projection = createRunProjection({
    request: toTemporalWorkflowInput(request),
    runId,
    temporalExecutionRunId: "temporal-run:fence-test",
    workflowId: runId,
    timestamp: "2026-07-31T11:00:00.000Z",
  });
  return cancelRun(
    projection,
    {
      schema_version: 1,
      control_id: "control:activation-revocation:test",
      action: "cancel",
      operator_id: "system:operator-orchestration-service",
      reason_ref: "policy:orchestration-activation-revoked",
      idempotency_key: "idempotency:activation-revocation:test",
    },
    "2026-07-31T11:00:01.000Z",
  );
}
