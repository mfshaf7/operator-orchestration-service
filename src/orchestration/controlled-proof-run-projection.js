import {
  CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE,
  CONTROLLED_PROOF_CONTEXT_MISMATCH_FAILURE_TYPE,
  CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE,
  CONTROLLED_PROOF_MAX_MANUAL_ATTEMPTS,
  CONTROLLED_PROOF_PAYLOAD_REJECTED_FAILURE_TYPE,
  CONTROLLED_PROOF_WORKFLOW_TYPE,
  ORCHESTRATION_CONTROL_ACTIONS,
  ORCHESTRATION_RUN_STATES,
  ORCHESTRATION_SCHEMA_VERSION,
  VALIDATION_READINESS_ACTIVITY_NAME,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  WGCF_CANCELLED_FAILURE_TYPE,
  WGCF_NON_RETRYABLE_FAILURE_TYPES,
} from "./constants.js";
import { assertControlledProofWorkflowInput } from "./controlled-proof-contracts.js";
import { canonicalRfc3339Timestamp } from "./timestamps.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PROJECTION_FIELDS = [
  "approval_ref",
  "caller_ref",
  "completed_at",
  "control_availability",
  "controlled_proof_execution",
  "controls",
  "created_at",
  "definition_id",
  "definition_version",
  "events",
  "failure",
  "intent_digest",
  "last_projected_at",
  "max_attempts",
  "operator_ref",
  "projection_type",
  "request_id",
  "retry_available",
  "run_id",
  "runtime",
  "scenario_assertion",
  "schema_version",
  "source_projection_ref",
  "source_projection_version",
  "source_record_ref",
  "source_version_ref",
  "state",
  "attempt",
  "wgcf_evidence",
  "workflow_id",
];
const CONTROL_AVAILABILITY_FIELDS = [
  "action",
  "available",
  "disabled_reason",
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
const EVENT_FIELDS = [
  "event_id",
  "occurred_at",
  "sequence",
  "state",
  "summary",
];
const FAILURE_FIELDS = ["detail", "failure_type", "retryable"];
const ASSERTION_FIELDS = ["detail", "status"];
const RUNTIME_FIELDS = [
  "activity_name",
  "activity_task_queue",
  "adapter",
  "execution_run_id",
  "workflow_task_queue",
  "workflow_type",
];
const EVIDENCE_FIELDS = ["artifact_digests", "receipt_refs", "status_code"];
const RECEIPT_REF_FIELDS = ["digest", "receipt_id"];

const CONTROLLED_PROOF_NON_RETRYABLE_FAILURE_TYPES = new Set([
  ...WGCF_NON_RETRYABLE_FAILURE_TYPES,
  CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE,
  CONTROLLED_PROOF_CONTEXT_MISMATCH_FAILURE_TYPE,
  CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE,
  CONTROLLED_PROOF_PAYLOAD_REJECTED_FAILURE_TYPE,
]);

export function createControlledProofRunProjection({
  request,
  runId,
  temporalExecutionRunId,
  timestamp,
}) {
  assertControlledProofWorkflowInput(request, timestamp);
  return withEvent(
    withControlAvailability({
      schema_version: ORCHESTRATION_SCHEMA_VERSION,
      projection_type: "controlled-proof",
      request_id: request.request_ref,
      run_id: runId,
      workflow_id: runId,
      definition_id: request.definition_id,
      definition_version: request.definition_version,
      source_record_ref: request.source_ref,
      source_version_ref: request.source_version,
      source_projection_ref: request.source_projection_ref,
      source_projection_version: request.source_projection_version,
      caller_ref: request.caller_id,
      operator_ref: request.bounded_decision.authority,
      approval_ref: request.bounded_decision.decision_ref,
      intent_digest: request.artifact_digest,
      controlled_proof_execution: request.controlled_proof_execution,
      state: "queued",
      attempt: 0,
      max_attempts: CONTROLLED_PROOF_MAX_MANUAL_ATTEMPTS,
      retry_available: false,
      control_availability: [],
      controls: [],
      wgcf_evidence: {
        artifact_digests: [],
        receipt_refs: [],
        status_code: null,
      },
      failure: null,
      scenario_assertion: {
        status: "pending",
        detail: "The authorized scenario execution has not reached a terminal assertion.",
      },
      runtime: {
        adapter: "temporal",
        execution_run_id: temporalExecutionRunId,
        workflow_type: CONTROLLED_PROOF_WORKFLOW_TYPE,
        workflow_task_queue: request.workflow_task_queue,
        activity_name: VALIDATION_READINESS_ACTIVITY_NAME,
        activity_task_queue: request.activity_task_queue,
      },
      events: [],
      created_at: timestamp,
      last_projected_at: timestamp,
      completed_at: null,
    }),
    "Controlled proof scenario accepted for durable execution.",
    timestamp,
  );
}

export function startControlledProofAttempt(projection, timestamp) {
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "running",
      attempt: projection.attempt + 1,
      retry_available: false,
      failure: null,
      last_projected_at: timestamp,
    }),
    `Controlled proof activity attempt ${projection.attempt + 1} started.`,
    timestamp,
  );
}

