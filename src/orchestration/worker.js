import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  Client,
  Connection,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

import { ORCHESTRATION_WORKER_PROCESS_ROLE } from "../config.js";
import {
  resolveActivationControlTarget,
  resolveActivationEvidence,
} from "./activation-evidence.js";
import { getOrchestrationWorkerActivationMissingConfig } from "./catalog.js";
import {
  RUN_CONTROL_SIGNAL,
  VALIDATION_READINESS_WORKFLOW_TYPE,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import { assertRunProjection } from "./contracts.js";
import {
  createGenerationRetirementReceipt,
  resolveGenerationRetirement,
} from "./generation-retirement.js";

const workflowsPath = fileURLToPath(
  new URL("./workflows.js", import.meta.url),
);
const ACTIVATION_RECHECK_INTERVAL_MS = 30_000;
const RETIREMENT_RETRY_INTERVAL_MS = 5_000;
const RETIREMENT_CONFIRMATION_SCANS = 7;
const TERMINAL_RUN_STATES = new Set(["cancelled", "completed", "failed"]);

export function orchestrationWorkerStatus(config) {
  const missing = getOrchestrationWorkerActivationMissingConfig(config);
  const activation = resolveActivationEvidence(config, {
    processRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  return {
    activation_evidence_digest: activation.valid ? activation.digest : null,
    schema_version: 1,
    worker: "operator-orchestration-service-workflow-worker",
    workflow_type: VALIDATION_READINESS_WORKFLOW_TYPE,
    task_queue: activation.valid
      ? validationReadinessWorkflowQueueFor(activation.digest)
      : null,
    runtime_adapter: "temporal",
    namespace: config.orchestration.temporal.namespace,
    enabled: config.orchestration.workerEnabled,
    execution_authorized: config.orchestration.executionAuthorized,
    activation_ready: missing.length === 0,
    run_allowed: missing.length === 0,
    missing_activation_gates: missing,
  };
}

export async function runOrchestrationWorker(
  config,
  {
    activationRecheckIntervalMs = ACTIVATION_RECHECK_INTERVAL_MS,
    clearIntervalImpl = clearInterval,
    connect = (options) => NativeConnection.connect(options),
    createWorker = (options) => Worker.create(options),
    setIntervalImpl = setInterval,
  } = {},
) {
  const status = orchestrationWorkerStatus(config);
  if (!status.activation_ready) {
    throw activationError(
      "orchestration_worker_activation_denied",
      status.missing_activation_gates,
    );
  }
  const admittedTarget = resolveActivationControlTarget(config, {
    processRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  if (!admittedTarget.valid) {
    throw activationError(
      "orchestration_worker_activation_target_unverified",
      status.missing_activation_gates,
    );
  }

  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  let activationRevoked = null;
  let monitor = null;
  let shutdownTask = null;
  let runFailure = null;
  try {
    const worker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: status.task_queue,
      workflowsPath,
    });
    const runPromise = worker.run();
    monitor = setIntervalImpl(() => {
      if (activationRevoked) {
        return;
      }
      const currentStatus = orchestrationWorkerStatus(config);
      if (
        !currentStatus.activation_ready ||
        currentStatus.activation_evidence_digest !==
          status.activation_evidence_digest
      ) {
        const revocationReasons = currentStatus.activation_ready
          ? ["activation-evidence-generation-changed"]
          : currentStatus.missing_activation_gates;
        activationRevoked = activationError(
          "orchestration_worker_activation_revoked_unfenced",
          revocationReasons,
        );
        try {
          shutdownTask = Promise.resolve(worker.shutdown());
        } catch (error) {
          shutdownTask = Promise.reject(error);
        }
      }
    }, activationRecheckIntervalMs);
    monitor.unref?.();

    try {
      await runPromise;
    } catch (error) {
      runFailure = error;
    }
    if (shutdownTask) {
      try {
        await shutdownTask;
      } catch (error) {
        runFailure ??= error;
      }
    }
  } finally {
    if (monitor) {
      clearIntervalImpl(monitor);
    }
    await connection.close();
  }
  if (activationRevoked) {
    throw activationRevoked;
  }
  if (runFailure) {
    throw runFailure;
  }
}

export async function retireOrchestrationGeneration(
  config,
  {
    cancelOutstandingRuns = cancelOutstandingOrchestrationRuns,
    confirmationScans = RETIREMENT_CONFIRMATION_SCANS,
    connect = (options) => NativeConnection.connect(options),
    createWorker = (options) => Worker.create(options),
    listOutstandingRuns = listOutstandingOrchestrationRuns,
    now = () => new Date(),
    reportRetry = reportGenerationRetirementRetry,
    retryIntervalMs = RETIREMENT_RETRY_INTERVAL_MS,
    sleep = delay,
    verifyTerminalRuns = verifyTerminalOrchestrationRuns,
  } = {},
) {
  assertPositiveInteger(confirmationScans, "confirmationScans");
  const startedAt = now();
  assertDate(startedAt, "now");
  const retirement = resolveGenerationRetirement(config, {
    now: startedAt.getTime(),
  });
  if (!retirement.valid) {
    throw retirementError(retirement.status);
  }

  const observed = new Map();
  let drainCycleCount = 0;
  while (true) {
    drainCycleCount += 1;
    const stagedExecutions = await stageGenerationRetirementCancellations(
      config,
      {
        cancelOutstandingRuns,
        confirmationScans,
        reportRetry,
        retryIntervalMs,
        sleep,
        workflowTaskQueue: retirement.workflowTaskQueue,
      },
    );
    mergeExecutions(observed, stagedExecutions);

    const drainedExecutions = await runGenerationRetirementWorkerCycle(
      config,
      {
        cancelOutstandingRuns,
        confirmationScans,
        connect,
        createWorker,
        reportRetry,
        retryIntervalMs,
        seedExecutions: [...observed.values()],
        sleep,
        verifyTerminalRuns,
        workflowTaskQueue: retirement.workflowTaskQueue,
      },
    );
    mergeExecutions(observed, drainedExecutions);

    const residualExecutions = await scanPostStopResidualExecutions(config, {
      confirmationScans,
      listOutstandingRuns,
      reportRetry,
      retryIntervalMs,
      sleep,
      workflowTaskQueue: retirement.workflowTaskQueue,
    });
    if (residualExecutions.length === 0) {
      return createGenerationRetirementReceipt(retirement, {
        cancelSignalTargetCount: observed.size,
        drainCycleCount,
        postStopEmptyScans: confirmationScans,
        recordedAt: retirementRecordedAt(now),
        retirementStartedAt: startedAt.toISOString(),
        terminalProjectionCount: observed.size,
      });
    }
    mergeExecutions(observed, residualExecutions);
  }
}

export async function cancelOutstandingOrchestrationRuns(
  config,
  {
    connect = (options) => Connection.connect(options),
    createClient = (options) => new Client(options),
    workflowTaskQueue = null,
  } = {},
) {
  const taskQueue = workflowTaskQueue ?? workflowTaskQueueForControl(config);
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  try {
    const client = createClient({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
    });
    const executions = client.workflow.list({
      query:
        `WorkflowType = '${VALIDATION_READINESS_WORKFLOW_TYPE}' ` +
        `AND TaskQueue = '${taskQueue}' ` +
        "AND ExecutionStatus = 'Running'",
    });
    const observed = [];

    for await (const execution of executions) {
      const executionRef = {
        workflowId: execution.workflowId,
        runId: execution.runId,
      };
      observed.push(executionRef);
      try {
        await client.workflow
          .getHandle(execution.workflowId, execution.runId)
          .signal(RUN_CONTROL_SIGNAL, generationRetirementControl(executionRef));
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) {
          throw error;
        }
      }
    }

    return observed;
  } finally {
    await connection.close();
  }
}

export async function listOutstandingOrchestrationRuns(
  config,
  {
    connect = (options) => Connection.connect(options),
    createClient = (options) => new Client(options),
    workflowTaskQueue = null,
  } = {},
) {
  const taskQueue = workflowTaskQueue ?? workflowTaskQueueForControl(config);
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  try {
    const client = createClient({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
    });
    const executions = client.workflow.list({
      query:
        `WorkflowType = '${VALIDATION_READINESS_WORKFLOW_TYPE}' ` +
        `AND TaskQueue = '${taskQueue}' ` +
        "AND ExecutionStatus = 'Running'",
    });
    const observed = [];
    for await (const execution of executions) {
      observed.push({
        workflowId: execution.workflowId,
        runId: execution.runId,
      });
    }
    return assertExecutionRefs(observed);
  } finally {
    await connection.close();
  }
}

export async function verifyTerminalOrchestrationRuns(
  config,
  executions,
  {
    connect = (options) => Connection.connect(options),
    createClient = (options) => new Client(options),
  } = {},
) {
  if (executions.length === 0) {
    return 0;
  }
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  try {
    const client = createClient({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
    });
    for (const execution of executions) {
      const projection = assertRunProjection(
        await client.workflow
          .getHandle(execution.workflowId, execution.runId)
          .result(),
      );
      if (!TERMINAL_RUN_STATES.has(projection.state)) {
        throw new Error(
          "Generation retirement did not resolve a terminal run projection.",
        );
      }
    }
    return executions.length;
  } finally {
    await connection.close();
  }
}

async function runGenerationRetirementWorkerCycle(
  config,
  {
    cancelOutstandingRuns,
    confirmationScans,
    connect,
    createWorker,
    reportRetry,
    retryIntervalMs,
    seedExecutions,
    sleep,
    workflowTaskQueue,
    verifyTerminalRuns,
  },
) {
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  let worker = null;
  let runPromise = null;
  let shutdownRequested = false;
  let workerFailure = null;
  let workerStopped = false;
  try {
    worker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: workflowTaskQueue,
      workflowsPath,
    });
    runPromise = Promise.resolve(worker.run())
      .catch((error) => {
        workerFailure = error;
      })
      .finally(() => {
        workerStopped = true;
      });
    const drainedExecutions = await confirmGenerationRetirement(config, {
      assertWorkerRunning() {
        if (workerStopped) {
          throw workerFailure ?? new Error(
            "The generation-retirement worker stopped before the drain completed.",
          );
        }
      },
      cancelOutstandingRuns,
      confirmationScans,
      reportRetry,
      retryIntervalMs,
      seedExecutions,
      sleep,
      workflowTaskQueue,
      verifyTerminalRuns,
    });
    await worker.shutdown();
    shutdownRequested = true;
    await runPromise;
    if (workerFailure) {
      throw workerFailure;
    }
    return drainedExecutions;
  } finally {
    if (worker && runPromise) {
      if (!shutdownRequested) {
        await worker.shutdown();
      }
      await runPromise.catch(() => {});
    }
    await connection.close();
  }
}

