import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { canonicalDigest } from "./canonical-json.js";
import { createAgentSourceIdentityAdapter } from "./agent-source-identity.js";
import {
  DELIVERY_ART_EVIDENCE_PROFILE_PATH,
  DeliveryArtEvidenceAcquisitionError,
  selectTrustedDeliveryArtEvidenceProfile,
} from "./review-evidence-acquisition.js";
import { deliveryArtWorktreeRelativePath } from "./work-session.js";

const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_REALIZATION_CONTEXT_BYTES = 256 * 1024;
const MAX_REALIZATION_FILE_BYTES = 64 * 1024;
const MAX_REALIZATION_FILES = 48;
const MAX_REALIZATION_TREE_PATHS = 5_000;

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedRealizationPath(value) {
  const candidate = String(value ?? "").replaceAll("\\", "/");
  if (
    !candidate ||
    candidate.length > 240 ||
    candidate.startsWith("/") ||
    candidate.includes("\0") ||
    candidate.split("/").some((part) => !part || part === "." || part === "..") ||
    candidate.split("/").includes(".git")
  ) {
    throw new Error(`Source realization path is outside the bounded repository surface: ${value}.`);
  }
  const basename = candidate.split("/").at(-1).toLowerCase();
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "id_rsa" ||
    basename === "id_ed25519" ||
    /\.(?:pem|p12|pfx|key)$/i.test(basename)
  ) {
    throw new Error(`Source realization path is credential-sensitive: ${candidate}.`);
  }
  return candidate;
}

