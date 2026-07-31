import {
  ORCHESTRATION_SCHEMA_VERSION,
  VALIDATION_READINESS_ACTIVITY_NAME,
  VALIDATION_READINESS_ACTIVITY_QUEUE,
  VALIDATION_READINESS_MAX_MANUAL_ATTEMPTS,
  VALIDATION_READINESS_NODE_ID,
  VALIDATION_READINESS_SOURCE_DOMAIN,
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  WGCF_CANCELLED_FAILURE_TYPE,
  WGCF_NON_RETRYABLE_FAILURE_TYPES,
} from "./constants.js";
import { assertRunProjection } from "./workflow-contracts.js";

export function createRunProjection({
  request,
  runId,
  temporalExecutionRunId,
  timestamp,
  workflowId,
}) {
  const projection = {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    request_id: request.request_ref,
    run_id: runId,
    workflow_id: workflowId,
    definition_id: request.definition_id,
    definition_version: request.definition_version,
    source_domain: VALIDATION_READINESS_SOURCE_DOMAIN,
    source_record_ref: request.source_ref,
    source_version_ref: request.source_version,
    intent_digest: request.artifact_digest,
    correlation_ref: request.correlation_id,
    causation_ref: request.causation_id,
    caller_ref: request.caller_id,
    operator_ref: request.bounded_decision.authority,
    approval_ref: request.bounded_decision.decision_ref,
    state: "queued",
    current_node: {
      node_id: VALIDATION_READINESS_NODE_ID,
      node_type: "activity",
      label: "Evaluate validation and readiness",
      owner: "workspace-governance-control-fabric",
      state: "queued",
      attempt: 0,
    },
    progress: {
      planned: 1,
      active: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    },
    wait: null,
    blocker: null,
    failure: null,
    retry_status: {
      attempts: 0,
      max_attempts: VALIDATION_READINESS_MAX_MANUAL_ATTEMPTS,
      retry_available: false,
      next_eligible_at: null,
    },
    effect_posture: "none",
    control_availability: [],
    artifact_refs: [],
    log_refs: [],
    receipt_refs: [],
    event_refs: [],
    events: [],
    controls: [],
    aggregate_receipt: null,
    source_projection_ref: request.source_projection_ref,
    source_projection_version: request.source_projection_version,
    runtime: {
      adapter: "temporal",
      execution_run_id: temporalExecutionRunId,
      workflow_type: "validationReadinessRunV1",
      workflow_task_queue: VALIDATION_READINESS_WORKFLOW_QUEUE,
      activity_name: VALIDATION_READINESS_ACTIVITY_NAME,
      activity_task_queue: VALIDATION_READINESS_ACTIVITY_QUEUE,
    },
    created_at: timestamp,
    last_projected_at: timestamp,
    completed_at: null,
  };

  return withEvent(
    withControlAvailability(projection),
    {
      state: "queued",
      summary: "Run accepted and queued for durable execution.",
    },
    timestamp,
  );
}

export function startRunAttempt(projection, timestamp) {
  const attempts = projection.retry_status.attempts + 1;
  const next = {
    ...projection,
    state: "running",
    current_node: {
      ...projection.current_node,
      state: "running",
      attempt: attempts,
    },
    progress: {
      ...projection.progress,
      active: 1,
      failed: 0,
    },
    wait: null,
    blocker: null,
    failure: null,
    retry_status: {
      ...projection.retry_status,
      attempts,
      retry_available: false,
      next_eligible_at: null,
    },
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state: "running",
      summary: `WGCF validation and readiness attempt ${attempts} started.`,
    },
    timestamp,
  );
}

