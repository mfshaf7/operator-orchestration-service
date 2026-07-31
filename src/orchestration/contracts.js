import { createHash } from "node:crypto";

import {
  ORCHESTRATION_CONTROL_ACTIONS,
  ORCHESTRATION_SCHEMA_VERSION,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
  VALIDATION_READINESS_EXPECTED_RECEIPT,
  VALIDATION_READINESS_REQUEST_TYPE,
  VALIDATION_READINESS_RETURN_PROJECTION,
  VALIDATION_READINESS_SOURCE_DOMAIN,
} from "./constants.js";
export {
  assertRunProjection,
  assertWgcfActivityResult,
} from "./workflow-contracts.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VALIDATION_READINESS_RUN_ID_PREFIX =
  `oos:${VALIDATION_READINESS_DEFINITION_ID}:v${VALIDATION_READINESS_DEFINITION_VERSION}:`;

const RUN_REQUEST_FIELDS = new Set([
  "schema_version",
  "request_id",
  "definition_id",
  "definition_version",
  "source_domain",
  "source_record_ref",
  "source_version_ref",
  "request_type",
  "intent_summary",
  "intent_digest",
  "input_refs",
  "approval_refs",
  "lock_refs",
  "idempotency_key",
  "expected_receipt",
  "return_projection",
  "correlation_ref",
  "causation_ref",
  "source_projection_ref",
  "source_projection_version",
  "operator_id",
]);

const APPROVAL_REF_FIELDS = new Set([
  "decision_kind",
  "authority",
  "scope_ref",
  "source_version_ref",
  "intent_digest",
  "decision_ref",
  "decided_at",
  "expires_at",
]);

const LOCK_REF_FIELDS = new Set([
  "resource_ref",
  "mode",
  "conflict_behavior",
]);

const CONTROL_FIELDS = new Set([
  "schema_version",
  "control_id",
  "action",
  "operator_id",
  "reason_ref",
  "idempotency_key",
]);

export class OrchestrationContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "OrchestrationContractError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeValidationReadinessRequest(
  payload,
  { callerId, now = new Date() },
) {
  assertPlainObject(payload, "request");
  assertExactFields(payload, RUN_REQUEST_FIELDS, "request");

  const request = {
    schema_version: requiredInteger(
      payload.schema_version,
      "schema_version",
    ),
    request_id: requiredIdentifier(payload.request_id, "request_id"),
    definition_id: requiredIdentifier(
      payload.definition_id,
      "definition_id",
    ),
    definition_version: requiredInteger(
      payload.definition_version,
      "definition_version",
    ),
    source_domain: requiredIdentifier(
      payload.source_domain,
      "source_domain",
    ),
    source_record_ref: requiredIdentifier(
      payload.source_record_ref,
      "source_record_ref",
    ),
    source_version_ref: requiredIdentifier(
      payload.source_version_ref,
      "source_version_ref",
    ),
    request_type: requiredIdentifier(
      payload.request_type,
      "request_type",
    ),
    intent_summary: requiredText(
      payload.intent_summary,
      "intent_summary",
      { maxLength: 512 },
    ),
    intent_digest: requiredDigest(payload.intent_digest, "intent_digest"),
    input_refs: identifierArray(payload.input_refs, "input_refs", {
      maxItems: 8,
    }),
    approval_refs: approvalRefArray(payload.approval_refs),
    lock_refs: lockRefArray(payload.lock_refs),
    idempotency_key: requiredIdentifier(
      payload.idempotency_key,
      "idempotency_key",
    ),
    expected_receipt: requiredIdentifier(
      payload.expected_receipt,
      "expected_receipt",
    ),
    return_projection: requiredIdentifier(
      payload.return_projection,
      "return_projection",
    ),
    correlation_ref: requiredIdentifier(
      payload.correlation_ref,
      "correlation_ref",
    ),
    causation_ref: requiredIdentifier(
      payload.causation_ref,
      "causation_ref",
    ),
    source_projection_ref: requiredIdentifier(
      payload.source_projection_ref,
      "source_projection_ref",
    ),
    source_projection_version: requiredIdentifier(
      payload.source_projection_version,
      "source_projection_version",
    ),
    operator_id: requiredIdentifier(payload.operator_id, "operator_id"),
    caller_id: requiredIdentifier(callerId, "caller_id"),
  };

  const expected = {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    source_domain: VALIDATION_READINESS_SOURCE_DOMAIN,
    request_type: VALIDATION_READINESS_REQUEST_TYPE,
    expected_receipt: VALIDATION_READINESS_EXPECTED_RECEIPT,
    return_projection: VALIDATION_READINESS_RETURN_PROJECTION,
  };
  const violations = Object.entries(expected)
    .filter(([field, value]) => request[field] !== value)
    .map(([field, value]) => `${field} must be ${JSON.stringify(value)}`);

  if (request.approval_refs.length !== 1) {
    violations.push("approval_refs must contain exactly one operator approval");
  } else {
    const approval = request.approval_refs[0];
    if (approval.decision_kind !== "operator-approved") {
      violations.push(
        'approval_refs[0].decision_kind must be "operator-approved"',
      );
    }
    if (approval.authority !== request.operator_id) {
      violations.push("approval_refs[0].authority must match operator_id");
    }
    if (approval.scope_ref !== request.source_record_ref) {
      violations.push(
        "approval_refs[0].scope_ref must match source_record_ref",
      );
    }
    if (approval.source_version_ref !== request.source_version_ref) {
      violations.push(
        "approval_refs[0].source_version_ref must match source_version_ref",
      );
    }
    if (approval.intent_digest !== request.intent_digest) {
      violations.push(
        "approval_refs[0].intent_digest must match intent_digest",
      );
    }
    violations.push(...approvalFreshnessViolations(approval, now));
  }
  if (request.lock_refs.length !== 0) {
    violations.push("lock_refs must be empty for the read-only proof");
  }
  if (!request.input_refs.includes(request.source_record_ref)) {
    violations.push("input_refs must include source_record_ref");
  }
  if (request.intent_digest !== orchestrationIntentDigest(request)) {
    violations.push("intent_digest must match the canonical request intent");
  }
  if (!IDENTIFIER_PATTERN.test(validationReadinessRunIdFor(request))) {
    violations.push(
      "idempotency_key is too long for the bounded aggregate run id",
    );
  }

  if (violations.length > 0) {
    throw new OrchestrationContractError(
      "request_boundary_rejected",
      "Validation-readiness request crosses the admitted definition boundary.",
      violations,
    );
  }

  return Object.freeze(request);
}

