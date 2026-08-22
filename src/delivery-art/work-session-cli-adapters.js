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
      current = { path: line.slice("worktree ".length), branch: null };
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

  async function ensureWorktree(session) {
    const existing = await resolveWorktree(session);
    if (existing) {
      return existing;
    }
    const repoRoot = canonicalRepo(session.owner_repo);
    command(
      execFileSyncImpl,
      ["check-ref-format", "--branch", session.landing_unit.branch],
      repoRoot,
    );
    const target = path.join(
      workspaceRoot,
      ".worktrees",
      session.landing_unit_id,
      session.owner_repo,
    );
    const branch = optionalCommand(
      execFileSyncImpl,
      ["show-ref", "--verify", `refs/heads/${session.landing_unit.branch}`],
      repoRoot,
    );
    const args = branch.ok
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
    return target;
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

  return { ensureWorktree, readArtifact, resolveBase, resolveWorktree };
}
