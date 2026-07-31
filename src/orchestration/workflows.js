import {
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import {
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
  WGCF_NON_RETRYABLE_FAILURE_TYPES,
} from "./constants.js";
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

const activities = proxyActivities({
  taskQueue: VALIDATION_READINESS_ACTIVITY_QUEUE,
  startToCloseTimeout: "5m",
  retry: {
    initialInterval: "2s",
    backoffCoefficient: 2,
    maximumAttempts: 3,
    maximumInterval: "30s",
    nonRetryableErrorTypes: WGCF_NON_RETRYABLE_FAILURE_TYPES,
  },
});

const projectionQuery = defineQuery(RUN_PROJECTION_QUERY);
const controlSignal = defineSignal(RUN_CONTROL_SIGNAL);

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

function temporalFailureType(error) {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (typeof current.type === "string" && current.type) {
      return current.type;
    }
    current = current.cause;
  }
  return "WGCF_ACTIVITY_RETRYABLE";
}

function now() {
  return new Date().toISOString();
}
