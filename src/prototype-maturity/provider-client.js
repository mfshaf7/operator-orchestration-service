import { readFile } from "node:fs/promises";
import { prototypeMaturityError } from "./contracts.js";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^prototype-maturity\/[0-9a-f]{64}$/;

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

export function createPrototypeMaturityGitHubClient({ owner, repositoryId, tokenFile, apiBaseUrl = "https://api.github.com", sandbox = false, fetchImpl = globalThis.fetch }) {
  const endpoint = new URL(apiBaseUrl);
  if (apiBaseUrl !== "https://api.github.com" && !(sandbox && endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) {
    throw prototypeMaturityError("provider_destination_invalid", "Prototype Maturity provider destination is not admitted.", 503);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^\d+$/.test(String(repositoryId))) {
    throw prototypeMaturityError("provider_identity_invalid", "Configure the exact Prototype Studio repository identity.", 503);
  }
  const repository = "workspace-prototype-studio";
  const prefix = `/repos/${owner}/${repository}`;

  async function request(route, { method = "GET", body, absent = false } = {}) {
    let token;
    try { token = (await readFile(tokenFile, "utf8")).trim(); }
    catch { throw prototypeMaturityError("credential_unavailable", "The Platform-issued Prototype Maturity credential is unavailable.", 503); }
    if (!token.startsWith("ghs_")) throw prototypeMaturityError("credential_invalid", "Prototype Maturity requires a Platform-issued installation token.", 503);
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${route}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw prototypeMaturityError("provider_unavailable", "The Prototype Maturity source provider is unavailable.", 503);
    }
    if (response.status === 404 && absent) return null;
    if (!response.ok) {
      throw prototypeMaturityError("provider_rejected", "The source provider did not accept the Prototype Maturity operation.", response.status >= 500 || response.status === 429 ? 503 : 409);
    }
    if (response.status === 204) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8 * 1024 * 1024) throw prototypeMaturityError("provider_response_large", "Provider response exceeded the Prototype Maturity limit.", 502);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw prototypeMaturityError("provider_response_invalid", "Provider response is not valid JSON.", 502); }
  }

  async function assertIdentity() {
    const installation = await request("/installation/repositories?per_page=2");
    const repositories = installation.repositories;
    if (installation.total_count !== 1 || repositories?.length !== 1 ||
        String(repositories[0].id) !== String(repositoryId) || repositories[0].full_name !== `${owner}/${repository}`) {
      throw prototypeMaturityError("credential_scope_invalid", "The installation token must be restricted to the exact Prototype Studio repository.", 403);
    }
  }

  async function mainRevision() {
    await assertIdentity();
    const body = await request(`${prefix}/git/ref/heads/main`);
    if (!SHA.test(body.object?.sha)) throw prototypeMaturityError("source_invalid", "Provider did not return an exact Prototype Studio main revision.", 502);
    return body.object.sha;
  }

  async function review(number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw prototypeMaturityError("review_invalid", "Invalid Prototype Maturity review identity.");
    await assertIdentity();
    const value = await request(`${prefix}/pulls/${number}`);
    if (String(value.base?.repo?.id) !== String(repositoryId) || String(value.head?.repo?.id) !== String(repositoryId) ||
        value.base?.ref !== "main" || !BRANCH.test(value.head?.ref) || !SHA.test(value.head?.sha)) {
      throw prototypeMaturityError("review_source_invalid", "Review is not for the exact Prototype Studio boundary.");
    }
    const commit = await request(`${prefix}/git/commits/${value.head.sha}`);
    if (commit.parents?.length !== 1) throw prototypeMaturityError("review_history_invalid", "Prototype Maturity source must preserve one exact parent.");
    let humanReviewed = false;
    if (value.merged) {
      const reviews = await request(`${prefix}/pulls/${number}/reviews?per_page=100`);
      if (!Array.isArray(reviews) || reviews.length >= 100) throw prototypeMaturityError("review_evidence_incomplete", "Review history exceeds the bounded Prototype Maturity proof.");
      const latest = new Map();
      for (const entry of reviews) {
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(entry.state)) latest.set(entry.user?.id, entry);
      }
      humanReviewed = [...latest.values()].some((entry) => entry.state === "APPROVED" && entry.commit_id === value.head.sha && entry.user?.type === "User") &&
        ![...latest.values()].some((entry) => entry.state === "CHANGES_REQUESTED") && value.merged_by?.type === "User";
    }
    return {
      repository,
      number,
      url: value.html_url,
      state: value.state,
      branch: value.head.ref,
      base_branch: value.base.ref,
      base_commit: commit.parents[0].sha,
      head_commit: value.head.sha,
      merged: value.merged === true,
      merge_commit: value.merge_commit_sha ?? null,
      human_reviewed: humanReviewed,
    };
  }

  async function findReview(branch) {
    if (!BRANCH.test(branch)) throw prototypeMaturityError("branch_invalid", "Invalid Prototype Maturity branch.");
    await assertIdentity();
    const values = await request(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=main&per_page=2`);
    if (values.length > 1) throw prototypeMaturityError("review_ambiguous", "Multiple reviews exist for this Prototype Maturity request.");
    return values.length ? review(values[0].number) : null;
  }

  async function contentAt(file, revision) {
    const value = await request(`${prefix}/contents/${encodePath(file.path)}?ref=${revision}`);
    if (value.encoding !== "base64") throw prototypeMaturityError("readback_invalid", `Canonical content could not be read for ${file.path}.`, 502);
    return Buffer.from(value.content.replace(/\s/g, ""), "base64");
  }

  async function checkPreparedHead(head, preparation) {
    const commit = await request(`${prefix}/git/commits/${head}`);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== preparation.base_commit) {
      throw prototypeMaturityError("branch_conflict", "Existing Prototype Maturity branch has a different parent.");
    }
    const comparison = await request(`${prefix}/compare/${preparation.base_commit}...${head}`);
    const actualPaths = (comparison.files ?? []).map((file) => file.filename).sort();
    const expectedPaths = preparation.files.map((file) => file.path).sort();
    if (comparison.total_commits !== 1 || JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      throw prototypeMaturityError("branch_conflict", "Prototype Maturity branch includes unexpected source changes.");
    }
    for (const file of preparation.files) {
      const actual = await contentAt(file, head);
      if (!actual.equals(Buffer.from(file.content_base64, "base64"))) {
        throw prototypeMaturityError("branch_conflict", `Prototype Maturity branch content differs for ${file.path}.`);
      }
    }
  }

  async function assertValidatedMerge(value) {
    if (!value.merged || !value.human_reviewed || !SHA.test(value.merge_commit)) {
      throw prototypeMaturityError("merge_unproven", "Prototype Maturity requires an exact-head human-reviewed merge.");
    }
    const checks = await request(`${prefix}/commits/${value.head_commit}/check-runs?per_page=100`);
    if (!checks.total_count || checks.total_count > 100 || checks.check_runs?.length !== checks.total_count ||
        !checks.check_runs.some((check) => check.conclusion === "success") ||
        checks.check_runs.some((check) => check.head_sha !== value.head_commit || check.status !== "completed" || !["success", "skipped", "neutral"].includes(check.conclusion))) {
      throw prototypeMaturityError("validation_unproven", "Exact-head Prototype Studio validation has not completed successfully.");
    }
    const comparison = await request(`${prefix}/compare/${value.merge_commit}...main`);
    if (!["ahead", "identical"].includes(comparison.status)) throw prototypeMaturityError("merge_not_canonical", "Merge is not in canonical Prototype Studio main history.");
  }

  return {
    mainRevision,
    review,
    findReview,
    async verifyPreparedReview(preparation, value) { await checkPreparedHead(value.head_commit, preparation); },
    async verifyPreparedBranch(preparation) {
      await assertIdentity();
      const value = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!value) return false;
      if (!SHA.test(value.object?.sha)) throw prototypeMaturityError("source_invalid", "Provider did not return an exact Prototype Maturity branch revision.", 502);
      await checkPreparedHead(value.object.sha, preparation);
      return true;
    },
    async prepareReview(preparation, { requestId, binding }) {
      if (!BRANCH.test(preparation.branch) || !SHA.test(preparation.base_commit)) throw prototypeMaturityError("preparation_invalid", "Invalid Prototype Maturity source preparation.");
      await assertIdentity();
      const existing = await findReview(preparation.branch);
      if (existing) {
        await checkPreparedHead(existing.head_commit, preparation);
        return existing;
      }
      let branch = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!branch) {
        if (await mainRevision() !== preparation.base_commit) throw prototypeMaturityError("authority_stale", "Prototype Studio changed before publication; submit a fresh maturity request.");
        const base = await request(`${prefix}/git/commits/${preparation.base_commit}`);
        const treeEntries = [];
        for (const file of preparation.files) {
          const blob = await request(`${prefix}/git/blobs`, { method: "POST", body: { content: file.content_base64, encoding: "base64" } });
          treeEntries.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
        }
        const tree = await request(`${prefix}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: treeEntries } });
        const commit = await request(`${prefix}/git/commits`, { method: "POST", body: {
          message: `Promote Prototype: ${requestId}\n\nOOS binding: ${binding}`,
          tree: tree.sha,
          parents: [preparation.base_commit],
        } });
        branch = await request(`${prefix}/git/refs`, { method: "POST", body: { ref: `refs/heads/${preparation.branch}`, sha: commit.sha } });
      }
      await checkPreparedHead(branch.object.sha, preparation);
      const created = await request(`${prefix}/pulls`, { method: "POST", body: {
        title: `Promote Prototype: ${requestId}`,
        head: preparation.branch,
        base: "main",
        body: `OOS Prototype Maturity request: ${requestId}\n\nBinding: ${binding}\n\nReview this exact head and owner validation before human merge. Maturity approval does not grant Delivery, runtime, Security, or publication authority.`,
      } });
      return review(created.number);
    },
    async verifyMergedFiles(value, preparation) {
      await assertIdentity();
      await assertValidatedMerge(value);
      for (const file of preparation.files) {
        const actual = await contentAt(file, value.merge_commit);
        if (!actual.equals(Buffer.from(file.content_base64, "base64"))) {
          throw prototypeMaturityError("merged_readback_mismatch", `Merged authority differs from the reviewed source for ${file.path}.`);
        }
      }
    },
    async closeReview(value) {
      await assertIdentity();
      await request(`${prefix}/pulls/${value.number}`, { method: "PATCH", body: { state: "closed" } });
    },
  };
}
