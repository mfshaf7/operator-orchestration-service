import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  RUN_CONTROL_SIGNAL,
  RUN_PROJECTION_QUERY,
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  VALIDATION_READINESS_WORKFLOW_TYPE,
} from "./constants.js";
import {
  assertRunProjection,
  normalizeValidationReadinessRunId,
  toTemporalWorkflowInput,
  validationReadinessRunIdFor,
} from "./contracts.js";

export class OrchestrationRunNotFoundError extends Error {
  constructor(runId, { cause } = {}) {
    super("The durable orchestration run does not exist or is no longer retained.", {
      cause,
    });
    this.name = "OrchestrationRunNotFoundError";
    this.runId = runId;
  }
}

export function createTemporalAdapter({ config, clientFactory } = {}) {
  let clientPromise = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (clientFactory ?? defaultClientFactory)(config);
    }
    return clientPromise;
  }

  return {
    async startRun(request) {
      const client = await getClient();
      const workflowId = workflowIdFor(request);
      const workflowInput = toTemporalWorkflowInput(request);
      let handle;
      let duplicate = false;
      try {
        handle = await client.workflow.start(
          VALIDATION_READINESS_WORKFLOW_TYPE,
          {
            args: [workflowInput],
            taskQueue: VALIDATION_READINESS_WORKFLOW_QUEUE,
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
            workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          },
        );
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          throw error;
        }
        duplicate = true;
        handle = client.workflow.getHandle(workflowId);
      }

      return {
        duplicate,
        projection: duplicate
          ? await readRetainedProjection(handle)
          : assertRunProjection(await queryWithWorkerStartupRetry(handle)),
      };
    },

    async getRun(runId) {
      const workflowId = normalizeValidationReadinessRunId(runId);
      const client = await getClient();
      try {
        return await readRetainedProjection(
          client.workflow.getHandle(workflowId),
        );
      } catch (error) {
        throwRunNotFound(error, workflowId);
      }
    },

    async listRuns({ limit = 50 } = {}) {
      const client = await getClient();
      const projections = [];
      const executions = client.workflow.list({
        query: `WorkflowType = '${VALIDATION_READINESS_WORKFLOW_TYPE}'`,
      });

      for await (const execution of executions) {
        if (projections.length >= limit) {
          break;
        }
        const handle = client.workflow.getHandle(
          execution.workflowId,
          execution.runId,
        );
        projections.push(
          await readRetainedProjection(handle, execution.status?.name),
        );
      }
      return projections;
    },

    async controlRun(runId, control) {
      const workflowId = normalizeValidationReadinessRunId(runId);
      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      try {
        await handle.signal(RUN_CONTROL_SIGNAL, control);
        return await readRetainedProjection(handle);
      } catch (error) {
        throwRunNotFound(error, workflowId);
      }
    },
  };
}

async function defaultClientFactory(config) {
  const connection = await Connection.connect({
    address: config.address,
  });
  return new Client({
    connection,
    namespace: config.namespace,
    identity: config.identity,
  });
}

async function queryWithWorkerStartupRetry(handle) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await handle.query(RUN_PROJECTION_QUERY);
    } catch (error) {
      lastError = error;
      const statusName = (await handle.describe()).status.name;
      if (statusName !== "RUNNING") {
        return await handle.result();
      }
      await delay(100);
    }
  }
  throw lastError;
}

async function readRetainedProjection(handle, knownStatusName) {
  const statusName = knownStatusName ?? (await handle.describe()).status.name;
  if (statusName !== "RUNNING") {
    return assertRunProjection(await handle.result());
  }

  try {
    return assertRunProjection(await handle.query(RUN_PROJECTION_QUERY));
  } catch (queryError) {
    const currentStatusName = (await handle.describe()).status.name;
    if (currentStatusName !== "RUNNING") {
      return assertRunProjection(await handle.result());
    }
    throw queryError;
  }
}

function workflowIdFor(request) {
  return validationReadinessRunIdFor(request);
}

function throwRunNotFound(error, runId) {
  if (error instanceof WorkflowNotFoundError) {
    throw new OrchestrationRunNotFoundError(runId, { cause: error });
  }
  throw error;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
