import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("private conversation restores full working messages after restart without becoming workflow authority",async t=>{
  const {root,store}=setup(t),binding={role:"proposal-triage",ref:"idea:1",sourceRef:"proposal:1"};
  const id=`chat:${createHash("sha256").update(JSON.stringify([binding.role,binding.ref,binding.sourceRef])).digest("hex")}`;
  const who={...identity,kind:"advisor-conversation",subjectId:id};
  const value={schemaVersion:1,conversationId:id,binding,sourceRevision:"version:1",turns:[{id:"turn:1",role:"operator",text:"Complete message "+"a".repeat(3000),createdAt:"2026-11-11T00:00:00Z",sourceRevision:"version:1"}],pending:{state:"unconfirmed"}};
  await store.save(who,command(value));
  assert.deepEqual(JSON.parse(createSavedWorkStore({root}).read(who).record.payload_json),value);
  assert.equal(store.read({...who,operatorId:"operator:other"}).record,null);
  await assert.rejects(store.save({...who,subjectId:id.replace(/.$/,"x")},command(value)),{code:"saved_work_payload_invalid"});
  await assert.rejects(store.save(who,command({...value,binding:{...binding,ref:"another-project"}},1,"foreign")),{code:"saved_work_payload_invalid"});
  await assert.rejects(store.save(who,command({...value,turns:[...value.turns,...value.turns]},1,"duplicate")),{code:"saved_work_payload_invalid"});
  await assert.rejects(store.save(who,command({...value,turns:[{...value.turns[0],role:"system"}]},1,"system")),{code:"saved_work_payload_invalid"});
});

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
test("technical plan drafts restore exact private input and cannot store an approval", async t => {
  const { root, store } = setup(t);
  const who = { ...identity, kind: "technical-plan" };
  const value = { schemaVersion: 1, packageId: who.subjectId, draft: {
    deliveryId: who.subjectId, coveredWorkItemIds: ["work-item-43"], rationale: "Explain the scope.",
    architectureJson: "{", conformanceJson: "{}", repoRevisionsJson: "[]",
  } };
  const first = await store.save(who, command(value, 0, "draft"));
  assert.deepEqual(createSavedWorkStore({ root }).read(who), first);
  assert.equal(store.read({ ...who, operatorId: "operator:other" }).record, null);
  await assert.rejects(store.save(who, command({ ...value, draft: { ...value.draft, approval: true } }, 1, "approval")), { code: "saved_work_input_invalid" });
  await assert.rejects(store.save(who, command({ ...value, draft: { ...value.draft, deliveryId: "delivery-99" } }, 1, "wrong")), { code: "saved_work_payload_invalid" });
  await assert.rejects(store.save(who, command(value, 0, "stale")), { code: "saved_work_revision_conflict" });
  const inactiveArchitectureSections = {
    authorization_session_execution_model: { summary: "Keep the project access notes." },
    lifecycle_state_model: { states: ["ready"], transitions: [] },
  };
  const starterBasis = { workItemId: 43, scope: '[43,"PI 2","Iteration 1",null,[],[]]' };
  const changed = { ...value, draft: { ...value.draft, inactiveArchitectureSections, starterBasis } };
  await store.save(who, command(changed, 1, "switch-options"));
  assert.deepEqual(JSON.parse(createSavedWorkStore({ root }).read(who).record.payload_json), changed);
  await assert.rejects(store.save(who, command({ ...value, draft: { ...value.draft, inactiveArchitectureSections: { approval: {} } } }, 2, "invalid-section")),
    { code: "saved_work_payload_invalid" });
  await assert.rejects(store.save(who, command({ ...value, draft: { ...value.draft,
    starterBasis: { ...starterBasis, scope: "" } } }, 2, "invalid-starter-scope")), { code: "saved_work_payload_invalid" });
  const cleared = await store.save(who, command({ ...value, draft: null }, 2, "clear"));
  assert.equal(JSON.parse(cleared.record.payload_json).draft, null);
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
