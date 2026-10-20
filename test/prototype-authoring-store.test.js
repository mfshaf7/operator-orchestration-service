import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { normalizePrototypeSourceRequest, prototypeRequestDigest } from "../src/source-authoring/prototype-contracts.js";
import { createPrototypeAuthoringStore } from "../src/source-authoring/prototype-store.js";
import { createPrototypeSourceAdapter } from "../src/source-authoring/prototype-source-adapter.js";

function request() {
  return { schema_version: 1, request_id: "prototype-source-request:proposal-42:1", prototype_id: "prototype:proposal-42",
    expected_registry_revision: "a".repeat(40), expected_source_revision: "b".repeat(40), objective: "Build the smallest synthetic local review app.", requested_at: "2026-10-18T10:00:00Z" };
}
function record() {
  const value = { schema_version: 1, artifact_type: "prototype-source-authoring-record", request: request(), caller_id: "console", operator_id: "operator:owner",
    binding: { subject: { kind: "prototype", prototype_id: request().prototype_id }, source_root: "prototypes/proposal-42" },
    state: "prepared", session: null, created_at: "2026-10-18T10:00:00Z", updated_at: "2026-10-18T10:00:00Z" };
  value.request_digest = prototypeRequestDigest({ callerId: value.caller_id, operatorId: value.operator_id, request: value.request });
  value.binding_digest = canonicalDigest(value.binding); return value;
}
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-source-store-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, store: createPrototypeAuthoringStore({ root }) };
}
const hash = value => createHash("sha256").update(value).digest("hex");

test("Prototype source request separates actual registry/source revisions and rejects source-coordinate injection", () => {
  const value = normalizePrototypeSourceRequest(request()); assert.notEqual(value.expected_registry_revision, value.expected_source_revision);
  for (const change of [{ work_item_id: "work-item-42" }, { repository: "arbitrary/owner" }, { branch: "main" }, { expected_registry_revision: ["a".repeat(40)] }]) {
    assert.throws(() => normalizePrototypeSourceRequest({ ...value, ...change }), { code: "prototype_source_authoring_request_invalid" });
  }
  assert.throws(() => normalizePrototypeSourceRequest({ ...value, objective: "x".repeat(16385) }), { code: "prototype_source_authoring_request_invalid" });
});

test("source metadata survives cold recovery with exact immutable request/caller binding and private file modes", async t => {
  const { root, store } = fixture(t); const value = record();
  await store.transact(value.request.request_id, ({ current, put }) => { assert.equal(current, null); put(value); });
  const loaded = createPrototypeAuthoringStore({ root }).get(value.request.request_id);
  assert.equal(loaded.binding_digest, value.binding_digest); assert.equal(loaded.session, null);
  assert.equal(statSync(path.join(root, "requests", `${hash(value.request.request_id)}.json`)).mode & 0o777, 0o600);
  await assert.rejects(store.transact(value.request.request_id, ({ current, put }) => put({ ...current, caller_id: "another-caller" })), { code: "prototype_source_authoring_request_conflict" });
  await assert.rejects(store.transact(value.request.request_id, ({ current, put }) => put({ ...current, binding_digest: `sha256:${"f".repeat(64)}` })), { code: "prototype_source_authoring_request_conflict" });
});

test("model drafts stay in content-addressed private files and are never read by metadata listing", async t => {
  const { root, store } = fixture(t); const value = record();
  await store.transact(value.request.request_id, ({ put }) => put(value));
  const artifact = { source_draft: "a".repeat(512 * 1024) };
  const reference = store.writeArtifact(value.request.request_id, artifact);
  assert.deepEqual(store.readArtifact(reference), artifact);
  const payload = path.join(root, "artifacts", hash(value.request.request_id), `${reference.digest.slice(7)}.json`);
  // A corrupt draft cannot turn a status/list request into raw-payload loading.
  writeFileSync(payload, "not-json-private-source", { mode: 0o600 });
  assert.equal(store.list({ callerId: value.caller_id }).length, 1);
  assert.equal(store.list({ callerId: "another-caller" }).length, 0);
  assert.throws(() => store.readArtifact(reference), error => {
    assert.equal(error.code, "prototype_source_authoring_state_corrupt"); assert.equal(error.message.includes("not-json-private-source"), false); return true;
  });
  assert.equal(JSON.stringify(store.list({ callerId: value.caller_id })).includes(artifact.source_draft), false);
});

test("corrupt or oversized persisted source metadata fails before unbounded parsing or payload disclosure", async t => {
  const { root, store } = fixture(t); const value = record();
  await store.transact(value.request.request_id, ({ put }) => put(value));
  const file = path.join(root, "requests", `${hash(value.request.request_id)}.json`);
  const loaded = JSON.parse(readFileSync(file, "utf8")); loaded.state = "pretend-complete"; writeFileSync(file, JSON.stringify(loaded));
  assert.throws(() => store.get(value.request.request_id), { code: "prototype_source_authoring_state_corrupt" });
  // A malformed retained request remains state corruption, not a fresh 400
  // that would send the operator into changing otherwise valid request input.
  const malformed = { ...value, request: { ...value.request, objective: null } };
  writeFileSync(file, JSON.stringify({ ...malformed, record_digest: canonicalDigest(malformed) }));
  assert.throws(() => store.get(value.request.request_id), error => error.code === "prototype_source_authoring_state_corrupt" && error.statusCode === 503);
  writeFileSync(file, "x".repeat(128 * 1024 + 1));
  assert.throws(() => store.get(value.request.request_id), { code: "prototype_source_authoring_state_corrupt" });
  assert.throws(() => store.writeArtifact(value.request.request_id, { data: "x".repeat(2 * 1024 * 1024) }), { code: "prototype_source_authoring_artifact_oversized" });
});

test("concurrent updates do not duplicate an immutable Prototype source request", async t => {
  const { store } = fixture(t); const value = record(); let release; let enter;
  const entered = new Promise(resolve => { enter = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  const first = store.transact(value.request.request_id, async ({ put }) => { enter(); await gate; put(value); });
  await entered;
  await assert.rejects(store.transact(value.request.request_id, () => {}), { code: "prototype_source_authoring_state_busy" });
  release(); await first; assert.equal(store.list({ callerId: value.caller_id }).length, 1);
});

test("Prototype inspection rejects arbitrary coordinates before invoking any owner executable", () => {
  let calls = 0;
  const adapter = createPrototypeSourceAdapter({ workspaceRoot: "/tmp/admitted-test-workspace", execute() { calls++; throw new Error("must not execute"); } });
  for (const input of [{ prototype_id: "work-item-42", source_revision: "a".repeat(40) },
    { prototype_id: "prototype:proposal-42", source_revision: "main" },
    { prototype_id: "prototype:proposal-42", source_revision: "a".repeat(40), repository: "arbitrary/owner" }]) {
    assert.throws(() => adapter.inspectCommittedSource(input), { code: "prototype_source_inspection_invalid" });
  }
  assert.equal(calls, 0);
});
