import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { platformOperationIdFor } from "../src/platform-operation/contracts.js";
import { sourcePreparationRequestExample } from "../scripts/source_credential_openapi_schemas.mjs";
import { normalizePlatformOperationCommand, platformOperationIntent } from "../src/platform-operation/contracts.js";
import { createPlatformOperationService } from "../src/platform-operation/service.js";
import { createSourceCredentialAuthority } from "../src/platform-operation/source-credential-authority.js";
import { assertSourceCredentialReceipt, assertSourceCredentialTimestamp, normalizeSourceCredentialInput } from "../src/platform-operation/source-credentials.js";
import { createPlatformOperationStore } from "../src/platform-operation/store.js";

const NOW = "2026-10-18T10:00:00.000Z";
const CALLER = "governance-operations-console";
const OPERATOR = "operator:workspace-owner";
const d = value => `sha256:${value.repeat(64)}`;

function plan(overrides = {}) {
  return {
    subject: { kind: "delivery", work_item_ref: "work-item-42", snapshot_digest: d("1") },
    session_id: null, source_start_digest: d("2"), repository: "example/source",
    repository_id: 123, installation_id: 456, landing_unit_id: "source-example",
    branch: "topic/example", fetched_base: "a".repeat(40), human_reviewer_id: "reviewer",
    proof: { decision: structuredClone(sourcePreparationRequestExample.preparation.decision), architecture_scope: null, rotate_before_expiry_seconds: 300 },
    ...overrides,
  };
}
function preparation(overrides = {}) {
  return {
    preparation_id: "delivery-42", subject: { kind: "delivery", work_item_ref: "work-item-42" },
    decision: { decision_id: "decision:42" }, expires_at: "2026-10-18T12:00:00.000Z",
    supersedes_intent_digest: null, ...overrides,
  };
}
function command(prepared, action = "agent-source.issue", sessionId = prepared.session_id, id = action, now = NOW) {
  const value = {
    schema_version: 1, command_id: `command:${id}`, idempotency_key: `idempotency:${id}`,
    correlation_id: "correlation:42", causation_id: null, actor_ref: OPERATOR,
    subject: { kind: "dev-integration-profile", ref: "profile:accepted-idea-delivery", expected_source_version: "version:42" },
    capability_id: action, action,
    input: { source_intent: prepared.source_intent, session_id: sessionId }, requested_at: now,
  };
  value.intent_digest = canonicalDigest(platformOperationIntent(value));
  value.approval = { decision: "approved", operator_id: OPERATOR, decision_ref: `approval:source-42:${id}`, decided_at: now, intent_digest: value.intent_digest };
  return normalizePlatformOperationCommand(value);
}
function receipt(input, overrides = {}) {
  const intent = input.input.source_intent;
  const value = {
    schema_version: 1, artifact_type: "source-intent-credential-receipt", command_id: input.command_id,
    action: input.action, outcome: input.action === "agent-source.revoke" ? "revoked" : input.action === "agent-source.renew" ? "renewed" : "issued",
    source_intent_digest: canonicalDigest(intent), source_intent_id: intent.intent_id,
    supersedes_intent_digest: intent.supersedes_intent_digest, subject: intent.subject,
    session_id: input.input.session_id, landing_unit_id: intent.landing_unit_id, repository: intent.repository,
    repository_id: intent.repository_id, installation_id: intent.installation_id, branch: intent.branch,
    fetched_base: intent.fetched_base, human_reviewer_id: intent.human_reviewer_id,
    caller_id: intent.caller_id, operator_id: intent.operator_id, source_start_digest: intent.source_start_digest,
    identity_id: "agent-gary", logical_agent_id: "gary", provider_principal: "example-gary[bot]", app_id: 789,
    definition_digest: d("3"), permissions: { metadata: "read", contents: "write", pull_requests: "write", checks: "read" },
    token_expires_at: input.action === "agent-source.revoke" ? null : "2026-10-18T11:00:00.000Z",
    authorization_expires_at: intent.expires_at, recorded_at: NOW, secret_values_embedded: false,
    ...overrides,
  };
  value.receipt_digest = canonicalDigest(value);
  return value;
}
function projection(input, sourceReceipt = receipt(input)) {
  return {
    schema_version: 1, operation_id: `platform-owner:${input.command_id}`, command_id: input.command_id,
    correlation_id: input.correlation_id, state: "succeeded", attempt: 1, subject_ref: input.subject.ref,
    capability_id: input.capability_id, action: input.action, retryable: false, cancel_available: false,
    blocker: null, failure: null,
    receipt: { receipt_ref: `platform://receipts/${input.command_id}`, outcome: "succeeded", recorded_at: NOW,
      source_version: "version:42", effect: "verified", source_credential: sourceReceipt },
    safe_log_ref: null, updated_at: NOW,
    events: [{ event_id: `event:${input.command_id}`, sequence: 1, state: "succeeded", occurred_at: NOW, summary: "Source effect verified." }],
  };
}
function fixture(t, initial = plan()) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-authority-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let current = initial;
  let now = new Date(NOW);
  let verifyHook = null;
  let submits = 0;
  const calls = { prepare: 0, verify: 0 };
  const store = createPlatformOperationStore({ root });
  const authority = createSourceCredentialAuthority({
    clock: () => new Date(now), providerCallerId: "operator-orchestration-service", store,
    resolvers: { delivery: {
      async prepare() { calls.prepare++; return structuredClone(current); },
      async verify() { calls.verify++; if (verifyHook) await verifyHook(); return structuredClone(current); },
    } },
  });
  const providerRecords = new Map();
  const providerClient = {
      async getCatalog() { return {
        schema_version: 1, catalog_id: "platform-console-operations", source_version: "version:42", observed_at: NOW, freshness: "current",
        subjects: [{ kind: "dev-integration-profile", ref: "profile:accepted-idea-delivery", source_version: "version:42", owner: "platform-engineering",
          capabilities: ["issue", "renew", "revoke"].map(action => ({ capability_id: `agent-source.${action}`, action: `agent-source.${action}`,
            available: true, unavailable_reason: null, required_capability: "platform.agent-source", approval_required: true, destructive: action === "revoke" })) }],
      }; },
      async submit(input) {
        submits++;
        const value = projection(input, receipt(input, input.action === "agent-source.revoke" ? {} : { token_expires_at: new Date(now.getTime() + 3_600_000).toISOString(), recorded_at: now.toISOString() }));
        providerRecords.set(input.command_id, value);
        return value;
      },
      async readByCommand(input) { return providerRecords.get(input.command_id); },
  };
  const service = createPlatformOperationService({
    clock: () => new Date(now), operatorBindings: { [CALLER]: OPERATOR }, sourceCredentialAuthority: authority, store,
    securityDecision: { uri: "github://example/security/commit/a/review.md", digest: d("4"), revision: "a".repeat(40) },
    providerClient,
  });
  const auth = input => authority.assertAuthorized({ callerId: CALLER, operatorId: OPERATOR, command: input });
  const lease = (intentId, sessionId = null, operation = () => "written") => authority.withSourceLease({ callerId: CALLER, operatorId: OPERATOR, intentId, sessionId, operation });
  return { root, authority, store, service, calls, auth, lease, providerClient, providerRecords,
    prepare: (input = preparation()) => authority.prepare({ callerId: CALLER, operatorId: OPERATOR, input }),
    observe: (input, value = receipt(input)) => authority.observe({ command: input, projection: projection(input, value) }),
    setPlan(value) { current = value; }, setTime(value) { now = new Date(value); }, setVerifyHook(value) { verifyHook = value; },
    get submits() { return submits; },
  };
}

