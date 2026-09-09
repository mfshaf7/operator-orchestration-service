import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertPrototypeMaturityArtifact,
  bindPrototypeMaturity,
  prototypeMaturityDigest,
  prototypeMaturityError,
  prototypeMaturityManifest,
  prototypeMaturityReference,
} from "./contracts.js";

const execute = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const PROMOTION_DECISIONS = new Set(["promote-candidate", "approve-baseline"]);
const gitEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

export function createPrototypeMaturitySourceClient({
  authorityRoot,
  python = "python3",
  provider,
  clock = () => new Date(),
}) {
  const git = async (root, ...args) =>
    (
      await execute(
        "git",
        ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
        { env: gitEnv, maxBuffer: 16 * 1024 * 1024, timeout: 60000 },
      )
    ).stdout.trim();
  const branch = (record) =>
    `prototype-maturity/${record.binding_digest.slice(7)}`;

  async function sandbox(revision, branchName, operation, { reset = false } = {}) {
    if (!SHA.test(revision)) {
      throw prototypeMaturityError(
        "revision_invalid",
        "Prototype Maturity requires an exact Prototype Studio commit.",
      );
    }
    await git(
      authorityRoot,
      "merge-base",
      "--is-ancestor",
      prototypeMaturityManifest.source_authority.minimum_commit,
      revision,
    );
    await git(
      authorityRoot,
      "merge-base",
      "--is-ancestor",
      revision,
      "refs/remotes/origin/main",
    );
    const directory = await mkdtemp(path.join(tmpdir(), "oos-prototype-maturity-"));
    const source = path.join(directory, "source");
    try {
      await execute(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "clone",
          "--no-checkout",
          "--shared",
          "--template=",
          authorityRoot,
          source,
        ],
        { env: gitEnv, timeout: 60000 },
      );
      await git(source, "checkout", reset ? "-B" : "-b", branchName, revision);
      return await operation({ directory, source });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function writeArtifact(directory, name, value) {
    const destination = path.join(directory, `${name}.json`);
    await writeFile(destination, JSON.stringify(value), { mode: 0o600 });
    return destination;
  }

  async function runSource(source, args, maxBuffer = 1048576) {
    try {
      return await execute(
        python,
        [path.join(source, "scripts/prototype_maturity.py"), "--repo-root", source, ...args],
        {
          env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
          timeout: 120000,
          maxBuffer,
        },
      );
    } catch (error) {
      let detail = {};
      try {
        detail = JSON.parse(error.stdout);
      } catch {}
      throw prototypeMaturityError(
        detail.code ?? "source_command_failed",
        "Prototype Studio rejected the maturity source operation.",
        409,
      );
    }
  }

  async function state(prototypeId) {
    try {
      const revision = await provider.mainRevision();
      return await sandbox(revision, "prototype-maturity-state", async ({ source }) => {
        const result = await runSource(source, [
          "state",
          "--prototype-id",
          prototypeId,
        ], 262144);
        if (await git(source, "status", "--short")) {
          throw prototypeMaturityError(
            "source_change_invalid",
            "Prototype Maturity state inspection modified source.",
            503,
          );
        }
        return { ...JSON.parse(result.stdout), authority_revision: revision };
      });
    } catch (error) {
      if (
        typeof error?.code === "string" &&
        error.code.startsWith("prototype_maturity_")
      ) {
        throw error;
      }
      throw prototypeMaturityError(
        "authority_unavailable",
        "Current Prototype Studio maturity state is unavailable.",
        503,
      );
    }
  }

  async function readback(record, revision) {
    return sandbox(
      revision,
      "main",
      async ({ directory, source }) => {
        const decisionPath = await writeArtifact(
          directory,
          "decision",
          record.decision,
        );
        const output = path.join(directory, "readback.json");
        await runSource(source, [
          "readback",
          "--decision",
          decisionPath,
          "--output",
          output,
        ]);
        if (await git(source, "status", "--short")) {
          throw prototypeMaturityError(
            "readback_changed_source",
            "Prototype Maturity readback modified source.",
            503,
          );
        }
        return assertPrototypeMaturityArtifact(
          JSON.parse(await readFile(output, "utf8")),
        );
      },
      { reset: true },
    );
  }

  async function prepare(record, assertHeld) {
    const revision = record.evaluation.authority_revision;
    if ((await provider.mainRevision()) !== revision) {
      throw prototypeMaturityError(
        "authority_stale",
        "Prototype Studio changed; submit a fresh maturity request.",
      );
    }
    assertHeld();
    return sandbox(revision, branch(record), async ({ directory, source }) => {
      const values = {
        request: record.evaluation.request,
        packet: record.evaluation.packet,
        readiness: record.readiness.readiness,
        decision: record.decision,
      };
      const paths = {};
      for (const [name, value] of Object.entries(values)) {
        paths[name] = await writeArtifact(directory, name, value);
      }
      const output = path.join(directory, "source-result.json");
      const args = ["apply"];
      for (const name of Object.keys(values)) args.push(`--${name}`, paths[name]);
      args.push("--output", output);
      await runSource(source, args);
      const sourceResult = assertPrototypeMaturityArtifact(
        JSON.parse(await readFile(output, "utf8")),
      );
      const promotion = PROMOTION_DECISIONS.has(record.decision.decision);
      if (!promotion) {
        if (
          sourceResult.outcome !== "unchanged" ||
          sourceResult.changed_paths.length ||
          (await git(source, "status", "--short"))
        ) {
          throw prototypeMaturityError(
            "non_promotion_mutation",
            "A non-promotion maturity decision attempted to change source.",
          );
        }
        return {
          branch: branch(record),
          base_commit: revision,
          files: [],
          file_count: 0,
          changed_paths: [],
          content_digest: prototypeMaturityDigest([]),
          source_result: sourceResult,
          readback: await readback(record, revision),
        };
      }

      await git(source, "add", "--all");
      const changed = (await git(
        source,
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=AM",
      ))
        .split("\n")
        .filter(Boolean);
      const statuses = (await git(source, "diff", "--cached", "--name-status"))
        .split("\n")
        .filter(Boolean);
      if (
        !changed.length ||
        statuses.some((line) => !/^[AM]\t/.test(line)) ||
        JSON.stringify(changed) !== JSON.stringify(sourceResult.changed_paths)
      ) {
        throw prototypeMaturityError(
          "source_change_invalid",
          "Prototype Maturity produced an invalid source change.",
        );
      }
      const files = [];
      let total = 0;
      for (const relative of changed) {
        const full = path.join(source, relative);
        const info = await lstat(full);
        if (!info.isFile() || info.size > 1024 * 1024) {
          throw prototypeMaturityError(
            "source_change_large",
            `Prototype Maturity output is invalid for ${relative}.`,
          );
        }
        const bytes = await readFile(full);
        total += bytes.length;
        if (total > 4 * 1024 * 1024) {
          throw prototypeMaturityError(
            "source_change_large",
            "Prototype Maturity output exceeds its bounded source limit.",
          );
        }
        files.push({
          path: relative,
          mode: "100644",
          content_base64: bytes.toString("base64"),
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      return {
        branch: branch(record),
        base_commit: revision,
        files,
        file_count: files.length,
        changed_paths: files.map((file) => file.path),
        content_digest: prototypeMaturityDigest(
          files.map(({ path: filePath, mode, sha256 }) => ({
            path: filePath,
            mode,
            sha256,
          })),
        ),
        source_result: sourceResult,
        readback: null,
      };
    });
  }

  async function verifyReview(record, review) {
    if (
      review.repository !== "workspace-prototype-studio" ||
      review.base_branch !== "main" ||
      review.branch !== branch(record) ||
      review.base_commit !== record.evaluation.authority_revision ||
      review.head_commit !== record.review?.head_commit
    ) {
      throw prototypeMaturityError(
        "review_changed",
        "Prototype Maturity review no longer matches the prepared source change.",
      );
    }
  }

  async function merged(record, review) {
    if (!review.merged || !review.human_reviewed || !SHA.test(review.merge_commit)) {
      throw prototypeMaturityError(
        "review_unproven",
        "Prototype Maturity requires exact-head human review evidence.",
      );
    }
    await provider.verifyMergedFiles(review, record.preparation);
    const readback = assertPrototypeMaturityArtifact(
      bindPrototypeMaturity(
        {
          schema_version: 1,
          artifact_type: "prototype-maturity-readback",
          readback_id: record.decision.decision_id.replace(
            /^prototype-maturity-decision:/,
            "prototype-maturity-readback:",
          ),
          observed_at: clock().toISOString(),
          decision_ref: prototypeMaturityReference(record.decision),
          prototype_id: record.decision.prototype_id,
          transition: record.decision.transition,
          decision: record.decision.decision,
          authority_state: "merged-authority",
          source_revision: review.merge_commit,
          record_digest: record.preparation.source_result.record_digest,
          observed_lifecycle:
            record.decision.transition === "candidate-promotion"
              ? "candidate"
              : "baseline-approved",
          record_ref: `record://prototype-registry/${record.decision.prototype_id.replace(/^prototype:/, "")}`,
        },
        "readback_digest",
      ),
    );
    return { review, readback };
  }

  return {
    branch,
    state,
    prepare,
    async openReview(record, assertHeld) {
      assertHeld();
      return provider.prepareReview(record.preparation, {
        requestId: record.evaluation.request.request_id,
        binding: record.binding_digest,
      });
    },
    async observe(record, assertHeld) {
      assertHeld();
      const review = await provider.review(record.review.number);
      await verifyReview(record, review);
      return review.merged ? merged(record, review) : { review };
    },
    async cancel(record, assertHeld) {
      assertHeld();
      const review = record.review
        ? await provider.review(record.review.number)
        : await provider.findReview(branch(record));
      if (!review) {
        if (!record.preparation) return null;
        return (await provider.verifyPreparedBranch(record.preparation))
          ? { retained_branch: record.preparation.branch }
          : null;
      }
      if (!record.preparation) {
        throw prototypeMaturityError(
          "cancel_source_unproven",
          "An unexpected review cannot be cancelled without source preparation.",
        );
      }
      await provider.verifyPreparedReview(record.preparation, review);
      const bound = { ...record, review: record.review ?? review };
      await verifyReview(bound, review);
      if (review.merged) return merged(bound, review);
      await provider.closeReview(review);
      const observed = await provider.review(review.number);
      await verifyReview(bound, observed);
      if (observed.merged) return merged(bound, observed);
      if (observed.state !== "closed") {
        throw prototypeMaturityError(
          "cancel_unconfirmed",
          "Prototype Maturity review cancellation was not confirmed.",
          503,
        );
      }
      return null;
    },
  };
}
