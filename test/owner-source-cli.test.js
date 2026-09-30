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

test("owner source publishes only after the Agent Gary preflight is ready", async () => {
  const calls = [];
  const output = [];
  const adapter = {
    async preflight(input) {
      calls.push(["preflight", input]);
      return { identity: { state: "ready" }, provider: { state: "ready" } };
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
