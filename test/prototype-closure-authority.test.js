import assert from "node:assert/strict";
import test from "node:test";
import { createPrototypeClosureAuthorityResolver } from "../src/prototype-closure/authority-resolver.js";
import { assertResolvedAuthority } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureOwnerEvidenceReader } from "../src/prototype-closure/owner-evidence.js";

const revision = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const owners = {
  accepted_baseline_receipt_ref: "operator-orchestration-service",
  target_delivery_ref: "workspace-delivery-art",
  accepted_delivery_target_receipt_ref: "operator-orchestration-service",
  durable_owner_acceptance_ref: "owner:sample",
  source_transfer_receipt_ref: "owner:sample",
  retention_plan_ref: "workspace-prototype-studio",
  runtime_disposition_plan_ref: "platform-engineering",
  runtime_disposition_proof_ref: "platform-engineering",
  prior_retirement_receipt_ref: "operator-orchestration-service",
  retained_source_readback_ref: "workspace-prototype-studio",
};
const fields = {
  "apply-delivery": ["accepted_baseline_receipt_ref", "target_delivery_ref", "accepted_delivery_target_receipt_ref"],
  "graduate-source": ["accepted_delivery_target_receipt_ref", "durable_owner_acceptance_ref", "source_transfer_receipt_ref"],
  "retire-incubation": ["retention_plan_ref", "runtime_disposition_plan_ref", "runtime_disposition_proof_ref"],
  "reopen-incubation": ["prior_retirement_receipt_ref", "retained_source_readback_ref"],
};

function fixture(action) {
  const request = {
    schema_version: 2, artifact_type: "prototype-closure-request", request_id: `closure:${action}`,
    prototype_id: "sample", action, expected_source_revision: revision,
    expected_lifecycle: {
      "apply-delivery": "baseline-approved", "graduate-source": "graduating",
      "retire-incubation": "candidate", "reopen-incubation": "retired",
    }[action],
    operator_id: "operator:test", correlation_id: "correlation:test", idempotency_key: `key:${action}`,
  };
  const source = {
    source_revision: revision, design_baseline_ref: "record://baseline/sample",
    delivery_packet_ref: "record://packet/sample", project_phase: "delivery-governed",
    accepted_delivery_target_receipt_ref: "receipt://delivery/accepted",
    retirement_ref: "record://prototype-closure/sample/history/0001",
  };
  if (action === "apply-delivery") Object.assign(request, {
    accepted_baseline_receipt_ref: "receipt://baseline/accepted",
    target_kind: "new-delivery-epic",
    target_delivery_ref: "openproject://work_packages/900",
    accepted_delivery_target_receipt_ref: "receipt://delivery/accepted",
  });
  if (action === "graduate-source") Object.assign(request, {
    accepted_delivery_target_receipt_ref: source.accepted_delivery_target_receipt_ref,
    durable_owner_ref: "owner:sample", durable_repo_ref: "repo://sample/source",
    durable_owner_acceptance_ref: "receipt://owner/accepted", transfer_strategy: "transfer",
  });
  if (action === "retire-incubation") Object.assign(request, {
    retirement_reason: "Exploration complete", retention_plan_ref: "plan://sample/retention",
    runtime_disposition_plan_ref: "plan://sample/runtime",
  });
  if (action === "reopen-incubation") request.prior_retirement_receipt_ref = "receipt://closure/retired";
  const evidence = fields[action].map((field) => ({
    field, owner_ref: owners[field], ref: request[field] ?? `receipt://sample/${field}`,
    digest, state: "accepted", subject_ref: null, source_revision: null,
    source_packet_ref: null, prototype_id: null,
  }));
  const byField = Object.fromEntries(evidence.map((row) => [row.field, row]));
  if (action === "apply-delivery") {
    byField.accepted_baseline_receipt_ref.subject_ref = source.design_baseline_ref;
    byField.accepted_baseline_receipt_ref.prototype_id = request.prototype_id;
    byField.accepted_delivery_target_receipt_ref.subject_ref = byField.target_delivery_ref.ref;
    byField.accepted_delivery_target_receipt_ref.source_packet_ref = source.delivery_packet_ref;
    byField.accepted_delivery_target_receipt_ref.prototype_id = request.prototype_id;
  }
  if (action === "graduate-source") {
    byField.accepted_delivery_target_receipt_ref.source_packet_ref = source.delivery_packet_ref;
    byField.accepted_delivery_target_receipt_ref.prototype_id = request.prototype_id;
    byField.durable_owner_acceptance_ref.subject_ref = request.durable_repo_ref;
    byField.source_transfer_receipt_ref.subject_ref = request.durable_repo_ref;
    byField.source_transfer_receipt_ref.source_revision = revision;
  }
  if (action === "retire-incubation") byField.runtime_disposition_proof_ref.subject_ref = request.runtime_disposition_plan_ref;
  if (action === "reopen-incubation") {
    byField.prior_retirement_receipt_ref.subject_ref = source.retirement_ref;
    byField.retained_source_readback_ref.source_revision = revision;
  }
  const current = Object.fromEntries(evidence.map((row) => [row.field, {
    ...row,
    ...(row.field === "source_transfer_receipt_ref" ? { observed_source_custody: "dedicated-owner-repo" } : {}),
  }]));
  return { request, source, readiness: { readiness: { outcome: "ready", evidence } }, current };
}

for (const action of Object.keys(fields)) {
  test(`${action} reconciles current owner readbacks before source preparation`, async () => {
    const { request, source, readiness, current } = fixture(action);
    const reader = { read: async ({ field }) => current[field] };
    const readEvidence = createPrototypeClosureOwnerEvidenceReader(Object.fromEntries(
      [...new Set([...Object.values(owners), "owner:sample"])].map((owner) => [owner, reader]),
    ));
    const resolver = createPrototypeClosureAuthorityResolver({ readEvidence });
    const resolved = await resolver.resolve(request, readiness, source);
    assert.equal(assertResolvedAuthority(request, resolved, readiness), resolved);
    if (action === "graduate-source") assert.equal(resolved.observed_source_custody, "dedicated-owner-repo");
    if (action === "reopen-incubation") assert.equal(resolved.prior_retirement_event_ref, source.retirement_ref);
    current[fields[action][0]].state = "revoked";
    await assert.rejects(resolver.resolve(request, readiness, source), /readback differs/i);
  });
}

test("already-owned graduation requires proof of the selected durable repository", async () => {
  const { request, source, readiness, current } = fixture("graduate-source");
  request.transfer_strategy = "already-owned";
  request.already_owned_source_proof_ref = "proof://owner/already-owned";
  const row = readiness.readiness.evidence.find((entry) => entry.field === "source_transfer_receipt_ref");
  row.field = "already_owned_source_proof_ref";
  row.ref = request.already_owned_source_proof_ref;
  current.already_owned_source_proof_ref = {
    ...row, observed_source_custody: "shared-owner-repo",
  };
  delete current.source_transfer_receipt_ref;
  const resolver = createPrototypeClosureAuthorityResolver({ readEvidence: async ({ field }) => current[field] });
  const resolved = await resolver.resolve(request, readiness, source);
  assert.equal(resolved.observed_source_custody, "shared-owner-repo");
  assert.equal(resolved.source_transfer_receipt_ref, undefined);
  assert.equal(assertResolvedAuthority(request, resolved, readiness), resolved);
  current.already_owned_source_proof_ref.source_revision = "c".repeat(40);
  await assert.rejects(resolver.resolve(request, readiness, source), /readback differs/i);
});
