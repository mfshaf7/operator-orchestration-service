import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/lifecycle-transition/", import.meta.url);
export const lifecycleTransitionManifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);

const sourceFiles = Object.entries(lifecycleTransitionManifest.files);
for (const [name, entry] of sourceFiles) {
  const bytes = readFileSync(new URL(name, root));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) {
    throw new Error(`Lifecycle Transition contract integrity failed: ${name}`);
  }
}

const lifecycle = YAML.parse(
  readFileSync(new URL("project-lifecycle.yaml", root), "utf8"),
).project_lifecycle;
const projectionContract = lifecycle.projection_contract;
export const lifecycleTransitionRoutes = Object.freeze(
  structuredClone(projectionContract.locked_routes),
);
export const lifecycleTransitionStates = new Set(projectionContract.states);
export const lifecycleTransitionTerminalStates = new Set(
  projectionContract.terminal_states,
);
export const lifecycleTransitionNextActions = new Set(
  projectionContract.next_actions,
);
export const lifecycleTransitionEventKinds = new Set(
  projectionContract.history_event_kinds,
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateProjection = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL("lifecycle-transition-projection.schema.json", root),
      "utf8",
    ),
  ),
);

const TEXT_LIMIT = 1024;
const DETAIL_LIMIT = 4096;
const MAX_REFS = 32;
const ROLES = new Set([
  "decision-authority",
  "orchestration",
  "source-domain",
  "target-adapter",
  "target-domain",
  "validation-authority",
]);

export function lifecycleTransitionError(code, message, status = 409, details = null) {
  return new HttpError(status, `lifecycle_transition_${code}`, message, details);
}

export function lifecycleTransitionDigest(value, field = null) {
  const candidate = structuredClone(value);
  if (field) delete candidate[field];
  return canonicalDigest(candidate);
}

export function assertLifecycleTransitionProjection(value) {
  if (!validateProjection(value)) {
    throw lifecycleTransitionError(
      "projection_invalid",
      "Lifecycle Transition projection does not satisfy the canonical contract.",
      500,
      validateProjection.errors,
    );
  }
  return value;
}

export function assertLifecycleTransitionRequest(value) {
  exactObject(value, [
    "correlation_id",
    "evidence_refs",
    "idempotency_key",
    "reason",
    "requested_by",
    "route_id",
    "schema_version",
    "source",
    "supersedes_transition_id",
  ], "request");
  if (value.schema_version !== 1 || !lifecycleTransitionRoutes[value.route_id]) {
    invalid("request route or schema version is invalid.");
  }
  text(value.correlation_id, "correlation_id");
  text(value.idempotency_key, "idempotency_key");
  text(value.requested_by, "requested_by");
  nullableText(value.supersedes_transition_id, "supersedes_transition_id");
  references(value.evidence_refs, "evidence_refs", { min: 1 });
  exactObject(value.reason, ["code", "detail"], "reason");
  text(value.reason.code, "reason.code");
  text(value.reason.detail, "reason.detail", DETAIL_LIMIT);
  exactObject(value.source, [
    "owner_ref",
    "projection_version",
    "record_id",
    "source_version",
  ], "source");
  for (const field of Object.keys(value.source)) {
    text(value.source[field], `source.${field}`);
  }
  const route = lifecycleTransitionRoutes[value.route_id];
  if (value.source.owner_ref !== route.intent_owner_ref) {
    throw lifecycleTransitionError(
      "source_owner_mismatch",
      "Lifecycle Transition source owner does not match the locked route.",
      400,
    );
  }
  return value;
}

export function assertLifecycleTransitionEvent(value) {
  exactObject(value, [
    "artifact_kind",
    "authority",
    "details",
    "event_id",
    "evidence_refs",
    "expected_sequence",
    "recorded_at",
    "schema_version",
  ], "event");
  if (value.schema_version !== 1 || !lifecycleTransitionEventKinds.has(value.artifact_kind)) {
    invalid("event kind or schema version is invalid.");
  }
  text(value.event_id, "event_id");
  if (!Number.isSafeInteger(value.expected_sequence) || value.expected_sequence < 0) {
    invalid("expected_sequence must be a non-negative safe integer.");
  }
  timestamp(value.recorded_at, "recorded_at");
  references(value.evidence_refs, "evidence_refs", { min: 1 });
  exactObject(value.authority, ["owner_ref", "role"], "authority");
  text(value.authority.owner_ref, "authority.owner_ref");
  if (!ROLES.has(value.authority.role)) invalid("authority.role is invalid.");
  if (!value.details || Array.isArray(value.details) || typeof value.details !== "object") {
    invalid("event details must be an object.");
  }
  assertEventDetails(value.artifact_kind, value.details);
  return value;
}

