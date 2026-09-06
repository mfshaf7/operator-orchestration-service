import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindInventory, createInventoryEvaluation } from "../src/workspace-inventory/contracts.js";
import { createWorkspaceInventoryService } from "../src/workspace-inventory/service.js";
import { createWorkspaceInventoryStore } from "../src/workspace-inventory/store.js";
import {
  at,
  caller,
  inputFixture,
  preparationFixture,
  readinessFixture,
} from "../test-fixtures/workspace-inventory/fixture.js";

async function harness(t, { outcome = "ready", sourceClient = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkspaceInventoryStore({ root });
  const options = {
    clock: () => new Date(at),
    store,
    readinessClient: { evaluate: async (evaluation) => readinessFixture(evaluation, outcome) },
    sourceClient,
  };
  return {
    root,
    store,
    service: createWorkspaceInventoryService(options),
    reopen: () => createWorkspaceInventoryService({ ...options, store: createWorkspaceInventoryStore({ root }) }),
  };
}

test("preparation returns admitted canonical bindings without workflow mutation", async (t) => {
  const input = { target: { kind: "component", name: "inventory-proof" } };
  const sourceState = {
    authority_revision: "1".repeat(40),
    target: { ...input.target, record_id: "component:inventory-proof" },
    intake_register_digest: `sha256:${"2".repeat(64)}`,
    active_inventory_digest: `sha256:${"3".repeat(64)}`,
    intake_entry_version: 2,
    intake_entry_digest: `sha256:${"4".repeat(64)}`,
    active_record_version: null,
    active_record_digest: null,
  };
  const h = await harness(t, { sourceClient: { state: async () => sourceState } });
  const result = await h.service.prepare({ callerId: caller, input });
  assert.equal(result.authority_revision, sourceState.authority_revision);
  assert.equal(result.intake_entry_ref.version, 2);
  assert.equal(result.canonical_authority.inventory_path, "contracts/components.yaml");
  assert.equal(result.canonical_mutation, false);
  assert.equal(await h.store.get("missing"), null);
  await assert.rejects(h.service.prepare({ callerId: caller, input: { ...input, extra: true } }), /exactly one target/);
  await assert.rejects(h.service.prepare({ callerId: caller, input: { target: { kind: "component", name: "Invalid Name" } } }), /valid repository/);
});

test("preparation rejects absent intake and already active targets", async (t) => {
  const base = {
    authority_revision: "1".repeat(40),
    target: { kind: "component", name: "inventory-proof", record_id: "component:inventory-proof" },
    intake_register_digest: `sha256:${"2".repeat(64)}`,
    active_inventory_digest: `sha256:${"3".repeat(64)}`,
    intake_entry_version: null,
    intake_entry_digest: null,
    active_record_version: null,
    active_record_digest: null,
  };
  const absent = await harness(t, { sourceClient: { state: async () => base } });
  await assert.rejects(absent.service.prepare({ callerId: caller, input: { target: { kind: "component", name: "inventory-proof" } } }), /admitted/);
  const active = await harness(t, { sourceClient: { state: async () => ({
    ...base,
    intake_entry_version: 1,
    intake_entry_digest: `sha256:${"4".repeat(64)}`,
    active_record_version: 1,
    active_record_digest: `sha256:${"5".repeat(64)}`,
  }) } });
  await assert.rejects(active.service.prepare({ callerId: caller, input: { target: { kind: "component", name: "inventory-proof" } } }), /lifecycle operation/);
});

test("durable acknowledgement and idempotency reject cross-caller and key reuse", async (t) => {
  const h = await harness(t);
  const input = inputFixture();
  const acknowledgement = await h.service.submit({ callerId: caller, input });
  assert.equal(acknowledgement.status, "accepted");
  assert.equal(acknowledgement.canonical_mutation, false);
  assert.deepEqual(await h.reopen().submit({ callerId: caller, input }), acknowledgement);
  await assert.rejects(h.service.project(input.request.request_id, { callerId: "operator:other" }), /not found/);
  const duplicate = structuredClone(input);
  duplicate.request = bindInventory({ ...duplicate.request, request_id: "inventory-request:other" }, "request_digest");
  await assert.rejects(h.service.submit({ callerId: caller, input: duplicate }), /idempotency/);
});

test("blocked and stale readiness preserve findings without source writes", async (t) => {
  for (const outcome of ["blocked", "stale"]) {
    const h = await harness(t, { outcome, sourceClient: { prepare() { throw new Error("must not run"); } } });
    const input = inputFixture();
    await h.service.submit({ callerId: caller, input });
    const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
    assert.equal(result.status, outcome);
    assert.equal(result.receipt, null);
    assert.equal(result.next_action, outcome === "stale" ? "refresh-and-resubmit" : "submit-corrected-promotion");
    assert.deepEqual(await h.reopen().advance({ callerId: caller, requestId: input.request.request_id }), result);
  }
});

test("reviewed merged readback is the only successful canonical outcome", async (t) => {
  const input = inputFixture();
  const evaluation = createInventoryEvaluation(input, caller);
  const readiness = readinessFixture(evaluation);
  const preparation = preparationFixture(evaluation, readiness);
  let merged = false;
  const review = {
    repository: "workspace-governance",
    number: 42,
    url: "https://example.test/review/42",
    state: "open",
    branch: "inventory/test",
    base_branch: "main",
    base_commit: input.authority_revision,
    head_commit: "2".repeat(40),
    merged: false,
    merge_commit: null,
    human_reviewed: false,
  };
  const h = await harness(t, { sourceClient: {
    prepare: async () => preparation,
    openReview: async () => review,
    observe: async () => merged ? {
      review: { ...review, state: "closed", merged: true, merge_commit: "3".repeat(40), human_reviewed: true },
      readback: bindInventory({ ...preparation.readback, authority_state: "merged-authority", source_branch: "main", readback_id: "workspace-inventory-merged:test" }, "readback_digest"),
    } : { review },
  } });
  await h.service.submit({ callerId: caller, input });
  const waiting = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.canonical_mutation, false);
  assert.equal((await h.reopen().advance({ callerId: caller, requestId: input.request.request_id })).status, "review-required");
  merged = true;
  const result = await h.reopen().advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "succeeded");
  assert.equal(result.receipt.phase, "merged-authority");
  assert.equal(result.receipt.outcome, "succeeded");
  assert.equal(result.canonical_mutation, true);
});

