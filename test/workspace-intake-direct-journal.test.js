import assert from "node:assert/strict";
import { mkdtemp, access, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";
import { bindIntake, intakeDigest, intakeReference } from "../src/workspace-intake/contracts.js";
import { inputFixture, caller } from "../test-fixtures/workspace-intake/fixture.js";

function command(kind = "product", name = "intake-proof", index = 0, callerId = caller) {
  const input = inputFixture();
  const target = { kind, name, record_id: `${kind}:${name}` };
  const requestedRecord = kind === "product" ? input.request.requested_record : {
    kind, notes: "Operator-authored synthetic component.", component_class: null,
    owner_repo: null, product: null, security_owner: null,
  };
  input.request = bindIntake({ ...input.request, request_id: `request:${callerId}:${kind}:${name}:${index}`,
    idempotency_key: `direct:${callerId}:${kind}:${name}:${index}`, requester_ref: callerId,
    target, requested_record: requestedRecord }, "request_digest");
  input.decision = bindIntake({ ...input.decision, decision_id: `decision:${kind}:${name}:${index}`,
    target, request_ref: intakeReference(input.request, "request"),
    operator_acceptance: { ...input.decision.operator_acceptance, operator_ref: callerId },
    outcome: { ...input.decision.outcome, approved_record: requestedRecord } }, "decision_digest");
  return input;
}

async function harness(t) {
  const root = await mkdtemp(path.join(tmpdir(), "intake-direct-journal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { clock: () => new Date("2026-10-23T01:00:00Z") };
  const reopen = () => createWorkspaceIntakeService({ ...options, store: createWorkspaceIntakeStore({ root }) });
  return { root, reopen, service: reopen() };
}
const selector = { target: { kind: "product", name: "intake-proof" }, source_class: "direct" };

test("direct product and component journal cold recovery is read-only and never attests a source owner", async t => {
  const h = await harness(t);
  const empty = await h.service.list({ callerId: caller, input: selector });
  assert.equal(empty.source_class, "direct");
  assert.equal(empty.custody_request_id, null);
  assert.deepEqual(empty.records, []);
  await assert.rejects(access(path.join(h.root, "state.json")), { code: "ENOENT" });
  for (const kind of ["product", "component"]) {
    const input = command(kind);
    const acknowledged = await h.service.submit({ callerId: caller, input });
    assert.equal(acknowledged.source_attestation, null);
    const page = await h.reopen().list({ callerId: caller, input: { ...selector, target: { ...selector.target, kind } } });
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].request_id, acknowledged.request_id);
    assert.equal(page.pending_request_count, 1);
    assert.equal(page.records[0].candidate.source.class, "direct");
    assert.equal(page.records[0].candidate.candidate_digest, intakeDigest(page.records[0].candidate, "candidate_digest"));
    assert.deepEqual(page.records[0].candidate.requested_record, input.request.requested_record);
    assert.equal((await h.reopen().project(acknowledged.request_id, { callerId: caller })).status, "accepted");
  }
  assert.equal((await h.reopen().list({ callerId: "other", input: selector })).records.length, 0);
  assert.equal((await h.reopen().list({ callerId: caller, input: { ...selector, target: { kind: "product", name: "other" } } })).records.length, 0);
});

test("direct journal pagination counts pending requests beyond visible pages and binds cursor to caller, target and source", async t => {
  const h = await harness(t);
  for (let index = 0; index < 26; index++) await h.service.submit({ callerId: caller, input: command("product", "intake-proof", index) });
  const page = await h.service.list({ callerId: caller, input: selector });
  assert.equal(page.records.length, 25);
  assert.equal(page.pending_request_count, 26);
  const last = await h.reopen().list({ callerId: caller, input: { ...selector, cursor: page.next_cursor } });
  assert.equal(last.records.length, 1);
  assert.equal(last.next_cursor, null);
  assert.equal(new Set([...page.records, ...last.records].map(row => row.request_id)).size, 26);
  for (const [callerId, input] of [
    ["other", { ...selector, cursor: page.next_cursor }],
    [caller, { ...selector, target: { kind: "component", name: "intake-proof" }, cursor: page.next_cursor }],
    [caller, { ...selector, custody_request_id: "custody:synthetic" }],
    [caller, { ...selector, source_class: "delivery" }],
    [caller, { ...selector, target: { kind: "repo", name: "intake-proof" } }],
    [caller, { ...selector, cursor: "../state.json" }],
    [caller, { ...selector, extra: true }],
  ]) await assert.rejects(h.service.list({ callerId, input }));
});

test("corrupt durable Intake state fails closed on direct recovery", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId: caller, input: command() });
  await writeFile(path.join(h.root, "state.json"), JSON.stringify({ schema_version: 1, records: {}, digest: "sha256:" + "0".repeat(64) }));
  await assert.rejects(h.reopen().list({ callerId: caller, input: selector }), /integrity/);
});
