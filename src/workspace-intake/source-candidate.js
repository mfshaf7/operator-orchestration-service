import { bindIntake, assertIntake, intakeDigest, intakeError } from "./contracts.js";

const SOURCE_CALLERS = Object.freeze({
  delivery: "operator-orchestration-service",
  prototype: "workspace-prototype-studio",
  "repository-custody": "operator-orchestration-service",
});

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TARGET_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const TARGET_KINDS = new Set(["repo", "product", "component"]);

function exactKeys(value, keys) {
  return value && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw intakeError("source_candidate_invalid", `${label} must be a non-empty string.`, 400);
  }
}

function assertRequestedRecord(target, requestedRecord) {
  const request = bindIntake({
    schema_version: 2,
    artifact_type: "workspace-intake-request",
    request_id: "source-candidate:validation",
    requested_at: "2000-01-01T00:00:00.000Z",
    requester_ref: "source-candidate-validator",
    source: { class: "direct", ref: "source-candidate:validation", digest: intakeDigest("source") },
    target,
    action: "add",
    requested_classification: "proposed",
    owner_route: "workspace-governance",
    requested_record: requestedRecord,
    expected_state: { register_digest: intakeDigest("register"), record_version: null, record_digest: null },
    idempotency_key: "source-candidate:validation",
  }, "request_digest");
  assertIntake("request", request);
}

export function assertWorkspaceIntakeSourceCandidate(value) {
  if (!exactKeys(value, [
    "artifact_type",
    "candidate_digest",
    "evidence_refs",
    "requested_record",
    "schema_version",
    "source",
    "target",
  ]) || value.schema_version !== 1 ||
      value.artifact_type !== "workspace-intake-source-candidate") {
    throw intakeError("source_candidate_invalid", "Source candidate has an invalid envelope.", 400);
  }
  const { source, target } = value;
  if (!exactKeys(source, ["class", "digest", "ref"]) ||
      !Object.hasOwn(SOURCE_CALLERS, source.class) ||
      !DIGEST.test(source.digest)) {
    throw intakeError("source_candidate_invalid", "Source candidate identity is invalid.", 400);
  }
  assertText(source.ref, "Source reference");
  if (!exactKeys(target, ["kind", "name", "record_id"]) ||
      !TARGET_KINDS.has(target.kind) || !TARGET_NAME.test(target.name) ||
      target.record_id !== `${target.kind}:${target.name}`) {
    throw intakeError("source_candidate_invalid", "Source candidate target is invalid.", 400);
  }
  if (!Array.isArray(value.evidence_refs) ||
      value.evidence_refs.length === 0 ||
      new Set(value.evidence_refs).size !== value.evidence_refs.length) {
    throw intakeError("source_candidate_invalid", "Source candidate requires unique evidence references.", 400);
  }
  value.evidence_refs.forEach((entry) => assertText(entry, "Evidence reference"));
  assertRequestedRecord(target, value.requested_record);
  if (value.candidate_digest !== intakeDigest(value, "candidate_digest")) {
    throw intakeError("source_candidate_digest_invalid", "Source candidate digest is invalid.", 400);
  }
  return structuredClone(value);
}

export function bindWorkspaceIntakeSourceCandidate(value) {
  return assertWorkspaceIntakeSourceCandidate({
    ...structuredClone(value),
    candidate_digest: intakeDigest(value, "candidate_digest"),
  });
}

export function assertWorkspaceIntakeSourceCaller(candidate, callerId) {
  const expected = SOURCE_CALLERS[candidate.source.class];
  if (callerId !== expected) {
    throw intakeError(
      "source_candidate_caller_mismatch",
      `Source class ${candidate.source.class} requires its authenticated owner caller.`,
      403,
    );
  }
}

export function assertWorkspaceIntakeRequestCandidate(request, candidate) {
  if (intakeDigest(request.source) !== intakeDigest(candidate.source)) {
    throw intakeError("source_candidate_mismatch", "Request source does not match its source-owner attestation.");
  }
  if (intakeDigest(request.target) !== intakeDigest(candidate.target)) {
    throw intakeError("source_candidate_mismatch", "Request target does not match its source-owner attestation.");
  }
  if (intakeDigest(request.requested_record) !== intakeDigest(candidate.requested_record)) {
    throw intakeError("source_candidate_mismatch", "Requested record does not match its source-owner attestation.");
  }
  return candidate;
}

export function deliveryWorkspaceIntakeSourceCandidate(event) {
  if (!event || event.status !== "applied" || event.impact?.kind !== "workspace_entrant") {
    return null;
  }
  const source = event.impact.candidate;
  const kind = source.entrant_kind === "repository" ? "repo" : source.entrant_kind;
  const requestedRecord = {
    kind,
    notes: `Candidate emitted by ${source.correlation_ref} after Delivery closeout.`,
    ...structuredClone(source.intake_metadata),
  };
  return bindWorkspaceIntakeSourceCandidate({
    schema_version: 1,
    artifact_type: "workspace-intake-source-candidate",
    source: { class: "delivery", ref: event.outcome_ref, digest: event.receipt.digest },
    target: { kind, name: source.canonical_key, record_id: `${kind}:${source.canonical_key}` },
    requested_record: requestedRecord,
    evidence_refs: [...source.evidence_refs],
  });
}
