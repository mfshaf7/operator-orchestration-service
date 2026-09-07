import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/prototype-landing/", import.meta.url);
export const prototypeLandingManifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();
for (const [name, entry] of Object.entries(prototypeLandingManifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error(`Prototype Landing bundle integrity failed: ${name}`);
  }
  if (name.endsWith(".schema.json")) validators.set(name, ajv.compile(JSON.parse(bytes)));
}

const artifactShape = {
  "prototype-entry-packet": ["prototype-landing-entry-packet.schema.json", "entry_id", "packet_digest"],
  "prototype-landing-request": ["prototype-landing-request.schema.json", "request_id", "request_digest"],
  "prototype-landing-plan": ["prototype-landing-plan.schema.json", "plan_id", "plan_digest"],
  "prototype-landing-readiness": ["prototype-landing-readiness.schema.json", "readiness_id", "readiness_digest"],
  "prototype-landing-apply": ["prototype-landing-apply.schema.json", "apply_id", "apply_digest"],
  "prototype-landing-readback": ["prototype-landing-readback.schema.json", "readback_id", "readback_digest"],
  "prototype-landing-receipt": ["prototype-landing-receipt.schema.json", "receipt_id", "receipt_digest"],
};

export function prototypeLandingError(code, message, status = 409) {
  return new HttpError(status, `prototype_landing_${code}`, message);
}

function compareKeys(a, b) {
  const left = Array.from(a, (character) => character.codePointAt(0));
  const right = Array.from(b, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

export function prototypeLandingStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw prototypeLandingError("invalid_json", "Prototype Landing JSON contains invalid Unicode.", 400);
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(prototypeLandingStringify).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) => `${prototypeLandingStringify(key)}:${prototypeLandingStringify(value[key])}`).join(",")}}`;
  }
  throw prototypeLandingError("invalid_json", "Prototype Landing JSON requires lossless integral values and plain objects.", 400);
}

export function prototypeLandingDigest(value, field = null) {
  const projection = structuredClone(value);
  if (field) delete projection[field];
  return `sha256:${createHash("sha256").update(prototypeLandingStringify(projection)).digest("hex")}`;
}

export function bindPrototypeLanding(value, field) {
  return { ...structuredClone(value), [field]: prototypeLandingDigest(value, field) };
}

export function assertPrototypeLandingArtifact(value) {
  const shape = artifactShape[value?.artifact_type];
  if (!shape) throw prototypeLandingError("artifact_type_invalid", "Unsupported Prototype Landing artifact.", 400);
  const [schema, , digestField] = shape;
  if (!validators.get(schema)?.(value)) throw prototypeLandingError("contract_invalid", `Invalid ${value.artifact_type} artifact.`, 400);
  if (value[digestField] !== prototypeLandingDigest(value, digestField)) {
    throw prototypeLandingError("digest_invalid", `Invalid ${value.artifact_type} digest.`, 400);
  }
  return value;
}

export function prototypeLandingReference(value) {
  const shape = artifactShape[value?.artifact_type];
  if (!shape) throw prototypeLandingError("artifact_type_invalid", "Unsupported Prototype Landing artifact.", 400);
  return { id: value[shape[1]], digest: value[shape[2]] };
}

function same(left, right) {
  return prototypeLandingDigest(left) === prototypeLandingDigest(right);
}

export function createPrototypeLandingEvaluation(input, callerId) {
  const keys = "authority_revision,entry_packet,execution_ref,operator_approval_ref,plan,request,session_ref";
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== keys) {
    throw prototypeLandingError("command_invalid", "Supply the entry packet, request, plan, operator approval, authority revision, session and execution references.", 400);
  }
  const entry = assertPrototypeLandingArtifact(input.entry_packet);
  const request = assertPrototypeLandingArtifact(input.request);
  const plan = assertPrototypeLandingArtifact(input.plan);
  if (request.operator_ref !== callerId) throw prototypeLandingError("operator_mismatch", "The accepted Landing request must belong to the authenticated operator.", 403);
  if (!request.operator_accepted || typeof input.operator_approval_ref !== "string" || !input.operator_approval_ref.trim()) {
    throw prototypeLandingError("approval_missing", "Prototype Landing requires explicit operator approval.", 403);
  }
  if (!same(request.entry_packet_ref, prototypeLandingReference(entry)) ||
      !same(plan.request_ref, prototypeLandingReference(request)) ||
      plan.prototype_id !== request.prototype.id || !same(plan.source_plan, request.source_plan)) {
    throw prototypeLandingError("artifact_binding_invalid", "Prototype Landing artifacts do not bind the same accepted request.");
  }
  if (!/^[0-9a-f]{40}$/.test(input.authority_revision) || request.expected_state.source_revision !== input.authority_revision) {
    throw prototypeLandingError("authority_mismatch", "The request must bind the exact Prototype Studio authority revision.");
  }
  const identity = request.request_id.replace(/^prototype-landing-request:/, "prototype-landing-evaluation:");
  const evaluation = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "wgcf-prototype-landing-evaluation",
    evaluation_id: identity,
    session_ref: input.session_ref,
    execution_ref: input.execution_ref,
    authority_revision: input.authority_revision,
    entry_packet: structuredClone(entry),
    request: structuredClone(request),
    plan: structuredClone(plan),
  }, "evaluation_digest");
  if (!validators.get("evaluation.schema.json")?.(evaluation)) {
    throw prototypeLandingError("evaluation_invalid", "Prototype Landing evaluation does not satisfy the WGCF contract.", 400);
  }
  return evaluation;
}

export function createPrototypeLandingApply({ evaluation, readiness, operatorApprovalRef, sourceBranch, requestedAt }) {
  return assertPrototypeLandingArtifact(bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-apply",
    apply_id: evaluation.request.request_id.replace(/^prototype-landing-request:/, "prototype-landing-apply:"),
    requested_at: requestedAt,
    request_ref: prototypeLandingReference(evaluation.request),
    plan_ref: prototypeLandingReference(evaluation.plan),
    readiness_ref: prototypeLandingReference(readiness),
    prototype_id: evaluation.request.prototype.id,
    expected_state: {
      registry_digest: readiness.observed_state.registry_digest,
      record_present: readiness.observed_state.record_present,
      source_revision: readiness.observed_state.source_revision,
    },
    operator_approval_ref: operatorApprovalRef,
    source_branch: sourceBranch,
    correlation_id: evaluation.request.correlation_id,
    idempotency_key: evaluation.request.idempotency_key,
  }, "apply_digest"));
}

export const prototypeLandingContractRoot = fileURLToPath(root);
