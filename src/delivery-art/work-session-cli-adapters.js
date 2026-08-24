import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

function command(execFileSyncImpl, args, cwd) {
  try {
    return String(execFileSyncImpl("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) ?? "").trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.stdout ?? error?.message ?? "").trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function optionalCommand(execFileSyncImpl, args, cwd) {
  try {
    return {
      ok: true,
      output: command(execFileSyncImpl, args, cwd),
    };
  } catch (error) {
    return { error, ok: false, output: "" };
  }
}

function executableCommand(execFileSyncImpl, executable, args, cwd) {
  try {
    return String(execFileSyncImpl(executable, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) ?? "").trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.stdout ?? error?.message ?? "").trim();
    throw new Error(`${executable} ${args.join(" ")} failed: ${detail}`);
  }
}

function branchName(baseRef) {
  return String(baseRef).replace(/^refs\/remotes\/origin\//, "").replace(/^origin\//, "");
}

function parseWorktrees(output) {
  const worktrees = [];
  let current = null;
  for (const line of String(output).split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) {
        worktrees.push(current);
      }
      current = { path: line.slice("worktree ".length), branch: null, head: null };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current) {
    worktrees.push(current);
  }
  return worktrees;
}

export function createDeliveryArtWorkSessionSourceAdapter({
  changeDirectory = (target) => process.chdir(target),
  currentDirectory = () => process.cwd(),
  execFileSyncImpl = execFileSync,
  workspaceRoot,
} = {}) {
  if (!workspaceRoot) {
    throw new Error("workspaceRoot is required");
  }

  function canonicalRepo(ownerRepo) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(ownerRepo))) {
      throw new Error(`Owner repository name is invalid: ${ownerRepo}.`);
    }
    const repoRoot = path.join(workspaceRoot, ownerRepo);
    if (!existsSync(repoRoot)) {
      throw new Error(`Owner repository ${ownerRepo} is not present at ${repoRoot}.`);
    }
    command(execFileSyncImpl, ["rev-parse", "--git-dir"], repoRoot);
    return repoRoot;
  }

  function workspaceRelativePath(target) {
    const relative = path.relative(workspaceRoot, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Managed worktree must remain inside the workspace root.");
    }
    return relative.split(path.sep).join(path.posix.sep);
  }

  function expectedWorktreePath(session) {
    return path.join(
      workspaceRoot,
      ".worktrees",
      session.landing_unit_id,
      session.owner_repo,
    );
  }

  function localBranchHead(repoRoot, branch) {
    const result = optionalCommand(
      execFileSyncImpl,
      ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
      repoRoot,
    );
    return result.ok ? result.output : null;
  }

  function remoteBranchHead(repoRoot, remote, branch) {
    const output = command(
      execFileSyncImpl,
      ["ls-remote", "--heads", remote, `refs/heads/${branch}`],
      repoRoot,
    );
    if (!output) {
      return null;
    }
    return output.split(/\s+/)[0] ?? null;
  }

  function trackedResource({
    locator,
    ownershipProvenance,
    resourceId,
    resourceType,
  }) {
    const owned = ownershipProvenance === "session-created";
    return {
      resource_id: resourceId,
      resource_type: resourceType,
      ownership_provenance: ownershipProvenance,
      retention_class: owned
        ? "retire-on-terminal-close"
        : "policy-retained",
      outcome: "pending",
      locator,
      last_error: null,
    };
  }

  function resourceSnapshot({
    branchProvenance,
    head,
    remoteHead,
    remoteProvenance,
    session,
    target,
    worktreeProvenance,
  }) {
    const marker = session.session_id;
    return [
      trackedResource({
        resourceId: `resource:worktree:${session.owner_repo}`,
        resourceType: "git-worktree",
        ownershipProvenance: worktreeProvenance,
        locator: {
          kind: "worktree",
          repo: session.owner_repo,
          workspace_relative_path: workspaceRelativePath(target),
          expected_head_commit: head,
          ownership_marker: marker,
        },
      }),
      trackedResource({
        resourceId: `resource:local-branch:${session.owner_repo}`,
        resourceType: "git-local-branch",
        ownershipProvenance: branchProvenance,
        locator: {
          kind: "local-branch",
          repo: session.owner_repo,
          branch: session.landing_unit.branch,
          base_ref: session.landing_unit.base_ref,
          expected_head_commit: head,
          ownership_marker: marker,
        },
      }),
      trackedResource({
        resourceId: `resource:remote-branch:${session.owner_repo}`,
        resourceType: "git-remote-branch",
        ownershipProvenance: remoteProvenance,
        locator: {
          kind: "remote-branch",
          repo: session.owner_repo,
          remote: "origin",
          branch: session.landing_unit.branch,
          expected_head_commit: remoteHead ?? head,
          pull_request_ref: `pending:${session.session_id}`,
          ownership_marker: marker,
        },
      }),
    ];
  }

  async function resolveBase({ baseRef, ownerRepo }) {
    const repoRoot = canonicalRepo(ownerRepo);
    if (!baseRef || String(baseRef).startsWith("-")) {
      throw new Error("Landing Unit base_ref must be a valid Git revision.");
    }
    if (baseRef.startsWith("origin/")) {
      command(
        execFileSyncImpl,
        ["check-ref-format", "--branch", branchName(baseRef)],
        repoRoot,
      );
      command(
        execFileSyncImpl,
        ["fetch", "origin", branchName(baseRef)],
        repoRoot,
      );
    }
    return {
      commit: command(
        execFileSyncImpl,
        ["rev-parse", "--verify", `${baseRef}^{commit}`],
        repoRoot,
      ),
      repo_root: repoRoot,
    };
  }

  async function resolveWorktree(session) {
    const repoRoot = canonicalRepo(session.owner_repo);
    const worktrees = parseWorktrees(
      command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
    );
    return worktrees.find(
      (entry) => entry.branch === session.landing_unit.branch,
    )?.path ?? null;
  }

  async function ensureOwnedWorktree(session) {
    const repoRoot = canonicalRepo(session.owner_repo);
    command(
      execFileSyncImpl,
      ["check-ref-format", "--branch", session.landing_unit.branch],
      repoRoot,
    );
    const worktreesBefore = parseWorktrees(
      command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
    );
    const existing = worktreesBefore.find(
      (entry) => entry.branch === session.landing_unit.branch,
    );
    const target = existing?.path ?? expectedWorktreePath(session);
    const branchBefore = localBranchHead(repoRoot, session.landing_unit.branch);
    const remoteBefore = remoteBranchHead(
      repoRoot,
      "origin",
      session.landing_unit.branch,
    );
    let createdWorktree = false;
    let createdBranch = false;
    if (!existing) {
      if (!branchBefore && remoteBefore) {
        throw new Error(
          "Planned branch already exists on origin without a matching local branch.",
        );
      }
      const args = branchBefore
        ? ["worktree", "add", "--", target, session.landing_unit.branch]
        : [
            "worktree",
            "add",
            "-b",
            session.landing_unit.branch,
            "--",
            target,
            session.landing_unit.base_commit,
          ];
      command(execFileSyncImpl, args, repoRoot);
      createdWorktree = true;
      createdBranch = !branchBefore;
    }
    const head = command(execFileSyncImpl, ["rev-parse", "HEAD"], target);
    const worktreeProvenance = createdWorktree ? "session-created" : "ambiguous";
    const branchProvenance = createdBranch ? "session-created" : "pre-existing";
    const remoteProvenance = createdBranch && !remoteBefore
      ? "session-created"
      : remoteBefore
        ? "pre-existing"
        : "ambiguous";
    return {
      path: target,
      resources: resourceSnapshot({
        branchProvenance,
        head,
        remoteHead: remoteBefore,
        remoteProvenance,
        session,
        target,
        worktreeProvenance,
      }),
    };
  }

  async function inspectResourceOwnership(session) {
    const repoRoot = canonicalRepo(session.owner_repo);
    const worktrees = parseWorktrees(
      command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
    );
    const existing = worktrees.find(
      (entry) => entry.branch === session.landing_unit.branch,
    );
    const target = existing?.path ?? expectedWorktreePath(session);
    const branchHead = localBranchHead(repoRoot, session.landing_unit.branch);
    const remoteHead = remoteBranchHead(
      repoRoot,
      "origin",
      session.landing_unit.branch,
    );
    const head = existing?.head ?? branchHead ?? remoteHead ?? session.landing_unit.base_commit;
    return {
      path: existing?.path ?? null,
      resources: resourceSnapshot({
        branchProvenance: branchHead ? "pre-existing" : "ambiguous",
        head,
        remoteHead,
        remoteProvenance: remoteHead ? "pre-existing" : "ambiguous",
        session,
        target,
        worktreeProvenance: existing ? "ambiguous" : "ambiguous",
      }),
    };
  }

  async function inspectPullRequest(session) {
    const repoRoot = canonicalRepo(session.owner_repo);
    const fields = "state,isDraft,url,headRefOid,baseRefName,mergeCommit";
    const raw = executableCommand(
      execFileSyncImpl,
      "gh",
      [
        "pr",
        "list",
        "--head",
        session.landing_unit.branch,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        fields,
      ],
      repoRoot,
    );
    const pullRequest = JSON.parse(raw || "[]")[0] ?? null;
    if (!pullRequest) {
      return { state: "missing" };
    }
    const state = String(pullRequest.state ?? "").toUpperCase();
    return {
      base_ref: pullRequest.baseRefName ?? null,
      head_commit: pullRequest.headRefOid ?? null,
      merge_commit: pullRequest.mergeCommit?.oid ?? null,
      state: state === "MERGED"
        ? "merged"
        : state === "CLOSED"
          ? "closed"
          : pullRequest.isDraft
            ? "draft"
            : "open",
      url: pullRequest.url ?? null,
    };
  }

  async function ensureWorktree(session) {
    return (await ensureOwnedWorktree(session)).path;
  }

  function blocked(resource, message, locator = resource.locator) {
    return { ...resource, locator, outcome: "blocked", last_error: message };
  }

  function retained(resource) {
    return { ...resource, outcome: "retained", last_error: null };
  }

  function removed(resource, locator = resource.locator) {
    return { ...resource, locator, outcome: "removed", last_error: null };
  }

  function eligible(resource, locator) {
    return { ...resource, locator, outcome: "eligible", last_error: null };
  }

  function managedWorktree(session, relativePath) {
    const target = path.resolve(workspaceRoot, relativePath);
    const expected = expectedWorktreePath(session);
    if (target !== expected || !target.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error("worktree path is outside the session allowlist");
    }
    return target;
  }

  function currentInside(target) {
    const current = path.resolve(currentDirectory());
    return current === target || current.startsWith(`${target}${path.sep}`);
  }

  async function prepareResourceRetirementExecution(session) {
    const target = expectedWorktreePath(session);
    if (!currentInside(target)) {
      return { relocated: false };
    }
    const coordinatorRoot = canonicalRepo("operator-orchestration-service");
    changeDirectory(coordinatorRoot);
    if (currentInside(target)) {
      throw new Error(
        "resource retirement coordinator could not leave the managed worktree",
      );
    }
    return { relocated: true };
  }

  function mergedIntoBase(repoRoot, commit, baseRef) {
    if (baseRef.startsWith("origin/")) {
      command(execFileSyncImpl, ["fetch", "origin", branchName(baseRef)], repoRoot);
    }
    return optionalCommand(
      execFileSyncImpl,
      ["merge-base", "--is-ancestor", commit, baseRef],
      repoRoot,
    ).ok;
  }

  function squashMergePreservesBranchChange({
    head,
    pullRequest,
    repoRoot,
    session,
  }) {
    if (
      pullRequest?.state !== "merged" ||
      !pullRequest.merge_commit ||
      !pullRequest.url
    ) {
      return {
        ok: false,
        reason: "squash merge requires exact merged pull-request evidence",
      };
    }
    if (
      !mergedIntoBase(
        repoRoot,
        pullRequest.merge_commit,
        session.landing_unit.base_ref,
      )
    ) {
      return {
        ok: false,
        reason: "pull-request merge commit is not present in the recorded base",
      };
    }
    const ancestry = command(
      execFileSyncImpl,
      ["rev-list", "--parents", "-n", "1", pullRequest.merge_commit],
      repoRoot,
    ).split(/\s+/);
    if (ancestry.length !== 2) {
      return {
        ok: false,
        reason: "non-ancestry cleanup requires a single-parent squash merge commit",
      };
    }
    const diffArgs = [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-renames",
    ];
    const reviewedChange = command(
      execFileSyncImpl,
      [...diffArgs, session.landing_unit.base_commit, head, "--"],
      repoRoot,
    );
    const landedChange = command(
      execFileSyncImpl,
      [...diffArgs, ancestry[1], pullRequest.merge_commit, "--"],
      repoRoot,
    );
    if (reviewedChange !== landedChange) {
      return {
        ok: false,
        reason: "squash merge does not preserve the exact reviewed branch change",
      };
    }
    return { ok: true, reason: null };
  }

  function planGitResource({ pullRequest, resource, session }) {
    if (
      resource.ownership_provenance !== "session-created" ||
      resource.retention_class !== "retire-on-terminal-close"
    ) {
      return retained(resource);
    }
    if (resource.locator.ownership_marker !== session.session_id) {
      return blocked(resource, "ownership marker does not match the work session");
    }
    const repoRoot = canonicalRepo(resource.locator.repo);
    if (resource.resource_type === "git-worktree") {
      let target;
      try {
        target = managedWorktree(session, resource.locator.workspace_relative_path);
      } catch (error) {
        return blocked(resource, error.message);
      }
      const entry = parseWorktrees(
        command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
      ).find((worktree) => path.resolve(worktree.path) === target);
      if (!entry || !existsSync(target)) {
        return removed(resource);
      }
      if (entry.branch !== session.landing_unit.branch) {
        return blocked(resource, "worktree branch no longer matches the session");
      }
      if (currentInside(target)) {
        return blocked(resource, "worktree is active for the current process");
      }
      const dirty = command(execFileSyncImpl, ["status", "--porcelain"], target);
      if (dirty) {
        return blocked(resource, "worktree contains uncommitted changes");
      }
      const head = command(execFileSyncImpl, ["rev-parse", "HEAD"], target);
      if (pullRequest?.head_commit && pullRequest.head_commit !== head) {
        return blocked(resource, "worktree head does not match the merged pull request");
      }
      return eligible(resource, {
        ...resource.locator,
        expected_head_commit: head,
      });
    }
    if (resource.resource_type === "git-local-branch") {
      const head = localBranchHead(repoRoot, resource.locator.branch);
      if (!head) {
        return removed(resource);
      }
      const locator = {
        ...resource.locator,
        expected_head_commit: pullRequest?.head_commit ?? head,
      };
      const foreignWorktree = parseWorktrees(
        command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
      ).find((worktree) =>
        worktree.branch === resource.locator.branch &&
        path.resolve(worktree.path) !== expectedWorktreePath(session));
      if (foreignWorktree) {
        return blocked(
          resource,
          "local branch is attached to another worktree",
          locator,
        );
      }
      if (pullRequest?.head_commit && pullRequest.head_commit !== head) {
        return blocked(
          resource,
          "local branch head does not match the merged pull request",
          locator,
        );
      }
      if (!mergedIntoBase(repoRoot, head, resource.locator.base_ref)) {
        const squashProof = squashMergePreservesBranchChange({
          head,
          pullRequest,
          repoRoot,
          session,
        });
        if (!squashProof.ok) {
          return blocked(resource, squashProof.reason, locator);
        }
      }
      return eligible(resource, locator);
    }
    if (resource.resource_type === "git-remote-branch") {
      if (pullRequest?.state !== "merged" || !pullRequest.url || !pullRequest.head_commit) {
        return blocked(resource, "remote branch requires exact merged pull-request evidence");
      }
      const head = remoteBranchHead(
        repoRoot,
        resource.locator.remote,
        resource.locator.branch,
      );
      const locator = {
        ...resource.locator,
        expected_head_commit: pullRequest.head_commit,
        pull_request_ref: pullRequest.url,
      };
      if (!head) {
        return removed(resource, locator);
      }
      if (head !== pullRequest.head_commit) {
        return blocked(
          resource,
          "remote branch head does not match the merged pull request",
          locator,
        );
      }
      return eligible(resource, locator);
    }
    return blocked(resource, `unsupported Git resource type: ${resource.resource_type}`);
  }

  async function planResourceRetirement({ manifest, pullRequest, session }) {
    return manifest.resources.map((resource) => {
      if (resource.resource_type === "managed-session-state") {
        return resource;
      }
      try {
        return planGitResource({ pullRequest, resource, session });
      } catch (error) {
        return blocked(resource, `resource inspection failed: ${error.message}`);
      }
    });
  }

  async function retireResource({ pullRequest, resource, session }) {
    const planned = planGitResource({ pullRequest, resource, session });
    if (planned.outcome === "removed") {
      return;
    }
    if (planned.outcome !== "eligible") {
      throw new Error(planned.last_error ?? "resource is not eligible for retirement");
    }
    const repoRoot = canonicalRepo(planned.locator.repo);
    if (planned.resource_type === "git-worktree") {
      const target = managedWorktree(
        session,
        planned.locator.workspace_relative_path,
      );
      command(execFileSyncImpl, ["worktree", "remove", "--", target], repoRoot);
      return;
    }
    if (planned.resource_type === "git-local-branch") {
      command(
        execFileSyncImpl,
        [
          "update-ref",
          "-d",
          `refs/heads/${planned.locator.branch}`,
          planned.locator.expected_head_commit,
        ],
        repoRoot,
      );
      return;
    }
    if (planned.resource_type === "git-remote-branch") {
      command(
        execFileSyncImpl,
        [
          "push",
          `--force-with-lease=refs/heads/${planned.locator.branch}:${planned.locator.expected_head_commit}`,
          planned.locator.remote,
          "--delete",
          planned.locator.branch,
        ],
        repoRoot,
      );
      return;
    }
    throw new Error(`unsupported Git resource type: ${planned.resource_type}`);
  }

  async function readArtifact(location) {
    if (!location?.repo || !location?.relative_path) {
      throw new Error("Architecture artifact location requires repo and relative_path.");
    }
    const repoRoot = canonicalRepo(location.repo);
    const artifactPath = path.resolve(repoRoot, location.relative_path);
    if (!artifactPath.startsWith(`${repoRoot}${path.sep}`)) {
      throw new Error("Architecture artifact location escapes its repository.");
    }
    const realRepoRoot = realpathSync(repoRoot);
    const realArtifactPath = realpathSync(artifactPath);
    if (!realArtifactPath.startsWith(`${realRepoRoot}${path.sep}`)) {
      throw new Error("Architecture artifact resolves outside its repository.");
    }
    return JSON.parse(readFileSync(realArtifactPath, "utf8"));
  }

  return {
    ensureOwnedWorktree,
    ensureWorktree,
    inspectResourceOwnership,
    inspectPullRequest,
    planResourceRetirement,
    prepareResourceRetirementExecution,
    readArtifact,
    resolveBase,
    resolveWorktree,
    retireResource,
  };
}
