import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

import { assertRefinementRunProjection } from "./contracts.js";
import {
  assertRefinementRunBinding,
  refinementRunBinding,
  refinementRunId,
} from "./run-model.js";
import {
  REFINEMENT_PROJECTION_QUERY,
  REFINEMENT_RUN_BINDING_MEMO_KEY,
  REFINEMENT_WORKFLOW_TASK_QUEUE,
  REFINEMENT_WORKFLOW_TYPE,
} from "./runtime-constants.js";

export class RefinementRuntimeError extends Error {
  constructor(code, message, { cause = null, retryable = false } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RefinementRuntimeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function createInactiveRefinementRunAdapter() {
  return {
    async getRun() {
      throw new RefinementRuntimeError("run_not_found", "Refinement run not found.");
    },
    async listRuns() {
      return [];
    },
    async startRun() {
      throw new RefinementRuntimeError(
        "apply_execution_failed",
        "The Refinement durable runtime is not active.",
      );
    },
  };
}

export function createRefinementTemporalAdapter({ config, clientFactory } = {}) {
  let clientPromise = null;
  async function getClient() {
    clientPromise ??= Promise.resolve().then(() =>
      (clientFactory ?? defaultClientFactory)(config),
    );
    try {
      return await clientPromise;
    } catch (error) {
      clientPromise = null;
      throw error;
    }
  }

  async function readProjection(handle, statusName = null) {
    try {
      if (statusName === "RUNNING" || statusName === null) {
        return assertRefinementRunProjection(
          await handle.query(REFINEMENT_PROJECTION_QUERY),
        );
      }
    } catch (error) {
      if (statusName === "RUNNING") throw error;
    }
    return assertRefinementRunProjection(await handle.result());
  }

  return {
    async startRun({ callerId, packet, request }) {
      if (!config?.refinement?.runtimeEnabled) {
        throw new RefinementRuntimeError(
          "apply_execution_failed",
          "The Refinement durable runtime is not active.",
        );
      }
      const client = await getClient();
      const runId = refinementRunId(request);
      const binding = refinementRunBinding(request);
      let handle;
      let duplicate = false;
      try {
        handle = await client.workflow.start(REFINEMENT_WORKFLOW_TYPE, {
          args: [{
            caller_id: callerId,
            packet,
            request,
            submitted_at: new Date().toISOString(),
          }],
          taskQueue: REFINEMENT_WORKFLOW_TASK_QUEUE,
          workflowId: runId,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          memo: { [REFINEMENT_RUN_BINDING_MEMO_KEY]: binding },
        });
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          throw runtimeFailure(error);
        }
        duplicate = true;
        handle = client.workflow.getHandle(runId);
      }
      if (duplicate) {
        const description = await handle.describe();
        try {
          assertRefinementRunBinding(
            description.memo?.[REFINEMENT_RUN_BINDING_MEMO_KEY],
            request,
          );
        } catch (error) {
          throw new RefinementRuntimeError(
            "apply_conflict",
            error.message,
            { cause: error },
          );
        }
        const projection = await readProjection(handle, description.status.name);
        return { ...projection, replayed: true };
      }
      return {
        schema_version: 1,
        request_id: request.request_id,
        correlation_id: request.correlation_id,
        run_id: runId,
        state: "accepted",
        replayed: false,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        poll_ref: `/v1/delivery-refinement/${encodeURIComponent(request.package_ref)}/runs/${encodeURIComponent(runId)}`,
        events: [],
        receipt: null,
        failure: null,
      };
    },

    async getRun(runId) {
      const client = await getClient();
      const handle = client.workflow.getHandle(runId);
      try {
        const description = await handle.describe();
        return await readProjection(handle, description.status.name);
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          throw new RefinementRuntimeError("run_not_found", "Refinement run not found.");
        }
        throw runtimeFailure(error);
      }
    },

    async listRuns({ packageRef, limit = 100 }) {
      if (!config?.refinement?.runtimeEnabled) return [];
      const client = await getClient();
      const results = [];
      for await (const execution of client.workflow.list({
        query: `WorkflowType = '${REFINEMENT_WORKFLOW_TYPE}'`,
      })) {
        if (results.length >= limit) break;
        const binding = execution.memo?.[REFINEMENT_RUN_BINDING_MEMO_KEY];
        if (binding?.package_ref !== packageRef) continue;
        const handle = client.workflow.getHandle(execution.workflowId, execution.runId);
        results.push(await readProjection(handle, execution.status?.name));
      }
      return results.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    },
  };
}

async function defaultClientFactory(config) {
  const connection = await Connection.connect({
    address: config.orchestration.temporal.address,
  });
  return new Client({
    connection,
    identity: config.orchestration.temporal.identity,
    namespace: config.orchestration.temporal.namespace,
  });
}

function runtimeFailure(error) {
  if (error instanceof RefinementRuntimeError) return error;
  return new RefinementRuntimeError(
    "apply_execution_failed",
    error instanceof Error ? error.message : "Refinement durable runtime failed.",
    { cause: error, retryable: true },
  );
}
