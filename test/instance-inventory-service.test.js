import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInstanceIntakeJournal } from "../src/instance-records/intake-journal.js";
import { createInstanceInventoryService } from "../src/instance-records/inventory-service.js";
import { intakeDigest, bindIntake } from "../src/workspace-intake/contracts.js";
import { nativeInput, nativeResult, instanceId, operator, target, policy, at } from "../test-fixtures/instance-records.js";
import { HttpError } from "../src/errors.js";

async function harness(t, { lostReply = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "instance-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = nativeResult(); current.record.status = "admitted";
  current.receipt.record_digest = intakeDigest(current.record);
  current.receipt.receipt_digest = intakeDigest(current.receipt, "receipt_digest");
  let result = null, writes = 0, currentOffline = false;
  const journal = createInstanceIntakeJournal({ root, instanceId });
  const reader = { prepare: async (_name, { operation }) => {
    assert.equal(operation, "inventory");
    if (currentOffline) throw new HttpError(503, "state_offline", "Synthetic unavailable current state");
    return { canonical_authority: { kind: "internal-instance-record", instance_id: instanceId, record_id: target.record_id }, policy_ref: policy,
      expected_state: { record_version: current.receipt.version, record_digest: current.receipt.record_digest }, current };
  }, resolve: async (_name, _original, { operation }) => { assert.equal(operation, "inventory"); return result; } };
  const service = createInstanceInventoryService({ instanceId, journal, reader, clock: () => new Date(at), legacyRequestReader: async () => null,
    writer: { accept: async (_name, input, { operation }) => {
      assert.equal(operation, "inventory"); assert.equal(input.request.operator_ref, operator); writes++;
      // Explicit protocol double. Native Governance plus real store transactions
      // are separately exercised by WGCF's composed tests; no live data is used.
      result = { record: { phase: "inventory", posture: "active" }, receipt: { version: 2, receipt_digest: intakeDigest(input) } };
      if (lostReply) throw new HttpError(503, "reply_lost", "Synthetic reply lost after canonical acceptance");
      return result;
    } } });
  const preparation = await service.prepare({ callerId: operator, input: { target: { kind: "repo", name: target.name } } });
  const before = nativeInput().request.requested_record;
  const request = bindIntake({ schema_version: 1, artifact_type: "instance-repository-inventory-request", instance_id: instanceId,
    request_id: "workspace-inventory-request:synthetic", requested_at: at, operator_ref: operator, correlation_ref: "console://inventory/synthetic",
    idempotency_key: "inventory:synthetic", action: "promote", target, expected_state: preparation.expected_state,
    requested_value: { posture: "active", lifecycle: "active", repo_class: "product-source", requires_security_bindings: false,
      provider_repository: before.provider_repository, validation_behavior: before.validation_behavior, owns: ["Project source"], must_not_own: ["Shared policy"], allowed_authoritative_refs: [] },
    prior_receipt_digest: null, reason: null, impact_acknowledgements: [], approval_refs: ["console://inventory/accepted"],
    operator_acceptance: { state: "accepted", operator_ref: operator, recorded_at: at }, policy_ref: policy }, "request_digest");
  const command = { authority_revision: policy.revision, request, session_ref: "console://inventory/session", execution_ref: "console://inventory/execution" };
  return { service, journal, preparation, command, writes: () => writes, offline: () => { currentOffline = true; } };
}

test("Internal inventory retains accepted input before writing and finishes from its genuine receipt", async t => {
  const h = await harness(t);
  assert.equal(h.preparation.intake_entry_ref.version, 1);
  assert.equal(h.preparation.current_record.phase, undefined);
  const accepted = await h.service.submit({ callerId: operator, input: h.command });
  assert.equal(accepted.status, "accepted"); assert.equal(accepted.cancel_allowed, true); assert.equal(h.writes(), 0);
  const complete = await h.service.advance({ callerId: operator, requestId: h.command.request.request_id });
  assert.equal(complete.status, "succeeded"); assert.equal(complete.review, null); assert.equal(complete.receipt.version, 2);
  assert.equal((await h.service.project(h.command.request.request_id, { callerId: operator })).receipt.receipt_digest, complete.receipt.receipt_digest);
});

test("Lost inventory reply recovers original result without refreshing changed or unavailable current state", async t => {
  const h = await harness(t, { lostReply: true });
  await h.service.submit({ callerId: operator, input: h.command });
  const uncertain = await h.service.advance({ callerId: operator, requestId: h.command.request.request_id });
  assert.equal(uncertain.status, "preparing"); assert.equal(uncertain.failure.retryable, true); assert.equal(uncertain.cancel_allowed, false);
  await assert.rejects(h.service.advance({ callerId: operator, requestId: h.command.request.request_id, action: "cancel" }), /original inventory outcome/);
  h.offline();
  const recovered = await h.service.advance({ callerId: operator, requestId: h.command.request.request_id });
  assert.equal(recovered.status, "succeeded"); assert.equal(h.writes(), 1);
});

test("Unattempted inventory cancellation has no canonical effect and retained identity cannot be replaced", async t => {
  const h = await harness(t);
  await h.service.submit({ callerId: operator, input: h.command });
  const changed = structuredClone(h.command); changed.execution_ref = "console://different-execution";
  await assert.rejects(h.service.submit({ callerId: operator, input: changed }), /different accepted input/);
  await assert.rejects(h.service.project(h.command.request.request_id, { callerId: "another-caller" }), { statusCode: 404 });
  const cancelled = await h.service.advance({ callerId: operator, requestId: h.command.request.request_id, action: "cancel" });
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.canonical_mutation, false); assert.equal(h.writes(), 0);
});
