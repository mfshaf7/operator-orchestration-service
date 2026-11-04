import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceRecordReader } from "../src/instance-records/client.js";
import { intakeDigest } from "../src/workspace-intake/contracts.js";

const authority = { kind: "internal-instance-record", instance_id: "installation-a" };
const binding = { provider: "github", provider_repository_id: "123", full_name: "example-org/client-project" };
function result(version = 1, previous = null) {
  const record = { phase: "intake", status: "proposed", notes: `Synthetic test metadata v${version}`, provider_repository: binding };
  const receipt = { schema_version: 1, artifact_type: "instance-operational-record-receipt", authority: "internal-instance-record",
    instance_id: "installation-a", record_id: "repo:client-project", version,
    record_digest: intakeDigest(record), previous: previous ?? { version: null, digest: null },
    idempotency_key: `request-${version}`, command_digest: intakeDigest({ command: version }), actor: "oos:test",
    action: "classify", accepted_at: "2026-11-04T00:00:00+00:00", policy_ref: "governance-policy://test",
    decision_digest: intakeDigest({ decision: version }), readiness_digest: intakeDigest({ readiness: version }), operator_ref: "operator:test" };
  receipt.receipt_digest = intakeDigest(receipt);
  return { record, receipt };
}
const detail = () => ({ schema_version: 1, authority, found: true, ...result() });
function harness(body = detail(), { status = 200 } = {}) {
  const calls = [];
  const client = createInstanceRecordReader({ baseUrl: "http://127.0.0.1:32199", instanceId: "installation-a",
    callerId: "oos:test-reader", callerSecret: "a".repeat(32), fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return Response.json(body, { status });
    } });
  return { client, calls };
}

test("Internal record reader validates exact canonical result without any Git provider request", async () => {
  const { client, calls } = harness();
  assert.deepEqual(await client.read("client-project"), result());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:32199/v1/instance-records/repositories/client-project");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].redirect, "error");
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].headers["x-wgcf-caller-secret"], "a".repeat(32));
});

test("Only a successful installation-bound absence envelope can mean record not found", async () => {
  const h = harness({ schema_version: 1, authority, found: false, record: null, receipt: null });
  assert.equal(await h.client.read("client-project"), null);
  for (const status of [404, 503]) {
    const failed = harness({ detail: "unknown route or unavailable" }, { status });
    await assert.rejects(failed.client.read("client-project"), error => error.statusCode === status);
  }
});

for (const fault of ["wrong-installation", "wrong-repository", "changed-record", "changed-receipt", "false-absence", "missing-found", "non-object-record"]) {
  test(`Internal authority read fails closed: ${fault}`, async () => {
    const body = structuredClone(detail());
    if (fault === "wrong-installation") body.authority.instance_id = "installation-b";
    if (fault === "wrong-repository") body.receipt.record_id = "repo:other";
    if (fault === "changed-record") body.record.notes = "Changed after acceptance";
    if (fault === "changed-receipt") body.receipt.operator_ref = "operator:forged";
    if (fault === "false-absence") body.found = false;
    if (fault === "missing-found") delete body.found;
    if (fault === "non-object-record") body.record = 17;
    await assert.rejects(harness(body).client.read("client-project"), error => error.code === "instance_records_authority_invalid");
  });
}

test("Exact repository selection rejects injected routes before network access", async () => {
  const h = harness();
  for (const name of ["../other", "project?instance_id=other", "project/history", null, ""]) {
    await assert.rejects(h.client.read(name), error => error.code === "instance_records_target_invalid");
  }
  assert.equal(h.calls.length, 0);
});

test("Reader refuses a credential-bearing or unconfigured authority address", () => {
  for (const baseUrl of ["https://user:password@example.test", "file:///private", "http://example.test?destination=elsewhere"]) {
    assert.throws(() => createInstanceRecordReader({ baseUrl, instanceId: "installation-a" }), error => error.code === "instance_records_not_configured");
  }
  assert.throws(() => createInstanceRecordReader({ baseUrl: "http://127.0.0.1", instanceId: "" }), /installation identity/);
});

test("History binds descending adjacent revisions and its exact continuation cursor", async () => {
  const first = result();
  const second = result(2, { version: 1, digest: first.receipt.record_digest });
  const body = { schema_version: 1, authority, records: [second, first], next_before_version: null };
  assert.equal((await harness(body).client.history("client-project")).records.length, 2);
  const changed = structuredClone(body);
  changed.records[0].receipt.previous.digest = intakeDigest("wrong-record");
  changed.records[0].receipt.receipt_digest = intakeDigest(changed.records[0].receipt, "receipt_digest");
  await assert.rejects(harness(changed).client.history("client-project"), /invalid binding/);
  const badCursor = { ...body, next_before_version: 2 };
  await assert.rejects(harness(badCursor).client.history("client-project"), /invalid binding/);
});

test("Register list is compact, ordered, scoped and cursor-bound", async () => {
  const one = result().receipt;
  const item = { record_id: one.record_id, version: one.version, record_digest: one.record_digest,
    phase: "intake", status: "proposed", provider_repository: binding };
  const body = { schema_version: 1, authority, records: [item], next_after: item.record_id };
  assert.equal((await harness(body).client.list()).records.length, 1);
  await assert.rejects(harness({ ...body, records: [item, item] }).client.list(), /invalid binding/);
  await assert.rejects(harness(body).client.list({ after: item.record_id }), /invalid binding/);
  const malformed = { ...body, records: [{ ...item, record_id: null }] };
  await assert.rejects(harness(malformed).client.list(), error => error.code === "instance_records_authority_invalid");
});

test("Selected registration status binds a finite name batch and cannot confuse missing records with failed reads", async () => {
  const names = ["client-project", "missing"], saved = result();
  const body = { schema_version: 1, authority, record_ids: names.map(name => `repo:${name}`), records: [{ record_id: "repo:client-project",
    version: saved.receipt.version, record_digest: saved.receipt.record_digest, phase: "intake", status: "proposed", provider_repository: binding }] };
  const h = harness(body);
  assert.deepEqual(await h.client.lookup(names), body);
  assert.ok(h.calls[0].url.endsWith("/repository-status?name=client-project&name=missing"));
  assert.equal(h.calls[0].method, "GET");
  for (const names of [[], ["missing", "client-project"], ["client-project", "client-project"], Array(26).fill("client-project")]) {
    await assert.rejects(h.client.lookup(names), { code: "instance_records_targets_invalid" });
  }
  for (const mutate of [value => { value.authority.instance_id = "foreign"; }, value => { value.record_ids.pop(); },
    value => { value.records[0].phase = "unknown"; }, value => { value.records[0].status = "active"; },
    value => { value.records[0].record_id = "repo:unrequested"; }]) {
    const value = structuredClone(body); mutate(value);
    await assert.rejects(harness(value).client.lookup(names), /invalid binding/);
  }
  await assert.rejects(harness({}, { status: 503 }).client.lookup(names));
});
