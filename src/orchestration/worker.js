import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  Client,
  Connection,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

import { ORCHESTRATION_WORKER_PROCESS_ROLE } from "../config.js";
import { resolveActivationControlTarget } from "./activation-evidence.js";
import { getOrchestrationWorkerActivationMissingConfig } from "./catalog.js";
import {
  RUN_CONTROL_SIGNAL,
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  VALIDATION_READINESS_WORKFLOW_TYPE,
} from "./constants.js";
import { assertRunProjection } from "./contracts.js";

const workflowsPath = fileURLToPath(
  new URL("./workflows.js", import.meta.url),
);
const ACTIVATION_RECHECK_INTERVAL_MS = 30_000;
const ACTIVATION_FENCE_RETRY_INTERVAL_MS = 5_000;
const ACTIVATION_FENCE_CONFIRMATION_SCANS = 7;
const TERMINAL_RUN_STATES = new Set(["cancelled", "completed", "failed"]);

export function orchestrationWorkerStatus(config) {
  const missing = getOrchestrationWorkerActivationMissingConfig(config);
  return {
    schema_version: 1,
    worker: "operator-orchestration-service-workflow-worker",
    workflow_type: VALIDATION_READINESS_WORKFLOW_TYPE,
    task_queue: VALIDATION_READINESS_WORKFLOW_QUEUE,
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
    fenceConfirmationScans = ACTIVATION_FENCE_CONFIRMATION_SCANS,
    fenceRetryIntervalMs = ACTIVATION_FENCE_RETRY_INTERVAL_MS,
    reportFenceRetry = reportActivationFenceRetry,
    setIntervalImpl = setInterval,
    sleep = delay,
    cancelOutstandingRuns = cancelOutstandingOrchestrationRuns,
    verifyTerminalRuns = verifyTerminalOrchestrationRuns,
  } = {},
) {
  const status = orchestrationWorkerStatus(config);
  const admittedTarget = resolveActivationControlTarget(config, {
    processRole: ORCHESTRATION_WORKER_PROCESS_ROLE,
  });
  if (!status.activation_ready) {
    if (admittedTarget.valid) {
      await runDeniedActivationRevocationFence(config, {
        cancelOutstandingRuns,
        connect,
        createWorker,
        confirmationScans: fenceConfirmationScans,
        reportFenceRetry,
        retryIntervalMs: fenceRetryIntervalMs,
        sleep,
        verifyTerminalRuns,
      });
    }
    throw activationError(
      "orchestration_worker_activation_denied",
      status.missing_activation_gates,
    );
  }
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
  let revocationTask = null;
  let runFailure = null;
  try {
    const worker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: VALIDATION_READINESS_WORKFLOW_QUEUE,
      workflowsPath,
    });
    const runPromise = worker.run();
    monitor = setIntervalImpl(() => {
      if (activationRevoked) {
        return;
      }
      const currentStatus = orchestrationWorkerStatus(config);
      if (!currentStatus.activation_ready) {
        activationRevoked = activationError(
          "orchestration_worker_activation_revoked",
          currentStatus.missing_activation_gates,
        );
        revocationTask = confirmActivationRevocationFence(config, {
          cancelOutstandingRuns,
          confirmationScans: fenceConfirmationScans,
          reportFenceRetry,
          retryIntervalMs: fenceRetryIntervalMs,
          sleep,
          verifyTerminalRuns,
        }).then(() => worker.shutdown());
      }
    }, activationRecheckIntervalMs);
    monitor.unref?.();

    try {
      await runPromise;
    } catch (error) {
      runFailure = error;
    }
    if (revocationTask) {
      await revocationTask;
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

export async function cancelOutstandingOrchestrationRuns(
  config,
  {
    connect = (options) => Connection.connect(options),
    createClient = (options) => new Client(options),
  } = {},
) {
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
          .signal(
            RUN_CONTROL_SIGNAL,
            activationRevocationControl(executionRef),
          );
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
          "The activation fence did not resolve a terminal run projection.",
        );
      }
    }
    return executions.length;
  } finally {
    await connection.close();
  }
}

