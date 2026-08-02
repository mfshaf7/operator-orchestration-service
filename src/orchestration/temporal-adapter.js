import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
  WithStartWorkflowOperation,
} from "@temporalio/client";

import {
  CONTROLLED_PROOF_CONTROL_SIGNAL,
  CONTROLLED_PROOF_PROJECTION_QUERY,
  CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY,
  CONTROLLED_PROOF_WORKFLOW_TYPE,
  GENERATION_START_REGISTRY_CAPACITY_FAILURE_TYPE,
  GENERATION_START_REGISTRY_MAX_REGISTRATIONS,
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  RUN_BINDING_MEMO_KEY,
  RUN_CONTROL_SIGNAL,
  RUN_PROJECTION_QUERY,
  VALIDATION_READINESS_WORKFLOW_TYPE,
  generationStartRegistryTaskQueueFor,
  generationStartRegistryWorkflowIdFor,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import {
  controlledProofRunIdFor,
  controlledProofWorkflowInputFor,
  normalizeControlledProofRunBindings,
  normalizeControlledProofRunId,
  toControlledProofRunBindings,
} from "./controlled-proof-contracts.js";
import { createControlledProofOwnerReceipt } from "./controlled-proof-evidence.js";
import { assertControlledProofRunProjection } from "./controlled-proof-run-projection.js";
import {
  assertRunProjection,
  normalizeTemporalRunBindings,
  normalizeValidationReadinessRunId,
  toTemporalRunBindings,
  toTemporalWorkflowInput,
  validationReadinessRunIdFor,
} from "./contracts.js";
import {
  generationStartRegistrationFor,
  generationStartRegistrationUpdateIdFor,
  generationStartRegistryInputFor,
} from "./generation-start-registry.js";

export class OrchestrationGenerationCapacityExhaustedError extends Error {
  constructor(activationEvidenceDigest, { cause } = {}) {
    super(
      "The active orchestration generation has reached its bounded start capacity.",
      { cause },
    );
    this.name = "OrchestrationGenerationCapacityExhaustedError";
    this.activationEvidenceDigest = activationEvidenceDigest;
    this.maximumRegistrationCount =
      GENERATION_START_REGISTRY_MAX_REGISTRATIONS;
  }
}

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

export class ControlledProofRunBindingUnverifiedError extends Error {
  constructor(runId, { cause } = {}) {
    super("The retained controlled proof run binding could not be verified.", {
      cause,
    });
    this.name = "ControlledProofRunBindingUnverifiedError";
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
      await registerGenerationStart(client, {
        activationEvidenceDigest,
        workflowId,
      });
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

    async startControlledProofRun(
      contextRecord,
      execution,
    ) {
      const client = await getClient();
      const workflowInput = controlledProofWorkflowInputFor(
        contextRecord.context,
        execution,
      );
      const workflowId = controlledProofRunIdFor(execution);
      const runBindings = toControlledProofRunBindings(workflowInput);
      let handle;
      let duplicate = false;
      try {
        handle = await client.workflow.start(CONTROLLED_PROOF_WORKFLOW_TYPE, {
          args: [workflowInput],
          taskQueue: workflowInput.workflow_task_queue,
          workflowId,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          memo: {
            [CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY]: runBindings,
          },
        });
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          throw error;
        }
        duplicate = true;
        handle = client.workflow.getHandle(workflowId);
      }

      if (!duplicate) {
        return {
          bindings: runBindings,
          duplicate: false,
          ownerReceipt: null,
          projection: null,
          runId: workflowId,
        };
      }

      const description = await handle.describe();
      let bindings;
      try {
        bindings = normalizeControlledProofRunBindings(
          description.memo?.[CONTROLLED_PROOF_RUN_BINDING_MEMO_KEY],
        );
      } catch (error) {
        throw new ControlledProofRunBindingUnverifiedError(workflowId, {
          cause: error,
        });
      }
      const projection =
        description.status.name === "RUNNING"
          ? null
          : assertControlledProofRunProjection(await handle.result());
      return {
        bindings,
        duplicate: true,
        ...controlledProofTerminalResult(contextRecord, projection),
        runId: workflowId,
      };
    },

    async getControlledProofRun(runId, contextRecord) {
      const workflowId = normalizeControlledProofRunId(runId);
      const client = await getClient();
      try {
        const projection = await readRetainedControlledProofProjection(
          client.workflow.getHandle(workflowId),
        );
        return {
          runId: workflowId,
          ...controlledProofTerminalResult(contextRecord, projection),
        };
      } catch (error) {
        throwRunNotFound(error, workflowId);
      }
    },

    async controlControlledProofRun(
      runId,
      controlEnvelope,
      contextRecord,
    ) {
      const workflowId = normalizeControlledProofRunId(runId);
      const client = await getClient();
      const handle = client.workflow.getHandle(workflowId);
      let signalError = null;
      try {
        await handle.signal(CONTROLLED_PROOF_CONTROL_SIGNAL, controlEnvelope);
      } catch (error) {
        signalError = error;
      }

      let projection;
      try {
        projection = await readRetainedControlledProofProjection(handle);
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          throw new OrchestrationRunNotFoundError(workflowId, { cause: error });
        }
        throw signalError ?? error;
      }

      const controlOutcome = retainedControlOutcome(
        projection,
        controlEnvelope.control,
      );
      if (controlOutcome.status === "conflict") {
        throw new OrchestrationControlIdempotencyConflictError(
          workflowId,
          controlEnvelope.control,
          projection,
          controlOutcome.mismatchedFields,
          signalError ? { cause: signalError } : {},
        );
      }
      if (controlOutcome.status !== "matched") {
        throw new OrchestrationControlNotAppliedError(
          workflowId,
          controlEnvelope.control,
          projection,
          signalError ? { cause: signalError } : {},
        );
      }
      return {
        runId: workflowId,
        ...controlledProofTerminalResult(contextRecord, projection),
      };
    },
  };
}

