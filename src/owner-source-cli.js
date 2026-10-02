import { execFileSync } from "node:child_process";
import path from "node:path";

import { createConfiguredAgentSourceIdentityAdapter } from "./delivery-art/work-session-cli-adapters.js";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export const OWNER_SOURCE_USAGE = `usage:
  npm run source -- maintenance status --repo-root <path> --landing-unit-id <id> --base-commit <sha> --tracking-ref <ref>
  npm run source -- maintenance prepare --repo-root <path> --landing-unit-id <id> --base-commit <sha> --tracking-ref <ref>
  npm run source -- maintenance publish --repo-root <path> --landing-unit-id <id> --base-commit <sha> --tracking-ref <ref>
`;

function git(execFileSyncImpl, repoRoot, args) {
  return String(execFileSyncImpl("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }) ?? "").trim();
}

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? null : argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function ownerRepositoryFromOrigin(remoteUrl) {
  const remote = String(remoteUrl ?? "").trim();
  let owner;
  let repository;
  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(remote);
  if (scpMatch) {
    [, owner, repository] = scpMatch;
  } else {
    let parsed;
    try {
      parsed = new URL(remote);
    } catch {
      throw new Error("origin must be an exact GitHub repository URL");
    }
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parsed.hostname !== "github.com" || parts.length !== 2) {
      throw new Error("origin must be an exact GitHub repository URL");
    }
    [owner, repository] = parts;
  }
  repository = repository.replace(/\.git$/, "");
  if (owner !== "mfshaf7" || !repository) {
    throw new Error("origin must identify an admitted mfshaf7 GitHub repository");
  }
  return repository;
}

export function buildOwnerSourceSession({
  argv,
  execFileSyncImpl = execFileSync,
}) {
  if (argv[0] !== "maintenance" || !["status", "prepare", "publish"].includes(argv[1])) {
    throw new Error(OWNER_SOURCE_USAGE.trim());
  }
  const repoRoot = path.resolve(option(argv, "--repo-root"));
  const topLevel = path.resolve(git(execFileSyncImpl, repoRoot, ["rev-parse", "--show-toplevel"]));
  if (topLevel !== repoRoot) {
    throw new Error("--repo-root must be the exact owner repository root");
  }
  const branch = git(execFileSyncImpl, repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const ownerRepo = ownerRepositoryFromOrigin(
    git(execFileSyncImpl, repoRoot, ["remote", "get-url", "origin"]),
  );
  const baseCommit = option(argv, "--base-commit");
  if (!COMMIT_PATTERN.test(baseCommit)) {
    throw new Error("--base-commit must be an exact 40-character commit");
  }
  const trackingRef = option(argv, "--tracking-ref");
  return {
    action: argv[1],
    repoRoot,
    session: {
      landing_unit_id: option(argv, "--landing-unit-id"),
      owner_repo: ownerRepo,
      covered_work_item_ids: [trackingRef],
      landing_unit: {
        base_commit: baseCommit,
        base_ref: "origin/main",
        branch,
      },
    },
  };
}

function assertReady(preflight) {
  if (preflight?.identity?.state !== "ready" || preflight?.provider?.state !== "ready") {
    const error = new Error("Agent Gary source preflight is not ready");
    error.code = preflight?.identity?.reason_code ?? "agent_source_preflight_blocked";
    throw error;
  }
}

export async function runOwnerSourceCommand({
  argv,
  agentSourceIdentity = null,
  env = process.env,
  execFileSyncImpl = execFileSync,
  stdout = process.stdout,
} = {}) {
  const input = buildOwnerSourceSession({ argv, execFileSyncImpl });
  const adapter = agentSourceIdentity ?? createConfiguredAgentSourceIdentityAdapter({
    env: { ...env, OOS_AGENT_SOURCE_IDENTITY_ENABLED: "true" },
  });
  const preflight = await adapter.preflight({ session: input.session });
  if (input.action === "status") {
    stdout.write(`${JSON.stringify({ action: "status", ...preflight }, null, 2)}\n`);
    return preflight?.identity?.state === "ready" && preflight?.provider?.state === "ready" ? 0 : 1;
  }
  assertReady(preflight);
  const result = input.action === "prepare"
    ? await adapter.prepare({ repoRoot: input.repoRoot, session: input.session })
    : await adapter.publish({ repoRoot: input.repoRoot, session: input.session });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}
