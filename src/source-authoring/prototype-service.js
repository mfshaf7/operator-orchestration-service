import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertSourceCredentialSubject } from "../platform-operation/source-credentials.js";
import { normalizePrototypeSourceRequest, prototypeAuthoringError, prototypeRequestDigest } from "./prototype-contracts.js";

function authorityProjection(entry, landing) {
  return {
    id: entry.id, lifecycle: entry.lifecycle, project_phase: entry.project_phase ?? "incubating",
    source_custody: entry.source_custody ?? landing?.source?.custody ?? null,
    source_ref: landing?.source?.ref ?? null,
    design_profile: entry.paths?.design_profile ?? null, data_mode: entry.data_mode,
    design_baseline_ref: entry.design_baseline_ref ?? null,
    mutation_boundary: entry.mutation_boundary, visibility_tier: entry.visibility_tier,
  };
}

function sourceStartDigest(record) {
  return canonicalDigest({ request_digest: record.request_digest, binding_digest: record.binding_digest });
}

function projection(record) {
  return { schema_version: 1, workflow_id: "prototype-source-authoring", request_id: record.request.request_id,
    prototype_id: record.request.prototype_id, subject: structuredClone(record.binding.subject),
    source_start_digest: sourceStartDigest(record), source_scope: structuredClone(record.binding.model_source_scope),
    landing_unit: structuredClone(record.binding.source_start), session_id: record.session?.session_id ?? null,
    state: record.state, created_at: record.created_at, updated_at: record.updated_at,
    next_action: record.state === "succeeded" ? { code: "prototype-source-complete", authority: "operator-orchestration-service", reason: "Reviewed source delivery and its owned cleanup completed; this is not baseline or runtime acceptance." }
      : record.session ? { code: "prototype-source-request-inspect-required", authority: "operator-orchestration-service", reason: "Read this exact source request for its current authorization, draft, recovery and review action." }
        : { code: "prototype-source-authorization-required", authority: "platform-engineering",
          reason: "Prepare and explicitly approve source access for this canonical Prototype request before creating source or invoking its admitted authoring workflow." },
    canonical_mutation: false, runtime_activation: false,
  };
}

