import { createInstanceSourceOwnerClient } from "../src/instance-records/source-authority.js";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { HttpError } from "../src/errors.js";
import { intakeDigest, bindIntake } from "../src/workspace-intake/contracts.js";
import { createInstanceIntakeJournal } from "../src/instance-records/intake-journal.js";
import { createInstanceIntakeService } from "../src/instance-records/intake-service.js";
import { createRepositoryCustodyService } from "../src/repository-custody/service.js";
import { createRepositoryCustodyStore } from "../src/repository-custody/store.js";
import { custodyRequest, custodyDecision, providerReadback, TEST_CLOCK } from "../test-fixtures/repository-custody.js";

const callerId = "fixture-console", instanceId = "installation-a";
async function harness(t, { loseAcknowledgement = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "instance-intake-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const connection = custodyRequest();
  const custody = createRepositoryCustodyService({ clock: TEST_CLOCK,
    store: createRepositoryCustodyStore({ root: path.join(root, "custody") }),
    readinessClient: { evaluate: async () => { const decision = custodyDecision(connection);
      return { decision, decisionRef: { uri: "wgcf://decisions/repository-custody/synthetic.json", digest: decision.integrity.content_digest } }; } },
    providerClient: { read: async input => providerReadback(input) } });
  await custody.execute({ callerId, input: connection });
  const target = { kind: "repo", name: "example-repository", record_id: "repo:example-repository" };
  const policy = { repo: "workspace-governance", revision: "a".repeat(40), contract_digest: intakeDigest("synthetic-policy") };
  const journalRoot = path.join(root, "journal");
  const journal = createInstanceIntakeJournal({ root: journalRoot, instanceId });
  let committed = null, writes = 0, custodyOffline = false;
  const requested = { kind: "repo", repo_class: "product-source", requires_security_bindings: false, security_owner: null,
    notes: "Synthetic source-only project", validation_behavior: { posture: "covered-by-owner-repo", wgcf_graph_role: "product-runtime-source", catalog_refs: [], notes: "Owner controls, no runtime grant." } };
  const reader = {
    prepare: async () => ({ schema_version: 1, canonical_authority: { kind: "internal-instance-record", instance_id: instanceId, record_id: target.record_id },
      policy_ref: policy, expected_state: { record_version: null, record_digest: null }, current: null }),
    resolve: async () => committed,
  };
  const service = createInstanceIntakeService({ instanceId, journal, reader,
    clock: () => new Date("2026-11-04T00:02:00.000Z"),
    custodySourceReader: async (id, { callerId: caller }) => {
      if (custodyOffline) throw new HttpError(503, "custody_unavailable", "Synthetic disconnected custody dependency");
      assert.equal(id, connection.request_id); assert.equal(caller, callerId);
      return custody.project(id);
    },
    writer: { accept: async (_name, input) => {
      writes++;
      // Test double for the already separately proven native WGCF policy/store;
      // no provider, live canonical record or public source is touched.
      committed = { record: { phase: "intake", status: input.request.requested_classification },
        receipt: { receipt_digest: intakeDigest({ accepted: input.request.request_digest }), version: 1 } };
      if (loseAcknowledgement) throw new HttpError(503, "instance_records_unavailable", "Synthetic lost reply after commit");
      return committed;
    } },
  });
  const preparation = await service.prepare({ callerId, input: { target: { kind: "repo", name: target.name },
    repository_custody: { request_id: connection.request_id, requested_record: requested } } });
  const request = { schema_version: 1, artifact_type: "instance-repository-intake-request", instance_id: instanceId,
    custody_request_id: connection.request_id, request_id: "instance-intake:synthetic", requested_at: "2026-11-04T00:00:00.000Z",
    requester_ref: callerId, source: preparation.source_candidate.source, target,
    action: "add", requested_classification: "proposed", owner_route: "workspace-governance",
    requested_record: preparation.source_candidate.requested_record, expected_state: preparation.expected_state,
    policy_ref: preparation.policy_ref, idempotency_key: "instance-intake:synthetic:v1" };
  request.request_digest = intakeDigest(request);
  const decision = bindIntake({ schema_version: 2, artifact_type: "workspace-intake-decision", decision_id: "instance-decision:synthetic",
    decided_at: "2026-11-04T00:01:00.000Z", request_ref: { id: request.request_id, digest: request.request_digest }, target,
    decision_source: "operator", operator_acceptance: { state: "accepted", operator_ref: callerId, recorded_at: "2026-11-04T00:01:00.000Z" },
    outcome: { status: "allowed", classification: "proposed", owner_route: request.owner_route, approved_record: request.requested_record, findings: [] } }, "decision_digest");
  const command = { authority_revision: policy.revision, request, decision,
    session_ref: "console://instance-intake/synthetic", execution_ref: "console://instance-intake/synthetic/execution" };
  return { root, journalRoot, journal, service, command, target, connection, reader, preparation, custodyResult: await custody.project(connection.request_id),
    writes: () => writes, disconnectCustody: () => { custodyOffline = true; } };
}

test("Native registration retains an accepted request before any canonical write", async t => {
  const h = await harness(t);
  const accepted = await h.service.submit({ callerId, input: h.command });
  assert.equal(accepted.status, "accepted"); assert.equal(accepted.canonical_mutation, false);
  assert.equal(accepted.cancel_allowed, true); assert.equal(h.writes(), 0);
  const complete = await h.service.advance({ callerId, requestId: h.command.request.request_id });
  assert.equal(complete.status, "succeeded"); assert.equal(complete.canonical_mutation, true);
  assert.equal(complete.review, null); assert.equal(h.writes(), 1);
  assert.equal((await h.service.project(h.command.request.request_id, { callerId })).receipt.receipt_digest, complete.receipt.receipt_digest);
});

test("Lost commit acknowledgement recovers original result before unavailable source dependencies", async t => {
  const h = await harness(t, { loseAcknowledgement: true });
  await h.service.submit({ callerId, input: h.command });
  const uncertain = await h.service.advance({ callerId, requestId: h.command.request.request_id });
  assert.equal(uncertain.status, "preparing"); assert.equal(uncertain.cancel_allowed, false);
  assert.equal(uncertain.failure.retryable, true); assert.equal(h.writes(), 1);
  await assert.rejects(h.service.advance({ callerId, requestId: h.command.request.request_id, action: "cancel" }), /Resolve the original/);
  h.disconnectCustody();
  const recovered = await h.service.advance({ callerId, requestId: h.command.request.request_id });
  assert.equal(recovered.status, "succeeded"); assert.equal(h.writes(), 1);
});

test("Unattempted registration cancels without changing canonical data", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId, input: h.command });
  const cancelled = await h.service.advance({ callerId, requestId: h.command.request.request_id, action: "cancel" });
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.canonical_mutation, false); assert.equal(h.writes(), 0);
});

