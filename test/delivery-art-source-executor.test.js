import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeliveryArtSourceExecutorClient,
  createDeliveryArtSourceExecutorServer,
} from "../src/delivery-art/source-executor.js";

const SECRET = "source-executor-test-secret-material-1234567890";

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function context() {
  return {
    caller_id: "governance-operations-console",
    command_id: "work-session-command:test",
    operator_id: "operator:test",
    session_id: "work-session:test",
    work_item_id: "work-item-1027",
  };
}

function adapters(calls, configuredPathCalls = []) {
  return {
    lifecycleSource: {
      acquireEvidence: async (input) => ({
        acquisition_id: "owner-evidence:test",
        source_revision: input.source.head_commit,
      }),
      inspect: async (landingUnit) => ({ branch: landingUnit.branch, state: "pushed" }),
      pullRequest: async () => ({ state: "open" }),
    },
    workSource: {
      applySourceRealization: async (_session, changeSet) => ({
        schema_version: 1,
        receipt_id: "source-realization-receipt:test",
        outcome: "committed",
        head_commit: "d".repeat(40),
        receipt_digest: `sha256:${"e".repeat(64)}`,
        change_set_id: changeSet.change_set_id,
      }),
      captureRealizationContext: async () => ({
        schema_version: 1,
        clean: true,
        context_digest: `sha256:${"f".repeat(64)}`,
      }),
      ensureOwnedWorktree: async () => ({ path: "/workspace/repo", resources: [] }),
      ensureWorktree: async () => "/workspace/repo",
      inspectConfiguredPath: async (session, requirements) => {
        configuredPathCalls.push({ requirements, session });
        return { ready: true, state: "implementation-ready" };
      },
      inspectRepositoryAdmission: async () => ({
        owner_repo: "operator-orchestration-service",
        state: "ready",
      }),
      inspectAgentSource: async () => ({ logical_agent_id: "agent-gary", state: "ready" }),
      inspectPullRequest: async () => ({ state: "open" }),
      inspectResourceOwnership: async () => ({ path: null, resources: [] }),
      mergePullRequest: async (_session, expectedPullRequest) => ({
        ...expectedPullRequest,
        merge_commit: "b".repeat(40),
        state: "merged",
      }),
      planResourceRetirement: async () => [],
      prepareAgentSource: async () => ({ action: "configure-exact-git-author", state: "author-ready" }),
      prepareResourceRetirementExecution: async () => ({ relocated: false }),
      readArtifact: async (location) => ({ location }),
      publishAgentSource: async () => ({
        action: "publish-exact-source",
        pushed_head: "a".repeat(40),
        secret_values_embedded: false,
        state: "published",
      }),
      resolveBase: async (input) => {
        calls.push(input);
        return { commit: "a".repeat(40), repo_root: "/workspace/repo" };
      },
      resolveWorktree: async () => "/workspace/repo",
      retireResource: async () => undefined,
    },
  };
}

