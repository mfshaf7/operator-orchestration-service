import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import { assertClosureArtifact, closureDigest, closureError, closureManifest } from "./contracts.js";

const execute = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;
const gitEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

export function createPrototypeClosureSourceClient({ authorityRoot, provider, python = "python3" }) {
  const git = async (root, ...args) => (
    await execute("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      env: gitEnv, maxBuffer: 16 * 1024 * 1024, timeout: 60000,
    })
  ).stdout.trim();
  const branch = (record) => `prototype-closure/${record.binding_digest.slice(7)}`;

  async function sandbox(revision, branchName, operation) {
    if (!SHA.test(revision)) throw closureError("revision_invalid", "Closure requires an exact Studio commit.");
    await git(authorityRoot, "merge-base", "--is-ancestor", closureManifest.source_authority.minimum_commit, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const directory = await mkdtemp(path.join(tmpdir(), "oos-prototype-closure-"));
    const source = path.join(directory, "source");
    try {
      await execute("git", ["-c", "core.hooksPath=/dev/null", "clone", "--no-checkout", "--shared", "--template=", authorityRoot, source], {
        env: gitEnv, timeout: 60000,
      });
      await git(source, "checkout", "-B", branchName, revision);
      return await operation({ directory, source });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async function runSource(source, args) {
    try {
      const result = await execute(python, [path.join(source, "scripts/prototype_closure.py"), "--repo-root", source, ...args], {
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 120000,
        maxBuffer: 1048576,
      });
      return JSON.parse(result.stdout);
    } catch (error) {
      if (error.code === "ENOENT" || error.killed || error.signal) {
        throw closureError("source_dependency_unavailable", "Prototype Studio source runner is unavailable.", 503);
      }
      let detail = {};
      try { detail = JSON.parse(error.stderr); } catch {}
      throw closureError(detail.code ?? "source_command_failed", "Prototype Studio rejected the Closure source operation.", 409);
    }
  }

  async function state(prototypeId) {
    const revision = await provider.mainRevision();
    return sandbox(revision, "prototype-closure-state", async ({ source }) => {
      const registry = parseYaml(await git(source, "show", "HEAD:prototypes.yaml"), { uniqueKeys: true });
      const matches = registry?.prototypes?.filter((item) => item?.id === prototypeId);
      if (!Array.isArray(matches) || matches.length !== 1) {
        throw closureError("source_record_invalid", "Expected one current Studio Prototype record.", 404);
      }
      const item = matches[0];
      const custody = item.source_custody ?? (item.lifecycle === "graduated" ? null : "incubation-repo");
      if (custody !== null && !["incubation-repo", "dedicated-owner-repo", "shared-owner-repo"].includes(custody)) {
        throw closureError("source_record_invalid", "Studio source custody is invalid.", 502);
      }
      const prefix = `records/prototype-closure/${prototypeId}/history`;
      const paths = (await git(source, "ls-tree", "-r", "--name-only", "HEAD", "--", prefix))
        .split("\n").filter(Boolean).sort();
      if (paths.length > 256) {
        throw closureError("history_too_large", "Closure history exceeds the bounded read limit.", 503);
      }
      let priorDigest = null;
      const history = [];
      for (const [index, eventPath] of paths.entries()) {
        const sequence = String(index + 1).padStart(4, "0");
        if (eventPath !== `${prefix}/${sequence}.json`) {
          throw closureError("history_invalid", "Closure history path or sequence is invalid.", 502);
        }
        const event = assertClosureArtifact(JSON.parse(await git(source, "show", `HEAD:${eventPath}`)), "history-event");
        if (event.prototype_id !== prototypeId ||
            event.event_id !== `prototype-closure:${prototypeId}:${sequence}` ||
            event.prior_event_digest !== priorDigest) {
          throw closureError("history_invalid", "Closure history event chain is invalid.", 502);
        }
        priorDigest = closureDigest(event, { ascii: true });
        history.push({
          event_id: event.event_id,
          event_type: event.event_type,
          request_ref: event.request_ref,
          expected_source_revision: event.expected_source_revision,
          previous_lifecycle: event.previous_lifecycle,
          observed_lifecycle: event.observed_lifecycle,
          previous_source_custody: event.previous_source_custody,
          observed_source_custody: event.observed_source_custody,
          recorded_at: event.recorded_at,
        });
      }
      if (await git(source, "status", "--short")) {
        throw closureError("source_change_invalid", "Closure source preparation changed Studio source.", 503);
      }
      return {
        source_revision: revision,
        record_digest: closureDigest(item, { ascii: true }),
        lifecycle: item.lifecycle,
        source_custody: custody,
        design_baseline_ref: item.design_baseline_ref ?? null,
        delivery_packet_ref: item.delivery_packet_ref ?? null,
        accepted_delivery_target_receipt_ref: item.accepted_delivery_target_receipt_ref ?? null,
        retirement_ref: item.retirement_ref ?? null,
        project_phase: item.project_phase ?? null,
        history,
      };
    });
  }

  async function readAt(revision, prototypeId, assertHeld = () => {}) {
    return sandbox(revision, `prototype-closure-read-${prototypeId}`, async ({ source }) => {
      assertHeld();
      const registry = parseYaml(await git(source, "show", "HEAD:prototypes.yaml"), { uniqueKeys: true });
      const matches = registry?.prototypes?.filter((item) => item?.id === prototypeId);
      if (!Array.isArray(matches) || matches.length !== 1) {
        throw closureError("source_record_invalid", "Expected one exact Studio Prototype record.", 502);
      }
      const item = matches[0];
      const custody = item.source_custody ?? (item.lifecycle === "graduated" ? null : "incubation-repo");
      return {
        source_revision: revision,
        record_digest: closureDigest(item, { ascii: true }),
        lifecycle: item.lifecycle,
        source_custody: custody,
        design_baseline_ref: item.design_baseline_ref ?? null,
        delivery_packet_ref: item.delivery_packet_ref ?? null,
        accepted_delivery_target_receipt_ref: item.accepted_delivery_target_receipt_ref ?? null,
        retirement_ref: item.retirement_ref ?? null,
        project_phase: item.project_phase ?? null,
      };
    });
  }

  async function snapshot(record, assertHeld = () => {}) {
    const observed = await readAt(record.request.expected_source_revision,
      record.request.prototype_id, assertHeld);
    if (observed.lifecycle !== record.request.expected_lifecycle ||
        !["incubation-repo", "dedicated-owner-repo", "shared-owner-repo"].includes(observed.source_custody)) {
      throw closureError("source_record_mismatch", "Studio lifecycle or custody differs from the accepted Closure request.");
    }
    return observed;
  }

  async function prepare(record, assertHeld = () => {}) {
    const base = record.request.expected_source_revision;
    if (await provider.mainRevision() !== base) {
      throw closureError("authority_stale", "Prototype Studio changed before Closure source preparation.");
    }
    return sandbox(base, branch(record), async ({ directory, source }) => {
      const requestPath = path.join(directory, "request.json");
      const authorityPath = path.join(directory, "resolved-authority.json");
      await writeFile(requestPath, JSON.stringify(record.request), { mode: 0o600 });
      await writeFile(authorityPath, JSON.stringify(record.resolved_authority), { mode: 0o600 });
      assertHeld();
      const result = await runSource(source, ["prepare", "--request", requestPath, "--resolved-authority", authorityPath]);
      const eventPath = path.relative(source, result.event_path ?? "");
      if (
        result.status !== "source-prepared" ||
        !new RegExp(`^records/prototype-closure/${record.request.prototype_id}/history/[0-9]{4}\\.json$`).test(eventPath)
      ) {
        throw closureError("source_paths_invalid", "Studio prepared an unexpected Closure event path.", 502);
      }
      const changed = await git(source, "diff", "--name-only", "-z");
      const untracked = await git(source, "ls-files", "--others", "--exclude-standard", "-z");
      const paths = [...changed.split("\0"), ...untracked.split("\0")].filter(Boolean).sort();
      if (JSON.stringify(paths) !== JSON.stringify(["prototypes.yaml", eventPath].sort())) {
        throw closureError("source_paths_invalid", "Closure preparation changed files outside the registry and one append-only event.", 502);
      }
      const event = assertClosureArtifact(JSON.parse(await readFile(path.join(source, eventPath), "utf8")), "history-event");
      if (result.event_id !== event.event_id || result.event_digest !== closureDigest(event, { ascii: true })) {
        throw closureError("source_event_invalid", "Studio event content differs from its preparation result.", 502);
      }
      const files = [];
      for (const filePath of paths) {
        const absolute = path.join(source, filePath);
        const stat = await lstat(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw closureError("source_paths_invalid", "Closure source contains a non-file change.", 502);
        }
        files.push({ path: filePath, mode: "100644", content_base64: (await readFile(absolute)).toString("base64") });
      }
      return {
        branch: branch(record), base_commit: base, files, event_path: eventPath,
        event, event_digest: result.event_digest,
      };
    });
  }

  async function openReview(record, assertHeld = () => {}) {
    assertHeld();
    const review = await provider.prepareReview(record.preparation, {
      requestId: record.request.request_id,
      binding: record.binding_digest,
    });
    if (
      review.branch !== record.preparation.branch ||
      review.base_commit !== record.preparation.base_commit ||
      review.state !== "open"
    ) {
      throw closureError("review_invalid", "Closure review differs from the prepared source.", 502);
    }
    await provider.verifyPreparedReview(record.preparation, review);
    return review;
  }

  async function observe(record, assertHeld = () => {}) {
    assertHeld();
    const review = await provider.review(record.review.number);
    if (
      review.branch !== record.preparation.branch ||
      review.base_commit !== record.preparation.base_commit ||
      review.head_commit !== record.review.head_commit
    ) {
      throw closureError("review_changed", "Closure review head or base changed after decision.");
    }
    return review;
  }

  async function readback(record, assertHeld = () => {}) {
    assertHeld();
    await provider.verifyMergedFiles(record.review, record.preparation);
    return sandbox(record.review.merge_commit, "main", async ({ source }) => {
      const result = await runSource(source, ["readback", "--event", path.join(source, record.preparation.event_path)]);
      if (await git(source, "status", "--short")) {
        throw closureError("readback_changed_source", "Studio readback modified merged source.", 503);
      }
      return assertClosureArtifact(result, "studio-readback");
    });
  }

  async function cancel(record, assertHeld = () => {}) {
    assertHeld();
    if (!record.preparation && !record.review) return null;
    const review = record.review
      ? await provider.review(record.review.number)
      : await provider.findReview(branch(record));
    if (!review) {
      if (record.preparation && await provider.verifyPreparedBranch(record.preparation)) {
        return { retained_branch: record.preparation.branch };
      }
      return null;
    }
    if (!record.preparation || review.branch !== record.preparation.branch ||
        review.base_commit !== record.preparation.base_commit ||
        (record.review && review.head_commit !== record.review.head_commit)) {
      throw closureError("cancel_source_unproven", "Closure review differs from the prepared source.");
    }
    await provider.verifyPreparedReview(record.preparation, review);
    if (review.merged) return { review };
    if (review.state !== "closed") await provider.closeReview(review);
    const observed = await provider.review(review.number);
    if (observed.branch !== review.branch || observed.head_commit !== review.head_commit) {
      throw closureError("cancel_review_changed", "Closure review changed during cancellation.");
    }
    if (observed.merged) return { review: observed };
    if (observed.state !== "closed") {
      throw closureError("cancel_unconfirmed", "Closure review cancellation was not confirmed.", 503);
    }
    return null;
  }

  return { branch, state, readAt, snapshot, prepare, openReview, observe, readback, cancel };
}
