import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import { normalizeValidationReadinessRequest } from "../src/orchestration/contracts.js";
import {
  cancelRun,
  createRunProjection,
} from "../src/orchestration/run-projection.js";
import {
  cancelOutstandingOrchestrationRuns,
  listOutstandingOrchestrationRuns,
  orchestrationWorkerStatus,
  retireOrchestrationGeneration,
  runOrchestrationWorker,
  verifyTerminalOrchestrationRuns,
} from "../src/orchestration/worker.js";
import {
  orchestrationActivationEnvForManifest,
  validOrchestrationActivationEnv,
  validOrchestrationActivationManifest,
  validOrchestrationRequest,
  validOrchestrationRetirementEnv,
  validTemporalWorkflowInput,
} from "../test-fixtures/orchestration.js";

test("workflow worker reports every missing activation gate by default", () => {
  const status = orchestrationWorkerStatus(loadWorkerConfig({}));

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

test("denied worker startup never polls or controls a retired generation", async () => {
  let connected = false;
  let workerCreated = false;

  await assert.rejects(
    runOrchestrationWorker(deniedWorkerConfig(), {
      async connect() {
        connected = true;
        throw new Error("must not connect");
      },
      async createWorker() {
        workerCreated = true;
        throw new Error("must not create worker");
      },
    }),
    (error) => {
      assert.equal(error.code, "orchestration_worker_activation_denied");
      return true;
    },
  );

  assert.equal(connected, false);
  assert.equal(workerCreated, false);
});

test("denied startup never connects to an unadmitted Temporal target", async () => {
  const config = loadWorkerConfig(
    validOrchestrationActivationEnv({
      OOS_TEMPORAL_IDENTITY: "operator-orchestration-service-api",
    }),
  );
  let connected = false;
  let cancellationRequested = false;

  await assert.rejects(runOrchestrationWorker(config, {
    async connect() {
      connected = true;
      throw new Error("must not connect");
    },
    async cancelOutstandingRuns() {
      cancellationRequested = true;
      return [];
    },
  }), (error) => {
    assert.equal(error.code, "orchestration_worker_activation_denied");
    return true;
  });

  assert.equal(connected, false);
  assert.equal(cancellationRequested, false);
});

test("workflow worker reports run allowance only when every gate is present", () => {
  const status = orchestrationWorkerStatus(
    loadWorkerConfig(
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

test("worker polling is pinned to one activation evidence generation", () => {
  const firstStatus = orchestrationWorkerStatus(
    loadWorkerConfig(validOrchestrationActivationEnv()),
  );
  const nextManifest = validOrchestrationActivationManifest();
  nextManifest.manifest_id =
    "platform-engineering://activation/validation-readiness-run/v1/dev-integration/next";
  nextManifest.issued_at = "2026-07-31T00:00:01.000Z";
  const nextStatus = orchestrationWorkerStatus(
    loadWorkerConfig(
      orchestrationActivationEnvForManifest(nextManifest),
    ),
  );

  assert.equal(firstStatus.activation_ready, true);
  assert.equal(nextStatus.activation_ready, true);
  assert.notEqual(
    firstStatus.activation_evidence_digest,
    nextStatus.activation_evidence_digest,
  );
  assert.notEqual(firstStatus.task_queue, nextStatus.task_queue);
  assert.equal(
    nextStatus.task_queue,
    orchestrationWorkerStatus(
      loadWorkerConfig(
        orchestrationActivationEnvForManifest(nextManifest),
      ),
    ).task_queue,
  );
});

test("workflow worker fail-stops immediately when activation evidence is revoked", async () => {
  const env = validOrchestrationActivationEnv();
  const config = loadWorkerConfig(env);
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
    assert.equal(
      error.code,
      "orchestration_worker_activation_revoked_unfenced",
    );
    return true;
  });
  assert.equal(shutdownCount, 1);
  assert.equal(closeCount, 1);
});

test("a fresh activation fail-stops the prior poller without retiring it", async () => {
  const config = loadWorkerConfig(validOrchestrationActivationEnv());
  const priorTaskQueue = orchestrationWorkerStatus(config).task_queue;
  const nextManifest = validOrchestrationActivationManifest();
  nextManifest.manifest_id =
    "platform-engineering://activation/validation-readiness-run/v1/dev-integration/reissued";
  nextManifest.issued_at = "2026-07-31T00:00:02.000Z";
  const nextEnv = orchestrationActivationEnvForManifest(nextManifest);
  let resolveRun;
  let markWorkerCreated;
  const workerCreated = new Promise((resolve) => {
    markWorkerCreated = resolve;
  });
  const worker = {
    run() {
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
    shutdown() {
      resolveRun();
    },
  };

  const run = runOrchestrationWorker(config, {
    activationRecheckIntervalMs: 5,
    clearIntervalImpl(monitor) {
      clearInterval(monitor.handle);
    },
    connect: async () => ({ async close() {} }),
    createWorker: async ({ taskQueue }) => {
      assert.equal(taskQueue, priorTaskQueue);
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
  config.orchestration.activationEvidence.manifestPath =
    nextEnv.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH;
  config.orchestration.activationEvidence.manifestDigest =
    nextEnv.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST;

  await assert.rejects(run, (error) => {
    assert.equal(
      error.code,
      "orchestration_worker_activation_revoked_unfenced",
    );
    assert.deepEqual(error.missingActivationGates, [
      "activation-evidence-generation-changed",
    ]);
    return true;
  });
  assert.notEqual(
    priorTaskQueue,
    orchestrationWorkerStatus(config).task_queue,
  );
});

test("generation retirement signals every running definition execution", async () => {
  const config = loadWorkerConfig(validOrchestrationActivationEnv());
  const taskQueue = orchestrationWorkerStatus(config).task_queue;
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
    config,
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
        "WorkflowType = 'validationReadinessRunV1' " +
        `AND TaskQueue = '${taskQueue}' ` +
        "AND ExecutionStatus = 'Running'",
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
        control.reason_ref === "policy:orchestration-generation-retirement",
    ),
  );
  assert.equal(connectionCloseCount, 1);
});

test("generation retirement lists without issuing lifecycle controls", async () => {
  const config = loadWorkerConfig(validOrchestrationActivationEnv());
  const signals = [];
  const observed = await listOutstandingOrchestrationRuns(config, {
    connect: async () => ({ async close() {} }),
    createClient: () => ({
      workflow: {
        getHandle() {
          return {
            async signal(...args) {
              signals.push(args);
            },
          };
        },
        list() {
          return (async function* runningExecutions() {
            yield {
              workflowId: "oos:validation-readiness-run:v1:one",
              runId: "run-1",
            };
          })();
        },
      },
    }),
  });

  assert.deepEqual(observed, [
    { workflowId: "oos:validation-readiness-run:v1:one", runId: "run-1" },
  ]);
  assert.deepEqual(signals, []);
});

test("authorized retirement stages controls before polling and emits a receipt", async () => {
  const execution = {
    workflowId: "oos:validation-readiness-run:v1:retire-one",
    runId: "run-retire-one",
  };
  const cancellationScans = [
    [execution],
    [execution],
    [execution],
    [execution],
    [],
    [],
  ];
  const events = [];
  let resolveRun;

  const receipt = await retireOrchestrationGeneration(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    {
      confirmationScans: 2,
      connect: async () => ({ async close() { events.push("connection-close"); } }),
      createWorker: async () => {
        events.push("worker-create");
        return {
          run() {
            events.push("worker-run");
            return new Promise((resolve) => { resolveRun = resolve; });
          },
          shutdown() {
            events.push("worker-shutdown");
            resolveRun();
          },
        };
      },
      async cancelOutstandingRuns() {
        events.push("cancel-scan");
        return cancellationScans.shift() ?? [];
      },
      async listOutstandingRuns() {
        events.push("post-stop-scan");
        return [];
      },
      now: () => new Date("2026-08-01T01:00:00.000Z"),
      async sleep() {},
      async verifyTerminalRuns(_config, executions) {
        events.push("verify-terminal");
        assert.deepEqual(executions, [execution]);
        return 1;
      },
    },
  );

  assert.ok(events.indexOf("cancel-scan") < events.indexOf("worker-create"));
  assert.ok(events.indexOf("worker-shutdown") < events.indexOf("post-stop-scan"));
  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.drain_cycle_count, 1);
  assert.equal(receipt.cancel_signal_target_count, 1);
  assert.equal(receipt.terminal_projection_count, 1);
  assert.equal(receipt.post_stop_empty_scans, 2);
});

test("generation retirement rejects an invalid confirmation window", async () => {
  await assert.rejects(
    retireOrchestrationGeneration(
      loadWorkerConfig(validOrchestrationRetirementEnv()),
      { confirmationScans: 0 },
    ),
    /confirmationScans must be a positive integer/,
  );
});

test("a post-stop residual execution forces another one-shot drain cycle", async () => {
  const first = {
    workflowId: "oos:validation-readiness-run:v1:first",
    runId: "run-first",
  };
  const late = {
    workflowId: "oos:validation-readiness-run:v1:late",
    runId: "run-late",
  };
  const cancellationScans = [
    [first],
    [first],
    [],
    [late],
    [late],
    [],
  ];
  const postStopScans = [[late], []];
  let workerCount = 0;

  const receipt = await retireOrchestrationGeneration(
    loadWorkerConfig(validOrchestrationRetirementEnv()),
    {
      confirmationScans: 1,
      connect: async () => ({ async close() {} }),
      createWorker: async () => {
        workerCount += 1;
        let resolveRun;
        return {
          run() {
            return new Promise((resolve) => { resolveRun = resolve; });
          },
          shutdown() {
            resolveRun();
          },
        };
      },
      async cancelOutstandingRuns() {
        return cancellationScans.shift() ?? [];
      },
      async listOutstandingRuns() {
        return postStopScans.shift() ?? [];
      },
      now: () => new Date("2026-08-01T01:00:00.000Z"),
      async sleep() {},
      async verifyTerminalRuns(_config, executions) {
        return executions.length;
      },
    },
  );

  assert.equal(workerCount, 2);
  assert.equal(receipt.drain_cycle_count, 2);
  assert.equal(receipt.cancel_signal_target_count, 2);
  assert.equal(receipt.terminal_projection_count, 2);
});

test("generation retirement verifies the terminal durable projection", async () => {
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
    loadWorkerConfig(validOrchestrationActivationEnv()),
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
    request: validTemporalWorkflowInput(request),
    runId,
    temporalExecutionRunId: "temporal-run:fence-test",
    workflowId: runId,
    timestamp: "2026-07-31T11:00:00.000Z",
  });
  return cancelRun(
    projection,
    {
      schema_version: 1,
      control_id: "control:generation-retirement:test",
      action: "cancel",
      operator_id: "system:operator-orchestration-service",
      reason_ref: "policy:orchestration-generation-retirement",
      idempotency_key: "idempotency:generation-retirement:test",
    },
    "2026-07-31T11:00:01.000Z",
  );
}

function loadWorkerConfig(env) {
  return loadConfig(env, {
    orchestrationProcessRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
}

function deniedWorkerConfig() {
  return loadWorkerConfig(
    validOrchestrationActivationEnv({
      OOS_ORCHESTRATION_RUNTIME_ENABLED: "false",
      OOS_ORCHESTRATION_WORKER_ENABLED: "false",
      OOS_ORCHESTRATION_EXECUTION_AUTHORIZED: "false",
    }),
  );
}
