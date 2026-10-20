import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Readable } from "node:stream";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPrototypeAuthoringFacade, createPrototypeAuthoringRuntime } from "../src/source-authoring/runtime.js";
import { loadOpenApiSpec, resolveOperation, validateValueAgainstSchema } from "../scripts/api_contract_tools.mjs";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createPrototypeAuthoringStore } from "../src/source-authoring/prototype-store.js";
import { createPrototypeAuthoringService } from "../src/source-authoring/prototype-service.js";
import { createPrototypeSourceRealizationService } from "../src/source-authoring/prototype-realization.js";
import { textDigest } from "../src/source-authoring/context-contract.js";
import { prototypeOwnerChangeSet } from "../src/source-authoring/prototype-owner-preparation.js";

const A = "a".repeat(40); const B = "b".repeat(40);
const CALLER = "governance-operations-console"; const OPERATOR = "operator:owner"; const REQUEST = "prototype-source-request:example:1";
const INTENT = "source-intent:example/authoring+1";
function fixture(t, { ownerPreparation = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-realization-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = createPrototypeAuthoringStore({ root }); let millis = Date.parse("2026-10-18T15:00:00Z"); const clock = () => new Date(millis++);
  const request = { schema_version: 1, request_id: REQUEST, prototype_id: "prototype:example", expected_registry_revision: A, expected_source_revision: A,
    objective: "Draft a minimal synthetic example app.", requested_at: "2026-10-18T14:59:00Z",
    ...(ownerPreparation ? { owner_preparation: { kind: "preview-profile", port: 18199, support_profile: "interactive", runtime_activation: true,
      ttl_seconds: 3600, decision_ref: "record://operator-decisions/example-preview" } } : {}) };
  const entry = { id: "example", lifecycle: "exploring", source_custody: "incubation-repo", data_mode: "synthetic", visibility_tier: "operator-review",
    mutation_boundary: "prototype-local", paths: { design_profile: "docs/prototypes/example/design-profile.md" } };
  const records = { workflow_id: "prototype-records", authority_revision: A, registry: { prototypes: [entry] }, documents: {} };
  const subject = { kind: "prototype", prototype_id: "prototype:example", registry_ref: "record://prototypes/example", registry_revision: A,
    source_ref: "repo://workspace-prototype-studio/prototypes/example", source_revision: A };
  let guard = null; let approved = true; let ensureCalls = 0; let applyCalls = 0; let invokes = 0; let lost = false; let badOutput = false;
  let published = false; let reviewed = false; let merged = false; let revoked = false; let cleaned = false; let validationPass = true;
  const pullRequest = () => ({ state: merged ? "merged" : published ? "open" : "missing", head_commit: B, url: "https://github.com/example/workspace-prototype-studio/pull/1",
    review: { approved: reviewed }, merge_commit: merged ? "c".repeat(40) : null });
  const modelRequests = []; const sourceContexts = []; const authorizationScopes = []; let captureCalls = 0;
  const sourceExecutor = { executor: { run(context, operation) { sourceContexts.push(context); return operation(); }, async withSourceLeaseGuard(assertLease, operation) {
    const previous = guard; guard = assertLease; try { return await operation(); } finally { guard = previous; }
  } }, prototypeSource: {
    async validateSource() { if (!validationPass) throw Object.assign(new Error("Owner validation failed"), { code: "prototype_source_authoring_owner_validation_failed" }); return { result: "pass", source_revision: B, command: "make validate" }; },
    async publishAgentSource({ session }) { guard(session); published = true; return { state: "published", pushed_head: B }; },
    async inspectPullRequest() { return pullRequest(); },
    async approvePullRequest() { reviewed = true; return pullRequest(); },
    async mergePullRequest() { assert.equal(reviewed, true); merged = true; return pullRequest(); },
    async retireSourceResources() { assert.equal(merged, true); assert.equal(revoked, true); cleaned = true; return { complete: true, resources: [] }; },
    async inspectCommittedSource() { return { subject, prototype: entry, model_source_scope: { source_root: "prototypes/example", design_profile: entry.paths.design_profile },
      source_manifest: [{ path: "prototypes/example/README.md", content_digest: textDigest("readme") }], design_profile_digest: textDigest("design") }; },
    async inspectSourceCredentialBinding() { return { repository: "example/workspace-prototype-studio", repository_id: 123, installation_id: 456, human_reviewer_id: "owner", rotate_before_expiry_seconds: 900 }; },
    async ensureOwnedWorktree({ session }) { guard(session); ensureCalls++; return { resources: [{ resource_id: "owned-fixture-worktree" }] }; },
    async prepareOwner({ session }) {
      const { kind: _kind, decision_ref, ...intent } = session.owner_preparation;
      const nativeRequest = { schema_version: 1, prototype_id: session.prototype_id, source_revision: A, operator: { id: OPERATOR, decision_ref }, ...intent };
      const plan = { schema_version: 1, status: "preparation-only", subject, request_digest: canonicalDigest(nativeRequest), operator: nativeRequest.operator,
        changes: [{ operation: "write", path: "records/prototype-preview-profiles/example.yaml", expected_content_digest: null, content: "schema_version: 1\n" }],
        authority: { may_apply_source: false, may_invoke_model: false, may_approve_baseline: false, may_activate_runtime: false } };
      return { change_set: prototypeOwnerChangeSet({ ...plan, plan_digest: canonicalDigest(plan) }, session), plan_digest: canonicalDigest(plan),
        request_digest: plan.request_digest, authority: "workspace-prototype-studio", model_invoked: false, runtime_activated: false };
    },
    async captureRealizationContext({ session }) { captureCalls++; return { head_commit: A, context_digest: textDigest("fixture capture"), session_id: session.session_id, private_source: "private-test-value" }; },
    async applySourceRealization({ session, change_set }) {
      guard(session); applyCalls++;
      const receipt = { schema_version: 1, outcome: "committed", session_id: session.session_id, head_commit: B, change_set_digest: canonicalDigest(change_set) };
      if (lost && applyCalls === 1) throw Object.assign(new Error("committed but acknowledgement lost"), { code: "source_ack_unknown" });
      return receipt;
    },
  } };
  const authoringService = createPrototypeAuthoringService({ callerOperatorBindings: { [CALLER]: OPERATOR }, recordsReader: async () => records, sourceExecutor, store, clock });
  const platformOperations = { async ensureSourceCredential(scope) { authorizationScopes.push(scope); if (!approved) throw Object.assign(new Error("source authorization pending"), { code: "platform_source_credential_pending" }); },
    async withSourceLease({ sessionId, operation }) { if (!approved) throw new Error("source stopped"); return operation(session => { if (!approved || session.session_id !== sessionId) throw new Error("live source lease denied"); }); },
    async stopSourceCredential() { revoked = true; approved = false; return { state: "succeeded", receipt: { outcome: "revoked" } }; } };
  const lifecycleContext = { prepare({ record, executionId, capturedAt }) { return store.writeArtifact(REQUEST, { prototype_id: record.request.prototype_id, execution_id: executionId, captured_at: capturedAt }); },
    async project({ requestRef }) { const projection = store.readArtifact(requestRef); return { content: "redacted admitted packet", packet_ref: "/v1/context/packets/example",
      redaction_receipt_ref: "/v1/context/receipts/example", projection_receipt_ref: "/v1/context/lifecycle/projections/example", artifact_digest: textDigest("packet"),
      captured_at: projection.captured_at, source_revision: A, result_ref: requestRef }; } };
  const gatewayClient = { configured: true, async invoke(value) { invokes++; modelRequests.push(value); const binding = value.input.source_binding;
    return { policy_decision: "allow", policy_status: "active", profile_id: value.profile_id, decision_id: value.caller_identity.decision_or_correlation_id,
      caller_id: value.caller_identity.caller_id, invocation_path: "governed-ai-gateway", generated_at: clock().toISOString(), binding_selection_ref: "model-binding:existing", audit_ref: "audit:example",
      output: { schema_version: 1, change_set_id: "prototype-draft:1", session_id: binding.session_id, base_commit: binding.base_commit, objective_digest: binding.objective_digest,
        commit_message: "feat: add synthetic example source", operations: [{ action: "create", path: badOutput ? "prototypes/other/source.txt" : "prototypes/example/source.txt", content: "Synthetic test draft.\n", expected_digest: null }] } }; } };
  const dependencies = { authoringService, store, sourceExecutor, platformOperations, lifecycleContext, gatewayClient, clock, enabled: true };
  const service = createPrototypeSourceRealizationService(dependencies);
  const args = { callerId: CALLER, operatorId: OPERATOR, requestId: REQUEST };
  const create = () => authoringService.create({ callerId: CALLER, operatorId: OPERATOR, input: request });
  const start = () => service.startSession({ ...args, input: { schema_version: 1, command_id: "prototype-start:1", source_intent_ref: INTENT, requested_at: clock().toISOString() } });
  const generation = (id = "prototype-generation:1", retry = null) => ({ schema_version: 1, request_id: id, execution_id: `execution:${id}`,
    expected_revision: service.read(args).realization.revision, budget_tokens: 4000, retry_of: retry, requested_at: clock().toISOString(), source_intent_ref: INTENT });
  const command = (projection, id, digest = projection.attempt?.change_set?.digest) => ({ schema_version: 1, command_id: id, expected_revision: projection.revision,
    ...(digest ? { accepted_change_set_digest: digest } : {}), requested_at: clock().toISOString() });
  return { service, dependencies, args, create, start, generation, command, store, modelRequests, sourceContexts, authorizationScopes, clock, request,
    get captureCalls() { return captureCalls; },
    get invokes() { return invokes; }, get applyCalls() { return applyCalls; }, get ensureCalls() { return ensureCalls; },
    get published() { return published; }, get reviewed() { return reviewed; }, get merged() { return merged; }, get revoked() { return revoked; }, get cleaned() { return cleaned; },
    setValidationPass(value) { validationPass = value; },
    setApproved(value) { approved = value; }, setLost(value) { lost = value; }, setBadOutput(value) { badOutput = value; } };
}

test("actual Prototype workflow starts its real session, generates only a draft, then applies only exact acceptance", async t => {
  const f = fixture(t); await f.create(); const started = await f.start();
  assert.match(started.session_id, /^prototype-source-session:[0-9a-f]{64}$/); assert.equal(f.ensureCalls, 1);
  const input = f.generation(); const draft = await f.service.generate({ ...f.args, input });
  assert.equal(draft.state, "draft-ready"); assert.equal(f.applyCalls, 0); assert.equal(f.invokes, 1);
  assert.equal(JSON.stringify(f.modelRequests).includes("private-test-value"), false);
  assert.equal(f.modelRequests[0].caller_identity.caller_id, "operator-orchestration-service/prototype-source-authoring");
  assert.equal(f.modelRequests[0].task.contract_ref, "oos.prototype.source-authoring.v1");
  assert.equal(f.sourceContexts.every(context => !Object.hasOwn(context, "work_item_id")), true);
  await assert.rejects(f.service.continue({ ...f.args, input: { command: f.command(draft, "accept:wrong", textDigest("other")), source_intent_ref: INTENT } }),
    { code: "prototype_source_authoring_acceptance_mismatch" });
  assert.equal(f.applyCalls, 0);
  const command = f.command(draft, "accept:exact");
  const applied = await f.service.continue({ ...f.args, input: { command, source_intent_ref: INTENT } });
  assert.equal(applied.state, "source-created"); assert.equal(applied.attempt.source_receipt.head_commit, B); assert.equal(f.applyCalls, 1);
  f.setApproved(false);
  const cold = createPrototypeSourceRealizationService(f.dependencies);
  assert.equal((await cold.continue({ ...f.args, input: { command, source_intent_ref: INTENT } })).replayed, true);
  assert.equal((await cold.generate({ ...f.args, input })).replayed, true); assert.equal(f.invokes, 1); assert.equal(f.applyCalls, 1);
});

test("pending approval cannot create source or poison generation journal, and the same real session survives", async t => {
  const f = fixture(t); await f.create(); f.setApproved(false);
  await assert.rejects(f.start(), { code: "platform_source_credential_pending" }); assert.equal(f.ensureCalls, 0);
  const sessionId = f.service.read(f.args).session_id; f.setApproved(true); await f.start();
  assert.equal(f.service.read(f.args).session_id, sessionId);
  const input = f.generation(); f.setApproved(false);
  await assert.rejects(f.service.generate({ ...f.args, input }), { code: "platform_source_credential_pending" });
  assert.equal(f.service.read(f.args).realization.attempt, null); assert.equal(f.invokes, 0);
  f.setApproved(true); assert.equal((await f.service.generate({ ...f.args, input })).state, "draft-ready");
});

test("out-of-scope model draft is denied without source writes; retry remains explicitly linked", async t => {
  const f = fixture(t); await f.create(); await f.start(); f.setBadOutput(true);
  const first = f.generation();
  await assert.rejects(f.service.generate({ ...f.args, input: first }), { code: "prototype_source_authoring_model_result_invalid" });
  assert.equal(f.service.read(f.args).realization.state, "failed"); assert.equal(f.applyCalls, 0);
  f.setBadOutput(false);
  const beforeInvalid = f.authorizationScopes.length;
  await assert.rejects(f.service.generate({ ...f.args, input: f.generation("prototype-generation:2") }), { code: "prototype_source_authoring_generation_precondition_failed" });
  assert.equal(f.authorizationScopes.length, beforeInvalid);
  const retry = f.generation("prototype-generation:2", first.request_id);
  assert.equal((await f.service.generate({ ...f.args, input: retry })).state, "draft-ready");
  await assert.rejects(f.service.generate({ ...f.args, input: { ...retry, budget_tokens: 5000 } }), { code: "prototype_source_authoring_replay_conflict" });
});

test("lost apply acknowledgement reconciles the retained exact draft without model rerun or cancelling committed source", async t => {
  const f = fixture(t); await f.create(); await f.start();
  const draft = await f.service.generate({ ...f.args, input: f.generation() }); f.setLost(true);
  await assert.rejects(f.service.continue({ ...f.args, input: { command: f.command(draft, "apply:lost"), source_intent_ref: INTENT } }), { code: "source_ack_unknown" });
  const unknown = f.service.read(f.args).realization; assert.equal(unknown.state, "apply-unknown");
  await assert.rejects(f.service.cancelAttempt({ ...f.args, input: { ...f.command(unknown, "cancel:unsafe", null), reason: "Do not erase source that may already have committed." } }),
    { code: "prototype_source_authoring_cancel_not_allowed" });
  const cold = createPrototypeSourceRealizationService(f.dependencies);
  const recovered = await cold.recover({ ...f.args, input: { command: f.command(unknown, "recover:exact", null), source_intent_ref: INTENT } });
  assert.equal(recovered.state, "source-created"); assert.equal(recovered.attempt.source_receipt.head_commit, B); assert.equal(f.invokes, 1);
});

test("unapplied draft cancellation survives cold read and allows only a linked next generation", async t => {
  const f = fixture(t); await f.create(); await f.start(); const input = f.generation();
  const draft = await f.service.generate({ ...f.args, input });
  const cancelled = await f.service.cancelAttempt({ ...f.args, input: { ...f.command(draft, "cancel:unapplied", null), reason: "Discard this unapplied draft before a revised attempt." } });
  assert.equal(cancelled.state, "cancelled"); assert.equal(f.applyCalls, 0);
  const cold = createPrototypeSourceRealizationService(f.dependencies); assert.equal(cold.read(f.args).realization.state, "cancelled");
  assert.equal((await cold.generate({ ...f.args, input: f.generation("prototype-generation:next", input.request_id) })).state, "draft-ready");
});

test("Prototype source delivery validates, publishes, exact-reviews, merges and revokes before owned cleanup", async t => {
  const f = fixture(t); await f.create(); await f.start();
  const draft = await f.service.generate({ ...f.args, input: f.generation() });
  assert.equal(f.service.draft(f.args).digest, draft.attempt.change_set.digest);
  await f.service.continue({ ...f.args, input: { command: f.command(draft, "apply:delivery"), source_intent_ref: INTENT } });
  const control = (id, expected = null) => ({ schema_version: 1, command_id: id, expected_revision: f.service.read(f.args).realization.revision,
    requested_at: f.clock().toISOString(), expected_pull_request: expected });
  const publish = control("publish:exact"); f.setValidationPass(false);
  await assert.rejects(f.service.publish({ ...f.args, input: { command: publish, source_intent_ref: INTENT } }), { code: "prototype_source_authoring_owner_validation_failed" });
  assert.equal(f.published, false); assert.equal(f.reviewed, false);
  const interrupted = createPrototypeSourceRealizationService(f.dependencies).read(f.args);
  assert.deepEqual(interrupted.source_delivery.publish.command, publish);
  assert.notEqual(interrupted.realization.revision, publish.expected_revision);
  f.setValidationPass(true);
  const published = await f.service.publish({ ...f.args, input: { command: interrupted.source_delivery.publish.command, source_intent_ref: INTENT } });
  const expected = { url: published.source_delivery.publish.pull_request.url, head_commit: B };
  assert.equal(published.next_action.code, "prototype-source-human-review-required");
  await assert.rejects(f.service.merge({ ...f.args, input: { command: control("merge:too-early", expected) } }), { code: "prototype_source_authoring_delivery_precondition_failed" });
  await assert.rejects(f.service.review({ ...f.args, input: { command: control("review:wrong", { ...expected, head_commit: A }) } }), { code: "prototype_source_authoring_review_binding_changed" });
  const review = control("review:exact", expected);
  await f.service.review({ ...f.args, input: { command: review } }); assert.equal(f.reviewed, true);
  await f.service.merge({ ...f.args, input: { command: control("merge:exact", expected) } }); assert.equal(f.merged, true);
  assert.equal(f.cleaned, false); assert.equal(f.revoked, false);
  const close = control("close:exact", expected);
  const completed = await f.service.close({ ...f.args, input: { command: close } });
  assert.equal(completed.state, "succeeded"); assert.equal(completed.next_action.code, "prototype-source-complete"); assert.equal(f.revoked, true); assert.equal(f.cleaned, true);
  const cold = createPrototypeSourceRealizationService(f.dependencies);
  assert.equal((await cold.close({ ...f.args, input: { command: close } })).replayed, true);
  assert.equal(f.invokes, 1); assert.equal(f.applyCalls, 1);
});

test("normal authenticated HTTP routes match their documented DTOs across actual Prototype workflow create-to-close", async t => {
  const f = fixture(t); const spec = loadOpenApiSpec();
  const config = loadConfig({ CALLER_ALLOWED_IDS: CALLER, CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [CALLER]: "test-secret" }) });
  const facade = createPrototypeAuthoringFacade({ authoringService: f.dependencies.authoringService, realizationService: f.service, operatorBindings: { [CALLER]: OPERATOR } });
  const app = createApp({ config, prototypeAuthoringService: facade });
  async function invoke(method, url, input, { secret = "test-secret", contract = true, accept = null } = {}) {
    const request = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
    Object.assign(request, { method, url, headers: { "x-oos-caller-id": CALLER, "x-oos-caller-secret": secret, ...(accept ? { accept } : {}) } });
    let code; let body = "";
    await app(request, { writeHead(value) { code = value; }, end(value) { body += value ?? ""; } });
    const result = JSON.parse(body);
    if (contract) {
      const operation = resolveOperation(spec, method, url.split("?")[0])?.operation;
      assert.ok(operation, `documented ${method} route`);
      if (input !== undefined) assert.deepEqual(validateValueAgainstSchema(spec, operation.requestBody.content["application/json"].schema, input), []);
      const media = code === 200 && accept?.endsWith("version=1") ? "application/vnd.mfshaf7.console-source-projection+json" : "application/json";
      assert.deepEqual(validateValueAgainstSchema(spec, operation.responses[String(code)].content[media].schema, result), []);
    }
    return { code, body: result };
  }
  const base = `/v1/prototype-source-requests/${encodeURIComponent(REQUEST)}`;
  assert.equal((await invoke("POST", "/v1/prototype-source-requests", f.request)).code, 200);
  assert.equal((await invoke("GET", "/v1/prototype-source-requests?limit=10")).body.requests.length, 1);
  assert.equal((await invoke("GET", base)).body.state, "prepared");
  const canonical = { accept: "application/vnd.mfshaf7.console-source-projection+json; version=1" };
  const envelope = (await invoke("GET", base, undefined, canonical)).body;
  assert.equal(envelope.artifact_type, "console-source-projection"); assert.equal(envelope.binding.authority, "operator-orchestration-service");
  assert.equal(envelope.binding.source_owner, "operator-orchestration-service"); assert.equal(envelope.projection.request_id, REQUEST);
  assert.equal((await invoke("GET", "/v1/prototype-source-requests", undefined, canonical)).body.projection.requests.length, 1);
  assert.equal((await invoke("GET", base, undefined, { accept: "application/vnd.mfshaf7.console-source-projection+json; version=2" })).code, 406);
  assert.equal((await invoke("GET", base, undefined, { secret: "wrong", contract: false })).code, 401);
  assert.equal((await invoke("POST", "/v1/prototype-source-requests", { ...f.request, repository: "attacker/other" }, { contract: false })).code, 400);
  assert.equal((await invoke("GET", "/v1/prototype-source-requests?limit=10garbage", undefined, { contract: false })).code, 400);
  const started = await invoke("POST", `${base}/session`, { schema_version: 1, command_id: "start:api", source_intent_ref: INTENT, requested_at: f.clock().toISOString() });
  assert.equal(started.code, 200);
  const generated = (await invoke("POST", `${base}/generate`, f.generation())).body;
  const draft = (await invoke("GET", `${base}/draft`)).body; assert.equal(draft.digest, generated.attempt.change_set.digest);
  assert.equal((await invoke("GET", `${base}/draft`, undefined, canonical)).body.projection.digest, draft.digest);
  await invoke("POST", `${base}/accept`, { command: f.command(generated, "accept:api"), source_intent_ref: INTENT });
  const command = (id, expected = null) => ({ schema_version: 1, command_id: id, expected_revision: f.service.read(f.args).realization.revision,
    requested_at: f.clock().toISOString(), expected_pull_request: expected });
  const published = (await invoke("POST", `${base}/publish`, { command: command("publish:api"), source_intent_ref: INTENT })).body;
  const expected = { url: published.source_delivery.publish.pull_request.url, head_commit: B };
  await invoke("POST", `${base}/review`, { command: command("review:api", expected) });
  await invoke("POST", `${base}/merge`, { command: command("merge:api", expected) });
  const completed = (await invoke("POST", `${base}/close`, { command: command("close:api", expected) })).body;
  assert.equal(completed.state, "succeeded"); assert.equal(f.invokes, 1); assert.equal(f.applyCalls, 1);
});

