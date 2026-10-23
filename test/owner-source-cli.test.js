import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerSourceSession,
  runOwnerSourceCommand,
} from "../src/owner-source-cli.js";

const BASE = "a".repeat(40);
const ARGV = [
  "maintenance",
  "publish",
  "--repo-root",
  "/workspace/operator-orchestration-service",
  "--landing-unit-id",
  "owner-maintenance-identity-preflight",
  "--base-commit",
  BASE,
  "--tracking-ref",
  "improvement-candidate:identity-preflight",
];

function gitFixture(_executable, args) {
  if (args[1] === "--show-toplevel") return "/workspace/operator-orchestration-service\n";
  if (args[1] === "--abbrev-ref") return "fix/owner-source-preflight\n";
  if (args[0] === "remote") {
    return "git@github.com:mfshaf7/operator-orchestration-service.git\n";
  }
  throw new Error(`unexpected git command: ${args.join(" ")}`);
}

test("owner source derives one exact non-secret maintenance session", () => {
  const value = buildOwnerSourceSession({ argv: ARGV, execFileSyncImpl: gitFixture });
  assert.equal(value.session.owner_repo, "operator-orchestration-service");
  assert.equal(value.session.landing_unit.branch, "fix/owner-source-preflight");
  assert.equal(value.session.landing_unit.base_commit, BASE);
  assert.deepEqual(value.session.covered_work_item_ids, [
    "improvement-candidate:identity-preflight",
  ]);
});

test("owner source derives repository identity from origin for a descriptive worktree", () => {
  const argv = ARGV.map((value) => (
    value === "/workspace/operator-orchestration-service"
      ? "/workspace/worktrees/review-recovery"
      : value
  ));
  const value = buildOwnerSourceSession({
    argv,
    execFileSyncImpl(_executable, args) {
      if (args[1] === "--show-toplevel") return "/workspace/worktrees/review-recovery\n";
      if (args[1] === "--abbrev-ref") return "fix/owner-source-preflight\n";
      if (args[0] === "remote") {
        return "https://github.com/mfshaf7/operator-orchestration-service.git\n";
      }
      throw new Error(`unexpected git command: ${args.join(" ")}`);
    },
  });

  assert.equal(value.session.owner_repo, "operator-orchestration-service");
});

test("owner origin is a selector, not authority for another GitHub account", async () => {
  let called = false;
  await assert.rejects(
    runOwnerSourceCommand({
      argv: ARGV,
      agentSourceIdentity: { async preflight() { called = true; } },
      execFileSyncImpl(_executable, args) {
        if (args[1] === "--show-toplevel") return "/workspace/operator-orchestration-service\n";
        if (args[1] === "--abbrev-ref") return "fix/owner-source-preflight\n";
        if (args[0] === "remote") return "git@github.com:someone-else/operator-orchestration-service.git\n";
        throw new Error(`unexpected git command: ${args.join(" ")}`);
      },
    }),
    /requires the existing fresh canonical source repository reader/,
  );
  assert.equal(called, false);
});

test("owner source publishes only after the Agent Gary preflight is ready", async () => {
  const calls = [];
  const output = [];
  const adapter = {
    async preflight(input) {
      calls.push(["preflight", input]);
      return { identity: { state: "ready" }, provider: { state: "ready", repository: "mfshaf7/operator-orchestration-service" } };
    },
    async publish(input) {
      calls.push(["publish", input]);
      return { state: "published", secret_values_embedded: false };
    },
  };
  const code = await runOwnerSourceCommand({
    agentSourceIdentity: adapter,
    argv: ARGV,
    execFileSyncImpl: gitFixture,
    stdout: { write: (value) => output.push(value) },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map(([name]) => name), ["preflight", "publish"]);
  assert.equal(JSON.parse(output.join("")).state, "published");
});

test("promoted owner maintenance publishes only its independently resolved exact provider", async () => {
  const repository = "mfshaf7-workspace/sample-app";
  const exec = (exe, args) => args[0] === "remote" ? `https://github.com/${repository}.git\n` : gitFixture(exe, args);
  const env = { OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED: "true", OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT: "/trusted/current-inventory" };
  const calls = [];
  const adapter = {
    async preflight() { return { identity: { state: "ready" }, provider: { state: "ready", repository } }; },
    async publish(input) { calls.push(input); return { state: "published" }; },
  };
  assert.equal(await runOwnerSourceCommand({ argv: ARGV, env, agentSourceIdentity: adapter, execFileSyncImpl: exec, stdout: { write() {} } }), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].session.owner_repo, "sample-app");
  calls.length = 0;
  adapter.preflight = async () => ({ identity: { state: "ready" }, provider: { state: "ready", repository: "another-owner/sample-app" } });
  await assert.rejects(runOwnerSourceCommand({ argv: ARGV, env, agentSourceIdentity: adapter, execFileSyncImpl: exec, stdout: { write() {} } }), { code: "agent_source_origin_mismatch" });
  assert.equal(calls.length, 0);
});

test("maintenance rejects an origin change after exact provider preflight", async () => {
  let reads = 0, published = false;
  await assert.rejects(runOwnerSourceCommand({ argv: ARGV, execFileSyncImpl: (exe, args) =>
    args[0] === "remote" && ++reads > 1 ? "git@github.com:mfshaf7/another-owner.git\n" : gitFixture(exe, args),
    agentSourceIdentity: {
      async preflight() { return { identity: { state: "ready" }, provider: { state: "ready", repository: "mfshaf7/operator-orchestration-service" } }; },
      async publish() { published = true; },
    }, stdout: { write() {} },
  }), /origin changed/);
  assert.equal(published, false);
});

test("owner source refuses publication when exact identity is unavailable", async () => {
  let published = false;
  await assert.rejects(
    runOwnerSourceCommand({
      agentSourceIdentity: {
        async preflight() {
          return {
            identity: { reason_code: "agent_source_credential_missing", state: "credential-required" },
            provider: { state: "unavailable" },
          };
        },
        async publish() { published = true; },
      },
      argv: ARGV,
      execFileSyncImpl: gitFixture,
      stdout: { write() {} },
    }),
    { code: "agent_source_credential_missing" },
  );
  assert.equal(published, false);
});

test("maintenance rejects workflow permission without its explicit exact approval reference", async () => {
  let called = false;
  for (const extra of [ ["--purpose", "workflow-maintenance"], ["--purpose", "ordinary-source", "--approval-ref", "operator:other"] ]) {
    await assert.rejects(runOwnerSourceCommand({
      argv: [...ARGV, ...extra], execFileSyncImpl: gitFixture,
      agentSourceIdentity: { async preflight() { called = true; } }, stdout: { write() {} },
    }));
  }
  assert.equal(called, false);
});
