import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runArtCliCommand } from "../src/art-cli.js";
import { createDeliveryArtLifecycleCliAdapters } from "../src/delivery-art/lifecycle-cli-adapters.js";

const branch = "codex/art-819-delivery-art-lifecycle-reconcile";
const baseCommit = "1".repeat(40);
const headCommit = "2".repeat(40);

function commandStub(command, args) {
  const key = `${command} ${args.join(" ")}`;
  const outputs = new Map([
    ["git rev-parse --abbrev-ref HEAD", `${branch}\n`],
    ["git rev-parse origin/main", `${baseCommit}\n`],
    [`git rev-parse ${baseCommit}`, `${baseCommit}\n`],
    ["git rev-parse HEAD", `${headCommit}\n`],
    [`git diff --name-only ${baseCommit}...${headCommit}`, "src/a.js\ntest/a.test.js\n"],
    ["git status --porcelain", ""],
    [`git merge-base --is-ancestor ${baseCommit} ${headCommit}`, ""],
    ["git rev-parse --verify @{u}", `${headCommit}\n`],
    [
      `gh pr list --head ${branch} --state all --limit 1 --json state,isDraft,url,headRefOid,baseRefName,mergeCommit`,
      JSON.stringify([{
        baseRefName: "main",
        headRefOid: headCommit,
        isDraft: false,
        mergeCommit: null,
        state: "OPEN",
        url: "https://github.com/example/repo/pull/1",
      }]),
    ],
  ]);
  if (!outputs.has(key)) {
    throw new Error(`unexpected command: ${key}`);
  }
  return outputs.get(key);
}

test("CLI adapters project exact Git and GitHub source truth", async () => {
  const evidenceProfile = {
    schema_version: 1,
    profile_id: "base-owned-evidence",
    owner_repo: "operator-orchestration-service",
    commands: [{
      id: "exact-diff",
      kind: "tests",
      name: "Exact diff validation",
      executable: "git",
      args: ["diff", "--check", "{{base_commit}}...{{head_commit}}"],
      fidelity: "real-git",
      conformance_binding: "matching-fidelity",
      timeout_seconds: 30,
    }],
  };
  const commands = [];
  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    execFileSyncImpl(command, args) {
      commands.push([command, ...args]);
      if (command === "git" && args[0] === "show") {
        return JSON.stringify(evidenceProfile);
      }
      if (command === "git" && args[0] === "diff" && args[1] === "--check") {
        return "";
      }
      return commandStub(command, args);
    },
  });
  const landingUnit = {
    base_commit: baseCommit,
    base_ref: "origin/main",
    branch,
    owner_repo: "operator-orchestration-service",
    repo_root: "/workspace/repo",
  };

  const source = await adapters.sourceAdapter.inspect(landingUnit);
  const pullRequest = await adapters.sourceAdapter.pullRequest(landingUnit);
  const evidence = await adapters.sourceAdapter.acquireEvidence({
    conformance_cases: [{ fidelity: "real-git", id: "case:base-profile" }],
    landing_unit: landingUnit,
    source,
  });

  assert.deepEqual(source, {
    base_commit: baseCommit,
    branch,
    changed_files: ["src/a.js", "test/a.test.js"],
    head_commit: headCommit,
    state: "pushed",
    upstream_commit: headCommit,
  });
  assert.deepEqual(pullRequest, {
    base_ref: "main",
    head_commit: headCommit,
    merge_commit: null,
    state: "open",
    url: "https://github.com/example/repo/pull/1",
  });
  assert.equal(evidence.profile_revision, baseCommit);
  assert.equal(evidence.results[0].result, "pass");
  assert.equal(commands.some((entry) =>
    entry.join(" ") ===
      `git show ${baseCommit}:contracts/delivery-art-work-session/evidence-profile.json`),
  true);
});

