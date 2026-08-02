import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  condition,
  currentUpdateInfo,
  defineQuery,
  defineSignal,
  defineUpdate,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import {
  CONTROLLED_PROOF_ACTIVITY_CALLER_ID,
  CONTROLLED_PROOF_ACTIVITY_FAILURE_TYPES,
  CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE,
  CONTROLLED_PROOF_CONTROL_SIGNAL,
  CONTROLLED_PROOF_PROJECTION_QUERY,
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
  GENERATION_START_REGISTRY_CAPACITY_FAILURE_TYPE,
  GENERATION_START_REGISTRY_SEAL_FAILURE_TYPE,
  GENERATION_START_REGISTRY_SEAL_UPDATE,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  ORCHESTRATION_SCHEMA_VERSION,
  RUN_CONTROL_SIGNAL,
  RUN_PROJECTION_QUERY,
  VALIDATION_READINESS_ACTIVITY_NAME,
  VALIDATION_READINESS_ACTIVITY_QUEUE,
  VALIDATION_READINESS_ACTIVITY_CALLER_ID,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  VALIDATION_READINESS_PROFILE,
  VALIDATION_READINESS_TARGET,
  VALIDATION_READINESS_TIER,
  VALIDATION_READINESS_VALIDATION_SCOPE,
  WGCF_CANCELLED_FAILURE_TYPE,
  WGCF_NON_RETRYABLE_FAILURE_TYPES,
  WGCF_RETRYABLE_FAILURE_TYPES,
} from "./constants.js";
import {
  assertControlledProofActivityRequest,
  assertControlledProofControlBinding,
  assertControlledProofWorkflowInput,
  controlledProofAuthorizationExpiredAt,
  controlledProofStartOutsideAuthorizationAt,
  normalizeControlledProofControlRequest,
} from "./controlled-proof-contracts.js";
import {
  cancelControlledProofRun,
  createControlledProofRunProjection,
  deferControlledProofRun,
  finishControlledProofAttempts,
  projectControlledProofFailure,
  projectControlledProofScenarioEvidence,
  projectControlledProofWgcfResult,
  recordControlledProofControl,
  startControlledProofAttempt,
} from "./controlled-proof-run-projection.js";
import {
  assertGenerationStartRegistration,
  assertGenerationStartRegistrationUpdateId,
  assertGenerationStartRegistryInput,
  assertGenerationStartRegistryResult,
  assertGenerationStartRegistrySealAuthorizedAt,
  assertGenerationStartRegistrySealUpdateId,
} from "./generation-start-registry.js";
import {
  assertRunControl,
  assertWorkflowInput,
  assertWgcfActivityResult,
  isGenerationRetirementControl,
  workflowApprovalExpiredAt,
} from "./workflow-contracts.js";
import {
  cancelRun,
  createRunProjection,
  deferRun,
  finishExhaustedRun,
  projectActivityFailure,
  projectWgcfResult,
  recordRunControl,
  rejectExpiredApproval,
  startRunAttempt,
} from "./run-projection.js";

export const VALIDATION_READINESS_ACTIVITY_OPTIONS = Object.freeze({
  taskQueue: VALIDATION_READINESS_ACTIVITY_QUEUE,
  startToCloseTimeout: "5m",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: Object.freeze({
    initialInterval: "2s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
    maximumInterval: "30s",
    nonRetryableErrorTypes: WGCF_NON_RETRYABLE_FAILURE_TYPES,
  }),
});

const activities = proxyActivities(VALIDATION_READINESS_ACTIVITY_OPTIONS);

const projectionQuery = defineQuery(RUN_PROJECTION_QUERY);
const controlSignal = defineSignal(RUN_CONTROL_SIGNAL);
const controlledProofProjectionQuery = defineQuery(
  CONTROLLED_PROOF_PROJECTION_QUERY,
);
const controlledProofControlSignal = defineSignal(
  CONTROLLED_PROOF_CONTROL_SIGNAL,
);
const generationStartRegistrationUpdate = defineUpdate(
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
);
const generationStartRegistrySealUpdate = defineUpdate(
  GENERATION_START_REGISTRY_SEAL_UPDATE,
);

