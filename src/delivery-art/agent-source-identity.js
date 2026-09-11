import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalDigest } from "./canonical-json.js";

const ASKPASS_PATH = fileURLToPath(
  new URL("../../scripts/agent_source_git_askpass.mjs", import.meta.url),
);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const CONTRACT_PATH = fileURLToPath(
  new URL(
    "../../contracts/delivery-art-work-session/agent-source-identity.json",
    import.meta.url,
  ),
);
const CREDENTIAL_FIELDS = new Set([
  "schema_version",
  "identity_id",
  "logical_agent_id",
  "provider_principal",
  "app_id",
  "installation_id",
  "repository",
  "repository_id",
  "landing_unit_id",
  "branch",
  "fetched_base",
  "human_reviewer_id",
  "token",
  "token_expires_at",
]);

export class AgentSourceIdentityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "AgentSourceIdentityError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new AgentSourceIdentityError(code, message, details);
}

function command(execFileSyncImpl, executable, args, options = {}) {
  try {
    return String(execFileSyncImpl(executable, args, {
      cwd: options.cwd,
      encoding: "utf8",
      env: options.env,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }) ?? "").trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.stdout ?? error?.message ?? "")
      .trim();
    fail(
      "agent_source_command_failed",
      `${path.basename(executable)} ${args[0] ?? "command"} failed.`,
      detail ? { detail: detail.slice(0, 500) } : null,
    );
  }
}

function assertPrivatePath(target, kind, expectedMode) {
  if (!existsSync(target)) {
    fail(`agent_source_${kind}_missing`, `Agent source ${kind} is unavailable.`);
  }
  const info = lstatSync(target);
  if (info.isSymbolicLink()) {
    fail(`agent_source_${kind}_unsafe`, `Agent source ${kind} cannot be a symlink.`);
  }
  const actualMode = statSync(target).mode & 0o777;
  if ((actualMode & 0o077) !== 0 || actualMode > expectedMode) {
    fail(
      `agent_source_${kind}_unsafe`,
      `Agent source ${kind} has unsafe file permissions.`,
    );
  }
  return info;
}

function validateContract(contract) {
  const errors = [];
  if (contract?.schema_version !== 1) errors.push("schema_version");
  if (contract?.owner_repo !== "operator-orchestration-service") errors.push("owner_repo");
  if (contract?.activation_work_item_id !== "work-item-1137") errors.push("activation_work_item_id");
  if (contract?.runtime?.reread_per_action !== true) errors.push("reread_per_action");
  if (contract?.source_boundary?.one_repository_per_session !== true) {
    errors.push("one_repository_per_session");
  }
  if (contract?.source_boundary?.human_approval_and_merge_required !== true) {
    errors.push("human_approval_and_merge_required");
  }
  if (contract?.source_boundary?.ambient_human_credential_fallback !== false) {
    errors.push("ambient_human_credential_fallback");
  }
  if (!Array.isArray(contract?.repositories) || contract.repositories.length === 0) {
    errors.push("repositories");
  }
  if (errors.length > 0) {
    fail(
      "agent_source_contract_invalid",
      `Agent source consumer contract is invalid: ${errors.join(", ")}.`,
    );
  }
  return contract;
}

function loadContract(contractPath) {
  try {
    return validateContract(JSON.parse(readFileSync(contractPath, "utf8")));
  } catch (error) {
    if (error instanceof AgentSourceIdentityError) throw error;
    fail("agent_source_contract_invalid", "Agent source consumer contract is invalid.");
  }
}

function sessionDirectory(root, landingUnitId) {
  const digest = createHash("sha256").update(landingUnitId).digest("hex").slice(0, 24);
  return path.join(root, "sessions", digest);
}

function expectedRepository(contract, ownerRepo) {
  const fullName = `mfshaf7/${ownerRepo}`;
  const match = contract.repositories.filter((entry) => entry.full_name === fullName);
  if (match.length !== 1) {
    fail(
      "agent_source_repository_not_admitted",
      "The owner repository is outside the admitted Agent source set.",
      { owner_repo: ownerRepo },
    );
  }
  return match[0];
}