function command(execFileSyncImpl, args, cwd) {
  try {
    return String(execFileSyncImpl("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
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
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
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
  agentSourceIdentity = null,
  changeDirectory = (target) => process.chdir(target),
  currentDirectory = () => process.cwd(),
  execFileSyncImpl = execFileSync,
  worktreeRelativePath = deliveryArtWorktreeRelativePath,
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
    return path.join(workspaceRoot, worktreeRelativePath(session));
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
    const fields = "number,state,isDraft,url,headRefOid,baseRefName,mergeCommit";
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
    let review = {
      approved: false,
      required_reviewer_id: null,
      reviewed_head_commit: null,
      state: "unverified",
    };
    if (
      state === "OPEN" &&
      !pullRequest.isDraft &&
      Number.isInteger(pullRequest.number) &&
      typeof agentSourceIdentity?.reviewPolicy === "function"
    ) {
      const policy = agentSourceIdentity.reviewPolicy({ session });
      const author = executableCommand(
        execFileSyncImpl,
        "gh",
        [
          "api",
          `/repos/${policy.repository}/pulls/${pullRequest.number}`,
          "--jq",
          ".user.login",
        ],
        repoRoot,
      );
      const rawReviews = executableCommand(
        execFileSyncImpl,
        "gh",
        [
          "api",
          `/repos/${policy.repository}/pulls/${pullRequest.number}/reviews`,
          "--paginate",
          "--jq",
          ".[] | {commit_id, id, state, user: {login: .user.login}}",
        ],
        repoRoot,
      );
      const reviews = rawReviews
        .split("\n")
        .filter(Boolean)
        .map((entry) => JSON.parse(entry));
      const decisive = reviews
        .filter((entry) =>
          entry?.user?.login === policy.required_reviewer_id &&
          ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(
            String(entry?.state ?? "").toUpperCase(),
          ))
        .sort((left, right) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
      const latest = decisive.at(-1) ?? null;
      const latestState = String(latest?.state ?? "").toUpperCase();
      const authorValid =
        author === policy.source_author_id &&
        author !== policy.required_reviewer_id;
      const exactHead = latest?.commit_id === pullRequest.headRefOid;
      review = {
        approved: authorValid && latestState === "APPROVED" && exactHead,
        required_reviewer_id: policy.required_reviewer_id,
        reviewed_head_commit: latest?.commit_id ?? null,
        state: !authorValid
          ? "source-author-invalid"
          : !latest
            ? "missing"
            : latestState === "APPROVED" && !exactHead
              ? "stale"
              : latestState.toLowerCase().replaceAll("_", "-"),
      };
    }
    return {
      base_ref: pullRequest.baseRefName ?? null,
      head_commit: pullRequest.headRefOid ?? null,
      merge_commit: pullRequest.mergeCommit?.oid ?? null,
      review,
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

  async function inspectPristineSession(session) {
    const repoRoot = canonicalRepo(session.owner_repo);
    const baseCommitAvailable = optionalCommand(
      execFileSyncImpl,
      ["cat-file", "-e", `${session.landing_unit.base_commit}^{commit}`],
      repoRoot,
    ).ok;
    const worktree = parseWorktrees(
      command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
    ).find((entry) => entry.branch === session.landing_unit.branch) ?? null;
    const localHead = localBranchHead(repoRoot, session.landing_unit.branch);
    const remoteHead = remoteBranchHead(
      repoRoot,
      "origin",
      session.landing_unit.branch,
    );
    const pullRequest = await inspectPullRequest(session);
    const changedFiles = worktree
      ? command(execFileSyncImpl, ["status", "--porcelain"], worktree.path)
        .split("\n")
        .filter(Boolean)
        .map((line) => line.slice(3))
      : [];
    const reasons = [];
    if (changedFiles.length > 0) reasons.push("worktree-has-changes");
    if (worktree?.head && worktree.head !== session.landing_unit.base_commit) {
      reasons.push("worktree-head-advanced");
    }
    if (localHead && localHead !== session.landing_unit.base_commit) {
      reasons.push("local-branch-head-advanced");
    }
    if (remoteHead) reasons.push("remote-branch-exists");
    if (pullRequest.state !== "missing") reasons.push("pull-request-exists");
    return {
      base_commit_available: baseCommitAvailable,
      changed_files: changedFiles,
      local_branch_head: localHead,
      pristine: reasons.length === 0,
      pull_request: pullRequest,
      reasons,
      remote_branch_head: remoteHead,
      worktree_head: worktree?.head ?? null,
      worktree_present: Boolean(worktree),
    };
  }

  async function retirePristineSession({ resources = [], session }) {
    const proof = await inspectPristineSession(session);
    if (!proof.pristine) {
      const error = new Error(
        "Architecture reconstruction cannot retire a work session with source activity.",
      );
      error.code = "delivery_art_work_session_reconstruction_not_pristine";
      error.details = proof;
      throw error;
    }
    const repoRoot = canonicalRepo(session.owner_repo);
    const outcomes = [];
    const owned = (resourceType) => resources.find((resource) =>
      resource.resource_type === resourceType &&
      resource.ownership_provenance === "session-created" &&
      resource.locator?.ownership_marker === session.session_id);
    const worktreeResource = owned("git-worktree");
    if (worktreeResource) {
      if (proof.worktree_present) {
        const target = managedWorktree(
          session,
          worktreeResource.locator.workspace_relative_path,
        );
        if (currentInside(target)) {
          const error = new Error(
            "Architecture reconstruction cannot remove the active process worktree.",
          );
          error.code = "delivery_art_work_session_reconstruction_worktree_active";
          throw error;
        }
        command(execFileSyncImpl, ["worktree", "remove", "--", target], repoRoot);
        outcomes.push({ resource_type: "git-worktree", outcome: "removed" });
      } else {
        outcomes.push({ resource_type: "git-worktree", outcome: "absent" });
      }
    } else {
      outcomes.push({ resource_type: "git-worktree", outcome: "retained" });
    }
    const branchResource = owned("git-local-branch");
    if (branchResource) {
      if (localBranchHead(repoRoot, session.landing_unit.branch)) {
        command(execFileSyncImpl, [
          "update-ref",
          "-d",
          `refs/heads/${session.landing_unit.branch}`,
          session.landing_unit.base_commit,
        ], repoRoot);
        outcomes.push({ resource_type: "git-local-branch", outcome: "removed" });
      } else {
        outcomes.push({ resource_type: "git-local-branch", outcome: "absent" });
      }
    } else {
      outcomes.push({ resource_type: "git-local-branch", outcome: "retained" });
    }
    outcomes.push({ resource_type: "git-remote-branch", outcome: "absent" });
    return { outcomes, proof };
  }

  async function mergePullRequest(session, expectedPullRequest) {
    const current = await inspectPullRequest(session);
    const expectedBase = branchName(session.landing_unit.base_ref);
    if (
      current.state !== "open" ||
      !current.url ||
      !current.head_commit ||
      current.review?.approved !== true ||
      current.base_ref !== expectedBase ||
      current.url !== expectedPullRequest?.url ||
      current.head_commit !== expectedPullRequest?.head_commit
    ) {
      const error = new Error(
        "The pull request changed after merge readiness was observed.",
      );
      error.code = "delivery_art_work_session_merge_binding_blocked";
      error.details = { current, expected: expectedPullRequest ?? null };
      throw error;
    }
    const repoRoot = canonicalRepo(session.owner_repo);
    agentSourceIdentity?.assertHumanMergeAuthority({ repoRoot, session });
    executableCommand(
      execFileSyncImpl,
      "gh",
      [
        "pr",
        "merge",
        current.url,
        "--squash",
        "--admin",
        "--match-head-commit",
        current.head_commit,
      ],
      repoRoot,
    );
    const merged = await inspectPullRequest(session);
    if (
      merged.state !== "merged" ||
      merged.url !== current.url ||
      merged.head_commit !== current.head_commit ||
      !merged.merge_commit
    ) {
      const error = new Error(
        "GitHub did not return exact merged pull-request evidence.",
      );
      error.code = "delivery_art_work_session_merge_outcome_unknown";
      error.details = { merged, expected: current };
      throw error;
    }
    return merged;
  }

  async function ensureWorktree(session) {
    return (await ensureOwnedWorktree(session)).path;
  }

  async function inspectAgentSource(session) {
    if (!agentSourceIdentity) return { state: "inactive" };
    return agentSourceIdentity.inspect({
      repoRoot: await resolveWorktree(session),
      session,
    });
  }

  async function inspectRepositoryAdmission(session) {
    if (!agentSourceIdentity) return { state: "inactive" };
    return agentSourceIdentity.inspectRepositoryAdmission({ session });
  }

  async function inspectSourceCredentialBinding(session) {
    if (typeof agentSourceIdentity?.sourceIntentBinding !== "function") {
      throw new Error("The admitted source identity metadata adapter is unavailable.");
    }
    return agentSourceIdentity.sourceIntentBinding({ session });
  }

  async function inspectConfiguredPath(
    session,
    { conformanceCases = [], requiredEvidenceKinds = [] } = {},
  ) {
    const admission = await inspectRepositoryAdmission(session);
    if (admission.state === "blocked") {
      return {
        admission,
        base: {
          fetched_commit: null,
          ref: session.landing_unit.base_ref,
          remote_commit: null,
          state: "pending-admission",
        },
        branch: {
          local_commit: null,
          name: session.landing_unit.branch,
          remote_commit: null,
          state: "pending-admission",
          worktree_present: false,
        },
        identity: {
          reason_code: admission.reason_code,
          state: "blocked",
        },
        owner_repo: {
          changed_files: [],
          name: session.owner_repo,
          state: "pending-admission",
        },
        provider: { state: "pending-admission" },
        runtime: {
          credential_ref: null,
          profile_id: null,
          secret_values_embedded: false,
        },
      };
    }
    const repoRoot = canonicalRepo(session.owner_repo);
    if (
      !session.landing_unit.base_ref ||
      String(session.landing_unit.base_ref).startsWith("-")
    ) {
      throw new Error("Landing Unit base_ref must be a valid Git revision.");
    }
    command(
      execFileSyncImpl,
      ["check-ref-format", "--branch", session.landing_unit.branch],
      repoRoot,
    );
    const baseCommit = command(
      execFileSyncImpl,
      ["rev-parse", "--verify", `${session.landing_unit.base_ref}^{commit}`],
      repoRoot,
    );
    const remoteBaseCommit = session.landing_unit.base_ref.startsWith("origin/")
      ? remoteBranchHead(
          repoRoot,
          "origin",
          branchName(session.landing_unit.base_ref),
        )
      : null;
    const evidenceProfileRequired =
      conformanceCases.length > 0 || requiredEvidenceKinds.length > 0;
    let evidenceProfileSelection = null;
    if (
      evidenceProfileRequired &&
      (!remoteBaseCommit || remoteBaseCommit === baseCommit)
    ) {
      const history = optionalCommand(
        execFileSyncImpl,
        [
          "log",
          "--format=%H",
          "--max-count=50",
          baseCommit,
          "--",
          DELIVERY_ART_EVIDENCE_PROFILE_PATH,
        ],
        repoRoot,
      );
      const revisions = [
        baseCommit,
        ...(history.ok ? history.output.split("\n").filter(Boolean) : []),
      ];
      evidenceProfileSelection = selectTrustedDeliveryArtEvidenceProfile({
        conformanceCases,
        ownerRepo: session.owner_repo,
        readProfileText(revision) {
          const result = optionalCommand(
            execFileSyncImpl,
            ["show", `${revision}:${DELIVERY_ART_EVIDENCE_PROFILE_PATH}`],
            repoRoot,
          );
          return result.ok ? result.output : null;
        },
        requiredEvidenceKinds,
        revisions,
      });
    }
    const worktree = parseWorktrees(
      command(execFileSyncImpl, ["worktree", "list", "--porcelain"], repoRoot),
    ).find((entry) => entry.branch === session.landing_unit.branch) ?? null;
    const localBranchCommit = localBranchHead(repoRoot, session.landing_unit.branch);
    const remoteBranchCommit = remoteBranchHead(
      repoRoot,
      "origin",
      session.landing_unit.branch,
    );
    const changedFiles = command(
      execFileSyncImpl,
      ["status", "--porcelain", "--untracked-files=normal"],
      repoRoot,
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
    const identity = agentSourceIdentity
      ? await agentSourceIdentity.preflight({
          session: {
            ...session,
            landing_unit: {
              ...session.landing_unit,
              base_commit: baseCommit,
            },
          },
        })
      : {
          identity: { state: "inactive" },
          provider: { state: "inactive" },
          runtime: {
            credential_ref: null,
            profile_id: null,
            secret_values_embedded: false,
          },
        };
    return {
      admission,
      base: {
        fetched_commit: baseCommit,
        ref: session.landing_unit.base_ref,
        remote_commit: remoteBaseCommit,
        state: remoteBaseCommit && remoteBaseCommit !== baseCommit
          ? "stale"
          : "ready",
      },
      branch: {
        local_commit: localBranchCommit,
        name: session.landing_unit.branch,
        remote_commit: remoteBranchCommit,
        state: worktree || localBranchCommit || remoteBranchCommit
          ? "occupied"
          : "available",
        worktree_present: Boolean(worktree),
      },
      identity: identity.identity,
      owner_repo: {
        changed_files: changedFiles,
        name: session.owner_repo,
        state: changedFiles.length === 0 ? "clean" : "dirty",
      },
      provider: identity.provider,
      runtime: {
        ...identity.runtime,
        ...(evidenceProfileSelection
          ? {
              evidence_profile: {
                profile_id: evidenceProfileSelection.profile.profile_id,
                profile_revision: evidenceProfileSelection.profile_revision,
                selection: evidenceProfileSelection.used_reviewed_ancestor
                  ? "reviewed-ancestor-repair"
                  : "base",
              },
            }
          : {}),
      },
    };
  }

  function realizationTarget(worktree, relativePath) {
    const normalized = normalizedRealizationPath(relativePath);
    const target = path.resolve(worktree, ...normalized.split("/"));
    if (!target.startsWith(`${path.resolve(worktree)}${path.sep}`)) {
      throw new Error("Source realization path escapes the managed worktree.");
    }
    let current = path.resolve(worktree);
    for (const segment of normalized.split("/").slice(0, -1)) {
      current = path.join(current, segment);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`Source realization path traverses a symbolic link: ${normalized}.`);
      }
    }
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
      throw new Error(`Source realization target is a symbolic link: ${normalized}.`);
    }
    return { normalized, target };
  }

  function readableRealizationFile(worktree, relativePath) {
    const { normalized, target } = realizationTarget(worktree, relativePath);
    if (!existsSync(target)) return null;
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > MAX_REALIZATION_FILE_BYTES) return null;
    const content = readFileSync(target);
    if (content.includes(0)) return null;
    const text = content.toString("utf8");
    return {
      path: normalized,
      content: text,
      content_digest: contentDigest(text),
      size_bytes: content.length,
    };
  }

  async function captureRealizationContext(session, { requestedPaths = [] } = {}) {
    const worktree = await resolveWorktree(session);
    if (!worktree) {
      const error = new Error("Prepare or reconstruct the managed worktree through authorized work continuation before capturing source context.");
      error.code = "delivery_art_source_realization_worktree_missing";
      throw error;
    }
    workspaceRelativePath(worktree);
    const headCommit = command(execFileSyncImpl, ["rev-parse", "HEAD"], worktree);
    const status = command(
      execFileSyncImpl,
      ["status", "--porcelain", "--untracked-files=normal"],
      worktree,
    );
    if (status || headCommit !== session.landing_unit.base_commit) {
      const error = new Error("Source realization requires a clean managed worktree.");
      error.code = status
        ? "delivery_art_source_realization_worktree_dirty"
        : "delivery_art_source_realization_source_drift";
      throw error;
    }
    const allPaths = command(
      execFileSyncImpl,
      ["ls-files", "-co", "--exclude-standard"],
      worktree,
    )
      .split("\n")
      .filter(Boolean)
      .map(normalizedRealizationPath)
      .sort();
    const explicit = [...new Set(requestedPaths.map(normalizedRealizationPath))];
    const preferred = explicit.length > 0
      ? explicit
      : allPaths.sort((left, right) => {
          const rank = (value) => {
            const basename = value.split("/").at(-1).toLowerCase();
            if (["agents.md", "readme.md", "package.json", "pyproject.toml", "go.mod", "cargo.toml"].includes(basename)) return 0;
            if (/^(?:src|app|lib|test|tests)\//.test(value)) return 1;
            return 2;
          };
          return rank(left) - rank(right) || left.localeCompare(right);
        });
    const files = [];
    let admittedBytes = 0;
    for (const candidate of preferred) {
      if (files.length >= MAX_REALIZATION_FILES) break;
      const file = readableRealizationFile(worktree, candidate);
      if (!file) continue;
      if (admittedBytes + file.size_bytes > MAX_REALIZATION_CONTEXT_BYTES) break;
      files.push(file);
      admittedBytes += file.size_bytes;
    }
    if (explicit.length > 0) {
      const admitted = new Set(files.map((file) => file.path));
      const missing = explicit.filter((entry) => !admitted.has(entry));
      if (missing.length > 0) {
        const error = new Error(`Requested source context is unavailable or unsafe: ${missing.join(", ")}.`);
        error.code = "delivery_art_source_realization_context_unavailable";
        throw error;
      }
    }
    const context = {
      schema_version: 1,
      session_id: session.session_id,
      owner_repo: session.owner_repo,
      landing_unit_id: session.landing_unit_id,
      head_commit: headCommit,
      clean: true,
      tree: {
        paths: allPaths.slice(0, MAX_REALIZATION_TREE_PATHS),
        total_path_count: allPaths.length,
        truncated: allPaths.length > MAX_REALIZATION_TREE_PATHS,
      },
      files,
      admitted_bytes: admittedBytes,
    };
    return { ...context, context_digest: contentDigest(JSON.stringify(context)) };
  }

  async function applySourceRealization(session, changeSet) {
    if (
      changeSet?.schema_version !== 1 ||
      changeSet?.session_id !== session.session_id ||
      changeSet?.base_commit !== session.landing_unit.base_commit ||
      typeof changeSet?.commit_message !== "string" ||
      changeSet.commit_message.length < 10 ||
      !Array.isArray(changeSet?.operations) ||
      changeSet.operations.length < 1 ||
      changeSet.operations.length > 64 ||
      new Set(changeSet.operations.map((entry) => entry?.path)).size !==
        changeSet.operations.length
    ) {
      const error = new Error("Source realization change set failed the executor binding.");
      error.code = "delivery_art_source_realization_change_set_invalid";
      throw error;
    }
    const worktree = await ensureWorktree(session);
    const headBefore = command(execFileSyncImpl, ["rev-parse", "HEAD"], worktree);
    const statusBefore = command(
      execFileSyncImpl,
      ["status", "--porcelain", "--untracked-files=normal"],
      worktree,
    );
    if (statusBefore) {
      const error = new Error("Source realization binding changed before apply.");
      error.code = "delivery_art_source_realization_source_drift";
      throw error;
    }
    const changeSetDigest = canonicalDigest(changeSet);
    const expectedPaths = changeSet.operations.map((operation) =>
      normalizedRealizationPath(operation.path)).sort();

    function committedReceipt(headCommit) {
      const author = command(
        execFileSyncImpl,
        ["show", "-s", "--format=%an <%ae>", headCommit],
        worktree,
      );
      const receipt = {
        schema_version: 1,
        receipt_id: `source-realization-receipt:${headCommit.slice(0, 24)}`,
        session_id: session.session_id,
        change_set_digest: changeSetDigest,
        base_commit: changeSet.base_commit,
        head_commit: headCommit,
        changed_files: expectedPaths,
        author,
        outcome: "committed",
        secret_values_embedded: false,
      };
      return { ...receipt, receipt_digest: canonicalDigest(receipt) };
    }

    if (headBefore !== changeSet.base_commit) {
      const parent = optionalCommand(execFileSyncImpl, ["rev-parse", "HEAD^"], worktree);
      const message = command(execFileSyncImpl, ["show", "-s", "--format=%B", "HEAD"], worktree);
      const changedPaths = command(
        execFileSyncImpl,
        ["diff", "--name-only", changeSet.base_commit, "HEAD"],
        worktree,
      ).split("\n").filter(Boolean).sort();
      const trailer = `OOS-Source-Realization-Digest: ${changeSetDigest}`;
      const exactCommit = parent.ok &&
        parent.output === changeSet.base_commit &&
        message.split("\n").includes(trailer) &&
        JSON.stringify(changedPaths) === JSON.stringify(expectedPaths) &&
        changeSet.operations.every((operation) => {
          const { target } = realizationTarget(worktree, operation.path);
          if (operation.action === "delete") return !existsSync(target);
          return existsSync(target) &&
            lstatSync(target).isFile() &&
            contentDigest(readFileSync(target, "utf8")) === contentDigest(operation.content);
        });
      if (exactCommit) return committedReceipt(headBefore);
      const error = new Error("Source realization binding changed before apply.");
      error.code = "delivery_art_source_realization_source_drift";
      throw error;
    }
    const prepared = [];
    let totalBytes = 0;
    for (const operation of changeSet.operations ?? []) {
      if (!["create", "replace", "delete"].includes(operation?.action)) {
        throw new Error("Source realization action is not allowlisted.");
      }
      const { normalized, target } = realizationTarget(worktree, operation.path);
      const exists = existsSync(target);
      const current = exists ? lstatSync(target) : null;
      if (exists && (!current.isFile() || current.isSymbolicLink())) {
        throw new Error(`Source realization target is not a regular file: ${normalized}.`);
      }
      const currentContent = exists ? readFileSync(target, "utf8") : null;
      const currentDigest = currentContent === null ? null : contentDigest(currentContent);
      if (operation.action === "create" && exists) {
        throw new Error(`Source realization create target already exists: ${normalized}.`);
      }
      if (operation.action !== "create" && !exists) {
        throw new Error(`Source realization target does not exist: ${normalized}.`);
      }
      if (operation.action !== "create" && currentDigest !== operation.expected_digest) {
        const error = new Error(`Source realization expected digest is stale: ${normalized}.`);
        error.code = "delivery_art_source_realization_source_drift";
        throw error;
      }
      if (operation.action !== "delete") {
        const size = Buffer.byteLength(operation.content, "utf8");
        totalBytes += size;
        if (size > MAX_REALIZATION_FILE_BYTES || totalBytes > 512 * 1024) {
          throw new Error("Source realization change set exceeds the bounded content limit.");
        }
      }
      prepared.push({
        ...operation,
        normalized,
        target,
        mode: current?.mode ?? 0o644,
        original_content: currentContent,
      });
    }
    await prepareAgentSource(session);
    let committed = false;
    try {
      for (const operation of prepared) {
        if (operation.action === "delete") {
          unlinkSync(operation.target);
          continue;
        }
        mkdirSync(path.dirname(operation.target), { recursive: true, mode: 0o755 });
        const temporary = `${operation.target}.source-realization-${process.pid}.tmp`;
        writeFileSync(temporary, operation.content, { encoding: "utf8", mode: operation.mode & 0o777 });
        chmodSync(temporary, operation.mode & 0o777);
        renameSync(temporary, operation.target);
      }
      command(execFileSyncImpl, ["diff", "--check"], worktree);
      command(execFileSyncImpl, ["add", "--all"], worktree);
      const staged = command(execFileSyncImpl, ["diff", "--cached", "--name-only"], worktree)
        .split("\n")
        .filter(Boolean)
        .sort();
      if (staged.length === 0) {
        const error = new Error("Source realization produced no source change.");
        error.code = "delivery_art_source_realization_empty_change";
        throw error;
      }
      if (JSON.stringify(staged) !== JSON.stringify(expectedPaths)) {
        const error = new Error("Source realization changed paths outside the accepted change set.");
        error.code = "delivery_art_source_realization_source_drift";
        throw error;
      }
      command(
        execFileSyncImpl,
        ["commit", "-m", changeSet.commit_message, "-m", `OOS-Source-Realization-Digest: ${changeSetDigest}`],
        worktree,
      );
      committed = true;
      return committedReceipt(command(execFileSyncImpl, ["rev-parse", "HEAD"], worktree));
    } catch (error) {
      if (!committed && command(execFileSyncImpl, ["rev-parse", "HEAD"], worktree) === headBefore) {
        for (const operation of prepared) {
          if (operation.original_content === null) {
            if (existsSync(operation.target)) unlinkSync(operation.target);
            continue;
          }
          mkdirSync(path.dirname(operation.target), { recursive: true, mode: 0o755 });
          writeFileSync(operation.target, operation.original_content, {
            encoding: "utf8",
            mode: operation.mode & 0o777,
          });
          chmodSync(operation.target, operation.mode & 0o777);
        }
        command(execFileSyncImpl, ["reset", "--quiet", "HEAD", "--", "."], worktree);
      }
      throw error;
    }
  }

  async function prepareAgentSource(session) {
    if (!agentSourceIdentity) return { state: "inactive" };
    return agentSourceIdentity.prepare({
      repoRoot: await ensureWorktree(session),
      session,
    });
  }

  async function publishAgentSource(session) {
    if (!agentSourceIdentity) {
      const error = new Error("Agent source identity is not active.");
      error.code = "agent_source_identity_inactive";
      throw error;
    }
    return agentSourceIdentity.publish({
      repoRoot: await ensureWorktree(session),
      session,
    });
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
    const reviewedBase = optionalCommand(
      execFileSyncImpl,
      ["merge-base", head, ancestry[1]],
      repoRoot,
    );
    if (!reviewedBase.ok || !/^[0-9a-f]{40}$/.test(reviewedBase.output)) {
      return {
        ok: false,
        reason: "reviewed branch and squash parent do not share a proven base",
      };
    }
    if (!optionalCommand(
      execFileSyncImpl,
      [
        "merge-base",
        "--is-ancestor",
        session.landing_unit.base_commit,
        reviewedBase.output,
      ],
      repoRoot,
    ).ok) {
      return {
        ok: false,
        reason: "reviewed branch base does not descend from the recorded session base",
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
      [...diffArgs, reviewedBase.output, head, "--"],
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
    applySourceRealization,
    captureRealizationContext,
    ensureOwnedWorktree,
    ensureWorktree,
    inspectConfiguredPath,
    inspectRepositoryAdmission,
    inspectSourceCredentialBinding,
    inspectResourceOwnership,
    inspectPullRequest,
    inspectAgentSource,
    inspectPristineSession,
    mergePullRequest,
    planResourceRetirement,
    prepareResourceRetirementExecution,
    prepareAgentSource,
    publishAgentSource,
    readArtifact,
    resolveBase,
    resolveWorktree,
    retirePristineSession,
    retireResource,
  };
}


export function createConfiguredAgentSourceIdentityAdapter({
  env = process.env,
  credentialPurpose = null,
} = {}) {
  const enabled = ["1", "true", "yes", "on"].includes(
    String(env.OOS_AGENT_SOURCE_IDENTITY_ENABLED ?? "").trim().toLowerCase(),
  );
  return createAgentSourceIdentityAdapter({
    enabled,
    credentialPurpose,
    credentialRoot: resolveAgentSourceCredentialRoot(env),
    ...(env.OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH?.trim()
      ? { contractPath: env.OOS_AGENT_SOURCE_IDENTITY_CONTRACT_PATH.trim() }
      : {}),
  });
}

export function resolveAgentSourceCredentialRoot(env = process.env) {
  const configured = env.OOS_AGENT_SOURCE_IDENTITY_ROOT?.trim();
  if (configured) return configured;
  const runtimeRoot = env.XDG_RUNTIME_DIR?.trim();
  return runtimeRoot
    ? path.join(runtimeRoot, "platform-engineering", "agent-source-identity")
    : null;
}
