import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  RUN_BINDING_MEMO_KEY,
  RUN_CONTROL_SIGNAL,
  RUN_PROJECTION_QUERY,
  VALIDATION_READINESS_WORKFLOW_TYPE,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import {
  assertRunProjection,
  normalizeTemporalRunBindings,
  normalizeValidationReadinessRunId,
  toTemporalRunBindings,
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

export class OrchestrationRunBindingUnverifiedError extends Error {
  constructor(runId, { cause } = {}) {
    super("The retained durable run binding could not be verified.", { cause });
    this.name = "OrchestrationRunBindingUnverifiedError";
    this.runId = runId;
  }
}

export class OrchestrationControlNotAppliedError extends Error {
  constructor(runId, control, projection, { cause } = {}) {
    super(
      "The durable orchestration control was not retained before the run state changed.",
      { cause },
    );
    this.name = "OrchestrationControlNotAppliedError";
    this.runId = runId;
    this.action = control.action;
    this.projection = projection;
  }
}

export class OrchestrationControlIdempotencyConflictError extends Error {
  constructor(runId, control, projection, mismatchedFields, { cause } = {}) {
    super(
      "The durable orchestration control keys identify a different immutable control binding.",
      { cause },
    );
    this.name = "OrchestrationControlIdempotencyConflictError";
    this.runId = runId;
    this.action = control.action;
    this.projection = projection;
    this.mismatchedFields = mismatchedFields;
  }
}

export function createTemporalAdapter({ config, clientFactory } = {}) {
  let clientPromise = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = Promise.resolve().then(() =>
        (clientFactory ?? defaultClientFactory)(config),
      );
    }
    const pending = clientPromise;
    try {
      return await pending;
    } catch (error) {
      if (clientPromise === pending) {
        clientPromise = null;
      }
      throw error;
    }
  }

  return {
    async startRun(request, { activationEvidenceDigest }) {
      const client = await getClient();
      const workflowId = workflowIdFor(request);
      const taskQueue = validationReadinessWorkflowQueueFor(
        activationEvidenceDigest,
      );
      const workflowInput = toTemporalWorkflowInput(request, {
        activationEvidenceDigest,
        workflowTaskQueue: taskQueue,
      });
      const runBindings = toTemporalRunBindings(
        request,
        activationEvidenceDigest,
      );
      let handle;
      let duplicate = false;
      try {
        handle = await client.workflow.start(
          VALIDATION_READINESS_WORKFLOW_TYPE,
          {
            args: [workflowInput],
            taskQueue,
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
            workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
            memo: {
              [RUN_BINDING_MEMO_KEY]: runBindings,
            },
          },
        );
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          throw error;
        }
        duplicate = true;
        handle = client.workflow.getHandle(workflowId);
      }

      if (!duplicate) {
        return {
          duplicate: false,
          runId: workflowId,
          bindings: runBindings,
          projection: null,
        };
      }

      const description = await handle.describe();
      let bindings;
      try {
        bindings = normalizeTemporalRunBindings(
          description.memo?.[RUN_BINDING_MEMO_KEY],
        );
      } catch (error) {
        throw new OrchestrationRunBindingUnverifiedError(workflowId, {
          cause: error,
        });
      }
      return {
        duplicate: true,
        runId: workflowId,
        bindings,
        projection:
          description.status.name === "RUNNING"
            ? null
            : assertRunProjection(await handle.result()),
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
      let signalError = null;
      try {
        await handle.signal(RUN_CONTROL_SIGNAL, control);
      } catch (error) {
        signalError = error;
      }

      let projection;
      try {
        projection = await readRetainedProjection(handle);
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          throw new OrchestrationRunNotFoundError(workflowId, {
            cause: error,
          });
        }
        throw signalError ?? error;
      }

      const controlOutcome = retainedControlOutcome(projection, control);
      if (controlOutcome.status === "matched") {
        return projection;
      }
      if (controlOutcome.status === "conflict") {
        throw new OrchestrationControlIdempotencyConflictError(
          workflowId,
          control,
          projection,
          controlOutcome.mismatchedFields,
          signalError ? { cause: signalError } : {},
        );
      }
      throw new OrchestrationControlNotAppliedError(
        workflowId,
        control,
        projection,
        signalError ? { cause: signalError } : {},
      );
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

const IMMUTABLE_CONTROL_FIELDS = Object.freeze([
  "schema_version",
  "control_id",
  "action",
  "operator_id",
  "reason_ref",
  "idempotency_key",
]);

function retainedControlOutcome(projection, control) {
  const exact = projection.controls.find((entry) =>
    IMMUTABLE_CONTROL_FIELDS.every((field) => entry[field] === control[field]),
  );
  if (exact) {
    return { status: "matched" };
  }

  const conflicting =
    projection.controls.find(
      (entry) => entry.control_id === control.control_id,
    ) ??
    projection.controls.find(
      (entry) => entry.idempotency_key === control.idempotency_key,
    );
  if (!conflicting) {
    return { status: "absent" };
  }

  return {
    status: "conflict",
    mismatchedFields: IMMUTABLE_CONTROL_FIELDS.filter(
      (field) => conflicting[field] !== control[field],
    ),
  };
}
