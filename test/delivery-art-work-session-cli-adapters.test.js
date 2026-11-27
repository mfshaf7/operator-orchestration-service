import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { createConfiguredSourceLocationResolver, createDeliveryArtWorkSessionSourceAdapter } from "../src/delivery-art/work-session-cli-adapters.js";
import { validateDeliveryArtWorkSessionArchitectureSupersessionReceipt } from "../src/delivery-art/work-session.js";
import { instanceSourceLocation } from "../src/instance-records/source-location.js";
import { instanceSourceProof } from "./fixtures/instance-source-authority.js";

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

test("source location passes trusted core repository coordinates through current admission", () => {
  const workspaceRoot = path.join(tmpdir(), "oos-location");
  const env = { OOS_INSTANCE_RECORDS_ENABLED: "true" };
  const calls = [];
  const authority = instanceSourceProof({ ownerRepo: "owner-repo" }).source_authority;
  const location = createConfiguredSourceLocationResolver({
    workspaceRoot, env,
    repositoryReader(input) {
      calls.push(input);
      return input.ownerRepo === "owner-repo" ? { source_authority: authority } : {};
    },
  });
  assert.equal(location("operator-orchestration-service"), null);
  assert.deepEqual(location("owner-repo"), { ...instanceSourceLocation(workspaceRoot, authority), authority });
  assert.deepEqual(calls, [
    { ownerRepo: "operator-orchestration-service", legacyRepository: { full_name: "mfshaf7/operator-orchestration-service", id: 1213863054 } },
    { ownerRepo: "owner-repo", legacyRepository: null },
  ]);

  const denied = createConfiguredSourceLocationResolver({
    workspaceRoot, env,
    repositoryReader() { throw new Error("Current source admission unavailable."); },
  });
  assert.throws(() => denied("operator-orchestration-service"), /Current source admission unavailable/);
});