async function stageGenerationRetirementCancellations(
  config,
  {
    cancelOutstandingRuns,
    confirmationScans,
    reportRetry,
    retryIntervalMs,
    sleep,
    workflowTaskQueue,
  },
) {
  const observed = new Map();
  let attempt = 0;
  let consecutiveStableScans = 0;
  while (consecutiveStableScans < confirmationScans) {
    attempt += 1;
    try {
      const executions = assertExecutionRefs(
        await cancelOutstandingRuns(config, { workflowTaskQueue }),
      );
      let newlyObserved = 0;
      for (const execution of executions) {
        const key = executionKey(execution);
        if (!observed.has(key)) {
          observed.set(key, execution);
          newlyObserved += 1;
        }
      }
      consecutiveStableScans = newlyObserved === 0
        ? consecutiveStableScans + 1
        : 0;
    } catch (error) {
      consecutiveStableScans = 0;
      reportRetry({ attempt, error, phase: "stage-cancellation" });
    }
    if (consecutiveStableScans < confirmationScans) {
      await sleep(retryIntervalMs);
    }
  }
  return [...observed.values()];
}

async function confirmGenerationRetirement(
  config,
  {
    assertWorkerRunning,
    cancelOutstandingRuns,
    confirmationScans,
    reportRetry,
    retryIntervalMs,
    seedExecutions = [],
    sleep,
    workflowTaskQueue,
    verifyTerminalRuns,
  },
) {
  const observed = new Map(
    seedExecutions.map((execution) => [executionKey(execution), execution]),
  );
  let attempt = 0;
  let consecutiveEmptyScans = 0;
  while (true) {
    assertWorkerRunning();
    attempt += 1;
    try {
      const executions = assertExecutionRefs(
        await cancelOutstandingRuns(config, { workflowTaskQueue }),
      );
      for (const execution of executions) {
        observed.set(executionKey(execution), execution);
      }
      consecutiveEmptyScans = executions.length === 0
        ? consecutiveEmptyScans + 1
        : 0;
      if (consecutiveEmptyScans >= confirmationScans) {
        const verifiedCount = await verifyTerminalRuns(
          config,
          [...observed.values()],
        );
        if (verifiedCount !== observed.size) {
          throw new Error(
            "Generation retirement did not verify every observed projection.",
          );
        }
        return [...observed.values()];
      }
    } catch (error) {
      consecutiveEmptyScans = 0;
      reportRetry({ attempt, error, phase: "worker-drain" });
    }
    if (consecutiveEmptyScans < confirmationScans) {
      await sleep(retryIntervalMs);
    }
  }
}

