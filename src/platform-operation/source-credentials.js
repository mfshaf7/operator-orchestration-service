import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

export const SOURCE_CREDENTIAL_ACTIONS = Object.freeze([
  "agent-source.issue", "agent-source.renew", "agent-source.revoke",
]);
export const SOURCE_INTENT_REFERENCE = /^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,241}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SOURCE_INTENT_FIELDS = Object.freeze([
  "schema_version", "purpose", "intent_id", "caller_id", "operator_id", "subject",
  "source_start_digest", "repository", "repository_id", "installation_id", "landing_unit_id",
  "branch", "fetched_base", "human_reviewer_id", "expires_at", "supersedes_intent_digest",
]);
export const SOURCE_CREDENTIAL_RECEIPT_FIELDS = Object.freeze([
  "schema_version", "artifact_type", "command_id", "action", "outcome", "source_intent_digest",
  "source_intent_id", "supersedes_intent_digest", "subject", "session_id", "landing_unit_id",
  "repository", "repository_id", "installation_id", "branch", "fetched_base", "human_reviewer_id",
  "caller_id", "operator_id", "source_start_digest", "identity_id", "logical_agent_id",
  "provider_principal", "app_id", "definition_digest", "permissions", "token_expires_at",
  "authorization_expires_at", "recorded_at", "secret_values_embedded", "receipt_digest",
]);

function invalid(message) {
  throw new HttpError(400, "platform_source_credential_contract_invalid", message);
}
function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    invalid(`${label} must contain exactly its closed contract fields.`);
  }
}
function match(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) invalid(`${label} is invalid.`);
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${label} must be a positive safe integer.`);
}
export function assertSourceCredentialTimestamp(value, label) {
  const parts = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) {
    invalid(`${label} must be a timezone-qualified timestamp.`);
  }
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      (parts[7] !== "Z" && (Number(parts[8]) > 23 || Number(parts[9]) > 59))) invalid(`${label} is not a valid calendar timestamp.`);
}
export function assertSourceCredentialSubject(subject) {
  if (subject?.kind === "delivery") {
    object(subject, ["kind", "work_item_ref", "snapshot_digest"], "Delivery source subject");
    match(subject.work_item_ref, /^work-item-[1-9][0-9]*$/, "work_item_ref");
    match(subject.snapshot_digest, DIGEST, "snapshot_digest");
  } else if (subject?.kind === "prototype") {
    object(subject, ["kind", "prototype_id", "registry_ref", "registry_revision", "source_ref", "source_revision"], "Prototype source subject");
    match(subject.prototype_id, /^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$/, "prototype_id");
    if (subject.registry_ref !== `record://prototypes/${subject.prototype_id.slice(10)}`) invalid("Prototype registry reference does not match its identity.");
    match(subject.registry_revision, COMMIT, "registry_revision");
    match(subject.source_revision, COMMIT, "source_revision");
    match(subject.source_ref, /^repo:\/\/[a-z0-9][a-z0-9._/-]*$/, "source_ref");
    if (subject.source_ref.slice(7).split("/").some(part => ["", ".", ".."].includes(part))) invalid("Prototype source reference is not bounded.");
  } else {
    invalid("Source credentials require an explicit Delivery or Prototype subject.");
  }
  return structuredClone(subject);
}

export function normalizeSourceCredentialInput(input) {
  if (Buffer.byteLength(JSON.stringify(input) ?? "", "utf8") > 32_768) invalid("Source credential input exceeds the existing 32768-byte command budget.");
  object(input, ["source_intent", "session_id"], "Source credential input");
  const value = input.source_intent;
  object(value, SOURCE_INTENT_FIELDS, "Source intent");
  if (value.schema_version !== 1 || value.purpose !== "ordinary-source") invalid("Only schema-v1 ordinary-source intent is admitted; bootstrap is separate.");
  for (const field of ["intent_id", "caller_id", "operator_id", "human_reviewer_id"]) match(value[field], IDENTIFIER, field);
  match(value.source_start_digest, DIGEST, "source_start_digest");
  match(value.repository, REPOSITORY, "repository");
  match(value.landing_unit_id, /^[a-z0-9][a-z0-9-]{2,127}$/, "landing_unit_id");
  // Platform's existing source contract owns branch syntax. Do not invent a
  // mandatory feature/fix prefix or a project-type-specific branch convention.
  match(value.branch, /^[a-z0-9][a-z0-9._/-]*$/, "branch");
  if (value.branch === "main" || value.branch.includes("..") || value.branch.endsWith("/") || value.branch.includes("//")) invalid("Source branch is not a bounded non-default review branch.");
  match(value.fetched_base, COMMIT, "fetched_base");
  integer(value.repository_id, "repository_id");
  integer(value.installation_id, "installation_id");
  assertSourceCredentialSubject(value.subject);
  assertSourceCredentialTimestamp(value.expires_at, "expires_at");
  if (value.supersedes_intent_digest !== null) match(value.supersedes_intent_digest, DIGEST, "supersedes_intent_digest");
  if (input.session_id !== null) match(input.session_id, IDENTIFIER, "session_id");
  return structuredClone(input);
}

