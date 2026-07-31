import {
  ORCHESTRATION_CONTROL_ACTIONS,
  ORCHESTRATION_SCHEMA_VERSION,
  ORCHESTRATION_RUN_STATES,
  VALIDATION_READINESS_ACTIVITY_NAME,
  VALIDATION_READINESS_ACTIVITY_QUEUE,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  VALIDATION_READINESS_EXPECTED_RECEIPT,
  VALIDATION_READINESS_SOURCE_DOMAIN,
  VALIDATION_READINESS_TIER,
  VALIDATION_READINESS_VALIDATION_SCOPE,
  VALIDATION_READINESS_WORKFLOW_QUEUE,
  VALIDATION_READINESS_WORKFLOW_TYPE,
  WGCF_TERMINAL_STATUS_CODES,
} from "./constants.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const WORKFLOW_INPUT_FIELDS = [
  "artifact_digest",
  "bounded_decision",
  "caller_id",
  "causation_id",
  "correlation_id",
  "definition_id",
  "definition_version",
  "request_ref",
  "schema_version",
  "source_projection_ref",
  "source_projection_version",
  "source_ref",
  "source_version",
  "status_code",
];

const WORKFLOW_DECISION_FIELDS = [
  "authority",
  "decided_at",
  "decision_kind",
  "decision_ref",
  "expires_at",
  "intent_digest",
  "scope_ref",
  "source_version",
];

export class WorkflowContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkflowContractError";
  }
}

const WGCF_RESULT_FIELDS = [
  "activity_id",
  "activity_name",
  "artifact_digest",
  "attempt",
  "bounded_decision",
  "causation_id",
  "correlation_id",
  "definition_id",
  "definition_version",
  "idempotency_key",
  "receipt_ref",
  "run_id",
  "schema_version",
  "source_ref",
  "source_version",
  "status_code",
  "worker_id",
  "workflow_id",
];

const BOUNDED_DECISION_FIELDS = [
  "readiness_decision_ref",
  "readiness_event_ref",
  "readiness_outcome",
  "readiness_reason_count",
  "ready",
  "retryable",
  "terminal",
  "validation_event_ref",
  "validation_outcome",
];

const RECEIPT_REF_FIELDS = [
  "digest",
  "outcome",
  "receipt_id",
  "target_scope",
  "tier",
];

const RUN_PROJECTION_FIELDS = [
  "aggregate_receipt",
  "artifact_refs",
  "blocker",
  "caller_ref",
  "causation_ref",
  "completed_at",
  "control_availability",
  "controls",
  "correlation_ref",
  "created_at",
  "current_node",
  "definition_id",
  "definition_version",
  "effect_posture",
  "event_refs",
  "events",
  "failure",
  "intent_digest",
  "last_projected_at",
  "log_refs",
  "approval_ref",
  "operator_ref",
  "progress",
  "receipt_refs",
  "request_id",
  "retry_status",
  "run_id",
  "runtime",
  "schema_version",
  "source_domain",
  "source_projection_ref",
  "source_projection_version",
  "source_record_ref",
  "source_version_ref",
  "state",
  "wait",
  "workflow_id",
];

const CURRENT_NODE_FIELDS = [
  "attempt",
  "label",
  "node_id",
  "node_type",
  "owner",
  "state",
];
const PROGRESS_FIELDS = ["active", "completed", "failed", "planned", "skipped"];
const WAIT_FIELDS = [
  "deadline",
  "entered_at",
  "expected_signal",
  "kind",
  "owner",
  "reason_ref",
  "timeout_behavior",
  "wait_id",
];
const BLOCKER_FIELDS = [
  "blocker_id",
  "detail",
  "evidence_refs",
  "owner",
  "remediation",
  "status_code",
  "supported_dispositions",
];
const FAILURE_FIELDS = [
  "detail",
  "failed_node_id",
  "failure_id",
  "failure_type",
  "owner",
  "retry_exhausted",
  "retryable",
];
const RETRY_STATUS_FIELDS = [
  "attempts",
  "max_attempts",
  "next_eligible_at",
  "retry_available",
];
const CONTROL_AVAILABILITY_FIELDS = [
  "action",
  "authority",
  "available",
  "disabled_reason",
  "expected_effect",
];
const EVENT_FIELDS = [
  "event_id",
  "node_id",
  "occurred_at",
  "sequence",
  "state",
  "summary",
];
const RECORDED_CONTROL_FIELDS = [
  "action",
  "control_id",
  "idempotency_key",
  "operator_id",
  "reason_ref",
  "recorded_at",
  "schema_version",
];
const AGGREGATE_RECEIPT_FIELDS = [
  "approval_ref",
  "artifact_refs",
  "caller_ref",
  "intent_digest",
  "operator_ref",
  "outcome",
  "receipt_id",
  "receipt_refs",
  "receipt_type",
  "recorded_at",
  "request_id",
  "run_id",
  "source_projection_ref",
  "source_projection_version",
  "source_record_ref",
  "source_version_ref",
];
const RUNTIME_FIELDS = [
  "activity_name",
  "activity_task_queue",
  "adapter",
  "execution_run_id",
  "workflow_task_queue",
  "workflow_type",
];