export async function generationStartRegistryV1(candidate) {
  const registry = assertGenerationStartRegistryInput(candidate);
  const registeredWorkflowIds = new Set();
  let invalidRegistrationCount = 0;
  let sealRef = null;
  let sealAuthorizationDigest = null;
  let sealedAt = null;

  setHandler(
    generationStartRegistrationUpdate,
    (candidate) => {
      const registration = assertGenerationStartRegistration(candidate);
      if (registeredWorkflowIds.has(registration.workflow_id)) {
        return "registered";
      }
      registeredWorkflowIds.add(registration.workflow_id);
      return "registered";
    },
    {
      validator(candidate) {
        const registration = assertGenerationStartRegistrationUpdateId(
          candidate,
          currentUpdateInfo()?.id,
        );
        if (
          registration.activation_evidence_digest !==
            registry.activation_evidence_digest ||
          sealRef !== null
        ) {
          throw new TypeError("The generation start registry is sealed.");
        }
        if (
          !registeredWorkflowIds.has(registration.workflow_id) &&
          registeredWorkflowIds.size >= registry.maximum_registration_count
        ) {
          throw ApplicationFailure.nonRetryable(
            "The activation generation is at capacity.",
            GENERATION_START_REGISTRY_CAPACITY_FAILURE_TYPE,
          );
        }
      },
    },
  );
  setHandler(
    generationStartRegistrySealUpdate,
    (candidate) => {
      const handledAt = now();
      const seal = assertAuthorizedSealUpdate(candidate, handledAt);
      if (sealRef === null) {
        sealRef = seal.retirement_id;
        sealAuthorizationDigest = seal.retirement_evidence_digest;
        sealedAt = handledAt;
      }
      return "sealed";
    },
    {
      validator(candidate) {
        const seal = assertAuthorizedSealUpdate(candidate, now());
        if (
          sealRef !== null &&
          (sealRef !== seal.retirement_id ||
            sealAuthorizationDigest !== seal.retirement_evidence_digest)
        ) {
          throw ApplicationFailure.nonRetryable(
            "The generation start registry is sealed by another authorization.",
            GENERATION_START_REGISTRY_SEAL_FAILURE_TYPE,
          );
        }
      },
    },
  );

  await condition(() => sealRef !== null);
  return assertGenerationStartRegistryResult({
    activation_evidence_digest: registry.activation_evidence_digest,
    business_workflow_task_queue: registry.business_workflow_task_queue,
    invalid_registration_count: invalidRegistrationCount,
    maximum_registration_count: registry.maximum_registration_count,
    registration_update_id_scheme:
      registry.registration_update_id_scheme,
    registered_workflow_ids: [...registeredWorkflowIds].sort(),
    registry_id: registry.registry_id,
    registry_task_queue: registry.registry_task_queue,
    registry_workflow_type: GENERATION_START_REGISTRY_WORKFLOW_TYPE,
    schema_version: 1,
    seal_authorization_digest: sealAuthorizationDigest,
    seal_ref: sealRef,
    sealed_at: sealedAt,
  });
}

function assertAuthorizedSealUpdate(candidate, handledAt) {
  try {
    const seal = assertGenerationStartRegistrySealUpdateId(
      candidate,
      currentUpdateInfo()?.id,
    );
    return assertGenerationStartRegistrySealAuthorizedAt(seal, handledAt);
  } catch (error) {
    throw ApplicationFailure.nonRetryable(
      error instanceof Error
        ? error.message
        : "The generation start registry seal is not authorized.",
      GENERATION_START_REGISTRY_SEAL_FAILURE_TYPE,
    );
  }
}

