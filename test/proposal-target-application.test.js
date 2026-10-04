import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  assertProposalTargetArtifact,
  bindProposalTarget,
  createProposalTargetEvaluation,
  createStudioApplication,
  proposalTargetDigest,
} from "../src/proposal-target-application/contracts.js";
import { createProposalTargetService } from "../src/proposal-target-application/service.js";
import { createProposalTargetSourceClient } from "../src/proposal-target-application/source-client.js";
import { createProposalTargetStore } from "../src/proposal-target-application/store.js";

const at = "2026-10-04T18:00:00.000Z";
const caller = "governance-operations-console";
const route = {
  target: "prototype",
  rationale: "Explore the accepted Proposal before Delivery commitment.",
  source_custody: {
    classification: "existing-repo",
    repository_mode: "existing",
    repository_gate_state: "resolved",
    owner: "repo:workspace-prototype-studio",
    source_ref: "github://mfshaf7/workspace-prototype-studio",
    rationale: "Prototype Studio owns the exploring capture.",
  },
};

function projection(overrides = {}) {
  return {
    schema_version: 1,
    proposal_id: "idea-851",
    record_ref: "openproject://work_packages/851",
    record_version: "version-21",
    projection_state: "current",
    status: "accepted",
    title: "Sample Tool",
    body: "Explore a safe sample tool.",
    route,
    handoff: { state: "ready", packet_ref: "proposal-packet:851", target_receipt_ref: null, target_record_ref: null },
    ...overrides,
  };
}

function command(target) {
  const current = projection();
  return {
    application_id: "proposal-prototype-application:sample-tool:1",
    correlation_id: "correlation:proposal-target:851",
    execution_ref: "execution:proposal-target:851",
    idempotency_key: "proposal-target:851:sample-tool:1",
    operator_approval_ref: "approval:operator:851",
    proposal: {
      proposal_id: current.proposal_id,
      record_ref: current.record_ref,
      record_version: current.record_version,
      handoff_packet_ref: current.handoff.packet_ref,
      handoff_packet_digest: proposalTargetDigest({ proposal_id: current.proposal_id, record_ref: current.record_ref, record_version: current.record_version, route: current.route, handoff: current.handoff }),
    },
    prototype: { id: "prototype:sample-tool", suggested_name: "Sample Tool", suggested_objective: "Explore a safe sample tool." },
    session_ref: "session:proposal-target:851",
    target,
  };
}

function targetResult(evaluation, request) {
  const record = {
    schema_version: 1,
    artifact_type: "proposal-routed-prototype-capture",
    record_ref: "record://prototype-captures/sample-tool",
    prototype_id: "prototype:sample-tool",
    lifecycle: "exploring",
    landing_state: "captured",
    application_ref: { id: request.application_id, digest: request.request_digest },
    proposal: { proposal_id: "idea-851", record_ref: "openproject://work_packages/851", record_version: "version-21", handoff_packet_ref: "proposal-packet:851", handoff_packet_digest: evaluation.proposal.handoff_packet_digest, route },
    entry_packet: {},
    captured_at: at,
    next_action: "prototype-landing",
  };
  return bindProposalTarget({
    schema_version: 1,
    artifact_type: "proposal-prototype-application-result",
    application_ref: { id: request.application_id, digest: request.request_digest },
    replayed: false,
    readback: {
      target_record_ref: record.record_ref,
      authority_state: "review-branch",
      source_branch: request.source_branch,
      source_revision: `git-tree:${"9".repeat(40)}`,
      registry_digest: evaluation.target.expected_state.registry_digest,
      record_digest: proposalTargetDigest(record),
      record,
      observed_at: at,
    },
    receipt: {
      receipt_ref: `proposal-prototype-target-receipt:sample-tool:${"8".repeat(64)}`,
      owner: "workspace-prototype-studio",
      source_record_ref: "openproject://work_packages/851",
      source_record_version: "version-21",
      source_packet_ref: "proposal-packet:851",
      target_record_ref: record.record_ref,
      prototype_id: record.prototype_id,
      outcome: "prepared",
      recorded_at: at,
      next_action: { code: "prototype-landing", owner_ref: "operator-orchestration-service" },
      correlation_id: evaluation.correlation_id,
      idempotency_key: evaluation.idempotency_key,
    },
  }, "result_digest");
}

test("Proposal target contracts build an OOS-authorized Studio request", () => {
  const target = { authority_revision: "1".repeat(40), expected_state: { source_revision: "1".repeat(40), registry_digest: `sha256:${"2".repeat(64)}`, record_present: false, record_digest: null } };
  const evaluation = createProposalTargetEvaluation(command(target), caller);
  const proposal = { ...evaluation.proposal, route };
  const request = createStudioApplication({ evaluation, proposal, sourceBranch: `proposal-target/${"3".repeat(64)}`, requestedAt: at });
  assertProposalTargetArtifact(request);
  assert.equal(request.authorization.authority, "operator-orchestration-service");
  assert.equal(request.source.route.source_custody.repository_gate_state, "resolved");
  assert.throws(() => createProposalTargetEvaluation({ ...command(target), unexpected: true }, caller), /unexpected or missing/);
});