test("source executor exposes only authenticated finite actions with bound context", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-executor-"));
  const socketPath = path.join(root, "executor.sock");
  const calls = [];
  const configuredPathCalls = [];
  const audit = [];
  const server = createDeliveryArtSourceExecutorServer({
    adapters: adapters(calls, configuredPathCalls),
    audit: (event) => audit.push(event),
    executorId: "delivery-source-executor",
    secret: SECRET,
  });
  await listen(server, socketPath);
  try {
    const client = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath,
    });
    await client.executor.assertAvailable();
    const result = await client.executor.run(context(), () =>
      client.workSource.resolveBase({ baseRef: "origin/main", ownerRepo: "repo" }));
    const merged = await client.executor.run(context(), () =>
      client.workSource.mergePullRequest(
        { landing_unit: { branch: "feature/test" } },
        { head_commit: "a".repeat(40), state: "open", url: "https://example.test/pr/1" },
      ));
    const identity = await client.executor.run(context(), () =>
      client.workSource.inspectAgentSource({ landing_unit_id: "test-unit" }));
    const configuredPath = await client.executor.run(context(), () =>
      client.workSource.inspectConfiguredPath(
        { landing_unit_id: "test-unit" },
        {
          conformanceCases: [{ fidelity: "live-backend", id: "case:operating" }],
          requiredEvidenceKinds: ["runtime_and_live"],
        },
      ));
    const admission = await client.executor.run(context(), () =>
      client.workSource.inspectRepositoryAdmission({ landing_unit_id: "test-unit" }));
    const prepared = await client.executor.run(context(), () =>
      client.workSource.prepareAgentSource({ landing_unit_id: "test-unit" }));
    const published = await client.executor.run(context(), () =>
      client.workSource.publishAgentSource({ landing_unit_id: "test-unit" }));
    const evidence = await client.executor.run(context(), () =>
      client.lifecycleSource.acquireEvidence({
        source: { head_commit: "c".repeat(40) },
      }));
    assert.equal(result.commit, "a".repeat(40));
    assert.equal(merged.state, "merged");
    assert.equal(identity.logical_agent_id, "agent-gary");
    assert.equal(configuredPath.state, "implementation-ready");
    assert.equal(admission.state, "ready");
    assert.equal(prepared.state, "author-ready");
    assert.equal(published.state, "published");
    assert.equal(evidence.source_revision, "c".repeat(40));
    assert.deepEqual(calls, [{ baseRef: "origin/main", ownerRepo: "repo" }]);
    assert.deepEqual(configuredPathCalls, [{
      requirements: {
        conformanceCases: [{ fidelity: "live-backend", id: "case:operating" }],
        requiredEvidenceKinds: ["runtime_and_live"],
      },
      session: { landing_unit_id: "test-unit" },
    }]);
    assert.deepEqual(audit.map((event) => event.action), [
      "work.resolve-base",
      "work.merge-pull-request",
      "work.inspect-agent-source",
      "work.inspect-configured-path",
      "work.inspect-repository-admission",
      "work.prepare-agent-source",
      "work.publish-agent-source",
      "lifecycle.acquire-evidence",
    ]);
    assert.equal(audit.every((event) =>
      event.caller_id === "governance-operations-console" &&
      event.command_id === "work-session-command:test" &&
      event.executor_id === "delivery-source-executor" &&
      event.operator_id === "operator:test" &&
      event.outcome === "completed" &&
      event.session_id === "work-session:test" &&
      event.work_item_id === "work-item-1027"), true);
  } finally {
    await close(server);
    rmSync(root, { force: true, recursive: true });
  }
});

test("normal executor client checks the private lease before each real source dispatch and never sends it over the socket", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-lease-socket-"));
  const socketPath = path.join(root, "executor.sock");
  let writes = 0; const audit = [];
  const configured = adapters([]);
  configured.workSource.prepareAgentSource = async () => { writes++; return { state: "author-ready" }; };
  const server = createDeliveryArtSourceExecutorServer({ adapters: configured, audit: event => audit.push(event), executorId: "lease-executor", secret: SECRET });
  await listen(server, socketPath);
  t.after(async () => { await close(server); rmSync(root, { recursive: true, force: true }); });
  const client = createDeliveryArtSourceExecutorClient({ executorId: "lease-executor", secret: SECRET, socketPath, requireSourceLease: true });
  await client.executor.run(context(), async () => {
    await client.workSource.inspectAgentSource({ landing_unit_id: "test-unit" });
    await assert.rejects(client.workSource.prepareAgentSource({ landing_unit_id: "test-unit" }), { code: "delivery_art_source_lease_required" });
  });
  let allowed = true; let checks = 0;
  await client.executor.withSourceLeaseGuard(session => {
    checks++; assert.equal(session.landing_unit_id, "test-unit");
    if (!allowed) throw Object.assign(new Error("approval expired before the next actual write"), { code: "platform_source_intent_expired" });
  }, () => client.executor.run(context(), async () => {
    assert.equal((await client.workSource.prepareAgentSource({ landing_unit_id: "test-unit" })).state, "author-ready");
    allowed = false;
    await assert.rejects(client.workSource.prepareAgentSource({ landing_unit_id: "test-unit" }), { code: "platform_source_intent_expired" });
  }));
  assert.equal(checks, 2); assert.equal(writes, 1);
  assert.equal(audit.length, 2);
  assert.equal(JSON.stringify(audit).includes("assert_source_lease"), false);
});

