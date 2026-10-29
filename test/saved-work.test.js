import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSavedWorkStore } from "../src/saved-work/store.js";

const identity = { callerId: "console", operatorId: "operator:test", kind: "work-design", subjectId: "delivery-42" };
const draft = () => ({ schemaVersion: 2, packageId: identity.subjectId, context: {
  current: { note: "A real editable diagram", snapshot: { positions: { node: { x: 1.25, y: -3.75 } }, sketchStrokes: [] } }, sessions: [] }, briefVersions: [] });
function setup(t) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-saved-work-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createSavedWorkStore({ root }) };
}
const command = (value = draft(), revision = 0, commandId = "save-1") => ({ command_id: commandId,
  expected_revision: revision, payload_json: JSON.stringify(value), origin: "operator-edit" });

test("all three saved-work kinds recover exact content after store restart", async t => {
  const { root, store } = setup(t);
  const cases = [[identity, draft()], [{ ...identity, kind: "refinement" }, { schemaVersion: 1, packageId: identity.subjectId, metadata: { draftValues: { owner: "edited" } } }],
    [{ ...identity, kind: "orchestration", subjectId: "definition:42" }, { schemaVersion: 1, draftId: "definition:42", executionPlan: { nodes: [] } }]];
  for (const [id, value] of cases) {
    const input = command(value); const saved = await store.save(id, input);
    const restored = createSavedWorkStore({ root }).read(id);
    assert.deepEqual(restored, saved); assert.equal(restored.record.payload_json, input.payload_json);
    assert.equal(restored.record.revision, 1);
  }
});
test("save acknowledgement retries are exact and conflicting reuse fails", async t => {
  const { store } = setup(t); const input = command();
  const first = await store.save(identity, input); assert.deepEqual(await store.save(identity, input), first);
  await assert.rejects(store.save(identity, { ...input, payload_json: JSON.stringify({ ...draft(), note: "different" }) }), { code: "saved_work_replay_conflict" });
});
test("another tab cannot overwrite an acknowledged revision", async t => {
  const { store } = setup(t); await store.save(identity, command());
  await assert.rejects(store.save(identity, command(draft(), 0, "other-tab")), { code: "saved_work_revision_conflict" });
  const next = await store.save(identity, command({ ...draft(), note: "next" }, 1, "save-2")); assert.equal(next.record.revision, 2);
});
test("finalized brief bytes cannot change or disappear in later drafts", async t => {
  const { store } = setup(t); const value = { ...draft(), briefVersions: [{ briefVersionId: "brief-1", text: "Final", snapshot: { x: 12.5 } }] };
  await store.save(identity, command(value));
  await assert.rejects(store.save(identity, command(draft(), 1, "remove")), { code: "saved_work_finalized_immutable" });
  await assert.rejects(store.save(identity, command({ ...value, briefVersions: [{ ...value.briefVersions[0], text: "changed" }] }, 1, "change")), { code: "saved_work_finalized_immutable" });
  await store.save(identity, command({ ...value, note: "new editable draft" }, 1, "next"));
});
test("raw old and malformed browser records are preserved independently and idempotently", async t => {
  const { root, store } = setup(t);
  const raw = { storage_key: "delivery-work-design-session:delivery-42:v1", raw_value: "{incomplete old JSON" };
  const saved = await store.preserve(identity, raw); assert.equal(saved.record, null); assert.equal(saved.recoveries.length, 1);
  assert.deepEqual(await store.preserve(identity, raw), saved);
  await store.save(identity, command());
  const restored = createSavedWorkStore({ root }).read(identity, saved.recoveries[0].recovery_id);
  assert.deepEqual(restored.recovery, raw); assert.equal(restored.record.revision, 1);
});
test("different operator/caller/subject cannot read another actor's saved data", async t => {
  const { store } = setup(t); await store.save(identity, command());
  for (const change of [{ operatorId: "operator:other" }, { callerId: "other-console" }, { subjectId: "delivery-43" }])
    assert.equal(store.read({ ...identity, ...change }).record, null);
});
test("private record corruption fails visibly and preserves the bytes", async t => {
  const { root, store } = setup(t); await store.save(identity, command());
  const directory = readdirSync(root).find(name => name !== "locks"); const file = path.join(root, directory, "current.json");
  const value = JSON.parse(readFileSync(file)); value.payload_json += " "; const changed = JSON.stringify(value); writeFileSync(file, changed);
  assert.throws(() => store.read(identity), { code: "saved_work_corrupt" }); assert.equal(readFileSync(file, "utf8"), changed);
});
test("subject mismatch, unsupported data, cross-subject recovery and oversized content reject before writes", async t => {
  const { store } = setup(t);
  await assert.rejects(store.save(identity, command({ ...draft(), packageId: "delivery-99" })), { code: "saved_work_subject_mismatch" });
  await assert.rejects(store.save(identity, { ...command(), payload_json: "x".repeat(2 * 1024 * 1024 + 1) }), { code: "saved_work_payload_invalid" });
  await assert.rejects(store.preserve(identity, { storage_key: "delivery-work-design-session:delivery-99:v1", raw_value: "{}" }), { code: "saved_work_recovery_invalid" });
  await assert.rejects(store.save(identity, { ...command(), approval: true }), { code: "saved_work_input_invalid" });
  assert.equal(store.read(identity).record, null);
});
