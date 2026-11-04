import { intakeDigest, bindIntake } from "../src/workspace-intake/contracts.js";
export const instanceId = "installation-a", at = "2026-11-04T00:00:00.000Z";
export const callerId = "operator-orchestration-service", operator = "fixture-console";
export const target = { kind: "repo", name: "client-project", record_id: "repo:client-project" };
export const policy = { repo: "workspace-governance", revision: "a".repeat(40), contract_digest: intakeDigest("synthetic-policy") };
export function nativeInput() {
  const source = { class: "repository-custody", ref: `oos://repository-custody/requests/synthetic/intake/${"a".repeat(64)}`, digest: intakeDigest("synthetic-custody") };
  const requested_record = { kind: "repo", repo_class: "product-source", requires_security_bindings: false, security_owner: null,
    notes: "Synthetic source-only project", provider_repository: { provider: "github", provider_repository_id: "123", full_name: "example-org/client-project" },
    validation_behavior: { posture: "covered-by-owner-repo", wgcf_graph_role: "product-runtime-source", catalog_refs: [], notes: "Owner controls." } };
  const request = bindIntake({ schema_version: 1, artifact_type: "instance-repository-intake-request", instance_id: instanceId,
    custody_request_id: "synthetic", request_id: "workspace-intake-request:synthetic", requested_at: at, requester_ref: operator,
    source, target, action: "add", requested_classification: "proposed", owner_route: "workspace-governance",
    requested_record, expected_state: { record_version: null, record_digest: null }, policy_ref: policy,
    idempotency_key: "workspace-intake-request:synthetic:v1" }, "request_digest");
  const decision = bindIntake({ schema_version: 2, artifact_type: "workspace-intake-decision", decision_id: "synthetic-decision",
    decided_at: at, request_ref: { id: request.request_id, digest: request.request_digest }, target, decision_source: "operator",
    operator_acceptance: { state: "accepted", operator_ref: operator, recorded_at: at },
    outcome: { status: "allowed", classification: "proposed", owner_route: request.owner_route, approved_record: requested_record, findings: [] } }, "decision_digest");
  return { schema_version: 1, request, decision, operator_ref: operator,
    source_attestation: bindIntake({ attested_by: callerId, source, provider_repository: requested_record.provider_repository,
      evidence_refs: ["oos://repository-custody/receipts/synthetic.json"] }, "attestation_digest"), owner_readiness: null };
}
export function nativeResult(input = nativeInput()) {
  const { request, decision } = input, { kind: _kind, ...metadata } = request.requested_record;
  const record = { ...metadata, phase: "intake", status: request.requested_classification, owner_route: request.owner_route,
    record: { id: target.record_id, version: 1, source: request.source,
      decision: { id: decision.decision_id, ref: `workspace-intake-decision:${decision.decision_id}`, digest: decision.decision_digest,
        source: "operator", operator_ref: operator, decided_at: at },
      last_mutation: { request_digest: request.request_digest, decision_digest: decision.decision_digest, idempotency_key: request.idempotency_key } } };
  const receipt = bindIntake({ schema_version: 1, artifact_type: "instance-operational-record-receipt", authority: "internal-instance-record",
    instance_id: instanceId, record_id: target.record_id, version: 1, record_digest: intakeDigest(record), previous: { version: null, digest: null },
    idempotency_key: request.idempotency_key, command_digest: intakeDigest("synthetic-canonical-command"), actor: callerId, action: "intake.add", accepted_at: at,
    policy_ref: `git://workspace-governance/${policy.revision}/contracts/instance-operational-records.yaml@${policy.contract_digest}`,
    decision_digest: decision.decision_digest, readiness_digest: intakeDigest("synthetic-readiness"), operator_ref: operator }, "receipt_digest");
  return { record, receipt };
}

export function nativeInventoryInput(current = nativeResult(), action = "promote") {
  const before = current.record;
  const requested = action === "promote" ? { posture: "active", lifecycle: "active", repo_class: "product-source", requires_security_bindings: false,
    provider_repository: before.provider_repository, validation_behavior: before.validation_behavior,
    owns: [before.notes], must_not_own: ["Shared runtime, identity and Security authority"], allowed_authoritative_refs: [] } : null;
  const request = bindIntake({ schema_version: 1, artifact_type: "instance-repository-inventory-request", instance_id: instanceId,
    request_id: `inventory:${action}`, requested_at: at, operator_ref: operator, correlation_ref: `console://inventory/${action}`,
    idempotency_key: `inventory:${action}`, action, target, expected_state: { record_version: current.receipt.version, record_digest: current.receipt.record_digest },
    requested_value: requested, prior_receipt_digest: action === "restore" ? current.receipt.receipt_digest : null,
    reason: action === "promote" ? null : "Reviewed source lifecycle change", impact_acknowledgements: action === "promote" ? [] : ["References follow the selected posture"],
    approval_refs: ["console://inventory/acceptance"], operator_acceptance: { state: "accepted", operator_ref: operator, recorded_at: at }, policy_ref: policy }, "request_digest");
  return { schema_version: 1, request, operator_ref: operator };
}
export function nativeInventoryResult(input = nativeInventoryInput(), current = nativeResult()) {
  const request = input.request;
  const record = request.action === "promote" ? { ...request.requested_value, phase: "inventory", record: {
    id: target.record_id, lineage: { source: "workspace-intake", source_ref: target.record_id, source_digest: current.receipt.record_digest, intake_entry_version: current.receipt.version },
  } } : structuredClone(current.record);
  record.posture = { promote: "active", suspend: "suspended", retire: "retired", restore: "active" }[request.action];
  record.lifecycle = record.posture;
  record.record.version = current.receipt.version + 1;
  record.record.last_mutation = { id: `instance-inventory:${request.idempotency_key}`, action: request.action, idempotency_key: request.idempotency_key,
    request_ref: request.request_id, request_digest: request.request_digest, readiness_ref: `instance-inventory-readiness:${request.request_id}`,
    readiness_digest: intakeDigest("synthetic-native-readiness"), applied_at: at };
  const receipt = bindIntake({ ...current.receipt, version: record.record.version, record_digest: intakeDigest(record),
    previous: { version: current.receipt.version, digest: current.receipt.record_digest }, idempotency_key: request.idempotency_key,
    command_digest: intakeDigest(input), action: `inventory.${request.action}`, accepted_at: at,
    decision_digest: intakeDigest({ request_ref: { id: request.request_id, digest: request.request_digest }, operator_acceptance: request.operator_acceptance }),
    readiness_digest: record.record.last_mutation.readiness_digest }, "receipt_digest");
  return { record, receipt };
}