export function rejectExpiredApproval(projection, timestamp) {
  const next = {
    ...projection,
    state: "failed",
    current_node: {
      ...projection.current_node,
      state: "failed",
    },
    progress: {
      ...projection.progress,
      failed: 1,
    },
    failure: {
      failure_id: "failure:approval-expired:0",
      failed_node_id: VALIDATION_READINESS_NODE_ID,
      owner: "operator-orchestration-service",
      failure_type: "approval-expired-before-start",
      detail:
        "The operator approval expired before Temporal recorded durable execution.",
      retryable: false,
      retry_exhausted: true,
    },
    retry_status: {
      ...projection.retry_status,
      retry_available: false,
    },
    aggregate_receipt: aggregateReceipt(
      projection,
      "failed-no-effect",
      projection.receipt_refs,
      projection.artifact_refs,
      timestamp,
    ),
    completed_at: timestamp,
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state: "failed",
      summary:
        "Run ended without execution because its operator approval expired.",
    },
    timestamp,
  );
}

export function projectWgcfResult(projection, result, timestamp) {
  const receiptRefs = appendReceiptReference(
    projection.receipt_refs,
    result.receipt_ref,
  );
  const artifactRefs = unique([
    ...projection.artifact_refs,
    result.artifact_digest,
  ]);

  if (result.status_code === "ready") {
    const next = {
      ...projection,
      state: "completed",
      current_node: {
        ...projection.current_node,
        state: "completed",
      },
      progress: {
        ...projection.progress,
        active: 0,
        completed: 1,
        failed: 0,
      },
      retry_status: {
        ...projection.retry_status,
        retry_available: false,
      },
      effect_posture: "verified",
      artifact_refs: artifactRefs,
      receipt_refs: receiptRefs,
      aggregate_receipt: aggregateReceipt(
        projection,
        "completed",
        receiptRefs,
        artifactRefs,
        timestamp,
      ),
      completed_at: timestamp,
      last_projected_at: timestamp,
    };
    return withEvent(
      withControlAvailability(next),
      {
        state: "completed",
        summary: "Validation and readiness completed with verified evidence.",
      },
      timestamp,
    );
  }

  const retryAvailable =
    projection.retry_status.attempts <
    projection.retry_status.max_attempts;
  const next = {
    ...projection,
    state: "blocked",
    current_node: {
      ...projection.current_node,
      state: "blocked",
    },
    progress: {
      ...projection.progress,
      active: 0,
      failed: 1,
    },
    blocker: {
      blocker_id: `blocker:${projection.run_id}:${projection.retry_status.attempts}`,
      owner: "workspace-governance-control-fabric",
      status_code: result.status_code,
      detail: wgcfResultDetail(result.status_code),
      remediation:
        result.status_code === "blocked"
          ? "Resolve the reported governance finding before resuming the run."
          : "Restore the bounded validation capability before retrying the run.",
      supported_dispositions: ["remove", "defer"],
      evidence_refs: [result.artifact_digest, result.receipt_ref.receipt_id],
    },
    retry_status: {
      ...projection.retry_status,
      retry_available: retryAvailable,
    },
    artifact_refs: artifactRefs,
    receipt_refs: receiptRefs,
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state: "blocked",
      summary: wgcfResultSummary(result.status_code),
    },
    timestamp,
  );
}

export function projectActivityFailure(
  projection,
  { failureType },
  timestamp,
) {
  if (failureType === WGCF_CANCELLED_FAILURE_TYPE) {
    return cancelRun(
      projection,
      {
        control_id: `runtime-cancel:${projection.run_id}`,
        operator_id: "temporal-runtime",
        reason_ref: "temporal:activity-cancelled",
      },
      timestamp,
    );
  }

  const nonRetryable =
    WGCF_NON_RETRYABLE_FAILURE_TYPES.includes(failureType);
  const retryAvailable =
    !nonRetryable &&
    projection.retry_status.attempts <
      projection.retry_status.max_attempts;
  const state = nonRetryable ? "blocked" : "failed";
  const next = {
    ...projection,
    state,
    current_node: {
      ...projection.current_node,
      state,
    },
    progress: {
      ...projection.progress,
      active: 0,
      failed: 1,
    },
    blocker: nonRetryable
      ? {
          blocker_id: `blocker:${projection.run_id}:${projection.retry_status.attempts}`,
          owner: "operator-orchestration-service",
          status_code: "contract-rejected",
          detail: "The owner activity rejected the admitted execution boundary.",
          remediation:
            "Correct the source request or definition version and start a new run.",
          supported_dispositions: ["remove", "defer"],
          evidence_refs: [],
        }
      : null,
    failure: nonRetryable
      ? null
      : {
          failure_id: `failure:${projection.run_id}:${projection.retry_status.attempts}`,
          failed_node_id: VALIDATION_READINESS_NODE_ID,
          owner: "workspace-governance-control-fabric",
          failure_type: failureType,
          detail: "The owner activity exhausted automatic retries without a bounded result.",
          retryable: retryAvailable,
          retry_exhausted: !retryAvailable,
        },
    retry_status: {
      ...projection.retry_status,
      retry_available: retryAvailable,
    },
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state,
      summary: nonRetryable
        ? "The activity contract was rejected and requires source correction."
        : "The activity exhausted automatic retries before producing a result.",
    },
    timestamp,
  );
}