test("preparation uses actual canonical source coordinates and is immutable, private and read-only", async t => {
  const f = fixture(t);
  const prepared = await f.prepare();
  assert.equal(prepared.session_id, null);
  assert.equal(prepared.source_intent.branch, "topic/example");
  assert.equal(prepared.source_intent.caller_id, "operator-orchestration-service");
  assert.deepEqual(await f.prepare(), prepared);
  assert.deepEqual(f.authority.read({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id }), prepared);
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.verify, 0);
  assert.equal(f.submits, 0);
  await assert.rejects(f.prepare(preparation({ expires_at: "2026-10-18T13:00:00.000Z" })), { code: "platform_source_preparation_conflict" });
  assert.throws(() => f.authority.read({ callerId: "another-caller", operatorId: OPERATOR, intentId: prepared.intent_id }), { code: "platform_source_intent_forbidden" });
  await assert.rejects(f.prepare({ ...preparation(), repository: "attacker/other" }), { code: "platform_source_preparation_invalid" });
});

test("prepared scope cannot write or renew before exact issue approval", async t => {
  const f = fixture(t); const prepared = await f.prepare();
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_approval_required" });
  await assert.rejects(f.auth(command(prepared, "agent-source.renew")), { code: "platform_source_approval_required" });
  await f.auth(command(prepared));
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_renewal_required" });
});

