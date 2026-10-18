import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import {
  assertSourceCredentialReceipt,
  assertSourceCredentialTimestamp,
  normalizeSourceCredentialInput,
  SOURCE_CREDENTIAL_ACTIONS,
} from "./source-credentials.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const URI = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;

export function platformOperationIdFor(commandId) {
  return `platform-operation:${canonicalDigest({ command_id: commandId }).slice(7, 31)}`;
}

export const PLATFORM_OPERATION_ACTIONS = Object.freeze([
  "dev-integration.request-profile",
  "dev-integration.start",
  "dev-integration.status",
  "dev-integration.access",
  "dev-integration.smoke",
  "dev-integration.stop",
  "dev-integration.reset",
  "dev-integration.promote-check",
  "governed-release.execute-step",
  "governed-release.change-runtime-lifecycle",
  ...SOURCE_CREDENTIAL_ACTIONS,
]);

export const PLATFORM_OPERATION_STATES = Object.freeze([
  "requested",
  "queued",
  "running",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
]);

export const PLATFORM_OPERATION_CONTROL_ACTIONS = Object.freeze([
  "retry",
  "cancel",
]);

const COMMAND_FIELDS = new Set([
  "schema_version",
  "command_id",
  "idempotency_key",
  "correlation_id",
  "causation_id",
  "actor_ref",
  "subject",
  "capability_id",
  "action",
  "input",
  "requested_at",
  "intent_digest",
  "approval",
]);

const SUBJECT_FIELDS = new Set(["kind", "ref", "expected_source_version"]);
const APPROVAL_FIELDS = new Set([
  "decision",
  "operator_id",
  "decision_ref",
  "decided_at",
  "intent_digest",
]);
const CONTROL_FIELDS = new Set([
  "schema_version",
  "control_id",
  "idempotency_key",
  "action",
  "operator_id",
  "reason",
  "requested_at",
]);
const CATALOG_FIELDS = new Set([
  "schema_version",
  "catalog_id",
  "source_version",
  "observed_at",
  "freshness",
  "subjects",
]);
const CATALOG_SUBJECT_FIELDS = new Set([
  "kind",
  "ref",
  "source_version",
  "owner",
  "capabilities",
]);
const CAPABILITY_FIELDS = new Set([
  "capability_id",
  "action",
  "available",
  "unavailable_reason",
  "required_capability",
  "approval_required",
  "destructive",
]);
const PROJECTION_FIELDS = new Set([
  "schema_version",
  "operation_id",
  "command_id",
  "correlation_id",
  "state",
  "attempt",
  "subject_ref",
  "capability_id",
  "action",
  "retryable",
  "cancel_available",
  "blocker",
  "failure",
  "receipt",
  "safe_log_ref",
  "updated_at",
  "events",
]);
const BLOCKER_FIELDS = new Set([
  "code",
  "owner",
  "reason",
  "supported_dispositions",
  "next_action",
]);
const FAILURE_FIELDS = new Set(["code", "detail", "owner"]);
const RECEIPT_FIELDS = new Set([
  "receipt_ref",
  "outcome",
  "recorded_at",
  "source_version",
  "effect",
]);
const EVENT_FIELDS = new Set([
  "event_id",
  "sequence",
  "state",
  "occurred_at",
  "summary",
]);

export function platformOperationIntent(command) {
  return {
    schema_version: command.schema_version,
    command_id: command.command_id,
    idempotency_key: command.idempotency_key,
    correlation_id: command.correlation_id,
    causation_id: command.causation_id,
    actor_ref: command.actor_ref,
    subject: command.subject,
    capability_id: command.capability_id,
    action: command.action,
    input: command.input,
    requested_at: command.requested_at,
  };
}