test("Proposal target workflow stops at review then acknowledges exact merged target evidence", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-target-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = { authority_revision: "1".repeat(40), expected_state: { source_revision: "1".repeat(40), registry_digest: `sha256:${"2".repeat(64)}`, record_present: false, record_digest: null } };
  const input = command(target);
  let merged = false;
  const acknowledgements = [];
  const proposalWorkflowService = {
    async getProjection() { return projection(); },
    async acknowledgePrototypeHandoff(value) { acknowledgements.push(value); return { replayed: false, projection: { record_version: "version-22", handoff: { state: "applied" } }, event: {}, history: {} }; },
  };
  const sourceClient = {
    async state() { return { prototype_id: input.prototype.id, authority_revision: target.authority_revision, expected_state: target.expected_state }; },
    branch: () => `proposal-target/${"3".repeat(64)}`,
    async prepare(record) {
      const request = createStudioApplication({ evaluation: record.evaluation, proposal: record.proposal, sourceBranch: this.branch(), requestedAt: at });
      return { branch: this.branch(), base_commit: target.authority_revision, file_count: 2, changed_paths: ["record.json", "history.json"], content_digest: `sha256:${"4".repeat(64)}`, files: [], request, result: targetResult(record.evaluation, request) };
    },
    async openReview(record) { return { repository: "workspace-prototype-studio", number: 7, state: "open", branch: record.preparation.branch, base_branch: "main", base_commit: record.preparation.base_commit, head_commit: "5".repeat(40), merged: false, merge_commit: null, human_reviewed: false }; },
    async observe(record) {
      const review = { ...record.review, state: merged ? "closed" : "open", merged, merge_commit: merged ? "6".repeat(40) : null, human_reviewed: merged };
      return merged ? { review, result: record.preparation.result } : { review };
    },
    async cancel() { return null; },
  };
  const service = createProposalTargetService({ store: createProposalTargetStore({ root }), sourceClient, proposalWorkflowService, clock: () => new Date(at) });
  const prepared = await service.prepare({ callerId: caller, input: { proposal_id: "idea-851", prototype_id: "prototype:sample-tool" } });
  assert.equal(prepared.canonical_mutation, false);
  assert.equal((await service.submit({ callerId: caller, input })).status, "accepted");
  assert.equal((await service.submit({ callerId: caller, input })).revision, 1);
  const waiting = await service.advance({ callerId: caller, applicationId: input.application_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.canonical_target_mutation, false);
  assert.equal((await service.advance({ callerId: caller, applicationId: input.application_id })).status, "review-required");
  merged = true;
  const completed = await service.advance({ callerId: caller, applicationId: input.application_id });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.next_action, "prototype-landing");
  assert.equal(completed.proposal_acknowledgement.projection.handoff.state, "applied");
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].targetResult.receipt.owner, "workspace-prototype-studio");
});

test("Proposal target workflow rejects unresolved repository custody before Studio mutation", async () => {
  let sourceCalls = 0;
  const service = createProposalTargetService({
    store: { transact() { throw new Error("must not write"); } },
    sourceClient: { async state() { sourceCalls += 1; } },
    proposalWorkflowService: { async getProjection() { return projection({ route: { ...route, source_custody: { ...route.source_custody, repository_gate_state: "blocked" } } }); } },
  });
  await assert.rejects(service.prepare({ callerId: caller, input: { proposal_id: "idea-851", prototype_id: "prototype:sample-tool" } }), /Repository custody must be resolved/);
  assert.equal(sourceCalls, 0);
});

test("Proposal target source client proves bounded real-Git preparation and stale-state rejection", async () => {
  const authorityRoot = path.resolve(import.meta.dirname, "../../../../workspace-prototype-studio");
  const revision = "18abb5bb5369e5e8720dc4815261bff745a691ff";
  const provider = { async mainRevision() { return revision; } };
  const client = createProposalTargetSourceClient({ authorityRoot, provider, clock: () => new Date(at) });
  const state = await client.state("prototype:source-proof-tool");
  const input = command({ authority_revision: revision, expected_state: state.expected_state });
  input.application_id = "proposal-prototype-application:source-proof-tool:1";
  input.prototype = { id: "prototype:source-proof-tool", suggested_name: "Source Proof Tool", suggested_objective: "Prove bounded real Git target preparation." };
  const evaluation = createProposalTargetEvaluation(input, caller);
  const proposal = { ...evaluation.proposal, route };
  const record = { evaluation, proposal, requested_at: at };
  record.binding_digest = proposalTargetDigest({ caller_id: caller, evaluation });
  const prepared = await client.prepare(record, () => {});
  assert.equal(prepared.file_count, 2);
  assert.ok(prepared.changed_paths.every((entry) => entry.startsWith("records/prototype-captures/source-proof-tool/")));
  assertProposalTargetArtifact(prepared.result);
  const stale = structuredClone(record);
  stale.evaluation.target.expected_state.registry_digest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(client.prepare(stale, () => {}), /rejected the Proposal target source preparation/);
});