test("canonical subject, source start and every source coordinate are rechecked", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  for (const [field, value] of Object.entries({ source_start_digest: d("5"), repository: "example/other", repository_id: 124, installation_id: 457,
    landing_unit_id: "other-unit", branch: "topic/other", fetched_base: "b".repeat(40), human_reviewer_id: "other-reviewer",
    subject: { ...plan().subject, snapshot_digest: d("6") } })) {
    f.setPlan(plan({ [field]: value }));
    await assert.rejects(f.auth(input), { code: "platform_source_start_changed" });
  }
  f.setPlan(plan());
  const altered = structuredClone(prepared); altered.source_intent.branch = "topic/not-approved";
  await assert.rejects(f.auth(command(altered)), { code: "platform_source_intent_mismatch" });
});

test("actual source session can bind once, never be replaced or unbound", async t => {
  const f = fixture(t); const prepared = await f.prepare();
  await f.auth(command(prepared));
  f.setPlan(plan({ session_id: "work-session:delivery-42:source-example" }));
  await f.auth(command(prepared, "agent-source.renew", "work-session:delivery-42:source-example"));
  assert.equal(f.store.sourcePreparation(prepared.intent_id).session_id, "work-session:delivery-42:source-example");
  await assert.rejects(f.auth(command(prepared, "agent-source.renew")), { code: "platform_source_session_mismatch" });
  f.setPlan(plan({ session_id: "work-session:delivery-42:source-example:r2" }));
  await assert.rejects(f.auth(command(prepared, "agent-source.renew", "work-session:delivery-42:source-example:r2")), { code: "platform_source_session_mismatch" });
});

test("verified live metadata permits a bounded effect, not a different or absent session", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  assert.equal(await f.lease(prepared.intent_id), "written");
  await assert.rejects(f.lease(prepared.intent_id, "work-session:invented"), { code: "platform_source_session_mismatch" });
  f.setPlan(plan({ branch: "topic/superseded" }));
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_start_changed" });
});

test("credential expiry requests renewal without executing or minting on read", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  f.setTime("2026-10-18T10:59:30.000Z");
  let writes = 0;
  await assert.rejects(f.lease(prepared.intent_id, null, () => writes++), { code: "platform_source_renewal_required" });
  f.authority.read({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id });
  assert.equal(writes, 0); assert.equal(f.submits, 0);
  f.setTime("2026-10-18T12:00:00.000Z");
  await assert.rejects(f.auth(command(prepared, "agent-source.renew")), { code: "platform_source_intent_expired" });
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_expired" });
});

test("expiry is checked again after slow canonical readback", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  f.setVerifyHook(() => f.setTime("2026-10-18T12:00:00.000Z"));
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_expired" });
});

test("the private effect guard checks intent expiry again between bounded executor actions", async t => {
  const sessionId = "work-session:delivery-42:source-example";
  const f = fixture(t, plan({ session_id: sessionId })); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  const actual = { session_id: sessionId, landing_unit_id: "source-example", landing_unit: { branch: "topic/example", base_commit: "a".repeat(40) } };
  await f.authority.withSourceLease({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId, operation: async check => {
    check(actual);
    assert.throws(() => check({ ...actual, landing_unit: { ...actual.landing_unit, branch: "topic/other" } }), { code: "platform_source_session_mismatch" });
    f.setTime("2026-10-18T12:00:00.000Z");
    assert.throws(() => check(actual), { code: "platform_source_intent_expired" });
  } });
});

test("revocation durably stops writes before provider dispatch, including backend outage and expired intent", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  f.setVerifyHook(() => { throw new Error("backend is down"); });
  f.setTime("2026-10-18T13:00:00.000Z");
  await f.auth(command(prepared, "agent-source.revoke"));
  assert.ok(f.store.sourcePreparation(prepared.intent_id).revocation_requested);
  f.setTime(NOW);
  await assert.rejects(f.auth(command(prepared, "agent-source.renew")), { code: "platform_source_intent_revoked" });
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_revoked" });
  assert.equal(f.submits, 0);
});

