import { createHash } from "node:crypto";
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

import { canonicalDigest } from "./canonical-json.js";
import {
  DELIVERY_ART_EVIDENCE_PROFILE_PATH,
  deliveryArtEvidenceAcquisitionRequest,
  deliveryArtOwnerEvidenceCommandText,
} from "./review-evidence-acquisition.js";

function commandResult(execFileSyncImpl, command, args, options = {}) {
  try {
    return {
      exitCode: 0,
      stderr: "",
      stdout: String(execFileSyncImpl(command, args, {
        cwd: options.cwd,
        encoding: "utf8",
        env: options.env,
        maxBuffer: options.maxBuffer,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeout,
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
  return body?.status ?? null;
}

export function createDeliveryArtLifecycleCliAdapters({
  brokerRequest,
  clock,
  evidenceProfilePath,
  execFileSyncImpl = execFileSync,
  providerId,
} = {}) {
  if (typeof brokerRequest !== "function") {
    throw new Error("brokerRequest is required");
  }

  const fileAdapter = createDeliveryArtLifecycleFileAdapter();

  const sourceAdapter = createDeliveryArtLifecycleSourceAdapter({
    clock,
    evidenceProfilePath,
    execFileSyncImpl,
    providerId,
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
          path: `/v1/delivery-work-items/${workItemId}/status`,
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
  clock = () => new Date(),
  evidenceProfilePath = null,
  execFileSyncImpl = execFileSync,
  providerId = "local-engineering-source-executor",
} = {}) {
  async function inspect(landingUnit) {
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
  }

  return {
    inspect,
    async acquireEvidence({ conformance_cases: conformanceCases, landing_unit: landingUnit, source }) {
      const before = await inspect(landingUnit);
      if (
        before.state !== "pushed" ||
        before.head_commit !== source.head_commit ||
        before.base_commit !== source.base_commit
      ) {
        throw Object.assign(
          new Error("Owner evidence acquisition requires the exact clean pushed source revision."),
          { code: "delivery_art_owner_evidence_source_stale" },
        );
      }
      const profileText = evidenceProfilePath === null
        ? optionalOutput(
            execFileSyncImpl,
            "git",
            [
              "show",
              `${source.base_commit}:${DELIVERY_ART_EVIDENCE_PROFILE_PATH}`,
            ],
            landingUnit.repo_root,
          )
        : existsSync(path.resolve(evidenceProfilePath))
          ? { exitCode: 0, stdout: readFileSync(path.resolve(evidenceProfilePath), "utf8") }
          : { exitCode: 1, stdout: "" };
      if (profileText.exitCode !== 0) {
        throw Object.assign(
          new Error("The owner repository base has no admitted evidence profile."),
          { code: "delivery_art_evidence_profile_missing" },
        );
      }
      let profile;
      try {
        profile = JSON.parse(profileText.stdout);
      } catch {
        throw Object.assign(
          new Error("The owner evidence profile is not valid JSON."),
          { code: "delivery_art_evidence_profile_invalid" },
        );
      }
      const request = deliveryArtEvidenceAcquisitionRequest({
        conformanceCases,
        ownerRepo: landingUnit.owner_repo,
        profile,
        source,
      });
      const startedAt = clock().toISOString();
      const results = [];
      for (const command of request.commands) {
        const outcome = commandResult(
          execFileSyncImpl,
          command.executable,
          command.args,
          {
            allowFailure: true,
            cwd: landingUnit.repo_root,
            env: { ...process.env, CI: "true", NO_COLOR: "1" },
            maxBuffer: 4 * 1024 * 1024,
            timeout: command.timeout_seconds * 1000,
          },
        );
        const outputDigest = `sha256:${createHash("sha256")
          .update(outcome.stdout)
          .update("\0")
          .update(outcome.stderr)
          .digest("hex")}`;
        const result = {
          command: deliveryArtOwnerEvidenceCommandText(command),
          command_id: command.id,
          conformance_case_ids: [...command.conformance_case_ids],
          fidelity: command.fidelity,
          kind: command.kind,
          name: command.name,
          output_digest: outputDigest,
          result: outcome.exitCode === 0 ? "pass" : "fail",
          result_digest: null,
        };
        const {
          output_digest: _outputDigest,
          result_digest: _resultDigest,
          ...resultInput
        } = result;
        result.result_digest = canonicalDigest({
          ...resultInput,
          owner_repo: request.owner_repo,
          source_revision: request.source_revision,
        });
        results.push(result);
        if (outcome.exitCode !== 0) break;
      }
      const after = await inspect(landingUnit);
      if (
        after.state !== "pushed" ||
        after.head_commit !== before.head_commit ||
        after.base_commit !== before.base_commit
      ) {
        throw Object.assign(
          new Error("Owner evidence execution changed or invalidated the admitted source revision."),
          { code: "delivery_art_owner_evidence_source_mutated" },
        );
      }
      const receipt = {
        schema_version: 1,
        artifact_type: "delivery_art_owner_evidence_receipt",
        acquisition_id: request.acquisition_id,
        owner_repo: request.owner_repo,
        profile_digest: request.profile_digest,
        profile_id: request.profile_id,
        profile_path: request.profile_path,
        profile_revision: request.profile_revision,
        provider: {
          id: providerId,
          kind: "oos-source-executor",
        },
        source_revision: request.source_revision,
        started_at: startedAt,
        completed_at: clock().toISOString(),
        results,
        evidence_digest: canonicalDigest({
          acquisition_id: request.acquisition_id,
          owner_repo: request.owner_repo,
          profile_digest: request.profile_digest,
          profile_id: request.profile_id,
          profile_revision: request.profile_revision,
          provider_id: providerId,
          results: results.map(({ output_digest: _outputDigest, ...entry }) => entry),
          source_revision: request.source_revision,
        }),
        receipt_digest: null,
      };
      const { receipt_digest: _receiptDigest, ...receiptInput } = receipt;
      receipt.receipt_digest = canonicalDigest(receiptInput);
      return receipt;
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
