import assert from "node:assert/strict";
import { mkdtemp, access, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createRepositoryCustodyService } from "../src/repository-custody/service.js";
import { createRepositoryCustodyStore } from "../src/repository-custody/store.js";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";
import { bindIntake, intakeReference } from "../src/workspace-intake/contracts.js";
import { custodyRequest, custodyDecision, providerReadback, TEST_CLOCK } from "../test-fixtures/repository-custody.js";
import { caller, inputFixture } from "../test-fixtures/workspace-intake/fixture.js";

const record = { kind: "repo", repo_class: "product", requires_security_bindings: false,
  security_owner: null, notes: "Operator-proposed synthetic source owner." };
const target = { kind: "repo", name: "example-repository" };

async function harness(t, { sourceAvailable = true, outcome = "allowed" } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "intake-custody-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const request = custodyRequest();
  const custody = createRepositoryCustodyService({ clock: TEST_CLOCK,
    store: createRepositoryCustodyStore({ root: path.join(root, "custody") }),
    readinessClient: { evaluate: async () => {
      const decision = custodyDecision(request, outcome === "allowed" ? {} : {
        outcome, resolved_identity: null, obligations: [], next_action: "stop",
        findings: [{ code: "synthetic-denial", severity: "blocking", summary: "Synthetic custody denied." }],
      });
      return { decision, decisionRef: { uri: "wgcf://decisions/repository-custody/synthetic.json",
        digest: decision.integrity.content_digest } };
    } }, providerClient: { read: async (input) => providerReadback(input) },
  });
  await custody.execute({ callerId: caller, input: request });
  const state = inputFixture().request.expected_state;
  const store = createWorkspaceIntakeStore({ root: path.join(root, "intake") });
  const options = { clock: TEST_CLOCK, store,
    custodySourceReader: sourceAvailable ? (id) => custody.project(id) : null,
    sourceClient: { state: async (selected) => ({ authority_revision: "1".repeat(40),
      target: { ...selected, record_id: `${selected.kind}:${selected.name}` }, expected_state: state }) },
  };
  return { root, request, store, service: createWorkspaceIntakeService(options),
    reopen: () => createWorkspaceIntakeService({ ...options,
      store: createWorkspaceIntakeStore({ root: path.join(root, "intake") }) }) };
}

function submission(preparation) {
  const input = inputFixture();
  const candidate = preparation.source_candidate;
  input.request = bindIntake({ ...input.request, source: candidate.source,
    target: candidate.target, requested_record: candidate.requested_record,
    requested_classification: "proposed" }, "request_digest");
  input.decision = bindIntake({ ...input.decision, target: candidate.target,
    request_ref: intakeReference(input.request, "request"), outcome: { ...input.decision.outcome,
      classification: "proposed", approved_record: candidate.requested_record } }, "decision_digest");
  return input;
}

test("canonical custody prepares exact provider source without mutation; explicit submit retains owner attestation", async (t) => {
  const h = await harness(t);
  const preparation = await h.service.prepare({ callerId: caller,
    input: { target, repository_custody: { request_id: h.request.request_id, requested_record: record } } });
  const candidate = preparation.source_candidate;
  assert.equal(preparation.canonical_mutation, false);
  assert.deepEqual(candidate.requested_record.provider_repository, { provider: "github",
    provider_repository_id: "123456789", full_name: "example-owner/example-repository" });
  assert.equal(candidate.source.class, "repository-custody");
  await assert.rejects(access(path.join(h.root, "intake", "state.json")), { code: "ENOENT" });
  const input = submission(preparation);
  const acknowledged = await h.service.submit({ callerId: caller, input });
  assert.equal(acknowledged.status, "accepted");
  assert.equal(acknowledged.canonical_mutation, false);
  assert.equal(acknowledged.source_attestation.attested_by, "operator-orchestration-service");
  assert.equal(acknowledged.source_attestation.candidate_digest, candidate.candidate_digest);
  assert.deepEqual(await h.reopen().submit({ callerId: caller, input }), acknowledged);
  assert.equal((await h.store.getCandidate(candidate.source.ref)).candidate.candidate_digest, candidate.candidate_digest);
  // A Console caller cannot bypass the source reader by claiming OOS ownership.
  await assert.rejects(h.service.attest({ callerId: "governance-operations-console", input: candidate }), /authenticated owner caller/);
});

test("custody source preparation denies missing owner, failed custody, target substitution and provider substitution", async (t) => {
  for (const mode of ["unavailable", "denied", "wrong-target", "wrong-provider", "extra-field"]) {
    const h = await harness(t, { sourceAvailable: mode !== "unavailable", outcome: mode === "denied" ? "denied" : "allowed" });
    const input = { target: mode === "wrong-target" ? { kind: "repo", name: "another-owner" } : target,
      repository_custody: { request_id: h.request.request_id, requested_record: structuredClone(record) } };
    if (mode === "wrong-provider") input.repository_custody.requested_record.provider_repository = {
      provider: "github", provider_repository_id: "987654321", full_name: "other-owner/another-repo" };
    if (mode === "extra-field") input.repository_custody.token = "not-authority";
    await assert.rejects(h.service.prepare({ callerId: caller, input }));
    await assert.rejects(access(path.join(h.root, "intake", "state.json")), { code: "ENOENT" });
  }
});

test("custody-backed submit rereads actual source and rejects altered metadata/provenance before acknowledgement", async (t) => {
  for (const mode of ["metadata", "source-digest", "source-reference", "provider"]) {
    const h = await harness(t);
    const preparation = await h.service.prepare({ callerId: caller,
      input: { target, repository_custody: { request_id: h.request.request_id, requested_record: record } } });
    const input = submission(preparation);
    if (mode === "metadata") input.request.requested_record.notes = "Substituted after preparation";
    if (mode === "source-digest") input.request.source.digest = "sha256:" + "0".repeat(64);
    if (mode === "source-reference") input.request.source.ref = input.request.source.ref.replace(/.$/, "z");
    if (mode === "provider") input.request.requested_record.provider_repository.provider_repository_id = "987654321";
    input.request = bindIntake(input.request, "request_digest");
    input.decision = bindIntake({ ...input.decision, request_ref: intakeReference(input.request, "request"),
      outcome: { ...input.decision.outcome, approved_record: input.request.requested_record } }, "decision_digest");
    await assert.rejects(h.service.submit({ callerId: caller, input }));
    assert.equal(await h.store.get(input.request.request_id), null);
    assert.equal(await h.store.getCandidate(preparation.source_candidate.source.ref), null);
  }
});
