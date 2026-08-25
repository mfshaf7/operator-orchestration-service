import { fileURLToPath } from "node:url";

import { NativeConnection, Worker } from "@temporalio/worker";

import {
  REFINEMENT_ACTIVITY_TASK_QUEUE,
  REFINEMENT_WORKFLOW_TASK_QUEUE,
  REFINEMENT_WORKFLOW_TYPE,
} from "./runtime-constants.js";

const workflowsPath = fileURLToPath(new URL("./workflows.js", import.meta.url));

export function refinementWorkerStatus(config) {
  const enabled = config?.refinement?.workerEnabled === true;
  const authorized = config?.refinement?.executionAuthorized === true;
  return {
    schema_version: 1,
    worker: "operator-orchestration-service-refinement-worker",
    workflow_type: REFINEMENT_WORKFLOW_TYPE,
    workflow_task_queue: REFINEMENT_WORKFLOW_TASK_QUEUE,
    activity_task_queue: REFINEMENT_ACTIVITY_TASK_QUEUE,
    enabled,
    execution_authorized: authorized,
    run_allowed: enabled && authorized,
  };
}

export async function runRefinementWorker(
  config,
  activities,
  {
    connect = (options) => NativeConnection.connect(options),
    createWorker = (options) => Worker.create(options),
  } = {},
) {
  const status = refinementWorkerStatus(config);
  if (!status.run_allowed) {
    throw new Error("Refinement worker activation is not authorized.");
  }
  const connection = await connect({ address: config.orchestration.temporal.address });
  let workflowWorker = null;
  let activityWorker = null;
  try {
    workflowWorker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: REFINEMENT_WORKFLOW_TASK_QUEUE,
      workflowsPath,
    });
    activityWorker = await createWorker({
      activities,
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: REFINEMENT_ACTIVITY_TASK_QUEUE,
    });
    await Promise.all([workflowWorker.run(), activityWorker.run()]);
  } finally {
    await Promise.allSettled(
      [workflowWorker, activityWorker]
        .filter(Boolean)
        .map((worker) => worker.shutdown()),
    );
    await connection.close();
  }
}
