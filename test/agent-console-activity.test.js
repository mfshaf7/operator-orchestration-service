import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentConsoleStore } from "../src/agent-console/store.js";
import { createAgentConsoleService } from "../src/agent-console/service.js";
import { activityMetadata } from "../src/agent-console/activity.js";

const identity = { callerId: "console-caller", operatorId: "operator-1" };
const now = () => new Date("2026-10-31T12:00:00Z");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oos-ai-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createAgentConsoleStore({ root });
  const make = () => createAgentConsoleService({ clock: now, store, operatorBindings: { "console-caller": "operator-1", "other-caller": "operator-2" } });
  return { root, store, service: make(), make };
}
function legacySession(caller = "console-caller", operator = "operator-1", count = 21) {
  return { caller_id: caller, request: { session_id: `${caller}-session`, operator_id: operator },
    invocations: Object.fromEntries(Array.from({ length: count }, (_, index) => [`invocation-${index}`, {
      invocation_id: `invocation-${index}`, requested_at: new Date(Date.UTC(2026, 9, 31, 10, index)).toISOString(),
      completed_at: new Date(Date.UTC(2026, 9, 31, 10, index, 1)).toISOString(), state: "completed",
      receipt_ref: { uri: `oos://agent-console/receipts/${index}`, digest: `sha256:${"a".repeat(64)}` },
      result: { text: "PRIVATE RESULT MUST NEVER ENTER HISTORY" }, failure: null,
      model: { audit_ref: "audit:retained" }, context: { projection_receipt_ref: "cgg:retained" },
    }])) };
}

test("history is read-only, caller/operator isolated, paged and excludes stored result bodies", async t => {
  const { root, store, service } = await fixture(t);
  await store.transact(state => { state.sessions.one = legacySession(); state.sessions.other = legacySession("other-caller", "operator-2", 5); });
  const before = await readFile(path.join(root, "state.json"), "utf8"), beforeStat = await stat(path.join(root, "state.json"));
  const first = await service.listActivity({ ...identity, limit: 10 });
  assert.equal(first.items.length, 10); assert.ok(first.next_cursor);
  assert.equal(first.items[0].kind, null); assert.equal(first.items[0].subject_ref, null);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE RESULT|other-caller/);
  const second = await service.listActivity({ ...identity, limit: 10, cursor: first.next_cursor });
  const third = await service.listActivity({ ...identity, limit: 10, cursor: second.next_cursor });
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(row => row.id)).size, 21);
  assert.equal(third.next_cursor, null);
  await assert.rejects(service.listActivity({ callerId: "console-caller", operatorId: "operator-2" }), error => error.statusCode === 403);
  await assert.rejects(service.listActivity({ callerId: "other-caller", operatorId: "operator-2", cursor: first.next_cursor }), /cursor/);
  for (const limit of [0, 51, -1, 2.5]) await assert.rejects(service.listActivity({ ...identity, limit }));
  assert.equal(await readFile(path.join(root, "state.json"), "utf8"), before);
  assert.equal((await stat(path.join(root, "state.json"))).mtimeMs, beforeStat.mtimeMs);
});

test("native advice records real running and terminal outcomes; restart leaves completion unconfirmed", async t => {
  const { service, make } = await fixture(t);
  let release;
  const pending = service.trackAdvice({ ...identity, source: "work-design", kind: "work-design-context", subjectRef: "delivery-package:1400", invoke: () => new Promise(resolve => { release = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const running = await service.listActivity(identity);
  assert.equal(running.items[0].state, "working");
  assert.equal((await make().listActivity(identity)).items[0].state, "interrupted");
  release({ evidence: { gateway_audit_ref: "audit:actual", cgg_packet_ref: "cgg:actual" }, output: "PRIVATE NATIVE OUTPUT" });
  await pending;
  const restored = await make().listActivity(identity);
  assert.equal(restored.items[0].state, "completed"); assert.equal(restored.items[0].audit_ref, "audit:actual");
  assert.equal(restored.items[0].receipt_ref, null); assert.doesNotMatch(JSON.stringify(restored), /PRIVATE NATIVE OUTPUT/);
});

test("native failed and cancelled attempts retain safe outcomes without error text or retries", async t => {
  const { service } = await fixture(t); let calls = 0;
  for (const cancelled of [false, true]) {
    await assert.rejects(service.trackAdvice({ ...identity, source: "refinement", kind: "refinement-metadata", subjectRef: "delivery-package:1400", invoke: async () => {
      calls += 1; throw Object.assign(Error("PRIVATE ERROR TOKEN"), { code: "provider_unavailable", name: cancelled ? "AbortError" : "Error" });
    } }));
  }
  const page = await service.listActivity(identity);
  assert.deepEqual(new Set(page.items.map(row => row.state)), new Set(["failed", "cancelled"]));
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE ERROR TOKEN/); assert.equal(calls, 2);
});

test("activity metadata accepts only closed task kinds and bounded record identities", () => {
  for (const subject_ref of ["/private/operator/file", "https://external.example", "sk-secret-value", "a\nb", "a".repeat(300)]) {
    assert.throws(() => activityMetadata({ kind: "proposal-triage", subject_ref }, "runtime"));
  }
  assert.throws(() => activityMetadata({ kind: "run-command", subject_ref: "idea-2" }, "runtime"));
  assert.throws(() => activityMetadata({ kind: "proposal-triage", subject_ref: "idea-2", prompt: "private" }, "runtime"));
});

test("unchanged history avoids repeated private-state parsing and writes invalidate its bounded page cache", async t => {
  const { store, service } = await fixture(t);
  await store.transact(state => { state.sessions.one = legacySession(); });
  let reads = 0; const inspect = store.inspect;
  store.inspect = (...args) => { reads += 1; return inspect(...args); };
  await service.listActivity(identity); await service.listActivity(identity);
  assert.equal(reads, 1);
  await service.trackAdvice({ ...identity, source: "work-design", kind: "work-design-tree", subjectRef: "delivery-package:1400", invoke: async () => ({ evidence: { gateway_audit_ref: "audit:changed" } }) });
  const page = await service.listActivity(identity);
  assert.equal(reads, 2); assert.equal(page.items[0].kind, "work-design-tree");
});