export function assertWorkflowInput(input, startedAt) {
  requireObject(input, "workflow input");
  requireExactFields(input, WORKFLOW_INPUT_FIELDS, "workflow input");
  requireEqual(
    input.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "workflow input schema_version is unsupported",
  );
  requireEqual(
    input.definition_id,
    VALIDATION_READINESS_DEFINITION_ID,
    "workflow input definition_id is unsupported",
  );
  requireEqual(
    input.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
    "workflow input definition_version is unsupported",
  );
  requireEqual(
    input.status_code,
    "admitted",
    "workflow input status_code is unsupported",
  );
  for (const field of [
    "request_ref",
    "source_ref",
    "source_version",
    "source_projection_ref",
    "source_projection_version",
    "correlation_id",
    "causation_id",
    "caller_id",
  ]) {
    requireIdentifier(input[field], `workflow input ${field}`);
  }
  requireDigest(input.artifact_digest, "workflow input artifact_digest");

  const decision = input.bounded_decision;
  requireObject(decision, "workflow input bounded_decision");
  requireExactFields(
    decision,
    WORKFLOW_DECISION_FIELDS,
    "workflow input bounded_decision",
  );
  requireEqual(
    decision.decision_kind,
    "operator-approved",
    "workflow input decision_kind is unsupported",
  );
  for (const field of ["authority", "scope_ref", "decision_ref", "source_version"]) {
    requireIdentifier(
      decision[field],
      `workflow input bounded_decision.${field}`,
    );
  }
  requireDigest(
    decision.intent_digest,
    "workflow input bounded_decision.intent_digest",
  );
  requireTimestamp(
    decision.decided_at,
    "workflow input bounded_decision.decided_at",
  );
  requireTimestamp(
    decision.expires_at,
    "workflow input bounded_decision.expires_at",
  );
  requireEqual(
    decision.scope_ref,
    input.source_ref,
    "workflow approval scope must match source_ref",
  );
  requireEqual(
    decision.source_version,
    input.source_version,
    "workflow approval source_version must match source_version",
  );
  requireEqual(
    decision.intent_digest,
    input.artifact_digest,
    "workflow approval intent_digest must match artifact_digest",
  );

  const decidedAt = Date.parse(decision.decided_at);
  const expiresAt = Date.parse(decision.expires_at);
  if (expiresAt <= decidedAt || expiresAt - decidedAt > 24 * 60 * 60 * 1000) {
    reject("workflow approval lifetime must be positive and at most 24 hours");
  }
  if (startedAt !== undefined) {
    requireTimestamp(startedAt, "workflow started_at");
    if (expiresAt <= Date.parse(startedAt)) {
      reject("workflow approval expired before durable execution started");
    }
  }
  return input;
}