function assertSession(contract, session) {
  const branchPattern = new RegExp(contract.source_boundary.allowed_branch_pattern);
  if (
    !session?.landing_unit_id ||
    !session?.owner_repo ||
    !session?.landing_unit ||
    !COMMIT_PATTERN.test(session.landing_unit.base_commit ?? "") ||
    session.landing_unit.branch === contract.source_boundary.canonical_branch ||
    !branchPattern.test(session.landing_unit.branch ?? "")
  ) {
    fail("agent_source_session_invalid", "Work-session source binding is invalid.");
  }
  return expectedRepository(contract, session.owner_repo);
}

function readCredential({ clock, contract, credentialRoot, session }) {
  assertPrivatePath(credentialRoot, "runtime_root", 0o700);
  if (existsSync(path.join(credentialRoot, contract.runtime.suspension_filename))) {
    fail("agent_source_identity_suspended", "Agent source identity is suspended.");
  }
  const directory = sessionDirectory(credentialRoot, session.landing_unit_id);
  assertPrivatePath(directory, "session_directory", 0o700);
  const credentialPath = path.join(directory, contract.runtime.credential_filename);
  assertPrivatePath(credentialPath, "credential", 0o600);
  let credential;
  try {
    credential = JSON.parse(readFileSync(credentialPath, "utf8"));
  } catch {
    fail("agent_source_credential_invalid", "Agent source credential is invalid.");
  }
  if (
    !credential ||
    Array.isArray(credential) ||
    new Set(Object.keys(credential)).size !== CREDENTIAL_FIELDS.size ||
    [...CREDENTIAL_FIELDS].some((field) => !Object.hasOwn(credential, field)) ||
    typeof credential.token !== "string" ||
    !credential.token
  ) {
    fail("agent_source_credential_invalid", "Agent source credential has an invalid shape.");
  }
  const repository = assertSession(contract, session);
  const expected = {
    schema_version: 1,
    identity_id: contract.identity.identity_id,
    logical_agent_id: contract.identity.logical_agent_id,
    provider_principal: contract.identity.provider_principal,
    app_id: contract.identity.app_id,
    installation_id: contract.identity.installation_id,
    repository: repository.full_name,
    repository_id: repository.id,
    landing_unit_id: session.landing_unit_id,
    branch: session.landing_unit.branch,
    fetched_base: session.landing_unit.base_commit,
    human_reviewer_id: contract.identity.human_reviewer_id,
  };
  const mismatch = Object.entries(expected).find(
    ([field, value]) => credential[field] !== value,
  );
  if (mismatch) {
    fail(
      "agent_source_credential_binding_mismatch",
      "Agent source credential does not match the admitted work session.",
      { field: mismatch[0] },
    );
  }
  const expiresAt = Date.parse(credential.token_expires_at);
  if (!Number.isFinite(expiresAt)) {
    fail("agent_source_credential_invalid", "Agent source credential expiry is invalid.");
  }
  const remainingSeconds = (expiresAt - clock().getTime()) / 1000;
  if (remainingSeconds <= contract.runtime.rotate_before_expiry_seconds) {
    fail(
      "agent_source_credential_rotation_required",
      "Agent source credential is expired or inside its required rotation window.",
      { authorization_expires_at: credential.token_expires_at },
    );
  }
  return { credential, credentialPath, repository };
}

function safeIdentityProjection(contract, session, credential = null) {
  const repository = expectedRepository(contract, session.owner_repo);
  return {
    identity_id: contract.identity.identity_id,
    logical_agent_id: contract.identity.logical_agent_id,
    display_name: contract.identity.display_name,
    provider_principal: contract.identity.provider_principal,
    definition_digest: contract.authority.platform_definition.digest,
    app_id: contract.identity.app_id,
    installation_id: contract.identity.installation_id,
    repository: repository.full_name,
    repository_id: repository.id,
    landing_unit_id: session.landing_unit_id,
    branch: session.landing_unit.branch,
    fetched_base: session.landing_unit.base_commit,
    human_reviewer_id: contract.identity.human_reviewer_id,
    git_author_name: contract.identity.git_author_name,
    git_author_email: contract.identity.git_author_email,
    authorization_expires_at: credential?.token_expires_at ?? null,
  };
}

