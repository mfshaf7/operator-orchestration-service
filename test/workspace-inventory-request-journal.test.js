import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bindInventory, inventoryDigest, projectInventoryRequestJournal } from "../src/workspace-inventory/contracts.js";
import { createWorkspaceInventoryStore } from "../src/workspace-inventory/store.js";
import { createWorkspaceInventoryService } from "../src/workspace-inventory/service.js";
import { createWorkspaceInventoryLifecycleService } from "../src/workspace-inventory/lifecycle-service.js";
import { inputFixture, lifecycleInputFixture, caller } from "../test-fixtures/workspace-inventory/fixture.js";

const target = { kind: "component", name: "inventory-proof" };
async function harness(t, lifecycle = false) {
  const parent = await mkdtemp(path.join(tmpdir(), "inventory-journal-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "retained");
  const make = () => (lifecycle ? createWorkspaceInventoryLifecycleService : createWorkspaceInventoryService)({
    store: createWorkspaceInventoryStore({ root }),
    readinessClient: { evaluate() { throw Error("listing must never evaluate"); } },
    sourceClient: new Proxy({}, { get() { throw Error("listing must never prepare/publish source"); } }),
  });
  return { root, make, service: make(), store: createWorkspaceInventoryStore({ root }) };
}
function command(index, lifecycle = false, selectedCaller = caller, selectedTarget = target) {
  const source = lifecycle ? lifecycleInputFixture().input : inputFixture();
  const request = structuredClone(source.request);
  request.request_id = `${lifecycle ? "inventory-lifecycle-request" : "inventory-request"}:journal:${index}`;
  request.idempotency_key = request.request_id;
  request.requested_at = new Date(Date.UTC(2026, 9, 21, 0, 0, index)).toISOString();
  request.operator_ref = selectedCaller;
  request.target = { ...selectedTarget, record_id: `${selectedTarget.kind}:${selectedTarget.name}` };
  if (!lifecycle) request.active_record.id = request.target.record_id;
  return { ...source, request: bindInventory(request, "request_digest") };
}

for (const lifecycle of [false, true]) {
  const family = lifecycle ? "Lifecycle" : "Promotion";
  test(`${family} discovery is GET-only, restart-safe and does not initialize absent storage`, async t => {
    const h = await harness(t, lifecycle);
    const empty = await h.service.list({ callerId: caller, input: { target } });
    assert.equal(empty.pending_request_count, 0);
    assert.deepEqual(empty.records, []);
    assert.equal(empty.canonical_mutation, false);
    await assert.rejects(access(h.root), { code: "ENOENT" });
    const input = command(0, lifecycle);
    await h.service.submit({ callerId: caller, input });
    const before = await readFile(path.join(h.root, "state.json"));
    const original = await h.make().list({ callerId: caller, input: { target } });
    assert.equal(original.records[0].request_id, input.request.request_id);
    assert.equal(original.pending_request_count, 1);
    assert.equal(original.records[0].status, "accepted");
    assert.equal(original.workflow_id, lifecycle ? "workspace-inventory-lifecycle" : "workspace-inventory-promotion");
    if (lifecycle) assert.equal(original.records[0].action, input.request.action);
    const recovered = await h.make().project(original.records[0].request_id, { callerId: caller });
    assert.equal(recovered.request_id, input.request.request_id);
    assert.deepEqual(await readFile(path.join(h.root, "state.json")), before);
    const replay = await h.make().submit({ callerId: caller, input });
    assert.equal(replay.request_id, input.request.request_id, "Existing acknowledgement replay semantics stay unchanged");
    assert.equal((await h.make().list({ callerId: caller, input: { target } })).records.length, 1);
  });

  test(`${family} pages retain whole-journal pending count and isolate caller/target/cursor`, async t => {
    const h = await harness(t, lifecycle);
    for (let index = 0; index < 27; index++) {
      const input = command(index, lifecycle);
      await h.service.submit({ callerId: caller, input });
      if (index > 0) {
        await h.store.transact(async tx => {
          const record = tx.get(input.request.request_id);
          record.status = "cancelled";
          record.history.push({ sequence: 2, at: input.request.requested_at, status: "cancelled", details: null });
          await tx.put(record);
        });
      }
    }
    const page = await h.make().list({ callerId: caller, input: { target } });
    assert.equal(page.records.length, 25);
    assert.equal(page.pending_request_count, 1, "The one pending request is outside page1");
    assert.ok(page.records.every(row => row.status === "cancelled"));
    assert.match(page.next_cursor, /^[0-9a-f]{64}$/);
    const next = await h.make().list({ callerId: caller, input: { target, cursor: page.next_cursor } });
    assert.equal(next.records.length, 2);
    assert.equal(next.records.at(-1).request_id, command(0, lifecycle).request.request_id);
    assert.equal(next.next_cursor, null);
    assert.deepEqual((await h.make().list({ callerId: "operator:other", input: { target } })).records, []);
    assert.deepEqual((await h.make().list({ callerId: caller, input: { target: { ...target, name: "another" } } })).records, []);
    for (const input of [{ target, cursor: "f".repeat(64) }, { target, cursor: 2 },
      { target: { ...target, record_id: "forged" } }, { target, extra: true }]) {
      await assert.rejects(h.make().list({ callerId: caller, input }), error =>
        ["workspace_inventory_cursor_invalid", "workspace_inventory_list_invalid"].includes(error.code));
    }
    await assert.rejects(h.make().list({ callerId: "operator:other", input: { target, cursor: page.next_cursor } }), /does not belong/);
    await assert.rejects(h.make().list({ callerId: caller, input: { target: { ...target, name: "another" }, cursor: page.next_cursor } }), /does not belong/);
    const records = await h.store.list();
    assert.throws(() => projectInventoryRequestJournal({ records, callerId: caller, input: { target, cursor: page.next_cursor },
      workflowId: lifecycle ? "workspace-inventory-promotion" : "workspace-inventory-lifecycle" }), /does not belong/);
    const serialized = JSON.stringify(page);
    assert.doesNotMatch(serialized, /active_record|approval_refs|requested_value|readiness|reason/,
      "Discovery contains bounded locators, never raw values or evidence");
  });

  test(`${family} corrupt retained state is unavailable, never empty history`, async t => {
    const h = await harness(t, lifecycle);
    await h.service.submit({ callerId: caller, input: command(0, lifecycle) });
    const file = path.join(h.root, "state.json");
    await writeFile(file, "{broken");
    await assert.rejects(h.make().list({ callerId: caller, input: { target } }), /integrity validation/);
    assert.equal(await readFile(file, "utf8"), "{broken");
  });
}

test("UTF8 byte-bound pagination retains every original locator and fails closed on an oversized row", async t => {
  const h = await harness(t);
  const ids = [];
  for (let index = 0; index < 8; index++) {
    const input = command(index);
    input.request = bindInventory({ ...input.request, request_id: `${index}:${"界".repeat(2500)}` }, "request_digest");
    ids.push(input.request.request_id);
    await h.service.submit({ callerId: caller, input });
  }
  const seen = [];
  let cursor;
  do {
    const page = await h.make().list({ callerId: caller, input: { target, ...(cursor ? { cursor } : {}) } });
    assert.ok(page.records.length < 8);
    assert.ok(Buffer.byteLength(JSON.stringify(page.records), "utf8") <= 32768);
    assert.equal(page.pending_request_count, 8);
    seen.push(...page.records.map(row => row.request_id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(seen.sort(), ids.sort());
  const large = command(10);
  large.request = bindInventory({ ...large.request, request_id: "x".repeat(40000) }, "request_digest");
  await h.service.submit({ callerId: caller, input: large });
  await assert.rejects(h.make().list({ callerId: caller, input: { target } }), error => error.code === "workspace_inventory_list_record_large");
});

test("Target/caller-matching corrupted command bindings fail closed even with a valid outer store digest", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId: caller, input: command(0) });
  const file = path.join(h.root, "state.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  Object.values(data.records)[0].binding_digest = `sha256:${"0".repeat(64)}`;
  data.digest = inventoryDigest(data, "digest");
  await writeFile(file, JSON.stringify(data));
  await assert.rejects(h.make().list({ callerId: caller, input: { target } }), /binding is invalid/);
});
