import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
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
    handoff: { state: "ready", packet_ref: "proposal-handoff:idea-851:version-21", target_receipt_ref: null, target_record_ref: null },
    ...overrides,
  };
}

function command(target) {
  const current = projection();
  return {
    application_id: "proposal-prototype-application:proposal-851:1",
    correlation_id: "correlation:proposal-target:851",
    execution_ref: "execution:proposal-target:851",
    idempotency_key: "proposal-target:851:1",
    operator_approval_ref: "approval:operator:851",
    proposal: {
      proposal_id: current.proposal_id,
      record_ref: current.record_ref,
      record_version: current.record_version,
      handoff_packet_ref: current.handoff.packet_ref,
      handoff_packet_digest: proposalTargetDigest({ proposal_id: current.proposal_id, record_ref: current.record_ref, record_version: current.record_version, route: current.route, handoff: current.handoff }),
    },
    prototype: { id: "prototype:proposal-851" },
    session_ref: "session:proposal-target:851",
    target,
  };
}

function targetResult(evaluation, request) {
  const slug = evaluation.prototype.id.slice("prototype:".length);
  const publicRoute = {
    target: "prototype",
    source_custody: {
      classification: route.source_custody.classification,
      repository_mode: route.source_custody.repository_mode,
      repository_gate_state: route.source_custody.repository_gate_state,
    },
  };
  const entry = bindProposalTarget({
    schema_version: 1,
    artifact_type: "prototype-entry-packet",
    entry_id: `prototype-entry:proposal-routed:${slug}`,
    captured_at: at,
    ingress_class: "proposal-routed",
    source: { authority: "workspace-proposals", ref: request.source.record_ref, digest: request.source.handoff_packet_digest, revision: request.source.record_version },
    suggestions: { name: "Proposal 851 Prototype", objective: null, support_profile: null },
    constraints: [
      { code: "proposal-route", detail: "target=prototype" },
      { code: "source-custody", detail: "classification=existing-repo;repository_mode=existing;repository_gate_state=resolved" },
    ],
    requested_by: "operator-orchestration-service",
  }, "packet_digest");
  const record = {
    schema_version: 2,
    artifact_type: "proposal-routed-prototype-capture",
    record_ref: `record://prototype-captures/${slug}`,
    prototype_id: evaluation.prototype.id,
    lifecycle: "exploring",
    landing_state: "captured",
    application_ref: { id: request.application_id, digest: request.request_digest },
    proposal: { proposal_id: request.source.proposal_id, record_ref: request.source.record_ref, record_version: request.source.record_version, handoff_packet_ref: request.source.handoff_packet_ref, handoff_packet_digest: evaluation.proposal.handoff_packet_digest, route: publicRoute },
    entry_packet: entry,
    captured_at: at,
    next_action: "prototype-landing",
  };
  return bindProposalTarget({
    schema_version: 2,
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
      receipt_ref: `proposal-prototype-target-receipt:${slug}:${"8".repeat(64)}`,
      owner: "workspace-prototype-studio",
      source_record_ref: request.source.record_ref,
      source_record_version: request.source.record_version,
      source_packet_ref: request.source.handoff_packet_ref,
      target_record_ref: record.record_ref,
      prototype_id: record.prototype_id,
      outcome: "prepared",
      recorded_at: at,
      next_action: { code: "prototype-landing", owner_ref: "operator-orchestration-service" },
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
  const publicRequest = JSON.stringify(request);
  for (const forbidden of [caller, "Sample Tool", "Explore a safe sample tool.", route.rationale, route.source_custody.owner, route.source_custody.source_ref, route.source_custody.rationale, "correlation_id", "idempotency_key"]) {
    assert.equal(publicRequest.includes(forbidden), false);
  }
  assert.throws(() => createProposalTargetEvaluation({ ...command(target), unexpected: true }, caller), /unexpected or missing/);
  assert.throws(() => createProposalTargetEvaluation({ ...command(target), prototype: { ...command(target).prototype, suggested_name: "Private" } }, caller), /unexpected or missing/);
  assert.throws(() => createProposalTargetEvaluation({ ...command(target), prototype: { id: "prototype:proposal-852" } }, caller), /invalid identity/);
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
  const prepared = await service.prepare({ callerId: caller, input: { proposal_id: "idea-851" } });
  assert.equal(prepared.prototype_id, "prototype:proposal-851");
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

test("Proposal target workflow restarts only a cancelled zero-mutation application with fresh target authority", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-target-restart-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalTarget = { authority_revision: "1".repeat(40), expected_state: { source_revision: "1".repeat(40), registry_digest: `sha256:${"2".repeat(64)}`, record_present: false, record_digest: null } };
  const currentTarget = { authority_revision: "3".repeat(40), expected_state: { source_revision: "3".repeat(40), registry_digest: `sha256:${"4".repeat(64)}`, record_present: false, record_digest: null } };
  const events = [];
  const sourceClient = { async cancel() { return null; } };
  const proposalWorkflowService = { async getProjection() { return projection(); } };
  const service = createProposalTargetService({
    store: createProposalTargetStore({ root }),
    sourceClient,
    proposalWorkflowService,
    clock: () => new Date(at),
    audit: { emit(event) { events.push(event); } },
  });
  const original = command(originalTarget);
  const current = command(currentTarget);
  assert.equal((await service.submit({ callerId: caller, input: original })).status, "accepted");
  await assert.rejects(
    service.submit({ callerId: caller, input: current }),
    (error) => error.code === "proposal_target_idempotency_conflict",
  );
  const cancelled = await service.advance({ callerId: caller, applicationId: original.application_id, action: "cancel" });
  assert.equal(cancelled.status, "cancelled");
  await assert.rejects(
    service.submit({ callerId: caller, input: { ...current, correlation_id: "different-correlation" } }),
    (error) => error.code === "proposal_target_idempotency_conflict",
  );
  const restarted = await service.submit({ callerId: caller, input: current });
  assert.equal(restarted.status, "accepted");
  assert.equal(restarted.target.authority_revision, currentTarget.authority_revision);
  assert.equal(restarted.history.at(-1).details.restarted_after_cancel, true);
  assert.equal(restarted.history.at(-1).details.prior_authority_revision, originalTarget.authority_revision);
  assert.equal(restarted.canonical_target_mutation, false);
  assert.equal(restarted.proposal_mutation, false);
  assert.equal(events.at(-1).event_type, "proposal.target.restarted");
  assert.equal((await service.submit({ callerId: caller, input: current })).revision, restarted.revision);
});

test("Proposal target workflow denies changed authority after preparation even when cancelled", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-target-prepared-cancel-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalTarget = { authority_revision: "1".repeat(40), expected_state: { source_revision: "1".repeat(40), registry_digest: `sha256:${"2".repeat(64)}`, record_present: false, record_digest: null } };
  const currentTarget = { authority_revision: "3".repeat(40), expected_state: { source_revision: "3".repeat(40), registry_digest: `sha256:${"4".repeat(64)}`, record_present: false, record_digest: null } };
  const input = command(originalTarget);
  const sourceClient = {
    async prepare() { return { branch: `proposal-target/${"3".repeat(64)}`, base_commit: originalTarget.authority_revision, file_count: 2, changed_paths: ["record.json", "history.json"], content_digest: `sha256:${"4".repeat(64)}`, files: [], request: {}, result: {} }; },
    async openReview(record) { return { repository: "workspace-prototype-studio", number: 7, state: "open", branch: record.preparation.branch, base_branch: "main", base_commit: record.preparation.base_commit, head_commit: "5".repeat(40), merged: false, merge_commit: null, human_reviewed: false }; },
    async cancel() { return null; },
  };
  const service = createProposalTargetService({
    store: createProposalTargetStore({ root }),
    sourceClient,
    proposalWorkflowService: { async getProjection() { return projection(); } },
    clock: () => new Date(at),
  });
  await service.submit({ callerId: caller, input });
  assert.equal((await service.advance({ callerId: caller, applicationId: input.application_id })).status, "review-required");
  assert.equal((await service.advance({ callerId: caller, applicationId: input.application_id, action: "cancel" })).status, "cancelled");
  await assert.rejects(
    service.submit({ callerId: caller, input: command(currentTarget) }),
    (error) => error.code === "proposal_target_idempotency_conflict",
  );
});

test("Proposal target workflow rejects unresolved repository custody before Studio mutation", async () => {
  let sourceCalls = 0;
  const service = createProposalTargetService({
    store: { transact() { throw new Error("must not write"); } },
    sourceClient: { async state() { sourceCalls += 1; } },
    proposalWorkflowService: { async getProjection() { return projection({ route: { ...route, source_custody: { ...route.source_custody, repository_gate_state: "blocked" } } }); } },
  });
  await assert.rejects(service.prepare({ callerId: caller, input: { proposal_id: "idea-851" } }), /Repository custody must be resolved/);
  assert.equal(sourceCalls, 0);
});

test("Proposal target source client proves bounded real-Git preparation and stale-state rejection", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-target-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = promisify(execFile);
  const git = async (...args) => (await run("git", ["-C", root, ...args])).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.name", "Fixture Owner");
  await git("config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(root, "prototypes.yaml"), "schema_version: 1\nprototypes: []\n");
  await git("add", "prototypes.yaml");
  await git("commit", "-m", "fixture authority");
  const revision = await git("rev-parse", "HEAD");
  await git("update-ref", "refs/remotes/origin/main", revision);
  const registryDigest = `sha256:${"2".repeat(64)}`;
  const provider = { async mainRevision() { return revision; } };
  let evaluation;
  const ownerCommand = {
    async state({ prototypeId }) { return { prototype_id: prototypeId, expected_state: { source_revision: revision, registry_digest: registryDigest, record_present: false, record_digest: null } }; },
    async apply({ outputPath, request, source }) {
      if (request.target.expected_state.registry_digest !== registryDigest) {
        const error = new Error("stale"); error.stdout = JSON.stringify({ code: "source_state_stale" }); throw error;
      }
      const slug = request.target.prototype_id.slice("prototype:".length);
      const record = targetResult(evaluation, request).readback.record;
      const recordRoot = path.join(source, "records", "prototype-captures", slug);
      await mkdir(path.join(recordRoot, "history"), { recursive: true });
      await writeFile(path.join(recordRoot, "record.json"), `${JSON.stringify(record)}\n`);
      await writeFile(path.join(recordRoot, "history", `${request.application_id.replaceAll(":", "-")}.json`), `${JSON.stringify(request)}\n`);
      await run("git", ["-C", source, "add", "--all"]);
      const tree = (await run("git", ["-C", source, "write-tree"])).stdout.trim();
      const result = targetResult(evaluation, request);
      result.readback.source_revision = `git-tree:${tree}`;
      result.result_digest = proposalTargetDigest(result, "result_digest");
      await writeFile(outputPath, `${JSON.stringify(result)}\n`);
    },
  };
  const client = createProposalTargetSourceClient({ authorityRoot: root, provider, ownerCommand, minimumRevision: revision, clock: () => new Date(at) });
  const state = await client.state("prototype:proposal-851");
  const input = command({ authority_revision: revision, expected_state: state.expected_state });
  evaluation = createProposalTargetEvaluation(input, caller);
  const proposal = { ...evaluation.proposal, route };
  const record = { evaluation, proposal, requested_at: at };
  record.binding_digest = proposalTargetDigest({ caller_id: caller, evaluation });
  const prepared = await client.prepare(record, () => {});
  assert.equal(prepared.file_count, 2);
  assert.ok(prepared.changed_paths.every((entry) => entry.startsWith("records/prototype-captures/proposal-851/")));
  assertProposalTargetArtifact(prepared.result);
  const stale = structuredClone(record);
  stale.evaluation.target.expected_state.registry_digest = `sha256:${"f".repeat(64)}`;
  await assert.rejects(client.prepare(stale, () => {}), /rejected the Proposal target source preparation/);
});
