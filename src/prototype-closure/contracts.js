import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const bundle = new URL("../../contracts/prototype-closure/", import.meta.url);
export const closureManifest = JSON.parse(readFileSync(new URL("manifest.json", bundle), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();
const commit = /^[0-9a-f]{40}$/;
const sha256 = /^sha256:[0-9a-f]{64}$/;
const safeRef = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9][A-Za-z0-9._~:/%+=-]*$/;
const authorityFields = new Set([
  "artifact_type", "issuer", "request_digest", "verification", "accepted_baseline_receipt_ref", "target_delivery_ref",
  "accepted_delivery_target_receipt_ref", "durable_owner_ref", "durable_repo_ref",
  "durable_owner_acceptance_ref", "observed_source_custody", "source_transfer_receipt_ref",
  "already_owned_source_proof_ref", "retention_plan_ref", "runtime_disposition_plan_ref",
  "runtime_disposition_proof_ref", "prior_retirement_receipt_ref", "prior_retirement_event_ref",
  "retained_source_readback_ref",
]);

if (
  closureManifest.runtime_activation !== false ||
  !commit.test(closureManifest.source_authority?.minimum_commit) ||
  !commit.test(closureManifest.contract_authority?.commit) ||
  closureManifest.security_review?.decision !== "approved-with-findings" ||
  !commit.test(closureManifest.security_review?.commit)
) {
  throw new Error("Prototype Closure authority manifest is invalid.");
}
for (const [name, expected] of Object.entries(closureManifest.files)) {
  const bytes = readFileSync(new URL(name, bundle));
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Prototype Closure schema integrity failed: ${name}`);
  }
  validators.set(name, ajv.compile(JSON.parse(bytes)));
}

export function closureError(code, message, status = 409) {
  return new HttpError(status, `prototype_closure_${code}`, message);
}

function compareKeys(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function closureCanonicalJson(value, { ascii = false } = {}) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw closureError("invalid_json", "Closure JSON contains invalid Unicode.", 400);
    const encoded = JSON.stringify(value);
    return ascii
      ? encoded.replace(/[\u007f-\uffff]/g, (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
      : encoded;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => closureCanonicalJson(entry, { ascii })).join(",")}]`;
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) =>
      `${closureCanonicalJson(key, { ascii })}:${closureCanonicalJson(value[key], { ascii })}`
    ).join(",")}}`;
  }
  throw closureError("invalid_json", "Closure JSON requires plain objects and lossless integral values.", 400);
}

export function closureDigest(value, { omit = null, ascii = false } = {}) {
  const payload = structuredClone(value);
  if (omit) delete payload[omit];
  return `sha256:${createHash("sha256").update(closureCanonicalJson(payload, { ascii })).digest("hex")}`;
}

export function assertClosureArtifact(value, name) {
  const validator = validators.get(`${name}.schema.json`);
  if (!validator?.(value)) {
    throw closureError("contract_invalid", `Invalid Prototype Closure ${name} artifact.`, 400);
  }
  return value;
}

export function createClosureEvaluation(request, expectedRecordDigest) {
  assertClosureArtifact(request, "request");
  if (Object.values(request).some((value) => typeof value === "string" && value.length > 1024)) {
    throw closureError("request_unbounded", "Closure request fields exceed the bounded limit.", 400);
  }
  if (Object.entries(request).some(([field, value]) => field.endsWith("_ref") && field !== "durable_owner_ref" &&
      (typeof value !== "string" || value.length > 512 || !safeRef.test(value)))) {
    throw closureError("request_ref_invalid", "Closure references require bounded owner-resolvable URIs.", 400);
  }
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.prototype_id) ||
    !commit.test(request.expected_source_revision) ||
    !sha256.test(expectedRecordDigest)
  ) {
    throw closureError("source_invalid", "Closure requires an exact Studio revision and record digest.", 400);
  }
  const evaluation = {
    schema_version: 1,
    artifact_type: "prototype-closure-evaluation",
    evaluation_id: `prototype-closure-evaluation:${closureDigest({ request_id: request.request_id, idempotency_key: request.idempotency_key }).slice(7)}`,
    expected_record_digest: expectedRecordDigest,
    request: structuredClone(request),
  };
  evaluation.evaluation_digest = closureDigest(evaluation, { omit: "evaluation_digest" });
  return evaluation;
}

export function assertClosureReadiness(body, evaluation, { implementationRef, serviceIdentityRef, now = new Date() }) {
  const readiness = body?.readiness;
  const ledger = body?.ledger;
  if (
    readiness?.artifact_type !== "prototype-closure-readiness" ||
    readiness?.request_ref?.id !== evaluation.request.request_id ||
    readiness?.request_ref?.digest !== closureDigest(evaluation.request, { ascii: true }) ||
    readiness?.source_revision !== evaluation.request.expected_source_revision ||
    readiness?.prototype_id !== evaluation.request.prototype_id ||
    readiness?.action !== evaluation.request.action ||
    readiness?.record_digest !== evaluation.expected_record_digest ||
    readiness?.actor !== "operator-orchestration-service" ||
    readiness?.operator_id !== evaluation.request.operator_id ||
    readiness?.contract_digest !== `sha256:${closureManifest.contract_authority.digest}` ||
    readiness?.security_review_ref !== closureManifest.security_review.commit ||
    !Array.isArray(readiness?.evidence) ||
    readiness?.evidence_digest !== closureDigest(readiness.evidence) ||
    !sha256.test(readiness?.readiness_digest) ||
    readiness.readiness_digest !== closureDigest(readiness, { omit: "readiness_digest" }) ||
    ledger?.ref?.uri !== `wgcf://readiness/prototype-closure/${readiness.readiness_digest.slice(7)}` ||
    ledger?.ref?.digest !== readiness.readiness_digest ||
    ledger?.authority_revision !== readiness.source_revision ||
    ledger?.implementation_ref !== implementationRef ||
    ledger?.service_identity_ref !== serviceIdentityRef ||
    ledger?.state !== "durable" ||
    Date.parse(ledger.expires_at) <= now.getTime()
  ) {
    throw closureError("readiness_invalid", "Closure readiness does not bind the exact request, issuer, or current source.", 502);
  }
  return body;
}

