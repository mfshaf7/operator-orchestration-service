import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindIntake } from "../src/workspace-intake/contracts.js";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";
import { at, caller, inputFixture, readinessFixture } from "../test-fixtures/workspace-intake/fixture.js";

async function harness(t, { outcome = "allowed", sourceClient = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "intake-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkspaceIntakeStore({ root });
  const options = { clock: () => new Date(at), store, readinessClient: { evaluate: async (input) => readinessFixture(input, outcome) }, sourceClient };
  return { root, store, service: createWorkspaceIntakeService(options), reopen: () => createWorkspaceIntakeService({ ...options, store: createWorkspaceIntakeStore({ root }) }) };
}

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