test("CLI source inspection uses the recorded base commit and proves real Git ancestry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-lifecycle-real-git-"));
  const remoteRoot = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  const git = (cwd, args) => String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }) ?? "").trim();
  git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
  git(root, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "operator@example.test"]);
  git(repoRoot, ["config", "user.name", "Operator"]);
  await writeFile(path.join(repoRoot, "source.txt"), "base\n", "utf8");
  git(repoRoot, ["add", "source.txt"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);
  const recordedBase = git(repoRoot, ["rev-parse", "HEAD"]);
  git(repoRoot, ["switch", "-c", branch]);
  await writeFile(path.join(repoRoot, "source.txt"), "base\nchange\n", "utf8");
  git(repoRoot, ["commit", "-am", "change"]);
  git(repoRoot, ["push", "--set-upstream", "origin", branch]);

  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
  });
  const landingUnit = {
    base_commit: recordedBase,
    base_ref: "origin/main",
    branch,
    repo_root: repoRoot,
  };
  const pushed = await adapters.sourceAdapter.inspect(landingUnit);
  assert.equal(pushed.base_commit, recordedBase);
  assert.equal(pushed.state, "pushed");
  assert.deepEqual(pushed.changed_files, ["source.txt"]);

  git(repoRoot, ["switch", "main"]);
  git(repoRoot, ["branch", "-D", branch]);
  git(repoRoot, ["switch", "--orphan", branch]);
  await writeFile(path.join(repoRoot, "diverged.txt"), "diverged\n", "utf8");
  git(repoRoot, ["add", "diverged.txt"]);
  git(repoRoot, ["commit", "-m", "diverged"]);
  git(repoRoot, ["push", "--force", "--set-upstream", "origin", branch]);

  const diverged = await adapters.sourceAdapter.inspect(landingUnit);
  assert.equal(diverged.state, "base-diverged");
});

test("CLI source adapter acquires typed evidence from a trusted profile for the exact pushed source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-lifecycle-evidence-"));
  const remoteRoot = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  const profilePath = path.join(root, "trusted-evidence-profile.json");
  const git = (cwd, args) => String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }) ?? "").trim();
  git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
  git(root, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "agent-gary@example.test"]);
  git(repoRoot, ["config", "user.name", "Agent Gary"]);
  await writeFile(path.join(repoRoot, "source.txt"), "base\n", "utf8");
  git(repoRoot, ["add", "source.txt"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);
  const recordedBase = git(repoRoot, ["rev-parse", "HEAD"]);
  git(repoRoot, ["switch", "-c", branch]);
  await writeFile(path.join(repoRoot, "source.txt"), "base\nchange\n", "utf8");
  git(repoRoot, ["commit", "-am", "change"]);
  git(repoRoot, ["push", "--set-upstream", "origin", branch]);

  const profile = {
    schema_version: 1,
    profile_id: "trusted-test-profile",
    owner_repo: "operator-orchestration-service",
    commands: [{
      id: "exact-source-proof",
      kind: "tests",
      name: "Exact source proof",
      executable: "git",
      args: ["diff", "--check", "{{base_commit}}...{{head_commit}}"],
      fidelity: "real-git",
      conformance_binding: "matching-fidelity",
      timeout_seconds: 30,
    }],
  };
  await writeFile(profilePath, `${JSON.stringify(profile)}\n`, "utf8");
  const timestamps = [
    new Date("2026-09-24T07:00:00.000Z"),
    new Date("2026-09-24T07:00:01.000Z"),
  ];
  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    clock: () => timestamps.shift() ?? new Date("2026-09-24T07:00:01.000Z"),
    evidenceProfilePath: profilePath,
    providerId: "delivery-source-executor",
  });
  const landingUnit = {
    base_commit: recordedBase,
    base_ref: "origin/main",
    branch,
    owner_repo: "operator-orchestration-service",
    repo_root: repoRoot,
  };
  const source = await adapters.sourceAdapter.inspect(landingUnit);
  const receipt = await adapters.sourceAdapter.acquireEvidence({
    conformance_cases: [{ fidelity: "real-git", id: "case:exact-source" }],
    landing_unit: landingUnit,
    source,
  });

  assert.equal(receipt.provider.id, "delivery-source-executor");
  assert.equal(receipt.source_revision, source.head_commit);
  assert.equal(receipt.results[0].result, "pass");
  assert.deepEqual(receipt.results[0].conformance_case_ids, ["case:exact-source"]);
  assert.match(receipt.evidence_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.receipt_digest, /^sha256:[0-9a-f]{64}$/);

  profile.commands[0] = {
    ...profile.commands[0],
    args: ["-e", "process.exit(2)"],
    executable: "node",
  };
  await writeFile(profilePath, `${JSON.stringify(profile)}\n`, "utf8");
  const failedAdapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    evidenceProfilePath: profilePath,
  });
  const failed = await failedAdapters.sourceAdapter.acquireEvidence({
    conformance_cases: [{ fidelity: "real-git", id: "case:exact-source" }],
    landing_unit: landingUnit,
    source,
  });
  assert.equal(failed.results[0].result, "fail");

  profile.commands[0] = {
    ...profile.commands[0],
    args: ["-e", "require('node:fs').writeFileSync('unexpected.txt', 'changed')"],
  };
  await writeFile(profilePath, `${JSON.stringify(profile)}\n`, "utf8");
  const mutationAdapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    evidenceProfilePath: profilePath,
  });
  await assert.rejects(
    mutationAdapters.sourceAdapter.acquireEvidence({
      conformance_cases: [{ fidelity: "real-git", id: "case:exact-source" }],
      landing_unit: landingUnit,
      source,
    }),
    { code: "delivery_art_owner_evidence_source_mutated" },
  );
});

