import {
  CONTROLLED_PROOF_ACTIVITY_CALLER_ID,
  CONTROLLED_PROOF_CONTEXT_SCHEMA_VERSION,
  CONTROLLED_PROOF_EXECUTOR_CALLER_ID,
  CONTROLLED_PROOF_EXTERNAL_EVIDENCE_KINDS,
  CONTROLLED_PROOF_OOS_SCENARIOS,
  CONTROLLED_PROOF_OWNER_REPO,
  CONTROLLED_PROOF_RECEIPT_OWNERS,
  CONTROLLED_PROOF_REQUIRED_SCENARIOS,
  CONTROLLED_PROOF_RUN_ID_PREFIX,
  ORCHESTRATION_CONTROL_ACTIONS,
  ORCHESTRATION_SCHEMA_VERSION,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  VALIDATION_READINESS_PROFILE,
  VALIDATION_READINESS_TARGET,
  VALIDATION_READINESS_TIER,
  VALIDATION_READINESS_VALIDATION_SCOPE,
} from "./constants.js";
import { canonicalRfc3339Timestamp } from "./timestamps.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const URI_PATTERN =
  /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/@+%-]{1,510}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REVISION_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

const CONTEXT_FIELDS = [
  "authorization",
  "commissioning_session",
  "context_id",
  "definition",
  "request_binding",
  "runtime",
  "schema_version",
  "source_revisions",
];
const AUTHORIZATION_FIELDS = [
  "authorization_digest",
  "authorization_id",
  "canonical_claims_digest",
  "consumed_at",
  "consumption_receipt_digest",
  "consumption_receipt_ref",
  "expires_at",
  "issued_at",
  "operator_approval_digest",
  "operator_approval_ref",
  "security_authorization_digest",
  "security_authorization_ref",
];
const SESSION_FIELDS = [
  "commissioning_session_id",
  "scenario_executions",
  "started_at",
];
const SCENARIO_FIELDS = [
  "required_receipt_owners",
  "scenario_execution_id",
  "scenario_id",
];
const DEFINITION_FIELDS = ["definition_id", "definition_version"];
const REQUEST_BINDING_FIELDS = [
  "operator_id",
  "source_projection_ref",
  "source_projection_version",
  "source_record_ref",
  "source_version_ref",
];
const RUNTIME_FIELDS = [
  "activity_task_queue",
  "api_identity",
  "environment",
  "profile_id",
  "profile_lifecycle",
  "temporal_address",
  "temporal_namespace",
  "workflow_task_queue",
  "workflow_worker_identity",
];
const SOURCE_REVISION_FIELDS = [
  "operator_orchestration_service",
  "workspace_governance_control_fabric",
];
const WORKFLOW_INPUT_FIELDS = [
  "activity_task_queue",
  "artifact_digest",
  "bounded_decision",
  "caller_id",
  "causation_id",
  "controlled_proof_execution",
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
  "workflow_task_queue",
];
const EXECUTION_FIELDS = [
  "authorization_consumed_at",
  "authorization_digest",
  "authorization_expires_at",
  "authorization_id",
  "canonical_claims_digest",
  "commissioning_session_id",
  "commissioning_session_started_at",
  "context_digest",
  "context_id",
  "environment",
  "oos_source_revision",
  "profile_lifecycle",
  "required_receipt_owners",
  "scenario_execution_id",
  "scenario_id",
  "wgcf_source_revision",
];
const BOUNDED_DECISION_FIELDS = [
  "authority",
  "decided_at",
  "decision_kind",
  "decision_ref",
  "expires_at",
  "intent_digest",
  "scope_ref",
  "source_version",
];
const RUN_BINDING_FIELDS = [
  "approval_ref",
  "authorization_digest",
  "authorization_id",
  "caller_ref",
  "commissioning_session_id",
  "context_digest",
  "intent_digest",
  "operator_ref",
  "request_id",
  "scenario_execution_id",
  "scenario_id",
  "schema_version",
  "source_projection_ref",
  "source_projection_version",
  "source_record_ref",
  "source_version_ref",
  "workflow_task_queue",
];
const OWNER_RECEIPT_FIELDS = [
  "authorization_digest",
  "authorization_id",
  "commissioning_session_id",
  "evidence_refs",
  "owner_execution",
  "owner_repo",
  "owner_result",
  "receipt_digest",
  "receipt_ref",
  "recorded_at",
  "scenario_execution_id",
  "scenario_id",
];
const CONTROL_FIELDS = [
  "action",
  "control_id",
  "idempotency_key",
  "operator_id",
  "reason_ref",
  "schema_version",
];
const SCENARIO_EVIDENCE_FIELDS = [
  "evidence_kind",
  "evidence_refs",
  "observed_at",
];
const EVIDENCE_REF_FIELDS = ["artifact_digest", "artifact_ref"];

