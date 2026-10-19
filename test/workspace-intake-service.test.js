import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindIntake } from "../src/workspace-intake/contracts.js";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";
import { at, caller, inputFixture, readinessFixture } from "../test-fixtures/workspace-intake/fixture.js";

async function harness(t, { outcome = "allowed", sourceClient = {}, sourceOwnerReadinessReader = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "intake-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkspaceIntakeStore({ root });
  const options = { clock: () => new Date(at), store, readinessClient: { evaluate: async (input) => readinessFixture(input, outcome) }, sourceClient, sourceOwnerReadinessReader };
  return { root, store, service: createWorkspaceIntakeService(options), reopen: () => createWorkspaceIntakeService({ ...options, store: createWorkspaceIntakeStore({ root }) }) };
}

function sourceOwnerInput() {
  const input = inputFixture();
  input.request = bindIntake({ ...input.request, target: { kind: "repo", name: "source-owner", record_id: "repo:source-owner" },
    requested_classification: "admitted", requested_record: { kind: "repo", repo_class: "product-source", requires_security_bindings: false,
      security_owner: null, notes: "Synthetic source owner; no app or runtime acceptance.",
      provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: "example-organization/source-owner" },
      validation_behavior: { posture: "covered-by-owner-repo", wgcf_graph_role: "product-runtime-source", catalog_refs: [], notes: "Actual source owner profile required." } } }, "request_digest");
  input.decision = bindIntake({ ...input.decision, request_ref: { id: input.request.request_id, digest: input.request.request_digest }, target: input.request.target,
    outcome: { ...input.decision.outcome, classification: "admitted", approved_record: input.request.requested_record } }, "decision_digest");
  return input;
}
function sourceOwnerProof() {
  return bindIntake({ schema_version: 1, scope: "source-owner-controls-readiness", owner_repo: "source-owner",
    provider_repository: sourceOwnerInput().request.requested_record.provider_repository, fetched_base: "a".repeat(40), canonical_checkout_commit: "b".repeat(40),
    evidence_profile_digest: `sha256:${"c".repeat(64)}`, source_request_ref: "oos://repository-owner-bootstrap/requests/bootstrap-request%3Asource-owner",
    source_request_revision: at, app_acceptance: false, inventory_admission: false, runtime_activation: false }, "receipt_digest");
}

test("source-only admission requires actual current owner-control proof before acknowledging a new request, without treating it as application acceptance", async t => {
  const input = sourceOwnerInput(), missing = await harness(t);
  await assert.rejects(missing.service.submit({ callerId: caller, input }), { code: "workspace_intake_source_owner_readiness_unavailable" });
  assert.equal(await missing.store.get(input.request.request_id), null);
  const calls = [];
  const h = await harness(t, { sourceOwnerReadinessReader: async value => { calls.push(value); return sourceOwnerProof(); } });
  const admitted = await h.service.submit({ callerId: caller, input });
  assert.equal(admitted.status, "accepted"); assert.equal(admitted.canonical_mutation, false);
  assert.deepEqual(calls, [{ callerId: caller, ownerRepo: "source-owner", providerRepository: input.request.requested_record.provider_repository }]);
  assert.deepEqual((await h.store.get(input.request.request_id)).source_owner_readiness, sourceOwnerProof());
  assert.deepEqual(await h.reopen().submit({ callerId: caller, input }), admitted);
  assert.equal(calls.length, 1, "Acknowledgement recovery must not fabricate a new readiness request");
});

test("forged, cross-owner or app-acceptance readiness cannot satisfy source-only classification", async t => {
  for (const mutate of [
    value => { value.owner_repo = "foreign-owner"; }, value => { value.provider_repository.provider_repository_id = "42"; },
    value => { value.app_acceptance = true; }, value => { value.inventory_admission = true; },
    value => { value.evidence_profile_digest = `sha256:${"d".repeat(64)}`; },
  ]) {
    const proof = sourceOwnerProof(); mutate(proof);
    const h = await harness(t, { sourceOwnerReadinessReader: async () => proof });
    await assert.rejects(h.service.submit({ callerId: caller, input: sourceOwnerInput() }), { code: "workspace_intake_source_owner_readiness_invalid" });
    assert.equal(await h.store.get("request:test"), null);
  }
});

