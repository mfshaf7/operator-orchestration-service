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
