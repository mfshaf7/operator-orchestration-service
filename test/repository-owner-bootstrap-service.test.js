import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createRepositoryOwnerBootstrapStore } from "../src/repository-owner-bootstrap/store.js";
import { createRepositoryOwnerBootstrapService } from "../src/repository-owner-bootstrap/service.js";
import { inspectExistingSourceOwnerControls, planSourceOwnerBootstrap, sourceOwnerBootstrapPaths } from "../src/repository-owner-bootstrap/scaffold.js";

const callerId = "console", operatorId = "operator:fixture", owner = "workflow-owner";
const NOW = "2026-10-19T10:00:00.000Z";
const args = { callerId, operatorId, requestId: "bootstrap-request:workflow-owner" };
function harness(t, { existingControls = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-bootstrap-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const authority = { schema_version: 1, owner_repo: owner, classification: "proposed", inventory_posture: null,
    intake_entry_ref: { id: `repo:${owner}`, version: 1, digest: `sha256:${"a".repeat(64)}` },
    provider_repository: { provider: "github", provider_repository_id: "123456789", full_name: `mfshaf7-workspace/${owner}` },
    owner_purpose: "Synthetic source-only workflow owner; no control-plane or runtime authority.",
    source_bootstrap_eligible: true, ordinary_source_eligible: false, model_writes_allowed: false, canonical_mutation: false, runtime_activation: false };
  const profile = { schema_version: 1, owner_repo: owner, profile_id: "fixture-selected-profile-v1", commands: [
    { id: "tests", name: "Real selected app tests", kind: "tests", executable: "node", args: ["app/test.mjs"], fidelity: "pure-unit", conformance_binding: "matching-fidelity", timeout_seconds: 30 },
    { id: "validations", name: "Actual source diff", kind: "validations", executable: "git", args: ["diff", "--check"], fidelity: "real-git", conformance_binding: "none", timeout_seconds: 30 },
  ] };
  const preparationInput = { owner_repo: owner, custody_request_id: "custody:fixture", evidence_profile: profile,
    application_markers: ["app/main.mjs"], with_ci: false, decision_ref: "operator:fixture-bootstrap" };
  const blankFiles = Object.fromEntries(sourceOwnerBootstrapPaths(false).map(name => [name, name === "README.md" ? "# Actual project purpose\n" : null]));
  const seed = planSourceOwnerBootstrap({ authority, fetchedBase: "1".repeat(40), profile, applicationMarkers: ["app/main.mjs"], withCi: false, observedFiles: blankFiles });
  const completedFiles = Object.fromEntries(seed.files.map(file => [file.path, file.content]));
  const observedFiles = existingControls ? completedFiles : blankFiles;
  const plan = existingControls ? null : seed;
  const body = { schema_version: 1, workflow_id: "repository-owner-bootstrap-preparation", caller_id: callerId, operator_id: operatorId,
    decision_ref: preparationInput.decision_ref, custody_request_id: preparationInput.custody_request_id,
    custody_receipt_digest: `sha256:${"b".repeat(64)}`, owner_authority: authority, plan,
    ...(existingControls ? { existing_owner_controls: inspectExistingSourceOwnerControls({ ownerRepo: owner, fetchedBase: "1".repeat(40), observedFiles }) } : {}), authorization: "preparation-only",
    credential_issued: false, checkout_created: false, canonical_mutation: false, runtime_activation: false };
  const preparation = { ...body, preparation_digest: canonicalDigest(body) };
  const input = { schema_version: 1, request_id: args.requestId, preparation_input: preparationInput,
    expected_preparation_digest: preparation.preparation_digest, workflow_approval_ref: null, requested_at: NOW };
  const calls = { preparation: 0, verify: 0, identity: 0, ensure: 0, apply: 0, publish: 0, review: 0, merge: 0, cleanup: 0, credential: 0, stop: 0, existing: 0, unissued: 0, pristine: 0, providerReads: 0 };
  let eligible = true, approved = false, everApproved = false, failPublish = false;
  let pr = { state: "open", url: `https://github.com/mfshaf7-workspace/${owner}/pull/1`, head_commit: "d".repeat(40), review: { approved: false } };
  const context = new AsyncLocalStorage();
  function effect(session) {
    const scope = context.getStore(); assert.equal(scope?.owner_repo, owner); assert.equal(scope?.bootstrap_request_id, args.requestId);
    assert.equal(scope?.session_id, session.session_id); scope.assert_source_lease(session);
  }
  const sourceExecutor = { executor: {
    run(scope, operation) { return context.run({ ...context.getStore(), ...scope }, operation); },
    withSourceLeaseGuard(guard, operation) { return context.run({ ...context.getStore(), assert_source_lease: guard }, operation); },
  }, bootstrapSource: {
    async materializeExistingOwner(input) {
      assert.equal(context.getStore().session_id, null); assert.equal(input.bootstrap_request_id, args.requestId); calls.existing++;
      const body = { schema_version: 1, scope: "existing-owner-checkout-only", source_changed: false, credential_issued: false, review_required: false,
        owner_repo: owner, provider_repository: authority.provider_repository, source_request_id: input.bootstrap_request_id,
        evidence_profile_digest: canonicalDigest(profile), canonical_commit: input.preparation.existing_owner_controls.fetched_base,
        app_acceptance: false, inventory_admission: false, runtime_activation: false };
      return { ...body, receipt_digest: canonicalDigest(body) };
    },
    async inspectSourceCredentialBinding({ session }) { calls.identity++; return { repository: plan.provider_repository.full_name,
      repository_id: 123456789, installation_id: 172173010, human_reviewer_id: "mfshaf7", rotate_before_expiry_seconds: 900,
      landing_unit_id: session.landing_unit_id, branch: session.landing_unit.branch, fetched_base: session.landing_unit.base_commit }; },
    async ensureOwnedWorktree({ session }) { effect(session); calls.ensure++; return { resources: [{ resource_id: "synthetic-owned-resources" }] }; },
    async applySourceRealization({ session, change_set }) {
      effect(session); calls.apply++; return { schema_version: 1, receipt_id: "source-realization-receipt:fixture",
        session_id: session.session_id, head_commit: pr.head_commit, base_commit: plan.fetched_base,
        change_set_digest: canonicalDigest(change_set), outcome: "committed", receipt_digest: `sha256:${"e".repeat(64)}` };
    },
    async validateSource() { return { result: "pass", app_acceptance: false }; },
    async publishAgentSource({ session }) { effect(session); calls.publish++; if (failPublish) { failPublish = false; throw new Error("Synthetic lost publication acknowledgement"); } return { state: "published", pushed_head: pr.head_commit }; },
    async inspectPullRequest() { return structuredClone(pr); },
    async approvePullRequest() { calls.review++; pr.review.approved = true; return structuredClone(pr); },
    async mergePullRequest() { calls.merge++; pr.state = "merged"; pr.merge_commit = "f".repeat(40); return structuredClone(pr); },
    async retireSourceResources({ session, plan }) {
      calls.cleanup++;
      const body = { schema_version: 1, scope: "trusted-owner-controls-only", owner_repo: owner, session_id: session.session_id,
        provider_repository: authority.provider_repository, canonical_commit: pr.merge_commit, plan_digest: plan.plan_digest,
        evidence_profile_digest: plan.evidence_profile_digest, app_acceptance: false, inventory_admission: false, runtime_activation: false };
      return { complete: true, readback: { ...body, receipt_digest: canonicalDigest(body) } };
    },
    async retirePristineResources() { calls.pristine++; return { complete: true, canonical_checkout_retained: true }; },
  } };
  const preparationService = {
    async prepare() { calls.preparation++; if (!eligible) throw new Error("Native proposed authority is no longer eligible"); return structuredClone(preparation); },
    async verify() { calls.verify++; if (!eligible) throw new Error("Native proposed authority is no longer eligible"); return structuredClone(authority); },
  };
  const platformOperations = {
    async ensureSourceCredential() { calls.credential++; if (!approved) throw new Error("Explicit exact source approval required"); },
    async withSourceLease({ sessionId, operation }) {
      if (!approved || !eligible) throw new Error("Stopped or ineligible source purpose");
      return operation(session => { assert.equal(session.session_id, sessionId); if (!approved || !eligible) throw new Error("Source purpose stopped before dispatch"); });
    },
    async stopSourceCredential() { calls.stop++; approved = false; return { state: "succeeded" }; },
    async readSourcePreparation() {
      const record = store.get(args.requestId);
      return { source_intent: { subject: record.session.subject, source_start_digest: record.binding.source_start_digest },
        authorization: { approval_ref: everApproved ? "operator:approved-source" : null, credential_receipt: null } };
    },
    async stopUnissuedSourcePreparation() { assert.equal(everApproved, false); calls.unissued++; return { authorization: { state: "revocation-requested" } }; },
  };
  const store = createRepositoryOwnerBootstrapStore({ root });
  let profileChanged = false;
  const options = { callerOperatorBindings: { [callerId]: operatorId }, preparationService, sourceExecutor, platformOperations,
    sourceReader: { async inspect() {
      calls.providerReads++;
      const actualProfile = { ...profile, ...(profileChanged ? { profile_id: "changed-actual-owner-profile-v2" } : {}) };
      return { fetched_base: pr.merge_commit ?? "1".repeat(40), visibility: "public", default_branch: "main", observed_files: {
        ...completedFiles, "README.md": "# Actual owner purpose\n",
        "contracts/delivery-art-work-session/evidence-profile.json": JSON.stringify(actualProfile) } };
    } },
    clock: () => new Date(NOW), enabled: true };
  const service = createRepositoryOwnerBootstrapService({ ...options, store });
  const current = () => service.read(args);
  const command = (id, extra = {}) => ({ schema_version: 1, command_id: id, expected_revision: current().revision, requested_at: NOW, ...extra });
  const start = () => service.start({ ...args, input: { schema_version: 1, command_id: "command:start", source_intent_ref: "source-intent:fixture", requested_at: NOW } });
  const accept = () => service.accept({ ...args, input: { source_intent_ref: "source-intent:fixture",
    command: command("command:accept", { accepted_change_set_digest: current().draft.digest }) } });
  const deliver = action => ({ command: command(`command:${action}`, { expected_pull_request: action === "publish" ? null : {
    url: current().source_delivery.publish.pull_request.url, head_commit: current().draft.source_receipt.head_commit } }),
    ...(action === "publish" ? { source_intent_ref: "source-intent:fixture" } : {}) });
  return { root, store, service, sourceExecutor, platform: platformOperations, input, current, command, start, accept, deliver, calls,
    reopen: (enabled = true) => createRepositoryOwnerBootstrapService({ ...options, enabled, store: createRepositoryOwnerBootstrapStore({ root }) }),
    approve() { approved = true; everApproved = true; }, loseAuthority() { eligible = false; }, losePublishAck() { failPublish = true; },
    changeActualProfile() { profileChanged = true; } };
}

test("durable bootstrap uses the existing bounded accept and review path; no source effect before explicit approval, no app/admission claim after close", async t => {
  const h = harness(t);
  const created = await h.service.create({ callerId, operatorId, input: h.input });
  assert.equal(created.binding.source_identity.installation_id, 172173010);
  assert.equal(h.calls.ensure, 0); assert.equal(h.calls.credential, 0);
  const source = await h.service.prepareSourceCredential({ callerId, operatorId,
    subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId }, decision: null });
  assert.equal(source.purpose, "trusted-owner-bootstrap"); assert.equal(source.subject.kind, "repository-bootstrap");
  await assert.rejects(h.start(), /Explicit exact source approval/); assert.equal(h.calls.ensure, 0);
  h.approve(); await h.start(); const accepted = await h.accept();
  assert.equal(accepted.draft.state, "source-created"); assert.equal(h.calls.apply, 1);
  for (const action of ["publish", "review", "merge", "close"]) await h.service[action]({ ...args, input: h.deliver(action) });
  const complete = h.current(); assert.equal(complete.state, "succeeded");
  assert.equal(complete.app_acceptance, false); assert.equal(complete.inventory_admission, false); assert.equal(complete.runtime_activation, false);
  assert.equal(h.calls.stop, 1); assert.equal(h.calls.cleanup, 1);
  assert.deepEqual(h.reopen().read(args), complete);
});

