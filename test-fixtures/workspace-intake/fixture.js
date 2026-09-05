import { bindIntake, intakeDigest, intakeReference } from "../../src/workspace-intake/contracts.js";

export const caller = "operator:test";
export const at = "2026-09-05T12:00:00.000Z";
export function inputFixture(expected = { register_digest: intakeDigest({ schema_version: 2, repos: {}, products: {}, components: {} }), record_version: null, record_digest: null }, revision = "1".repeat(40)) {
  const request = bindIntake({
    schema_version: 2, artifact_type: "workspace-intake-request", request_id: "request:test", requested_at: "2026-09-05T11:00:00Z", requester_ref: caller,
    source: { class: "direct", ref: "source:test", digest: intakeDigest("source") },
    target: { kind: "product", name: "intake-proof", record_id: "product:intake-proof" }, action: "add", requested_classification: "out-of-scope", owner_route: "workspace-governance",
    requested_record: { kind: "product", platform_owner: null, security_owner: null, runtime_owner: null, source_owners: [], intended_endpoint: null, notes: "Bounded test entrant." },
    expected_state: expected, idempotency_key: "intake-proof:one",
  }, "request_digest");
  const decision = bindIntake({
    schema_version: 2, artifact_type: "workspace-intake-decision", decision_id: "decision:test", decided_at: "2026-09-05T11:01:00Z",
    request_ref: intakeReference(request, "request"), target: request.target, decision_source: "operator",
    operator_acceptance: { state: "accepted", operator_ref: caller, recorded_at: "2026-09-05T11:01:00Z" },
    outcome: { status: "allowed", classification: request.requested_classification, owner_route: request.owner_route, approved_record: request.requested_record, findings: [] },
  }, "decision_digest");
  return { request, decision, authority_revision: revision, session_ref: "session:test", execution_ref: "execution:test" };
}

export function readinessFixture(evaluation, outcome = "allowed") {
  const receipt = bindIntake({
    schema_version: 1, artifact_type: "wgcf-workspace-intake-readiness", evaluation_id: evaluation.evaluation_id, evaluation_digest: evaluation.evaluation_digest,
    session_ref: evaluation.session_ref, execution_ref: evaluation.execution_ref, request_ref: intakeReference(evaluation.request, "request"), decision_ref: intakeReference(evaluation.decision, "decision"),
    target: evaluation.request.target, authority: { repo: "workspace-governance", revision: evaluation.authority_revision, files: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`file-${i}`, intakeDigest(i)])), bundle_digest: intakeDigest("bundle") },
    issuer: { service_identity_ref: "spiffe://test/wgcf", implementation_ref: "2".repeat(40), caller_id: "operator-orchestration-service" },
    evaluated_at: at, canonical_mutation: false, outcome, next_action: outcome === "allowed" ? "prepare-reviewed-source-change" : "correct-request", findings: [],
    observed_state: { register_digest: evaluation.request.expected_state.register_digest, record_version: null, record_digest: null, canonical_replay: false },
    obligations: ["explicit-operator-acceptance", "review-exact-source-head", "human-merge", "merged-authority-readback"],
  }, "receipt_digest");
  return { receipt, ledger: { state: "durable", resolution: "read", ref: { uri: `wgcf://readiness/workspace-intake/${receipt.receipt_digest.slice(7)}`, digest: receipt.receipt_digest } } };
}