async function withProjectionLock(lockPath, operation, { spawnImpl = spawn } = {}) {
  assertPrivatePath(lockPath, "projection_lock", 0o600);
  return new Promise((resolve, reject) => {
    const child = spawnImpl(
      "flock",
      [
        "--exclusive",
        "--timeout",
        "10",
        lockPath,
        process.execPath,
        "-e",
        "process.stdout.write('locked\\n'); process.stdin.resume();",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let lockAcquired = false;
    let operationComplete = false;
    let operationResult;
    let operationError;
    let output = "";
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdout.on("data", async (chunk) => {
      if (lockAcquired) return;
      output += chunk;
      if (!output.includes("locked\n")) return;
      lockAcquired = true;
      try {
        operationResult = await operation();
      } catch (error) {
        operationError = error;
      } finally {
        operationComplete = true;
        child.stdin.end();
      }
    });
    child.once("error", (error) => {
      if (lockAcquired) return;
      reject(new AgentSourceIdentityError(
        "agent_source_projection_lock_unavailable",
        "Agent source projection lock is unavailable.",
        { cause: error.code ?? "spawn_failed" },
      ));
    });
    child.once("exit", (code) => {
      if (!lockAcquired || !operationComplete || code !== 0) {
        reject(new AgentSourceIdentityError(
          "agent_source_projection_lock_unavailable",
          "Agent source projection lock could not be acquired.",
          { exit_code: code, detail: errors.trim().slice(0, 200) || null },
        ));
        return;
      }
      if (operationError) reject(operationError);
      else resolve(operationResult);
    });
  });
}

async function providerRequest(fetchImpl, credential, pathname, options = {}) {
  const response = await fetchImpl(new URL(pathname, "https://api.github.com"), {
    method: options.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${credential.token}`,
      "content-type": "application/json",
      "user-agent": "operator-orchestration-service-agent-source",
      "x-github-api-version": "2022-11-28",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    fail(
      "agent_source_provider_request_failed",
      "GitHub rejected the bounded Agent source request.",
      { method: options.method ?? "GET", path: pathname, status: response.status },
    );
  }
  return response.status === 204 ? null : response.json();
}

async function assertProviderScope(fetchImpl, credential, repository) {
  const result = await providerRequest(fetchImpl, credential, "/installation/repositories");
  const repositories = result?.repositories ?? [];
  if (
    result?.total_count !== 1 ||
    repositories.length !== 1 ||
    repositories[0]?.id !== repository.id ||
    repositories[0]?.full_name !== repository.full_name
  ) {
    fail(
      "agent_source_provider_scope_mismatch",
      "Provider token scope does not match the exact admitted repository.",
    );
  }
}

function inspectSource(execFileSyncImpl, repoRoot, session, contract) {
  const git = (args) => command(execFileSyncImpl, "git", args, { cwd: repoRoot });
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  if (branch !== session.landing_unit.branch) {
    fail("agent_source_branch_mismatch", "Worktree is not on the admitted branch.");
  }
  if (dirty) {
    fail("agent_source_worktree_dirty", "Agent source publish requires a clean worktree.");
  }
  try {
    command(
      execFileSyncImpl,
      "git",
      ["merge-base", "--is-ancestor", session.landing_unit.base_commit, head],
      { cwd: repoRoot },
    );
  } catch {
    fail("agent_source_base_mismatch", "Source head does not descend from the fetched base.");
  }
  if (head === session.landing_unit.base_commit) {
    fail("agent_source_change_missing", "Agent source publish requires a committed change.");
  }
  const identities = git([
    "log",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce",
    `${session.landing_unit.base_commit}..${head}`,
  ]).split("\n").filter(Boolean);
  for (const row of identities) {
    const [commit, authorName, authorEmail, committerName, committerEmail] = row.split("\0");
    if (
      !COMMIT_PATTERN.test(commit ?? "") ||
      authorName !== contract.identity.git_author_name ||
      authorEmail !== contract.identity.git_author_email ||
      committerName !== contract.identity.git_author_name ||
      committerEmail !== contract.identity.git_author_email
    ) {
      fail(
        "agent_source_commit_identity_mismatch",
        "Every source commit must use the admitted Agent Git identity.",
        { commit: COMMIT_PATTERN.test(commit ?? "") ? commit : null },
      );
    }
  }
  return { head };
}

function configureAuthor(execFileSyncImpl, repoRoot, contract) {
  command(execFileSyncImpl, "git", ["config", "--local", "user.name", contract.identity.git_author_name], { cwd: repoRoot });
  command(execFileSyncImpl, "git", ["config", "--local", "user.email", contract.identity.git_author_email], { cwd: repoRoot });
  const name = command(execFileSyncImpl, "git", ["config", "--local", "--get", "user.name"], { cwd: repoRoot });
  const email = command(execFileSyncImpl, "git", ["config", "--local", "--get", "user.email"], { cwd: repoRoot });
  if (name !== contract.identity.git_author_name || email !== contract.identity.git_author_email) {
    fail("agent_source_git_author_mismatch", "Git author configuration did not match Agent Gary.");
  }
}

function authorReady(execFileSyncImpl, repoRoot, contract) {
  if (!repoRoot) return false;
  try {
    return (
      command(execFileSyncImpl, "git", ["config", "--local", "--get", "user.name"], { cwd: repoRoot }) === contract.identity.git_author_name &&
      command(execFileSyncImpl, "git", ["config", "--local", "--get", "user.email"], { cwd: repoRoot }) === contract.identity.git_author_email
    );
  } catch {
    return false;
  }
}

function pullRequestProjection(value) {
  return {
    base_ref: value?.base?.ref ?? null,
    head_commit: value?.head?.sha ?? null,
    number: value?.number ?? null,
    state: value?.merged_at
      ? "merged"
      : value?.state === "closed"
        ? "closed"
        : value?.draft
          ? "draft"
          : "open",
    url: value?.html_url ?? null,
    author: value?.user?.login ?? null,
  };
}

export function createAgentSourceIdentityAdapter({
  clock = () => new Date(),
  contractPath = CONTRACT_PATH,
  credentialRoot,
  enabled = false,
  execFileSyncImpl = execFileSync,
  fetchImpl = globalThis.fetch,
  lock = withProjectionLock,
} = {}) {
  const contract = loadContract(contractPath);
  if (enabled && (!credentialRoot || !path.isAbsolute(credentialRoot))) {
    throw new Error("An absolute Agent source credential root is required when enabled.");
  }
  if (enabled && typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required when Agent source identity is enabled.");
  }

  async function inspect({ repoRoot = null, session }) {
    if (!enabled) return { state: "inactive" };
    assertSession(contract, session);
    const projection = safeIdentityProjection(contract, session);
    try {
      const value = await lock(
        path.join(credentialRoot, contract.runtime.lock_filename),
        async () => readCredential({ clock, contract, credentialRoot, session }),
      );
      return {
        ...projection,
        state: authorReady(execFileSyncImpl, repoRoot, contract)
          ? "ready"
          : "author-setup-required",
        authorization_expires_at: value.credential.token_expires_at,
      };
    } catch (error) {
      if (!(error instanceof AgentSourceIdentityError)) throw error;
      const state = error.code === "agent_source_identity_suspended"
        ? "suspended"
        : [
            "agent_source_credential_missing",
            "agent_source_session_directory_missing",
            "agent_source_runtime_root_missing",
            "agent_source_credential_rotation_required",
            "agent_source_projection_lock_missing",
            "agent_source_projection_lock_unavailable",
          ].includes(error.code)
          ? "credential-required"
          : "invalid";
      return { ...projection, state, reason_code: error.code };
    }
  }

  async function prepare({ repoRoot, session }) {
    if (!enabled) return { state: "inactive" };
    assertSession(contract, session);
    configureAuthor(execFileSyncImpl, repoRoot, contract);
    const body = {
      ...safeIdentityProjection(contract, session),
      action: "configure-exact-git-author",
      outcome: "prepared",
      recorded_at: clock().toISOString(),
      secret_values_embedded: false,
    };
    return { ...body, receipt_digest: canonicalDigest(body), state: "author-ready" };
  }

  async function publish({ repoRoot, session }) {
    if (!enabled) {
      fail("agent_source_identity_inactive", "Agent source identity is not active.");
    }
    assertSession(contract, session);
    configureAuthor(execFileSyncImpl, repoRoot, contract);
    const source = inspectSource(execFileSyncImpl, repoRoot, session, contract);
    return lock(
      path.join(credentialRoot, contract.runtime.lock_filename),
      async () => {
        const { credential, credentialPath, repository } = readCredential({
          clock,
          contract,
          credentialRoot,
          session,
        });
        await assertProviderScope(fetchImpl, credential, repository);
        const environment = {
          ...process.env,
          GIT_ASKPASS: ASKPASS_PATH,
          GIT_TERMINAL_PROMPT: "0",
          OOS_AGENT_SOURCE_CREDENTIAL_FILE: credentialPath,
        };
        const remote = `https://github.com/${repository.full_name}.git`;
        command(
          execFileSyncImpl,
          "git",
          [
            "push",
            "--porcelain",
            remote,
            `${source.head}:refs/heads/${session.landing_unit.branch}`,
          ],
          { cwd: repoRoot, env: environment },
        );
        const refPath = `/repos/${repository.full_name}/git/ref/heads/${session.landing_unit.branch
          .split("/").map(encodeURIComponent).join("/")}`;
        const remoteRef = await providerRequest(fetchImpl, credential, refPath);
        if (remoteRef?.object?.sha !== source.head) {
          fail("agent_source_pushed_head_mismatch", "Provider branch head does not match the pushed source head.");
        }
        command(execFileSyncImpl, "git", ["update-ref", `refs/remotes/origin/${session.landing_unit.branch}`, source.head], { cwd: repoRoot });
        command(execFileSyncImpl, "git", ["config", `branch.${session.landing_unit.branch}.remote`, "origin"], { cwd: repoRoot });
        command(execFileSyncImpl, "git", ["config", `branch.${session.landing_unit.branch}.merge`, `refs/heads/${session.landing_unit.branch}`], { cwd: repoRoot });

        const owner = repository.full_name.split("/", 1)[0];
        const query = new URLSearchParams({
          state: "all",
          head: `${owner}:${session.landing_unit.branch}`,
          base: session.landing_unit.base_ref.replace(/^origin\//, ""),
          per_page: "10",
        });
        const existing = await providerRequest(
          fetchImpl,
          credential,
          `/repos/${repository.full_name}/pulls?${query}`,
        );
        if (!Array.isArray(existing)) {
          fail(
            "agent_source_provider_response_invalid",
            "GitHub returned an invalid pull-request collection.",
          );
        }
        if (existing.length > 1) {
          fail("agent_source_pull_request_ambiguous", "More than one pull request matches the admitted branch.");
        }
        let pullRequest = existing[0] ?? null;
        if (!pullRequest) {
          const title = command(execFileSyncImpl, "git", ["log", "-1", "--pretty=%s", source.head], { cwd: repoRoot });
          pullRequest = await providerRequest(
            fetchImpl,
            credential,
            `/repos/${repository.full_name}/pulls`,
            {
              method: "POST",
              body: {
                title,
                head: session.landing_unit.branch,
                base: session.landing_unit.base_ref.replace(/^origin\//, ""),
                body:
                  `Implements ${session.covered_work_item_ids.join(", ")} through Landing Unit ` +
                  `\`${session.landing_unit_id}\`. Human review and merge are required.`,
                draft: false,
              },
            },
          );
        }
        const projectedPullRequest = pullRequestProjection(pullRequest);
        if (
          projectedPullRequest.state !== "open" ||
          projectedPullRequest.head_commit !== source.head ||
          projectedPullRequest.base_ref !== session.landing_unit.base_ref.replace(/^origin\//, "") ||
          projectedPullRequest.author !== contract.identity.provider_principal
        ) {
          fail(
            "agent_source_pull_request_binding_mismatch",
            "Pull request does not match the admitted Agent source identity and exact head.",
          );
        }
        const reviewerRequested = (pullRequest.requested_reviewers ?? []).some(
          (reviewer) => reviewer?.login === contract.identity.human_reviewer_id,
        );
        if (!reviewerRequested) {
          await providerRequest(
            fetchImpl,
            credential,
            `/repos/${repository.full_name}/pulls/${projectedPullRequest.number}/requested_reviewers`,
            { method: "POST", body: { reviewers: [contract.identity.human_reviewer_id] } },
          );
        }
        const body = {
          ...safeIdentityProjection(contract, session, credential),
          action: "publish-exact-source",
          outcome: "published-for-human-review",
          pushed_head: source.head,
          pull_request: projectedPullRequest,
          recorded_at: clock().toISOString(),
          secret_values_embedded: false,
        };
        return { ...body, receipt_digest: canonicalDigest(body), state: "published" };
      },
    );
  }

  function assertHumanMergeAuthority({ repoRoot }) {
    if (!enabled) return;
    const login = command(
      execFileSyncImpl,
      "gh",
      ["api", "user", "--jq", ".login"],
      { cwd: repoRoot },
    );
    if (login !== contract.identity.human_reviewer_id) {
      fail(
        "agent_source_human_merge_authority_mismatch",
        "Source merge requires the admitted human reviewer identity.",
        { observed_login: login || null },
      );
    }
  }

  return { assertHumanMergeAuthority, inspect, prepare, publish };
}