export function projectControlledProofWgcfResult(
  projection,
  result,
  timestamp,
) {
  if (authorizationExpired(projection, timestamp)) {
    return projectControlledProofFailure(
      projection,
      { failureType: CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE },
      timestamp,
    );
  }
  const evidence = appendWgcfEvidence(projection.wgcf_evidence, result);
  const expectedUnavailable =
    projection.controlled_proof_execution.scenario_id ===
      "unavailable-dependency" && result.status_code === "unavailable";
  if (result.status_code === "ready" || expectedUnavailable) {
    return completeScenario(
      { ...projection, wgcf_evidence: evidence },
      expectedUnavailable
        ? "The unavailable dependency boundary was observed as authorized."
        : "WGCF returned the authorized ready result.",
      timestamp,
    );
  }

  const retryAvailable = projection.attempt < projection.max_attempts;
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "blocked",
      retry_available: retryAvailable,
      wgcf_evidence: evidence,
      last_projected_at: timestamp,
    }),
    `WGCF returned ${result.status_code}; the scenario remains blocked.`,
    timestamp,
  );
}

export function projectControlledProofFailure(
  projection,
  { failureType },
  timestamp,
) {
  if (
    failureType !== CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE &&
    authorizationExpired(projection, timestamp)
  ) {
    failureType = CONTROLLED_PROOF_AUTHORIZATION_REJECTED_FAILURE_TYPE;
  }
  if (failureType === WGCF_CANCELLED_FAILURE_TYPE) {
    return cancelControlledProofRun(
      projection,
      {
        action: "cancel",
        control_id: `runtime-cancel:${projection.run_id}`,
        idempotency_key: `runtime-cancel:${projection.run_id}`,
        operator_id: "temporal-runtime",
        reason_ref: "temporal:activity-cancelled",
        schema_version: ORCHESTRATION_SCHEMA_VERSION,
      },
      timestamp,
    );
  }

  if (failureMatchesAuthorizedScenario(projection, failureType)) {
    return completeScenario(
      {
        ...projection,
        failure: {
          detail: "The authorized negative boundary was observed.",
          failure_type: failureType,
          retryable: false,
        },
      },
      "The expected negative boundary was observed and retained.",
      timestamp,
    );
  }

  const nonRetryable = CONTROLLED_PROOF_NON_RETRYABLE_FAILURE_TYPES.has(
    failureType,
  );
  const retryAvailable =
    !nonRetryable && projection.attempt < projection.max_attempts;
  const next = {
    ...projection,
    state: "failed",
    retry_available: retryAvailable,
    failure: {
      detail: "The controlled proof activity did not produce its authorized result.",
      failure_type: failureType,
      retryable: retryAvailable,
    },
    scenario_assertion: retryAvailable
      ? projection.scenario_assertion
      : {
          status: "failed",
          detail: "The authorized scenario ended without its required assertion.",
        },
    completed_at: retryAvailable ? null : timestamp,
    last_projected_at: timestamp,
  };
  return withEvent(
    withControlAvailability(next),
    retryAvailable
      ? "The controlled proof activity failed and can be retried within the same scenario execution."
      : "The controlled proof scenario failed without a remaining attempt.",
    timestamp,
  );
}

export function recordControlledProofControl(projection, control, timestamp) {
  const retained = projection.controls.find(
    (entry) =>
      entry.control_id === control.control_id ||
      entry.idempotency_key === control.idempotency_key,
  );
  if (retained) {
    return projection;
  }
  return withEvent(
    {
      ...projection,
      controls: [
        ...projection.controls,
        { ...control, recorded_at: timestamp },
      ].slice(-16),
      last_projected_at: timestamp,
    },
    `Controlled proof ${control.action} control accepted.`,
    timestamp,
  );
}

export function deferControlledProofRun(projection, timestamp) {
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "waiting",
      last_projected_at: timestamp,
    }),
    "Controlled proof scenario deferred within its existing execution binding.",
    timestamp,
  );
}

