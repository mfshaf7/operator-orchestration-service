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
  DeliveryArtEvidenceAcquisitionError,
  deliveryArtEvidenceAcquisitionRequest,
  deliveryArtOwnerEvidenceCommandText,
  selectTrustedDeliveryArtEvidenceProfile,
  validateDeliveryArtEvidenceProfileCoverage,
} from "./review-evidence-acquisition.js";

function commandResult(execFileSyncImpl, command, args, options = {}) {
  try {
    return {
      exitCode: 0,
      stderr: "",
      stdout: String(execFileSyncImpl(command, args, {
        cwd: options.cwd,
        detached: options.detached === true,
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

const OWNER_EVIDENCE_BASE_ENVIRONMENT = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TZ",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
]);

function ownerEvidenceEnvironment(kind) {
  const environment = kind === "runtime_and_live"
    ? { ...process.env }
    : Object.fromEntries(
        OWNER_EVIDENCE_BASE_ENVIRONMENT
          .filter((name) => process.env[name] !== undefined)
          .map((name) => [name, process.env[name]]),
      );
  Object.assign(environment, { CI: "true", NO_COLOR: "1" });
  for (const name of [
    "OOS_DELIVERY_ART_EVIDENCE_ACQUISITION_ID",
    "OOS_DELIVERY_ART_EVIDENCE_COMMAND_ID",
    "OOS_DELIVERY_ART_EVIDENCE_EXECUTION",
    "OOS_DELIVERY_ART_EVIDENCE_MODE",
    "OOS_DELIVERY_ART_MUTATION_ENABLED",
  ]) {
    delete environment[name];
  }
  return environment;
}

function evidenceResult(request, input, output = "") {
  const result = {
    ...input,
    output_digest: `sha256:${createHash("sha256").update(output).digest("hex")}`,
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
  return result;
}

function evidenceReceipt({ clock, providerId, request, results, startedAt }) {
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
      results: results.map(({ output_digest: _OutputDigest, ...entry }) => entry),
      source_revision: request.source_revision,
    }),
    receipt_digest: null,
  };
  const { receipt_digest: _ReceiptDigest, ...receiptInput } = receipt;
  receipt.receipt_digest = canonicalDigest(receiptInput);
  return receipt;
}

function profileFailureRequest({
  conformanceCases,
  error,
  ownerRepo,
  profile,
  profileRevision,
  profileText,
  source,
}) {
  const profileDigest = `sha256:${createHash("sha256")
    .update(profileText)
    .digest("hex")}`;
  const groups = new Map();
  for (const conformanceCase of conformanceCases ?? []) {
    const fidelity = conformanceCase.fidelity ?? "filesystem";
    const current = groups.get(fidelity) ?? [];
    current.push(conformanceCase);
    groups.set(fidelity, current);
  }
  if (groups.size === 0) groups.set("filesystem", []);
  const failure = JSON.stringify({
    code: error.code ?? "delivery_art_evidence_profile_invalid",
    details: error.details ?? null,
    message: error.message,
  });
  const request = {
    acquisition_id: `owner-evidence:${createHash("sha256")
      .update([
        ownerRepo,
        source.head_commit,
        profileDigest,
        "profile-validation-failed",
        ...(conformanceCases ?? []).map((entry) => entry.id).sort(),
      ].join("\0"))
      .digest("hex")}`,
    owner_repo: ownerRepo,
    profile_digest: profileDigest,
    profile_id:
      typeof profile?.profile_id === "string" && profile.profile_id
        ? profile.profile_id
        : "invalid-owner-evidence-profile",
    profile_path: DELIVERY_ART_EVIDENCE_PROFILE_PATH,
    profile_revision: profileRevision,
    source_revision: source.head_commit,
  };
  return {
    request,
    results: [...groups.entries()].map(([fidelity, cases]) =>
      evidenceResult(request, {
        command:
          `internal validate ${DELIVERY_ART_EVIDENCE_PROFILE_PATH} --result ${error.code ?? "delivery_art_evidence_profile_invalid"}`,
        command_id: `evidence-profile-contract-validation-${fidelity}`,
        conformance_case_ids: cases.map((entry) => entry.id).sort(),
        fidelity,
        kind: cases.some((entry) => entry.target_readiness === "operating-ready")
          ? "runtime_and_live"
          : "validations",
        name: "Owner evidence profile contract validation",
        result: "fail",
      }, failure),
    ),
  };
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
      ["rev-parse", "--verify", `refs/remotes/origin/${landingUnit.branch}`],
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
    async acquireEvidence({
      conformance_cases: conformanceCases,
      landing_unit: landingUnit,
      profile_revision: requestedProfileRevision = null,
      required_evidence_kinds: requiredEvidenceKinds,
      source,
    }) {
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
      const profileRevision = requestedProfileRevision ?? source.base_commit;
      if (![source.base_commit, source.head_commit].includes(profileRevision)) {
        throw Object.assign(
          new Error("The owner evidence profile revision must be the exact base or accepted source revision."),
          { code: "delivery_art_evidence_profile_revision_invalid" },
        );
      }
      const startedAt = clock().toISOString();
      let profileText = evidenceProfilePath === null
        ? optionalOutput(
            execFileSyncImpl,
            "git",
            [
              "show",
              `${profileRevision}:${DELIVERY_ART_EVIDENCE_PROFILE_PATH}`,
            ],
            landingUnit.repo_root,
          )
        : existsSync(path.resolve(evidenceProfilePath))
          ? { exitCode: 0, stdout: readFileSync(path.resolve(evidenceProfilePath), "utf8") }
          : { exitCode: 1, stdout: "" };
      let profile = null;
      let profileFailure = null;
      let selectedProfileRevision = profileRevision;
      let trustedProfileRevisions = [];
      let failureProfileRevision = profileRevision;
      let failureProfileText = profileText.stdout;
      if (
        evidenceProfilePath === null &&
        profileRevision === source.base_commit
      ) {
        const history = optionalOutput(
          execFileSyncImpl,
          "git",
          [
            "log",
            "--format=%H",
            "--max-count=50",
            source.base_commit,
            "--",
            DELIVERY_ART_EVIDENCE_PROFILE_PATH,
          ],
          landingUnit.repo_root,
        );
        const revisions = [
          source.base_commit,
          ...(history.exitCode === 0
            ? history.stdout.trim().split("\n").filter(Boolean)
            : []),
        ];
        try {
          const selection = selectTrustedDeliveryArtEvidenceProfile({
            conformanceCases,
            ownerRepo: landingUnit.owner_repo,
            readProfileText(revision) {
              const result = optionalOutput(
                execFileSyncImpl,
                "git",
                ["show", `${revision}:${DELIVERY_ART_EVIDENCE_PROFILE_PATH}`],
                landingUnit.repo_root,
              );
              return result.exitCode === 0 ? result.stdout : null;
            },
            requiredEvidenceKinds,
            revisions,
          });
          profile = selection.profile;
          profileText = { exitCode: 0, stdout: selection.profile_text };
          selectedProfileRevision = selection.profile_revision;
          trustedProfileRevisions = selection.used_reviewed_ancestor
            ? [selection.profile_revision]
            : [];
        } catch (error) {
          if (!(error instanceof DeliveryArtEvidenceAcquisitionError)) throw error;
          profileFailure = error;
        }
      } else if (profileText.exitCode !== 0) {
        profileFailure = new DeliveryArtEvidenceAcquisitionError(
          "delivery_art_evidence_profile_missing",
          "The owner repository has no admitted evidence profile at the selected revision.",
        );
      } else {
        try {
          profile = JSON.parse(profileText.stdout);
        } catch {
          profileFailure = new DeliveryArtEvidenceAcquisitionError(
            "delivery_art_evidence_profile_invalid",
            "The owner evidence profile is not valid JSON.",
          );
        }
      }
      let request = null;
      if (profileFailure === null) {
        try {
          request = deliveryArtEvidenceAcquisitionRequest({
            conformanceCases,
            ownerRepo: landingUnit.owner_repo,
            profile,
            profileRevision: selectedProfileRevision,
            requiredEvidenceKinds,
            source,
            trustedProfileRevisions,
          });
          if (
            evidenceProfilePath === null &&
            profileRevision === source.base_commit &&
            source.head_commit !== source.base_commit
          ) {
            profile = null;
            const candidateProfileText = optionalOutput(
              execFileSyncImpl,
              "git",
              [
                "show",
                `${source.head_commit}:${DELIVERY_ART_EVIDENCE_PROFILE_PATH}`,
              ],
              landingUnit.repo_root,
            );
            failureProfileRevision = source.head_commit;
            failureProfileText = candidateProfileText.stdout;
            if (candidateProfileText.exitCode !== 0) {
              throw new DeliveryArtEvidenceAcquisitionError(
                "delivery_art_evidence_profile_missing",
                "The candidate source removes its required owner evidence profile.",
              );
            }
            try {
              profile = JSON.parse(candidateProfileText.stdout);
            } catch {
              throw new DeliveryArtEvidenceAcquisitionError(
                "delivery_art_evidence_profile_invalid",
                "The candidate owner evidence profile is not valid JSON.",
              );
            }
            validateDeliveryArtEvidenceProfileCoverage({
              conformanceCases,
              ownerRepo: landingUnit.owner_repo,
              profile,
              requiredEvidenceKinds,
            });
          }
        } catch (error) {
          if (!(error instanceof DeliveryArtEvidenceAcquisitionError)) throw error;
          profileFailure = error;
        }
      }
      if (profileFailure !== null) {
        const failed = profileFailureRequest({
          conformanceCases,
          error: profileFailure,
          ownerRepo: landingUnit.owner_repo,
          profile,
          profileRevision: failureProfileRevision,
          profileText: failureProfileText,
          source,
        });
        const after = await inspect(landingUnit);
        if (
          after.state !== "pushed" ||
          after.head_commit !== before.head_commit ||
          after.base_commit !== before.base_commit
        ) {
          throw Object.assign(
            new Error("Owner evidence profile validation observed changing source."),
            { code: "delivery_art_owner_evidence_source_mutated" },
          );
        }
        return evidenceReceipt({
          clock,
          providerId,
          request: failed.request,
          results: failed.results,
          startedAt,
        });
      }
      const results = [];
      for (const command of request.commands) {
        const commandEnvironment = ownerEvidenceEnvironment(command.kind);
        if (command.kind === "runtime_and_live") {
          Object.assign(commandEnvironment, {
            OOS_DELIVERY_ART_EVIDENCE_ACQUISITION_ID: request.acquisition_id,
            OOS_DELIVERY_ART_EVIDENCE_COMMAND_ID: command.id,
            OOS_DELIVERY_ART_EVIDENCE_EXECUTION: "true",
            OOS_DELIVERY_ART_EVIDENCE_MODE: "verification-only",
            OOS_DELIVERY_ART_MUTATION_ENABLED: "false",
          });
        }
        const outcome = commandResult(
          execFileSyncImpl,
          command.executable,
          command.args,
          {
            allowFailure: true,
            cwd: landingUnit.repo_root,
            detached: command.kind === "runtime_and_live",
            env: commandEnvironment,
            maxBuffer: 4 * 1024 * 1024,
            timeout: command.timeout_seconds * 1000,
          },
        );
        const result = evidenceResult(request, {
          command: deliveryArtOwnerEvidenceCommandText(command),
          command_id: command.id,
          conformance_case_ids: [...command.conformance_case_ids],
          fidelity: command.fidelity,
          kind: command.kind,
          name: command.name,
          result: outcome.exitCode === 0 ? "pass" : "fail",
        }, `${outcome.stdout}\0${outcome.stderr}`);
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
      return evidenceReceipt({ clock, providerId, request, results, startedAt });
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