export async function validationReadinessRunV1(candidate) {
  const info = workflowInfo();
  const startedAt = info.startTime.toISOString();
  const request = assertWorkflowInput(candidate);
  const pendingControls = [];
  const queuedControlKeys = new Set();
  let generationRetirementControlQueued = false;
  let activeActivityScope = null;
  let projection = createRunProjection({
    request,
    runId: info.workflowId,
    temporalExecutionRunId: info.runId,
    timestamp: startedAt,
    workflowId: info.workflowId,
  });

  setHandler(projectionQuery, () => projection);
  setHandler(controlSignal, (candidate) => {
    let control;
    try {
      control = assertRunControl(candidate);
    } catch {
      return;
    }
    const queueResult = enqueueRunControl({
      control,
      projection,
      pendingControls,
      queuedControlKeys,
      generationRetirementControlQueued,
    });
    generationRetirementControlQueued =
      queueResult.generationRetirementControlQueued;
    if (queueResult.cancelActiveActivity) {
      activeActivityScope?.cancel();
    }
  });

  if (workflowApprovalExpiredAt(request, startedAt)) {
    return rejectExpiredApproval(projection, startedAt);
  }

  while (true) {
    const queuedCancelIndex = pendingControls.findIndex(
      (control) => control.action === "cancel",
    );
    if (queuedCancelIndex >= 0) {
      const [control] = pendingControls.splice(queuedCancelIndex, 1);
      projection = recordRunControl(projection, control, now());
      projection = cancelRun(projection, control, now());
      return projection;
    }

    if (!hasAttemptCapacity(projection)) {
      projection = finishExhaustedRun(projection, now());
      return projection;
    }
    projection = startRunAttempt(projection, now());
    const executionAttempt = projection.retry_status.attempts;

    const activityScope = new CancellationScope();
    activeActivityScope = activityScope;
    try {
      const activityInput = activityRequest(
        request,
        projection,
        executionAttempt,
      );
      const result = await activityScope.run(() =>
        activities[VALIDATION_READINESS_ACTIVITY_NAME](
          activityInput,
        ),
      );
      try {
        assertWgcfActivityResult(result, activityInput);
        projection = projectWgcfResult(projection, result, now());
      } catch {
        projection = projectActivityFailure(
          projection,
          { failureType: "WGCF_CONTRACT_REJECTED" },
          now(),
        );
      }
    } catch (error) {
      if (!pendingControls.some((control) => control.action === "cancel")) {
        projection = projectActivityFailure(
          projection,
          { failureType: temporalFailureType(error) },
          now(),
        );
      }
    } finally {
      activeActivityScope = null;
    }

    const cancelIndex = pendingControls.findIndex(
      (control) => control.action === "cancel",
    );
    if (cancelIndex >= 0) {
      const [control] = pendingControls.splice(cancelIndex, 1);
      projection = recordRunControl(projection, control, now());
      projection = cancelRun(projection, control, now());
      return projection;
    }

    if (projection.state === "completed" || projection.state === "cancelled") {
      return projection;
    }
    if (
      projection.state === "failed" &&
      !projection.retry_status.retry_available
    ) {
      projection = finishExhaustedRun(projection, now());
      return projection;
    }

    let executeAgain = false;
    while (!executeAgain) {
      let control = takeAvailableRunControl(pendingControls, projection);
      while (control === null) {
        await condition(() => pendingControls.length > 0);
        control = takeAvailableRunControl(pendingControls, projection);
      }
      projection = recordRunControl(projection, control, now());

      if (control.action === "cancel") {
        projection = cancelRun(projection, control, now());
        return projection;
      }
      if (control.action === "defer") {
        projection = deferRun(projection, control, now());
        continue;
      }
      if (control.action === "retry" || control.action === "resume") {
        executeAgain = true;
      }
    }
  }
}