export function cancelControlledProofRun(projection, control, timestamp) {
  const expected =
    projection.controlled_proof_execution.scenario_id === "cancellation" &&
    !authorizationExpired(projection, timestamp);
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "cancelled",
      retry_available: false,
      scenario_assertion: {
        status: expected ? "passed" : "failed",
        detail: expected
          ? "The authorized cancellation boundary was observed."
          : `The scenario was cancelled by ${control.operator_id}.`,
      },
      completed_at: timestamp,
      last_projected_at: timestamp,
    }),
    expected
      ? "Controlled proof cancellation scenario completed."
      : `Controlled proof scenario cancelled by ${control.operator_id}.`,
    timestamp,
  );
}

function authorizationExpired(projection, timestamp) {
  const projectedAt = Date.parse(timestamp);
  const expiresAt = Date.parse(
    projection.controlled_proof_execution.authorization_expires_at,
  );
  if (Number.isNaN(projectedAt) || Number.isNaN(expiresAt)) {
    throw new TypeError("Controlled proof projection timestamps must be valid.");
  }
  return projectedAt >= expiresAt;
}

export function finishControlledProofAttempts(projection, timestamp) {
  if (projection.completed_at !== null || projection.retry_available) {
    return projection;
  }
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "failed",
      scenario_assertion: {
        status: "failed",
        detail: "The controlled proof scenario exhausted its bounded attempts.",
      },
      completed_at: timestamp,
      last_projected_at: timestamp,
    }),
    "Controlled proof scenario exhausted its bounded attempts.",
    timestamp,
  );
}

