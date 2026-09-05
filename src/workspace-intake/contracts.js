import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/workspace-intake/", import.meta.url);
export const intakeManifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();
for (const [name, entry] of Object.entries(intakeManifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`Intake bundle integrity failed: ${name}`);
  if (name.endsWith(".json")) validators.set(name.split(".")[0], ajv.compile(JSON.parse(bytes)));
}

export function intakeError(code, message, status = 409) {
  return new HttpError(status, `workspace_intake_${code}`, message);
}

// Workspace v2 sorts Unicode code points, not RFC 8785 UTF-16 code units.
function compareKeys(a, b) {
  const left = Array.from(a, (c) => c.codePointAt(0));
  const right = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export function intakeStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw intakeError("invalid_json", "Invalid Unicode string.", 400);
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(intakeStringify).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) => `${intakeStringify(key)}:${intakeStringify(value[key])}`).join(",")}}`;
  }
  throw intakeError("invalid_json", "Intake JSON requires lossless integral values and plain objects.", 400);
}

export function intakeDigest(value, field = null) {
  const projection = structuredClone(value);
  if (field) delete projection[field];
  return `sha256:${createHash("sha256").update(intakeStringify(projection)).digest("hex")}`;
}

export function bindIntake(value, field) {
  return { ...structuredClone(value), [field]: intakeDigest(value, field) };
}

export function assertIntake(kind, value) {
  const validate = validators.get(kind);
  if (!validate?.(value)) throw intakeError("contract_invalid", `Invalid intake ${kind}.`, 400);
  const field = `${kind === "readiness" ? "receipt" : kind}_digest`;
  if (value[field] !== intakeDigest(value, field)) throw intakeError("digest_invalid", `Invalid intake ${kind} digest.`, 400);
  return value;
}

export function intakeReference(value, kind) {
  return { id: value[`${kind}_id`], digest: value[`${kind}_digest`] };
}

export function createIntakeEvaluation(input, callerId) {
  if (!input || Object.keys(input).sort().join(",") !== "authority_revision,decision,execution_ref,request,session_ref") {
    throw intakeError("command_invalid", "Supply request, decision, authority revision, session and execution references.", 400);
  }
  assertIntake("request", input.request);
  assertIntake("decision", input.decision);
  if (input.decision.operator_acceptance.operator_ref !== callerId) {
    throw intakeError("operator_mismatch", "The accepted decision must belong to the authenticated operator.", 403);
  }
  if (intakeDigest(input.decision.request_ref) !== intakeDigest(intakeReference(input.request, "request")) ||
      intakeDigest(input.request.target) !== intakeDigest(input.decision.target)) {
    throw intakeError("decision_mismatch", "The decision does not bind this exact request.");
  }
  const identity = intakeDigest({ ...input, caller_id: callerId }).slice(7);
  return assertIntake("evaluation", bindIntake({
    schema_version: 1,
    evaluation_id: `intake:${identity}`,
    ...structuredClone(input),
  }, "evaluation_digest"));
}

export const intakeContractRoot = fileURLToPath(root);