export function normalizePlatformOperationCommand(value) {
  plainObject(value, "command");
  exactFields(value, COMMAND_FIELDS, "command");
  const command = {
    schema_version: integer(value.schema_version, "schema_version"),
    command_id: identifier(value.command_id, "command_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    correlation_id: identifier(value.correlation_id, "correlation_id"),
    causation_id: nullableIdentifier(value.causation_id, "causation_id"),
    actor_ref: identifier(value.actor_ref, "actor_ref"),
    subject: normalizeSubject(value.subject),
    capability_id: identifier(value.capability_id, "capability_id"),
    action: enumValue(value.action, PLATFORM_OPERATION_ACTIONS, "action"),
    input: SOURCE_CREDENTIAL_ACTIONS.includes(value.action)
      ? normalizeSourceCredentialInput(value.input) : boundedInput(value.input),
    requested_at: timestamp(value.requested_at, "requested_at"),
    intent_digest: digest(value.intent_digest, "intent_digest"),
    approval: normalizeApproval(value.approval),
  };
  if (command.schema_version !== 1) {
    invalid("schema_version", "must be 1");
  }
  const expectedKind = SOURCE_CREDENTIAL_ACTIONS.includes(command.action)
    ? "dev-integration-profile"
    : command.action.startsWith("dev-integration.")
    ? command.action === "dev-integration.request-profile"
      ? "profile-request"
      : "dev-integration-profile"
    : command.action === "governed-release.change-runtime-lifecycle"
      ? "product-runtime-lifecycle"
      : "product-release";
  if (command.subject.kind !== expectedKind) {
    invalid("subject.kind", `must be ${expectedKind} for ${command.action}`);
  }
  if (SOURCE_CREDENTIAL_ACTIONS.includes(command.action) &&
      (command.input.source_intent.operator_id !== command.actor_ref || command.capability_id !== command.action)) {
    invalid("input.source_intent", "must bind the accountable actor and exact source capability");
  }
  const expectedDigest = canonicalDigest(platformOperationIntent(command));
  if (command.intent_digest !== expectedDigest) {
    invalid("intent_digest", "does not match the canonical command intent");
  }
  if (
    command.approval.intent_digest !== command.intent_digest ||
    command.approval.operator_id !== command.actor_ref
  ) {
    invalid("approval", "must bind the exact intent digest and actor_ref");
  }
  return deepFreeze(command);
}

export function normalizePlatformOperationControl(value) {
  plainObject(value, "control");
  exactFields(value, CONTROL_FIELDS, "control");
  const control = {
    schema_version: integer(value.schema_version, "schema_version"),
    control_id: identifier(value.control_id, "control_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    action: enumValue(value.action, PLATFORM_OPERATION_CONTROL_ACTIONS, "action"),
    operator_id: identifier(value.operator_id, "operator_id"),
    reason: text(value.reason, "reason", 1024),
    requested_at: timestamp(value.requested_at, "requested_at"),
  };
  if (control.schema_version !== 1) invalid("schema_version", "must be 1");
  return deepFreeze(control);
}

export function assertPlatformOperationCatalog(value) {
  plainObject(value, "catalog");
  exactFields(value, CATALOG_FIELDS, "catalog");
  if (value.schema_version !== 1) invalid("catalog.schema_version", "must be 1");
  identifier(value.catalog_id, "catalog.catalog_id");
  identifier(value.source_version, "catalog.source_version");
  timestamp(value.observed_at, "catalog.observed_at");
  enumValue(value.freshness, ["current", "stale", "unavailable"], "catalog.freshness");
  if (!Array.isArray(value.subjects) || value.subjects.length > 512) {
    invalid("catalog.subjects", "must be an array with at most 512 entries");
  }
  for (const [index, subject] of value.subjects.entries()) {
    assertCatalogSubject(subject, `catalog.subjects[${index}]`);
  }
  return deepFreeze(structuredClone(value));
}

export function assertPlatformOperationProjection(value, command = null) {
  plainObject(value, "operation");
  exactFields(value, PROJECTION_FIELDS, "operation");
  if (value.schema_version !== 1) invalid("operation.schema_version", "must be 1");
  identifier(value.operation_id, "operation.operation_id");
  identifier(value.command_id, "operation.command_id");
  identifier(value.correlation_id, "operation.correlation_id");
  enumValue(value.state, PLATFORM_OPERATION_STATES, "operation.state");
  integer(value.attempt, "operation.attempt", { min: 1 });
  identifier(value.subject_ref, "operation.subject_ref");
  identifier(value.capability_id, "operation.capability_id");
  enumValue(value.action, PLATFORM_OPERATION_ACTIONS, "operation.action");
  boolean(value.retryable, "operation.retryable");
  boolean(value.cancel_available, "operation.cancel_available");
  assertBlocker(value.blocker, "operation.blocker");
  assertFailure(value.failure, "operation.failure", value.action);
  assertReceipt(value.receipt, "operation.receipt", value.action, command);
  nullableIdentifier(value.safe_log_ref, "operation.safe_log_ref");
  timestamp(value.updated_at, "operation.updated_at");
  if (!Array.isArray(value.events) || value.events.length > 1024) {
    invalid("operation.events", "must be an array with at most 1024 entries");
  }
  value.events.forEach((event, index) => assertEvent(event, `operation.events[${index}]`, index + 1));
  if (value.events.length === 0 || value.events.at(-1).state !== value.state) {
    invalid("operation.events", "must end with an event for the current state");
  }
  if (value.state === "blocked" && !value.blocker) {
    invalid("operation.blocker", "is required for blocked state");
  }
  if (value.state === "failed" && !value.failure) {
    invalid("operation.failure", "is required for failed state");
  }
  if (["succeeded", "failed", "cancelled"].includes(value.state) && !value.receipt) {
    invalid("operation.receipt", "is required for a terminal state");
  }
  if (value.state === "succeeded" && value.receipt?.outcome !== "succeeded") {
    invalid("operation.receipt.outcome", "must be succeeded for succeeded state");
  }
  if (value.state === "failed" && value.receipt?.outcome !== "failed") {
    invalid("operation.receipt.outcome", "must be failed for failed state");
  }
  if (value.state === "cancelled" && value.receipt?.outcome !== "cancelled") {
    invalid("operation.receipt.outcome", "must be cancelled for cancelled state");
  }
  if (!TERMINAL_STATES.has(value.state) && value.receipt !== null) {
    invalid("operation.receipt", "must be null before a terminal state");
  }
  if (command) {
    const mismatches = [
      ["command_id", command.command_id],
      ["correlation_id", command.correlation_id],
      ["subject_ref", command.subject.ref],
      ["capability_id", command.capability_id],
      ["action", command.action],
    ].filter(([field, expected]) => value[field] !== expected);
    if (mismatches.length > 0) {
      throw new HttpError(
        409,
        "platform_operation_provider_binding_mismatch",
        "Platform operation readback does not match the immutable OOS command binding.",
        mismatches.map(([field]) => ({ field })),
      );
    }
  }
  return deepFreeze(structuredClone(value));
}

export function assertPlatformOperationSecurityDecision(config) {
  if (
    !URI.test(config?.securityDecisionUri ?? "") ||
    !DIGEST.test(config?.securityDecisionDigest ?? "") ||
    !COMMIT.test(config?.securityDecisionRevision ?? "")
  ) {
    throw new HttpError(
      503,
      "platform_operation_security_decision_missing",
      "Platform-operation runtime requires an exact Security decision URI, digest, and reviewed OOS revision.",
    );
  }
  return {
    uri: config.securityDecisionUri,
    digest: config.securityDecisionDigest,
    revision: config.securityDecisionRevision,
  };
}

function normalizeSubject(value) {
  plainObject(value, "subject");
  exactFields(value, SUBJECT_FIELDS, "subject");
  return {
    kind: enumValue(value.kind, [
      "dev-integration-profile",
      "profile-request",
      "product-release",
      "product-runtime-lifecycle",
    ], "subject.kind"),
    ref: identifier(value.ref, "subject.ref"),
    expected_source_version: identifier(
      value.expected_source_version,
      "subject.expected_source_version",
    ),
  };
}

function normalizeApproval(value) {
  plainObject(value, "approval");
  exactFields(value, APPROVAL_FIELDS, "approval");
  return {
    decision: enumValue(value.decision, ["approved"], "approval.decision"),
    operator_id: identifier(value.operator_id, "approval.operator_id"),
    decision_ref: identifier(value.decision_ref, "approval.decision_ref"),
    decided_at: timestamp(value.decided_at, "approval.decided_at"),
    intent_digest: digest(value.intent_digest, "approval.intent_digest"),
  };
}

function assertCatalogSubject(subject, label) {
  plainObject(subject, label);
  exactFields(subject, CATALOG_SUBJECT_FIELDS, label);
  enumValue(subject.kind, [
    "dev-integration-profile",
    "profile-request",
    "product-release",
    "product-runtime-lifecycle",
  ], `${label}.kind`);
  identifier(subject.ref, `${label}.ref`);
  identifier(subject.source_version, `${label}.source_version`);
  identifier(subject.owner, `${label}.owner`);
  if (!Array.isArray(subject.capabilities) || subject.capabilities.length > 64) {
    invalid(`${label}.capabilities`, "must be an array with at most 64 entries");
  }
  for (const [index, capability] of subject.capabilities.entries()) {
    const prefix = `${label}.capabilities[${index}]`;
    plainObject(capability, prefix);
    exactFields(capability, CAPABILITY_FIELDS, prefix);
    identifier(capability.capability_id, `${prefix}.capability_id`);
    enumValue(capability.action, PLATFORM_OPERATION_ACTIONS, `${prefix}.action`);
    boolean(capability.available, `${prefix}.available`);
    nullableText(capability.unavailable_reason, `${prefix}.unavailable_reason`, 1024);
    identifier(capability.required_capability, `${prefix}.required_capability`);
    boolean(capability.approval_required, `${prefix}.approval_required`);
    boolean(capability.destructive, `${prefix}.destructive`);
  }
}

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

function assertBlocker(value, label) {
  if (value === null) return;
  plainObject(value, label);
  exactFields(value, BLOCKER_FIELDS, label);
  identifier(value.code, `${label}.code`);
  identifier(value.owner, `${label}.owner`);
  text(value.reason, `${label}.reason`, 2048);
  if (!Array.isArray(value.supported_dispositions) || value.supported_dispositions.length === 0) {
    invalid(`${label}.supported_dispositions`, "must be a non-empty array");
  }
  const allowed = ["remove", "workaround", "accept-risk", "defer"];
  value.supported_dispositions.forEach((entry, index) => {
    enumValue(entry, allowed, `${label}.supported_dispositions[${index}]`);
  });
  if (new Set(value.supported_dispositions).size !== value.supported_dispositions.length) {
    invalid(`${label}.supported_dispositions`, "must not contain duplicates");
  }
  identifier(value.next_action, `${label}.next_action`);
}

function assertFailure(value, label, action) {
  if (value === null) return;
  plainObject(value, label);
  const sourceRetry = SOURCE_CREDENTIAL_ACTIONS.includes(action) &&
    ["platform_source_issuance_uncertain", "platform_source_revocation_expiry_pending"].includes(value.code);
  exactFields(value, sourceRetry ? new Set([...FAILURE_FIELDS, "retry_after"]) : FAILURE_FIELDS, label);
  identifier(value.code, `${label}.code`);
  text(value.detail, `${label}.detail`, 2048);
  identifier(value.owner, `${label}.owner`);
  if (sourceRetry) assertSourceCredentialTimestamp(value.retry_after, `${label}.retry_after`);
}

function assertReceipt(value, label, action, command) {
  if (value === null) return;
  plainObject(value, label);
  const sourceSuccess = SOURCE_CREDENTIAL_ACTIONS.includes(action) && value.outcome === "succeeded";
  exactFields(value, sourceSuccess ? new Set([...RECEIPT_FIELDS, "source_credential"]) : RECEIPT_FIELDS, label);
  identifier(value.receipt_ref, `${label}.receipt_ref`);
  enumValue(value.outcome, ["succeeded", "failed", "cancelled"], `${label}.outcome`);
  timestamp(value.recorded_at, `${label}.recorded_at`);
  identifier(value.source_version, `${label}.source_version`);
  enumValue(value.effect, ["verified", "none", "partial"], `${label}.effect`);
  if (sourceSuccess) {
    if (value.effect !== "verified") invalid(`${label}.effect`, "must be verified for a successful source credential effect");
    const receipt = assertSourceCredentialReceipt(value.source_credential, command);
    if (receipt.action !== action) invalid(`${label}.source_credential.action`, "must match its operation");
  }
}

function assertEvent(value, label, expectedSequence) {
  plainObject(value, label);
  exactFields(value, EVENT_FIELDS, label);
  identifier(value.event_id, `${label}.event_id`);
  integer(value.sequence, `${label}.sequence`, { min: 1 });
  if (value.sequence !== expectedSequence) {
    invalid(`${label}.sequence`, `must be ${expectedSequence}`);
  }
  enumValue(value.state, PLATFORM_OPERATION_STATES, `${label}.state`);
  timestamp(value.occurred_at, `${label}.occurred_at`);
  text(value.summary, `${label}.summary`, 2048);
}

function boundedInput(value) {
  plainObject(value, "input");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 32_768) {
    invalid("input", "must not exceed 32768 bytes");
  }
  walkJson(value, "input", 0);
  return structuredClone(value);
}

function walkJson(value, label, depth) {
  if (depth > 6) invalid(label, "must not exceed six nested levels");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    if (value.length > 128) invalid(label, "array has too many entries");
    value.forEach((entry, index) => walkJson(entry, `${label}[${index}]`, depth + 1));
    return;
  }
  plainObject(value, label);
  const entries = Object.entries(value);
  if (entries.length > 128) invalid(label, "object has too many fields");
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(key)) {
      invalid(label, `contains invalid field ${key}`);
    }
    walkJson(entry, `${label}.${key}`, depth + 1);
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(label, "must be an object");
  }
}

function exactFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) invalid(`${label}.${field}`, "is not allowed");
  }
  for (const field of allowed) {
    if (!Object.hasOwn(value, field)) invalid(`${label}.${field}`, "is required");
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid(label, "must be a bounded identifier");
  }
  return value;
}

function nullableIdentifier(value, label) {
  return value === null ? null : identifier(value, label);
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid(label, "must be a sha256 digest");
  return value;
}

function integer(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) invalid(label, `must be an integer >= ${min}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") invalid(label, "must be a boolean");
  return value;
}

function text(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    invalid(label, `must be non-empty and no longer than ${maxLength} characters`);
  }
  return value.trim();
}

function nullableText(value, label, maxLength) {
  return value === null ? null : text(value, label, maxLength);
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    invalid(label, "must be an RFC3339 timestamp");
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) invalid(label, `must be one of ${allowed.join(", ")}`);
  return value;
}

function invalid(field, detail) {
  throw new HttpError(
    400,
    "platform_operation_contract_invalid",
    `Platform operation ${field} ${detail}.`,
  );
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