export function assertWgcfActivityResult(result, expectedRequest) {
  requireObject(result, "WGCF activity result");
  requireExactFields(result, WGCF_RESULT_FIELDS, "WGCF activity result");
  requireObject(expectedRequest, "expected WGCF activity request");
  requireEqual(
    result.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "WGCF result schema_version is unsupported",
  );
  requireEqual(
    result.definition_id,
    VALIDATION_READINESS_DEFINITION_ID,
    "WGCF result definition_id does not match the run",
  );
  requireEqual(
    result.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
    "WGCF result definition_version does not match the run",
  );
  requireEnum(result.status_code, WGCF_TERMINAL_STATUS_CODES, "status_code");
  requireEqual(
    result.activity_name,
    VALIDATION_READINESS_ACTIVITY_NAME,
    "WGCF result activity_name does not match the admitted activity",
  );

  for (const field of [
    "activity_id",
    "workflow_id",
    "run_id",
    "idempotency_key",
    "worker_id",
    "source_ref",
    "source_version",
    "correlation_id",
    "causation_id",
  ]) {
    requireIdentifier(result[field], field);
  }
  if (!Number.isInteger(result.attempt) || result.attempt < 1) {
    reject("attempt must be an integer of at least 1");
  }
  requireDigest(result.artifact_digest, "artifact_digest");

  for (const field of [
    "run_id",
    "workflow_id",
    "source_ref",
    "source_version",
    "correlation_id",
    "causation_id",
    "idempotency_key",
  ]) {
    requireEqual(
      result[field],
      expectedRequest[field],
      `WGCF result ${field} does not match the activity request`,
    );
  }

  requireObject(result.bounded_decision, "bounded_decision");
  requireExactFields(
    result.bounded_decision,
    BOUNDED_DECISION_FIELDS,
    "bounded_decision",
  );
  if (
    typeof result.bounded_decision.ready !== "boolean" ||
    result.bounded_decision.terminal !== true ||
    result.bounded_decision.retryable !== false
  ) {
    reject("WGCF bounded_decision does not carry terminal decision semantics");
  }
  requireEqual(
    result.bounded_decision.ready,
    result.status_code === "ready",
    "WGCF bounded_decision ready state does not match status_code",
  );
  requireEnum(
    result.bounded_decision.validation_outcome,
    ["success", "failure", "blocked", "operator_review_required"],
    "bounded_decision.validation_outcome",
  );
  requireEnum(
    result.bounded_decision.readiness_outcome,
    ["ready", "blocked"],
    "bounded_decision.readiness_outcome",
  );
  if (
    !Number.isInteger(result.bounded_decision.readiness_reason_count) ||
    result.bounded_decision.readiness_reason_count < 0
  ) {
    reject("bounded_decision.readiness_reason_count must be a non-negative integer");
  }
  for (const field of [
    "readiness_decision_ref",
    "readiness_event_ref",
    "validation_event_ref",
  ]) {
    requireIdentifier(
      result.bounded_decision[field],
      `bounded_decision.${field}`,
    );
  }

  requireObject(result.receipt_ref, "receipt_ref");
  requireExactFields(result.receipt_ref, RECEIPT_REF_FIELDS, "receipt_ref");
  requireIdentifier(result.receipt_ref.receipt_id, "receipt_ref.receipt_id");
  requireDigest(result.receipt_ref.digest, "receipt_ref.digest");
  requireEnum(
    result.receipt_ref.outcome,
    ["success", "failure", "blocked", "operator_review_required"],
    "receipt_ref.outcome",
  );
  requireEqual(
    result.receipt_ref.target_scope,
    VALIDATION_READINESS_VALIDATION_SCOPE,
    "WGCF receipt target_scope does not match the admitted validation scope",
  );
  requireEqual(
    result.receipt_ref.tier,
    VALIDATION_READINESS_TIER,
    "WGCF receipt tier does not match the admitted validation tier",
  );
  return result;
}

