import assert from "node:assert/strict";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { HttpError } from "../src/errors.js";
import { createBoundedSourceActions, normalizeBoundedSourceCommand } from "../src/source-authoring/bounded-actions.js";

function fixture({ unknown = false } = {}) {
  const session = { session_id: "prototype-source-session:proposal-42:1", prototype_id: "prototype:proposal-42", caller_id: "console", operator_id: "operator:owner" };
  const changeSet = { change_set_id: "prototype-change-set:proposal-42:1", session_id: session.session_id, operations: [{ path: "prototypes/proposal-42/index.html", content: "synthetic app draft" }] };
  let record = { revision: "2026-10-18T10:00:01Z", attempts: [{ requested_at: "2026-10-18T10:00:00Z", state: "draft-ready", change_set: changeSet, change_set_digest: canonicalDigest(changeSet) }] };
  let calls = 0; let failOnce = unknown; let locked = false;
  const error = (code, message, options = {}) => new HttpError(options.statusCode ?? 400, `prototype_source_authoring_${code}`, message, options.details ?? null);
  const project = (value, _configured, replayed = false) => ({ record: structuredClone(value), state: value.attempts.at(-1).state, replayed });
  const actions = createBoundedSourceActions({
    assertCommand: (value, action) => normalizeBoundedSourceCommand(value, action, error),
    assertIdentity(value, callerId, operatorId) {
      if (callerId !== value.caller_id || operatorId !== value.operator_id) throw error("identity_mismatch", "Wrong source owner identity.", { statusCode: 403 });
    },
    boundedFailure: value => ({ code: value.code, message: value.message }), configured: true, error, project,
    async sessionFor(ref) { if (ref !== session.prototype_id) throw error("subject_unknown", "Canonical Prototype is absent.", { statusCode: 404 }); return structuredClone(session); },
    readRecord: () => structuredClone(record), writeRecord: (_session, value) => { record = structuredClone(value); },
    revision: () => "2026-10-18T10:00:03Z",
    store: { async withLock(_id, operation) { if (locked) throw error("busy", "Source action is already running.", { statusCode: 409 }); locked = true; try { return await operation(); } finally { locked = false; } } },
    sourceAdapter: { async applySourceRealization(value, change) {
      assert.deepEqual(value, session); assert.deepEqual(change, changeSet); calls++;
      assert.equal(Object.hasOwn(value, "work_item_id"), false);
      if (failOnce) { failOnce = false; throw error("source_outcome_unknown", "Lost source response.", { statusCode: 503 }); }
      return { outcome: "committed", change_set_id: change.change_set_id };
    } },
  });
  const accept = { schema_version: 1, command_id: "accept:proposal-42:1", expected_revision: record.revision, accepted_change_set_digest: canonicalDigest(changeSet), requested_at: "2026-10-18T10:00:02Z" };
  const input = request => ({ callerId: "console", operatorId: "operator:owner", subjectRef: session.prototype_id, request });
  return { actions, accept, input, get calls() { return calls; }, get record() { return structuredClone(record); } };
}

test("the existing bounded action kernel accepts a real Prototype identity without any Delivery identifier", async () => {
  const f = fixture();
  assert.equal((await f.actions.continue(f.input(f.accept))).state, "source-created");
  assert.equal(f.calls, 1);
  assert.equal((await f.actions.continue(f.input(f.accept))).replayed, true);
  assert.equal((await f.actions.readCompletedCommand({ ...f.input(f.accept), action: "continue" })).replayed, true);
  assert.equal(f.calls, 1);
});

test("shared source acceptance rejects changed digest, caller, subject and command before applying", async () => {
  const f = fixture();
  await assert.rejects(f.actions.continue(f.input({ ...f.accept, accepted_change_set_digest: `sha256:${"f".repeat(64)}` })), { code: "prototype_source_authoring_acceptance_mismatch" });
  await assert.rejects(f.actions.continue({ ...f.input(f.accept), callerId: "another-caller" }), { code: "prototype_source_authoring_identity_mismatch" });
  await assert.rejects(f.actions.continue({ ...f.input(f.accept), subjectRef: "work-item-42" }), { code: "prototype_source_authoring_subject_unknown" });
  await assert.rejects(f.actions.continue(f.input({ ...f.accept, arbitrary_command: "not-admitted" })), { code: "prototype_source_authoring_command_invalid" });
  assert.equal(f.calls, 0); assert.equal(f.record.attempts[0].state, "draft-ready");
});

test("unknown Prototype apply recovers the original accepted change set without generating a replacement", async () => {
  const f = fixture({ unknown: true });
  await assert.rejects(f.actions.continue(f.input(f.accept)), { code: "prototype_source_authoring_source_outcome_unknown" });
  assert.equal(f.record.attempts[0].state, "apply-unknown");
  const recovery = { schema_version: 1, command_id: "recover:proposal-42:1", expected_revision: f.record.revision, requested_at: "2026-10-18T10:00:03Z" };
  assert.equal((await f.actions.recover(f.input(recovery))).state, "source-created");
  assert.equal((await f.actions.recover(f.input(recovery))).replayed, true);
  assert.equal(f.calls, 2);
});

test("shared cancellation is explicit and replay-safe but cannot erase committed effects", async () => {
  const f = fixture();
  const cancel = { schema_version: 1, command_id: "cancel:proposal-42:1", expected_revision: f.record.revision, reason: "Operator rejected this exact unapplied draft.", requested_at: "2026-10-18T10:00:02Z" };
  assert.equal((await f.actions.cancel(f.input(cancel))).state, "cancelled");
  assert.equal((await f.actions.cancel(f.input(cancel))).replayed, true);
  assert.equal(f.calls, 0);
  const committed = fixture(); await committed.actions.continue(committed.input(committed.accept));
  await assert.rejects(committed.actions.cancel(committed.input({ ...cancel, expected_revision: committed.record.revision })), { code: "prototype_source_authoring_cancel_not_allowed" });
});