test("Caller, accepted input and installation remain immutable across retries", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId, input: h.command });
  await assert.rejects(h.service.project(h.command.request.request_id, { callerId: "other" }), { statusCode: 404 });
  const changed = structuredClone(h.command);
  changed.session_ref = "console://different-session";
  await assert.rejects(h.service.submit({ callerId, input: changed }), /different reviewed input/);
  const foreign = structuredClone(h.command);
  foreign.request.instance_id = "installation-b";
  await assert.rejects(h.service.submit({ callerId, input: foreign }), /installation/);
  assert.equal(h.writes(), 0);
});

test("Target discovery repairs a missing request locator using the actual complete record", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId, input: h.command });
  const locators = await readdir(path.join(h.journalRoot, "requests"));
  await unlink(path.join(h.journalRoot, "requests", locators[0]));
  const discovered = h.journal.list({ callerId, target: h.target });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].request.request_digest, h.command.request.request_digest);
  assert.equal((await readdir(path.join(h.journalRoot, "requests"))).length, 1);
  assert.equal(h.journal.get(h.command.request.request_id).request.request_digest, h.command.request.request_digest);
});

test("Corrupt request data is unavailable, never recreated as an empty registration", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId, input: h.command });
  const targets = await readdir(path.join(h.journalRoot, "targets"));
  const directory = path.join(h.journalRoot, "targets", targets[0]);
  const records = await readdir(directory);
  await writeFile(path.join(directory, records[0]), "null\n");
  assert.throws(() => h.journal.get(h.command.request.request_id), /invalid/);
  await assert.rejects(h.service.submit({ callerId, input: h.command }), /invalid/);
  assert.equal(h.writes(), 0);
});