test("cold recovery preserves original unknown publication command and source identity instead of creating another request or branch", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input }); h.approve(); await h.start(); await h.accept();
  const input = h.deliver("publish"); h.losePublishAck();
  await assert.rejects(h.service.publish({ ...args, input }), /lost publication acknowledgement/);
  const cold = h.reopen(); const retained = cold.read(args);
  assert.equal(retained.source_delivery.publish.state, "unknown");
  assert.deepEqual(retained.source_delivery.publish.command, input.command);
  await assert.rejects(cold.publish({ ...args, input: { ...input, command: { ...input.command, command_id: "command:replacement" } } }), /original retained/);
  await cold.publish({ ...args, input });
  assert.equal(cold.read(args).source_delivery.publish.state, "succeeded");
  assert.equal(h.calls.ensure, 1); assert.equal(h.calls.apply, 1); assert.equal(h.store.list({ callerId }).length, 1);
});

test("caller ownership, one pending owner request, inactive runtime and current proposed authority remain hard effect boundaries", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input });
  await assert.rejects(h.service.create({ callerId, operatorId, input: { ...h.input, request_id: "bootstrap-request:duplicate" } }), /existing pending/);
  assert.throws(() => h.service.read({ ...args, callerId: "other-caller" }), { statusCode: 403 });
  await assert.rejects(h.reopen(false).start({ ...args, input: { schema_version: 1, command_id: "command:start", source_intent_ref: "source-intent:fixture", requested_at: NOW } }), { statusCode: 503 });
  h.loseAuthority();
  await assert.rejects(h.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId } }), /no longer eligible/);
  assert.equal(h.calls.ensure, 0); assert.equal(h.calls.apply, 0); assert.equal(h.calls.publish, 0);
});