export function orchestrationIntentDigest(request) {
  const canonicalIntent = {
    schema_version: request.schema_version,
    definition_id: request.definition_id,
    definition_version: request.definition_version,
    source_domain: request.source_domain,
    source_record_ref: request.source_record_ref,
    source_version_ref: request.source_version_ref,
    request_type: request.request_type,
    intent_summary: request.intent_summary,
    input_refs: request.input_refs,
    lock_refs: request.lock_refs,
    expected_receipt: request.expected_receipt,
    return_projection: request.return_projection,
    source_projection_ref: request.source_projection_ref,
    source_projection_version: request.source_projection_version,
  };
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalIntent))
    .digest("hex")}`;
}

export function validationReadinessRunIdFor(request) {
  return `${VALIDATION_READINESS_RUN_ID_PREFIX}${request.idempotency_key}`;
}

export function normalizeValidationReadinessRunId(runId) {
  const normalized = requiredIdentifier(runId, "run_id");
  if (!normalized.startsWith(VALIDATION_READINESS_RUN_ID_PREFIX)) {
    throw new OrchestrationContractError(
      "invalid_run_reference",
      "run_id does not identify an admitted validation-readiness run",
    );
  }
  return normalized;
}

export function toTemporalWorkflowInput(request) {
  const approval = request.approval_refs[0];
  return Object.freeze({
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    request_ref: request.request_id,
    definition_id: request.definition_id,
    definition_version: request.definition_version,
    source_ref: request.source_record_ref,
    source_version: request.source_version_ref,
    source_projection_ref: request.source_projection_ref,
    source_projection_version: request.source_projection_version,
    correlation_id: request.correlation_ref,
    causation_id: request.causation_ref,
    caller_id: request.caller_id,
    status_code: "admitted",
    artifact_digest: request.intent_digest,
    bounded_decision: {
      decision_kind: approval.decision_kind,
      authority: approval.authority,
      scope_ref: approval.scope_ref,
      decision_ref: approval.decision_ref,
      decided_at: approval.decided_at,
      expires_at: approval.expires_at,
      source_version: approval.source_version_ref,
      intent_digest: approval.intent_digest,
    },
  });
}

export function normalizeRunControl(payload) {
  assertPlainObject(payload, "control");
  assertExactFields(payload, CONTROL_FIELDS, "control");

  const control = {
    schema_version: requiredInteger(
      payload.schema_version,
      "schema_version",
    ),
    control_id: requiredIdentifier(payload.control_id, "control_id"),
    action: requiredEnum(
      payload.action,
      "action",
      ORCHESTRATION_CONTROL_ACTIONS,
    ),
    operator_id: requiredIdentifier(payload.operator_id, "operator_id"),
    reason_ref: requiredIdentifier(payload.reason_ref, "reason_ref"),
    idempotency_key: requiredIdentifier(
      payload.idempotency_key,
      "idempotency_key",
    ),
  };

  if (control.schema_version !== ORCHESTRATION_SCHEMA_VERSION) {
    throw new OrchestrationContractError(
      "unsupported_schema_version",
      `schema_version must be ${ORCHESTRATION_SCHEMA_VERSION}`,
    );
  }

  return Object.freeze(control);
}

export function assertIdentifier(value, fieldName) {
  return requiredIdentifier(value, fieldName);
}

function approvalRefArray(value) {
  if (!Array.isArray(value) || value.length > 4) {
    throw new OrchestrationContractError(
      "invalid_request",
      "approval_refs must be an array with at most 4 entries",
    );
  }
  return value.map((entry, index) => {
    const field = `approval_refs[${index}]`;
    assertPlainObject(entry, field);
    assertExactFields(entry, APPROVAL_REF_FIELDS, field);
    return {
      decision_kind: requiredIdentifier(
        entry.decision_kind,
        `${field}.decision_kind`,
      ),
      authority: requiredIdentifier(entry.authority, `${field}.authority`),
      scope_ref: requiredIdentifier(entry.scope_ref, `${field}.scope_ref`),
      source_version_ref: requiredIdentifier(
        entry.source_version_ref,
        `${field}.source_version_ref`,
      ),
      intent_digest: requiredDigest(
        entry.intent_digest,
        `${field}.intent_digest`,
      ),
      decision_ref: requiredIdentifier(
        entry.decision_ref,
        `${field}.decision_ref`,
      ),
      decided_at: isoTimestamp(entry.decided_at, `${field}.decided_at`),
      expires_at: isoTimestamp(entry.expires_at, `${field}.expires_at`),
    };
  });
}

function approvalFreshnessViolations(approval, nowValue) {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const decidedAt = new Date(approval.decided_at);
  const expiresAt = new Date(approval.expires_at);
  const maxLifetimeMs = 24 * 60 * 60 * 1000;
  const clockSkewMs = 5 * 60 * 1000;
  const violations = [];

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("now must be a valid date");
  }
  if (decidedAt.getTime() > now.getTime() + clockSkewMs) {
    violations.push("approval_refs[0].decided_at is in the future");
  }
  if (expiresAt.getTime() <= now.getTime()) {
    violations.push("approval_refs[0] has expired");
  }
  if (expiresAt.getTime() <= decidedAt.getTime()) {
    violations.push(
      "approval_refs[0].expires_at must be later than decided_at",
    );
  }
  if (expiresAt.getTime() - decidedAt.getTime() > maxLifetimeMs) {
    violations.push(
      "approval_refs[0] validity must not exceed 24 hours",
    );
  }
  return violations;
}

function lockRefArray(value) {
  if (!Array.isArray(value) || value.length > 4) {
    throw new OrchestrationContractError(
      "invalid_request",
      "lock_refs must be an array with at most 4 entries",
    );
  }
  return value.map((entry, index) => {
    const field = `lock_refs[${index}]`;
    assertPlainObject(entry, field);
    assertExactFields(entry, LOCK_REF_FIELDS, field);
    return {
      resource_ref: requiredIdentifier(
        entry.resource_ref,
        `${field}.resource_ref`,
      ),
      mode: requiredEnum(entry.mode, `${field}.mode`, ["read", "write"]),
      conflict_behavior: requiredEnum(
        entry.conflict_behavior,
        `${field}.conflict_behavior`,
        ["block", "reject"],
      ),
    };
  });
}

function identifierArray(value, fieldName, { maxItems }) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be an array with at most ${maxItems} entries`,
    );
  }
  return value.map((entry, index) =>
    requiredIdentifier(entry, `${fieldName}[${index}]`),
  );
}

function assertExactFields(value, allowed, fieldName) {
  const unknown = Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort();
  const missing = [...allowed].filter(
    (field) => !Object.hasOwn(value, field),
  );
  if (unknown.length > 0 || missing.length > 0) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} fields do not match the versioned contract`,
      { missing, unknown },
    );
  }
}

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be an object`,
    );
  }
}

function requiredIdentifier(value, fieldName) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be a bounded identifier`,
    );
  }
  return value;
}

function requiredInteger(value, fieldName) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be an integer`,
    );
  }
  return value;
}

function requiredText(value, fieldName, { maxLength }) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
  ) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be non-empty bounded text`,
    );
  }
  return value.trim();
}

function requiredEnum(value, fieldName, allowed) {
  if (!allowed.includes(value)) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be one of: ${allowed.join(", ")}`,
    );
  }
  return value;
}

function requiredDigest(value, fieldName) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be a sha256 digest`,
    );
  }
  return value;
}

function isoTimestamp(value, fieldName) {
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new OrchestrationContractError(
      "invalid_request",
      `${fieldName} must be an ISO-8601 UTC timestamp`,
    );
  }
  return value;
}
