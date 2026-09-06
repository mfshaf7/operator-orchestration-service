import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { bindIntake, intakeDigest, intakeReference } from "../src/workspace-intake/contracts.js";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import {
  bindWorkspaceIntakeSourceCandidate,
  deliveryWorkspaceIntakeSourceCandidate,
} from "../src/workspace-intake/source-candidate.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";

const at = "2026-09-06T02:00:00.000Z";
const operator = "governance-operations-console";

function candidate(sourceClass = "prototype") {
  return bindWorkspaceIntakeSourceCandidate({
    schema_version: 1,
    artifact_type: "workspace-intake-source-candidate",
    source: {
      class: sourceClass,
      ref: `record://intake-candidates/${"a".repeat(64)}`,
      digest: `sha256:${"b".repeat(64)}`,
    },
    target: { kind: "product", name: "candidate-proof", record_id: "product:candidate-proof" },
    requested_record: {
      kind: "product",
      platform_owner: "platform-engineering",
      security_owner: "security-architecture",
      runtime_owner: "platform-engineering",
      source_owners: ["workspace-prototype-studio"],
      intended_endpoint: null,
      notes: "Candidate from an approved prototype baseline.",
    },
    evidence_refs: ["record://design-baselines/candidate-proof-v1"],
  });
}

function commandFor(sourceCandidate) {
  const request = bindIntake({
    schema_version: 2,
    artifact_type: "workspace-intake-request",
    request_id: "request:candidate-proof",
    requested_at: at,
    requester_ref: operator,
    source: sourceCandidate.source,
    target: sourceCandidate.target,
    action: "add",
    requested_classification: "admitted",
    owner_route: "workspace-governance",
    requested_record: sourceCandidate.requested_record,
    expected_state: { register_digest: `sha256:${"c".repeat(64)}`, record_version: null, record_digest: null },
    idempotency_key: "candidate-proof:v1",
  }, "request_digest");
  const decision = bindIntake({
    schema_version: 2,
    artifact_type: "workspace-intake-decision",
    decision_id: "decision:candidate-proof",
    decided_at: at,
    request_ref: intakeReference(request, "request"),
    target: request.target,
    decision_source: "operator",
    operator_acceptance: { state: "accepted", operator_ref: operator, recorded_at: at },
    outcome: { status: "allowed", classification: "admitted", owner_route: "workspace-governance", approved_record: request.requested_record, findings: [] },
  }, "decision_digest");
  return { authority_revision: "d".repeat(40), decision, execution_ref: "execution:candidate-proof", request, session_ref: "session:candidate-proof" };
}

async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-intake-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    clock: () => new Date(at),
    readinessClient: { evaluate() { throw new Error("not used"); } },
    sourceClient: {},
  };
  const service = createWorkspaceIntakeService({ ...options, store: createWorkspaceIntakeStore({ root }) });
  const reopen = () => createWorkspaceIntakeService({ ...options, store: createWorkspaceIntakeStore({ root }) });
  return { reopen, service };
}

test("source-owner attestation is immutable, caller-bound and restart durable", async (t) => {
  const h = await harness(t);
  const sourceCandidate = candidate();
  const first = await h.service.attest({ callerId: "workspace-prototype-studio", input: sourceCandidate });
  assert.equal(first.candidate.candidate_digest, sourceCandidate.candidate_digest);
  assert.deepEqual(await h.reopen().attest({ callerId: "workspace-prototype-studio", input: sourceCandidate }), first);
  await assert.rejects(
    h.service.attest({ callerId: operator, input: sourceCandidate }),
    (error) => error.code === "workspace_intake_source_candidate_caller_mismatch",
  );
  const altered = { ...structuredClone(sourceCandidate), evidence_refs: ["record://evidence/altered"] };
  await assert.rejects(
    h.service.attest({ callerId: "workspace-prototype-studio", input: altered }),
    (error) => error.code === "workspace_intake_source_candidate_digest_invalid",
  );
  altered.candidate_digest = intakeDigest(altered, "candidate_digest");
  await assert.rejects(
    h.service.attest({ callerId: "workspace-prototype-studio", input: altered }),
    (error) => error.code === "workspace_intake_source_candidate_conflict",
  );
});

test("submission resolves exact source-owner candidate before acknowledgement", async (t) => {
  const h = await harness(t);
  const sourceCandidate = candidate();
  const command = commandFor(sourceCandidate);
  await assert.rejects(
    h.service.submit({ callerId: operator, input: command }),
    (error) => error.code === "workspace_intake_source_candidate_not_found",
  );
  await h.service.attest({ callerId: "workspace-prototype-studio", input: sourceCandidate });
  const accepted = await h.service.submit({ callerId: operator, input: command });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.source_attestation.candidate_digest, sourceCandidate.candidate_digest);

  const mutations = [
    (request) => { request.source.digest = `sha256:${"e".repeat(64)}`; },
    (request) => { request.source.ref = "record://intake-candidates/altered"; },
    (request) => { request.target.name = "altered"; request.target.record_id = "product:altered"; },
    (request) => { request.requested_record.runtime_owner = "altered-owner"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(command);
    mutate(changed.request);
    changed.request.request_id = `request:altered-${index}`;
    changed.request.idempotency_key = changed.request.request_id;
    changed.request = bindIntake(changed.request, "request_digest");
    changed.decision.request_ref = intakeReference(changed.request, "request");
    changed.decision.target = changed.request.target;
    changed.decision.outcome.approved_record = changed.request.requested_record;
    changed.decision = bindIntake(changed.decision, "decision_digest");
    await assert.rejects(() => h.service.submit({ callerId: operator, input: changed }));
  }

  const replay = await h.reopen().submit({ callerId: operator, input: command });
  assert.deepEqual(replay, accepted);
});

test("Delivery closeout result maps to the same exact attested request content", () => {
  const event = {
    status: "applied",
    outcome_ref: "oos://delivery-closeout-outcomes/command:one",
    receipt: { digest: `sha256:${"f".repeat(64)}` },
    impact: {
      kind: "workspace_entrant",
      candidate: {
        entrant_kind: "product",
        canonical_key: "delivery-product",
        correlation_ref: "command:one",
        evidence_refs: ["review-packet://delivery/final"],
        intake_metadata: {
          intended_endpoint: "https://product.example.test",
          platform_owner: "platform-engineering",
          runtime_owner: "platform-engineering",
          security_owner: "security-architecture",
          source_owners: ["product-owner"],
        },
      },
    },
  };
  const mapped = deliveryWorkspaceIntakeSourceCandidate(event);
  assert.equal(mapped.source.class, "delivery");
  assert.equal(mapped.target.record_id, "product:delivery-product");
  assert.equal(mapped.requested_record.kind, "product");
  assert.equal(mapped.candidate_digest, intakeDigest(mapped, "candidate_digest"));
});