test("CLI pull-request inspection rejects the wrong base branch", async () => {
  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    execFileSyncImpl(command, args) {
      if (command === "gh") {
        return JSON.stringify([{
          baseRefName: "release",
          headRefOid: headCommit,
          isDraft: false,
          mergeCommit: null,
          state: "OPEN",
          url: "https://github.com/example/repo/pull/1",
        }]);
      }
      return commandStub(command, args);
    },
  });

  const pullRequest = await adapters.sourceAdapter.pullRequest({
    base_ref: "origin/main",
    branch,
    repo_root: "/workspace/repo",
  });

  assert.equal(pullRequest.base_ref, "release");
  assert.equal(pullRequest.state, "wrong-base");
});

test("CLI pull-request inspection resolves the packet-bound URL exactly", async () => {
  const prUrl = "https://github.com/example/repo/pull/41";
  const commands = [];
  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest() {
      throw new Error("broker request was not expected");
    },
    execFileSyncImpl(command, args) {
      commands.push([command, ...args]);
      return JSON.stringify({
        baseRefName: "main",
        headRefOid: headCommit,
        isDraft: false,
        mergeCommit: { oid: "3".repeat(40) },
        state: "MERGED",
        url: prUrl,
      });
    },
  });

  const pullRequest = await adapters.sourceAdapter.pullRequest(
    {
      base_ref: "origin/main",
      branch,
      repo_root: "/workspace/repo",
    },
    { head_commit: headCommit, url: prUrl },
  );

  assert.deepEqual(commands, [[
    "gh",
    "pr",
    "view",
    prUrl,
    "--json",
    "state,isDraft,url,headRefOid,baseRefName,mergeCommit",
  ]]);
  assert.equal(pullRequest.state, "merged");
  assert.equal(pullRequest.url, prUrl);
});

