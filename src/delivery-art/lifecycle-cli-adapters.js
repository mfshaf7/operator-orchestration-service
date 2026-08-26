import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function commandResult(execFileSyncImpl, command, args, options = {}) {
  try {
    return {
      exitCode: 0,
      stderr: "",
      stdout: String(execFileSyncImpl(command, args, {
        cwd: options.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }) ?? ""),
    };
  } catch (error) {
    const result = {
      exitCode: Number.isInteger(error?.status) ? error.status : 1,
      stderr: String(error?.stderr ?? ""),
      stdout: String(error?.stdout ?? ""),
    };
    if (options.allowFailure) {
      return result;
    }
    const detail = result.stderr.trim() || result.stdout.trim() || error?.message;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function requiredOutput(execFileSyncImpl, command, args, cwd) {
  return commandResult(execFileSyncImpl, command, args, { cwd }).stdout.trim();
}

function optionalOutput(execFileSyncImpl, command, args, cwd) {
  return commandResult(execFileSyncImpl, command, args, {
    allowFailure: true,
    cwd,
  });
}

function pullRequestBaseName(baseRef) {
  if (baseRef.startsWith("refs/remotes/")) {
    return baseRef.split("/").slice(3).join("/");
  }
  if (baseRef.startsWith("refs/heads/")) {
    return baseRef.slice("refs/heads/".length);
  }
  return baseRef.startsWith("origin/")
    ? baseRef.slice("origin/".length)
    : baseRef;
}

function parsePullRequest(value, expectedBaseRef) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
  if (entries.length === 0) {
    return { state: "missing" };
  }
  const pullRequest = entries[0];
  const state = String(pullRequest.state ?? "").toUpperCase();
  const baseRef = pullRequest.baseRefName ?? null;
  return {
    base_ref: baseRef,
    head_commit: pullRequest.headRefOid ?? null,
    merge_commit: pullRequest.mergeCommit?.oid ?? null,
    state: baseRef !== pullRequestBaseName(expectedBaseRef)
      ? "wrong-base"
      : state === "MERGED"
        ? "merged"
        : state === "CLOSED"
          ? "closed"
          : pullRequest.isDraft
            ? "draft"
            : "open",
    url: pullRequest.url ?? null,
  };
}

function targetStatus(body) {
  return body?.evidence_packet?.target_item?.status ??
    body?.continuation_context?.target_item?.status ??
    body?.target_item?.status ??
    null;
}

export function createDeliveryArtLifecycleCliAdapters({
  brokerRequest,
  execFileSyncImpl = execFileSync,
} = {}) {
  if (typeof brokerRequest !== "function") {
    throw new Error("brokerRequest is required");
  }

  const fileAdapter = createDeliveryArtLifecycleFileAdapter();

  const sourceAdapter = createDeliveryArtLifecycleSourceAdapter({
    execFileSyncImpl,
  });

  const brokerAdapter = {
    async request({ body, callerId, path: requestPath }) {
      return brokerRequest({
        body,
        callerId,
        method: "POST",
        path: requestPath,
      });
    },
  };

  const artAdapter = {
    async statuses(workItemIds) {
      const statuses = [];
      for (const workItemId of workItemIds) {
        const response = await brokerRequest({
          body: null,
          callerId: null,
          method: "GET",
          path: `/v1/delivery-work-items/${workItemId}/evidence-packet`,
        });
        if (!response?.ok) {
          throw new Error(`Unable to inspect ART status for ${workItemId}.`);
        }
        const status = targetStatus(response.body);
        if (!status) {
          throw new Error(`ART status response for ${workItemId} has no target status.`);
        }
        statuses.push(status);
      }
      return statuses;
    },
  };

  return { artAdapter, brokerAdapter, fileAdapter, sourceAdapter };
}

export function createDeliveryArtLifecycleFileAdapter() {
  return {
    async read(filePath) {
      if (!filePath || !existsSync(filePath)) {
        return null;
      }
      return JSON.parse(readFileSync(filePath, "utf8"));
    },
    async write(filePath, value) {
      if (!filePath) {
        throw new Error("artifact output path is required");
      }
      const resolvedPath = path.resolve(filePath);
      const temporaryPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
      mkdirSync(path.dirname(resolvedPath), { recursive: true });
      try {
        writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        renameSync(temporaryPath, resolvedPath);
      } finally {
        if (existsSync(temporaryPath)) {
          unlinkSync(temporaryPath);
        }
      }
    },
  };
}

export function createDeliveryArtLifecycleSourceAdapter({
  execFileSyncImpl = execFileSync,
} = {}) {
  return {
    async inspect(landingUnit) {
      const cwd = landingUnit.repo_root;
      const branch = requiredOutput(
        execFileSyncImpl,
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        cwd,
      );
      const baseCommit = requiredOutput(
        execFileSyncImpl,
        "git",
        ["rev-parse", landingUnit.base_commit ?? landingUnit.base_ref],
        cwd,
      );
      const headCommit = requiredOutput(
        execFileSyncImpl,
        "git",
        ["rev-parse", "HEAD"],
        cwd,
      );
      const dirty = requiredOutput(
        execFileSyncImpl,
        "git",
        ["status", "--porcelain"],
        cwd,
      );
      const ancestry = optionalOutput(
        execFileSyncImpl,
        "git",
        ["merge-base", "--is-ancestor", baseCommit, headCommit],
        cwd,
      );
      if (ancestry.exitCode > 1) {
        const detail = ancestry.stderr.trim() || ancestry.stdout.trim();
        throw new Error(`Git base ancestry inspection failed: ${detail}`);
      }
      const changedFiles = ancestry.exitCode === 0
        ? requiredOutput(
            execFileSyncImpl,
            "git",
            ["diff", "--name-only", `${baseCommit}...${headCommit}`],
            cwd,
          ).split("\n").map((entry) => entry.trim()).filter(Boolean)
        : [];
      const upstream = optionalOutput(
        execFileSyncImpl,
        "git",
        ["rev-parse", "--verify", "@{u}"],
        cwd,
      );
      const state = branch !== landingUnit.branch
        ? "wrong-branch"
        : dirty
          ? "dirty"
          : ancestry.exitCode !== 0
            ? "base-diverged"
            : upstream.exitCode !== 0 || upstream.stdout.trim() !== headCommit
              ? "unpushed"
              : "pushed";
      return {
        base_commit: baseCommit,
        branch,
        changed_files: changedFiles,
        head_commit: headCommit,
        state,
        upstream_commit: upstream.exitCode === 0 ? upstream.stdout.trim() : null,
      };
    },
    async pullRequest(landingUnit, binding = null) {
      const fields = "state,isDraft,url,headRefOid,baseRefName,mergeCommit";
      const args = binding?.url
        ? ["pr", "view", binding.url, "--json", fields]
        : [
            "pr",
            "list",
            "--head",
            landingUnit.branch,
            "--state",
            "all",
            "--limit",
            "1",
            "--json",
            fields,
          ];
      const result = optionalOutput(
        execFileSyncImpl,
        "gh",
        args,
        landingUnit.repo_root,
      );
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new Error(`GitHub pull-request inspection failed: ${detail}`);
      }
      return parsePullRequest(
        JSON.parse(result.stdout || "[]"),
        landingUnit.base_ref,
      );
    },
  };
}

export function compactDeliveryArtLifecycleResult(result) {
  return {
    executed_actions: result.executed_actions ?? [],
    facts: result.facts,
    lifecycle_id: result.plan.lifecycle_id,
    projection: result.projection,
    pull_request: result.pull_request,
    source: result.source,
    workflow_id: "delivery-art-lifecycle",
  };
}