export function recordRunControl(projection, control, timestamp) {
  if (
    projection.controls.some(
      (entry) =>
        entry.control_id === control.control_id ||
        entry.idempotency_key === control.idempotency_key,
    )
  ) {
    return projection;
  }

  const recordedControl = {
    ...control,
    recorded_at: timestamp,
  };
  const next = {
    ...projection,
    controls: [...projection.controls, recordedControl].slice(-16),
    last_projected_at: timestamp,
  };

  return withEvent(
    next,
    {
      state: projection.state,
      summary: `Operator control ${control.action} was accepted.`,
    },
    timestamp,
  );
}

export function deferRun(projection, control, timestamp) {
  const next = {
    ...projection,
    state: "waiting",
    current_node: {
      ...projection.current_node,
      state: "waiting",
    },
    wait: {
      wait_id: `wait:${projection.run_id}:${projection.controls.length}`,
      kind: "authority-decision",
      owner: control.operator_id,
      reason_ref: control.reason_ref,
      expected_signal: "retry, resume, or cancel",
      entered_at: timestamp,
      deadline: null,
      timeout_behavior: "remain-waiting",
    },
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state: "waiting",
      summary: "Run deferred pending an explicit operator control.",
    },
    timestamp,
  );
}

export function cancelRun(projection, control, timestamp) {
  const artifactRefs = [...projection.artifact_refs];
  const receiptRefs = projection.receipt_refs.map((reference) => ({
    ...reference,
  }));
  const next = {
    ...projection,
    state: "cancelled",
    current_node: {
      ...projection.current_node,
      state: "cancelled",
    },
    progress: {
      ...projection.progress,
      active: 0,
    },
    wait: null,
    retry_status: {
      ...projection.retry_status,
      retry_available: false,
    },
    aggregate_receipt: aggregateReceipt(
      projection,
      projection.effect_posture === "none"
        ? "cancelled-no-effect"
        : "cancelled-with-retained-evidence",
      receiptRefs,
      artifactRefs,
      timestamp,
    ),
    completed_at: timestamp,
    last_projected_at: timestamp,
  };

  return withEvent(
    withControlAvailability(next),
    {
      state: "cancelled",
      summary: `Run cancelled by ${control.operator_id}.`,
    },
    timestamp,
  );
}

export function finishExhaustedRun(projection, timestamp) {
  if (
    projection.state !== "failed" ||
    projection.retry_status.retry_available
  ) {
    return projection;
  }
  const next = {
    ...projection,
    aggregate_receipt: aggregateReceipt(
      projection,
      projection.effect_posture === "none"
        ? "failed-no-effect"
        : "failed-with-retained-evidence",
      projection.receipt_refs,
      projection.artifact_refs,
      timestamp,
    ),
    completed_at: timestamp,
    last_projected_at: timestamp,
  };
  return withControlAvailability(next);
}

export function assertProjection(projection) {
  return assertRunProjection(projection);
}