test("late successful issue receipt cannot undo a previously accepted stop", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.auth(command(prepared, "agent-source.revoke")); await f.observe(input);
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_revoked" });
  const revoke = command(prepared, "agent-source.revoke");
  await f.observe(revoke); await f.observe(input);
  assert.equal(f.store.sourcePreparation(prepared.intent_id).credential_receipt.action, "agent-source.revoke");
});

test("cold source readback names original issue and revocation operations even after a local-only stop", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const issue = command(prepared);
  assert.deepEqual(prepared.operation_refs, { issue: null, revoke: null });
  assert.deepEqual(prepared.start_decision, sourcePreparationRequestExample.preparation.decision);
  await f.auth(issue);
  await f.authority.requestStop({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id });
  let read = f.authority.read({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id });
  assert.deepEqual(read.operation_refs, { issue: platformOperationIdFor(issue.command_id), revoke: null });
  const revoke = command(prepared, "agent-source.revoke"); await f.auth(revoke);
  read = f.authority.read({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id });
  assert.equal(read.operation_refs.revoke, platformOperationIdFor(revoke.command_id));
  await f.auth(command(prepared, "agent-source.revoke", null, "another-revoke"));
  assert.equal(f.authority.read({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id }).operation_refs.revoke, read.operation_refs.revoke);
});

test("historical prospective receipt never unbinds the actual session or downgrades newer expiry", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  await f.auth(initial); await f.observe(initial);
  const sessionId = "work-session:delivery-42:source-example";
  f.setPlan(plan({ session_id: sessionId }));
  const renewal = command(prepared, "agent-source.renew", sessionId);
  await f.auth(renewal); await f.observe(renewal, receipt(renewal, { token_expires_at: "2026-10-18T11:30:00.000Z" }));
  await f.observe(initial);
  const stored = f.store.sourcePreparation(prepared.intent_id);
  assert.equal(stored.session_id, sessionId);
  assert.equal(stored.credential_receipt.token_expires_at, "2026-10-18T11:30:00.000Z");
  assert.equal(stored.approval.command_id, initial.command_id);
  assert.equal(await f.lease(prepared.intent_id, sessionId), "written");
});

test("source effects and revocation serialize; a busy stop never reports success", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  await f.auth(input); await f.observe(input);
  let release; let entered;
  const active = new Promise(resolve => { entered = resolve; });
  const completion = new Promise(resolve => { release = resolve; });
  const effect = f.lease(prepared.intent_id, null, async () => { entered(); await completion; return "written"; });
  await active;
  await assert.rejects(f.auth(command(prepared, "agent-source.revoke")), { code: "platform_operation_state_busy" });
  release(); assert.equal(await effect, "written");
  await f.auth(command(prepared, "agent-source.revoke"));
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_revoked" });
});

test("missing actual Prototype resolver fails closed instead of fabricating Delivery identity", async t => {
  const f = fixture(t);
  await assert.rejects(f.prepare(preparation({ preparation_id: "prototype-42", subject: {
    kind: "prototype", prototype_id: "prototype:proposal-42", source_request_id: "source-request:42",
  } })), { code: "platform_source_subject_unavailable" });
});

test("closed credential protocol accepts independent Prototype revisions and rejects expanded authority", async t => {
  const f = fixture(t); const prepared = await f.prepare();
  const input = { source_intent: { ...prepared.source_intent, subject: {
    kind: "prototype", prototype_id: "prototype:proposal-42", registry_ref: "record://prototypes/proposal-42",
    registry_revision: "a".repeat(40), source_ref: "repo://workspace-prototype-studio/apps/example", source_revision: "b".repeat(40),
  } }, session_id: null };
  assert.deepEqual(normalizeSourceCredentialInput(input), input);
  assert.throws(() => normalizeSourceCredentialInput({ ...input, token: "not-admitted" }), { code: "platform_source_credential_contract_invalid" });
  assert.throws(() => normalizeSourceCredentialInput({ ...input, source_intent: { ...input.source_intent, purpose: "bootstrap" } }), { code: "platform_source_credential_contract_invalid" });
  assert.throws(() => normalizeSourceCredentialInput({ ...input, source_intent: { ...input.source_intent, subject: { ...input.source_intent.subject, source_ref: "repo://workspace-prototype-studio/../elsewhere" } } }), { code: "platform_source_credential_contract_invalid" });
});