test("Prototype source actions retain their actual subject/request and cannot reuse Delivery context or vice versa", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-prototype-context-"));
  const socketPath = path.join(root, "executor.sock"); const audit = []; let inspections = 0;
  const configured = adapters([]);
  configured.prototypeSource = { inspectCommittedSource(input) { inspections++; return { subject: { kind: "prototype", prototype_id: input.prototype_id }, source_revision: input.source_revision }; } };
  const server = createDeliveryArtSourceExecutorServer({ adapters: configured, audit: value => audit.push(value), executorId: "prototype-executor", secret: SECRET });
  await listen(server, socketPath); t.after(async () => { await close(server); rmSync(root, { recursive: true, force: true }); });
  const client = createDeliveryArtSourceExecutorClient({ executorId: "prototype-executor", secret: SECRET, socketPath });
  const prototype = { caller_id: "console", operator_id: "operator:test", prototype_id: "prototype:proposal-42", source_request_id: "prototype-source-request:42", session_id: null, command_id: null };
  const input = { prototype_id: prototype.prototype_id, source_revision: "a".repeat(40) };
  const observed = await client.executor.run(prototype, () => client.prototypeSource.inspectCommittedSource(input));
  assert.equal(observed.subject.prototype_id, prototype.prototype_id);
  await assert.rejects(client.executor.run(context(), () => client.prototypeSource.inspectCommittedSource(input)), { code: "prototype_source_executor_context_invalid" });
  await assert.rejects(client.executor.run({ ...prototype, work_item_id: "work-item-42" }, () => client.prototypeSource.inspectCommittedSource(input)), { code: "prototype_source_executor_context_invalid" });
  await assert.rejects(client.executor.run({ ...context(), ...prototype }, () => client.workSource.resolveBase({ ownerRepo: "workspace-prototype-studio", baseRef: "origin/main" })), { code: "delivery_art_source_executor_context_invalid" });
  await assert.rejects(client.executor.run(prototype, () => client.prototypeSource.inspectCommittedSource({ ...input, prototype_id: "prototype:other" })), { code: "prototype_source_executor_subject_mismatch" });
  assert.equal(inspections, 1);
  assert.equal(audit[0].prototype_id, prototype.prototype_id); assert.equal(audit[0].source_request_id, prototype.source_request_id);
  assert.equal(Object.hasOwn(audit[0], "work_item_id"), false);
});

test("owner-bootstrap executor uses only its real repository context and checks the private lease before every write", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-bootstrap-context-"));
  const socketPath = path.join(root, "executor.sock");
  const audit = []; let inspections = 0; let writes = 0;
  const configured = adapters([]);
  configured.bootstrapSource = {
    inspectSourceCredentialBinding: async input => { inspections++; return { owner_repo: input.owner_repo, purpose: "trusted-owner-bootstrap" }; },
    ensureOwnedWorktree: async () => { writes++; return { resources: [] }; },
  };
  const server = createDeliveryArtSourceExecutorServer({ adapters: configured, audit: value => audit.push(value), executorId: "bootstrap-executor", secret: SECRET });
  await listen(server, socketPath); t.after(async () => { await close(server); rmSync(root, { recursive: true, force: true }); });
  const client = createDeliveryArtSourceExecutorClient({ executorId: "bootstrap-executor", secret: SECRET, socketPath, requireSourceLease: true });
  const bootstrap = { caller_id: "console", operator_id: "operator:test", owner_repo: "example-source",
    bootstrap_request_id: "bootstrap-request:example-source", session_id: "bootstrap-session:example-source", command_id: null };
  const input = { owner_repo: bootstrap.owner_repo, session: { caller_id: bootstrap.caller_id, operator: { id: bootstrap.operator_id },
    owner_repo: bootstrap.owner_repo, source_request_id: bootstrap.bootstrap_request_id, session_id: bootstrap.session_id } };
  await client.executor.run(bootstrap, async () => {
    assert.equal((await client.bootstrapSource.inspectSourceCredentialBinding(input)).purpose, "trusted-owner-bootstrap");
    await assert.rejects(client.bootstrapSource.ensureOwnedWorktree(input), { code: "delivery_art_source_lease_required" });
    await assert.rejects(client.bootstrapSource.inspectSourceCredentialBinding({ ...input, owner_repo: "another-source" }), { code: "bootstrap_source_executor_subject_mismatch" });
  });
  await assert.rejects(client.executor.run(context(), () => client.bootstrapSource.inspectSourceCredentialBinding(input)), { code: "bootstrap_source_executor_context_invalid" });
  await assert.rejects(client.executor.run({ ...bootstrap, work_item_id: "work-item-1" }, () => client.bootstrapSource.inspectSourceCredentialBinding(input)), { code: "bootstrap_source_executor_context_invalid" });
  await assert.rejects(client.executor.run(bootstrap, () => client.workSource.resolveBase({})), { code: "delivery_art_source_executor_context_invalid" });
  let allowed = true; let checks = 0;
  await client.executor.withSourceLeaseGuard(session => {
    checks++; assert.equal(session.session_id, bootstrap.session_id);
    if (!allowed) throw Object.assign(new Error("Stopped bootstrap intent"), { code: "platform_source_intent_stopped" });
  }, () => client.executor.run(bootstrap, async () => {
    await client.bootstrapSource.ensureOwnedWorktree(input); allowed = false;
    await assert.rejects(client.bootstrapSource.ensureOwnedWorktree(input), { code: "platform_source_intent_stopped" });
  }));
  assert.equal(inspections, 1); assert.equal(writes, 1); assert.equal(checks, 2);
  assert.ok(audit.every(value => !Object.hasOwn(value, "work_item_id") && !Object.hasOwn(value, "prototype_id")));
  assert.equal(JSON.stringify(audit).includes("assert_source_lease"), false);
});

