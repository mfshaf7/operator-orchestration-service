import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createDeliveryArtWorkSessionSourceAdapter } from "../src/delivery-art/work-session-cli-adapters.js";
import { validateDeliveryArtWorkSessionArchitectureSupersessionReceipt } from "../src/delivery-art/work-session.js";

function git(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("source realization captures bounded context and commits an exact Agent Gary change set", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-source-realization-"));
  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const repoRoot = path.join(workspaceRoot, "owner-repo");
  await mkdir(remoteRoot, { recursive: true });
  git(remoteRoot, ["init", "--bare"]);
  git(workspaceRoot, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "operator@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Operator"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n", "utf8");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);
  const baseCommit = git(repoRoot, ["rev-parse", "HEAD"]);
  const adapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    agentSourceIdentity: {
      async prepare({ repoRoot: worktree }) {
        git(worktree, ["config", "user.name", "Agent Gary"]);
        git(worktree, ["config", "user.email", "327854141+mfshaf7-agent-gary[bot]@users.noreply.github.com"]);
        return { state: "ready" };
      },
    },
  });
  const session = {
    session_id: "work-session:delivery-1275:delivery-1275-source-realization",
    delivery_id: "delivery-1275",
    work_item_id: "work-item-1285",
    landing_unit_id: "delivery-1275-source-realization",
    owner_repo: "owner-repo",
    landing_unit: {
      base_commit: baseCommit,
      base_ref: "origin/main",
      branch: "feature/1285-source-realization",
    },
  };

  const context = await adapter.captureRealizationContext(session);
  assert.equal(context.clean, true);
  assert.equal(context.head_commit, baseCommit);
  assert.equal(context.files.some((file) => file.path === "README.md"), true);
  assert.match(context.context_digest, /^sha256:[0-9a-f]{64}$/);

  const changeSet = {
    schema_version: 1,
    change_set_id: "change-set-1285",
    session_id: session.session_id,
    base_commit: baseCommit,
    objective_digest: digest("objective"),
    commit_message: "feat: realize bounded source",
    operations: [{
      action: "replace",
      path: "README.md",
      content: "base\nrealized\n",
      expected_digest: digest("base\n"),
    }],
  };

  await assert.rejects(
    () => adapter.applySourceRealization(session, {
      ...changeSet,
      change_set_id: "change-set-1285-invalid",
      operations: [{
        ...changeSet.operations[0],
        content: "base \n",
      }],
    }),
    /diff --check failed/,
  );
  const worktree = await adapter.resolveWorktree(session);
  assert.equal(await readFile(path.join(worktree, "README.md"), "utf8"), "base\n");
  assert.equal(git(worktree, ["status", "--porcelain"]), "");

  const receipt = await adapter.applySourceRealization(session, changeSet);

  assert.equal(receipt.outcome, "committed");
  assert.equal(receipt.change_set_digest, canonicalDigest(changeSet));
  assert.deepEqual(receipt.changed_files, ["README.md"]);
  assert.match(receipt.author, /^Agent Gary </);
  assert.equal(await readFile(path.join(worktree, "README.md"), "utf8"), "base\nrealized\n");
  assert.equal(git(worktree, ["status", "--porcelain"]), "");
  assert.match(
    git(worktree, ["show", "-s", "--format=%B", "HEAD"]),
    new RegExp(`OOS-Source-Realization-Digest: ${canonicalDigest(changeSet)}`),
  );
  const replay = await adapter.applySourceRealization(session, changeSet);
  assert.equal(replay.head_commit, receipt.head_commit);
  assert.equal(replay.receipt_digest, receipt.receipt_digest);
  assert.equal(git(worktree, ["rev-list", "--count", `${baseCommit}..HEAD`]), "1");
});

