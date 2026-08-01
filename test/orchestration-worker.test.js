import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  loadConfig,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../src/config.js";
import { normalizeValidationReadinessRequest } from "../src/orchestration/contracts.js";
import {
  GENERATION_START_REGISTRY_SEAL_SIGNAL,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  RUN_BINDING_MEMO_KEY,
  VALIDATION_READINESS_WORKFLOW_TYPE,
} from "../src/orchestration/constants.js";
import { resolveGenerationRetirement } from "../src/orchestration/generation-retirement.js";
import {
  cancelRun,
  createRunProjection,
} from "../src/orchestration/run-projection.js";
import {
  orchestrationWorkerStatus,
  reconcileRegisteredOrchestrationRuns,
  retireOrchestrationGeneration,
  runOrchestrationWorker,
  sealGenerationStartRegistry,
  verifyTerminalOrchestrationRuns,
} from "../src/orchestration/worker.js";
import {
  orchestrationActivationEnvForManifest,
  validGenerationStartRegistryResult,
  validOrchestrationActivationEnv,
  validOrchestrationActivationManifest,
  validOrchestrationRequest,
  validOrchestrationRetirementEnv,
  validTemporalWorkflowInput,
  validTemporalRunBindings,
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

test("authorized retirement seals and reconciles exact starts before polling", async () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(config, {
    now: Date.parse("2026-07-31T12:00:40.000Z"),
  });
  assert.equal(retirement.valid, true);
  const execution = {
    workflowId: "oos:validation-readiness-run:v1:retire-one",
    runId: "run-retire-one",
  };
  const registryResult = validGenerationStartRegistryResult(
    [execution.workflowId],
    retirement.activationEvidenceDigest,
  );
  const events = [];
  let resolveRun;
  const times = [
    new Date("2026-07-31T12:00:40.000Z"),
    new Date("2026-07-31T12:00:50.000Z"),
    new Date("2026-07-31T12:01:00.000Z"),
    new Date("2026-07-31T12:02:00.000Z"),
  ];

  const receipt = await retireOrchestrationGeneration(
    config,
    {
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
      now: () => times.shift(),
      async reconcileRegisteredRuns(_config, result) {
        events.push("reconcile-registered");
        assert.deepEqual(result, registryResult);
        return {
          cancelSignalTargetCount: 1,
          executions: [execution],
          uncommittedRegistrationCount: 0,
        };
      },
      async sealStartRegistry() {
        events.push("seal-registry");
        return registryResult;
      },
      async verifyTerminalRuns(_config, executions) {
        events.push("verify-terminal");
        assert.deepEqual(executions, [execution]);
        return 1;
      },
    },
  );

  assert.ok(events.indexOf("seal-registry") < events.indexOf("worker-create"));
  assert.ok(
    events.indexOf("reconcile-registered") < events.indexOf("worker-create"),
  );
  assert.ok(events.indexOf("worker-run") < events.indexOf("verify-terminal"));
  assert.equal(receipt.outcome, "retired");
  assert.equal(receipt.cancel_signal_target_count, 1);
  assert.equal(receipt.terminal_projection_count, 1);
  assert.equal(receipt.retirement_started_at, "2026-07-31T12:01:00.000Z");
  assert.equal(receipt.start_registry.registered_workflow_count, 1);
});

test("retirement revalidates authorization immediately before worker.run", async () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(config, {
    now: Date.parse("2026-07-31T12:01:00.000Z"),
  });
  assert.equal(retirement.valid, true);
  let workerRunCalled = false;
  const times = [
    new Date("2026-07-31T12:01:00.000Z"),
    new Date("2026-07-31T12:01:10.000Z"),
    new Date("2026-07-31T12:15:00.000Z"),
  ];

  await assert.rejects(
    retireOrchestrationGeneration(
      config,
      {
        connect: async () => ({ async close() {} }),
        createWorker: async () => ({
          async run() {
            workerRunCalled = true;
          },
          async shutdown() {},
        }),
        now: () => times.shift(),
        async reconcileRegisteredRuns() {
          return {
            cancelSignalTargetCount: 0,
            executions: [],
            uncommittedRegistrationCount: 0,
          };
        },
        async sealStartRegistry() {
          return validGenerationStartRegistryResult(
            [],
            retirement.activationEvidenceDigest,
          );
        },
      },
    ),
    (error) =>
      error.code === "orchestration_generation_retirement_denied" &&
      error.retirementStatus === "invalid-manifest",
  );
  assert.equal(workerRunCalled, false);
});

test("retirement rejects a registry sealed by another authorization before reconciliation", async () => {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(config, {
    now: Date.parse("2026-07-31T12:01:00.000Z"),
  });
  const registryResult = validGenerationStartRegistryResult(
    [],
    retirement.activationEvidenceDigest,
  );
  registryResult.seal_ref =
    "platform-engineering://retirement/validation-readiness-run/v1/dev-integration/other";
  let reconciliationCalled = false;
  let workerCreated = false;
  const times = [
    new Date("2026-07-31T12:01:00.000Z"),
    new Date("2026-07-31T12:01:10.000Z"),
  ];

  await assert.rejects(
    retireOrchestrationGeneration(config, {
      async createWorker() {
        workerCreated = true;
      },
      now: () => times.shift(),
      async reconcileRegisteredRuns() {
        reconciliationCalled = true;
      },
      async sealStartRegistry() {
        return registryResult;
      },
    }),
    /seal does not match this retirement authorization/,
  );

  assert.equal(reconciliationCalled, false);
  assert.equal(workerCreated, false);
});

