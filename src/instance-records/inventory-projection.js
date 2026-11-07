import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
const digest = /^sha256:[0-9a-f]{64}$/;
const fail = () => { throw new HttpError(502, "instance_registry_projection_invalid", "The internal registry could not prove its record metadata."); };
const unique = values => [...new Set(values.filter(value => typeof value === "string" && value.trim()))];

// Same source-only candidate defaults as the retained source registry producer.
// These are reviewed metadata, not completed checks or a new control authority.
function activeValue(entry) {
  return { posture: "active", lifecycle: "active", repo_class: entry.repo_class,
    provider_repository: structuredClone(entry.provider_repository), requires_security_bindings: entry.requires_security_bindings,
    owns: [entry.notes], must_not_own: ["Workspace governance, shared orchestration, Platform release, Security acceptance, authenticated identity or privileged runtime authority"],
    allowed_authoritative_refs: [], validation_behavior: structuredClone(entry.validation_behavior) };
}
export function projectInstanceRegistryRecord({ record: entry, receipt }, authority) {
  const id = receipt.record_id, name = id.slice(5), envelope = entry.record;
  if (envelope?.id !== id || envelope.version !== receipt.version || !envelope.last_mutation ||
      entry.repo_class !== "product-source" || entry.requires_security_bindings !== false || entry.security_review_subject === true ||
      entry.validation_behavior?.posture !== "covered-by-owner-repo" || entry.validation_behavior.wgcf_graph_role !== "product-runtime-source") fail();
  const canonical_authority = { ...authority, record_id: id };
  const common = { authority_kind: "internal-instance-record", canonical_authority,
    provider_repository: structuredClone(entry.provider_repository) };
  if (entry.phase === "intake") {
    if (entry.status !== "admitted") return null;
    const decision = envelope.decision;
    if (!decision || !digest.test(decision.digest) || !decision.id || !decision.ref) fail();
    const value = { ...common, target: { kind: "repo", name, record_id: id },
      intake_entry_ref: { id, version: receipt.version, digest: receipt.record_digest },
      active_record: { kind: "repo", id, value: activeValue(entry) }, owner_refs: unique([name, entry.security_owner]),
      approval_refs: unique([decision.ref, decision.id]) };
    return { kind: "eligible", value: { ...value, candidate_digest: intakeDigest(value) } };
  }
  if (entry.phase !== "inventory" || !["active", "suspended", "retired"].includes(entry.posture) || !envelope.lineage ||
      !digest.test(envelope.lineage.source_digest)) fail();
  const mutation = envelope.last_mutation;
  return { kind: "record", value: { ...common, id, kind: "repo", name, version: receipt.version, record_digest: receipt.record_digest,
    posture: entry.posture, maturity: null, owner_refs: [name], lineage: structuredClone(envelope.lineage),
    last_mutation: { id: mutation.id, action: mutation.action, applied_at: mutation.applied_at, request_ref: mutation.request_ref, readiness_ref: mutation.readiness_ref } } };
}

export function createInstanceInventoryProjection({ reader, clock = () => new Date() }) {
  return async ({ input = {} } = {}) => {
    if (Object.keys(input).some(key => !["after", "query", "scope", "limit"].includes(key)) || !["inventory", "eligible"].includes(input.scope ?? "inventory")) throw new HttpError(400, "instance_registry_query_invalid", "Select one internal registry page.");
    const limit=Number(input.limit??25);if(![25,50,100].includes(limit))throw new HttpError(400,"instance_registry_query_invalid","Choose 25, 50 or 100 records.");
    const page = await reader.catalog({ after: input.after ?? null, query: input.query ?? "", scope: input.scope ?? "inventory", limit });
    const projected = page.records.map(value => projectInstanceRegistryRecord(value, page.authority)).filter(Boolean);
    const body = { schema_version: 1, mode: "current", artifact_type: "instance-repository-registry-page", authority: page.authority,
      selection: page.selection, after: input.after ?? null, next_after: page.next_after, counts: page.counts,
      records: projected.filter(row => row.kind === "record").map(row => row.value),
      eligible_promotions: projected.filter(row => row.kind === "eligible").map(row => row.value), projected_at: clock().toISOString() };
    return { ...body, projection_digest: intakeDigest(body) };
  };
}