test("source adapter reconstructs a planned branch after worktree cleanup", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-work-source-"));
  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const repoRoot = path.join(workspaceRoot, "operator-orchestration-service");
  await mkdir(remoteRoot, { recursive: true });
  git(remoteRoot, ["init", "--bare"]);
  git(workspaceRoot, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "work-session@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Work Session Test"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n", "utf8");
  const evidenceProfileRoot = path.join(
    repoRoot,
    "contracts",
    "delivery-art-work-session",
  );
  await mkdir(evidenceProfileRoot, { recursive: true });
  await writeFile(
    path.join(evidenceProfileRoot, "evidence-profile.json"),
    `${JSON.stringify({
      schema_version: 1,
      profile_id: "test-owner-evidence-v1",
      owner_repo: "operator-orchestration-service",
      commands: [
        {
          id: "filesystem-validation",
          kind: "validations",
          name: "Filesystem validation",
          executable: "node",
          args: ["--test", "test/filesystem.test.js"],
          fidelity: "filesystem",
          conformance_binding: "matching-fidelity",
          timeout_seconds: 60,
        },
        {
          id: "real-git-test",
          kind: "tests",
          name: "Real Git test",
          executable: "node",
          args: ["--test", "test/real-git.test.js"],
          fidelity: "real-git",
          conformance_binding: "matching-fidelity",
          timeout_seconds: 60,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["add", "contracts/delivery-art-work-session/evidence-profile.json"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);

  const adapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    execFileSyncImpl(command, args, options) {
      if (command === "gh") return "[]";
      return execFileSync(command, args, options);
    },
  });
  const base = await adapter.resolveBase({
    baseRef: "origin/main",
    ownerRepo: "operator-orchestration-service",
  });
  const session = {
    session_id: "work-session:delivery-958:delivery-958-work-item-963",
    delivery_id: "delivery-958",
    landing_unit_id: "delivery-958-work-item-963",
    owner_repo: "operator-orchestration-service",
    landing_unit: {
      base_commit: base.commit,
      base_ref: "origin/main",
      branch: "feature/963-resumable-work-session",
    },
  };

  const configuredPath = await adapter.inspectConfiguredPath(session);
  assert.equal(configuredPath.base.state, "ready");
  assert.equal(configuredPath.branch.state, "available");
  assert.equal(configuredPath.branch.worktree_present, false);
  assert.equal(configuredPath.owner_repo.state, "clean");
  assert.equal(configuredPath.identity.state, "inactive");
  const evidenceReady = await adapter.inspectConfiguredPath(session, {
    conformanceCases: [
      { fidelity: "filesystem", id: "case:filesystem" },
      { fidelity: "real-git", id: "case:real-git" },
    ],
    requiredEvidenceKinds: ["tests", "validations"],
  });
  assert.equal(evidenceReady.base.fetched_commit, base.commit);

  let identityPreflights = 0;
  const evidenceFirst = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    agentSourceIdentity: {
      async inspectRepositoryAdmission({ session: candidate }) {
        return { owner_repo: candidate.owner_repo, state: "ready" };
      },
      async preflight() {
        identityPreflights += 1;
        throw new Error("identity preflight must not run for an incomplete evidence profile");
      },
    },
  });
  await assert.rejects(
    () => evidenceFirst.inspectConfiguredPath(session, {
      conformanceCases: [{ fidelity: "process-crash", id: "case:crash" }],
      requiredEvidenceKinds: ["tests", "validations"],
    }),
    { code: "delivery_art_evidence_profile_incomplete" },
  );
  assert.equal(identityPreflights, 0);
  assert.equal(await adapter.resolveWorktree(session), null);
  const pristineWithoutWorktree = await adapter.inspectPristineSession(session);
  assert.equal(pristineWithoutWorktree.pristine, true);
  assert.equal(pristineWithoutWorktree.base_commit_available, true);
  assert.deepEqual(
    validateDeliveryArtWorkSessionArchitectureSupersessionReceipt({
      schema_version: 1,
      artifact_type:
        "delivery_art_work_session_architecture_supersession_receipt",
      receipt_id:
        `architecture-supersession:${session.session_id}:sha256:${"1".repeat(64)}`,
      delivery_id: session.delivery_id,
      landing_unit_id: session.landing_unit_id,
      covered_work_item_ids: ["work-item-963"],
      operator: { id: "operator:workspace-owner", decision_source: "operator" },
      superseded_session: {
        architecture: {
          digest: `sha256:${"2".repeat(64)}`,
          uri: `wgcf://artifacts/delivery-art/sha256/${"2".repeat(64)}`,
        },
        session_id: session.session_id,
        session_revision: "2026-10-14T00:00:00.000Z",
      },
      replacement_session: {
        architecture: {
          digest: `sha256:${"3".repeat(64)}`,
          uri: `wgcf://artifacts/delivery-art/sha256/${"3".repeat(64)}`,
        },
        session_id: `${session.session_id}:r2`,
        session_revision: "2026-10-14T00:01:00.000Z",
      },
      pristine_proof: {
        current_landing_unit_id: session.landing_unit_id,
        evidence_pristine: true,
        readiness_receipt_absent: true,
        review_packet_absent: true,
        source: pristineWithoutWorktree,
      },
      resource_outcomes: [
        { resource_type: "git-worktree", outcome: "absent" },
        { resource_type: "git-local-branch", outcome: "absent" },
        { resource_type: "git-remote-branch", outcome: "absent" },
      ],
      recorded_at: "2026-10-14T00:01:00.000Z",
      integrity: { content_digest: `sha256:${"4".repeat(64)}` },
    }),
    { errors: [], valid: true },
  );
  const invalidBase = await adapter.inspectPristineSession({
    ...session,
    landing_unit: {
      ...session.landing_unit,
      base_commit: "f".repeat(40),
      branch: "feature/963-invalid-base",
    },
  });
  assert.equal(invalidBase.pristine, true);
  assert.equal(invalidBase.base_commit_available, false);
  await assert.rejects(
    () => adapter.inspectConfiguredPath({ ...session, owner_repo: "../outside" }),
    /name is invalid/,
  );
  await assert.rejects(
    () => adapter.inspectConfiguredPath({
      ...session,
      landing_unit: { ...session.landing_unit, base_ref: "--all" },
    }),
    /base_ref must be a valid Git revision/,
  );

  const admissionFirst = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    agentSourceIdentity: {
      async inspectRepositoryAdmission({ session: candidate }) {
        return {
          owner_repo: candidate.owner_repo,
          reason: "The owner repository is outside the admitted Agent source set.",
          reason_code: "agent_source_repository_not_admitted",
          state: "blocked",
        };
      },
    },
  });
  const blocked = await admissionFirst.inspectConfiguredPath({
    ...session,
    owner_repo: "not-present-in-workspace",
  });
  assert.equal(blocked.admission.state, "blocked");
  assert.equal(blocked.base.state, "pending-admission");
  assert.equal(blocked.branch.worktree_present, false);

  const owned = await adapter.ensureOwnedWorktree(session);
  const firstPath = owned.path;
  assert.equal(await adapter.resolveWorktree(session), firstPath);
  assert.equal(git(firstPath, ["rev-parse", "HEAD"]), base.commit);
  assert.equal((await adapter.inspectPristineSession(session)).pristine, true);
  const replacement = {
    ...session,
    session_id: `${session.session_id}:r1`,
    landing_unit: {
      ...session.landing_unit,
      branch: "feature/963-replacement-work-session",
    },
  };
  const replacementPath = (await adapter.ensureOwnedWorktree(replacement)).path;
  assert.notEqual(replacementPath, firstPath);
  assert.equal(
    replacementPath,
    path.join(
      workspaceRoot,
      ".worktrees",
      "delivery-958-work-item-963-r1",
      "operator-orchestration-service",
    ),
  );
  assert.equal(await adapter.resolveWorktree(session), firstPath);
  assert.equal(await adapter.resolveWorktree(replacement), replacementPath);

  const retirement = await adapter.retirePristineSession({
    resources: owned.resources,
    session,
  });
  assert.deepEqual(
    retirement.outcomes.map((entry) => entry.outcome),
    ["removed", "removed", "absent"],
  );
  assert.equal(await adapter.resolveWorktree(session), null);
  const replayedRetirement = await adapter.retirePristineSession({
    resources: owned.resources,
    session,
  });
  assert.deepEqual(
    replayedRetirement.outcomes.map((entry) => entry.outcome),
    ["absent", "absent", "absent"],
  );
  const reconstructedPath = await adapter.ensureWorktree(session);
  assert.equal(reconstructedPath, firstPath);
  assert.equal(git(reconstructedPath, ["rev-parse", "--abbrev-ref", "HEAD"]), session.landing_unit.branch);
  await writeFile(path.join(reconstructedPath, "changed.txt"), "changed\n", "utf8");
  const changed = await adapter.inspectPristineSession(session);
  assert.equal(changed.pristine, false);
  assert.deepEqual(changed.reasons, ["worktree-has-changes"]);
  await assert.rejects(
    () => adapter.retirePristineSession({ resources: [], session }),
    (error) =>
      error.code === "delivery_art_work_session_reconstruction_not_pristine",
  );

  await writeFile(path.join(repoRoot, "architecture.json"), '{"scope":"repo"}\n', "utf8");
  assert.deepEqual(
    await adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "architecture.json",
    }),
    { scope: "repo" },
  );

  const outsideArtifact = path.join(workspaceRoot, "outside.json");
  await writeFile(outsideArtifact, '{"scope":"outside"}\n', "utf8");
  await symlink(outsideArtifact, path.join(repoRoot, "linked-architecture.json"));
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "../outside.json",
    }),
    /escapes its repository/,
  );
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "linked-architecture.json",
    }),
    /resolves outside its repository/,
  );
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "../operator-orchestration-service",
      relative_path: "architecture.json",
    }),
    /name is invalid/,
  );
});

