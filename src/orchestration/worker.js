import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
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
  GENERATION_START_REGISTRY_SEAL_SIGNAL,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  RUN_BINDING_MEMO_KEY,
  RUN_CONTROL_SIGNAL,
  VALIDATION_READINESS_WORKFLOW_TYPE,
  validationReadinessWorkflowQueueFor,
} from "./constants.js";
import {
  assertRunProjection,
  normalizeTemporalRunBindings,
} from "./contracts.js";
import {
  assertGenerationStartRegistryMatches,
  generationStartRegistryInputFor,
} from "./generation-start-registry.js";
import {
  assertGenerationStartRegistryAuthorization,
  createGenerationRetirementReceipt,
  createGenerationRetirementReceiptAttestor,
  resolveGenerationRetirement,
} from "./generation-retirement.js";

const workflowsPath = fileURLToPath(
  new URL("./workflows.js", import.meta.url),
);
const ACTIVATION_RECHECK_INTERVAL_MS = 30_000;
const TERMINAL_RUN_STATES = new Set(["cancelled", "completed", "failed"]);
const CLOSED_TEMPORAL_EXECUTION_STATUSES = new Set([
  "CANCELLED",
  "COMPLETED",
  "FAILED",
  "TERMINATED",
  "TIMED_OUT",
]);

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
    registry_task_queue: activation.valid
      ? generationStartRegistryInputFor(activation.digest).registry_task_queue
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
  const workers = [];
  const runPromises = [];
  let rejectActivationRevoked;
  const activationRevokedPromise = new Promise((_, reject) => {
    rejectActivationRevoked = reject;
  });
  void activationRevokedPromise.catch(() => {});
  const requestShutdown = () => {
    if (!shutdownTask) {
      shutdownTask = Promise.all(
        workers.map(async (worker) => worker.shutdown()),
      );
    }
    return shutdownTask;
  };
  try {
    for (const taskQueue of [
      status.task_queue,
      status.registry_task_queue,
    ]) {
      workers.push(
        await createWorker({
          connection,
          identity: config.orchestration.temporal.identity,
          namespace: config.orchestration.temporal.namespace,
          taskQueue,
          workflowsPath,
        }),
      );
    }
    runPromises.push(
      ...workers.map((worker) => Promise.resolve().then(() => worker.run())),
    );
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
        rejectActivationRevoked(activationRevoked);
        void requestShutdown().catch(() => {});
      }
    }, activationRecheckIntervalMs);
    monitor.unref?.();

    try {
      await Promise.race([...runPromises, activationRevokedPromise]);
      if (!shutdownTask) {
        runFailure = new Error(
          "An orchestration worker stopped before its activation was revoked.",
        );
        requestShutdown();
      }
    } catch (error) {
      if (error !== activationRevoked) {
        runFailure = error;
      }
      if (!shutdownTask) {
        requestShutdown();
      }
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
    if (workers.length > 0 && !shutdownTask) {
      try {
        await requestShutdown();
      } catch (error) {
        runFailure ??= error;
      }
    }
    await Promise.allSettled(runPromises);
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
    connect = (options) => NativeConnection.connect(options),
    createWorker = (options) => Worker.create(options),
    now = () => new Date(),
    reconcileRegisteredRuns = reconcileRegisteredOrchestrationRuns,
    sealStartRegistry = sealGenerationStartRegistry,
    verifyTerminalRuns = verifyTerminalOrchestrationRuns,
  } = {},
) {
  const authorizationCheckedAt = now();
  assertDate(authorizationCheckedAt, "now");
  const retirement = resolveGenerationRetirement(config, {
    now: authorizationCheckedAt.getTime(),
  });
  if (!retirement.valid) {
    throw retirementError(retirement.status);
  }
  const receiptAttestor = createGenerationRetirementReceiptAttestor(
    config,
    retirement,
  );

  const sealedRegistryResult = assertGenerationStartRegistryMatches(
    await sealStartRegistry(config, retirement),
    retirement.activationEvidenceDigest,
  );
  const registryAuthorizationCheckedAt = now();
  assertDate(registryAuthorizationCheckedAt, "now");
  const registryAuthorizedRetirement = resolveSameGenerationRetirement(
    config,
    retirement,
    registryAuthorizationCheckedAt,
  );
  const registryResult = assertGenerationStartRegistryAuthorization(
    registryAuthorizedRetirement,
    sealedRegistryResult,
    registryAuthorizationCheckedAt.toISOString(),
  );
  const registryResultDigest = digestCanonicalValue(registryResult);
  const reconciliation = await reconcileRegisteredRuns(
    config,
    registryResult,
    registryAuthorizedRetirement,
  );

  let authorizedRetirement = null;
  let retirementStartedAt = null;
  const terminalProjectionCount = await runGenerationRetirementWorkerCycle(
    config,
    {
      beforeWorkerRun() {
        const workerStart = now();
        assertDate(workerStart, "now");
        authorizedRetirement = resolveSameGenerationRetirement(
          config,
          registryAuthorizedRetirement,
          workerStart,
        );
        retirementStartedAt = workerStart.toISOString();
      },
      connect,
      createWorker,
      executions: reconciliation.executions,
      verifyTerminalRuns,
      workflowTaskQueue: registryAuthorizedRetirement.workflowTaskQueue,
    },
  );

  return createGenerationRetirementReceipt(
    config,
    authorizedRetirement,
    {
      cancelSignalTargetCount: reconciliation.cancelSignalTargetCount,
      matchedExecutionCount: reconciliation.executions.length,
      recordedAt: retirementRecordedAt(now),
      registryResult,
      registryResultDigest,
      retirementStartedAt,
      terminalProjectionCount,
      uncommittedRegistrationCount:
        reconciliation.uncommittedRegistrationCount,
    },
    { attest: receiptAttestor },
  );
}