export class ControlledProofContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ControlledProofContractError";
    this.code = code;
  }
}

export function assertControlledProofExecutionContext(
  candidate,
  { allowExpired = false, now = new Date() } = {},
) {
  requireObject(candidate, "controlled proof context");
  requireExactFields(candidate, CONTEXT_FIELDS, "controlled proof context");
  requireEqual(
    candidate.schema_version,
    CONTROLLED_PROOF_CONTEXT_SCHEMA_VERSION,
    "controlled proof context schema_version is unsupported",
  );
  requireUri(candidate.context_id, "context_id");

  const authorization = candidate.authorization;
  requireObject(authorization, "authorization");
  requireExactFields(authorization, AUTHORIZATION_FIELDS, "authorization");
  for (const field of [
    "authorization_id",
    "operator_approval_ref",
    "security_authorization_ref",
    "consumption_receipt_ref",
  ]) {
    requireUri(authorization[field], `authorization.${field}`);
  }
  for (const field of [
    "authorization_digest",
    "canonical_claims_digest",
    "operator_approval_digest",
    "security_authorization_digest",
    "consumption_receipt_digest",
  ]) {
    requireDigest(authorization[field], `authorization.${field}`);
  }
  const issuedAt = requireTimestamp(authorization.issued_at, "authorization.issued_at");
  const expiresAt = requireTimestamp(
    authorization.expires_at,
    "authorization.expires_at",
  );
  const consumedAt = requireTimestamp(
    authorization.consumed_at,
    "authorization.consumed_at",
  );
  if (issuedAt >= expiresAt || consumedAt < issuedAt || consumedAt >= expiresAt) {
    reject(
      "authorization_timeline_invalid",
      "Controlled proof authorization issuance, consumption, and expiry are inconsistent.",
    );
  }

  const session = candidate.commissioning_session;
  requireObject(session, "commissioning_session");
  requireExactFields(session, SESSION_FIELDS, "commissioning_session");
  requireIdentifier(
    session.commissioning_session_id,
    "commissioning_session.commissioning_session_id",
  );
  const startedAt = requireTimestamp(
    session.started_at,
    "commissioning_session.started_at",
  );
  if (startedAt <= consumedAt || startedAt >= expiresAt) {
    reject(
      "commissioning_session_timeline_invalid",
      "The commissioning session must start after permit consumption and before authorization expiry.",
    );
  }
  assertScenarioExecutions(session.scenario_executions);

  requireObject(candidate.definition, "definition");
  requireExactFields(candidate.definition, DEFINITION_FIELDS, "definition");
  requireEqual(
    candidate.definition.definition_id,
    VALIDATION_READINESS_DEFINITION_ID,
    "controlled proof definition_id is unsupported",
  );
  requireEqual(
    candidate.definition.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
    "controlled proof definition_version is unsupported",
  );

  requireObject(candidate.request_binding, "request_binding");
  requireExactFields(
    candidate.request_binding,
    REQUEST_BINDING_FIELDS,
    "request_binding",
  );
  for (const field of REQUEST_BINDING_FIELDS) {
    requireIdentifier(candidate.request_binding[field], `request_binding.${field}`);
  }

  requireObject(candidate.runtime, "runtime");
  requireExactFields(candidate.runtime, RUNTIME_FIELDS, "runtime");
  for (const field of RUNTIME_FIELDS) {
    requireIdentifier(candidate.runtime[field], `runtime.${field}`);
  }
  requireEqual(
    candidate.runtime.profile_lifecycle,
    "build-admitted",
    "controlled proof cannot project an active profile lifecycle",
  );
  requireEqual(
    candidate.runtime.environment,
    "dev-integration",
    "controlled proof environment is unsupported",
  );
  if (candidate.runtime.api_identity === candidate.runtime.workflow_worker_identity) {
    reject(
      "controlled_proof_identity_alias",
      "Controlled proof API and workflow-worker identities must be distinct.",
    );
  }

  requireObject(candidate.source_revisions, "source_revisions");
  requireExactFields(
    candidate.source_revisions,
    SOURCE_REVISION_FIELDS,
    "source_revisions",
  );
  for (const field of SOURCE_REVISION_FIELDS) {
    requireRevision(candidate.source_revisions[field], `source_revisions.${field}`);
  }
  const expectedWgcfVersion =
    `git:workspace-governance-control-fabric:${candidate.source_revisions.workspace_governance_control_fabric}`;
  requireEqual(
    candidate.request_binding.source_version_ref,
    expectedWgcfVersion,
    "request_binding.source_version_ref must bind the authorized WGCF revision",
  );
  requireEqual(
    candidate.request_binding.source_projection_version,
    candidate.source_revisions.workspace_governance_control_fabric,
    "request_binding.source_projection_version must bind the authorized WGCF revision",
  );

  const nowTimestamp = normalizeNow(now);
  if (!allowExpired && nowTimestamp >= expiresAt) {
    reject(
      "controlled_proof_authorization_expired",
      "The controlled proof authorization has expired.",
    );
  }
  return deepFreeze(structuredClone(candidate));
}