export function assertControlledProofRunProjection(projection) {
  requireObject(projection, "controlled proof projection");
  requireExactFields(projection, PROJECTION_FIELDS, "controlled proof projection");
  requireEqual(projection.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  requireEqual(projection.projection_type, "controlled-proof");
  requireEqual(projection.definition_id, VALIDATION_READINESS_DEFINITION_ID);
  requireEqual(
    projection.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
  );
  for (const field of [
    "request_id",
    "run_id",
    "workflow_id",
    "source_record_ref",
    "source_version_ref",
    "source_projection_ref",
    "source_projection_version",
    "caller_ref",
    "operator_ref",
  ]) {
    requireIdentifier(projection[field], field);
  }
  requireUri(projection.approval_ref, "approval_ref");
  requireDigest(projection.intent_digest, "intent_digest");
  requireEqual(projection.workflow_id, projection.run_id);
  requireEnum(projection.state, ORCHESTRATION_RUN_STATES, "state");
  requireInteger(projection.attempt, "attempt", { min: 0 });
  requireEqual(projection.max_attempts, CONTROLLED_PROOF_MAX_MANUAL_ATTEMPTS);
  requireBoolean(projection.retry_available, "retry_available");
  assertExecutionBinding(projection.controlled_proof_execution);
  validateControls(projection.control_availability, projection.controls);
  validateEvidence(projection.wgcf_evidence);
  validateFailure(projection.failure);
  validateAssertion(projection.scenario_assertion);
  validateRuntime(projection.runtime);
  validateEvents(projection.events);
  requireTimestamp(projection.created_at, "created_at");
  requireTimestamp(projection.last_projected_at, "last_projected_at");
  if (projection.completed_at !== null) {
    requireTimestamp(projection.completed_at, "completed_at");
  }
  const terminal = projection.completed_at !== null;
  requireEqual(
    terminal,
    projection.scenario_assertion.status !== "pending",
    "Terminal state and scenario assertion must agree.",
  );
  return projection;
}

function completeScenario(projection, detail, timestamp) {
  return withEvent(
    withControlAvailability({
      ...projection,
      state: "completed",
      retry_available: false,
      scenario_assertion: { status: "passed", detail },
      completed_at: timestamp,
      last_projected_at: timestamp,
    }),
    detail,
    timestamp,
  );
}

function failureMatchesAuthorizedScenario(projection, failureType) {
  const scenario = projection.controlled_proof_execution.scenario_id;
  return (
    (scenario === "identity-denial" &&
      failureType === CONTROLLED_PROOF_IDENTITY_DENIED_FAILURE_TYPE) ||
    (scenario === "payload-boundary" &&
      [
        CONTROLLED_PROOF_PAYLOAD_REJECTED_FAILURE_TYPE,
        "WGCF_CONTRACT_REJECTED",
      ].includes(failureType)) ||
    (scenario === "unavailable-dependency" &&
      failureType === "WGCF_ACTIVITY_UNAVAILABLE")
  );
}

function withControlAvailability(projection) {
  const terminal = projection.completed_at !== null;
  const retry =
    projection.state === "failed" && projection.retry_available && !terminal;
  const resume =
    ["blocked", "waiting"].includes(projection.state) &&
    projection.attempt < projection.max_attempts &&
    !terminal;
  const defer =
    ["blocked", "failed"].includes(projection.state) && !terminal;
  return {
    ...projection,
    control_availability: ORCHESTRATION_CONTROL_ACTIONS.map((action) => {
      const available = {
        retry,
        resume,
        signal: false,
        cancel: !terminal,
        defer,
      }[action];
      return {
        action,
        available,
        disabled_reason: available
          ? null
          : "The control is unavailable in the current controlled proof state.",
      };
    }),
  };
}

function withEvent(projection, summary, timestamp) {
  const sequence = (projection.events.at(-1)?.sequence ?? 0) + 1;
  const events = [
    ...projection.events,
    {
      event_id: `event:${projection.run_id}:${sequence}`,
      sequence,
      state: projection.state,
      summary,
      occurred_at: timestamp,
    },
  ].slice(-32);
  return assertControlledProofRunProjection({
    ...projection,
    events,
    last_projected_at: timestamp,
  });
}

function appendWgcfEvidence(current, result) {
  const receiptRefs = current.receipt_refs.some(
    (entry) => entry.receipt_id === result.receipt_ref.receipt_id,
  )
    ? current.receipt_refs
    : [
        ...current.receipt_refs,
        {
          receipt_id: result.receipt_ref.receipt_id,
          digest: result.receipt_ref.digest,
        },
      ];
  return {
    status_code: result.status_code,
    artifact_digests: [
      ...new Set([...current.artifact_digests, result.artifact_digest]),
    ],
    receipt_refs: receiptRefs,
  };
}

function validateControls(availability, controls) {
  if (!Array.isArray(availability) || availability.length !== ORCHESTRATION_CONTROL_ACTIONS.length) {
    reject("control_availability must cover every control action");
  }
  availability.forEach((entry, index) => {
    requireObject(entry, `control_availability[${index}]`);
    requireExactFields(entry, CONTROL_AVAILABILITY_FIELDS, `control_availability[${index}]`);
    requireEqual(entry.action, ORCHESTRATION_CONTROL_ACTIONS[index]);
    requireBoolean(entry.available, `control_availability[${index}].available`);
    if (entry.available) {
      requireEqual(entry.disabled_reason, null);
    } else {
      requireText(entry.disabled_reason, `control_availability[${index}].disabled_reason`);
    }
  });
  if (!Array.isArray(controls) || controls.length > 16) {
    reject("controls must be a bounded array");
  }
  controls.forEach((entry, index) => {
    requireObject(entry, `controls[${index}]`);
    requireExactFields(entry, RECORDED_CONTROL_FIELDS, `controls[${index}]`);
    requireEqual(entry.schema_version, ORCHESTRATION_SCHEMA_VERSION);
    requireEnum(entry.action, ORCHESTRATION_CONTROL_ACTIONS, `controls[${index}].action`);
    for (const field of ["control_id", "idempotency_key", "operator_id", "reason_ref"]) {
      requireIdentifier(entry[field], `controls[${index}].${field}`);
    }
    requireTimestamp(entry.recorded_at, `controls[${index}].recorded_at`);
  });
}

function validateEvidence(evidence) {
  requireObject(evidence, "wgcf_evidence");
  requireExactFields(evidence, EVIDENCE_FIELDS, "wgcf_evidence");
  if (evidence.status_code !== null) {
    requireIdentifier(evidence.status_code, "wgcf_evidence.status_code");
  }
  requireDigestArray(evidence.artifact_digests, "wgcf_evidence.artifact_digests");
  if (!Array.isArray(evidence.receipt_refs) || evidence.receipt_refs.length > 32) {
    reject("wgcf_evidence.receipt_refs must be a bounded array");
  }
  evidence.receipt_refs.forEach((entry, index) => {
    requireObject(entry, `wgcf_evidence.receipt_refs[${index}]`);
    requireExactFields(entry, RECEIPT_REF_FIELDS, `wgcf_evidence.receipt_refs[${index}]`);
    requireIdentifier(entry.receipt_id, `wgcf_evidence.receipt_refs[${index}].receipt_id`);
    requireDigest(entry.digest, `wgcf_evidence.receipt_refs[${index}].digest`);
  });
}

function validateFailure(failure) {
  if (failure === null) return;
  requireObject(failure, "failure");
  requireExactFields(failure, FAILURE_FIELDS, "failure");
  requireIdentifier(failure.failure_type, "failure.failure_type");
  requireText(failure.detail, "failure.detail");
  requireBoolean(failure.retryable, "failure.retryable");
}

function validateAssertion(assertion) {
  requireObject(assertion, "scenario_assertion");
  requireExactFields(assertion, ASSERTION_FIELDS, "scenario_assertion");
  requireEnum(assertion.status, ["pending", "passed", "failed"], "scenario_assertion.status");
  requireText(assertion.detail, "scenario_assertion.detail");
}

function validateRuntime(runtime) {
  requireObject(runtime, "runtime");
  requireExactFields(runtime, RUNTIME_FIELDS, "runtime");
  requireEqual(runtime.adapter, "temporal");
  requireEqual(runtime.workflow_type, CONTROLLED_PROOF_WORKFLOW_TYPE);
  requireEqual(runtime.activity_name, VALIDATION_READINESS_ACTIVITY_NAME);
  for (const field of [
    "execution_run_id",
    "workflow_task_queue",
    "activity_task_queue",
  ]) {
    requireIdentifier(runtime[field], `runtime.${field}`);
  }
}

function validateEvents(events) {
  if (!Array.isArray(events) || events.length > 32) {
    reject("events must be a bounded array");
  }
  events.forEach((entry, index) => {
    requireObject(entry, `events[${index}]`);
    requireExactFields(entry, EVENT_FIELDS, `events[${index}]`);
    requireIdentifier(entry.event_id, `events[${index}].event_id`);
    requireInteger(entry.sequence, `events[${index}].sequence`, { min: 1 });
    requireEnum(entry.state, ORCHESTRATION_RUN_STATES, `events[${index}].state`);
    requireText(entry.summary, `events[${index}].summary`);
    requireTimestamp(entry.occurred_at, `events[${index}].occurred_at`);
  });
}

function assertExecutionBinding(execution) {
  const candidate = {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    request_ref: "controlled-proof-contract-check",
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    source_ref: "controlled-proof-contract-check",
    source_version: `git:workspace-governance-control-fabric:${execution.wgcf_source_revision}`,
    source_projection_ref: "controlled-proof-contract-check",
    source_projection_version: execution.wgcf_source_revision,
    correlation_id: "controlled-proof-contract-check",
    causation_id: "controlled-proof-contract-check",
    caller_id: "platform-controlled-proof-executor",
    status_code: "controlled-proof-admitted",
    workflow_task_queue: "controlled-proof-contract-check",
    activity_task_queue: "controlled-proof-contract-check",
    artifact_digest: execution.canonical_claims_digest,
    bounded_decision: {
      decision_kind: "operator-approved",
      authority: "controlled-proof-contract-check",
      scope_ref: "controlled-proof-contract-check",
      decision_ref: "contract://controlled-proof/check",
      decided_at: execution.authorization_consumed_at,
      expires_at: execution.authorization_expires_at,
      source_version: `git:workspace-governance-control-fabric:${execution.wgcf_source_revision}`,
      intent_digest: execution.canonical_claims_digest,
    },
    controlled_proof_execution: execution,
  };
  assertControlledProofWorkflowInput(candidate);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject(`${fieldName} must be an object`);
  }
}

