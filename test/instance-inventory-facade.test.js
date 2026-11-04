import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceInventoryFacade } from "../src/instance-records/inventory-facade.js";
import { intakeDigest } from "../src/workspace-intake/contracts.js";
import { nativeInventoryInput, target, at, operator } from "../test-fixtures/instance-records.js";

function harness(enabled = true) {
  const calls = [], old = new Map(), current = new Map();
  const legacy = { prepare: async () => { calls.push("legacy.prepare"); return { legacy: true }; },
    submit: async () => { calls.push("legacy.submit"); return { legacy: true }; },
    project: async () => { calls.push("legacy.project"); return { legacy: true }; },
    advance: async () => { calls.push("legacy.advance"); return { legacy: true }; }, list: async () => ({ legacy: true }) };
  const native = { prepare: async () => { calls.push("native.prepare"); return { canonical_authority: { kind: "internal-instance-record" } }; },
    submit: async () => { calls.push("native.submit"); return { native: true }; },
    project: async () => { calls.push("native.project"); return { native: true }; },
    advance: async () => { calls.push("native.advance"); return { native: true }; }, records: async () => [...current.values()] };
  const reader = { prepare: async (_name, { operation }) => { assert.equal(operation, "inventory"); return { canonical_authority: { kind: "internal-instance-record" } }; } };
  const facade = createInstanceInventoryFacade({ legacy, native, reader, enabled, family: "workspace-inventory-promotion",
    legacyStore: { get: async id => old.get(id) ?? null, list: async () => [...old.values()] },
    journal: { get: id => current.get(id) ?? null, withRequestLock: (_id, operation) => operation() } });
  const args = { callerId: operator, input: { target: { kind: "repo", name: target.name } } };
  return { facade, native, legacy, reader, old, current, args, calls };
}

test("Inventory selects internal authority or positive legacy proof and preserves pending source reviews", async () => {
  const h = harness();
  assert.equal((await h.facade.prepare(h.args)).canonical_authority.kind, "internal-instance-record");
  h.native.prepare = async () => ({ canonical_authority: { kind: "legacy-git" } });
  assert.equal((await h.facade.prepare(h.args)).legacy, true);
  h.old.set("source-original", { caller_id: operator, request: { target }, status: "review-required" });
  assert.equal((await h.facade.prepare(h.args)).legacy, true);
  assert.equal((await h.facade.advance({ callerId: operator, requestId: "source-original" })).legacy, true);
  await assert.rejects(h.facade.submit({ callerId: operator, input: { request: nativeInventoryInput().request } }), /original source-backed request/);
});

test("Unavailable or disabled internal inventory cannot be replaced with a public Git mutation", async () => {
  const h = harness(false);
  h.native.prepare = async () => { throw new Error("synthetic internal authority unavailable"); };
  await assert.rejects(h.facade.prepare(h.args), /authority unavailable/);
  assert.equal(h.calls.includes("legacy.prepare"), false);
  for (const requestId of ["new-source", "new-source-" + "x".repeat(256)]) {
    await assert.rejects(h.facade.submit({ callerId: operator, input: { request: { artifact_type: "workspace-inventory-promotion-request", request_id: requestId, target } } }), /internal inventory/);
  }
  assert.equal(h.calls.includes("legacy.submit"), false);
  await assert.rejects(h.facade.submit({ callerId: operator, input: { request: nativeInventoryInput().request } }), { statusCode: 503 });
});

test("Inventory recovery routes exact saved identity and discovery combines both histories without duplication", async () => {
  const h = harness();
  function record(id) {
    const request = { ...nativeInventoryInput().request, request_id: id };
    const evaluation = { request, authority_revision: "a".repeat(40), session_ref: "console://inventory/test", execution_ref: "console://inventory/test/execution" };
    return { caller_id: operator, request, evaluation, binding_digest: intakeDigest({ caller_id: operator, evaluation }), status: "accepted",
      history: [{ sequence: 1, at, status: "accepted", details: null }] };
  }
  h.old.set("source-one", record("source-one")); h.current.set("internal-two", record("internal-two"));
  assert.equal((await h.facade.project("internal-two", { callerId: operator })).native, true);
  const page = await h.facade.list(h.args);
  assert.equal(page.records.length, 2); assert.equal(page.pending_request_count, 2);
  h.current.set("source-one", record("source-one"));
  await assert.rejects(h.facade.project("source-one", { callerId: operator }), /overlapping authorities/);
  await assert.rejects(h.facade.list(h.args), /overlapping request identity/);
});