test("source timestamps reject calendar rollover and unqualified expiry rather than relying on permissive JavaScript dates", () => {
  for (const value of ["2026-02-29T00:00:00Z", "2026-02-31T00:00:00Z", "2026-10-18T24:00:00Z", "2026-10-18T00:00:00", "0000-01-01T00:00:00Z"]) {
    assert.throws(() => assertSourceCredentialTimestamp(value, "expires_at"), { code: "platform_source_credential_contract_invalid" });
  }
  for (const value of [NOW, "2028-02-29T00:00:00.123456Z", "2026-10-18T10:00:00+08:00"]) assertSourceCredentialTimestamp(value, "expires_at");
});

test("receipt binds the exact command and rejects secret fields, native permission expansion and tampering", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  assert.deepEqual(assertSourceCredentialReceipt(receipt(input), input), receipt(input));
  for (const overrides of [{ token: "not-admitted" }, { repository_id: 987 }, { token_expires_at: "unknown" },
    { permissions: { metadata: "read", contents: "write", pull_requests: "write", checks: "read", workflows: "write" } }]) {
    assert.throws(() => assertSourceCredentialReceipt(receipt(input, overrides), input));
  }
  const invalid = receipt(input); invalid.branch = "topic/tampered";
  assert.throws(() => assertSourceCredentialReceipt(invalid, input));
  const another = command(prepared, "agent-source.issue", null, "another-command");
  assert.throws(() => assertSourceCredentialReceipt(receipt(input), another), { code: "platform_source_credential_binding_mismatch" });
});

test("service persists exact approval and verified metadata, while duplicate submit never mints again", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const input = command(prepared);
  const result = await f.service.submit({ callerId: CALLER, input });
  assert.equal(result.state, "succeeded"); assert.equal(f.submits, 1);
  assert.equal(await f.lease(prepared.intent_id), "written");
  await f.service.submit({ callerId: CALLER, input });
  assert.equal(f.submits, 1);
  const revoke = command(prepared, "agent-source.revoke");
  assert.equal((await f.service.submit({ callerId: CALLER, input: revoke })).state, "succeeded");
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_revoked" });
});

test("actual source use renews near-expiry scope once under original approval, not on GET", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  await f.service.submit({ callerId: CALLER, input: initial });
  const scope = { callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null, workItemId: "work-item-42" };
  await f.service.ensureSourceCredential(scope); assert.equal(f.submits, 1);
  f.setTime("2026-10-18T11:00:00.000Z");
  await f.service.readSourcePreparation({ callerId: CALLER, intentId: prepared.intent_id });
  assert.equal(f.submits, 1);
  await f.service.ensureSourceCredential(scope);
  assert.equal(f.submits, 2);
  const renewal = f.store.list().find(value => value.command.action === "agent-source.renew").command;
  assert.equal(renewal.approval.decision_ref, initial.approval.decision_ref);
  assert.equal(renewal.approval.decided_at, initial.approval.decided_at);
  assert.deepEqual(renewal.input.source_intent, initial.input.source_intent);
  await f.service.ensureSourceCredential(scope); assert.equal(f.submits, 2);
  assert.equal(await f.lease(prepared.intent_id), "written");
});

test("the current canonical owner rotation policy, not a hard-coded shorter window, governs actual source use", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  await f.service.submit({ callerId: CALLER, input: initial });
  f.setTime("2026-10-18T10:50:00.000Z");
  f.setPlan(plan({ proof: { ...plan().proof, rotate_before_expiry_seconds: 900 } }));
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_renewal_required" });
  await f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null });
  assert.equal(f.submits, 2);
  assert.equal(await f.lease(prepared.intent_id), "written");
});

test("lost issue acknowledgement is reconciled by original command without replacement mint", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  const dispatch = f.providerClient.submit;
  f.providerClient.submit = async input => { await dispatch(input); throw Object.assign(new Error("lost acknowledgement"), { code: "platform_operation_provider_unavailable" }); };
  assert.equal((await f.service.submit({ callerId: CALLER, input: initial })).state, "blocked");
  await f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null });
  assert.equal(f.submits, 1); assert.equal(f.store.list().length, 1);
  assert.equal(await f.lease(prepared.intent_id), "written");
});