test("Prototype authoring reuses existing source composition and absent dependencies do not enable it or break Delivery", () => {
  assert.equal(createPrototypeAuthoringRuntime({ config: { sourceRealization: { enabled: false } } }), null);
  assert.equal(createPrototypeAuthoringRuntime({ config: { sourceRealization: { enabled: true } }, profile: "dev-integration" }), null);
});

test("cold interrupted generation retains its original request/capture/model binding and can use only verified fresh authorization", async t => {
  const f = fixture(t); await f.create(); await f.start(); const input = f.generation();
  await f.service.generate({ ...f.args, input });
  const metadata = f.store.get(REQUEST); const record = f.store.readArtifact(metadata.realization_ref); const attempt = record.attempts.at(-1);
  assert.deepEqual(attempt.request, input); assert.deepEqual(f.service.read(f.args).source_request, f.request);
  // Simulate a broker crash after retaining invocation intent but before
  // retaining the model response. No source action was accepted or applied.
  attempt.state = "accepted"; attempt.change_set = null; attempt.change_set_digest = null; attempt.completed_at = null;
  const reference = f.store.writeArtifact(REQUEST, record);
  await f.store.transact(REQUEST, ({ current, put }) => put({ ...current, realization_ref: reference }));
  const cold = createPrototypeSourceRealizationService(f.dependencies);
  const retained = cold.read(f.args).realization.attempt.request;
  assert.deepEqual(retained, input);
  const successor = "source-intent:explicit-successor";
  const resumed = await cold.generate({ ...f.args, input: { ...retained, source_intent_ref: successor } });
  assert.equal(resumed.state, "draft-ready"); assert.equal(resumed.attempt.execution_id, input.execution_id);
  assert.equal(f.captureCalls, 1); assert.deepEqual(f.modelRequests[0], f.modelRequests[1]); assert.equal(f.applyCalls, 0);
  assert.equal(f.authorizationScopes.at(-1).previousIntentId, INTENT);
  assert.equal(f.authorizationScopes.at(-1).intentId, successor);
  assert.equal(f.store.get(REQUEST).source_intent_ref, successor);
});