async function scanPostStopResidualExecutions(
  config,
  {
    confirmationScans,
    listOutstandingRuns,
    reportRetry,
    retryIntervalMs,
    sleep,
    workflowTaskQueue,
  },
) {
  let attempt = 0;
  let consecutiveEmptyScans = 0;
  while (consecutiveEmptyScans < confirmationScans) {
    attempt += 1;
    try {
      const executions = assertExecutionRefs(
        await listOutstandingRuns(config, { workflowTaskQueue }),
      );
      if (executions.length > 0) {
        return executions;
      }
      consecutiveEmptyScans += 1;
    } catch (error) {
      consecutiveEmptyScans = 0;
      reportRetry({ attempt, error, phase: "post-stop-scan" });
    }
    if (consecutiveEmptyScans < confirmationScans) {
      await sleep(retryIntervalMs);
    }
  }
  return [];
}

function generationRetirementControl({ workflowId, runId }) {
  const key = createHash("sha256")
    .update(`${workflowId}\0${runId}`)
    .digest("hex")
    .slice(0, 32);
  return {
    schema_version: 1,
    control_id: `control:generation-retirement:${key}`,
    action: "cancel",
    operator_id: "system:operator-orchestration-service",
    reason_ref: "policy:orchestration-generation-retirement",
    idempotency_key: `idempotency:generation-retirement:${key}`,
  };
}