// Canonical subject and request ownership live here, not in the browser, CGG,
// source inspector, or credential parser. This preparation phase is not model
// generation, publication, baseline acceptance, or operational qualification.
export function createPrototypeAuthoringService({ callerOperatorBindings, recordsReader, sourceExecutor, store, clock = () => new Date() }) {
  if (typeof recordsReader !== "function" || typeof sourceExecutor?.executor?.run !== "function" ||
      typeof sourceExecutor?.prototypeSource?.inspectCommittedSource !== "function" || typeof sourceExecutor?.prototypeSource?.inspectSourceCredentialBinding !== "function") {
    throw new TypeError("Prototype authoring requires canonical Studio records and the commissioned typed source executor.");
  }
  function identity(callerId, operatorId) {
    if (!callerId || !operatorId || callerOperatorBindings?.[callerId] !== operatorId) throw prototypeAuthoringError("identity_forbidden", "The caller is not bound to this accountable authoring operator.", 403);
  }
  function retained({ callerId, operatorId, requestId }) {
    identity(callerId, operatorId);
    const record = store.get(requestId);
    if (!record || record.caller_id !== callerId || record.operator_id !== operatorId) throw prototypeAuthoringError("not_found", "The caller-owned Prototype source request was not found.", 404);
    return record;
  }
  function run(request, callerId, operatorId, sessionId, operation) {
    return sourceExecutor.executor.run({ caller_id: callerId, operator_id: operatorId, prototype_id: request.prototype_id,
      source_request_id: request.request_id, session_id: sessionId, command_id: null }, operation);
  }
  async function canonical(request, callerId, operatorId, { initial = false, sessionId = null } = {}) {
    const records = await recordsReader();
    const slug = request.prototype_id.slice("prototype:".length);
    const entries = records?.registry?.prototypes?.filter(entry => entry.id === slug) ?? [];
    if (records?.workflow_id !== "prototype-records" || !/^[0-9a-f]{40}$/.test(records.authority_revision ?? "") || entries.length !== 1) {
      throw prototypeAuthoringError("canonical_subject_unavailable", "The actual Prototype is absent or ambiguous in current canonical Studio records.", 503);
    }
    if (initial && (records.authority_revision !== request.expected_registry_revision || records.authority_revision !== request.expected_source_revision)) {
      throw prototypeAuthoringError("source_stale", "This incubation source request must select the exact current Studio registry and source snapshot; other custody is not qualified by this adapter.");
    }
    const entry = entries[0];
    const landing = records.documents?.[`records/prototype-landings/${slug}/record.json`] ?? null;
    const authority = authorityProjection(entry, landing);
    if (authority.project_phase !== "incubating" || authority.source_custody !== "incubation-repo" ||
        !["exploring", "candidate", "baseline-approved"].includes(authority.lifecycle) ||
        !["mock", "synthetic"].includes(authority.data_mode) || !["private-internal", "operator-review"].includes(authority.visibility_tier)) {
      throw prototypeAuthoringError("source_ineligible", "The current Prototype custody, lifecycle or data boundary does not admit this bounded Studio authoring route.");
    }
    const inspected = await run(request, callerId, operatorId, sessionId, () => sourceExecutor.prototypeSource.inspectCommittedSource({
      prototype_id: request.prototype_id, source_revision: records.authority_revision,
    }));
    assertSourceCredentialSubject(inspected.subject);
    if (inspected.subject.kind !== "prototype" || inspected.subject.prototype_id !== request.prototype_id ||
        inspected.subject.registry_revision !== records.authority_revision || inspected.subject.source_revision !== records.authority_revision ||
        inspected.subject.source_ref !== `repo://workspace-prototype-studio/prototypes/${slug}` ||
        inspected.model_source_scope?.source_root !== `prototypes/${slug}` || inspected.model_source_scope?.design_profile !== `docs/prototypes/${slug}/design-profile.md` ||
        canonicalDigest(authorityProjection(inspected.prototype, landing)) !== canonicalDigest(authority)) {
      throw prototypeAuthoringError("owner_binding_invalid", "The owner inspection does not match the canonical selected Prototype source scope.", 503);
    }
    return { records, inspected, authority };
  }
  async function sourceIdentity(record) {
    return run(record.request, record.caller_id, record.operator_id, record.session?.session_id ?? null, () => sourceExecutor.prototypeSource.inspectSourceCredentialBinding({
      prototype_id: record.request.prototype_id, ...record.binding.source_start,
    }));
  }
  async function create({ callerId, operatorId, input }) {
    identity(callerId, operatorId);
    const request = normalizePrototypeSourceRequest(input);
    const requestDigest = prototypeRequestDigest({ callerId, operatorId, request });
    return store.transact(request.request_id, async ({ current, put }) => {
      if (current) {
        if (current.caller_id !== callerId || current.operator_id !== operatorId || current.request_digest !== requestDigest) throw prototypeAuthoringError("request_conflict", "Source request id already belongs to another immutable request.");
        return projection(current);
      }
      const { inspected, authority } = await canonical(request, callerId, operatorId, { initial: true });
      if (request.owner_preparation?.kind === "delivery-packet" && (authority.lifecycle !== "baseline-approved" ||
          !/^record:\/\/design-baselines\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(authority.design_baseline_ref ?? ""))) {
        throw prototypeAuthoringError("baseline_required", "Accept the real Studio Baseline before preparing its Delivery packet; no credential or source resource has been created.");
      }
      const suffix = requestDigest.slice(7, 31);
      const sourceStart = { landing_unit_id: `prototype-authoring-${suffix}`, branch: `feature/prototype-${suffix}`, fetched_base: request.expected_source_revision };
      const identityMetadata = await run(request, callerId, operatorId, null, () => sourceExecutor.prototypeSource.inspectSourceCredentialBinding({ prototype_id: request.prototype_id, ...sourceStart }));
      const inspectionRef = store.writeArtifact(request.request_id, inspected);
      const binding = { subject: inspected.subject, model_source_scope: inspected.model_source_scope, prototype_authority_digest: canonicalDigest(authority),
        source_manifest_digest: canonicalDigest(inspected.source_manifest), design_profile_digest: inspected.design_profile_digest,
        source_start: sourceStart, repository: identityMetadata.repository, repository_id: identityMetadata.repository_id,
        installation_id: identityMetadata.installation_id, human_reviewer_id: identityMetadata.human_reviewer_id };
      const now = clock().toISOString();
      const record = { schema_version: 1, artifact_type: "prototype-source-authoring-record", request, request_digest: requestDigest,
        caller_id: callerId, operator_id: operatorId, binding, binding_digest: canonicalDigest(binding), inspection_ref: inspectionRef,
        session: null, state: "prepared", created_at: now, updated_at: now };
      put(record); return projection(record);
    });
  }
  async function credentialPlan({ callerId, operatorId, subject, decision = null, record: credentialRecord = null }) {
    if (subject?.kind !== "prototype" || decision !== null) throw prototypeAuthoringError("credential_selector_invalid", "Prototype credential preparation uses its canonical source request, not a Delivery decision.", 400);
    const record = retained({ callerId, operatorId, requestId: subject.source_request_id });
    if (record.request.prototype_id !== subject.prototype_id || ["cancelled", "succeeded", "merged"].includes(record.state)) throw prototypeAuthoringError("source_request_closed", "This Prototype source request is closed or belongs to a different subject.");
    const current = await canonical(record.request, callerId, operatorId, { sessionId: record.session?.session_id ?? null });
    if ((!record.session && current.records.authority_revision !== record.binding.source_start.fetched_base) ||
        canonicalDigest(current.authority) !== record.binding.prototype_authority_digest ||
        canonicalDigest(current.inspected.source_manifest) !== record.binding.source_manifest_digest ||
        current.inspected.design_profile_digest !== record.binding.design_profile_digest) {
      throw prototypeAuthoringError("source_start_changed", "The selected Prototype source or authority changed; unchanged unrelated owner metadata does not invalidate an active source session.");
    }
    const metadata = await sourceIdentity(record);
    for (const field of ["repository", "repository_id", "installation_id", "human_reviewer_id"]) {
      if (metadata[field] !== record.binding[field]) throw prototypeAuthoringError("source_identity_changed", "The canonical source provider binding changed.");
    }
    if (credentialRecord && credentialRecord.proof?.source_request_digest !== record.request_digest) throw prototypeAuthoringError("credential_binding_invalid", "Credential scope does not match the canonical source request.");
    return { subject: structuredClone(record.binding.subject), source_start_digest: sourceStartDigest(record), ...record.binding.source_start,
      repository: metadata.repository, repository_id: metadata.repository_id, installation_id: metadata.installation_id,
      human_reviewer_id: metadata.human_reviewer_id, session_id: record.session?.session_id ?? null,
      proof: { source_request_digest: record.request_digest, rotate_before_expiry_seconds: metadata.rotate_before_expiry_seconds } };
  }
  return {
    create,
    // Broker-internal authority seam; public handlers expose only the named
    // projections, never this private request or its source artifacts.
    sourceRecord: args => structuredClone(retained(args)),
    read({ callerId, operatorId, requestId }) { return projection(retained({ callerId, operatorId, requestId })); },
    list({ callerId, operatorId, limit = 100 }) { identity(callerId, operatorId); return { workflow_id: "prototype-source-authoring-list", requests: store.list({ callerId, limit }).filter(record => record.operator_id === operatorId).map(projection) }; },
    prepareSourceCredential: credentialPlan,
    verifySourceCredential: args => credentialPlan({ ...args, subject: args.record.request.subject }),
  };
}