async function registerGenerationStart(
  client,
  { activationEvidenceDigest, workflowId },
) {
  const registry = generationStartRegistryInputFor(
    activationEvidenceDigest,
  );
  const startWorkflowOperation = new WithStartWorkflowOperation(
    GENERATION_START_REGISTRY_WORKFLOW_TYPE,
    {
      args: [registry],
      taskQueue: generationStartRegistryTaskQueueFor(
        activationEvidenceDigest,
      ),
      workflowId: generationStartRegistryWorkflowIdFor(
        activationEvidenceDigest,
      ),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    },
  );
  let registrationStatus;
  try {
    registrationStatus = await client.workflow.executeUpdateWithStart(
      GENERATION_START_REGISTRY_REGISTER_UPDATE,
      {
        args: [
          generationStartRegistrationFor(
            activationEvidenceDigest,
            workflowId,
          ),
        ],
        startWorkflowOperation,
        updateId: generationStartRegistrationUpdateIdFor(
          activationEvidenceDigest,
          workflowId,
        ),
      },
    );
  } catch (error) {
    if (
      errorHasTemporalFailureType(
        error,
        GENERATION_START_REGISTRY_CAPACITY_FAILURE_TYPE,
      )
    ) {
      throw new OrchestrationGenerationCapacityExhaustedError(
        activationEvidenceDigest,
        { cause: error },
      );
    }
    throw error;
  }
  if (registrationStatus !== "registered") {
    throw new Error(
      `The activation generation did not admit the workflow start: ${registrationStatus}.`,
    );
  }
}

function errorHasTemporalFailureType(error, expectedType) {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current.type === expectedType) {
      return true;
    }
    current = current.cause;
  }
  return false;
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

async function readRetainedControlledProofProjection(handle, knownStatusName) {
  const statusName = knownStatusName ?? (await handle.describe()).status.name;
  if (statusName !== "RUNNING") {
    return assertControlledProofRunProjection(await handle.result());
  }
  try {
    return assertControlledProofRunProjection(
      await handle.query(CONTROLLED_PROOF_PROJECTION_QUERY),
    );
  } catch (queryError) {
    const currentStatusName = (await handle.describe()).status.name;
    if (currentStatusName !== "RUNNING") {
      return assertControlledProofRunProjection(await handle.result());
    }
    throw queryError;
  }
}

function controlledProofTerminalResult(contextRecord, projection) {
  try {
    return {
      projection,
      ownerReceipt:
        projection?.completed_at === null || projection === null
          ? null
          : createControlledProofOwnerReceipt({
              context: contextRecord.context,
              contextDigest: contextRecord.contextDigest,
              projection,
            }),
    };
  } catch (error) {
    throw new ControlledProofRunBindingUnverifiedError(
      projection?.run_id ?? "controlled-proof-run",
      { cause: error },
    );
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