export function normalizeControlledProofStartRequest(payload) {
  requireObject(payload, "controlled proof start request");
  requireExactFields(
    payload,
    ["scenario_execution_id", "schema_version"],
    "controlled proof start request",
  );
  requireEqual(
    payload.schema_version,
    CONTROLLED_PROOF_CONTEXT_SCHEMA_VERSION,
    "controlled proof start schema_version is unsupported",
  );
  return Object.freeze({
    schema_version: payload.schema_version,
    scenario_execution_id: requiredIdentifier(
      payload.scenario_execution_id,
      "scenario_execution_id",
    ),
  });
}

export function normalizeControlledProofControlRequest(payload) {
  requireObject(payload, "controlled proof control request");
  requireExactFields(
    payload,
    [
      "commissioning_session_id",
      "control",
      "scenario_evidence",
      "scenario_execution_id",
      "schema_version",
    ],
    "controlled proof control request",
  );
  requireEqual(
    payload.schema_version,
    CONTROLLED_PROOF_CONTEXT_SCHEMA_VERSION,
    "controlled proof control schema_version is unsupported",
  );
  requireObject(payload.control, "controlled proof control");
  requireExactFields(payload.control, CONTROL_FIELDS, "controlled proof control");
  requireEqual(
    payload.control.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "controlled proof control schema_version is unsupported",
  );
  requireEnum(
    payload.control.action,
    ORCHESTRATION_CONTROL_ACTIONS,
    "controlled proof control action",
  );
  for (const field of [
    "control_id",
    "idempotency_key",
    "operator_id",
    "reason_ref",
  ]) {
    requireIdentifier(payload.control[field], `controlled proof control.${field}`);
  }
  const scenarioEvidence = normalizeScenarioEvidence(payload.scenario_evidence);
  if (payload.control.action === "signal" && scenarioEvidence === null) {
    reject(
      "controlled_proof_scenario_evidence_required",
      "A controlled proof signal requires bounded scenario evidence.",
    );
  }
  if (payload.control.action !== "signal" && scenarioEvidence !== null) {
    reject(
      "controlled_proof_scenario_evidence_not_allowed",
      "Scenario evidence is accepted only with the signal control.",
    );
  }
  return Object.freeze({
    schema_version: payload.schema_version,
    commissioning_session_id: requiredIdentifier(
      payload.commissioning_session_id,
      "commissioning_session_id",
    ),
    scenario_execution_id: requiredIdentifier(
      payload.scenario_execution_id,
      "scenario_execution_id",
    ),
    control: Object.freeze({ ...payload.control }),
    scenario_evidence: scenarioEvidence,
  });
}

export function assertControlledProofControlBinding(envelope, input, { now }) {
  assertControlledProofWorkflowInput(input);
  const execution = input.controlled_proof_execution;
  if (
    envelope.commissioning_session_id !== execution.commissioning_session_id ||
    envelope.scenario_execution_id !== execution.scenario_execution_id ||
    envelope.control.operator_id !== input.bounded_decision.authority
  ) {
    reject(
      "controlled_proof_control_binding_mismatch",
      "The control does not match the authorized commissioning execution.",
    );
  }

  const expectedEvidenceKind =
    CONTROLLED_PROOF_EXTERNAL_EVIDENCE_KINDS[execution.scenario_id] ?? null;
  if (envelope.control.action === "signal") {
    requireEqual(
      envelope.scenario_evidence.evidence_kind,
      expectedEvidenceKind,
      "The scenario evidence kind does not match the authorized scenario.",
    );
    const observedAt = requireTimestamp(
      envelope.scenario_evidence.observed_at,
      "scenario_evidence.observed_at",
    );
    const acceptedAt = requireTimestamp(
      now,
      "controlled proof control accepted_at",
    );
    if (
      observedAt < Date.parse(execution.commissioning_session_started_at) ||
      observedAt >= Date.parse(execution.authorization_expires_at)
    ) {
      reject(
        "controlled_proof_scenario_evidence_outside_authorization",
        "Scenario evidence was observed outside the authorized commissioning session.",
      );
    }
    if (observedAt > acceptedAt) {
      reject(
        "controlled_proof_scenario_evidence_in_future",
        "Scenario evidence cannot be observed after the control was accepted.",
      );
    }
  }
  return envelope;
}