export async function controlledProofValidationReadinessRunV1(candidate) {
  const info = workflowInfo();
  const startedAt = info.startTime.toISOString();
  const request = assertControlledProofWorkflowInput(candidate);
  const pendingControlEnvelopes = [];
  const queuedControlKeys = new Set();
  let activeActivityScope = null;
  let activeCancellationControlId = null;
  let confirmedCancellationControlId = null;
  let projection = createControlledProofRunProjection({
    request,
    runId: info.workflowId,
    temporalExecutionRunId: info.runId,
    timestamp: startedAt,
  });

  setHandler(controlledProofProjectionQuery, () => projection);
  setHandler(controlledProofControlSignal, (candidate) => {
    let envelope;
    try {
      envelope = normalizeControlledProofControlRequest(candidate);
      assertControlledProofControlBinding(envelope, request, { now: now() });
    } catch {
      return;
    }
    if (
      enqueueControlledProofControl(
        envelope,
        projection,
        pendingControlEnvelopes,
        queuedControlKeys,
      ) && envelope.control.action === "cancel"
    ) {
      if (
        activeActivityScope !== null &&
        activeCancellationControlId === null
      ) {
        activeCancellationControlId = envelope.control.control_id;
        activeActivityScope.cancel();
      }
    }
  });

  if (controlledProofStartOutsideAuthorizationAt(request, startedAt)) {
    return projectControlledProofFailure(
      projection,
      { failureType: CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE },
      startedAt,
    );
  }

  const proofActivities = proxyActivities({
    ...VALIDATION_READINESS_ACTIVITY_OPTIONS,
    taskQueue: request.activity_task_queue,
    retry: {
      ...VALIDATION_READINESS_ACTIVITY_OPTIONS.retry,
      nonRetryableErrorTypes: [
        ...WGCF_NON_RETRYABLE_FAILURE_TYPES,
        ...CONTROLLED_PROOF_ACTIVITY_FAILURE_TYPES,
      ],
    },
  });

  while (true) {
    const cancelEnvelope = takeControlledProofCancel(pendingControlEnvelopes);
    if (cancelEnvelope) {
      projection = recordControlledProofControl(
        projection,
        cancelEnvelope.control,
        now(),
      );
      return cancelControlledProofRun(
        projection,
        cancelEnvelope.control,
        now(),
      );
    }
    if (controlledProofAuthorizationExpiredAt(request, now())) {
      return projectControlledProofFailure(
        projection,
        { failureType: CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE },
        now(),
      );
    }
    if (projection.attempt >= projection.max_attempts) {
      return finishControlledProofAttempts(projection, now());
    }

    projection = startControlledProofAttempt(projection, now());
    const activityInput = controlledProofActivityRequest(
      request,
      projection,
    );
    const activityScope = new CancellationScope();
    activeActivityScope = activityScope;
    try {
      const result = await activityScope.run(() =>
        proofActivities[VALIDATION_READINESS_ACTIVITY_NAME](activityInput),
      );
      try {
        assertWgcfActivityResult(result, activityInput);
        projection = projectControlledProofWgcfResult(
          projection,
          result,
          now(),
        );
      } catch {
        projection = projectControlledProofFailure(
          projection,
          { failureType: "WGCF_CONTRACT_REJECTED" },
          now(),
        );
      }
    } catch (error) {
      if (isCancellation(error) && activeCancellationControlId !== null) {
        confirmedCancellationControlId = activeCancellationControlId;
      } else {
        projection = projectControlledProofFailure(
          projection,
          { failureType: controlledProofTemporalFailureType(error) },
          now(),
        );
      }
    } finally {
      activeActivityScope = null;
      activeCancellationControlId = null;
    }

    const postActivityCancel = takeControlledProofCancel(
      pendingControlEnvelopes,
    );
    if (postActivityCancel) {
      projection = recordControlledProofControl(
        projection,
        postActivityCancel.control,
        now(),
      );
      return cancelControlledProofRun(
        projection,
        postActivityCancel.control,
        now(),
        {
          activityCancellationConfirmed:
            confirmedCancellationControlId ===
            postActivityCancel.control.control_id,
        },
      );
    }
    if (projection.completed_at !== null) {
      return projection;
    }

    let executeAgain = false;
    while (!executeAgain) {
      let envelope = takeAvailableControlledProofControl(
        pendingControlEnvelopes,
        projection,
      );
      while (envelope === null) {
        const remainingAuthorizationMs =
          Date.parse(request.controlled_proof_execution.authorization_expires_at) -
          Date.parse(now());
        if (remainingAuthorizationMs <= 0) {
          return projectControlledProofFailure(
            projection,
            {
              failureType:
                CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE,
            },
            now(),
          );
        }
        const controlReceived = await condition(
          () => pendingControlEnvelopes.length > 0,
          remainingAuthorizationMs,
        );
        if (!controlReceived) {
          return projectControlledProofFailure(
            projection,
            {
              failureType:
                CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE,
            },
            now(),
          );
        }
        envelope = takeAvailableControlledProofControl(
          pendingControlEnvelopes,
          projection,
        );
      }
      const control = envelope.control;
      if (control.action === "signal") {
        return projectControlledProofScenarioEvidence(
          projection,
          envelope,
          now(),
        );
      }
      projection = recordControlledProofControl(projection, control, now());
      if (control.action === "cancel") {
        return cancelControlledProofRun(projection, control, now());
      }
      if (control.action === "defer") {
        projection = deferControlledProofRun(projection, now());
        continue;
      }
      if (control.action === "retry" || control.action === "resume") {
        executeAgain = true;
      }
    }
  }
}

export function takeAvailableRunControl(pendingControls, projection) {
  while (pendingControls.length > 0) {
    const control = pendingControls.shift();
    if (controlIsAvailable(projection, control)) {
      return control;
    }
  }
  return null;
}

export function enqueueRunControl({
  control,
  projection,
  pendingControls,
  queuedControlKeys,
  generationRetirementControlQueued,
}) {
  if (isGenerationRetirementControl(control)) {
    if (generationRetirementControlQueued) {
      return {
        cancelActiveActivity: false,
        generationRetirementControlQueued: true,
      };
    }
    pendingControls.unshift(control);
    return {
      cancelActiveActivity: true,
      generationRetirementControlQueued: true,
    };
  }
  if (!controlIsAvailable(projection, control)) {
    return {
      cancelActiveActivity: false,
      generationRetirementControlQueued,
    };
  }
  if (
    queuedControlKeys.has(control.control_id) ||
    queuedControlKeys.has(control.idempotency_key)
  ) {
    return {
      cancelActiveActivity: false,
      generationRetirementControlQueued,
    };
  }
  if (
    isAttemptControl(control) &&
    pendingControls.some(isAttemptControl)
  ) {
    return {
      cancelActiveActivity: false,
      generationRetirementControlQueued,
    };
  }
  queuedControlKeys.add(control.control_id);
  queuedControlKeys.add(control.idempotency_key);
  pendingControls.push(control);
  return {
    cancelActiveActivity: control.action === "cancel",
    generationRetirementControlQueued,
  };
}