test("Source setup resolves native authority against actual custody and cannot fall back on failure", async t => {
  const h = await harness(t), request = h.command.request;
  const authority = { ...h.preparation.canonical_authority };
  const proof = { schema_version: 1, canonical_authority: authority, owner_repo: h.target.name,
    classification: "proposed", inventory_posture: null,
    intake_entry_ref: { id: h.target.record_id, version: 1, digest: intakeDigest("synthetic-native-record") },
    provider_repository: request.requested_record.provider_repository, owner_purpose: request.requested_record.notes,
    validation_behavior: request.requested_record.validation_behavior, source_bootstrap_eligible: true, ordinary_source_eligible: false,
    model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
  let legacyReads = 0;
  const legacy = { proposedSourceOwner: async () => { legacyReads++; return { authority_revision: "a".repeat(40) }; } };
  const args = { target: h.target, custodyResult: h.custodyResult };
  const reader = { sourceAuthority: async (name, operation) => {
    assert.equal(name, h.target.name); assert.equal(operation, "bootstrap");
    return { schema_version: 1, canonical_authority: authority, source_authority: proof };
  } };
  const native = await createInstanceSourceOwnerClient({ reader, legacy }).proposedSourceOwner(args);
  assert.equal(native.intake_entry_ref.digest, proof.intake_entry_ref.digest);
  assert.equal(native.custody_receipt_digest, h.custodyResult.receipt.integrity.content_digest);
  assert.equal(native.ordinary_source_eligible, false); assert.equal(legacyReads, 0);
  const offline = { sourceAuthority: async () => { throw new HttpError(503, "offline", "Synthetic unavailable source authority"); } };
  await assert.rejects(createInstanceSourceOwnerClient({ reader: offline, legacy }).proposedSourceOwner(args), { statusCode: 503 });
  await assert.rejects(createInstanceSourceOwnerClient({ reader, legacy, enabled: false }).proposedSourceOwner(args), { statusCode: 503 });
  const wrong = { sourceAuthority: async () => ({ schema_version: 1, canonical_authority: authority,
    source_authority: { ...proof, provider_repository: { ...proof.provider_repository, provider_repository_id: "999" } } }) };
  await assert.rejects(createInstanceSourceOwnerClient({ reader: wrong, legacy }).proposedSourceOwner(args), /differs/);
  assert.equal(legacyReads, 0);
  const old = { sourceAuthority: async () => ({ canonical_authority: { kind: "legacy-git", revision: "a".repeat(40) } }) };
  await createInstanceSourceOwnerClient({ reader: old, legacy }).proposedSourceOwner(args);
  assert.equal(legacyReads, 1);
});


test("An older backend's missing readback route is a dependency failure, never a reason to replace the original registration", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId, input: h.command });
  h.reader.resolve = async () => { throw new HttpError(404, "instance_records_not_found", "Synthetic older API route unavailable"); };
  const result = await h.service.advance({ callerId, requestId: h.command.request.request_id });
  assert.equal(result.status, "accepted"); assert.equal(result.failure.retryable, true);
  assert.equal(result.next_action, "restore-dependency-and-retry"); assert.equal(h.writes(), 0);
});