export function assertSourceCredentialReceipt(value, command = null) {
  object(value, SOURCE_CREDENTIAL_RECEIPT_FIELDS, "Source credential receipt");
  if (value.schema_version !== 1 || value.artifact_type !== "source-intent-credential-receipt" || value.secret_values_embedded !== false) {
    invalid("Source credential receipt type/version/safety is invalid.");
  }
  if (!SOURCE_CREDENTIAL_ACTIONS.includes(value.action)) invalid("Source credential receipt action is not admitted.");
  const outcomes = value.action === "agent-source.revoke" ? ["revoked"] : value.action === "agent-source.issue" ? ["issued", "current"] : ["renewed", "current"];
  if (!outcomes.includes(value.outcome)) invalid("Source credential receipt outcome does not match its action.");
  for (const field of ["command_id", "source_intent_id", "caller_id", "operator_id", "identity_id", "logical_agent_id", "human_reviewer_id"]) match(value[field], IDENTIFIER, field);
  match(value.provider_principal, /^[A-Za-z0-9][A-Za-z0-9-]*\[bot\]$/, "provider_principal");
  integer(value.app_id, "app_id");
  match(value.definition_digest, DIGEST, "definition_digest");
  match(value.source_intent_digest, DIGEST, "source_intent_digest");
  const receiptInput = normalizeSourceCredentialInput({
    session_id: value.session_id,
    source_intent: {
      schema_version: 1, purpose: "ordinary-source", intent_id: value.source_intent_id,
      caller_id: value.caller_id, operator_id: value.operator_id, subject: value.subject,
      source_start_digest: value.source_start_digest, repository: value.repository, repository_id: value.repository_id,
      installation_id: value.installation_id, landing_unit_id: value.landing_unit_id, branch: value.branch,
      fetched_base: value.fetched_base, human_reviewer_id: value.human_reviewer_id,
      expires_at: value.authorization_expires_at, supersedes_intent_digest: value.supersedes_intent_digest,
    },
  });
  if (canonicalDigest(receiptInput.source_intent) !== value.source_intent_digest) invalid("Source credential receipt intent digest is invalid.");
  if (value.action === "agent-source.revoke") {
    if (value.token_expires_at !== null) invalid("Revoked credential receipt must not claim a live projection.");
  } else {
    assertSourceCredentialTimestamp(value.token_expires_at, "token_expires_at");
  }
  object(value.permissions, ["metadata", "contents", "pull_requests", "checks"], "Credential permissions");
  if (canonicalDigest(value.permissions) !== canonicalDigest({ metadata: "read", contents: "write", pull_requests: "write", checks: "read" })) {
    invalid("Source credential permissions do not match the existing ordinary-source boundary.");
  }
  assertSourceCredentialTimestamp(value.recorded_at, "recorded_at");
  match(value.receipt_digest, DIGEST, "receipt_digest");
  const { receipt_digest: recordedDigest, ...body } = value;
  if (recordedDigest !== canonicalDigest(body)) invalid("Source credential receipt digest is invalid.");
  if (command) {
    const expected = normalizeSourceCredentialInput(command.input);
    if (value.command_id !== command.command_id || value.action !== command.action || canonicalDigest(expected) !== canonicalDigest(receiptInput)) {
      throw new HttpError(409, "platform_source_credential_binding_mismatch", "Source credential receipt does not match the exact approved OOS command.");
    }
  }
  return structuredClone(value);
}