export function controlledProofExecutionFor(
  context,
  scenarioExecutionId,
  { contextDigest } = {},
) {
  requireDigest(contextDigest, "context_digest");
  const scenario = context.commissioning_session.scenario_executions.find(
    (entry) => entry.scenario_execution_id === scenarioExecutionId,
  );
  if (!scenario) {
    reject(
      "controlled_proof_scenario_not_authorized",
      "The requested scenario execution is not present in the pinned commissioning context.",
    );
  }
  if (!scenario.required_receipt_owners.includes(CONTROLLED_PROOF_OWNER_REPO)) {
    reject(
      "controlled_proof_owner_not_authorized",
      "The scenario execution does not authorize an OOS owner receipt.",
    );
  }
  if (!CONTROLLED_PROOF_OOS_SCENARIOS.includes(scenario.scenario_id)) {
    reject(
      "controlled_proof_scenario_not_owned",
      "The requested scenario is not an OOS-controlled proof execution.",
    );
  }
  return deepFreeze({
    context_id: context.context_id,
    context_digest: contextDigest,
    authorization_id: context.authorization.authorization_id,
    authorization_digest: context.authorization.authorization_digest,
    canonical_claims_digest: context.authorization.canonical_claims_digest,
    authorization_consumed_at: context.authorization.consumed_at,
    authorization_expires_at: context.authorization.expires_at,
    commissioning_session_id:
      context.commissioning_session.commissioning_session_id,
    commissioning_session_started_at: context.commissioning_session.started_at,
    scenario_id: scenario.scenario_id,
    scenario_execution_id: scenario.scenario_execution_id,
    required_receipt_owners: [...scenario.required_receipt_owners],
    profile_lifecycle: context.runtime.profile_lifecycle,
    environment: context.runtime.environment,
    oos_source_revision:
      context.source_revisions.operator_orchestration_service,
    wgcf_source_revision:
      context.source_revisions.workspace_governance_control_fabric,
  });
}

export function controlledProofRunIdFor(execution) {
  const scenarioIndex = CONTROLLED_PROOF_REQUIRED_SCENARIOS.indexOf(
    execution.scenario_id,
  );
  if (scenarioIndex < 0) {
    reject(
      "controlled_proof_scenario_not_authorized",
      "The controlled proof scenario is unsupported.",
    );
  }
  const authorizationKey = execution.authorization_digest.slice(7, 39);
  return `${CONTROLLED_PROOF_RUN_ID_PREFIX}:${authorizationKey}:${String(
    scenarioIndex + 1,
  ).padStart(2, "0")}:${execution.scenario_id}`;
}

export function normalizeControlledProofRunId(runId) {
  requireIdentifier(runId, "run_id");
  if (!runId.startsWith(`${CONTROLLED_PROOF_RUN_ID_PREFIX}:`)) {
    reject(
      "invalid_controlled_proof_run_reference",
      "run_id does not identify a controlled proof execution",
    );
  }
  return runId;
}

export function controlledProofWorkflowInputFor(context, execution) {
  const scenarioIndex = CONTROLLED_PROOF_REQUIRED_SCENARIOS.indexOf(
    execution.scenario_id,
  );
  if (scenarioIndex < 0) {
    reject(
      "controlled_proof_scenario_not_authorized",
      "The controlled proof scenario is unsupported.",
    );
  }
  const authorizationKey = execution.authorization_digest.slice(7, 39);
  const input = {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    request_ref: `controlled-proof-request:${authorizationKey}:${String(
      scenarioIndex + 1,
    ).padStart(2, "0")}`,
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    source_ref: context.request_binding.source_record_ref,
    source_version: context.request_binding.source_version_ref,
    source_projection_ref: context.request_binding.source_projection_ref,
    source_projection_version:
      context.request_binding.source_projection_version,
    correlation_id: `controlled-proof-session:${authorizationKey}`,
    causation_id: `controlled-proof-authorization:${authorizationKey}`,
    caller_id: CONTROLLED_PROOF_EXECUTOR_CALLER_ID,
    status_code: "controlled-proof-admitted",
    workflow_task_queue: context.runtime.workflow_task_queue,
    activity_task_queue: context.runtime.activity_task_queue,
    artifact_digest: execution.canonical_claims_digest,
    bounded_decision: {
      decision_kind: "operator-approved",
      authority: context.request_binding.operator_id,
      scope_ref: context.request_binding.source_record_ref,
      decision_ref: context.authorization.operator_approval_ref,
      decided_at: context.authorization.issued_at,
      expires_at: context.authorization.expires_at,
      source_version: context.request_binding.source_version_ref,
      intent_digest: execution.canonical_claims_digest,
    },
    controlled_proof_execution: execution,
  };
  assertControlledProofWorkflowInput(input);
  return deepFreeze(input);
}

