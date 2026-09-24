import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalDigest } from "./canonical-json.js";

export const DELIVERY_ART_EVIDENCE_PROFILE_PATH =
  "contracts/delivery-art-work-session/evidence-profile.json";

const evidenceProfileSchema = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../contracts/delivery-art-work-session/evidence-profile.schema.json",
  import.meta.url,
)), "utf8"));
const validateEvidenceProfileSchema = new Ajv2020({
  allErrors: true,
  strict: false,
}).compile(evidenceProfileSchema);

const COLLECTIONS = new Set([
  "tests",
  "validations",
  "runtime_and_live",
  "security_and_trust",
]);

export class DeliveryArtEvidenceAcquisitionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DeliveryArtEvidenceAcquisitionError";
    this.code = code;
    this.details = details;
  }
}

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_invalid",
      `${field} must be a non-empty string.`,
      { field },
    );
  }
  return value.trim();
}

function commandText(command) {
  return [command.executable, ...command.args]
    .map((value) => /\s/.test(value) ? JSON.stringify(value) : value)
    .join(" ");
}

function resolveArgument(argument, source) {
  return argument
    .replaceAll("{{base_commit}}", source.base_commit)
    .replaceAll("{{head_commit}}", source.head_commit);
}

export function validateDeliveryArtEvidenceProfile(profile, ownerRepo) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_invalid",
      "The owner evidence profile must be an object.",
    );
  }
  if (!validateEvidenceProfileSchema(profile)) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_invalid",
      "The owner evidence profile failed schema validation.",
      {
        errors: (validateEvidenceProfileSchema.errors ?? []).map((error) =>
          `${error.instancePath || "/"} ${error.message}`),
      },
    );
  }
  if (profile.schema_version !== 1 || profile.owner_repo !== ownerRepo) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_mismatch",
      "The owner evidence profile does not match the exact owner repository.",
      { expected_owner_repo: ownerRepo },
    );
  }
  assertString(profile.profile_id, "profile_id");
  if (!Array.isArray(profile.commands) || profile.commands.length === 0) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_invalid",
      "The owner evidence profile must declare at least one bounded command.",
    );
  }
  const ids = new Set();
  for (const command of profile.commands) {
    const id = assertString(command?.id, "commands[].id");
    if (ids.has(id)) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} is duplicated.`,
      );
    }
    ids.add(id);
    if (!COLLECTIONS.has(command.kind)) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} has an unsupported kind.`,
      );
    }
    assertString(command.name, `commands[${id}].name`);
    if (!["git", "node", "npm", "python3"].includes(command.executable)) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} uses an unapproved executable.`,
      );
    }
    if (!Array.isArray(command.args) || command.args.length === 0 ||
        command.args.some((entry) => typeof entry !== "string" || !entry)) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} must use a non-empty argument array.`,
      );
    }
    if (!["matching-fidelity", "none"].includes(command.conformance_binding)) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} has an invalid conformance binding.`,
      );
    }
    if (!Number.isInteger(command.timeout_seconds) ||
        command.timeout_seconds < 1 || command.timeout_seconds > 1800) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_evidence_profile_invalid",
        `Owner evidence command ${id} has an invalid timeout.`,
      );
    }
  }
  return structuredClone(profile);
}

export function deliveryArtEvidenceAcquisitionRequest({
  conformanceCases,
  ownerRepo,
  profile,
  source,
}) {
  if (!/^[0-9a-f]{40}$/.test(String(source?.base_commit ?? "")) ||
      !/^[0-9a-f]{40}$/.test(String(source?.head_commit ?? ""))) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_owner_evidence_source_invalid",
      "Owner evidence acquisition requires exact base and head commits.",
    );
  }
  const normalizedProfile = validateDeliveryArtEvidenceProfile(profile, ownerRepo);
  const cases = [...(conformanceCases ?? [])]
    .map((entry) => ({ fidelity: entry.fidelity, id: entry.id }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const uncovered = cases.filter((entry) =>
    !normalizedProfile.commands.some((command) =>
      command.conformance_binding === "matching-fidelity" &&
      command.fidelity === entry.fidelity));
  if (uncovered.length > 0) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_evidence_profile_incomplete",
      "The owner evidence profile does not cover every required conformance fidelity.",
      { conformance_case_ids: uncovered.map((entry) => entry.id) },
    );
  }
  const profileDigest = canonicalDigest(normalizedProfile);
  return {
    acquisition_id: `owner-evidence:${createHash("sha256")
      .update([ownerRepo, source.head_commit, profileDigest, ...cases.map((entry) => entry.id)].join("\0"))
      .digest("hex")}`,
    commands: normalizedProfile.commands.map((command) => ({
      ...structuredClone(command),
      args: command.args.map((argument) => resolveArgument(argument, source)),
      conformance_case_ids: command.conformance_binding === "matching-fidelity"
        ? cases.filter((entry) => entry.fidelity === command.fidelity)
          .map((entry) => entry.id)
        : [],
    })),
    owner_repo: ownerRepo,
    profile_digest: profileDigest,
    profile_id: normalizedProfile.profile_id,
    profile_path: DELIVERY_ART_EVIDENCE_PROFILE_PATH,
    profile_revision: source.base_commit,
    source_revision: source.head_commit,
  };
}

function resultId(commandId, sourceRevision) {
  return `evidence:owner-${createHash("sha256")
    .update(`${commandId}\0${sourceRevision}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function receiptDigestInput(receipt) {
  const { receipt_digest: _receiptDigest, ...input } = receipt;
  return input;
}

function resultDigestInput(result, receipt) {
  const {
    output_digest: _outputDigest,
    result_digest: _resultDigest,
    ...input
  } = result;
  return {
    ...input,
    owner_repo: receipt.owner_repo,
    source_revision: receipt.source_revision,
  };
}

function evidenceDigestInput(receipt) {
  return {
    acquisition_id: receipt.acquisition_id,
    owner_repo: receipt.owner_repo,
    profile_digest: receipt.profile_digest,
    profile_id: receipt.profile_id,
    profile_revision: receipt.profile_revision,
    provider_id: receipt.provider.id,
    results: receipt.results.map(({ output_digest: _outputDigest, ...entry }) => entry),
    source_revision: receipt.source_revision,
  };
}

export function projectDeliveryArtOwnerEvidence(
  receipt,
  { ownerRepo = null, sourceRevision = null } = {},
) {
  if (receipt?.schema_version !== 1 ||
      receipt?.artifact_type !== "delivery_art_owner_evidence_receipt" ||
      !Array.isArray(receipt.results) ||
      typeof receipt.acquisition_id !== "string" ||
      typeof receipt.profile_digest !== "string" ||
      typeof receipt.profile_id !== "string" ||
      !/^[0-9a-f]{40}$/.test(String(receipt.profile_revision ?? "")) ||
      typeof receipt.provider?.id !== "string" ||
      receipt.provider?.kind !== "oos-source-executor" ||
      !Number.isFinite(Date.parse(receipt.started_at)) ||
      !Number.isFinite(Date.parse(receipt.completed_at)) ||
      Date.parse(receipt.completed_at) < Date.parse(receipt.started_at) ||
      receipt.receipt_digest !== canonicalDigest(receiptDigestInput(receipt)) ||
      receipt.evidence_digest !== canonicalDigest(evidenceDigestInput(receipt)) ||
      (ownerRepo !== null && receipt.owner_repo !== ownerRepo) ||
      (sourceRevision !== null && receipt.source_revision !== sourceRevision)) {
    throw new DeliveryArtEvidenceAcquisitionError(
      "delivery_art_owner_evidence_receipt_invalid",
      "The owner evidence receipt is invalid.",
    );
  }
  const evidence = {
    tests: [],
    validations: [],
    runtime_and_live: [],
    security_and_trust: [],
  };
  for (const result of receipt.results) {
    if (!COLLECTIONS.has(result.kind) ||
        !["pass", "fail"].includes(result.result) ||
        result.result_digest !== canonicalDigest(resultDigestInput(result, receipt))) {
      throw new DeliveryArtEvidenceAcquisitionError(
        "delivery_art_owner_evidence_receipt_invalid",
        "The owner evidence receipt contains an unsupported result kind.",
      );
    }
    evidence[result.kind].push({
      id: resultId(result.command_id, receipt.source_revision),
      name: result.name,
      command: result.command,
      fidelity: result.fidelity,
      result: result.result,
      summary: result.result === "pass"
        ? `${result.name} passed for the exact owner source revision.`
        : `${result.name} failed for the exact owner source revision.`,
      conformance_case_ids: [...result.conformance_case_ids].sort(),
      source_revisions: [{
        repo: receipt.owner_repo,
        commit: receipt.source_revision,
      }],
      evidence_refs: [{
        uri: `oos://delivery-art/owner-evidence/${encodeURIComponent(receipt.acquisition_id)}/${encodeURIComponent(result.command_id)}`,
        digest: result.result_digest,
      }],
      not_applicable_reason: null,
      authority_ref:
        `repo://${receipt.owner_repo}/${receipt.profile_path}@${receipt.profile_revision}`,
    });
  }
  for (const values of Object.values(evidence)) {
    values.sort((left, right) => left.id.localeCompare(right.id));
  }
  return {
    acquisition: {
      acquisition_id: receipt.acquisition_id,
      profile_digest: receipt.profile_digest,
      profile_id: receipt.profile_id,
      profile_path: receipt.profile_path,
      profile_revision: receipt.profile_revision,
      evidence_digest: receipt.evidence_digest,
      provider: structuredClone(receipt.provider),
      receipt_digest: receipt.receipt_digest,
      source_revision: receipt.source_revision,
      started_at: receipt.started_at,
      completed_at: receipt.completed_at,
      state: receipt.results.every((entry) => entry.result === "pass")
        ? "ready"
        : "blocked",
    },
    evidence,
  };
}

export function deliveryArtOwnerEvidenceCommandText(command) {
  return commandText(command);
}