test("lifecycle reconciliation resumes after a real process crash without duplicating durable state", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-lifecycle-crash-"));
  const plan = {
    schema_version: 1,
    artifact_type: "delivery_art_lifecycle_plan",
    lifecycle_id: "lifecycle:delivery-698-work-item-819-crash-proof",
    created_at: "2026-08-12T17:00:00+08:00",
    delivery_id: "delivery-698",
    covered_work_item_ids: ["work-item-819"],
    operator: { id: "operator:workspace-owner", decision_source: "operator" },
    landing_unit: {
      decision: "child_isolated_landing_unit",
      split_reason: "One owner-repo source and rollback boundary.",
      repo_root: stateRoot,
      owner_repo: "operator-orchestration-service",
      base_ref: "origin/main",
      branch,
      rollback_boundary: "Revert the OOS pull request.",
    },
    architecture: { required: false, packet_path: null },
    artifacts: {
      work_start_path: ".art/work-start.json",
      review_packet_path: ".art/review-packet.json",
      readiness_receipt_path: ".art/readiness.json",
      evidence_path: ".art/evidence.json",
    },
  };
  await writeFile(
    path.join(stateRoot, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
  const worker = fileURLToPath(new URL(
    "../test-fixtures/delivery-art-lifecycle-crash-worker.mjs",
    import.meta.url,
  ));

  const interrupted = spawnSync(process.execPath, [worker, stateRoot, "crash"], {
    encoding: "utf8",
  });
  assert.equal(interrupted.status, 23);

  const resumed = spawnSync(process.execPath, [worker, stateRoot, "recover"], {
    encoding: "utf8",
  });
  assert.equal(resumed.status, 0, resumed.stderr);
  const result = JSON.parse(resumed.stdout);
  assert.deepEqual(result.executed_actions, ["evaluate-work-start"]);
  assert.equal(result.projection.gate, "source-work");

  const attempts = JSON.parse(
    await readFile(path.join(stateRoot, "evaluation-attempts.json"), "utf8"),
  );
  assert.equal(attempts.length, 2);
  assert.equal(new Set(attempts).size, 1);
  const durable = JSON.parse(
    await readFile(path.join(stateRoot, "durable-work-start.json"), "utf8"),
  );
  const local = JSON.parse(
    await readFile(path.join(stateRoot, ".art/work-start.json"), "utf8"),
  );
  assert.equal(local.integrity.content_digest, durable.integrity.content_digest);
  assert.equal(local.custody.uri, durable.custody.uri);
});

test("CLI ART adapter reads canonical target statuses through the broker", async () => {
  const requests = [];
  const adapters = createDeliveryArtLifecycleCliAdapters({
    async brokerRequest(request) {
      requests.push(request);
      return {
        body: {
          status: request.path.includes("819") ? "done" : "retired",
        },
        ok: true,
      };
    },
  });

  const statuses = await adapters.artAdapter.statuses([
    "work-item-819",
    "work-item-820",
  ]);

  assert.deepEqual(statuses, ["done", "retired"]);
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v1/delivery-work-items/work-item-819/status",
      "GET /v1/delivery-work-items/work-item-820/status",
    ],
  );
});

test("art lifecycle status exposes the resumable state without mutating the broker", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "oos-lifecycle-cli-"));
  const planPath = path.join(repoRoot, "plan.json");
  await writeFile(planPath, JSON.stringify({
    schema_version: 1,
    artifact_type: "delivery_art_lifecycle_plan",
    lifecycle_id: "lifecycle:delivery-698-work-item-819",
    created_at: "2026-08-12T17:00:00+08:00",
    delivery_id: "delivery-698",
    covered_work_item_ids: ["work-item-819"],
    operator: { id: "operator:workspace-owner", decision_source: "operator" },
    landing_unit: {
      decision: "child_isolated_landing_unit",
      split_reason: "One owner-repo source and rollback boundary.",
      repo_root: repoRoot,
      owner_repo: "operator-orchestration-service",
      base_ref: "origin/main",
      branch,
      rollback_boundary: "Revert the OOS pull request.",
    },
    architecture: { required: false, packet_path: null },
    artifacts: {
      work_start_path: ".art/work-start.json",
      review_packet_path: ".art/review-packet.json",
      readiness_receipt_path: ".art/readiness.json",
      evidence_path: ".art/evidence.json",
    },
  }), "utf8");
  const output = [];

  const exitCode = await runArtCliCommand({
    argv: ["lifecycle", "status", planPath],
    execFileSyncImpl: commandStub,
    spawnImpl() {
      throw new Error("status must not mutate or read the broker before finalization");
    },
    stdout: { write(chunk) { output.push(String(chunk)); } },
  });

  const result = JSON.parse(output.join(""));
  assert.equal(exitCode, 0);
  assert.equal(result.lifecycle_id, "lifecycle:delivery-698-work-item-819");
  assert.equal(result.projection.next_action, "draft-work-start");
  assert.deepEqual(result.executed_actions, []);
});
