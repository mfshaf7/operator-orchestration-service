import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { SOURCE_OWNER_BOOTSTRAP_PATHS } from "./scaffold.js";

const fail = message => { throw new HttpError(503, "repository_private_source_unavailable", message); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).sort().join(",") === [...names].sort().join(",");

export function nativeSourceAuthorityRef(authority) {
  const native = authority?.canonical_authority, reference = authority?.record_ref, policy = authority?.policy_ref;
  const entry = authority?.inventory_entry_ref ?? authority?.intake_entry_ref;
  if (!keys(native, ["kind", "instance_id", "record_id"]) || native.kind !== "internal-instance-record" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(native.instance_id ?? "") || native.record_id !== `repo:${authority.owner_repo}` ||
      !keys(reference, ["version", "digest"]) || !Number.isSafeInteger(reference.version) || reference.version < 1 || !/^sha256:[0-9a-f]{64}$/.test(reference.digest ?? "") ||
      entry?.id !== native.record_id || entry?.version !== reference.version || entry?.digest !== reference.digest ||
      !keys(policy, ["repo", "revision", "contract_digest"]) || policy.repo !== "workspace-governance" || !/^[0-9a-f]{40}$/.test(policy.revision ?? "") || !/^sha256:[0-9a-f]{64}$/.test(policy.contract_digest ?? "")) {
    fail("Inspect the current internal source registration before reading private controls.");
  }
  return { canonical_authority: authority.canonical_authority, record_ref: authority.record_ref, policy_ref: authority.policy_ref };
}

export function qualifiedOwnerSource(source, authority) {
  if (source?.default_branch !== "main") return false;
  const native = authority?.canonical_authority?.kind === "internal-instance-record";
  return (native ? ["public", "private", "internal"].includes(source.visibility) : source.visibility === "public")
    && source.read_scope === "trusted-owner-controls" &&
    source.read_credential_issued === true && source.read_credential_revoked === true && object(source.authority_ref) &&
    canonicalDigest(source.authority_ref) === canonicalDigest(native ? nativeSourceAuthorityRef(authority) : legacySourceAuthorityRef(authority));
}

function legacySourceAuthorityRef(authority) {
  const revision = authority?.authority_revision;
  const canonical = { kind: "legacy-git", repo: "workspace-governance", revision };
  if (!/^[0-9a-f]{40}$/.test(revision ?? "") || !object(authority.provider_repository) ||
      (authority.canonical_authority !== undefined && canonicalDigest(authority.canonical_authority) !== canonicalDigest(canonical))) {
    fail("The source reader requires a current retained authority and exact repository.");
  }
  return { canonical_authority: canonical, provider_repository: authority.provider_repository };
}

// The protected Platform reader accepts bounded controls under current authority.
export function createBootstrapSourceReader({ platformOperations }) {
  return {
    requiresOwnerAuthority: true,
    async inspect({ providerRepository, paths, ownerAuthority, callerId, operatorId, operation = "bootstrap" }) {
      const native = ownerAuthority?.canonical_authority?.kind === "internal-instance-record";
      const reference = native ? nativeSourceAuthorityRef(ownerAuthority) : legacySourceAuthorityRef(ownerAuthority);
      if (!Array.isArray(paths) || !paths.length || paths.some(path => !SOURCE_OWNER_BOOTSTRAP_PATHS.includes(path)) || new Set(paths).size !== paths.length ||
          !["bootstrap", "configure-verification"].includes(operation) || canonicalDigest(providerRepository) !== canonicalDigest(ownerAuthority.provider_repository)) {
        fail("Select only the exact current repository and trusted owner control files.");
      }
      const platform = typeof platformOperations === "function" ? platformOperations() : platformOperations;
      if (typeof platform?.inspectOwnerControls !== "function") fail("The protected private-source connection is not commissioned.");
      const requestedPaths = [...paths].sort();
      const input = { schema_version: 1, owner_repo: ownerAuthority.owner_repo, operation, paths: requestedPaths, authority_ref: reference };
      let source;
      try {
        source = await platform.inspectOwnerControls({ callerId, operatorId, input });
      } catch (error) {
        if (error?.code === "github_read_throttled") {
          throw new HttpError(429, "repository_owner_bootstrap_provider_throttled", error.message, error.details);
        }
        throw error;
      }
      if (!keys(source, ["schema_version", "read_scope", "read_credential_issued", "read_credential_revoked", "owner_repo", "operation", "authority_ref", "provider_repository", "fetched_base", "observed_files", "visibility", "default_branch"]) ||
          source.schema_version !== 1 || source.read_scope !== "trusted-owner-controls" || source.owner_repo !== ownerAuthority.owner_repo || source.operation !== operation ||
          source.read_credential_issued !== true || source.read_credential_revoked !== true ||
          canonicalDigest(source.authority_ref) !== canonicalDigest(reference) || canonicalDigest(source.provider_repository) !== canonicalDigest(providerRepository) ||
          !/^[0-9a-f]{40}$/.test(source.fetched_base ?? "") || !["public", "private", "internal"].includes(source.visibility) || source.default_branch !== "main" ||
          (!native && source.visibility !== "public") ||
          !keys(source.observed_files, requestedPaths) || Buffer.byteLength(JSON.stringify(source)) > 524288 ||
          Object.values(source.observed_files).some(value => value !== null && (typeof value !== "string" || !value.isWellFormed() || Buffer.byteLength(value) > 65536))) {
        fail("Private source inspection did not prove its exact current authority, files and read boundary.");
      }
      return source;
    },
  };
}
