import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

function adapters(calls) {
  return {
    lifecycleSource: {
      inspect: async (landingUnit) => ({ branch: landingUnit.branch, state: "pushed" }),
      pullRequest: async () => ({ state: "open" }),
    },
    workSource: {
      ensureOwnedWorktree: async () => ({ path: "/workspace/repo", resources: [] }),
      ensureWorktree: async () => "/workspace/repo",
      inspectPullRequest: async () => ({ state: "open" }),
      inspectResourceOwnership: async () => ({ path: null, resources: [] }),
      mergePullRequest: async (_session, expectedPullRequest) => ({
        ...expectedPullRequest,
        merge_commit: "b".repeat(40),
        state: "merged",
      }),
      planResourceRetirement: async () => [],
      prepareResourceRetirementExecution: async () => ({ relocated: false }),
      readArtifact: async (location) => ({ location }),
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
  const audit = [];
  const server = createDeliveryArtSourceExecutorServer({
    adapters: adapters(calls),
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
    assert.equal(result.commit, "a".repeat(40));
    assert.equal(merged.state, "merged");
    assert.deepEqual(calls, [{ baseRef: "origin/main", ownerRepo: "repo" }]);
    assert.deepEqual(audit.map((event) => event.action), [
      "work.resolve-base",
      "work.merge-pull-request",
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