test("source adapter merges only the exact observed pull-request head", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-work-merge-source-"));
  const repoRoot = path.join(workspaceRoot, "operator-orchestration-service");
  await mkdir(repoRoot, { recursive: true });
  const headCommit = "a".repeat(40);
  const mergeCommit = "b".repeat(40);
  const url = "https://github.com/example/repo/pull/12";
  const calls = [];
  let merged = false;
  const adapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    agentSourceIdentity: {
      assertHumanMergeAuthority() {},
      reviewPolicy() {
        return {
          repository: "example/repo",
          required_reviewer_id: "human-reviewer",
          source_author_id: "source-agent[bot]",
        };
      },
    },
    execFileSyncImpl(command, args) {
      calls.push({ args, command });
      if (command === "git") {
        assert.deepEqual(args, ["rev-parse", "--git-dir"]);
        return ".git";
      }
      assert.equal(command, "gh");
      if (args[1] === "merge") {
        merged = true;
        return "";
      }
      if (args[0] === "api") {
        if (args.includes(".user.login")) return "source-agent[bot]";
        return JSON.stringify({
          commit_id: headCommit,
          id: 41,
          state: "APPROVED",
          user: { login: "human-reviewer" },
        });
      }
      return JSON.stringify([{
        baseRefName: "main",
        headRefOid: headCommit,
        isDraft: false,
        mergeCommit: merged ? { oid: mergeCommit } : null,
        number: 12,
        state: merged ? "MERGED" : "OPEN",
        url,
      }]);
    },
  });
  const session = {
    owner_repo: "operator-orchestration-service",
    landing_unit: { base_ref: "origin/main", branch: "fix/exact-merge" },
  };

  await assert.rejects(
    () => adapter.mergePullRequest(session, {
      base_ref: "main",
      head_commit: "c".repeat(40),
      merge_commit: null,
      state: "open",
      url,
    }),
    (error) => error.code === "delivery_art_work_session_merge_binding_blocked",
  );
  assert.equal(calls.some((call) => call.args[1] === "merge"), false);

  const result = await adapter.mergePullRequest(session, {
    base_ref: "main",
    head_commit: headCommit,
    merge_commit: null,
    state: "open",
    url,
  });

  assert.equal(result.state, "merged");
  assert.equal(result.merge_commit, mergeCommit);
  assert.deepEqual(calls.find((call) => call.args[1] === "merge"), {
    command: "gh",
    args: ["pr", "merge", url, "--squash", "--admin", "--match-head-commit", headCommit],
  });
});