test("registered starts reconcile by exact workflow id without Visibility", async () => {
  const request = normalizeValidationReadinessRequest(
    validOrchestrationRequest(),
    { callerId: "governance-operations-console" },
  );
  const runningId =
    "oos:validation-readiness-run:v1:validation-readiness-abc123";
  const foreignGenerationId =
    "oos:validation-readiness-run:v1:foreign-generation";
  const missingId = "oos:validation-readiness-run:v1:missing";
  const signals = [];
  let listCalled = false;
  const { config, retirement } = resolveValidRetirement();
  const registryResult = validGenerationStartRegistryResult(
    [foreignGenerationId, missingId, runningId],
    retirement.activationEvidenceDigest,
  );

  const reconciliation = await reconcileRegisteredOrchestrationRuns(
    config,
    registryResult,
    retirement,
    {
      connect: async () => ({ async close() {} }),
      createClient: () => ({
        workflow: {
          getHandle(workflowId, runId) {
            if (workflowId === missingId) {
              return {
                async describe() {
                  throw new WorkflowNotFoundError(
                    "not found",
                    workflowId,
                    undefined,
                  );
                },
              };
            }
            return {
              async describe() {
                return {
                  memo: {
                    [RUN_BINDING_MEMO_KEY]: validTemporalRunBindings(
                      request,
                      workflowId === foreignGenerationId
                        ? `sha256:${"d".repeat(64)}`
                        : retirement.activationEvidenceDigest,
                    ),
                  },
                  runId: "run-registered",
                  status: { name: "RUNNING" },
                  taskQueue: retirement.workflowTaskQueue,
                  type: VALIDATION_READINESS_WORKFLOW_TYPE,
                };
              },
              async signal(signalName, control) {
                signals.push({ control, runId, signalName, workflowId });
              },
            };
          },
          list() {
            listCalled = true;
          },
        },
      }),
      now: () => new Date("2026-07-31T12:01:00.000Z"),
    },
  );

  assert.equal(listCalled, false);
  assert.deepEqual(reconciliation.executions, [
    { workflowId: runningId, runId: "run-registered" },
  ]);
  assert.equal(reconciliation.cancelSignalTargetCount, 1);
  assert.equal(reconciliation.uncommittedRegistrationCount, 2);
  assert.deepEqual(
    signals.map(({ runId, signalName, workflowId }) => ({
      runId,
      signalName,
      workflowId,
    })),
    [
      {
        runId: "run-registered",
        signalName: "oos.run.control.v1",
        workflowId: runningId,
      },
    ],
  );
});

test("retirement seals the dedicated registry queue without polling business work", async () => {
  const { config, retirement } = resolveValidRetirement();
  const registryResult = validGenerationStartRegistryResult(
    undefined,
    retirement.activationEvidenceDigest,
  );
  const workerQueues = [];
  const signalCalls = [];
  let resolveWorkerRun;

  const result = await sealGenerationStartRegistry(
    config,
    retirement,
    {
      connectClient: async () => ({ async close() {} }),
      connectWorker: async () => ({ async close() {} }),
      createClient: () => ({
        workflow: {
          async signalWithStart(workflowType, options) {
            signalCalls.push({ options, workflowType });
            return {
              async result() {
                return registryResult;
              },
            };
          },
        },
      }),
      createWorker: async ({ taskQueue }) => {
        workerQueues.push(taskQueue);
        return {
          run() {
            return new Promise((resolve) => {
              resolveWorkerRun = resolve;
            });
          },
          shutdown() {
            resolveWorkerRun();
          },
        };
      },
    },
  );

  assert.deepEqual(result, registryResult);
  assert.deepEqual(workerQueues, [retirement.startRegistry.task_queue]);
  assert.equal(signalCalls[0].workflowType, GENERATION_START_REGISTRY_WORKFLOW_TYPE);
  assert.equal(
    signalCalls[0].options.signal,
    GENERATION_START_REGISTRY_SEAL_SIGNAL,
  );
  assert.equal(
    signalCalls[0].options.taskQueue,
    retirement.startRegistry.task_queue,
  );
});

test("retirement reuses the exact result when the registry was already sealed", async () => {
  const { config, retirement } = resolveValidRetirement();
  const registryResult = validGenerationStartRegistryResult(
    [],
    retirement.activationEvidenceDigest,
  );
  let resolveWorkerRun;
  let existingHandleRead = false;

  const result = await sealGenerationStartRegistry(config, retirement, {
    connectClient: async () => ({ async close() {} }),
    connectWorker: async () => ({ async close() {} }),
    createClient: () => ({
      workflow: {
        getHandle(workflowId) {
          assert.equal(workflowId, retirement.startRegistry.workflow_id);
          existingHandleRead = true;
          return {
            async result() {
              return registryResult;
            },
          };
        },
        async signalWithStart() {
          throw new WorkflowExecutionAlreadyStartedError(
            "already sealed",
            retirement.startRegistry.workflow_id,
            GENERATION_START_REGISTRY_WORKFLOW_TYPE,
          );
        },
      },
    }),
    createWorker: async () => ({
      run() {
        return new Promise((resolve) => {
          resolveWorkerRun = resolve;
        });
      },
      shutdown() {
        resolveWorkerRun();
      },
    }),
  });

  assert.equal(existingHandleRead, true);
  assert.deepEqual(result, registryResult);
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

function resolveValidRetirement() {
  const config = loadWorkerConfig(validOrchestrationRetirementEnv());
  const retirement = resolveGenerationRetirement(
    config,
    { now: Date.parse("2026-07-31T12:01:00.000Z") },
  );
  assert.equal(retirement.valid, true);
  return { config, retirement };
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