export function lifecycleTransitionId(request) {
  const digest = lifecycleTransitionDigest({
    idempotency_key: request.idempotency_key,
    route_id: request.route_id,
    source_record_id: request.source.record_id,
    source_version: request.source.source_version,
  }).slice("sha256:".length);
  return `lifecycle-transition:${digest}`;
}

export function lifecycleTransitionEventDigest(event) {
  return lifecycleTransitionDigest(event, "event_digest");
}

export function lifecycleTransitionReference(transitionId) {
  text(transitionId, "transition_id");
  return `lifecycle-transition://${transitionId}`;
}

export function parseBoundedLimit(value, fallback = 50) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw lifecycleTransitionError(
      "limit_invalid",
      "limit must be an integer from 1 through 100.",
      400,
    );
  }
  return parsed;
}

function assertEventDetails(kind, details) {
  const shapes = {
    "validation-started": ["run_ref"],
    "validation-completed": [
      "gates",
      "receipt_ref",
      "requires_authority_decision",
      "state",
    ],
    "authority-decision-recorded": ["decision"],
    "target-admission-recorded": ["admission"],
    "application-started": ["run_ref"],
    "target-application-recorded": ["application"],
    "application-failed": ["failure"],
    "gate-blocked": ["gate"],
    "source-correction-returned": ["correction"],
    "transition-deferred": ["deferred"],
    "transition-cancelled": ["reason_code"],
    "transition-superseded": ["superseding_transition_id"],
  };
  const keys = shapes[kind];
  if (!keys) invalid(`${kind} cannot be appended directly.`);
  exactObject(details, keys, `${kind}.details`);

  if (["validation-started", "application-started"].includes(kind)) {
    text(details.run_ref, "details.run_ref");
  } else if (kind === "validation-completed") {
    if (!["passed", "blocked"].includes(details.state)) {
      invalid("validation state is invalid.");
    }
    nullableText(details.receipt_ref, "details.receipt_ref");
    if (typeof details.requires_authority_decision !== "boolean") {
      invalid("requires_authority_decision must be boolean.");
    }
    if (!Array.isArray(details.gates) || details.gates.length > 32) {
      invalid("validation gates must be a bounded array.");
    }
    details.gates.forEach((gate) => assertGate(gate));
    if (details.state === "passed" && !details.receipt_ref) {
      invalid("passed validation requires receipt_ref.");
    }
    if (
      details.state === "blocked" &&
      !details.gates.some(
        (gate) => gate.state === "blocked" && gate.required_fix,
      )
    ) {
      invalid("blocked validation requires a blocked gate and required fix.");
    }
  } else if (kind === "authority-decision-recorded") {
    assertDecision(details.decision);
  } else if (kind === "target-admission-recorded") {
    assertAdmission(details.admission);
  } else if (kind === "target-application-recorded") {
    assertApplication(details.application);
  } else if (kind === "application-failed") {
    assertFailure(details.failure);
  } else if (kind === "gate-blocked") {
    assertGate(details.gate);
    if (details.gate.state !== "blocked" || !details.gate.required_fix) {
      invalid("blocked gate requires blocked state and required fix.");
    }
  } else if (kind === "source-correction-returned") {
    exactObject(details.correction, ["owner_ref", "reason_code", "required_fix"], "correction");
    text(details.correction.owner_ref, "correction.owner_ref");
    text(details.correction.reason_code, "correction.reason_code");
    text(details.correction.required_fix, "correction.required_fix", DETAIL_LIMIT);
  } else if (kind === "transition-deferred") {
    exactObject(details.deferred, ["justification", "reason_code", "review_at"], "deferred");
    text(details.deferred.justification, "deferred.justification", DETAIL_LIMIT);
    text(details.deferred.reason_code, "deferred.reason_code");
    timestamp(details.deferred.review_at, "deferred.review_at");
  } else if (kind === "transition-cancelled") {
    text(details.reason_code, "details.reason_code");
  } else if (kind === "transition-superseded") {
    text(details.superseding_transition_id, "details.superseding_transition_id");
  }
}

