import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intakeDigest, intakeError, intakeManifest } from "./contracts.js";

const execute = promisify(execFile);
const REGISTER = "contracts/intake-register.yaml";
const SHA = /^[0-9a-f]{40}$/;
const helper = fileURLToPath(new URL("../../scripts/workspace_intake_source.py", import.meta.url));
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

export function createWorkspaceIntakeSourceClient({ authorityRoot, python = "python3", provider, clock = () => new Date() }) {
  const git = async (root, ...args) => (await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], { env: gitEnv, maxBuffer: 4194304, timeout: 60000 })).stdout.trim();
  async function sandbox(revision, operation) {
    if (!SHA.test(revision)) throw intakeError("revision_invalid", "Intake requires an exact authority commit.");
    await git(authorityRoot, "merge-base", "--is-ancestor", intakeManifest.files["workspace-intake.yaml"].commit, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const directory = await mkdtemp(path.join(tmpdir(), "oos-intake-"));
    const source = path.join(directory, "source");
    try {
      await execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", authorityRoot, source], { env: gitEnv, timeout: 60000 });
      await git(source, "checkout", "-b", "intake-sandbox", revision);
      return await operation({ directory, source });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async function ownerCommand(command, source, directory, input) {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "output.json");
    await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
    await execute(python, [helper, command, "--source-root", source, "--input", inputPath, "--output", outputPath], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 60000, maxBuffer: 262144 });
    return JSON.parse(await readFile(outputPath, "utf8"));
  }
  const branch = (record) => `intake/${record.binding_digest.slice(7)}`;
  async function verifyReview(record, review) {
    if (review.base_branch !== "main" || review.branch !== branch(record) || review.base_commit !== record.evaluation.authority_revision ||
        review.head_commit !== record.review?.head_commit || review.repository !== "workspace-governance") {
      throw intakeError("review_changed", "Intake review source no longer matches the prepared change.");
    }
  }
  async function merged(record, review) {
    if (!review.merged || !review.human_reviewed || !SHA.test(review.merge_commit)) throw intakeError("review_unproven", "Merged intake requires exact-head human review evidence.");
    const registerText = await provider.readMergedRegister(review);
    const readback = await sandbox(record.evaluation.authority_revision, async ({ directory, source }) => {
      await writeFile(path.join(source, REGISTER), registerText);
      return ownerCommand("readback", source, directory, { readback: record.preparation.readback, at: clock().toISOString(), commit: review.merge_commit });
    });
    return { review, readback };
  }
  return {
    async state(target) {
      let revision;
      try {
        revision = await provider.mainRevision();
        return await sandbox(revision, async ({ directory, source }) => {
          const result = await ownerCommand("state", source, directory, { target });
          if (await git(source, "status", "--short")) {
            throw intakeError("source_change_invalid", "Workspace Intake state inspection must not modify authority source.", 503);
          }
          return { ...result, authority_revision: revision };
        });
      } catch (error) {
        if (error?.code?.startsWith("workspace_intake_")) throw error;
        throw intakeError("authority_unavailable", "Current Workspace Intake authority state is unavailable.", 503);
      }
    },
    async prepare(record, assertHeld) {
      const revision = record.evaluation.authority_revision;
      if ((await provider.mainRevision()) !== revision) throw intakeError("authority_stale", "Authority changed; submit a newly reviewed request.");
      assertHeld();
      return sandbox(revision, async ({ directory, source }) => {
        const result = await ownerCommand("prepare", source, directory, {
          request: record.request, decision: record.evaluation.decision, branch: branch(record),
          at: record.history.find((event) => event.status === "preparing").at,
        });
        const changed = await git(source, "diff", "--name-only");
        if (changed !== REGISTER && record.readiness.receipt.next_action !== "read-merged-record") throw intakeError("source_change_invalid", "Intake may change only the canonical intake register.");
        return { ...result, branch: branch(record), base_commit: revision, content_digest: intakeDigest(result.register_text) };
      });
    },
    async openReview(record, assertHeld) {
      assertHeld();
      return provider.prepareReview(record.preparation, { requestId: record.request.request_id, binding: record.binding_digest });
    },
    async observe(record, assertHeld) {
      assertHeld();
      const review = await provider.review(record.review.number);
      await verifyReview(record, review);
      return review.merged ? merged(record, review) : { review };
    },
    async cancel(record, assertHeld) {
      assertHeld();
      // A crashed publication may have created a PR before OOS stored its id.
      const review = record.review ? await provider.review(record.review.number) : await provider.findReview(branch(record));
      if (!review) return null;
      if (!record.preparation) throw intakeError("cancel_source_unproven", "An unexpected review cannot be cancelled without its source preparation.");
      await provider.verifyPreparedReview(record.preparation, review);
      const bound = { ...record, review: record.review ?? review };
      await verifyReview(bound, review);
      if (review.merged) return merged(bound, review);
      await provider.closeReview(review);
      const observed = await provider.review(review.number);
      await verifyReview(bound, observed);
      if (observed.merged) return merged(bound, observed);
      if (observed.state !== "closed") throw intakeError("cancel_unconfirmed", "Review cancellation has not been confirmed.", 503);
      return null;
    },
  };
}
