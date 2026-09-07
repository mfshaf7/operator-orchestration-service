import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertPrototypeLandingArtifact,
  bindPrototypeLanding,
  prototypeLandingDigest,
  prototypeLandingError,
  prototypeLandingManifest,
  prototypeLandingReference,
} from "./contracts.js";

const execute = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

export function createPrototypeLandingSourceClient({ authorityRoot, python = "python3", provider, resolveImportRoot = async () => null, clock = () => new Date() }) {
  const git = async (root, ...args) => (await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], { env: gitEnv, maxBuffer: 16 * 1024 * 1024, timeout: 60000 })).stdout.trim();
  const branch = (record) => `prototype-landing/${record.binding_digest.slice(7)}`;

  async function sandbox(revision, branchName, operation) {
    if (!SHA.test(revision)) throw prototypeLandingError("revision_invalid", "Prototype Landing requires an exact Prototype Studio commit.");
    await git(authorityRoot, "merge-base", "--is-ancestor", prototypeLandingManifest.source_authority.minimum_commit, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const directory = await mkdtemp(path.join(tmpdir(), "oos-prototype-landing-"));
    const source = path.join(directory, "source");
    try {
      await execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", authorityRoot, source], { env: gitEnv, timeout: 60000 });
      await git(source, "checkout", "-b", branchName, revision);
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

  async function state(prototypeId) {
    try {
      const revision = await provider.mainRevision();
      return await sandbox(revision, "prototype-landing-state", async ({ source }) => {
        const result = await execute(python, [path.join(source, "scripts/prototype_landing.py"), "--repo-root", source, "state", "--prototype-id", prototypeId], {
          env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 60000, maxBuffer: 262144,
        });
        if (await git(source, "status", "--short")) throw prototypeLandingError("source_change_invalid", "Prototype Landing state inspection modified source.", 503);
        return { ...JSON.parse(result.stdout), authority_revision: revision };
      });
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("prototype_landing_")) throw error;
      throw prototypeLandingError("authority_unavailable", "Current Prototype Studio Landing state is unavailable.", 503);
    }
  }

  async function prepare(record, assertHeld) {
    const revision = record.evaluation.authority_revision;
    if ((await provider.mainRevision()) !== revision) throw prototypeLandingError("authority_stale", "Prototype Studio changed; submit a fresh Landing request.");
    assertHeld();
    return sandbox(revision, branch(record), async ({ directory, source }) => {
      const values = {
        entry: record.evaluation.entry_packet,
        request: record.evaluation.request,
        plan: record.evaluation.plan,
        readiness: record.readiness.readiness,
        apply: record.apply,
      };
      const paths = {};
      for (const [name, value] of Object.entries(values)) paths[name] = await writeArtifact(directory, name, value);
      const evidence = path.join(directory, "evidence");
      const args = [path.join(source, "scripts/prototype_landing.py"), "--repo-root", source, "apply"];
      for (const name of Object.keys(values)) args.push(`--${name}`, paths[name]);
      args.push("--output-dir", evidence);
      if (record.evaluation.request.source_plan.posture === "import-to-studio") {
        const importRoot = await resolveImportRoot(record.evaluation.request.source_plan);
        if (!importRoot) throw prototypeLandingError("import_source_unavailable", "The admitted imported source is unavailable.", 409);
        args.push("--import-root", importRoot);
      }
      try {
        await execute(python, args, { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 120000, maxBuffer: 1048576 });
      } catch (error) {
        let detail = {};
        try { detail = JSON.parse(error.stdout); } catch {}
        throw prototypeLandingError(detail.code ?? "source_prepare_failed", "Prototype Studio rejected the Landing source preparation.", 409);
      }
      const readback = assertPrototypeLandingArtifact(JSON.parse(await readFile(path.join(evidence, "readback.json"), "utf8")));
      const receipt = assertPrototypeLandingArtifact(JSON.parse(await readFile(path.join(evidence, "receipt.json"), "utf8")));
      await git(source, "add", "--all");
      const changed = (await git(source, "diff", "--cached", "--name-only", "--diff-filter=AM")).split("\n").filter(Boolean);
      const statuses = (await git(source, "diff", "--cached", "--name-status")).split("\n").filter(Boolean);
      if (!changed.length || statuses.some((line) => !/^[AM]\t/.test(line)) || changed.length > 520) {
        throw prototypeLandingError("source_change_invalid", "Prototype Landing produced an invalid or unbounded source change.");
      }
      const files = [];
      let total = 0;
      for (const relative of changed) {
        const full = path.join(source, relative);
        const info = await lstat(full);
        if (!info.isFile() || info.size > 1024 * 1024) throw prototypeLandingError("source_change_large", `Prototype Landing output is invalid for ${relative}.`);
        const bytes = await readFile(full);
        total += bytes.length;
        if (total > 8 * 1024 * 1024) throw prototypeLandingError("source_change_large", "Prototype Landing output exceeds the bounded publication limit.");
        files.push({ path: relative, mode: "100644", content_base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      return {
        branch: branch(record),
        base_commit: revision,
        files,
        file_count: files.length,
        changed_paths: files.map((file) => file.path),
        content_digest: prototypeLandingDigest(files.map(({ path: filePath, mode, sha256 }) => ({ path: filePath, mode, sha256 }))),
        readback,
        receipt,
      };
    });
  }

  async function verifyReview(record, review) {
    if (review.repository !== "workspace-prototype-studio" || review.base_branch !== "main" ||
        review.branch !== branch(record) || review.base_commit !== record.evaluation.authority_revision ||
        review.head_commit !== record.review?.head_commit) {
      throw prototypeLandingError("review_changed", "Prototype Landing review no longer matches the prepared source change.");
    }
  }

  async function merged(record, review) {
    if (!review.merged || !review.human_reviewed || !SHA.test(review.merge_commit)) throw prototypeLandingError("review_unproven", "Prototype Landing requires exact-head human review evidence.");
    await provider.verifyMergedFiles(review, record.preparation);
    const observedAt = clock().toISOString();
    const readback = assertPrototypeLandingArtifact(bindPrototypeLanding({
      ...record.preparation.readback,
      authority_state: "merged-authority",
      source_branch: "main",
      source_revision: review.merge_commit,
      observed_at: observedAt,
    }, "readback_digest"));
    const receipt = assertPrototypeLandingArtifact(bindPrototypeLanding({
      ...record.preparation.receipt,
      receipt_id: `prototype-landing-receipt:${record.evaluation.request.prototype.id.replace(/^prototype:/, "")}:${Date.parse(observedAt) * 1000}`,
      completed_at: observedAt,
      readback_ref: prototypeLandingReference(readback),
      phase: "merged-authority",
      outcome: "succeeded",
      source_result: {
        ...record.preparation.receipt.source_result,
        branch: "main",
        revision: review.merge_commit,
      },
      next_action: { code: "candidate-promotion", owner_ref: "workspace-prototype-studio" },
    }, "receipt_digest"));
    return { review, readback, receipt };
  }

  return {
    branch,
    state,
    prepare,
    async openReview(record, assertHeld) {
      assertHeld();
      return provider.prepareReview(record.preparation, { requestId: record.evaluation.request.request_id, binding: record.binding_digest });
    },
    async observe(record, assertHeld) {
      assertHeld();
      const review = await provider.review(record.review.number);
      await verifyReview(record, review);
      return review.merged ? merged(record, review) : { review };
    },
    async cancel(record, assertHeld) {
      assertHeld();
      const review = record.review ? await provider.review(record.review.number) : await provider.findReview(branch(record));
      if (!review) {
        if (!record.preparation) return null;
        return await provider.verifyPreparedBranch(record.preparation)
          ? { retained_branch: record.preparation.branch }
          : null;
      }
      if (!record.preparation) throw prototypeLandingError("cancel_source_unproven", "An unexpected review cannot be cancelled without source preparation.");
      await provider.verifyPreparedReview(record.preparation, review);
      const bound = { ...record, review: record.review ?? review };
      await verifyReview(bound, review);
      if (review.merged) return merged(bound, review);
      await provider.closeReview(review);
      const observed = await provider.review(review.number);
      await verifyReview(bound, observed);
      if (observed.merged) return merged(bound, observed);
      if (observed.state !== "closed") throw prototypeLandingError("cancel_unconfirmed", "Prototype Landing review cancellation was not confirmed.", 503);
      return null;
    },
  };
}