async function runDeniedActivationRevocationFence(
  config,
  {
    cancelOutstandingRuns,
    confirmationScans,
    connect,
    createWorker,
    reportFenceRetry,
    retryIntervalMs,
    sleep,
    verifyTerminalRuns,
  },
) {
  const stagedExecutions = await stageActivationRevocationCancellations(
    config,
    {
      cancelOutstandingRuns,
      confirmationScans,
      reportFenceRetry,
      retryIntervalMs,
      sleep,
    },
  );
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  let worker = null;
  let runPromise = null;
  let shutdownRequested = false;
  try {
    worker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: VALIDATION_READINESS_WORKFLOW_QUEUE,
      workflowsPath,
    });
    runPromise = worker.run();
    await confirmActivationRevocationFence(config, {
      cancelOutstandingRuns,
      confirmationScans,
      reportFenceRetry,
      retryIntervalMs,
      seedExecutions: stagedExecutions,
      sleep,
      verifyTerminalRuns,
    });
    worker.shutdown();
    shutdownRequested = true;
    await runPromise;
  } finally {
    if (worker && runPromise) {
      if (!shutdownRequested) {
        worker.shutdown();
      }
      await runPromise.catch(() => {});
    }
    await connection.close();
  }
}

async function stageActivationRevocationCancellations(
  config,
  {
    cancelOutstandingRuns,
    confirmationScans,
    reportFenceRetry,
    retryIntervalMs,
    sleep,
  },
) {
  const observed = new Map();
  let attempt = 0;
  let consecutiveStableScans = 0;
  while (consecutiveStableScans < confirmationScans) {
    attempt += 1;
    try {
      const executions = assertExecutionRefs(
        await cancelOutstandingRuns(config),
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
      reportFenceRetry({ attempt, error });
    }
    if (consecutiveStableScans < confirmationScans) {
      await sleep(retryIntervalMs);
    }
  }
  return [...observed.values()];
}

async function confirmActivationRevocationFence(
  config,
  {
    cancelOutstandingRuns,
    confirmationScans,
    reportFenceRetry,
    retryIntervalMs,
    seedExecutions = [],
    sleep,
    verifyTerminalRuns,
  },
) {
  const observed = new Map(
    seedExecutions.map((execution) => [executionKey(execution), execution]),
  );
  let attempt = 0;
  let consecutiveEmptyScans = 0;
  while (true) {
    attempt += 1;
    try {
      const executions = assertExecutionRefs(
        await cancelOutstandingRuns(config),
      );
      for (const execution of executions) {
        observed.set(executionKey(execution), execution);
      }
      consecutiveEmptyScans = executions.length === 0
        ? consecutiveEmptyScans + 1
        : 0;
      if (consecutiveEmptyScans >= confirmationScans) {
        await verifyTerminalRuns(config, [...observed.values()]);
        return observed.size;
      }
    } catch (error) {
      consecutiveEmptyScans = 0;
      reportFenceRetry({ attempt, error });
    }
    if (consecutiveEmptyScans < confirmationScans) {
      await sleep(retryIntervalMs);
    }
  }
}

function activationRevocationControl({ workflowId, runId }) {
  const key = createHash("sha256")
    .update(`${workflowId}\0${runId}`)
    .digest("hex")
    .slice(0, 32);
  return {
    schema_version: 1,
    control_id: `control:activation-revocation:${key}`,
    action: "cancel",
    operator_id: "system:operator-orchestration-service",
    reason_ref: "policy:orchestration-activation-revoked",
    idempotency_key: `idempotency:activation-revocation:${key}`,
  };
}

function assertExecutionRefs(executions) {
  if (!Array.isArray(executions)) {
    throw new TypeError(
      "The activation fence must report the observed execution references.",
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
        "The activation fence received an invalid execution reference.",
      );
    }
  }
  return executions;
}

function executionKey({ workflowId, runId }) {
  return `${workflowId}\0${runId}`;
}

function reportActivationFenceRetry({ attempt, error }) {
  process.stderr.write(
    `${JSON.stringify({
      event: "orchestration_activation_fence_retry",
      attempt,
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