test("preparation returns current canonical bindings without workflow state mutation", async (t) => {
  const input = { target: { kind: "product", name: "intake-proof" } };
  const state = {
    authority_revision: "1".repeat(40),
    target: { ...input.target, record_id: "product:intake-proof" },
    expected_state: {
      register_digest: `sha256:${"2".repeat(64)}`,
      record_version: null,
      record_digest: null,
    },
  };
  const h = await harness(t, { sourceClient: { state: async (target) => {
    assert.deepEqual(target, input.target);
    return state;
  } } });
  const result = await h.service.prepare({ callerId: caller, input });
  assert.equal(result.authority_revision, state.authority_revision);
  assert.deepEqual(result.expected_state, state.expected_state);
  assert.equal(result.canonical_mutation, false);
  assert.equal(await h.store.get("request:missing"), null);
  await assert.rejects(h.service.prepare({ callerId: caller, input: { ...input, decision: {} } }), /exactly one target/);
  await assert.rejects(h.service.prepare({ callerId: caller, input: { target: { kind: "product", name: "Invalid Name" } } }), /valid repository/);
});

test("preparation rejects malformed authority state", async (t) => {
  const h = await harness(t, { sourceClient: { state: async () => ({
    authority_revision: "not-a-commit",
    target: { kind: "product", name: "intake-proof", record_id: "product:intake-proof" },
    expected_state: { register_digest: `sha256:${"2".repeat(64)}`, record_version: null, record_digest: null },
  }) } });
  await assert.rejects(
    h.service.prepare({ callerId: caller, input: { target: { kind: "product", name: "intake-proof" } } }),
    /invalid preparation state/,
  );
});

test("durable acknowledgement and idempotency reject cross-caller, key and session reuse", async (t) => {
  const h = await harness(t);
  const input = inputFixture();
  const ack = await h.service.submit({ callerId: caller, input });
  assert.equal(ack.status, "accepted");
  assert.equal(ack.canonical_mutation, false);
  assert.deepEqual(await h.reopen().submit({ callerId: caller, input }), ack);
  await assert.rejects(h.service.project(input.request.request_id, { callerId: "operator:other" }), /not found/);
  await assert.rejects(h.service.submit({ callerId: caller, input: { ...input, session_ref: "other" } }), /identity/);
  const duplicate = structuredClone(input);
  duplicate.request = bindIntake({ ...duplicate.request, request_id: "request:other" }, "request_digest");
  duplicate.decision = bindIntake({ ...duplicate.decision, request_ref: { id: duplicate.request.request_id, digest: duplicate.request.request_digest } }, "decision_digest");
  await assert.rejects(h.service.submit({ callerId: caller, input: duplicate }), /idempotency/);
});

test("denied and requires-action decisions preserve findings without source writes", async (t) => {
  for (const outcome of ["denied", "requires-action"]) {
    const h = await harness(t, { outcome, sourceClient: { prepare() { throw new Error("must not run"); } } });
    const input = inputFixture();
    await h.service.submit({ callerId: caller, input });
    const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
    assert.equal(result.status, outcome === "denied" ? "rejected" : "requires-action");
    assert.equal(result.receipt, null);
    assert.deepEqual(await h.reopen().advance({ callerId: caller, requestId: input.request.request_id }), result);
  }
});

test("cancel is durable and preserves original request without preparing source", async (t) => {
  const h = await harness(t, { sourceClient: { cancel: async () => null } });
  const input = inputFixture();
  await h.service.submit({ callerId: caller, input });
  const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id, action: "cancel" });
  assert.equal(result.status, "cancelled");
  assert.equal(result.canonical_mutation, false);
  assert.equal((await h.reopen().advance({ callerId: caller, requestId: input.request.request_id })).status, "cancelled");
});

test("dependency errors retain retry phase and corrupt state fails closed", async (t) => {
  const h = await harness(t, { sourceClient: { prepare: async () => { throw new Error("private dependency detail"); } } });
  const input = inputFixture();
  await h.service.submit({ callerId: caller, input });
  await assert.rejects(h.service.advance({ callerId: caller, requestId: input.request.request_id }));
  const result = await h.reopen().project(input.request.request_id, { callerId: caller });
  assert.equal(result.status, "preparing");
  assert.equal(result.failure.retryable, true);
  assert.ok(!JSON.stringify(result).includes("private dependency detail"));
  const file = path.join(h.root, "state.json");
  await writeFile(file, (await readFile(file, "utf8")).replace('"preparing"', '"succeeded"'));
  await assert.rejects(h.reopen().project(input.request.request_id, { callerId: caller }), /integrity/);
});