export function assertRunProjection(projection) {
  requireObject(projection, "run projection");
  requireExactFields(
    projection,
    RUN_PROJECTION_FIELDS,
    "run projection",
  );
  requireEqual(
    projection.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "run projection schema_version is unsupported",
  );
  for (const field of [
    "request_id",
    "run_id",
    "workflow_id",
    "definition_id",
    "source_domain",
    "source_record_ref",
    "source_version_ref",
    "correlation_ref",
    "causation_ref",
    "source_projection_ref",
    "source_projection_version",
    "caller_ref",
    "operator_ref",
    "approval_ref",
  ]) {
    requireIdentifier(projection[field], field);
  }
  requireDigest(projection.intent_digest, "intent_digest");
  requireEqual(
    projection.definition_id,
    VALIDATION_READINESS_DEFINITION_ID,
    "run projection definition_id is unsupported",
  );
  requireEqual(
    projection.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
    "run projection definition_version is unsupported",
  );
  requireEqual(
    projection.source_domain,
    VALIDATION_READINESS_SOURCE_DOMAIN,
    "run projection source_domain is unsupported",
  );
  requireEqual(
    projection.workflow_id,
    projection.run_id,
    "workflow_id must match the stable OOS run_id",
  );
  requireEnum(projection.state, ORCHESTRATION_RUN_STATES, "state");
  requireTimestamp(projection.created_at, "created_at");
  requireTimestamp(projection.last_projected_at, "last_projected_at");
  if (Date.parse(projection.last_projected_at) < Date.parse(projection.created_at)) {
    reject("last_projected_at cannot precede created_at");
  }
  if (projection.completed_at !== null) {
    requireTimestamp(projection.completed_at, "completed_at");
    if (
      Date.parse(projection.completed_at) < Date.parse(projection.created_at) ||
      Date.parse(projection.completed_at) > Date.parse(projection.last_projected_at)
    ) {
      reject("completed_at must fall within the projected run lifetime");
    }
  }

  validateCurrentNode(projection.current_node, projection);
  validateProgress(projection.progress, projection.state);
  validateWait(projection.wait, projection.state);
  validateBlocker(projection.blocker, projection.state);
  validateFailure(projection.failure, projection.state);
  validateRetryStatus(projection.retry_status);
  requireEqual(
    projection.current_node.attempt,
    projection.retry_status.attempts,
    "current_node.attempt must match retry_status.attempts",
  );
  requireEnum(
    projection.effect_posture,
    ["none", "possible", "partial", "verified"],
    "effect_posture",
  );

  for (const field of ["artifact_refs", "log_refs", "receipt_refs"]) {
    requireIdentifierArray(projection[field], field, 32);
  }
  validateControlAvailability(projection.control_availability);
  validateRecordedControls(projection.controls);

  if (!Array.isArray(projection.events) || projection.events.length > 32) {
    reject("events must be a bounded array with at most 32 entries");
  }
  requireIdentifierArray(projection.event_refs, "event_refs", 32);
  if (projection.event_refs.length !== projection.events.length) {
    reject("event_refs must correspond to the retained event window");
  }
  projection.events.forEach((event, index) => {
    requireObject(event, `events[${index}]`);
    requireExactFields(event, EVENT_FIELDS, `events[${index}]`);
    requireIdentifier(event.event_id, `events[${index}].event_id`);
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      reject(`events[${index}].sequence must be a positive integer`);
    }
    if (
      index > 0 &&
      event.sequence !== projection.events[index - 1].sequence + 1
    ) {
      reject("retained event sequence must remain contiguous");
    }
    requireEqual(
      projection.event_refs[index],
      event.event_id,
      "event_refs must preserve retained event order",
    );
    requireIdentifier(event.node_id, `events[${index}].node_id`);
    requireEnum(event.state, ORCHESTRATION_RUN_STATES, `events[${index}].state`);
    requireText(event.summary, `events[${index}].summary`);
    requireTimestamp(event.occurred_at, `events[${index}].occurred_at`);
  });

  validateAggregateReceipt(projection.aggregate_receipt, projection);
  validateRuntime(projection.runtime);

  const terminal =
    ["completed", "cancelled"].includes(projection.state) ||
    (projection.state === "failed" && projection.completed_at !== null);
  if (terminal !== (projection.aggregate_receipt !== null)) {
    reject("terminal run state and aggregate_receipt must agree");
  }
  if (terminal !== (projection.completed_at !== null)) {
    reject("terminal run state and completed_at must agree");
  }
  return projection;
}

function validateCurrentNode(node, projection) {
  requireObject(node, "current_node");
  requireExactFields(node, CURRENT_NODE_FIELDS, "current_node");
  requireIdentifier(node.node_id, "current_node.node_id");
  requireIdentifier(node.node_type, "current_node.node_type");
  requireText(node.label, "current_node.label");
  requireIdentifier(node.owner, "current_node.owner");
  requireEnum(node.state, ORCHESTRATION_RUN_STATES, "current_node.state");
  requireEqual(
    node.state,
    projection.state,
    "current_node.state must match the aggregate run state",
  );
  requireNonNegativeInteger(node.attempt, "current_node.attempt");
}