test("caller-scoped bounded listing exposes the original pending request without loading any source artifact or minting", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input });
  const before = { ...h.calls };
  h.store.readArtifact = () => { throw new Error("List must not load source bytes"); };
  const list = h.service.list({ callerId, operatorId, ownerRepo: owner });
  assert.equal(list.pending_request.request_id, args.requestId); assert.equal(list.records.length, 1);
  assert.equal(Object.hasOwn(list.records[0], "request"), false);
  assert.deepEqual(h.calls, before);
});

test("an existing owner profile uses a durable non-source checkout command and cannot acquire a fake source session or credential", async t => {
  const h = harness(t, { existingControls: true });
  const inspected = await h.service.create({ callerId, operatorId, input: h.input });
  assert.equal(inspected.session_id, null); assert.equal(inspected.draft, null);
  await assert.rejects(h.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId } }), /no open source purpose/);
  const input = h.command("command:materialize-existing-owner");
  const complete = await h.service.materializeExisting({ ...args, input });
  assert.equal(complete.state, "succeeded"); assert.equal(complete.existing_checkout.receipt.review_required, false);
  assert.equal(complete.app_acceptance, false); assert.equal(complete.inventory_admission, false);
  assert.deepEqual(await h.reopen().materializeExisting({ ...args, input }), complete);
  assert.equal(h.calls.existing, 1);
  for (const field of ["identity", "ensure", "apply", "publish", "credential", "stop"]) assert.equal(h.calls[field], 0);
});