export function assertControlledProofWorkflowInput(input) {
  requireObject(input, "controlled proof workflow input");
  requireExactFields(
    input,
    WORKFLOW_INPUT_FIELDS,
    "controlled proof workflow input",
  );
  requireEqual(
    input.schema_version,
    ORCHESTRATION_SCHEMA_VERSION,
    "controlled proof workflow schema_version is unsupported",
  );
  requireEqual(input.definition_id, VALIDATION_READINESS_DEFINITION_ID);
  requireEqual(input.definition_version, VALIDATION_READINESS_DEFINITION_VERSION);
  requireEqual(input.caller_id, CONTROLLED_PROOF_EXECUTOR_CALLER_ID);
  requireEqual(input.status_code, "controlled-proof-admitted");
  for (const field of [
    "request_ref",
    "source_ref",
    "source_version",
    "source_projection_ref",
    "source_projection_version",
    "correlation_id",
    "causation_id",
    "caller_id",
    "workflow_task_queue",
    "activity_task_queue",
  ]) {
    requireIdentifier(input[field], field);
  }
  requireDigest(input.artifact_digest, "artifact_digest");
  assertBoundedDecision(input.bounded_decision, input);
  assertControlledProofExecution(input.controlled_proof_execution);
  requireEqual(
    input.source_version,
    `git:workspace-governance-control-fabric:${input.controlled_proof_execution.wgcf_source_revision}`,
    "controlled proof source_version does not match the authorized WGCF revision",
  );
  return input;
}

export function controlledProofStartOutsideAuthorizationAt(input, timestamp) {
  assertControlledProofWorkflowInput(input);
  const started = requireTimestamp(timestamp, "workflow started_at");
  return (
    started <
      Date.parse(
        input.controlled_proof_execution.commissioning_session_started_at,
      ) ||
    started >=
      Date.parse(input.controlled_proof_execution.authorization_expires_at)
  );
}

export function controlledProofAuthorizationExpiredAt(input, timestamp) {
  return (
    requireTimestamp(timestamp, "controlled proof timestamp") >=
    Date.parse(input.controlled_proof_execution.authorization_expires_at)
  );
}

