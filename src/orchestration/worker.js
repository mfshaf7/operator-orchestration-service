import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import { getOrchestrationActivationMissingConfig } from "./catalog.js";
import {
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  VALIDATION_READINESS_WORKFLOW_TYPE,
} from "./constants.js";

const workflowsPath = fileURLToPath(
  new URL("./workflows.js", import.meta.url),
);

export function orchestrationWorkerStatus(config) {
  const missing = getOrchestrationActivationMissingConfig(config);
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

export async function runOrchestrationWorker(config) {
  const status = orchestrationWorkerStatus(config);
  if (!status.activation_ready) {
    const error = new Error(
      `Orchestration worker activation is denied: ${status.missing_activation_gates.join(", ")}`,
    );
    error.code = "orchestration_worker_activation_denied";
    throw error;
  }

  const connection = await NativeConnection.connect({
    address: config.orchestration.temporal.address,
  });
  try {
    const worker = await Worker.create({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: VALIDATION_READINESS_WORKFLOW_QUEUE,
      workflowsPath,
    });
    await worker.run();
  } finally {
    await connection.close();
  }
}