function workflowTaskQueueForControl(config) {
  const target = resolveActivationControlTarget(config, {
    processRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  if (!target.valid) {
    throw activationError(
      "orchestration_worker_activation_target_unverified",
      getOrchestrationWorkerActivationMissingConfig(config),
    );
  }
  return validationReadinessWorkflowQueueFor(target.digest);
}

function assertExecutionRefs(executions) {
  if (!Array.isArray(executions)) {
    throw new TypeError(
      "Generation retirement must report the observed execution references.",
    );
  }
  for (const execution of executions) {
    if (
      typeof execution?.workflowId !== "string" ||
      !execution.workflowId ||
      typeof execution?.runId !== "string" ||
      !execution.runId
    ) {
      throw new TypeError(
        "Generation retirement received an invalid execution reference.",
      );
    }
  }
  return executions;
}

function mergeExecutions(target, executions) {
  for (const execution of assertExecutionRefs(executions)) {
    target.set(executionKey(execution), execution);
  }
}

function retirementRecordedAt(now) {
  const recordedAt = now();
  assertDate(recordedAt, "now");
  return recordedAt.toISOString();
}

function assertDate(value, name) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must return a valid Date.`);
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
}

function executionKey({ workflowId, runId }) {
  return `${workflowId}\0${runId}`;
}

function reportGenerationRetirementRetry({ attempt, error, phase }) {
  process.stderr.write(
    `${JSON.stringify({
      event: "orchestration_generation_retirement_retry",
      attempt,
      phase,
      error: error instanceof Error ? error.name : "UnknownError",
    })}\n`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function activationError(code, missingGates) {
  const error = new Error(
    `Orchestration worker activation is denied: ${missingGates.join(", ")}`,
  );
  error.code = code;
  error.missingActivationGates = missingGates;
  return error;
}

function retirementError(status) {
  const error = new Error(
    `Orchestration generation retirement is denied: ${status}`,
  );
  error.code = "orchestration_generation_retirement_denied";
  error.retirementStatus = status;
  return error;
}