export async function sealGenerationStartRegistry(
  config,
  retirement,
  {
    connectClient = (options) => Connection.connect(options),
    connectWorker = (options) => NativeConnection.connect(options),
    createClient = (options) => new Client(options),
    createWorker = (options) => Worker.create(options),
    now = () => new Date(),
  } = {},
) {
  if (!retirement?.valid) {
    throw new TypeError("Verified generation-retirement evidence is required.");
  }
  const registryInput = generationStartRegistryInputFor(
    retirement.activationEvidenceDigest,
  );
  const workerConnection = await connectWorker({
    address: config.orchestration.temporal.address,
  });
  let clientConnection = null;
  let worker = null;
  let workerRunPromise = null;
  let shutdownRequested = false;
  try {
    worker = await createWorker({
      connection: workerConnection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: registryInput.registry_task_queue,
      workflowsPath,
    });
    const registryWorkerStart = now();
    assertDate(registryWorkerStart, "now");
    let authorizedRetirement = resolveSameGenerationRetirement(
      config,
      retirement,
      registryWorkerStart,
    );
    workerRunPromise = Promise.resolve(worker.run());
    const workerStoppedBeforeSeal = workerRunPromise.then(
      () => {
        throw new Error(
          "The generation start registry worker stopped before sealing completed.",
        );
      },
      (error) => {
        throw error;
      },
    );
    void workerStoppedBeforeSeal.catch(() => {});

    clientConnection = await connectClient({
      address: config.orchestration.temporal.address,
    });
    const client = createClient({
      connection: clientConnection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
    });
    const sealRequestedAt = now();
    assertDate(sealRequestedAt, "now");
    authorizedRetirement = resolveSameGenerationRetirement(
      config,
      authorizedRetirement,
      sealRequestedAt,
    );
    let handle;
    try {
      handle = await client.workflow.signalWithStart(
        GENERATION_START_REGISTRY_WORKFLOW_TYPE,
        {
          args: [registryInput],
          signal: GENERATION_START_REGISTRY_SEAL_SIGNAL,
          signalArgs: [
            {
              retirement_id: retirement.retirementId,
              retirement_evidence_digest: authorizedRetirement.digest,
              schema_version: 1,
            },
          ],
          taskQueue: registryInput.registry_task_queue,
          workflowId: registryInput.registry_id,
          workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        },
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
        throw error;
      }
      handle = client.workflow.getHandle(registryInput.registry_id);
    }

    const result = await Promise.race([
      handle.result(),
      workerStoppedBeforeSeal,
    ]);
    await worker.shutdown();
    shutdownRequested = true;
    await workerRunPromise;
    return assertGenerationStartRegistryMatches(
      result,
      retirement.activationEvidenceDigest,
    );
  } finally {
    if (worker && workerRunPromise) {
      if (!shutdownRequested) {
        await worker.shutdown();
      }
      await workerRunPromise.catch(() => {});
    }
    if (clientConnection) {
      await clientConnection.close();
    }
    await workerConnection.close();
  }
}