export function assertControlledProofActivityRequest(request) {
  requireObject(request, "controlled proof activity request");
  requireExactFields(
    request,
    [
      "caller_id",
      "causation_id",
      "controlled_proof_execution",
      "correlation_id",
      "definition_id",
      "definition_version",
      "idempotency_key",
      "operator_id",
      "profile",
      "readiness_target",
      "run_id",
      "schema_version",
      "source_ref",
      "source_version",
      "tier",
      "validation_scope",
      "workflow_id",
    ],
    "controlled proof activity request",
  );
  requireEqual(request.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  requireEqual(request.definition_id, VALIDATION_READINESS_DEFINITION_ID);
  requireEqual(
    request.definition_version,
    VALIDATION_READINESS_DEFINITION_VERSION,
  );
  requireEqual(request.caller_id, CONTROLLED_PROOF_ACTIVITY_CALLER_ID);
  requireEqual(
    request.validation_scope,
    VALIDATION_READINESS_VALIDATION_SCOPE,
  );
  requireEqual(request.readiness_target, VALIDATION_READINESS_TARGET);
  requireEqual(request.profile, VALIDATION_READINESS_PROFILE);
  requireEqual(request.tier, VALIDATION_READINESS_TIER);
  for (const field of [
    "caller_id",
    "causation_id",
    "correlation_id",
    "idempotency_key",
    "operator_id",
    "profile",
    "readiness_target",
    "run_id",
    "source_ref",
    "source_version",
    "tier",
    "validation_scope",
    "workflow_id",
  ]) {
    requireIdentifier(request[field], `controlled proof activity request.${field}`);
  }
  assertControlledProofExecution(request.controlled_proof_execution);
  return request;
}

export function toControlledProofRunBindings(input) {
  assertControlledProofWorkflowInput(input);
  const execution = input.controlled_proof_execution;
  return deepFreeze({
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    context_digest: execution.context_digest,
    authorization_id: execution.authorization_id,
    authorization_digest: execution.authorization_digest,
    commissioning_session_id: execution.commissioning_session_id,
    scenario_id: execution.scenario_id,
    scenario_execution_id: execution.scenario_execution_id,
    request_id: input.request_ref,
    intent_digest: input.artifact_digest,
    source_record_ref: input.source_ref,
    source_version_ref: input.source_version,
    source_projection_ref: input.source_projection_ref,
    source_projection_version: input.source_projection_version,
    caller_ref: input.caller_id,
    operator_ref: input.bounded_decision.authority,
    approval_ref: input.bounded_decision.decision_ref,
    workflow_task_queue: input.workflow_task_queue,
  });
}

export function normalizeControlledProofRunBindings(candidate) {
  requireObject(candidate, "controlled proof run binding");
  requireExactFields(candidate, RUN_BINDING_FIELDS, "controlled proof run binding");
  for (const field of ["context_digest", "authorization_digest", "intent_digest"]) {
    requireDigest(candidate[field], field);
  }
  for (const field of ["authorization_id", "approval_ref"]) {
    requireUri(candidate[field], field);
  }
  for (const field of RUN_BINDING_FIELDS.filter(
    (field) => ![
      "context_digest",
      "authorization_digest",
      "intent_digest",
      "authorization_id",
      "approval_ref",
      "schema_version",
    ].includes(field),
  )) {
    requireIdentifier(candidate[field], field);
  }
  requireEqual(candidate.schema_version, ORCHESTRATION_SCHEMA_VERSION);
  requireEqual(candidate.caller_ref, CONTROLLED_PROOF_EXECUTOR_CALLER_ID);
  return deepFreeze(structuredClone(candidate));
}

export function controlledProofRunBindingMismatches(
  bindings,
  input,
) {
  const expected = toControlledProofRunBindings(input);
  return Object.keys(expected).filter(
    (field) => bindings?.[field] !== expected[field],
  );
}

export function assertControlledProofOwnerReceipt(receipt) {
  requireObject(receipt, "controlled proof owner receipt");
  requireExactFields(receipt, OWNER_RECEIPT_FIELDS, "controlled proof owner receipt");
  requireEqual(receipt.owner_repo, CONTROLLED_PROOF_OWNER_REPO);
  requireUri(receipt.authorization_id, "authorization_id");
  requireDigest(receipt.authorization_digest, "authorization_digest");
  requireIdentifier(receipt.commissioning_session_id, "commissioning_session_id");
  requireEnum(receipt.scenario_id, CONTROLLED_PROOF_REQUIRED_SCENARIOS, "scenario_id");
  requireIdentifier(receipt.scenario_execution_id, "scenario_execution_id");
  requireObject(receipt.owner_execution, "owner_execution");
  requireExactFields(
    receipt.owner_execution,
    ["execution_id", "execution_type"],
    "owner_execution",
  );
  requireEqual(receipt.owner_execution.execution_type, "workflow");
  requireIdentifier(receipt.owner_execution.execution_id, "owner_execution.execution_id");
  requireEnum(
    receipt.owner_result,
    ["passed", "failed", "blocked", "cancelled", "denied", "unavailable"],
    "owner_result",
  );
  if (!Array.isArray(receipt.evidence_refs) || receipt.evidence_refs.length < 1 || receipt.evidence_refs.length > 32) {
    reject("invalid_owner_receipt", "evidence_refs must contain 1 to 32 entries.");
  }
  const evidenceKeys = new Set();
  for (const [index, evidence] of receipt.evidence_refs.entries()) {
    requireObject(evidence, `evidence_refs[${index}]`);
    requireExactFields(
      evidence,
      ["artifact_digest", "artifact_ref"],
      `evidence_refs[${index}]`,
    );
    requireUri(evidence.artifact_ref, `evidence_refs[${index}].artifact_ref`);
    requireDigest(evidence.artifact_digest, `evidence_refs[${index}].artifact_digest`);
    const key = `${evidence.artifact_ref}\u0000${evidence.artifact_digest}`;
    if (evidenceKeys.has(key)) {
      reject("invalid_owner_receipt", "evidence_refs must be unique.");
    }
    evidenceKeys.add(key);
  }
  requireUri(receipt.receipt_ref, "receipt_ref");
  requireDigest(receipt.receipt_digest, "receipt_digest");
  requireTimestamp(receipt.recorded_at, "recorded_at");
  return receipt;
}

function assertScenarioExecutions(executions) {
  if (!Array.isArray(executions) || executions.length !== CONTROLLED_PROOF_REQUIRED_SCENARIOS.length) {
    reject(
      "controlled_proof_scenario_set_invalid",
      "The commissioning context must contain the exact controlled proof scenario set.",
    );
  }
  const executionIds = new Set();
  executions.forEach((execution, index) => {
    requireObject(execution, `scenario_executions[${index}]`);
    requireExactFields(execution, SCENARIO_FIELDS, `scenario_executions[${index}]`);
    requireEqual(
      execution.scenario_id,
      CONTROLLED_PROOF_REQUIRED_SCENARIOS[index],
      "The commissioning context scenario order is unsupported.",
    );
    requireIdentifier(
      execution.scenario_execution_id,
      `scenario_executions[${index}].scenario_execution_id`,
    );
    if (executionIds.has(execution.scenario_execution_id)) {
      reject(
        "controlled_proof_scenario_execution_duplicate",
        "Scenario execution ids must be unique within a commissioning session.",
      );
    }
    executionIds.add(execution.scenario_execution_id);
    requireReceiptOwnerSubset(
      execution.required_receipt_owners,
      `scenario_executions[${index}].required_receipt_owners`,
    );
    assertOosScenarioOwnership(
      execution.scenario_id,
      execution.required_receipt_owners,
      `scenario_executions[${index}].required_receipt_owners`,
    );
  });
}

export function assertControlledProofExecution(execution) {
  requireObject(execution, "controlled_proof_execution");
  requireExactFields(execution, EXECUTION_FIELDS, "controlled_proof_execution");
  for (const field of ["context_id", "authorization_id"]) {
    requireUri(execution[field], `controlled_proof_execution.${field}`);
  }
  for (const field of [
    "context_digest",
    "authorization_digest",
    "canonical_claims_digest",
  ]) {
    requireDigest(execution[field], `controlled_proof_execution.${field}`);
  }
  for (const field of [
    "commissioning_session_id",
    "scenario_execution_id",
    "profile_lifecycle",
    "environment",
  ]) {
    requireIdentifier(execution[field], `controlled_proof_execution.${field}`);
  }
  requireEnum(
    execution.scenario_id,
    CONTROLLED_PROOF_REQUIRED_SCENARIOS,
    "controlled_proof_execution.scenario_id",
  );
  requireReceiptOwnerSubset(
    execution.required_receipt_owners,
    "controlled_proof_execution.required_receipt_owners",
  );
  assertOosScenarioOwnership(
    execution.scenario_id,
    execution.required_receipt_owners,
    "controlled_proof_execution.required_receipt_owners",
  );
  requireEqual(execution.profile_lifecycle, "build-admitted");
  requireEqual(execution.environment, "dev-integration");
  requireRevision(execution.oos_source_revision, "controlled_proof_execution.oos_source_revision");
  requireRevision(execution.wgcf_source_revision, "controlled_proof_execution.wgcf_source_revision");
  const consumedAt = requireTimestamp(
    execution.authorization_consumed_at,
    "controlled_proof_execution.authorization_consumed_at",
  );
  const sessionStartedAt = requireTimestamp(
    execution.commissioning_session_started_at,
    "controlled_proof_execution.commissioning_session_started_at",
  );
  const expiresAt = requireTimestamp(
    execution.authorization_expires_at,
    "controlled_proof_execution.authorization_expires_at",
  );
  if (consumedAt >= sessionStartedAt || sessionStartedAt >= expiresAt) {
    reject(
      "controlled_proof_execution_timeline_invalid",
      "Controlled proof execution timeline is inconsistent.",
    );
  }
}

function assertBoundedDecision(decision, input) {
  requireObject(decision, "bounded_decision");
  requireExactFields(decision, BOUNDED_DECISION_FIELDS, "bounded_decision");
  requireEqual(decision.decision_kind, "operator-approved");
  for (const field of ["authority", "scope_ref", "source_version"]) {
    requireIdentifier(decision[field], `bounded_decision.${field}`);
  }
  requireUri(decision.decision_ref, "bounded_decision.decision_ref");
  requireDigest(decision.intent_digest, "bounded_decision.intent_digest");
  const decidedAt = requireTimestamp(decision.decided_at, "bounded_decision.decided_at");
  const expiresAt = requireTimestamp(decision.expires_at, "bounded_decision.expires_at");
  if (decidedAt >= expiresAt) {
    reject("controlled_proof_approval_invalid", "Operator approval timeline is invalid.");
  }
  requireEqual(decision.scope_ref, input.source_ref);
  requireEqual(decision.source_version, input.source_version);
  requireEqual(decision.intent_digest, input.artifact_digest);
}

function requireReceiptOwnerSubset(value, fieldName) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > CONTROLLED_PROOF_RECEIPT_OWNERS.length ||
    new Set(value).size !== value.length ||
    value.some((entry) => !CONTROLLED_PROOF_RECEIPT_OWNERS.includes(entry))
  ) {
    reject("controlled_proof_owner_set_invalid", `${fieldName} is unsupported.`);
  }
}