for (const internal of [false, true]) test(`${internal ? "internally registered" : "legacy"} source realization captures bounded context and commits an exact Agent Gary change set`, async t => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-source-realization-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const proof = instanceSourceProof({ ownerRepo: "owner-repo" }).source_authority;
  const location = internal ? instanceSourceLocation(workspaceRoot, proof) : null;
  const repoRoot = location?.root ?? path.join(workspaceRoot, "owner-repo");
  await mkdir(remoteRoot, { recursive: true });
  await mkdir(path.dirname(repoRoot), { recursive: true });
  git(remoteRoot, ["init", "--bare"]);
  git(workspaceRoot, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "operator@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Operator"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n", "utf8");
  const large = "baseline line one\n".repeat(5000);
  await writeFile(path.join(repoRoot, "large.txt"), large, "utf8");
  git(repoRoot, ["add", "README.md", "large.txt"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);
  const baseCommit = git(repoRoot, ["rev-parse", "HEAD"]);
  const reads = [];
  const adapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot,
    ...(internal ? {
      sourceLocation: owner => { assert.equal(owner, "owner-repo"); return { ...location, authority: proof }; },
      sourceGitReader: request => {
        reads.push(request);
        assert.equal(request.ownerRepo, "owner-repo");
        if (request.action === "fetch") { git(repoRoot, ["fetch", "origin", request.branch]); return {}; }
        assert.equal(request.action, "ref");
        const output = git(repoRoot, ["ls-remote", "--heads", "origin", `refs/heads/${request.branch}`]);
        return { remote_commit: output ? output.split(/\s+/)[0] : null };
      },
      execFileSyncImpl(command, args, options) {
        if (command === "git") assert.ok(!args.includes("fetch") && !args.includes("ls-remote"), "native remote reads must use the protected connection");
        return execFileSync(command, args, options);
      },
    } : {}),
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

  assert.equal((await adapter.resolveBase({ baseRef: "origin/main", ownerRepo: "owner-repo" })).commit, baseCommit);

  const beforeCapture = git(repoRoot, ["worktree", "list", "--porcelain"]);
  await assert.rejects(adapter.captureRealizationContext(session), { code: "delivery_art_source_realization_worktree_missing" });
  assert.equal(git(repoRoot, ["worktree", "list", "--porcelain"]), beforeCapture);
  assert.throws(() => git(repoRoot, ["show-ref", "--verify", `refs/heads/${session.landing_unit.branch}`]));
  await adapter.ensureOwnedWorktree(session);
  const context = await adapter.captureRealizationContext(session);
  assert.equal(context.clean, true);
  assert.equal(context.head_commit, baseCommit);
  assert.equal(context.files.some((file) => file.path === "README.md"), true);
  assert.match(context.context_digest, /^sha256:[0-9a-f]{64}$/);
  await assert.rejects(adapter.captureRealizationContext(session, { requestedPaths: ["large.txt"] }),
    { code: "delivery_art_source_realization_patch_required" });
  const { files: [section] } = await adapter.captureRealizationContext(session, { requestedPaths: ["large.txt"], startLine: 200 });
  assert.equal(section.content, "baseline line one\n".repeat(40));
  assert.equal(section.region.offset_utf16, "baseline line one\n".length * 199);
  assert.equal(section.region.baseline_digest, digest(large));
  const worktree = await adapter.resolveWorktree(session);
  await writeFile(path.join(worktree, "README.md"), "uncommitted change\n");
  await assert.rejects(adapter.captureRealizationContext(session, { treeOnly: true }),
    { code: "delivery_art_source_realization_worktree_dirty" });
  assert.equal(await readFile(path.join(worktree, "README.md"), "utf8"), "uncommitted change\n");
  await writeFile(path.join(worktree, "README.md"), "base\n");

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
    }, {
      action: "patch",
      path: "large.txt",
      content: "revised line\n",
      expected_digest: section.region.baseline_digest,
      patch: { before: "baseline line one\n", offset_utf16: section.region.offset_utf16 },
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
  const staleSection = structuredClone(changeSet);
  staleSection.operations[1].patch.before = "different line\n";
  await assert.rejects(() => adapter.validateSourceRealization(session, staleSection),
    { code: "delivery_art_source_realization_source_drift" });
  assert.equal((await adapter.validateSourceRealization(session, changeSet)).valid, true);
  if (internal) {
    assert.ok(worktree.startsWith(path.join(workspaceRoot, location.worktreePrefix)));
    assert.ok(reads.some(read => read.action === "fetch" && read.branch === "main"));
    assert.ok(reads.some(read => read.action === "ref" && read.branch === session.landing_unit.branch));
  }
  assert.equal(await readFile(path.join(worktree, "README.md"), "utf8"), "base\n");
  assert.equal(git(worktree, ["status", "--porcelain"]), "");

  const receipt = await adapter.applySourceRealization(session, changeSet);

  assert.equal(receipt.outcome, "committed");
  assert.equal(receipt.change_set_digest, canonicalDigest(changeSet));
  assert.deepEqual(receipt.changed_files, ["README.md", "large.txt"]);
  assert.match(receipt.author, /^Agent Gary </);
  assert.equal(await readFile(path.join(worktree, "README.md"), "utf8"), "base\nrealized\n");
  assert.equal(await readFile(path.join(worktree, "large.txt"), "utf8"),
    "baseline line one\n".repeat(199) + "revised line\n" + "baseline line one\n".repeat(4800));
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

  const invalidProfilePath = path.join(
    evidenceProfileRoot,
    "evidence-profile.json",
  );
  const invalidProfile = JSON.parse(await readFile(invalidProfilePath, "utf8"));
  invalidProfile.commands[0].timeout_seconds = 3600;
  await writeFile(
    invalidProfilePath,
    `${JSON.stringify(invalidProfile, null, 2)}\n`,
    "utf8",
  );
  git(repoRoot, ["add", "contracts/delivery-art-work-session/evidence-profile.json"]);
  git(repoRoot, ["commit", "-m", "invalid evidence profile"]);
  git(repoRoot, ["push", "origin", "main"]);
  const repairBase = await adapter.resolveBase({
    baseRef: "origin/main",
    ownerRepo: "operator-orchestration-service",
  });
  const repairConfiguredPath = await adapter.inspectConfiguredPath({
    ...session,
    session_id: `${session.session_id}:profile-repair`,
    landing_unit: {
      ...session.landing_unit,
      base_commit: repairBase.commit,
      branch: "fix/963-evidence-profile-repair",
    },
  }, {
    conformanceCases: [
      { fidelity: "filesystem", id: "case:filesystem" },
      { fidelity: "real-git", id: "case:real-git" },
    ],
    requiredEvidenceKinds: ["tests", "validations"],
  });
  assert.equal(repairConfiguredPath.base.state, "ready");
  assert.equal(
    repairConfiguredPath.runtime.evidence_profile.selection,
    "reviewed-ancestor-repair",
  );
  assert.equal(
    repairConfiguredPath.runtime.evidence_profile.profile_revision,
    base.commit,
  );

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
  let behind = false;
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
        mergeStateStatus: behind ? "BEHIND" : "CLEAN",
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

  behind = true;
  assert.equal((await adapter.inspectPullRequest(session)).base_update_required, true);
  await assert.rejects(
    () => adapter.mergePullRequest(session, { base_ref: "main", head_commit: headCommit, state: "open", url }),
    { code: "delivery_art_work_session_merge_base_behind" },
  );
  assert.equal(calls.some((call) => call.args[1] === "merge"), false);
  behind = false;

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

test("Technical Plan reads default branch, exact activation values and raw document digests without changing source", async t => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "technical-plan-source-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const repo = path.join(workspaceRoot, "sample");
  const remote = path.join(workspaceRoot, "remote.git");
  await mkdir(repo);
  git(workspaceRoot, ["init", "--bare", "-b", "primary", remote]);
  git(repo, ["init", "-b", "primary"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "user.email", "test@invalid"]);
  git(repo, ["remote", "add", "origin", remote]);
  await mkdir(path.join(repo, "config"));
  const document = "Authorization for the reviewed change.  \n";
  await writeFile(path.join(repo, "authorization.md"), document);
  await writeFile(path.join(repo, "config/runtime.yaml"), "runtime:\n  enabled: false\n  token: sample\n");
  await symlink("authorization.md", path.join(repo, "linked.md"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "Record source evidence"]);
  git(repo, ["push", "origin", "primary"]);
  const revision = git(repo, ["rev-parse", "HEAD"]);
  const source = createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot });
  assert.deepEqual(await source.readTechnicalPlanSource({ ownerRepo: "sample", kind: "revision" }),
    { repo: "sample", base_ref: "origin/primary", commit: revision });
  const pinned = { ownerRepo: "sample", baseRef: "origin/primary", revision };
  await writeFile(path.join(repo, "notes.md"), "A newer revision.\n");
  git(repo, ["add", "notes.md"]);
  git(repo, ["commit", "-m", "Add notes"]);
  git(repo, ["push", "origin", "primary"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  assert.notEqual(head, revision);
  assert.deepEqual(await source.readTechnicalPlanSource({ ...pinned, kind: "revision" }),
    { repo: "sample", base_ref: "origin/primary", commit: revision });
  await assert.rejects(source.readTechnicalPlanSource({ ...pinned, kind: "revision", revision: "f".repeat(40) }));
  await writeFile(path.join(repo, "config/runtime.yaml"), "runtime:\n  enabled: true\n");
  const before = git(repo, ["status", "--porcelain"]);
  assert.deepEqual(await source.readTechnicalPlanSource({ ...pinned, kind: "activation",
    filePath: "config/runtime.yaml", field: "runtime.enabled" }), {
    repo: "sample", revision, path: "config/runtime.yaml", field: "runtime.enabled",
    observed_value: false, observed_posture: "owner-source-change-required",
  });
  await assert.rejects(source.readTechnicalPlanSource({ ...pinned, kind: "activation",
    filePath: "config/runtime.yaml", field: "runtime.token" }), /name of a setting/);
  await assert.rejects(source.readTechnicalPlanSource({ ...pinned, kind: "activation",
    filePath: "../outside.yaml", field: "runtime.enabled" }), /outside the bounded/);
  await assert.rejects(source.readTechnicalPlanSource({ ...pinned, kind: "authorization",
    filePath: "linked.md" }), /tracked regular file/);
  git(repo, ["remote", "set-url", "origin", "https://github.com/example/sample.git"]);
  assert.deepEqual(await source.readTechnicalPlanSource({ ...pinned, kind: "authorization", filePath: "authorization.md" }),
    { uri: `https://github.com/example/sample/blob/${revision}/authorization.md`, digest: digest(document) });
  assert.equal(git(repo, ["status", "--porcelain"]), before);
  assert.equal(git(repo, ["rev-parse", "HEAD"]), head);
});