export async function reconcileRegisteredOrchestrationRuns(
  config,
  registryResult,
  retirement,
  {
    connect = (options) => Connection.connect(options),
    createClient = (options) => new Client(options),
    now = () => new Date(),
  } = {},
) {
  if (!retirement?.valid) {
    throw new TypeError("Verified generation-retirement evidence is required.");
  }
  const registry = assertGenerationStartRegistryMatches(
    registryResult,
    retirement.activationEvidenceDigest,
  );
  const connection = await connect({
    address: config.orchestration.temporal.address,
  });
  try {
    const client = createClient({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
    });
    const executions = [];
    let cancelSignalTargetCount = 0;
    let uncommittedRegistrationCount = 0;

    for (const workflowId of registry.registered_workflow_ids) {
      const unresolvedHandle = client.workflow.getHandle(workflowId);
      let description;
      try {
        description = await unresolvedHandle.describe();
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          uncommittedRegistrationCount += 1;
          continue;
        }
        throw error;
      }

      if (description.type !== VALIDATION_READINESS_WORKFLOW_TYPE) {
        throw new Error(
          "A generation registration resolved to an unexpected workflow type.",
        );
      }
      const bindings = normalizeTemporalRunBindings(
        description.memo?.[RUN_BINDING_MEMO_KEY],
      );
      if (
        bindings.activation_evidence_digest !==
          retirement.activationEvidenceDigest
      ) {
        uncommittedRegistrationCount += 1;
        continue;
      }
      if (description.taskQueue !== retirement.workflowTaskQueue) {
        throw new Error(
          "A generation registration resolved to an unexpected workflow task queue.",
        );
      }
      const execution = assertExecutionRefs([
        {
          workflowId,
          runId: description.runId,
        },
      ])[0];
      executions.push(execution);

      if (description.status?.name === "RUNNING") {
        const authorizationTime = now();
        assertDate(authorizationTime, "now");
        resolveSameGenerationRetirement(
          config,
          retirement,
          authorizationTime,
        );
        try {
          await client.workflow
            .getHandle(workflowId, execution.runId)
            .signal(
              RUN_CONTROL_SIGNAL,
              generationRetirementControl(execution),
            );
          cancelSignalTargetCount += 1;
        } catch (error) {
          if (!(error instanceof WorkflowNotFoundError)) {
            throw error;
          }
        }
      } else if (!isClosedTemporalStatus(description.status?.name)) {
        throw new Error(
          "A generation registration resolved to an unsupported execution state.",
        );
      }
    }

    return {
      cancelSignalTargetCount,
      executions,
      uncommittedRegistrationCount,
    };
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
    beforeWorkerRun,
    connect,
    createWorker,
    executions,
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
  try {
    worker = await createWorker({
      connection,
      identity: config.orchestration.temporal.identity,
      namespace: config.orchestration.temporal.namespace,
      taskQueue: workflowTaskQueue,
      workflowsPath,
    });
    beforeWorkerRun();
    runPromise = Promise.resolve(worker.run());
    const workerStoppedBeforeDrain = runPromise.then(
      () => {
        throw new Error(
          "The generation-retirement worker stopped before the drain completed.",
        );
      },
      (error) => {
        throw error;
      },
    );
    const terminalProjectionCount = await Promise.race([
      verifyTerminalRuns(config, executions),
      workerStoppedBeforeDrain,
    ]);
    if (terminalProjectionCount !== executions.length) {
      throw new Error(
        "Generation retirement did not verify every registered execution projection.",
      );
    }
    await worker.shutdown();
    shutdownRequested = true;
    await runPromise;
    return terminalProjectionCount;
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

function resolveSameGenerationRetirement(config, expected, timestamp) {
  const current = resolveGenerationRetirement(config, {
    now: timestamp.getTime(),
  });
  if (!current.valid) {
    throw retirementError(current.status);
  }
  if (
    current.digest !== expected.digest ||
    current.activationEvidenceDigest !== expected.activationEvidenceDigest ||
    current.retirementId !== expected.retirementId ||
    current.workflowTaskQueue !== expected.workflowTaskQueue ||
    canonicalJson(current.startRegistry) !== canonicalJson(expected.startRegistry)
  ) {
    throw retirementError("generation-changed");
  }
  return current;
}

function digestCanonicalValue(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isClosedTemporalStatus(status) {
  return CLOSED_TEMPORAL_EXECUTION_STATUSES.has(status);
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