test("cancel and dependency failure remain restart-safe", async (t) => {
  const input = inputFixture();
  const cancelled = await harness(t, { sourceClient: { cancel: async () => null } });
  await cancelled.service.submit({ callerId: caller, input });
  assert.equal((await cancelled.service.advance({ callerId: caller, requestId: input.request.request_id, action: "cancel" })).status, "cancelled");
  assert.equal((await cancelled.reopen().advance({ callerId: caller, requestId: input.request.request_id })).status, "cancelled");

  const failed = await harness(t, { sourceClient: { prepare: async () => { throw new Error("private dependency detail"); } } });
  await failed.service.submit({ callerId: caller, input });
  await assert.rejects(failed.service.advance({ callerId: caller, requestId: input.request.request_id }));
  const projection = await failed.reopen().project(input.request.request_id, { callerId: caller });
  assert.equal(projection.status, "preparing");
  assert.equal(projection.failure.retryable, true);
  assert.ok(!JSON.stringify(projection).includes("private dependency detail"));
  const statePath = path.join(failed.root, "state.json");
  await writeFile(statePath, (await readFile(statePath, "utf8")).replace('"preparing"', '"succeeded"'));
  await assert.rejects(failed.reopen().project(input.request.request_id, { callerId: caller }), /integrity/);
});