function validateProgress(progress, state) {
  requireObject(progress, "progress");
  requireExactFields(progress, PROGRESS_FIELDS, "progress");
  for (const field of PROGRESS_FIELDS) {
    requireNonNegativeInteger(progress[field], `progress.${field}`);
  }
  requireEqual(progress.planned, 1, "validation-readiness progress must plan one node");
  if (progress.active + progress.completed + progress.skipped > progress.planned) {
    reject("progress cannot project more active or completed nodes than planned");
  }
  if (state === "running" && progress.active !== 1) {
    reject("running projection must expose one active node");
  }
  if (state === "completed" && progress.completed !== 1) {
    reject("completed projection must expose one completed node");
  }
  if (["blocked", "failed"].includes(state) && progress.failed !== 1) {
    reject("blocked or failed projection must expose one failed node");
  }
}

function validateWait(wait, state) {
  if (wait === null) {
    if (state === "waiting") {
      reject("waiting projection must expose wait detail");
    }
    return;
  }
  requireObject(wait, "wait");
  requireExactFields(wait, WAIT_FIELDS, "wait");
  requireIdentifier(wait.wait_id, "wait.wait_id");
  requireIdentifier(wait.kind, "wait.kind");
  requireIdentifier(wait.owner, "wait.owner");
  requireIdentifier(wait.reason_ref, "wait.reason_ref");
  requireText(wait.expected_signal, "wait.expected_signal");
  requireTimestamp(wait.entered_at, "wait.entered_at");
  if (wait.deadline !== null) {
    requireTimestamp(wait.deadline, "wait.deadline");
  }
  requireIdentifier(wait.timeout_behavior, "wait.timeout_behavior");
}

function validateBlocker(blocker, state) {
  if (blocker === null) {
    if (state === "blocked") {
      reject("blocked projection must expose blocker detail");
    }
    return;
  }
  requireObject(blocker, "blocker");
  requireExactFields(blocker, BLOCKER_FIELDS, "blocker");
  requireIdentifier(blocker.blocker_id, "blocker.blocker_id");
  requireIdentifier(blocker.owner, "blocker.owner");
  requireIdentifier(blocker.status_code, "blocker.status_code");
  requireText(blocker.detail, "blocker.detail");
  requireText(blocker.remediation, "blocker.remediation");
  requireIdentifierArray(
    blocker.supported_dispositions,
    "blocker.supported_dispositions",
    8,
  );
  requireIdentifierArray(blocker.evidence_refs, "blocker.evidence_refs", 32);
}

function validateFailure(failure, state) {
  if (failure === null) {
    if (state === "failed") {
      reject("failed projection must expose failure detail");
    }
    return;
  }
  requireObject(failure, "failure");
  requireExactFields(failure, FAILURE_FIELDS, "failure");
  for (const field of ["failure_id", "failed_node_id", "owner", "failure_type"]) {
    requireIdentifier(failure[field], `failure.${field}`);
  }
  requireText(failure.detail, "failure.detail");
  requireBoolean(failure.retryable, "failure.retryable");
  requireBoolean(failure.retry_exhausted, "failure.retry_exhausted");
  if (failure.retryable === failure.retry_exhausted) {
    reject("failure retryable and retry_exhausted must be complementary");
  }
}

function validateRetryStatus(retryStatus) {
  requireObject(retryStatus, "retry_status");
  requireExactFields(retryStatus, RETRY_STATUS_FIELDS, "retry_status");
  requireNonNegativeInteger(retryStatus.attempts, "retry_status.attempts");
  if (!Number.isInteger(retryStatus.max_attempts) || retryStatus.max_attempts < 1) {
    reject("retry_status.max_attempts must be a positive integer");
  }
  if (retryStatus.attempts > retryStatus.max_attempts) {
    reject("retry_status.attempts cannot exceed max_attempts");
  }
  requireBoolean(retryStatus.retry_available, "retry_status.retry_available");
  if (retryStatus.next_eligible_at !== null) {
    requireTimestamp(retryStatus.next_eligible_at, "retry_status.next_eligible_at");
  }
}

