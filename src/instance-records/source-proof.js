import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...fields].sort().join(",");
const hash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const fail = () => { throw new HttpError(503, "instance_records_source_authority_invalid", "Current source admission does not match its installation, policy and repository."); };

// Common current-proof boundary for the async broker and synchronous host.
// A positive legacy proof alone authorizes consulting the retained Git reader.
export function assertInstanceSourceProof(value, { instanceId, ownerRepo, operation, policyRef = null }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(instanceId ?? "") ||
      !/^[a-z0-9][a-z0-9._-]{0,185}$/.test(ownerRepo ?? "") ||
      !["bootstrap", "configure-verification", "ordinary-source"].includes(operation)) fail();
  const authority = value?.canonical_authority;
  if (authority?.kind === "legacy-git") {
    if (!exact(value, ["schema_version", "canonical_authority", "record_id"]) || value.schema_version !== 1 ||
        !exact(authority, ["kind", "repo", "revision"]) || authority.repo !== "workspace-governance" ||
        !/^[0-9a-f]{40}$/.test(authority.revision ?? "") || value.record_id !== `repo:${ownerRepo}` ||
        policyRef !== null && authority.revision !== policyRef.revision) fail();
    return null;
  }
  const proof = value?.source_authority;
  const fields = ["schema_version", "owner_repo", "intake_entry_ref", "classification", "inventory_posture", "provider_repository", "owner_purpose",
    "source_bootstrap_eligible", "ordinary_source_eligible", "model_writes_allowed", "canonical_mutation", "runtime_activation",
    "canonical_authority", "record_ref", "policy_ref", ...(operation === "bootstrap" ? ["validation_behavior"] : ["inventory_entry_ref", "verification_setup_eligible"])];
  if (!exact(value, ["schema_version", "canonical_authority", "source_authority"]) || value.schema_version !== 1 ||
      !exact(authority, ["kind", "instance_id", "record_id"]) || authority.kind !== "internal-instance-record" ||
      authority.instance_id !== instanceId || authority.record_id !== `repo:${ownerRepo}` || !exact(proof, fields) ||
      proof.schema_version !== 1 || proof.owner_repo !== ownerRepo || canonicalDigest(proof.canonical_authority) !== canonicalDigest(authority) ||
      ["model_writes_allowed", "canonical_mutation", "runtime_activation"].some(key => proof[key] !== false)) fail();
  const reference = proof.record_ref, policy = proof.policy_ref, entry = operation === "bootstrap" ? proof.intake_entry_ref : proof.inventory_entry_ref;
  if (!exact(reference, ["version", "digest"]) || !Number.isSafeInteger(reference.version) || reference.version < 1 || !hash(reference.digest) ||
      !exact(entry, ["id", "version", "digest"]) || entry.id !== authority.record_id || entry.version !== reference.version || entry.digest !== reference.digest ||
      !exact(policy, ["repo", "revision", "contract_digest"]) || policy.repo !== "workspace-governance" ||
      !/^[0-9a-f]{40}$/.test(policy.revision ?? "") || !hash(policy.contract_digest) || policyRef !== null && canonicalDigest(policy) !== canonicalDigest(policyRef)) fail();
  if (operation === "bootstrap") {
    if (!["proposed", "admitted"].includes(proof.classification) || proof.inventory_posture !== null ||
        proof.source_bootstrap_eligible !== true || proof.ordinary_source_eligible !== false ||
        proof.validation_behavior?.posture !== "covered-by-owner-repo" || proof.validation_behavior?.wgcf_graph_role !== "product-runtime-source") fail();
  } else if (proof.classification !== "active" || proof.inventory_posture !== "active" || proof.intake_entry_ref !== null ||
      proof.source_bootstrap_eligible !== false || proof.ordinary_source_eligible !== true || proof.verification_setup_eligible !== true) fail();
  const repository = proof.provider_repository;
  if (!exact(repository, ["provider", "provider_repository_id", "full_name"]) || repository.provider !== "github" ||
      !/^[1-9][0-9]*$/.test(repository.provider_repository_id ?? "") || !Number.isSafeInteger(Number(repository.provider_repository_id)) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository.full_name ?? "") ||
      typeof proof.owner_purpose !== "string" || !proof.owner_purpose.trim() || !proof.owner_purpose.isWellFormed() || Buffer.byteLength(proof.owner_purpose) > 8192) fail();
  // Native authority crosses both an async JSON transport and a canonical-JSON
  // host helper. Project validated typed fields in one order before a source
  // template embeds them as file bytes; transport key order is not authority.
  const normalized = structuredClone(proof);
  normalized.provider_repository = { full_name: repository.full_name, provider: repository.provider,
    provider_repository_id: repository.provider_repository_id };
  const entryReference = value => value === null ? null : { id: value.id, version: value.version, digest: value.digest };
  normalized.intake_entry_ref = entryReference(proof.intake_entry_ref);
  if (Object.hasOwn(proof, "inventory_entry_ref")) normalized.inventory_entry_ref = entryReference(proof.inventory_entry_ref);
  return normalized;
}

export function instanceSourceReference(proof, operation) {
  return { kind: "internal-instance-record", instance_id: proof.canonical_authority.instance_id,
    record_id: proof.canonical_authority.record_id, record_ref: structuredClone(proof.record_ref),
    policy_ref: structuredClone(proof.policy_ref), operation };
}
