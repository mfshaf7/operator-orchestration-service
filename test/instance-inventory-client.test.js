import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceRecordReader, createInstanceRecordWriter } from "../src/instance-records/client.js";
import { nativeInventoryInput, nativeInventoryResult, nativeResult, target, instanceId, callerId } from "../test-fixtures/instance-records.js";
import { intakeDigest } from "../src/workspace-intake/contracts.js";
const config = { baseUrl: "http://127.0.0.1:32199", instanceId, callerId, callerSecret: "a".repeat(32) };

test("Inventory acceptance and original-outcome lookup use the same exact native decision and receipt", async () => {
  const input = nativeInventoryInput(), expected = nativeInventoryResult(input), calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(url.endsWith("/readback") ? { schema_version: 1, authority: { kind: "internal-instance-record", instance_id: instanceId }, found: true, ...expected } : expected);
  };
  assert.deepEqual(await createInstanceRecordWriter({ ...config, fetchImpl }).accept(target.name, input, { operation: "inventory" }), expected);
  assert.deepEqual(await createInstanceRecordReader({ ...config, fetchImpl }).resolve(target.name, { request: input.request, operator_ref: input.operator_ref }, { operation: "inventory" }), expected);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith(`/repositories/${target.name}/inventory`));
  assert.ok(calls[1].url.endsWith(`/repositories/${target.name}/inventory/readback`));
  assert.ok(calls.every(call => call.method === "POST" && call.redirect === "error"));
});

test("Even internally consistent substituted Inventory metadata, previous state or decisions cannot prove this accepted change", async () => {
  const input = nativeInventoryInput(), expected = nativeInventoryResult(input);
  for (const change of [value => { value.record.owns = ["Another responsibility"]; }, value => { value.record.posture = "suspended"; },
    value => { value.receipt.previous.digest = intakeDigest("different-previous-state"); }, value => { value.receipt.action = "inventory.retire"; },
    value => { value.receipt.decision_digest = intakeDigest("different-decision"); }, value => { value.record.record.version = 8; }]) {
    const bad = structuredClone(expected); change(bad);
    bad.receipt.record_digest = intakeDigest(bad.record); bad.receipt.receipt_digest = intakeDigest(bad.receipt, "receipt_digest");
    const client = createInstanceRecordWriter({ ...config, fetchImpl: async () => Response.json(bad) });
    await assert.rejects(client.accept(target.name, input, { operation: "inventory" }), /invalid binding/);
  }
});

test("Repository catalog validates full page receipts, compact global counts, instance and continuation", async () => {
  const current = nativeResult(), body = { schema_version: 1, authority: { kind: "internal-instance-record", instance_id: instanceId }, records: [current], selection: { query: "", scope: "all" },
    counts: { intake: { "out-of-scope": 0, proposed: 1, admitted: 0 }, inventory: { active: 0, suspended: 0, retired: 0 } }, next_after: null };
  const make = value => createInstanceRecordReader({ ...config, fetchImpl: async () => Response.json(value) });
  const page = await make(body).catalog();
  assert.equal(page.records[0].receipt.record_id, target.record_id);
  assert.equal(page.counts.intake.proposed, 1);
  for (const change of [v => { v.counts.intake.proposed = 0; }, v => { v.counts.inventory.active = -1; },
    v => { v.next_after = "repo:another-project"; }, v => { v.authority.instance_id = "installation-b"; },
    v => { v.records[0].record.notes = "Substituted metadata"; }, v => { v.records.push(structuredClone(v.records[0])); }]) {
    const bad = structuredClone(body); change(bad);
    await assert.rejects(make(bad).catalog(), /invalid binding/);
  }
});