test("bootstrap wire shape does not activate an absent trusted executor adapter", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-bootstrap-absent-"));
  const socketPath = path.join(root, "executor.sock");
  const server = createDeliveryArtSourceExecutorServer({ adapters: adapters([]), executorId: "bootstrap-executor", secret: SECRET });
  await listen(server, socketPath); t.after(async () => { await close(server); rmSync(root, { recursive: true, force: true }); });
  const client = createDeliveryArtSourceExecutorClient({ executorId: "bootstrap-executor", secret: SECRET, socketPath });
  await assert.rejects(client.executor.run({ caller_id: "console", operator_id: "operator:test", owner_repo: "example-source",
    bootstrap_request_id: "bootstrap-request:example-source", session_id: null },
  () => client.bootstrapSource.inspectSourceCredentialBinding({ owner_repo: "example-source" })), { code: "bootstrap_source_executor_unavailable" });
});

test("source executor rejects missing context and incorrect credentials", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-executor-"));
  const socketPath = path.join(root, "executor.sock");
  const server = createDeliveryArtSourceExecutorServer({
    adapters: adapters([]),
    executorId: "delivery-source-executor",
    secret: SECRET,
  });
  await listen(server, socketPath);
  try {
    const valid = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath,
    });
    await assert.rejects(
      valid.workSource.resolveBase({ baseRef: "origin/main", ownerRepo: "repo" }),
      { code: "delivery_art_source_executor_context_invalid" },
    );
    const invalid = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: `${SECRET}-wrong`,
      socketPath,
    });
    await assert.rejects(invalid.executor.assertAvailable(), {
      code: "delivery_art_source_executor_unauthorized",
    });
  } finally {
    await close(server);
    rmSync(root, { force: true, recursive: true });
  }
});

