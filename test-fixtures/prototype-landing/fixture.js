import {
  bindPrototypeLanding,
  prototypeLandingDigest,
  prototypeLandingReference,
} from "../../src/prototype-landing/contracts.js";

export const caller = "governance-operations-console";
export const at = "2026-09-07T12:00:00.000Z";
export const revision = "1".repeat(40);
const dimensions = ["source", "studio-home", "interface", "runtime", "data", "integration", "tooling", "evidence", "visibility", "recovery"];
const checks = ["entry-integrity", "identity-availability", "required-metadata", "support-profile-integrity", "support-row-readiness", "source-custody-coherence", "source-version-freshness", "data-and-mutation-boundary", "visibility-and-exposure", "security-trigger-disposition", "expected-mutation-set"];

export function commandFixture() {
  const entry = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-entry-packet",
    entry_id: "prototype-entry:direct:sample-tool",
    captured_at: at,
    ingress_class: "direct",
    source: { authority: "operator", ref: "operator-request:sample-tool", digest: `sha256:${"2".repeat(64)}`, revision: null },
    suggestions: { name: "Suggested Tool", objective: "Suggested objective", support_profile: "simple" },
    constraints: [],
    requested_by: caller,
  }, "packet_digest");
  const expectedState = { registry_digest: `sha256:${"3".repeat(64)}`, record_present: false, record_digest: null, source_revision: revision };
  const request = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-request",
    request_id: "prototype-landing-request:sample-tool:1",
    requested_at: at,
    operator_ref: caller,
    entry_packet_ref: prototypeLandingReference(entry),
    prototype: { id: "prototype:sample-tool", name: "Operator Chosen Tool", objective: "Prove deterministic Prototype Landing." },
    setup: {
      support_profile: "simple",
      support_rows: dimensions.map((dimension) => ({ dimension, state: ["source", "studio-home", "evidence", "recovery"].includes(dimension) ? "ready" : "not-needed", generated: true, detail: `${dimension} resolved by the simple profile` })),
      scaffold_profile: "python-library",
      preview_mode: "none",
      data_mode: "synthetic",
      mutation_boundary: "none",
      visibility: "private",
    },
    source_plan: { posture: "create-studio-source", source_ref: "repo://workspace-prototype-studio/prototypes/sample-tool", source_revision: null, origin_digest: null, imported_content_digest: null },
    starting_lifecycle: "exploring",
    expected_state: expectedState,
    operator_accepted: true,
    correlation_id: "correlation:sample-tool:1",
    idempotency_key: "landing:sample-tool:1",
  }, "request_digest");
  const mutationSet = ["registry-record", "prototype-docs", "prototype-source", "validation-plan"];
  const targets = {
    "registry-record": "prototypes.yaml",
    "prototype-docs": "docs/prototypes/sample-tool",
    "prototype-source": "prototypes/sample-tool",
    "validation-plan": "records/prototype-landings/sample-tool/validation-plan.yaml",
  };
  const plan = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-plan",
    plan_id: "prototype-landing-plan:sample-tool:1",
    planned_at: at,
    request_ref: prototypeLandingReference(request),
    prototype_id: request.prototype.id,
    source_plan: structuredClone(request.source_plan),
    mutation_set: mutationSet,
    expected_outputs: mutationSet.map((kind) => ({ kind, target_ref: targets[kind], required: true })),
    next_action: "candidate-promotion",
  }, "plan_digest");
  return { authority_revision: revision, entry_packet: entry, request, plan, operator_approval_ref: "approval:sample-tool:1", session_ref: "session:sample-tool:1", execution_ref: "execution:sample-tool:1" };
}

export function readinessFixture(evaluation, outcome = "ready") {
  const readiness = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-readiness",
    readiness_id: "prototype-landing-readiness:sample-tool:1",
    evaluated_at: at,
    request_ref: prototypeLandingReference(evaluation.request),
    plan_ref: prototypeLandingReference(evaluation.plan),
    observed_state: { registry_digest: evaluation.request.expected_state.registry_digest, record_present: false, source_revision: evaluation.authority_revision },
    outcome,
    checks: checks.map((id, index) => ({ id, state: outcome === "ready" || index ? "ready" : outcome, evidence_refs: [`evidence:${id}`] })),
    findings: outcome === "ready" ? [] : [{ code: `landing-${outcome}`, severity: "blocking", message: "Landing requires corrected input.", owner_ref: caller, next_action: "submit-corrected-request" }],
    security_trigger_refs: [],
  }, "readiness_digest");
  return {
    readiness,
    ledger: {
      resolution: "read",
      state: "durable",
      ref: { uri: `wgcf://readiness/prototype-landing/${readiness.readiness_digest.slice(7)}`, digest: readiness.readiness_digest },
      authority_revision: evaluation.authority_revision,
      contract_digest: `sha256:${"4".repeat(64)}`,
      implementation_ref: "5".repeat(40),
      service_identity_ref: "spiffe://test/wgcf/prototype-landing",
      policy_version: "prototype-landing.v1@test",
      expires_at: "2026-09-07T12:15:00.000Z",
    },
  };
}

export function preparationFixture(evaluation, readiness, apply, branch) {
  const record = {
    id: evaluation.request.prototype.id,
    entry_ref: prototypeLandingReference(evaluation.entry_packet),
    name: evaluation.request.prototype.name,
    objective: evaluation.request.prototype.objective,
    ingress_class: evaluation.entry_packet.ingress_class,
    lifecycle: "exploring",
    project_phase: "incubating",
    setup: structuredClone(evaluation.request.setup),
    source: { posture: "create-studio-source", custody: "incubation-repo", ref: evaluation.request.source_plan.source_ref, revision: `created-from:${evaluation.authority_revision}` },
    next_action: "candidate-promotion",
  };
  const registryDigest = `sha256:${"6".repeat(64)}`;
  const recordDigest = prototypeLandingDigest(record);
  const readback = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-readback",
    readback_id: "prototype-landing-readback:sample-tool:1",
    apply_ref: prototypeLandingReference(apply),
    prototype_id: evaluation.request.prototype.id,
    authority_state: "review-branch",
    source_branch: branch,
    source_revision: `git-tree:${"7".repeat(40)}`,
    registry_digest: registryDigest,
    record_digest: recordDigest,
    record,
    observed_at: at,
  }, "readback_digest");
  const receipt = bindPrototypeLanding({
    schema_version: 1,
    artifact_type: "prototype-landing-receipt",
    receipt_id: "prototype-landing-receipt:sample-tool:1",
    completed_at: at,
    entry_packet_ref: prototypeLandingReference(evaluation.entry_packet),
    request_ref: prototypeLandingReference(evaluation.request),
    plan_ref: prototypeLandingReference(evaluation.plan),
    readiness_ref: prototypeLandingReference(readiness),
    apply_ref: prototypeLandingReference(apply),
    readback_ref: prototypeLandingReference(readback),
    prototype_id: evaluation.request.prototype.id,
    phase: "source-preparation",
    outcome: "prepared",
    source_result: { repo: "workspace-prototype-studio", branch, revision: readback.source_revision, registry_digest: registryDigest, record_digest: recordDigest },
    next_action: { code: "review-source", owner_ref: "operator-orchestration-service" },
    correlation_id: evaluation.request.correlation_id,
    idempotency_key: evaluation.request.idempotency_key,
  }, "receipt_digest");
  return { branch, base_commit: evaluation.authority_revision, files: [], file_count: 8, changed_paths: ["prototypes.yaml"], content_digest: `sha256:${"8".repeat(64)}`, readback, receipt };
}