function assertGate(value) {
  exactObject(value, ["evidence_ref", "gate_id", "owner_ref", "required_fix", "state"], "gate");
  nullableText(value.evidence_ref, "gate.evidence_ref");
  text(value.gate_id, "gate.gate_id");
  text(value.owner_ref, "gate.owner_ref");
  nullableText(value.required_fix, "gate.required_fix", DETAIL_LIMIT);
  if (!["blocked", "not-required", "passed"].includes(value.state)) {
    invalid("gate.state is invalid.");
  }
}

function assertDecision(value) {
  exactObject(value, [
    "authority_owner_ref",
    "control_id",
    "decision",
    "evidence_type",
    "justification",
    "receipt_ref",
    "recorded_at",
    "review_at",
  ], "decision");
  for (const field of ["authority_owner_ref", "control_id", "evidence_type"]) {
    text(value[field], `decision.${field}`);
  }
  if (!["approved", "deferred", "pending"].includes(value.decision)) {
    invalid("decision.decision is invalid.");
  }
  nullableText(value.justification, "decision.justification", DETAIL_LIMIT);
  nullableText(value.receipt_ref, "decision.receipt_ref");
  nullableTimestamp(value.recorded_at, "decision.recorded_at");
  nullableTimestamp(value.review_at, "decision.review_at");
  if (value.decision === "approved" && (!value.receipt_ref || !value.recorded_at)) {
    invalid("approved authority decision requires receipt and recorded_at.");
  }
  if (value.decision === "deferred" && (!value.justification || !value.review_at)) {
    invalid("deferred authority decision requires justification and review_at.");
  }
}

function assertAdmission(value) {
  exactObject(value, ["reason_code", "receipt_ref", "recorded_at", "state", "target_record_ref"], "admission");
  if (!["admitted", "rejected"].includes(value.state)) invalid("admission.state is invalid.");
  nullableText(value.reason_code, "admission.reason_code");
  nullableText(value.receipt_ref, "admission.receipt_ref");
  timestamp(value.recorded_at, "admission.recorded_at");
  nullableText(value.target_record_ref, "admission.target_record_ref");
  if (value.state === "admitted" && (!value.receipt_ref || !value.target_record_ref)) {
    invalid("admitted target requires receipt and target record references.");
  }
  if (value.state === "rejected" && !value.reason_code) {
    invalid("rejected admission requires reason_code.");
  }
}

function assertApplication(value) {
  exactObject(value, ["evidence_kind", "receipt_ref", "resulting_refs", "target_record_ref"], "application");
  if (!["target-admission-receipt", "target-application-receipt"].includes(value.evidence_kind)) {
    invalid("application.evidence_kind is invalid.");
  }
  text(value.receipt_ref, "application.receipt_ref");
  text(value.target_record_ref, "application.target_record_ref");
  references(value.resulting_refs, "application.resulting_refs");
}

function assertFailure(value) {
  exactObject(value, ["code", "detail", "retryable", "run_ref"], "failure");
  text(value.code, "failure.code");
  text(value.detail, "failure.detail", DETAIL_LIMIT);
  if (typeof value.retryable !== "boolean") invalid("failure.retryable must be boolean.");
  if (!value.retryable) invalid("application-failed is reserved for retryable failures.");
  text(value.run_ref, "failure.run_ref");
}

function references(value, field, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_REFS) {
    invalid(`${field} must contain ${min} through ${MAX_REFS} references.`);
  }
  value.forEach((entry) => text(entry, field));
  if (new Set(value).size !== value.length) invalid(`${field} must be unique.`);
}

function exactObject(value, keys, field) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    invalid(`${field} must be an object.`);
  }
  const actual = Object.keys(value).sort().join(",");
  const expected = [...keys].sort().join(",");
  if (actual !== expected) invalid(`${field} fields are invalid.`);
}

function text(value, field, limit = TEXT_LIMIT) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    invalid(`${field} must be non-empty text of at most ${limit} characters.`);
  }
}

function nullableText(value, field, limit = TEXT_LIMIT) {
  if (value !== null) text(value, field, limit);
}

function timestamp(value, field) {
  text(value, field);
  if (!Number.isFinite(Date.parse(value))) invalid(`${field} must be an RFC 3339 timestamp.`);
}

function nullableTimestamp(value, field) {
  if (value !== null) timestamp(value, field);
}

function invalid(message) {
  throw lifecycleTransitionError("contract_invalid", message, 400);
}