function controlIsAvailable(projection, control) {
  return projection.control_availability.some(
    (entry) => entry.action === control.action && entry.available,
  );
}

function isAttemptControl(control) {
  return control.action === "retry" || control.action === "resume";
}

function hasAttemptCapacity(projection) {
  return (
    projection.retry_status.attempts < projection.retry_status.max_attempts
  );
}

function activityRequest(request, projection, executionAttempt) {
  return {
    schema_version: 1,
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    run_id: projection.runtime.execution_run_id,
    workflow_id: projection.workflow_id,
    source_ref: request.source_ref,
    source_version: request.source_version,
    validation_scope: VALIDATION_READINESS_VALIDATION_SCOPE,
    readiness_target: VALIDATION_READINESS_TARGET,
    profile: VALIDATION_READINESS_PROFILE,
    tier: VALIDATION_READINESS_TIER,
    correlation_id: request.correlation_id,
    causation_id: request.causation_id,
    idempotency_key: `activity:${projection.run_id}:${executionAttempt}`,
    caller_id: VALIDATION_READINESS_ACTIVITY_CALLER_ID,
    operator_id: request.bounded_decision.authority,
  };
}

function controlledProofActivityRequest(request, projection) {
  return assertControlledProofActivityRequest({
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    run_id: projection.runtime.execution_run_id,
    workflow_id: projection.workflow_id,
    source_ref: request.source_ref,
    source_version: request.source_version,
    validation_scope: VALIDATION_READINESS_VALIDATION_SCOPE,
    readiness_target: VALIDATION_READINESS_TARGET,
    profile: VALIDATION_READINESS_PROFILE,
    tier: VALIDATION_READINESS_TIER,
    correlation_id: request.correlation_id,
    causation_id: request.causation_id,
    idempotency_key: `activity:${projection.run_id}:${projection.attempt}`,
    caller_id: CONTROLLED_PROOF_ACTIVITY_CALLER_ID,
    operator_id: request.bounded_decision.authority,
    controlled_proof_execution: request.controlled_proof_execution,
  });
}

function enqueueControlledProofControl(
  envelope,
  projection,
  pendingControlEnvelopes,
  queuedControlKeys,
) {
  const control = envelope.control;
  if (!controlIsAvailable(projection, control)) {
    return false;
  }
  if (
    queuedControlKeys.has(control.control_id) ||
    queuedControlKeys.has(control.idempotency_key)
  ) {
    return false;
  }
  if (
    isAttemptControl(control) &&
    pendingControlEnvelopes.some((entry) => isAttemptControl(entry.control))
  ) {
    return false;
  }
  if (
    control.action === "cancel" &&
    pendingControlEnvelopes.some((entry) => entry.control.action === "cancel")
  ) {
    return false;
  }
  queuedControlKeys.add(control.control_id);
  queuedControlKeys.add(control.idempotency_key);
  pendingControlEnvelopes.push(envelope);
  return true;
}

function takeAvailableControlledProofControl(envelopes, projection) {
  while (envelopes.length > 0) {
    const envelope = envelopes.shift();
    if (controlIsAvailable(projection, envelope.control)) {
      return envelope;
    }
  }
  return null;
}

function takeControlledProofCancel(envelopes) {
  const index = envelopes.findIndex(
    (entry) => entry.control.action === "cancel",
  );
  if (index < 0) return null;
  return envelopes.splice(index, 1)[0];
}

const ADMITTED_ACTIVITY_FAILURE_TYPES = new Set([
  ...WGCF_RETRYABLE_FAILURE_TYPES,
  ...WGCF_NON_RETRYABLE_FAILURE_TYPES,
  WGCF_CANCELLED_FAILURE_TYPE,
]);

export function temporalFailureType(error) {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (ADMITTED_ACTIVITY_FAILURE_TYPES.has(current.type)) {
      return current.type;
    }
    current = current.cause;
  }
  return "WGCF_ACTIVITY_RETRYABLE";
}

function controlledProofTemporalFailureType(error) {
  const admitted = new Set([
    ...ADMITTED_ACTIVITY_FAILURE_TYPES,
    ...CONTROLLED_PROOF_ACTIVITY_FAILURE_TYPES,
  ]);
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (admitted.has(current.type)) {
      return current.type;
    }
    current = current.cause;
  }
  return "WGCF_ACTIVITY_RETRYABLE";
}

function now() {
  return new Date().toISOString();
}