function validateControlAvailability(controls) {
  if (!Array.isArray(controls) || controls.length !== ORCHESTRATION_CONTROL_ACTIONS.length) {
    reject("control_availability must cover every admitted control exactly once");
  }
  const actions = new Set();
  controls.forEach((controlEntry, index) => {
    requireObject(controlEntry, `control_availability[${index}]`);
    requireExactFields(
      controlEntry,
      CONTROL_AVAILABILITY_FIELDS,
      `control_availability[${index}]`,
    );
    requireEnum(
      controlEntry.action,
      ORCHESTRATION_CONTROL_ACTIONS,
      `control_availability[${index}].action`,
    );
    if (actions.has(controlEntry.action)) {
      reject("control_availability cannot contain duplicate actions");
    }
    actions.add(controlEntry.action);
    requireEqual(
      controlEntry.authority,
      "operator",
      "control availability authority must remain operator",
    );
    requireBoolean(controlEntry.available, `control_availability[${index}].available`);
    requireText(
      controlEntry.expected_effect,
      `control_availability[${index}].expected_effect`,
    );
    if (controlEntry.available) {
      requireEqual(
        controlEntry.disabled_reason,
        null,
        "available control cannot carry a disabled_reason",
      );
    } else {
      requireText(
        controlEntry.disabled_reason,
        `control_availability[${index}].disabled_reason`,
      );
    }
  });
}

function validateRecordedControls(controls) {
  if (!Array.isArray(controls) || controls.length > 16) {
    reject("controls must be a bounded array with at most 16 entries");
  }
  const controlIds = new Set();
  const idempotencyKeys = new Set();
  controls.forEach((control, index) => {
    requireObject(control, `controls[${index}]`);
    requireExactFields(control, RECORDED_CONTROL_FIELDS, `controls[${index}]`);
    requireEqual(
      control.schema_version,
      ORCHESTRATION_SCHEMA_VERSION,
      `controls[${index}].schema_version is unsupported`,
    );
    requireEnum(control.action, ORCHESTRATION_CONTROL_ACTIONS, `controls[${index}].action`);
    for (const field of ["control_id", "idempotency_key", "operator_id", "reason_ref"]) {
      requireIdentifier(control[field], `controls[${index}].${field}`);
    }
    requireTimestamp(control.recorded_at, `controls[${index}].recorded_at`);
    if (controlIds.has(control.control_id) || idempotencyKeys.has(control.idempotency_key)) {
      reject("recorded controls must preserve unique control and idempotency keys");
    }
    controlIds.add(control.control_id);
    idempotencyKeys.add(control.idempotency_key);
  });
}

function validateAggregateReceipt(receipt, projection) {
  if (receipt === null) {
    return;
  }
  requireObject(receipt, "aggregate_receipt");
  requireExactFields(receipt, AGGREGATE_RECEIPT_FIELDS, "aggregate_receipt");
  for (const field of [
    "receipt_id",
    "receipt_type",
    "request_id",
    "run_id",
    "caller_ref",
    "operator_ref",
    "approval_ref",
    "source_record_ref",
    "source_version_ref",
    "source_projection_ref",
    "source_projection_version",
  ]) {
    requireIdentifier(receipt[field], `aggregate_receipt.${field}`);
  }
  requireDigest(receipt.intent_digest, "aggregate_receipt.intent_digest");
  requireEqual(
    receipt.receipt_type,
    VALIDATION_READINESS_EXPECTED_RECEIPT,
    "aggregate receipt type is unsupported",
  );
  requireEnum(
    receipt.outcome,
    [
      "completed",
      "cancelled-no-effect",
      "cancelled-with-retained-evidence",
      "failed-no-effect",
      "failed-with-retained-evidence",
    ],
    "aggregate_receipt.outcome",
  );
  const expectedOutcomePrefix = {
    completed: "completed",
    cancelled: "cancelled",
    failed: "failed",
  }[projection.state];
  if (
    !expectedOutcomePrefix ||
    (receipt.outcome !== expectedOutcomePrefix &&
      !receipt.outcome.startsWith(`${expectedOutcomePrefix}-`))
  ) {
    reject("aggregate receipt outcome must match the terminal run state");
  }
  for (const [receiptField, projectionField] of [
    ["request_id", "request_id"],
    ["run_id", "run_id"],
    ["caller_ref", "caller_ref"],
    ["operator_ref", "operator_ref"],
    ["approval_ref", "approval_ref"],
    ["intent_digest", "intent_digest"],
    ["source_record_ref", "source_record_ref"],
    ["source_version_ref", "source_version_ref"],
    ["source_projection_ref", "source_projection_ref"],
    ["source_projection_version", "source_projection_version"],
  ]) {
    requireEqual(
      receipt[receiptField],
      projection[projectionField],
      `aggregate receipt ${receiptField} must match the aggregate run`,
    );
  }
  requireIdentifierArray(receipt.receipt_refs, "aggregate_receipt.receipt_refs", 32);
  requireIdentifierArray(receipt.artifact_refs, "aggregate_receipt.artifact_refs", 32);
  requireEqual(
    JSON.stringify(receipt.receipt_refs),
    JSON.stringify(projection.receipt_refs),
    "aggregate receipt receipt_refs must match the aggregate run",
  );
  requireEqual(
    JSON.stringify(receipt.artifact_refs),
    JSON.stringify(projection.artifact_refs),
    "aggregate receipt artifact_refs must match the aggregate run",
  );
  requireTimestamp(receipt.recorded_at, "aggregate_receipt.recorded_at");
  requireEqual(
    receipt.recorded_at,
    projection.completed_at,
    "aggregate receipt recorded_at must match completed_at",
  );
}