const evidenceFields = {
  "apply-delivery": ["accepted_baseline_receipt_ref", "accepted_delivery_target_receipt_ref", "target_delivery_ref"],
  "graduate-source": ["accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref"],
  "retire-incubation": ["retention_plan_ref", "runtime_disposition_plan_ref", "runtime_disposition_proof_ref"],
  "reopen-incubation": ["prior_retirement_receipt_ref", "retained_source_readback_ref"],
};

export function assertResolvedAuthority(request, value, readiness) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some((field) => !authorityFields.has(field)) ||
      !value.verification || Object.getPrototypeOf(value.verification) !== Object.prototype ||
      Object.keys(value.verification).sort().join(",") !== "evidence_refs,source_revision,state" ||
      !Array.isArray(value.verification.evidence_refs) || value.verification.evidence_refs.length > 16 ||
      Object.entries(value).some(([field, entry]) => field.endsWith("_ref") && field !== "durable_owner_ref" &&
        (typeof entry !== "string" || entry.length > 512 || !safeRef.test(entry))) ||
      value.verification.evidence_refs?.some((ref) => typeof ref !== "string" || ref.length > 512 || !safeRef.test(ref))) {
    throw closureError("authority_unbounded", "Resolved Closure authority contains unsupported or unsafe fields.");
  }
  if (
    value?.artifact_type !== "prototype-closure-resolved-authority" ||
    value.issuer !== "operator-orchestration-service" ||
    value.request_digest !== closureDigest(request, { ascii: true }) ||
    value.verification?.state !== "accepted" ||
    value.verification?.source_revision !== request.expected_source_revision ||
    !Array.isArray(value.verification?.evidence_refs) ||
    value.verification.evidence_refs.length === 0
  ) {
    throw closureError("authority_invalid", "Resolved Closure authority does not bind the exact request.");
  }
  for (const field of [
    "target_delivery_ref", "accepted_delivery_target_receipt_ref", "durable_owner_ref", "durable_repo_ref",
    "durable_owner_acceptance_ref", "already_owned_source_proof_ref",
    "retention_plan_ref", "runtime_disposition_plan_ref", "prior_retirement_receipt_ref",
  ]) {
    if (request[field] && value[field] !== request[field]) {
      throw closureError("authority_mismatch", `Resolved ${field} differs from the accepted request.`);
    }
  }
  const required = {
    "apply-delivery": ["target_delivery_ref", "accepted_delivery_target_receipt_ref"],
    "graduate-source": ["accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref", "durable_owner_ref", "durable_repo_ref", "observed_source_custody"],
    "retire-incubation": ["runtime_disposition_proof_ref"],
    "reopen-incubation": ["prior_retirement_event_ref", "retained_source_readback_ref"],
  }[request.action];
  for (const field of required) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw closureError("authority_missing", `Verified Closure authority lacks ${field}.`);
    }
  }
  if (
    request.action === "graduate-source" &&
    (request.transfer_strategy === "transfer"
      ? !value.source_transfer_receipt_ref
      : value.already_owned_source_proof_ref !== request.already_owned_source_proof_ref)
  ) {
    throw closureError("custody_unproven", "Exact durable source custody is not proven.");
  }
  const fields = [...evidenceFields[request.action]];
  if (request.action === "graduate-source") {
    fields.push(request.transfer_strategy === "transfer" ? "source_transfer_receipt_ref" : "already_owned_source_proof_ref");
  }
  const rows = readiness?.readiness?.evidence;
  if (!Array.isArray(rows) || fields.some((field) => {
    const matches = rows.filter((row) => row.field === field);
    return matches.length !== 1 || matches[0].state !== "accepted" ||
      matches[0].ref !== (value[field] ?? request[field]) || !sha256.test(matches[0].digest) ||
      !value.verification.evidence_refs.includes(matches[0].ref);
  })) {
    throw closureError("authority_evidence_mismatch", "Resolved Closure authority differs from the accepted WGCF evidence.");
  }
  return value;
}
