import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  canonicalDigest,
  canonicalStringify,
} from "../delivery-art/canonical-json.js";

const CONTRACT_DIR = fileURLToPath(
  new URL("../../contracts/agent-action/", import.meta.url),
);
const MANIFEST = JSON.parse(
  readFileSync(path.join(CONTRACT_DIR, "manifest.json"), "utf8"),
);

export const AGENT_ACTION_SCHEMA_VERSION = 1;
export const AGENT_ACTION_SOURCE_COMMIT = MANIFEST.source.commit;

export class AgentActionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentActionContractError";
    this.code = code;
  }
}

function loadValidators() {
  if (
    MANIFEST.schema_version !== AGENT_ACTION_SCHEMA_VERSION ||
    MANIFEST.source?.repo !== "workspace-governance" ||
    !/^[0-9a-f]{40}$/.test(String(MANIFEST.source?.commit ?? ""))
  ) {
    throw new Error("Agent-action schema manifest authority is invalid.");
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();
  for (const [artifactType, entry] of Object.entries(MANIFEST.schemas ?? {})) {
    const schemaPath = path.join(CONTRACT_DIR, String(entry.path ?? ""));
    const raw = readFileSync(schemaPath);
    const digest = createHash("sha256").update(raw).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(
        `Agent-action schema snapshot ${entry.path} does not match its authority manifest.`,
      );
    }
    validators.set(artifactType, ajv.compile(JSON.parse(raw.toString("utf8"))));
  }
  return validators;
}

const VALIDATORS = loadValidators();

function contentProjection(artifact) {
  const projection = structuredClone(artifact);
  delete projection.integrity.content_digest;
  return projection;
}

export function agentActionArtifactDigest(artifact) {
  return canonicalDigest(contentProjection(artifact));
}

export function assertAgentActionArtifact(artifactType, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new AgentActionContractError(
      "agent_action_artifact_invalid",
      `${artifactType} must be an object.`,
    );
  }
  const validator = VALIDATORS.get(artifactType);
  if (!validator) {
    throw new AgentActionContractError(
      "agent_action_artifact_unsupported",
      `Unsupported agent-action artifact ${artifactType}.`,
    );
  }
  if (!validator(candidate)) {
    const error = validator.errors?.[0];
    const location = error?.instancePath || "<root>";
    throw new AgentActionContractError(
      "agent_action_artifact_invalid",
      `${artifactType} ${location}: ${error?.message ?? "is invalid"}.`,
    );
  }
  const expectedDigest = agentActionArtifactDigest(candidate);
  if (candidate.integrity.content_digest !== expectedDigest) {
    throw new AgentActionContractError(
      "agent_action_digest_mismatch",
      `${artifactType} content digest does not match its canonical content.`,
    );
  }
  return structuredClone(candidate);
}

export function agentActionRequestRef(request) {
  const token = request.request_id.split(":", 2)[1];
  return {
    uri: `wgcf://agent-actions/requests/${token}`,
    digest: request.integrity.content_digest,
  };
}

export function agentActionDecisionRef(decision) {
  const token = decision.decision_id.split(":", 2)[1];
  return {
    uri: `wgcf://agent-actions/decisions/${token}`,
    digest: decision.integrity.content_digest,
  };
}

export function sameAgentActionValue(left, right) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return canonicalStringify(left) === canonicalStringify(right);
}

export function assertAgentActionReference(reference, fieldName) {
  if (
    !reference ||
    typeof reference !== "object" ||
    Array.isArray(reference) ||
    typeof reference.uri !== "string" ||
    !reference.uri ||
    !/^sha256:[0-9a-f]{64}$/.test(String(reference.digest ?? ""))
  ) {
    throw new AgentActionContractError(
      "agent_action_reference_invalid",
      `${fieldName} must be a digest-bound artifact reference.`,
    );
  }
  return structuredClone(reference);
}