test("unapplied cancellation retains prepared authorization refs and stops unissued access without a fake provider revoke", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input });
  await h.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId }, intentId: "source-intent:fixture" });
  assert.deepEqual(h.current().prepared_source_intent_refs, ["source-intent:fixture"]);
  const input = h.command("command:cancel-unapplied", { reason: "Withdraw this unapplied owner-control request before authoring." });
  const cancelled = await h.service.cancelUnapplied({ ...args, input });
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.next_action.code, "owner-bootstrap-cancelled");
  assert.equal(h.calls.unissued, 1); assert.equal(h.calls.stop, 0); assert.equal(h.calls.apply, 0);
  assert.deepEqual(await h.reopen().cancelUnapplied({ ...args, input }), cancelled);
  await assert.rejects(h.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId } }), /no open source purpose/);
  await h.service.create({ callerId, operatorId, input: { ...h.input, request_id: "bootstrap-request:next-explicit-request" } });
  assert.equal(h.store.list({ callerId }).length, 2);
});

test("uncertain cancellation retains the original command and must revoke approved access before proven pristine cleanup", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input }); h.approve(); await h.start();
  const input = h.command("command:cancel-unapplied", { reason: "Withdraw the still-pristine source session and revoke its exact access." });
  const stop = h.platform.stopSourceCredential; let failed = false;
  h.platform.stopSourceCredential = async value => { const result = await stop(value); if (!failed) { failed = true; throw new Error("Lost revocation acknowledgement"); } return result; };
  await assert.rejects(h.service.cancelUnapplied({ ...args, input }), /Lost revocation acknowledgement/);
  assert.equal(h.current().cancellation.state, "unknown"); assert.equal(h.calls.pristine, 0);
  const complete = await h.reopen().cancelUnapplied({ ...args, input });
  assert.equal(complete.state, "cancelled"); assert.equal(h.calls.unissued, 0); assert.equal(h.calls.pristine, 1);
  assert.deepEqual(complete.cancellation.command, input);
  const committed = harness(t); await committed.service.create({ callerId, operatorId, input: committed.input }); committed.approve(); await committed.start(); await committed.accept();
  await assert.rejects(committed.service.cancelUnapplied({ ...args, input: committed.command("command:cancel-committed", { reason: "This committed source must not be discarded as an unapplied draft." }) }), /Cancel only an unapplied draft/);
  assert.equal(committed.calls.stop, 0); assert.equal(committed.calls.pristine, 0);
});

