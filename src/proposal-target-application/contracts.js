import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/proposal-target-application/", import.meta.url);
export const proposalTargetManifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();
for (const [name, entry] of Object.entries(proposalTargetManifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error(`Proposal target application bundle integrity failed: ${name}`);
  }
  validators.set(name, ajv.compile(JSON.parse(bytes)));
}

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PROPOSAL = /^idea-[1-9][0-9]*$/;
const PROTOTYPE = /^prototype:proposal-([1-9][0-9]*)$/;
const APPLICATION = /^proposal-prototype-application:proposal-([1-9][0-9]*):([1-9][0-9]*)$/;

export function proposalTargetError(code, message, status = 409, details) {
  return new HttpError(status, `proposal_target_${code}`, message, details);
}

function compareKeys(a, b) {
  const left = Array.from(a, (character) => character.codePointAt(0));
  const right = Array.from(b, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

export function proposalTargetStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw proposalTargetError("invalid_json", "Proposal target JSON contains invalid Unicode.", 400);
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(proposalTargetStringify).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) => `${proposalTargetStringify(key)}:${proposalTargetStringify(value[key])}`).join(",")}}`;
  }
  throw proposalTargetError("invalid_json", "Proposal target JSON requires lossless integral values and plain objects.", 400);
}

export function proposalTargetDigest(value, field = null) {
  const projection = structuredClone(value);
  if (field) delete projection[field];
  return `sha256:${createHash("sha256").update(proposalTargetStringify(projection)).digest("hex")}`;
}

export function bindProposalTarget(value, field) {
  return { ...structuredClone(value), [field]: proposalTargetDigest(value, field) };
}

export function assertProposalTargetArtifact(value) {
  const mapping = {
    "proposal-prototype-application": ["request.schema.json", "request_digest"],
    "proposal-prototype-application-result": ["result.schema.json", "result_digest"],
    "proposal-routed-prototype-capture": ["record.schema.json", null],
  };
  const [schema, digestField] = mapping[value?.artifact_type] ?? [];
  if (!schema) throw proposalTargetError("artifact_type_invalid", "Unsupported Proposal target artifact.", 400);
  const validate = validators.get(schema);
  if (!validate(value)) throw proposalTargetError("contract_invalid", `Invalid ${value.artifact_type} artifact.`, 400, validate.errors);
  if (digestField && value[digestField] !== proposalTargetDigest(value, digestField)) {
    throw proposalTargetError("digest_invalid", `Invalid ${value.artifact_type} digest.`, 400);
  }
  return value;
}

function exact(value, keys, label) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw proposalTargetError("command_invalid", `${label} has unexpected or missing fields.`, 400);
  }
}

export function assertProposalTargetPreparationInput(value) {
  exact(value, ["proposal_id"], "Proposal target preparation");
  if (!PROPOSAL.test(value.proposal_id)) {
    throw proposalTargetError("command_invalid", "Preparation requires one valid Proposal identity.", 400);
  }
  return value;
}

export function createProposalTargetEvaluation(input, callerId) {
  exact(input, ["application_id", "correlation_id", "execution_ref", "idempotency_key", "operator_approval_ref", "proposal", "prototype", "session_ref", "target"], "Proposal target command");
  exact(input.proposal, ["handoff_packet_digest", "handoff_packet_ref", "proposal_id", "record_ref", "record_version"], "Proposal source binding");
  exact(input.prototype, ["id"], "Prototype target binding");
  exact(input.target, ["authority_revision", "expected_state"], "Prototype Studio authority binding");
  const expected = input.target.expected_state;
  exact(expected, ["record_digest", "record_present", "registry_digest", "source_revision"], "Prototype Studio expected state");
  const proposalNumber = input.proposal.proposal_id.slice("idea-".length);
  const application = APPLICATION.exec(input.application_id);
  const prototype = PROTOTYPE.exec(input.prototype.id);
  if (!application || !PROPOSAL.test(input.proposal.proposal_id) || !prototype ||
      application[1] !== proposalNumber || prototype[1] !== proposalNumber ||
      !PROTOTYPE.test(input.prototype.id) || !SHA.test(input.target.authority_revision) ||
      input.target.authority_revision !== expected.source_revision || expected.record_present !== false ||
      expected.record_digest !== null || !DIGEST.test(expected.registry_digest)) {
    throw proposalTargetError("command_invalid", "Proposal target command contains invalid identity or authority bindings.", 400);
  }
  for (const field of ["correlation_id", "execution_ref", "idempotency_key", "operator_approval_ref", "session_ref"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw proposalTargetError("command_invalid", `${field} is required.`, 400);
  }
  return bindProposalTarget({ schema_version: 1, caller_id: callerId, ...structuredClone(input) }, "evaluation_digest");
}

export function createStudioApplication({ evaluation, proposal, sourceBranch, requestedAt }) {
  const request = {
    schema_version: 2,
    artifact_type: "proposal-prototype-application",
    application_id: evaluation.application_id,
    requested_at: requestedAt,
    source: {
      authority: "workspace-proposals",
      proposal_id: proposal.proposal_id,
      record_ref: proposal.record_ref,
      record_version: proposal.record_version,
      projection_state: "current",
      status: "accepted",
      handoff_packet_ref: proposal.handoff_packet_ref,
      handoff_packet_digest: proposal.handoff_packet_digest,
      route: {
        target: "prototype",
        source_custody: {
          classification: proposal.route.source_custody.classification,
          repository_mode: proposal.route.source_custody.repository_mode,
          repository_gate_state: proposal.route.source_custody.repository_gate_state,
        },
      },
    },
    authorization: {
      authority: "operator-orchestration-service",
      decision: "approved",
      receipt_ref: `oos://proposal-target-authorizations/${evaluation.evaluation_digest.slice(7)}`,
    },
    target: {
      prototype_id: evaluation.prototype.id,
      expected_state: structuredClone(evaluation.target.expected_state),
    },
    source_branch: sourceBranch,
  };
  return assertProposalTargetArtifact(bindProposalTarget(request, "request_digest"));
}