function validateRuntime(runtime) {
  requireObject(runtime, "runtime");
  requireExactFields(runtime, RUNTIME_FIELDS, "runtime");
  for (const field of RUNTIME_FIELDS) {
    requireIdentifier(runtime[field], `runtime.${field}`);
  }
  for (const [field, expected] of [
    ["adapter", "temporal"],
    ["workflow_type", VALIDATION_READINESS_WORKFLOW_TYPE],
    ["workflow_task_queue", VALIDATION_READINESS_WORKFLOW_QUEUE],
    ["activity_name", VALIDATION_READINESS_ACTIVITY_NAME],
    ["activity_task_queue", VALIDATION_READINESS_ACTIVITY_QUEUE],
  ]) {
    requireEqual(runtime[field], expected, `runtime.${field} is unsupported`);
  }
}

export function assertRunControl(control) {
  requireObject(control, "run control");
  const fields = [
    "action",
    "control_id",
    "idempotency_key",
    "operator_id",
    "reason_ref",
    "schema_version",
  ];
  const actualFields = Object.keys(control).sort();
  if (
    actualFields.length !== fields.length ||
    actualFields.some((field, index) => field !== fields[index])
  ) {
    reject("run control contains fields outside the admitted boundary");
  }
  requireEqual(
    control.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "run control schema_version is unsupported",
  );
  requireEnum(control.action, ORCHESTRATION_CONTROL_ACTIONS, "action");
  for (const field of [
    "control_id",
    "operator_id",
    "reason_ref",
    "idempotency_key",
  ]) {
    requireIdentifier(control[field], field);
  }
  return control;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject(`${fieldName} must be an object`);
  }
}

function requireExactFields(value, expectedFields, fieldName) {
  const actualFields = Object.keys(value).sort();
  const sortedExpected = [...expectedFields].sort();
  if (
    actualFields.length !== sortedExpected.length ||
    actualFields.some((field, index) => field !== sortedExpected[index])
  ) {
    reject(`${fieldName} contains fields outside the admitted boundary`);
  }
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) {
    reject(message);
  }
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    reject(`${fieldName} is not admitted`);
  }
}

function requireIdentifier(value, fieldName) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    reject(`${fieldName} must be a bounded identifier`);
  }
}

function requireIdentifierArray(value, fieldName, maxItems) {
  if (!Array.isArray(value) || value.length > maxItems) {
    reject(`${fieldName} must be a bounded array with at most ${maxItems} entries`);
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    requireIdentifier(entry, `${fieldName}[${index}]`);
    if (seen.has(entry)) {
      reject(`${fieldName} cannot contain duplicate entries`);
    }
    seen.add(entry);
  });
}

function requireText(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 2048
  ) {
    reject(`${fieldName} must be bounded non-empty text`);
  }
}

function requireBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    reject(`${fieldName} must be a boolean`);
  }
}

function requireNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    reject(`${fieldName} must be a non-negative integer`);
  }
}

function requireDigest(value, fieldName) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    reject(`${fieldName} must be a sha256 digest`);
  }
}

function requireTimestamp(value, fieldName) {
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value))
  ) {
    reject(`${fieldName} must be an ISO-8601 UTC timestamp`);
  }
}

function reject(message) {
  throw new WorkflowContractError(message);
}