test("cancellation reconciles an exact pre-journal preparation reference but never treats unavailable authority as absent", async t => {
  const h = harness(t); await h.service.create({ callerId, operatorId, input: h.input });
  await h.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId }, intentId: "source-intent:fixture" });
  const missing = Object.assign(new Error("Canonical preparation was never retained"), { statusCode: 404, code: "platform_source_intent_not_found" });
  h.platform.readSourcePreparation = async () => { throw missing; };
  h.platform.stopUnissuedSourcePreparation = async () => ({ state: "not-prepared", credential_issued: false });
  const input = h.command("command:cancel-before-journal", { reason: "Withdraw the preparation interrupted before its canonical journal write." });
  const result = await h.service.cancelUnapplied({ ...args, input });
  assert.equal(result.state, "cancelled");
  assert.deepEqual(result.cancellation.source_authorizations, [{ intent_id: "source-intent:fixture", outcome: "preparation-not-retained" }]);
  assert.equal(h.calls.stop, 0);
  const blocked = harness(t); await blocked.service.create({ callerId, operatorId, input: blocked.input });
  await blocked.service.prepareSourceCredential({ callerId, operatorId, subject: { kind: "repository-bootstrap", owner_repo: owner, source_request_id: args.requestId }, intentId: "source-intent:fixture" });
  blocked.platform.readSourcePreparation = async () => { throw Object.assign(new Error("Authority unavailable"), { statusCode: 503 }); };
  await assert.rejects(blocked.service.cancelUnapplied({ ...args, input: blocked.command("command:cancel-unavailable", { reason: "Withdraw only after the canonical authorization can be reconciled." }) }), /Authority unavailable/);
  assert.equal(blocked.current().cancellation.state, "unknown"); assert.equal(blocked.calls.pristine, 0);
});

test("completed existing-owner checkout provides source readiness without any bootstrap source or token", async t => {
  const h = harness(t, { existingControls: true });
  await h.service.create({ callerId, operatorId, input: h.input });
  await h.service.materializeExisting({ ...args, input: h.command("command:existing-readiness") });
  const ready = await h.service.ownerReadiness({ callerId, operatorId, ownerRepo: owner,
    providerRepository: { provider: "github", provider_repository_id: "123456789", full_name: `mfshaf7-workspace/${owner}` } });
  assert.equal(ready.scope, "source-owner-controls-readiness"); assert.equal(ready.app_acceptance, false);
  assert.equal(h.calls.credential, 0); assert.equal(h.calls.apply, 0);
});

test("owner-readiness requires a completed canonical checkout and current real profile; neither a planned scaffold nor changed profile qualifies", async t => {
  const h = harness(t);
  const selection = { callerId, operatorId, ownerRepo: owner, providerRepository: { provider: "github", provider_repository_id: "123456789", full_name: `mfshaf7-workspace/${owner}` } };
  await h.service.create({ callerId, operatorId, input: h.input });
  await assert.rejects(h.service.ownerReadiness(selection), /Complete the existing owner bootstrap/);
  assert.equal(h.calls.providerReads, 0);
  h.approve(); await h.start(); await h.accept();
  for (const action of ["publish", "review", "merge", "close"]) await h.service[action]({ ...args, input: h.deliver(action) });
  const ready = await h.service.ownerReadiness(selection);
  assert.equal(ready.scope, "source-owner-controls-readiness"); assert.equal(ready.app_acceptance, false); assert.equal(ready.inventory_admission, false);
  assert.equal(ready.canonical_checkout_commit, "f".repeat(40));
  h.changeActualProfile();
  await assert.rejects(h.service.ownerReadiness(selection), /reinspect the existing owner/);
});