test("pending initial issuance exposes the existing owner operation and never creates a renewal", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  f.providerClient.submit = async input => {
    const queued = { ...projection(input), state: "queued", receipt: null, events: [{ ...projection(input).events[0], state: "queued" }] };
    f.providerRecords.set(input.command_id, queued); return queued;
  };
  const submitted = await f.service.submit({ callerId: CALLER, input: initial });
  await assert.rejects(f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null }), error => {
    assert.equal(error.code, "platform_source_credential_pending"); assert.equal(error.details.operation_id, submitted.operation_id); return true;
  });
  assert.equal(f.store.list().length, 1);
});

test("wrong subject or requested start cannot borrow approved credentials", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  await f.service.submit({ callerId: CALLER, input: initial });
  const scope = { callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null };
  await assert.rejects(f.service.ensureSourceCredential({ ...scope, workItemId: "work-item-43" }), { code: "platform_source_subject_mismatch" });
  await assert.rejects(f.service.ensureSourceCredential({ ...scope, requestedStartDigest: d("9") }), { code: "platform_source_start_changed" });
  assert.equal(f.submits, 1);
});

test("terminal stop remains local and durable when provider catalog is unreachable", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  await f.service.submit({ callerId: CALLER, input: initial });
  f.providerClient.getCatalog = async () => { throw Object.assign(new Error("catalog unavailable"), { code: "platform_operation_provider_unavailable" }); };
  await assert.rejects(f.service.stopSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null }), { code: "platform_operation_provider_unavailable" });
  await assert.rejects(f.lease(prepared.intent_id), { code: "platform_source_intent_revoked" });
});

test("fresh explicit reauthorization can adopt the same valid source session after expiry without branch or story churn", async t => {
  const sessionId = "work-session:delivery-42:source-example";
  for (const initialSession of [null, sessionId]) {
    const f = fixture(t, plan({ session_id: initialSession })); const previous = await f.prepare();
    const first = command(previous); await f.service.submit({ callerId: CALLER, input: first });
    f.setTime("2026-10-18T12:01:00.000Z");
    await assert.rejects(f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: previous.intent_id, sessionId: initialSession }), { code: "platform_source_intent_expired" });
    assert.equal(f.store.list().length, 1); // Expiry itself cannot invent approval.
    await f.service.submit({ callerId: CALLER, input: command(previous, "agent-source.revoke", initialSession, "explicit-stop", "2026-10-18T12:01:00.000Z") });
    f.setPlan(plan({ session_id: sessionId, subject: { ...plan().subject, snapshot_digest: d("9") } }));
    f.setTime("2026-10-18T12:02:00.000Z");
    const successor = await f.prepare(preparation({ preparation_id: "delivery-42-fresh-approval", expires_at: "2026-10-18T14:00:00Z", supersedes_intent_digest: previous.source_intent_digest }));
    assert.equal(successor.source_intent.source_start_digest, previous.source_intent.source_start_digest);
    assert.equal(successor.source_intent.branch, previous.source_intent.branch);
    const approved = command(successor, "agent-source.issue", sessionId, "fresh-explicit-approval", "2026-10-18T12:02:00.000Z");
    await f.service.submit({ callerId: CALLER, input: approved });
    await f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: successor.intent_id, previousIntentId: previous.intent_id, sessionId, workItemId: "work-item-42" });
    assert.equal(await f.lease(successor.intent_id, sessionId), "written");
    await assert.rejects(f.lease(previous.intent_id, initialSession), { code: "platform_source_intent_revoked" });
    await f.service.submit({ callerId: CALLER, input: first });
    assert.equal(f.submits, 3);
  }
});

test("an unrelated approved scope cannot replace a retained source-session authorization", async t => {
  const sessionId = "work-session:delivery-42:source-example";
  const f = fixture(t, plan({ session_id: sessionId })); const previous = await f.prepare();
  await f.service.submit({ callerId: CALLER, input: command(previous) });
  const unrelated = await f.prepare(preparation({ preparation_id: "unlinked-approval" }));
  await f.service.submit({ callerId: CALLER, input: command(unrelated, "agent-source.issue", sessionId, "unlinked") });
  await assert.rejects(f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: unrelated.intent_id, previousIntentId: previous.intent_id, sessionId }), { code: "platform_source_successor_unconfirmed" });
});

