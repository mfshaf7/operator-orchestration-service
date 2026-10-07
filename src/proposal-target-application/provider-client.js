import { readFile } from "node:fs/promises";
import { proposalTargetError } from "./contracts.js";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^proposal-target\/[0-9a-f]{64}$/;
const encodePath = (value) => value.split("/").map(encodeURIComponent).join("/");

export function createProposalTargetGitHubClient({ owner, repositoryId, tokenFile, apiBaseUrl = "https://api.github.com", sandbox = false, fetchImpl = globalThis.fetch }) {
  const endpoint = new URL(apiBaseUrl);
  if (apiBaseUrl !== "https://api.github.com" && !(sandbox && endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) {
    throw proposalTargetError("provider_destination_invalid", "Proposal target provider destination is not admitted.", 503);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^\d+$/.test(String(repositoryId))) {
    throw proposalTargetError("provider_identity_invalid", "Configure the exact Prototype Studio repository identity.", 503);
  }
  const repository = "workspace-prototype-studio";
  const prefix = `/repos/${owner}/${repository}`;

  async function request(route, { method = "GET", body, absent = false } = {}) {
    let token;
    try { token = (await readFile(tokenFile, "utf8")).trim(); }
    catch { throw proposalTargetError("credential_unavailable", "The Platform-issued Proposal target credential is unavailable.", 503); }
    if (!token.startsWith("ghs_")) throw proposalTargetError("credential_invalid", "Proposal target application requires a Platform-issued installation token.", 503);
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${route}`, {
        method, redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw proposalTargetError("provider_unavailable", "The Proposal target source provider is unavailable.", 503); }
    if (response.status === 404 && absent) return null;
    if (!response.ok) throw proposalTargetError("provider_rejected", "The source provider did not accept the Proposal target operation.", response.status >= 500 || response.status === 429 ? 503 : 409);
    if (response.status === 204) return null;
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 2 * 1024 * 1024) throw proposalTargetError("provider_response_large", "Provider response exceeded the Proposal target limit.", 502);
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw proposalTargetError("provider_response_invalid", "Provider response is not valid JSON.", 502); }
  }

  async function assertIdentity() {
    const installation = await request("/installation/repositories?per_page=2");
    if (installation.total_count !== 1 || installation.repositories?.length !== 1 ||
        String(installation.repositories[0].id) !== String(repositoryId) || installation.repositories[0].full_name !== `${owner}/${repository}`) {
      throw proposalTargetError("credential_scope_invalid", "The installation token must be restricted to the exact Prototype Studio repository.", 403);
    }
  }

  async function mainRevision() {
    await assertIdentity();
    const value = await request(`${prefix}/git/ref/heads/main`);
    if (!SHA.test(value.object?.sha)) throw proposalTargetError("source_invalid", "Provider did not return an exact Prototype Studio main revision.", 502);
    return value.object.sha;
  }

  async function review(number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw proposalTargetError("review_invalid", "Invalid Proposal target review identity.");
    await assertIdentity();
    const value = await request(`${prefix}/pulls/${number}`);
    if (String(value.base?.repo?.id) !== String(repositoryId) || String(value.head?.repo?.id) !== String(repositoryId) || value.base?.ref !== "main" || !BRANCH.test(value.head?.ref) || !SHA.test(value.head?.sha)) {
      throw proposalTargetError("review_source_invalid", "Review is not for the exact Proposal target boundary.");
    }
    const commit = await request(`${prefix}/git/commits/${value.head.sha}`);
    if (commit.parents?.length !== 1) throw proposalTargetError("review_history_invalid", "Proposal target source must preserve one exact parent.");
    let humanReviewed = false;
    if (value.merged) {
      const reviews = await request(`${prefix}/pulls/${number}/reviews?per_page=100`);
      if (!Array.isArray(reviews) || reviews.length >= 100) throw proposalTargetError("review_evidence_incomplete", "Review history exceeds the bounded Proposal target proof.");
      const latest = new Map();
      for (const entry of reviews) if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(entry.state)) latest.set(entry.user?.id, entry);
      humanReviewed = [...latest.values()].some((entry) => entry.state === "APPROVED" && entry.commit_id === value.head.sha && entry.user?.type === "User") &&
        ![...latest.values()].some((entry) => entry.state === "CHANGES_REQUESTED") && value.merged_by?.type === "User";
    }
    return { repository, number, url: value.html_url, state: value.state, branch: value.head.ref, base_branch: value.base.ref, base_commit: commit.parents[0].sha, head_commit: value.head.sha, merged: value.merged === true, merge_commit: value.merge_commit_sha ?? null, human_reviewed: humanReviewed };
  }

  async function findReview(branch) {
    if (!BRANCH.test(branch)) throw proposalTargetError("branch_invalid", "Invalid Proposal target branch.");
    await assertIdentity();
    const values = await request(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=main&per_page=2`);
    if (values.length > 1) throw proposalTargetError("review_ambiguous", "Multiple reviews exist for this Proposal target application.");
    return values.length ? review(values[0].number) : null;
  }

  async function contentAt(file, revision) {
    const value = await request(`${prefix}/contents/${encodePath(file.path)}?ref=${revision}`);
    if (value.encoding !== "base64") throw proposalTargetError("readback_invalid", `Canonical content could not be read for ${file.path}.`, 502);
    return Buffer.from(value.content.replace(/\s/g, ""), "base64");
  }

  async function checkPreparedHead(head, preparation) {
    const commit = await request(`${prefix}/git/commits/${head}`);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== preparation.base_commit) throw proposalTargetError("branch_conflict", "Existing Proposal target branch has a different parent.");
    const comparison = await request(`${prefix}/compare/${preparation.base_commit}...${head}`);
    const actual = (comparison.files ?? []).map((file) => file.filename).sort();
    const expected = preparation.files.map((file) => file.path).sort();
    if (comparison.total_commits !== 1 || JSON.stringify(actual) !== JSON.stringify(expected)) throw proposalTargetError("branch_conflict", "Proposal target branch includes unexpected source changes.");
    for (const file of preparation.files) if (!(await contentAt(file, head)).equals(Buffer.from(file.content_base64, "base64"))) throw proposalTargetError("branch_conflict", `Proposal target branch content differs for ${file.path}.`);
  }

  async function assertValidatedMerge(value) {
    if (!value.merged || !value.human_reviewed || !SHA.test(value.merge_commit)) throw proposalTargetError("merge_unproven", "Proposal target application requires an exact-head human-reviewed merge.");
    const checks = await request(`${prefix}/commits/${value.head_commit}/check-runs?per_page=100`);
    if (!checks.total_count || checks.total_count > 100 || checks.check_runs?.length !== checks.total_count || !checks.check_runs.some((check) => check.conclusion === "success") || checks.check_runs.some((check) => check.head_sha !== value.head_commit || check.status !== "completed" || !["success", "skipped", "neutral"].includes(check.conclusion))) {
      throw proposalTargetError("validation_unproven", "Exact-head Prototype Studio validation has not completed successfully.");
    }
    const comparison = await request(`${prefix}/compare/${value.merge_commit}...main`);
    if (!["ahead", "identical"].includes(comparison.status)) throw proposalTargetError("merge_not_canonical", "Merge is not in canonical Prototype Studio main history.");
  }

  return {
    mainRevision, review, findReview,
    async verifyPreparedReview(preparation, value) { await checkPreparedHead(value.head_commit, preparation); },
    async verifyPreparedBranch(preparation) {
      await assertIdentity(); const value = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!value) return false; if (!SHA.test(value.object?.sha)) throw proposalTargetError("source_invalid", "Provider did not return an exact Proposal target branch revision.", 502);
      await checkPreparedHead(value.object.sha, preparation); return true;
    },
    async prepareReview(preparation, { applicationId, binding }) {
      if (!BRANCH.test(preparation.branch) || !SHA.test(preparation.base_commit)) throw proposalTargetError("preparation_invalid", "Invalid Proposal target source preparation.");
      await assertIdentity();
      const existing = await findReview(preparation.branch); if (existing) { await checkPreparedHead(existing.head_commit, preparation); return existing; }
      let branch = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!branch) {
        if (await mainRevision() !== preparation.base_commit) throw proposalTargetError("authority_stale", "Prototype Studio changed before publication; submit a fresh application.");
        const base = await request(`${prefix}/git/commits/${preparation.base_commit}`); const entries = [];
        for (const file of preparation.files) {
          const blob = await request(`${prefix}/git/blobs`, { method: "POST", body: { content: file.content_base64, encoding: "base64" } });
          entries.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
        }
        const tree = await request(`${prefix}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: entries } });
        const commit = await request(`${prefix}/git/commits`, { method: "POST", body: { message: `Capture Proposal target: ${applicationId}\n\nOOS binding: ${binding}`, tree: tree.sha, parents: [preparation.base_commit] } });
        branch = await request(`${prefix}/git/refs`, { method: "POST", body: { ref: `refs/heads/${preparation.branch}`, sha: commit.sha } });
      }
      await checkPreparedHead(branch.object.sha, preparation);
      const created = await request(`${prefix}/pulls`, { method: "POST", body: { title: `Capture Proposal target: ${applicationId}`, head: preparation.branch, base: "main", body: `OOS Proposal target application: ${applicationId}\n\nBinding: ${binding}\n\nReview this exact head and owner validation before human merge. This capture does not run Prototype Landing or activate runtime.` } });
      return review(created.number);
    },
    async verifyMergedFiles(value, preparation) {
      await assertIdentity(); await assertValidatedMerge(value);
      for (const file of preparation.files) if (!(await contentAt(file, value.merge_commit)).equals(Buffer.from(file.content_base64, "base64"))) throw proposalTargetError("merged_readback_mismatch", `Merged authority differs from the reviewed source for ${file.path}.`);
    },
    async closeReview(value) { await assertIdentity(); await request(`${prefix}/pulls/${value.number}`, { method: "PATCH", body: { state: "closed" } }); },
  };
}
