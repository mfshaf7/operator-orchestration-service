import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertProposalTargetArtifact,
  createStudioApplication,
  proposalTargetDigest,
  proposalTargetError,
  proposalTargetManifest,
} from "./contracts.js";

const execute = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

export function createProposalTargetSourceClient({ authorityRoot, provider, python = "python3", clock = () => new Date() }) {
  const git = async (root, ...args) => (await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], { env: gitEnv, maxBuffer: 4 * 1024 * 1024, timeout: 60000 })).stdout.trim();
  const branch = (record) => `proposal-target/${record.binding_digest.slice(7)}`;

  async function sandbox(revision, branchName, operation) {
    if (!SHA.test(revision)) throw proposalTargetError("revision_invalid", "Proposal target application requires an exact Prototype Studio commit.");
    await git(authorityRoot, "merge-base", "--is-ancestor", proposalTargetManifest.source_authority.commit, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const directory = await mkdtemp(path.join(tmpdir(), "oos-proposal-target-"));
    const source = path.join(directory, "source");
    try {
      await execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", authorityRoot, source], { env: gitEnv, timeout: 60000 });
      await git(source, "checkout", "-b", branchName, revision);
      return await operation({ directory, source });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async function state(prototypeId) {
    try {
      const revision = await provider.mainRevision();
      return await sandbox(revision, "proposal-target-state", async ({ source }) => {
        const result = await execute(python, [path.join(source, "scripts/proposal_target_application.py"), "--repo-root", source, "state", "--prototype-id", prototypeId], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 60000, maxBuffer: 262144 });
        if (await git(source, "status", "--short")) throw proposalTargetError("source_change_invalid", "Proposal target state inspection modified source.", 503);
        return { ...JSON.parse(result.stdout), authority_revision: revision };
      });
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("proposal_target_")) throw error;
      throw proposalTargetError("authority_unavailable", "Current Prototype Studio target state is unavailable.", 503);
    }
  }

  async function prepare(record, assertHeld) {
    const revision = record.evaluation.target.authority_revision;
    if ((await provider.mainRevision()) !== revision) throw proposalTargetError("authority_stale", "Prototype Studio changed; prepare a fresh Proposal target application.");
    assertHeld();
    return sandbox(revision, branch(record), async ({ directory, source }) => {
      const request = createStudioApplication({ evaluation: record.evaluation, proposal: record.proposal, sourceBranch: branch(record), requestedAt: record.requested_at });
      const requestPath = path.join(directory, "request.json");
      const outputPath = path.join(directory, "result.json");
      await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
      try {
        await execute(python, [path.join(source, "scripts/proposal_target_application.py"), "--repo-root", source, "apply", "--request", requestPath, "--output", outputPath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 120000, maxBuffer: 1048576 });
      } catch (error) {
        let detail = {}; try { detail = JSON.parse(error.stdout); } catch {}
        throw proposalTargetError(detail.code ?? "source_prepare_failed", "Prototype Studio rejected the Proposal target source preparation.", 409);
      }
      const result = assertProposalTargetArtifact(JSON.parse(await readFile(outputPath, "utf8")));
      assertProposalTargetArtifact(result.readback.record);
      await git(source, "add", "--all");
      const changed = (await git(source, "diff", "--cached", "--name-only", "--diff-filter=AM")).split("\n").filter(Boolean);
      const statuses = (await git(source, "diff", "--cached", "--name-status")).split("\n").filter(Boolean);
      const slug = record.evaluation.prototype.id.slice("prototype:".length);
      const expectedPrefix = `records/prototype-captures/${slug}/`;
      if (changed.length !== 2 || statuses.some((line) => !/^A\t/.test(line)) || changed.some((name) => !name.startsWith(expectedPrefix))) {
        throw proposalTargetError("source_change_invalid", "Proposal target application produced changes outside its two target-owned capture files.");
      }
      const files = []; let total = 0;
      for (const relative of changed) {
        const full = path.join(source, relative); const info = await lstat(full);
        if (!info.isFile() || info.size > 1024 * 1024) throw proposalTargetError("source_change_large", `Proposal target output is invalid for ${relative}.`);
        const bytes = await readFile(full); total += bytes.length;
        if (total > 2 * 1024 * 1024) throw proposalTargetError("source_change_large", "Proposal target output exceeds the bounded publication limit.");
        files.push({ path: relative, mode: "100644", content_base64: bytes.toString("base64") });
      }
      const tree = await git(source, "write-tree");
      if (result.readback.source_branch !== branch(record) || result.readback.source_revision !== `git-tree:${tree}` ||
          result.application_ref.id !== request.application_id || result.application_ref.digest !== request.request_digest ||
          result.readback.record.prototype_id !== record.evaluation.prototype.id ||
          result.receipt.source_record_ref !== record.proposal.record_ref || result.receipt.source_record_version !== record.proposal.record_version ||
          result.receipt.source_packet_ref !== record.proposal.handoff_packet_ref || result.receipt.outcome !== "prepared") {
        throw proposalTargetError("source_result_mismatch", "Prototype Studio result does not bind the exact Proposal target command.");
      }
      return { branch: branch(record), base_commit: revision, file_count: files.length, changed_paths: changed, content_digest: proposalTargetDigest(files), files, request, result };
    });
  }

  async function verifyReview(record, review) {
    if (review.repository !== "workspace-prototype-studio" || review.branch !== record.preparation.branch || review.base_branch !== "main" || review.base_commit !== record.preparation.base_commit) {
      throw proposalTargetError("review_changed", "Proposal target review no longer matches the prepared source change.");
    }
    await provider.verifyPreparedReview(record.preparation, review);
  }

  async function merged(record, review) {
    await provider.verifyMergedFiles(review, record.preparation);
    return { review, result: structuredClone(record.preparation.result), merged_at: clock().toISOString() };
  }

  return {
    branch, state, prepare,
    async openReview(record, assertHeld) { assertHeld(); const review = await provider.prepareReview(record.preparation, { applicationId: record.evaluation.application_id, binding: record.binding_digest }); await verifyReview(record, review); return review; },
    async observe(record, assertHeld) { assertHeld(); const review = await provider.review(record.review.number); await verifyReview(record, review); return review.merged ? merged(record, review) : { review }; },
    async cancel(record, assertHeld) {
      assertHeld(); const review = record.review ? await provider.review(record.review.number) : await provider.findReview(record.preparation?.branch ?? branch(record));
      if (!review) return record.preparation && await provider.verifyPreparedBranch(record.preparation) ? { retained_branch: record.preparation.branch } : null;
      await verifyReview(record, review); if (review.merged) return merged(record, review);
      await provider.closeReview(review); const observed = await provider.review(review.number); await verifyReview(record, observed);
      if (observed.merged) return merged(record, observed);
      if (observed.state !== "closed") throw proposalTargetError("cancel_unconfirmed", "Proposal target review cancellation was not confirmed.", 503);
      return null;
    },
  };
}
