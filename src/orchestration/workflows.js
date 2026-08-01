import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  condition,
  currentUpdateInfo,
  defineQuery,
  defineSignal,
  defineUpdate,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import {
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
  GENERATION_START_REGISTRY_CAPACITY_FAILURE_TYPE,
  GENERATION_START_REGISTRY_SEAL_SIGNAL,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
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
  assertGenerationStartRegistration,
  assertGenerationStartRegistrationUpdateId,
  assertGenerationStartRegistryInput,
  assertGenerationStartRegistryResult,
  assertGenerationStartRegistrySealAuthorizedAt,
} from "./generation-start-registry.js";
import {
  assertRunControl,
  assertWorkflowInput,
  assertWgcfActivityResult,
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
const generationStartRegistrationUpdate = defineUpdate(
  GENERATION_START_REGISTRY_REGISTER_UPDATE,
);
const generationStartRegistrySealSignal = defineSignal(
  GENERATION_START_REGISTRY_SEAL_SIGNAL,
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
  setHandler(generationStartRegistrySealSignal, (candidate) => {
    try {
      const handledAt = now();
      const seal = assertGenerationStartRegistrySealAuthorizedAt(
        candidate,
        handledAt,
      );
      if (sealRef === null) {
        sealRef = seal.retirement_id;
        sealAuthorizationDigest = seal.retirement_evidence_digest;
        sealedAt = handledAt;
      } else if (sealRef !== seal.retirement_id) {
        invalidRegistrationCount += 1;
      }
    } catch {
      // An invalid seal never closes the registry.
    }
  });

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

export async function validationReadinessRunV1(candidate) {
  const info = workflowInfo();
  const startedAt = info.startTime.toISOString();
  const request = assertWorkflowInput(candidate);
  const pendingControls = [];
  const queuedControlKeys = new Set();
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
    if (!controlIsAvailable(projection, control)) {
      return;
    }
    if (
      queuedControlKeys.has(control.control_id) ||
      queuedControlKeys.has(control.idempotency_key)
    ) {
      return;
    }
    if (
      isAttemptControl(control) &&
      pendingControls.some(isAttemptControl)
    ) {
      return;
    }
    queuedControlKeys.add(control.control_id);
    queuedControlKeys.add(control.idempotency_key);
    pendingControls.push(control);
    if (control.action === "cancel") {
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

export function takeAvailableRunControl(pendingControls, projection) {
  while (pendingControls.length > 0) {
    const control = pendingControls.shift();
    if (controlIsAvailable(projection, control)) {
      return control;
    }
  }
  return null;
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

function now() {
  return new Date().toISOString();
}