test("source executor durably replays completed evidence after its caller disappears", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-executor-replay-"));
  const resultStoreRoot = path.join(root, "results");
  let acquisitionCalls = 0;
  const audit = [];
  const firstAdapters = adapters([]);
  firstAdapters.lifecycleSource.acquireEvidence = async (input) => {
    acquisitionCalls += 1;
    return {
      artifact_type: "delivery_art_owner_evidence_receipt",
      acquisition_id: "owner-evidence:durable",
      results: [{ result: "pass" }],
      source_revision: input.source.head_commit,
    };
  };
  const firstServer = createDeliveryArtSourceExecutorServer({
    adapters: firstAdapters,
    audit: (event) => audit.push(event),
    executorId: "delivery-source-executor",
    resultStoreRoot,
    secret: SECRET,
  });
  const firstSocket = path.join(root, "executor-first.sock");
  await listen(firstServer, firstSocket);
  const input = { source: { head_commit: "d".repeat(40) } };
  try {
    const client = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath: firstSocket,
    });
    const result = await client.executor.run(context(), () =>
      client.lifecycleSource.acquireEvidence(input));
    assert.equal(result.acquisition_id, "owner-evidence:durable");
  } finally {
    await close(firstServer);
  }

  const secondAdapters = adapters([]);
  secondAdapters.lifecycleSource.acquireEvidence = async () => {
    throw new Error("durably completed evidence must not execute again");
  };
  const secondServer = createDeliveryArtSourceExecutorServer({
    adapters: secondAdapters,
    audit: (event) => audit.push(event),
    executorId: "delivery-source-executor",
    resultStoreRoot,
    secret: SECRET,
  });
  const secondSocket = path.join(root, "executor-second.sock");
  await listen(secondServer, secondSocket);
  try {
    const client = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath: secondSocket,
    });
    const retryContext = { ...context(), command_id: "work-session-command:retry" };
    const replayed = await client.executor.run(retryContext, () =>
      client.lifecycleSource.acquireEvidence(input));
    assert.equal(replayed.acquisition_id, "owner-evidence:durable");
    assert.equal(acquisitionCalls, 1);
    assert.deepEqual(
      audit.filter((event) => event.action === "lifecycle.acquire-evidence")
        .map((event) => event.outcome),
      ["completed", "replayed"],
    );
    const records = readdirSync(resultStoreRoot);
    assert.equal(records.length, 1);
    assert.equal(statSync(path.join(resultStoreRoot, records[0])).mode & 0o777, 0o600);
  } finally {
    await close(secondServer);
    rmSync(root, { force: true, recursive: true });
  }
});

test("source executor durably replays an Agent Gary commit without a second mutation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-realization-replay-"));
  const resultStoreRoot = path.join(root, "results");
  const firstSocket = path.join(root, "executor-first.sock");
  let applyCalls = 0;
  const firstAdapters = adapters([]);
  firstAdapters.workSource.applySourceRealization = async () => {
    applyCalls += 1;
    return {
      schema_version: 1,
      receipt_id: "source-realization-receipt:durable",
      outcome: "committed",
      head_commit: "d".repeat(40),
      receipt_digest: `sha256:${"e".repeat(64)}`,
    };
  };
  const changeSet = {
    schema_version: 1,
    change_set_id: "change-set:durable",
    session_id: "work-session:test",
    base_commit: "a".repeat(40),
    objective_digest: `sha256:${"b".repeat(64)}`,
    commit_message: "feat: durable source realization",
    operations: [{ action: "create", path: "src/a.js", content: "a\n", expected_digest: null }],
  };
  const firstServer = createDeliveryArtSourceExecutorServer({
    adapters: firstAdapters,
    executorId: "delivery-source-executor",
    resultStoreRoot,
    secret: SECRET,
  });
  await listen(firstServer, firstSocket);
  try {
    const client = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath: firstSocket,
    });
    const result = await client.executor.run(context(), () =>
      client.workSource.applySourceRealization({ session_id: "work-session:test" }, changeSet));
    assert.equal(result.outcome, "committed");
  } finally {
    await close(firstServer);
  }

  const replayAdapters = adapters([]);
  replayAdapters.workSource.applySourceRealization = async () => {
    throw new Error("durable source action must replay without another mutation");
  };
  const replayServer = createDeliveryArtSourceExecutorServer({
    adapters: replayAdapters,
    executorId: "delivery-source-executor",
    resultStoreRoot,
    secret: SECRET,
  });
  const replaySocket = path.join(root, "executor-replay.sock");
  await listen(replayServer, replaySocket);
  try {
    const client = createDeliveryArtSourceExecutorClient({
      executorId: "delivery-source-executor",
      secret: SECRET,
      socketPath: replaySocket,
    });
    const replay = await client.executor.run(context(), () =>
      client.workSource.applySourceRealization({ session_id: "work-session:test" }, changeSet));
    assert.equal(replay.head_commit, "d".repeat(40));
    assert.equal(applyCalls, 1);
  } finally {
    await close(replayServer);
    rmSync(root, { force: true, recursive: true });
  }
});

