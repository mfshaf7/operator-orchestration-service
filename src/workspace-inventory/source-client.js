import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryDigest, inventoryError, inventoryManifest } from "./contracts.js";

const execute = promisify(execFile);
const INTAKE_REGISTER = "contracts/intake-register.yaml";
const INVENTORY_HISTORY = "contracts/workspace-inventory-history.yaml";
const INVENTORY_PATHS = {
  repo: "contracts/repos.yaml",
  product: "contracts/products.yaml",
  component: "contracts/components.yaml",
};
const SHA = /^[0-9a-f]{40}$/;
const helper = fileURLToPath(new URL("../../scripts/workspace_inventory_source.py", import.meta.url));
const gitEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

export function createWorkspaceInventorySourceClient({ authorityRoot, python = "python3", provider, clock = () => new Date() }) {
  const git = async (root, ...args) => (await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env: gitEnv,
    maxBuffer: 4194304,
    timeout: 60000,
  })).stdout.trim();

  async function sandbox(revision, operation) {
    if (!SHA.test(revision)) throw inventoryError("revision_invalid", "Inventory promotion requires an exact authority commit.");
    await git(authorityRoot, "merge-base", "--is-ancestor", inventoryManifest.files["workspace-active-inventory.yaml"].commit, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const directory = await mkdtemp(path.join(tmpdir(), "oos-inventory-"));
    const source = path.join(directory, "source");
    try {
      await execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", authorityRoot, source], {
        env: gitEnv,
        timeout: 60000,
      });
      await git(source, "checkout", "-b", "inventory-sandbox", revision);
      return await operation({ directory, source });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function ownerCommand(command, source, directory, input) {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "output.json");
    await writeFile(inputPath, JSON.stringify(input), { mode: 0o600 });
    await execute(python, [helper, command, "--source-root", source, "--input", inputPath, "--output", outputPath], {
      env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 60000,
      maxBuffer: 262144,
    });
    return JSON.parse(await readFile(outputPath, "utf8"));
  }

  const promotionBranch = (record) => `inventory/${record.binding_digest.slice(7)}`;
  const lifecycleBranch = (record) => `inventory-lifecycle/${record.binding_digest.slice(7)}`;

  async function verifyReview(record, review, expectedBranch) {
    if (review.base_branch !== "main" || review.branch !== expectedBranch ||
        review.base_commit !== record.evaluation.authority_revision ||
        review.head_commit !== record.review?.head_commit ||
        review.repository !== "workspace-governance") {
      throw inventoryError("review_changed", "Inventory review source no longer matches the prepared change.");
    }
  }

  async function merged(record, review) {
    if (!review.merged || !review.human_reviewed || !SHA.test(review.merge_commit)) {
      throw inventoryError("review_unproven", "Merged inventory promotion requires exact-head human review evidence.");
    }
    const files = await provider.readMergedFiles(review, record.preparation.inventory_path);
    const readback = await sandbox(record.evaluation.authority_revision, async ({ directory, source }) => {
      await writeFile(path.join(source, INTAKE_REGISTER), files.intakeText);
      await writeFile(path.join(source, record.preparation.inventory_path), files.inventoryText);
      return ownerCommand("readback", source, directory, {
        readback: record.preparation.readback,
        at: clock().toISOString(),
        commit: review.merge_commit,
      });
    });
    return { review, readback };
  }

  async function mergedLifecycle(record, review) {
    if (!review.merged || !review.human_reviewed || !SHA.test(review.merge_commit)) {
      throw inventoryError("review_unproven", "Merged inventory lifecycle change requires exact-head human review evidence.");
    }
    const files = await provider.readMergedLifecycleFiles(review, record.preparation.inventory_path);
    const mergedState = await sandbox(record.evaluation.authority_revision, async ({ directory, source }) => {
      await writeFile(path.join(source, record.preparation.inventory_path), files.inventoryText);
      await writeFile(path.join(source, INVENTORY_HISTORY), files.historyText);
      return ownerCommand("lifecycle-readback", source, directory, {
        target: record.request.target,
        action: record.request.action,
        history_event_ref: record.preparation.readback.history_event_ref,
        at: clock().toISOString(),
        commit: review.merge_commit,
      });
    });
    return { review, mergedState };
  }

  return {
    async registry() {
      try {
        const revision = await provider.mainRevision();
        return await sandbox(revision, async ({ directory, source }) => {
          const result = await ownerCommand("registry", source, directory, {});
          if (await git(source, "status", "--short")) {
            throw inventoryError("source_change_invalid", "Workspace Inventory registry inspection must not modify authority source.", 503);
          }
          return { ...result, authority_revision: revision };
        });
      } catch (error) {
        if (typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")) throw error;
        throw inventoryError("authority_unavailable", "Current Workspace Inventory registry is unavailable.", 503);
      }
    },
    async state(target) {
      try {
        const revision = await provider.mainRevision();
        return await sandbox(revision, async ({ directory, source }) => {
          const result = await ownerCommand("state", source, directory, { target });
          if (await git(source, "status", "--short")) {
            throw inventoryError("source_change_invalid", "Workspace Inventory state inspection must not modify authority source.", 503);
          }
          return { ...result, authority_revision: revision };
        });
      } catch (error) {
        if (typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")) throw error;
        throw inventoryError("authority_unavailable", "Current Workspace Inventory authority state is unavailable.", 503);
      }
    },
    async lifecycleState(target) {
      try {
        const revision = await provider.mainRevision();
        return await sandbox(revision, async ({ directory, source }) => {
          const result = await ownerCommand("lifecycle-state", source, directory, {
            target: { ...target, record_id: `${target.kind}:${target.name}` },
          });
          if (await git(source, "status", "--short")) {
            throw inventoryError("source_change_invalid", "Workspace Inventory lifecycle inspection must not modify authority source.", 503);
          }
          return { ...result, authority_revision: revision };
        });
      } catch (error) {
        if (typeof error?.code === "string" && error.code.startsWith("workspace_inventory_")) throw error;
        throw inventoryError("authority_unavailable", "Current Workspace Inventory lifecycle state is unavailable.", 503);
      }
    },
    async prepare(record, assertHeld) {
      const revision = record.evaluation.authority_revision;
      if ((await provider.mainRevision()) !== revision) throw inventoryError("authority_stale", "Authority changed; submit a newly reviewed promotion.");
      assertHeld();
      return sandbox(revision, async ({ directory, source }) => {
        const result = await ownerCommand("prepare", source, directory, {
          request: record.request,
          readiness: record.readiness.readiness,
          branch: promotionBranch(record),
          at: record.history.find((event) => event.status === "preparing").at,
        });
        const changed = (await git(source, "diff", "--name-only")).split("\n").filter(Boolean).sort();
        const expected = [INTAKE_REGISTER, INVENTORY_PATHS[record.request.target.kind]].sort();
        if (JSON.stringify(changed) !== JSON.stringify(expected) || result.inventory_path !== INVENTORY_PATHS[record.request.target.kind]) {
          throw inventoryError("source_change_invalid", "Inventory promotion may change only the intake register and selected active inventory.");
        }
        return {
          ...result,
          branch: promotionBranch(record),
          base_commit: revision,
          content_digest: inventoryDigest({ intake: result.intake_text, inventory: result.inventory_text }),
        };
      });
    },
    async openReview(record, assertHeld) {
      assertHeld();
      return provider.prepareReview(record.preparation, {
        requestId: record.request.request_id,
        binding: record.binding_digest,
        target: record.request.target,
      });
    },
    async observe(record, assertHeld) {
      assertHeld();
      const review = await provider.review(record.review.number);
      await verifyReview(record, review, promotionBranch(record));
      return review.merged ? merged(record, review) : { review };
    },
    async cancel(record, assertHeld) {
      assertHeld();
      const review = record.review
        ? await provider.review(record.review.number)
        : await provider.findReview(promotionBranch(record));
      if (!review) return null;
      if (!record.preparation) throw inventoryError("cancel_source_unproven", "An unexpected review cannot be cancelled without its source preparation.");
      await provider.verifyPreparedReview(record.preparation, review);
      const bound = { ...record, review: record.review ?? review };
      await verifyReview(bound, review, promotionBranch(record));
      if (review.merged) return merged(bound, review);
      await provider.closeReview(review);
      const observed = await provider.review(review.number);
      await verifyReview(bound, observed, promotionBranch(record));
      if (observed.merged) return merged(bound, observed);
      if (observed.state !== "closed") throw inventoryError("cancel_unconfirmed", "Review cancellation has not been confirmed.", 503);
      return null;
    },
    async prepareLifecycle(record, assertHeld) {
      const revision = record.evaluation.authority_revision;
      if ((await provider.mainRevision()) !== revision) throw inventoryError("authority_stale", "Authority changed; submit a newly reviewed lifecycle request.");
      assertHeld();
      return sandbox(revision, async ({ directory, source }) => {
        const result = await ownerCommand("lifecycle-prepare", source, directory, {
          request: record.request,
          readiness: record.readiness.readiness,
          branch: lifecycleBranch(record),
          at: record.history.find((event) => event.status === "preparing").at,
        });
        const changed = (await git(source, "diff", "--name-only")).split("\n").filter(Boolean).sort();
        const expected = [INVENTORY_HISTORY, INVENTORY_PATHS[record.request.target.kind]].sort();
        if (JSON.stringify(changed) !== JSON.stringify(expected) ||
            result.inventory_path !== INVENTORY_PATHS[record.request.target.kind] ||
            result.history_path !== INVENTORY_HISTORY) {
          throw inventoryError("source_change_invalid", "Inventory lifecycle may change only the selected active inventory and append-only history.");
        }
        return {
          ...result,
          branch: lifecycleBranch(record),
          base_commit: revision,
          content_digest: inventoryDigest({ inventory: result.inventory_text, history: result.history_text }),
        };
      });
    },
    async openLifecycleReview(record, assertHeld) {
      assertHeld();
      return provider.prepareLifecycleReview(record.preparation, {
        requestId: record.request.request_id,
        binding: record.binding_digest,
        target: record.request.target,
        action: record.request.action,
      });
    },
    async observeLifecycle(record, assertHeld) {
      assertHeld();
      const review = await provider.review(record.review.number);
      await verifyReview(record, review, lifecycleBranch(record));
      return review.merged ? mergedLifecycle(record, review) : { review };
    },
    async cancelLifecycle(record, assertHeld) {
      assertHeld();
      const review = record.review
        ? await provider.review(record.review.number)
        : await provider.findReview(lifecycleBranch(record));
      if (!review) return null;
      if (!record.preparation) throw inventoryError("cancel_source_unproven", "An unexpected review cannot be cancelled without its source preparation.");
      await provider.verifyPreparedLifecycleReview(record.preparation, review);
      const bound = { ...record, review: record.review ?? review };
      await verifyReview(bound, review, lifecycleBranch(record));
      if (review.merged) return mergedLifecycle(bound, review);
      await provider.closeReview(review);
      const observed = await provider.review(review.number);
      await verifyReview(bound, observed, lifecycleBranch(record));
      if (observed.merged) return mergedLifecycle(bound, observed);
      if (observed.state !== "closed") throw inventoryError("cancel_unconfirmed", "Review cancellation has not been confirmed.", 503);
      return null;
    },
  };
}