function requireExactFields(value, expectedFields, fieldName) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    reject(`${fieldName} contains fields outside the admitted boundary`);
  }
}

function requireIdentifier(value, fieldName) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    reject(`${fieldName} must be a bounded identifier`);
  }
}

function requireUri(value, fieldName) {
  if (typeof value !== "string" || value.length > 512 || !/^[a-z][a-z0-9+.-]*:\/\/.+/.test(value)) {
    reject(`${fieldName} must be a bounded URI`);
  }
}

function requireDigest(value, fieldName) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    reject(`${fieldName} must be a SHA-256 digest`);
  }
}

function requireDigestArray(value, fieldName) {
  if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length) {
    reject(`${fieldName} must be a bounded unique array`);
  }
  value.forEach((entry, index) => requireDigest(entry, `${fieldName}[${index}]`));
}

function requireTimestamp(value, fieldName) {
  if (canonicalRfc3339Timestamp(value) === null) {
    reject(`${fieldName} must be an RFC 3339 timestamp`);
  }
}

function requireInteger(value, fieldName, { min }) {
  if (!Number.isInteger(value) || value < min) {
    reject(`${fieldName} must be an integer of at least ${min}`);
  }
}

function requireBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    reject(`${fieldName} must be a boolean`);
  }
}

function requireText(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048) {
    reject(`${fieldName} must be bounded non-empty text`);
  }
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    reject(`${fieldName} is unsupported`);
  }
}

function requireEqual(actual, expected, message = "Controlled proof projection mismatch.") {
  if (actual !== expected) {
    reject(message);
  }
}

function reject(message) {
  throw new TypeError(message);
}
