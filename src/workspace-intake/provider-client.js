import { readFile } from "node:fs/promises";
import { intakeError } from "./contracts.js";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^intake\/[0-9a-f]{64}$/;
const REGISTER = "contracts/intake-register.yaml";

export function createWorkspaceIntakeGitHubClient({ owner, repositoryId, tokenFile, apiBaseUrl = "https://api.github.com", sandbox = false, fetchImpl = globalThis.fetch }) {
  const url = new URL(apiBaseUrl);
  if (apiBaseUrl !== "https://api.github.com" && !(sandbox && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw intakeError("provider_destination_invalid", "Intake provider destination is not admitted.", 503);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^\d+$/.test(String(repositoryId))) throw intakeError("provider_identity_invalid", "Configure the exact authority repository identity.", 503);
  const prefix = `/repos/${owner}/workspace-governance`;
  async function request(route, { method = "GET", body, absent = false } = {}) {
    let token;
    try { token = (await readFile(tokenFile, "utf8")).trim(); } catch { throw intakeError("credential_unavailable", "The Platform-issued intake credential is unavailable.", 503); }
    if (!token.startsWith("ghs_")) throw intakeError("credential_invalid", "Intake requires a Platform-issued installation token.", 503);
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${route}`, {
        method, redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw intakeError("provider_unavailable", "The intake source provider is unavailable.", 503); }
    if (response.status === 404 && absent) return null;
    if (!response.ok) throw intakeError("provider_rejected", "The source provider did not accept the intake operation.", response.status >= 500 || response.status === 429 ? 503 : 409);
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 4194304) throw intakeError("provider_response_large", "Provider response exceeded the intake limit.", 502);
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw intakeError("provider_response_invalid", "Provider response is not valid JSON.", 502); }
  }
  async function assertIdentity() {
    const installation = await request("/installation/repositories?per_page=2");
    const repositories = installation.repositories;
    if (installation.total_count !== 1 || repositories?.length !== 1 || String(repositories[0].id) !== String(repositoryId) || repositories[0].full_name !== `${owner}/workspace-governance`) {
      throw intakeError("credential_scope_invalid", "The installation token must be restricted to the exact Workspace Governance repository.", 403);
    }
  }
  async function mainRevision() {
    await assertIdentity();
    const body = await request(`${prefix}/git/ref/heads/main`);
    if (!SHA.test(body.object?.sha)) throw intakeError("source_invalid", "Provider did not return an exact main revision.", 502);
    return body.object.sha;
  }
  async function review(number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw intakeError("review_invalid", "Invalid review identity.");
    await assertIdentity();
    const value = await request(`${prefix}/pulls/${number}`);
    if (String(value.base?.repo?.id) !== String(repositoryId) || String(value.head?.repo?.id) !== String(repositoryId) || value.base?.ref !== "main" || !BRANCH.test(value.head?.ref) || !SHA.test(value.head?.sha)) {
      throw intakeError("review_source_invalid", "Review is not for the exact intake source boundary.");
    }
    const commits = await request(`${prefix}/git/commits/${value.head.sha}`);
    if (commits.parents?.length !== 1) throw intakeError("review_history_invalid", "Intake source must preserve one exact parent.");
    let humanReviewed = false;
    if (value.merged) {
      const reviews = await request(`${prefix}/pulls/${number}/reviews?per_page=100`);
      if (!Array.isArray(reviews) || reviews.length >= 100) throw intakeError("review_evidence_incomplete", "Review history exceeds the bounded intake proof; operator review is required.");
      const latest = new Map();
      for (const entry of reviews) {
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(entry.state)) latest.set(entry.user?.id, entry);
      }
      humanReviewed = [...latest.values()].some((entry) => entry.state === "APPROVED" && entry.commit_id === value.head.sha && entry.user?.type === "User") &&
        ![...latest.values()].some((entry) => entry.state === "CHANGES_REQUESTED") && value.merged_by?.type === "User";
    }
    return { repository: "workspace-governance", number, url: value.html_url, state: value.state, branch: value.head.ref,
      base_branch: value.base.ref, base_commit: commits.parents[0].sha, head_commit: value.head.sha,
      merged: value.merged === true, merge_commit: value.merge_commit_sha ?? null, human_reviewed: humanReviewed };
  }
  async function findReview(branch) {
    if (!BRANCH.test(branch)) throw intakeError("branch_invalid", "Invalid intake branch.");
    await assertIdentity();
    const results = await request(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=main&per_page=2`);
    if (results.length > 1) throw intakeError("review_ambiguous", "Multiple reviews exist for this intake request.");
    return results.length ? review(results[0].number) : null;
  }
  async function checkPreparedHead(head, preparation) {
    const commit = await request(`${prefix}/git/commits/${head}`);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== preparation.base_commit) throw intakeError("branch_conflict", "Existing intake branch has a different parent.");
    const comparison = await request(`${prefix}/compare/${preparation.base_commit}...${head}`);
    if (comparison.files?.length !== 1 || comparison.files[0].filename !== REGISTER || comparison.total_commits !== 1) throw intakeError("branch_conflict", "Intake branch includes unexpected changes.");
    const content = await request(`${prefix}/contents/${REGISTER}?ref=${head}`);
    if (content.encoding !== "base64" || Buffer.from(content.content, "base64").toString("utf8") !== preparation.register_text) throw intakeError("branch_conflict", "Existing intake branch content differs from the approved preparation.");
  }
  return {
    mainRevision, review, findReview,
    async verifyPreparedReview(preparation, value) { await checkPreparedHead(value.head_commit, preparation); },
    async prepareReview(preparation, { requestId, binding }) {
      if (!BRANCH.test(preparation.branch) || !SHA.test(preparation.base_commit)) throw intakeError("preparation_invalid", "Invalid source preparation.");
      await assertIdentity();
      const existing = await findReview(preparation.branch);
      if (existing) { await checkPreparedHead(existing.head_commit, preparation); return existing; }
      let branch = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!branch) {
        if (await mainRevision() !== preparation.base_commit) throw intakeError("authority_stale", "Authority changed before publication; submit a new request.");
        const base = await request(`${prefix}/git/commits/${preparation.base_commit}`);
        const blob = await request(`${prefix}/git/blobs`, { method: "POST", body: { content: preparation.register_text, encoding: "utf-8" } });
        const tree = await request(`${prefix}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: [{ path: REGISTER, mode: "100644", type: "blob", sha: blob.sha }] } });
        const commit = await request(`${prefix}/git/commits`, { method: "POST", body: { message: `Classify intake ${requestId}\n\nOOS binding: ${binding}`, tree: tree.sha, parents: [preparation.base_commit] } });
        // A lost acknowledgement can leave a valid ref. Retry reads it before
        // considering any new write; never force-update an existing ref.
        branch = await request(`${prefix}/git/refs`, { method: "POST", body: { ref: `refs/heads/${preparation.branch}`, sha: commit.sha } });
      }
      await checkPreparedHead(branch.object.sha, preparation);
      const created = await request(`${prefix}/pulls`, { method: "POST", body: { title: `Classify workspace entrant: ${requestId}`, head: preparation.branch, base: "main", body: `OOS intake request: ${requestId}\n\nBinding: ${binding}\n\nReview this exact head and owner validation before human merge. Intake does not activate runtime or promote active inventory.` } });
      return review(created.number);
    },
    async readMergedRegister(value) {
      await assertIdentity();
      if (!value.merged || !value.human_reviewed || !SHA.test(value.merge_commit)) throw intakeError("merge_unproven", "A reviewed canonical merge is required.");
      const checks = await request(`${prefix}/commits/${value.head_commit}/check-runs?per_page=100`);
      if (!checks.total_count || checks.total_count > 100 || checks.check_runs?.length !== checks.total_count ||
          !checks.check_runs.some((check) => check.conclusion === "success") ||
          checks.check_runs.some((check) => check.head_sha !== value.head_commit || check.status !== "completed" || !["success", "skipped", "neutral"].includes(check.conclusion))) {
        throw intakeError("validation_unproven", "Exact-head source validation has not completed successfully.");
      }
      const comparison = await request(`${prefix}/compare/${value.merge_commit}...main`);
      if (!["ahead", "identical"].includes(comparison.status)) throw intakeError("merge_not_canonical", "Merge is not in canonical main history.");
      const content = await request(`${prefix}/contents/${REGISTER}?ref=${value.merge_commit}`);
      if (content.encoding !== "base64") throw intakeError("readback_invalid", "Canonical intake content could not be read.", 502);
      return Buffer.from(content.content, "base64").toString("utf8");
    },
    async closeReview(value) {
      await assertIdentity();
      await request(`${prefix}/pulls/${value.number}`, { method: "PATCH", body: { state: "closed" } });
    },
  };
}
