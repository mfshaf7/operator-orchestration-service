import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceIntakeFacade } from "../src/instance-records/intake-facade.js";

function harness({ enabled = true } = {}) {
  const old = new Map(), current = new Map(), calls = [];
  const target = { kind: "repo", name: "synthetic-project", record_id: "repo:synthetic-project" };
  const legacy = { prepare: async () => { calls.push("legacy.prepare"); return { legacy: true }; },
    submit: async () => { calls.push("legacy.submit"); return { legacy: true }; },
    project: async () => { calls.push("legacy.project"); return { legacy: true }; },
    advance: async () => { calls.push("legacy.advance"); return { legacy: true }; },
    attest: async () => ({ legacy: true }),
    list: async () => ({ schema_version: 1, workflow_id: "workspace-intake", target,
      custody_request_id: "custody-one", revision: 0, records: [], next_cursor: null }) };
  const native = { prepare: async () => { calls.push("native.prepare"); return { canonical_authority: { kind: "internal-instance-record" } }; },
    submit: async () => { calls.push("native.submit"); return { native: true }; },
    project: async () => { calls.push("native.project"); return { native: true }; },
    advance: async () => { calls.push("native.advance"); return { native: true }; },
    projectRecords: async () => [] };
  const reader = { prepare: async () => ({ canonical_authority: { kind: "internal-instance-record" } }) };
  const facade = createInstanceIntakeFacade({ legacy, native, reader, enabled,
    legacyStore: { get: async id => old.get(id) ?? null, list: async () => [...old.values()] },
    journal: { get: id => current.get(id) ?? null, withRequestLock: (_id, operation) => operation() } });
  const args = { callerId: "operator:test", input: { target: { kind: "repo", name: target.name },
    repository_custody: { request_id: "custody-one", requested_record: { kind: "repo" } } } };
  return { facade, legacy, native, reader, old, current, calls, args, target };
}

test("Custody-backed new projects prepare internal authority; explicit legacy proof preserves original route", async () => {
  const h = harness();
  assert.equal((await h.facade.prepare(h.args)).canonical_authority.kind, "internal-instance-record");
  h.native.prepare = async () => ({ canonical_authority: { kind: "legacy-git" } });
  assert.equal((await h.facade.prepare(h.args)).legacy, true);
  assert.ok(h.calls.includes("legacy.prepare"));
});

test("Backend unavailability cannot silently select public source authority", async () => {
  const h = harness();
  h.native.prepare = async () => { throw new Error("synthetic backend unavailable"); };
  await assert.rejects(h.facade.prepare(h.args), /backend unavailable/);
  assert.equal(h.calls.includes("legacy.prepare"), false);
});

test("Old pending source requests retain their exact route even before source merge", async () => {
  const h = harness();
  h.old.set("original", { caller_id: h.args.callerId, request: { target: h.target }, status: "review-required" });
  assert.equal((await h.facade.prepare(h.args)).legacy, true);
  assert.equal((await h.facade.advance({ callerId: h.args.callerId, requestId: "original" })).legacy, true);
  assert.equal(h.calls.includes("native.prepare"), false);
});

test("Stale new source-backed submission cannot bypass internal registration", async () => {
  const h = harness();
  await assert.rejects(h.facade.submit({ callerId: h.args.callerId, input: { request: { request_id: "new-source-request",
    artifact_type: "workspace-intake-request", target: h.target, source: { class: "repository-custody" } } } }), /internal registration/);
  assert.equal(h.calls.includes("legacy.submit"), false);
});

test("Same saved request identity cannot be claimed by both authorities", async () => {
  const h = harness();
  h.old.set("overlap", { old: true }); h.current.set("overlap", { current: true });
  await assert.rejects(h.facade.project("overlap", { callerId: h.args.callerId }), /two authorities/);
});

test("Combined history pagination retains both source and internal records without duplicates", async () => {
  const h = harness();
  const entry = index => ({ request_id: `request-${String(index).padStart(2, "0")}`, requested_at: new Date(Date.UTC(2026, 10, 4, 0, index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 10, 4, 0, index)).toISOString(), status: "succeeded", revision: 1, classification: "proposed", candidate: {} });
  h.legacy.list = async () => ({ revision: 1, records: [entry(0)], next_cursor: null });
  h.native.projectRecords = async () => Array.from({ length: 26 }, (_, index) => entry(index + 1));
  const input = { target: { kind: "repo", name: h.target.name }, custody_request_id: "custody-one" };
  const first = await h.facade.list({ callerId: h.args.callerId, input });
  assert.equal(first.records.length, 25); assert.equal(first.revision, 27);
  const second = await h.facade.list({ callerId: h.args.callerId, input: { ...input, cursor: first.next_cursor } });
  assert.equal(second.records.length, 2); assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.records, ...second.records].map(record => record.request_id)).size, 27);
});


test("Disabling internal writes cannot route an existing internal identity back into public Git", async () => {
  const h = harness({ enabled: false });
  h.native.prepare = async () => { throw new Error("synthetic internal writes disabled"); };
  await assert.rejects(h.facade.prepare(h.args), /writes disabled/);
  assert.equal(h.calls.includes("legacy.prepare"), false);
  await assert.rejects(h.facade.submit({ callerId: h.args.callerId, input: { request: { artifact_type: "instance-repository-intake-request" } } }), { statusCode: 503 });
  for (const requestId of ["source-new", "source-" + "x".repeat(256)]) {
    await assert.rejects(h.facade.submit({ callerId: h.args.callerId, input: { request: { request_id: requestId,
      artifact_type: "workspace-intake-request", target: h.target, source: { class: "repository-custody" } } } }), /internal registration/);
  }
  assert.equal(h.calls.includes("legacy.submit"), false);
});
