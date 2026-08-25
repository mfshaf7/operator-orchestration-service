import {
  defineQuery,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import {
  REFINEMENT_ACTIVITY_TASK_QUEUE,
  REFINEMENT_PROJECTION_QUERY,
} from "./runtime-constants.js";

const projectionQuery = defineQuery(REFINEMENT_PROJECTION_QUERY);
const activities = proxyActivities({
  taskQueue: REFINEMENT_ACTIVITY_TASK_QUEUE,
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
    maximumInterval: "10 seconds",
  },
});

function now() {
  return new Date(Date.now()).toISOString();
}

function event(runId, sequence, eventType, message, status) {
  return {
    event_id: `${runId}:event:${sequence}`,
    sequence,
    event_type: eventType,
    recorded_at: now(),
    message,
    status,
  };
}

function pollRef(packageRef, runId) {
  return `/v1/delivery-refinement/${encodeURIComponent(packageRef)}/runs/${encodeURIComponent(runId)}`;
}

function activityFailure(error) {
  let current = error;
  while (current) {
    if (typeof current.type === "string" && current.type !== "Error") {
      return {
        code: current.type,
        message: current.message || "Refinement apply failed.",
        retryable: current.nonRetryable !== true,
      };
    }
    current = current.cause;
  }
  return {
    code: "apply_execution_failed",
    message: error instanceof Error ? error.message : "Refinement apply failed.",
    retryable: error?.nonRetryable !== true,
  };
}

export async function deliveryRefinementApplyV1(input) {
  const { caller_id: callerId, packet, request, submitted_at: submittedAt } = input;
  const runId = workflowInfo().workflowId;
  const events = [event(runId, 1, "accepted", "Operator-approved Refinement input was accepted.", "completed")];
  let projection = {
    schema_version: 1,
    request_id: request.request_id,
    correlation_id: request.correlation_id,
    run_id: runId,
    state: "running",
    replayed: false,
    submitted_at: submittedAt,
    updated_at: events[0].recorded_at,
    poll_ref: pollRef(request.package_ref, runId),
    events,
    receipt: null,
    failure: null,
  };
  setHandler(projectionQuery, () => projection);

  const operationResults = [];
  try {
    for (const operation of packet.apply_plan.operations) {
      const sequence = projection.events.length + 1;
      if (operation.status === "skipped") {
        projection = {
          ...projection,
          updated_at: now(),
          events: [
            ...projection.events,
            event(runId, sequence, "operation_skipped", `${operation.label} was skipped by the accepted plan.`, "skipped"),
          ],
        };
        continue;
      }
      projection = {
        ...projection,
        updated_at: now(),
        events: [
          ...projection.events,
          event(runId, sequence, "operation_started", `${operation.label} started.`, "running"),
        ],
      };
      const result = await activities.applyRefinementOperation({
        callerId,
        operation,
        packet,
        request,
      });
      operationResults.push(result);
      projection = {
        ...projection,
        updated_at: now(),
        events: [
          ...projection.events,
          event(runId, projection.events.length + 1, "operation_completed", `${operation.label} completed.`, "completed"),
        ],
      };
    }

    const readback = await activities.readRefinementCanonicalState({
      operationResults,
      packet,
      request,
    });
    projection = {
      ...projection,
      updated_at: now(),
      events: [
        ...projection.events,
        event(runId, projection.events.length + 1, "readback_completed", "Canonical Delivery readback completed.", "completed"),
      ],
    };
    const receipt = await activities.persistRefinementReceipt({
      appliedAt: now(),
      readback,
      request,
      runId,
    });
    projection = {
      ...projection,
      state: "completed",
      updated_at: now(),
      receipt,
    };
    return projection;
  } catch (error) {
    const failure = activityFailure(error);
    projection = {
      ...projection,
      state: "failed",
      updated_at: now(),
      events: [
        ...projection.events,
        event(runId, projection.events.length + 1, "failed", failure.message, "failed"),
      ],
      failure: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
        recovery_ref: `/v1/delivery-refinement/${encodeURIComponent(request.package_ref)}/runs/${encodeURIComponent(runId)}`,
      },
    };
    return projection;
  }
}