test("every intermediate visible source mutation advances canonical ordering even within one clock millisecond", async t => {
  const f = fixture(t); await f.create(); await f.start(); const observed = [];
  const transact = f.store.transact;
  f.store.transact = (requestId, operation) => transact(requestId, ({ current, put }) => operation({ current, put(value) {
    const saved = put(value); observed.push({ revision: saved.updated_at, digest: canonicalDigest(f.service.read(f.args)) }); return saved;
  } }));
  const fixed = "2026-10-18T16:00:00.000Z";
  const service = createPrototypeSourceRealizationService({ ...f.dependencies, clock: () => new Date(fixed), gatewayClient: {
    configured: true, async invoke(request) { return { ...await f.dependencies.gatewayClient.invoke(request), generated_at: fixed }; },
  } });
  const draft = await service.generate({ ...f.args, input: f.generation() }); assert.equal(draft.state, "draft-ready");
  assert.ok(observed.length >= 4);
  for (let i = 1; i < observed.length; i++) {
    assert.notEqual(observed[i].digest, observed[i - 1].digest);
    assert.ok(Date.parse(observed[i].revision) > Date.parse(observed[i - 1].revision));
  }
});

test("trusted owner preparation reuses source acceptance, cold lost-ack recovery and delivery without context/model invocation", async t => {
  const f = fixture(t, { ownerPreparation: true }); await f.create(); await f.start();
  const draft = await f.service.generate({ ...f.args, input: f.generation() });
  assert.equal(draft.state, "draft-ready"); assert.equal(f.invokes, 0); assert.equal(f.captureCalls, 0); assert.equal(f.applyCalls, 0);
  assert.equal(draft.attempt.owner_preparation.authority, "workspace-prototype-studio");
  assert.equal(draft.attempt.owner_preparation.model_invoked, false); assert.equal(draft.attempt.model, null); assert.equal(draft.attempt.context, null);
  assert.equal(f.service.draft(f.args).change_set.operations[0].path, "records/prototype-preview-profiles/example.yaml");
  const input = { command: f.command(draft, "apply:owner-plan"), source_intent_ref: INTENT };
  f.setLost(true);
  await assert.rejects(f.service.continue({ ...f.args, input }), { code: "source_ack_unknown" });
  const cold = createPrototypeSourceRealizationService(f.dependencies);
  const recovered = await cold.recover({ ...f.args, input: { command: f.command(cold.read(f.args).realization, "recover:owner-plan", null), source_intent_ref: INTENT } });
  assert.equal(recovered.state, "source-created"); assert.equal(f.invokes, 0);
  const control = (id, expected = null) => ({ command: { schema_version: 1, command_id: id, expected_revision: cold.read(f.args).realization.revision,
    requested_at: f.clock().toISOString(), expected_pull_request: expected } });
  const published = await cold.publish({ ...f.args, input: { ...control("publish:owner-plan"), source_intent_ref: INTENT } });
  const expected = { url: published.source_delivery.publish.pull_request.url, head_commit: B };
  await cold.review({ ...f.args, input: control("review:owner-plan", expected) });
  await cold.merge({ ...f.args, input: control("merge:owner-plan", expected) });
  assert.equal((await cold.close({ ...f.args, input: control("close:owner-plan", expected) })).state, "succeeded");
  assert.equal(f.revoked, true); assert.equal(f.cleaned, true); assert.equal(f.invokes, 0);
});