test("source executor retries failed evidence and then durably replays its passing repair", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "oos-source-executor-retry-"));
  const resultStoreRoot = path.join(root, "results");
  const input = { source: { head_commit: "e".repeat(40) } };
  let acquisitionCalls = 0;
  const result = (state) => ({
    artifact_type: "delivery_art_owner_evidence_receipt",
    acquisition_id: "owner-evidence:retryable",
    results: [{ result: state }],
    source_revision: input.source.head_commit,
  });

  const invoke = async (socketName, acquireEvidence) => {
    const socketPath = path.join(root, socketName);
    const configuredAdapters = adapters([]);
    configuredAdapters.lifecycleSource.acquireEvidence = acquireEvidence;
    const server = createDeliveryArtSourceExecutorServer({
      adapters: configuredAdapters,
      executorId: "delivery-source-executor",
      resultStoreRoot,
      secret: SECRET,
    });
    await listen(server, socketPath);
    try {
      const client = createDeliveryArtSourceExecutorClient({
        executorId: "delivery-source-executor",
        secret: SECRET,
        socketPath,
      });
      return await client.executor.run(context(), () =>
        client.lifecycleSource.acquireEvidence(input));
    } finally {
      await close(server);
    }
  };

  try {
    const failed = await invoke("executor-failed.sock", async () => {
      acquisitionCalls += 1;
      return result("fail");
    });
    assert.equal(failed.results[0].result, "fail");
    assert.deepEqual(readdirSync(resultStoreRoot), []);

    const repaired = await invoke("executor-repaired.sock", async () => {
      acquisitionCalls += 1;
      return result("pass");
    });
    assert.equal(repaired.results[0].result, "pass");
    assert.equal(acquisitionCalls, 2);
    assert.equal(readdirSync(resultStoreRoot).length, 1);

    const replayed = await invoke("executor-replayed.sock", async () => {
      throw new Error("passing evidence must replay without executing again");
    });
    assert.equal(replayed.results[0].result, "pass");
    assert.equal(acquisitionCalls, 2);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("source executor client reports an absent socket as unavailable", async () => {
  const client = createDeliveryArtSourceExecutorClient({
    executorId: "delivery-source-executor",
    secret: SECRET,
    socketPath: path.join(tmpdir(), "missing-oos-source-executor.sock"),
  });
  await assert.rejects(client.executor.assertAvailable(), {
    code: "delivery_art_work_session_executor_unavailable",
    statusCode: 503,
  });
});

test('operator draft preflight is an uncached read and proves the actual future apply wire budget before dispatch',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'oos-operator-draft-wire-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const socketPath=path.join(root,'source.sock');let validations=0;
  const server=createDeliveryArtSourceExecutorServer({executorId:'source-test',secret:SECRET,adapters:{...adapters([]),workSource:{...adapters([]).workSource,
    validateSourceRealization:async(session,change)=>{validations++;return{valid:true,session_id:session.session_id,change_set_id:change.change_set_id};}
  }}});
  await listen(server,socketPath);t.after(()=>close(server));
  const client=createDeliveryArtSourceExecutorClient({executorId:'source-test',secret:SECRET,socketPath,requireSourceLease:true});
  const session={session_id:'work-session:test'};const change={change_set_id:'change:operator',operations:[{action:'create',path:'app/main.js',content:'const title = "你好";\r\n',expected_digest:null}]};
  const run=()=>client.executor.run(context(),()=>client.workSource.validateSourceRealization(session,change));
  assert.equal((await run()).valid,true);assert.equal((await run()).valid,true);assert.equal(validations,2);
  const escaped={...change,operations:Array.from({length:3},(_,i)=>({action:'create',path:`app/file${i}.txt`,content:'\x01'.repeat(60000),expected_digest:null}))};
  await assert.rejects(client.executor.run(context(),()=>client.workSource.validateSourceRealization(session,escaped)),{code:'delivery_art_source_draft_oversized',statusCode:413});
  assert.equal(validations,2);
});