function withControlAvailability(projection) {
  const terminal =
    ["completed", "cancelled"].includes(projection.state) ||
    (projection.state === "failed" && projection.completed_at !== null);
  const blocked = projection.state === "blocked";
  const failed = projection.state === "failed";
  const blockedOrFailed = blocked || failed;
  const waiting = projection.state === "waiting";
  const retryAvailable = failed && projection.retry_status.retry_available;
  const resumeAvailable =
    (blocked || waiting) && projection.retry_status.retry_available;

  return {
    ...projection,
    control_availability: [
      control(
        "retry",
        retryAvailable,
        "Re-run the owner activity with a new bounded execution attempt.",
        retryAvailable ? null : "Retry is not available in the current state.",
      ),
      control(
        "resume",
        resumeAvailable,
        "Resume after the external blocker or authority condition is resolved.",
        resumeAvailable
          ? null
          : "Resume is unavailable without a remaining execution attempt.",
      ),
      control(
        "signal",
        false,
        "Provide a definition-owned external signal.",
        "This definition has no data-bearing signal.",
      ),
      control(
        "defer",
        blockedOrFailed && !terminal,
        "Keep the run waiting for a later operator decision.",
        blockedOrFailed && !terminal
          ? null
          : "Defer is available only for a blocked or failed run.",
      ),
      control(
        "cancel",
        !terminal,
        "End the run while retaining already-recorded evidence.",
        terminal ? "The run is already terminal." : null,
      ),
    ],
  };
}

function control(action, available, expectedEffect, disabledReason) {
  return {
    action,
    available,
    authority: "operator",
    expected_effect: expectedEffect,
    disabled_reason: disabledReason,
  };
}

function withEvent(projection, event, timestamp) {
  const sequence = (projection.events.at(-1)?.sequence ?? 0) + 1;
  const eventId = `event:${projection.run_id}:${sequence}`;
  const events = [
    ...projection.events,
    {
      event_id: eventId,
      sequence,
      state: event.state,
      node_id: projection.current_node?.node_id ?? null,
      summary: event.summary,
      occurred_at: timestamp,
    },
  ].slice(-32);
  return assertRunProjection({
    ...projection,
    event_refs: events.map((entry) => entry.event_id),
    events,
    last_projected_at: timestamp,
  });
}

function aggregateReceipt(
  projection,
  outcome,
  receiptRefs,
  artifactRefs,
  timestamp,
) {
  return {
    receipt_id: `receipt:${projection.run_id}`,
    receipt_type: "orchestration-validation-readiness-receipt",
    outcome,
    request_id: projection.request_id,
    run_id: projection.run_id,
    source_record_ref: projection.source_record_ref,
    source_version_ref: projection.source_version_ref,
    intent_digest: projection.intent_digest,
    caller_ref: projection.caller_ref,
    operator_ref: projection.operator_ref,
    approval_ref: projection.approval_ref,
    source_projection_ref: projection.source_projection_ref,
    source_projection_version: projection.source_projection_version,
    receipt_refs: receiptRefs.map((reference) => ({ ...reference })),
    artifact_refs: [...artifactRefs],
    recorded_at: timestamp,
  };
}

function wgcfResultDetail(statusCode) {
  const details = {
    blocked: "WGCF produced a terminal blocked governance decision.",
    "timed-out": "WGCF validation reached its bounded execution timeout.",
    unavailable: "WGCF proved that a required local execution capability is unavailable.",
  };
  return details[statusCode] ?? "WGCF returned a non-ready terminal result.";
}

function wgcfResultSummary(statusCode) {
  const summaries = {
    blocked: "Validation or readiness produced a blocked decision.",
    "timed-out": "Validation timed out before a ready decision.",
    unavailable: "A required validation capability is unavailable.",
  };
  return summaries[statusCode] ?? "Validation did not produce a ready decision.";
}

function unique(values) {
  return [...new Set(values)];
}

function appendReceiptReference(receiptRefs, receiptRef) {
  const retained = receiptRefs.find(
    (reference) => reference.receipt_id === receiptRef.receipt_id,
  );
  if (retained) {
    if (retained.digest !== receiptRef.digest) {
      throw new Error("A retained receipt id cannot resolve to another digest.");
    }
    return receiptRefs.map((reference) => ({ ...reference }));
  }
  return [
    ...receiptRefs.map((reference) => ({ ...reference })),
    {
      receipt_id: receiptRef.receipt_id,
      digest: receiptRef.digest,
    },
  ];
}