test("the preparation HTTP family supports create, list and cold read without issuing credentials", async t => {
  const f = fixture(t);
  const config = loadConfig({ CALLER_ALLOWED_IDS: CALLER, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [CALLER]: "test-secret" }) });
  const app = createApp({ config, platformOperationService: f.service });
  async function invoke(method, url, body, secret = "test-secret") {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(request, { method, url, headers: { "x-oos-caller-id": CALLER, "x-oos-caller-secret": secret } });
    let code; let text = "";
    await app(request, { writeHead(value) { code = value; }, end(value) { text += value ?? ""; } });
    return { code, body: JSON.parse(text) };
  }
  const created = await invoke("POST", "/v1/platform-operations/source-preparations", { preparation: preparation() });
  assert.equal(created.code, 201); assert.equal(created.body.authorization.state, "prepared");
  const read = await invoke("GET", `/v1/platform-operations/source-preparations/${encodeURIComponent(created.body.intent_id)}`);
  assert.equal(read.code, 200); assert.deepEqual(read.body, created.body);
  const listed = await invoke("GET", "/v1/platform-operations/source-preparations?limit=10");
  assert.equal(listed.code, 200); assert.equal(listed.body.preparations.length, 1);
  assert.equal((await invoke("GET", "/v1/platform-operations/source-preparations?limit=10garbage")).code, 400);
  assert.equal((await invoke("GET", "/v1/platform-operations/source-preparations/source-intent%3Aabsent")).code, 404);
  assert.equal((await invoke("GET", "/v1/platform-operations/source-preparations", null, "wrong-secret")).code, 401);
  assert.equal((await invoke("POST", "/v1/platform-operations/source-preparations", { preparation: preparation(), repository: "attacker/other" })).code, 400);
  assert.equal(f.submits, 0); assert.equal(f.calls.verify, 0);
});

test("a known pre-mint failure retries its exact owner operation instead of inventing a replacement", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  f.providerClient.submit = async input => {
    const value = projection(input);
    delete value.receipt.source_credential;
    Object.assign(value, { state: "failed", retryable: true, failure: { code: "platform_source_custody_unavailable", detail: "Known failure before mint.", owner: "platform-engineering" } });
    Object.assign(value.receipt, { outcome: "failed", effect: "none" }); value.events[0].state = "failed";
    f.providerRecords.set(input.command_id, value); return value;
  };
  const controls = [];
  f.providerClient.control = async (input, operationId, control) => { controls.push({ operationId, control }); return projection(input); };
  const submitted = await f.service.submit({ callerId: CALLER, input: initial });
  assert.equal(submitted.state, "failed");
  await f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null });
  assert.equal(controls.length, 1); assert.equal(f.store.list().length, 1);
  assert.equal(controls[0].control.action, "retry");
  assert.equal(await f.lease(prepared.intent_id), "written");
});

test("uncertain issuance preserves original command and retry-after boundary without retrying early", async t => {
  const f = fixture(t); const prepared = await f.prepare(); const initial = command(prepared);
  f.providerClient.submit = async input => {
    const value = projection(input);
    delete value.receipt.source_credential;
    Object.assign(value, { state: "failed", retryable: true, failure: { code: "platform_source_issuance_uncertain", detail: "Mint result is unknown.", owner: "platform-engineering", retry_after: "2026-10-18T11:01:00.000Z" } });
    Object.assign(value.receipt, { outcome: "failed", effect: "partial" }); value.events[0].state = "failed";
    f.providerRecords.set(input.command_id, value); return value;
  };
  let controls = 0; f.providerClient.control = async () => { controls++; throw new Error("must not retry before uncertainty expires"); };
  const submitted = await f.service.submit({ callerId: CALLER, input: initial });
  await assert.rejects(f.service.ensureSourceCredential({ callerId: CALLER, operatorId: OPERATOR, intentId: prepared.intent_id, sessionId: null }), error => {
    assert.equal(error.code, "platform_source_credential_pending"); assert.equal(error.details.operation_id, submitted.operation_id);
    assert.equal(error.details.retry_after, "2026-10-18T11:01:00.000Z"); return true;
  });
  assert.equal(controls, 0); assert.equal(f.store.list().length, 1);
});