test("source adapter refuses missing, stale, or superseded exact-head review", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-work-review-source-"));
  const repoRoot = path.join(workspaceRoot, "operator-orchestration-service");
  await mkdir(repoRoot, { recursive: true });
  const headCommit = "a".repeat(40);
  const url = "https://github.com/example/repo/pull/12";
  let reviews = [];
  let author = "source-agent[bot]";
  let merged = false;
  const adapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    agentSourceIdentity: {
      assertHumanMergeAuthority() {},
      reviewPolicy() {
        return {
          repository: "example/repo",
          required_reviewer_id: "human-reviewer",
          source_author_id: "source-agent[bot]",
        };
      },
    },
    execFileSyncImpl(command, args) {
      if (command === "git") return ".git";
      if (args[0] === "api") {
        if (args.includes(".user.login")) return author;
        return reviews.map((entry) => JSON.stringify(entry)).join("\n");
      }
      if (args[1] === "merge") {
        merged = true;
        return "";
      }
      return JSON.stringify([{
        baseRefName: "main",
        headRefOid: headCommit,
        isDraft: false,
        mergeCommit: null,
        number: 12,
        state: "OPEN",
        url,
      }]);
    },
  });
  const session = {
    owner_repo: "operator-orchestration-service",
    landing_unit: { base_ref: "origin/main", branch: "fix/exact-review" },
  };
  const expected = {
    base_ref: "main",
    head_commit: headCommit,
    merge_commit: null,
    state: "open",
    url,
  };

  for (const candidate of [
    [],
    [{ commit_id: "c".repeat(40), id: 1, state: "APPROVED", user: { login: "human-reviewer" } }],
    [
      { commit_id: headCommit, id: 1, state: "APPROVED", user: { login: "human-reviewer" } },
      { commit_id: headCommit, id: 2, state: "CHANGES_REQUESTED", user: { login: "human-reviewer" } },
    ],
  ]) {
    reviews = candidate;
    await assert.rejects(
      () => adapter.mergePullRequest(session, expected),
      (error) => error.code === "delivery_art_work_session_merge_binding_blocked",
    );
  }
  author = "human-reviewer";
  reviews = [{
    commit_id: headCommit,
    id: 3,
    state: "APPROVED",
    user: { login: "human-reviewer" },
  }];
  await assert.rejects(
    () => adapter.mergePullRequest(session, expected),
    (error) => error.code === "delivery_art_work_session_merge_binding_blocked",
  );
  assert.equal(merged, false);
});