function assertOosScenarioOwnership(scenarioId, owners, fieldName) {
  if (!owners.includes(CONTROLLED_PROOF_OWNER_REPO)) return;
  if (!CONTROLLED_PROOF_OOS_SCENARIOS.includes(scenarioId)) {
    reject(
      "controlled_proof_owner_set_invalid",
      `${fieldName} assigns OOS to an unsupported scenario.`,
    );
  }
  if (
    Object.hasOwn(CONTROLLED_PROOF_EXTERNAL_EVIDENCE_KINDS, scenarioId) &&
    !owners.includes("platform-engineering")
  ) {
    reject(
      "controlled_proof_owner_set_invalid",
      `${fieldName} omits the Platform owner required for external scenario evidence.`,
    );
  }
}

function normalizeScenarioEvidence(candidate) {
  if (candidate === null) return null;
  requireObject(candidate, "scenario_evidence");
  requireExactFields(candidate, SCENARIO_EVIDENCE_FIELDS, "scenario_evidence");
  requireIdentifier(candidate.evidence_kind, "scenario_evidence.evidence_kind");
  requireTimestamp(candidate.observed_at, "scenario_evidence.observed_at");
  if (
    !Array.isArray(candidate.evidence_refs) ||
    candidate.evidence_refs.length < 1 ||
    candidate.evidence_refs.length > 8
  ) {
    reject(
      "invalid_controlled_proof_contract",
      "scenario_evidence.evidence_refs must contain 1 to 8 entries.",
    );
  }
  const evidenceKeys = new Set();
  const evidenceRefs = candidate.evidence_refs.map((entry, index) => {
    requireObject(entry, `scenario_evidence.evidence_refs[${index}]`);
    requireExactFields(
      entry,
      EVIDENCE_REF_FIELDS,
      `scenario_evidence.evidence_refs[${index}]`,
    );
    requireUri(
      entry.artifact_ref,
      `scenario_evidence.evidence_refs[${index}].artifact_ref`,
    );
    requireDigest(
      entry.artifact_digest,
      `scenario_evidence.evidence_refs[${index}].artifact_digest`,
    );
    const key = `${entry.artifact_ref}\u0000${entry.artifact_digest}`;
    if (evidenceKeys.has(key)) {
      reject(
        "invalid_controlled_proof_contract",
        "scenario_evidence.evidence_refs must be unique.",
      );
    }
    evidenceKeys.add(key);
    return Object.freeze({ ...entry });
  });
  return Object.freeze({
    evidence_kind: candidate.evidence_kind,
    evidence_refs: Object.freeze(evidenceRefs),
    observed_at: candidate.observed_at,
  });
}

function normalizeNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("now must be a valid date");
  }
  return date.getTime();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be an object.`);
  }
}

function requireExactFields(value, expectedFields, fieldName) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    reject(
      "invalid_controlled_proof_contract",
      `${fieldName} contains fields outside the admitted boundary.`,
    );
  }
}

function requiredIdentifier(value, fieldName) {
  requireIdentifier(value, fieldName);
  return value;
}

function requireIdentifier(value, fieldName) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be a bounded identifier.`);
  }
}

function requireUri(value, fieldName) {
  if (typeof value !== "string" || !URI_PATTERN.test(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be a bounded URI.`);
  }
}

function requireDigest(value, fieldName) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be a SHA-256 digest.`);
  }
}

function requireRevision(value, fieldName) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be an exact source revision.`);
  }
}

function requireTimestamp(value, fieldName) {
  const canonical = canonicalRfc3339Timestamp(value);
  if (canonical === null) {
    reject("invalid_controlled_proof_contract", `${fieldName} must be an RFC 3339 timestamp.`);
  }
  return Date.parse(canonical);
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    reject("invalid_controlled_proof_contract", `${fieldName} is unsupported.`);
  }
}

function requireEqual(actual, expected, message = "Controlled proof binding mismatch.") {
  if (actual !== expected) {
    reject("invalid_controlled_proof_contract", message);
  }
}

function reject(code, message) {
  throw new ControlledProofContractError(code, message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
