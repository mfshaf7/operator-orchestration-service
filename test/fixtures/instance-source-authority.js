export function instanceSourceProof({ ownerRepo = "canonical-project-key", operation = "ordinary-source", version = 3,
  fullName = "example-org/different-physical-name", repositoryId = "123", instanceId = "synthetic-installation" } = {}) {
  const canonical_authority = { kind: "internal-instance-record", instance_id: instanceId, record_id: `repo:${ownerRepo}` };
  const record_ref = { version, digest: `sha256:${"a".repeat(64)}` };
  const entry = { id: canonical_authority.record_id, ...record_ref };
  const source_authority = { schema_version: 1, owner_repo: ownerRepo,
    classification: operation === "bootstrap" ? "proposed" : "active", inventory_posture: operation === "bootstrap" ? null : "active",
    intake_entry_ref: operation === "bootstrap" ? entry : null,
    provider_repository: { provider: "github", provider_repository_id: repositoryId, full_name: fullName }, owner_purpose: "Synthetic project for isolated source tests",
    source_bootstrap_eligible: operation === "bootstrap", ordinary_source_eligible: operation !== "bootstrap",
    model_writes_allowed: false, canonical_mutation: false, runtime_activation: false,
    canonical_authority, record_ref,
    policy_ref: { repo: "workspace-governance", revision: "b".repeat(40), contract_digest: `sha256:${"c".repeat(64)}` },
    ...(operation === "bootstrap" ? { validation_behavior: { posture: "covered-by-owner-repo", wgcf_graph_role: "product-runtime-source" } }
      : { inventory_entry_ref: entry, verification_setup_eligible: true }) };
  return { schema_version: 1, canonical_authority, source_authority };
}
