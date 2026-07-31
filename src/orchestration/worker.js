import { fileURLToPath } from "node:url";

import { Client, WorkflowNotFoundError } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";

import { getOrchestrationWorkerActivationMissingConfig } from "./catalog.js";
import {
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  VALIDATION_READINESS_WORKFLOW_TYPE,
} from "./constants.js";

const workflowsPath = fileURLToPath(
  new URL("./workflows.js", import.meta.url),
);
const ACTIVATION_RECHECK_INTERVAL_MS = 30_000;
const ACTIVATION_REVOCATION_REASON =
  "OOS durable orchestration activation was revoked.";

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
    setIntervalImpl = setInterval,
    terminateOutstandingRuns = terminateOutstandingOrchestrationRuns,
  } = {},
) {
  const status = orchestrationWorkerStatus(config);
  if (!status.activation_ready) {
    throw activationError(
      "orchestration_worker_activation_denied",
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
        worker.shutdown();
        revocationTask = Promise.resolve()
          .then(() => terminateOutstandingRuns(connection, config))
          .catch((error) => {
            activationRevoked.terminationFailure = error;
          });
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

export async function terminateOutstandingOrchestrationRuns(
  connection,
  config,
  { createClient = (options) => new Client(options) } = {},
) {
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
  let terminated = 0;

  for await (const execution of executions) {
    try {
      await client.workflow
        .getHandle(execution.workflowId, execution.runId)
        .terminate(ACTIVATION_REVOCATION_REASON);
      terminated += 1;
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) {
        throw error;
      }
    }
  }

  return terminated;
}

function activationError(code, missingGates) {
  const error = new Error(
    `Orchestration worker activation is denied: ${missingGates.join(", ")}`,
  );
  error.code = code;
  error.missingActivationGates = missingGates;
  return error;
}
