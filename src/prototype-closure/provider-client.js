import { readFile } from "node:fs/promises";
import { closureError } from "./contracts.js";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^prototype-closure\/[0-9a-f]{64}$/;
const DELEGATED_APPROVAL = "prototype-closure-delegated-approval";

function approvalAttestation(entry, pullRequest, owner) {
  if (entry.state !== "APPROVED" || entry.commit_id !== pullRequest.head.sha ||
      entry.user?.type !== "User" || entry.user?.login !== owner ||
      entry.user?.id === pullRequest.user?.id || !Number.isSafeInteger(entry.id) || entry.id <= 0) return null;
  let body;
  try { body = JSON.parse(entry.body); } catch { return null; }
  if (body?.schema_version !== 1 || body?.artifact_type !== DELEGATED_APPROVAL ||
      body.pull_request_number !== pullRequest.number || body.head_commit !== pullRequest.head.sha ||
      body.operator_login !== owner || body.operator_decision !== "approved-in-conversation" ||
      body.executed_by !== "agent-gary") return null;
  return {
    review_ref: `${pullRequest.html_url}#pullrequestreview-${entry.id}`,
    head_commit: pullRequest.head.sha,
    reviewer_login: owner,
    execution: "agent-gary-delegated",
  };
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

export function createPrototypeClosureGitHubClient({ owner, repositoryId, tokenFile, apiBaseUrl = "https://api.github.com", sandbox = false, fetchImpl = globalThis.fetch }) {
  const endpoint = new URL(apiBaseUrl);
  if (apiBaseUrl !== "https://api.github.com" && !(sandbox && endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) {
    throw closureError("provider_destination_invalid", "Prototype Closure provider destination is not admitted.", 503);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^\d+$/.test(String(repositoryId))) {
    throw closureError("provider_identity_invalid", "Configure the exact Prototype Studio repository identity.", 503);
  }
  const repository = "workspace-prototype-studio";
  const prefix = `/repos/${owner}/${repository}`;

  async function request(route, { method = "GET", body, absent = false } = {}) {
    let token;
    try { token = (await readFile(tokenFile, "utf8")).trim(); }
    catch { throw closureError("credential_unavailable", "The Platform-issued Prototype Closure credential is unavailable.", 503); }
    if (!token.startsWith("ghs_")) throw closureError("credential_invalid", "Prototype Closure requires a Platform-issued installation token.", 503);
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
      throw closureError("provider_unavailable", "The Prototype Closure source provider is unavailable.", 503);
    }
    if (response.status === 404 && absent) return null;
    if (!response.ok) {
      throw closureError("provider_rejected", "The source provider did not accept the Prototype Closure operation.", response.status >= 500 || response.status === 429 ? 503 : 409);
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
        if (size > 8 * 1024 * 1024) throw closureError("provider_response_large", "Provider response exceeded the Prototype Closure limit.", 502);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw closureError("provider_response_invalid", "Provider response is not valid JSON.", 502); }
  }

  async function assertIdentity() {
    const installation = await request("/installation/repositories?per_page=2");
    const repositories = installation.repositories;
    if (installation.total_count !== 1 || repositories?.length !== 1 ||
        String(repositories[0].id) !== String(repositoryId) || repositories[0].full_name !== `${owner}/${repository}`) {
      throw closureError("credential_scope_invalid", "The installation token must be restricted to the exact Prototype Studio repository.", 403);
    }
  }

  async function mainRevision() {
    await assertIdentity();
    const body = await request(`${prefix}/git/ref/heads/main`);
    if (!SHA.test(body.object?.sha)) throw closureError("source_invalid", "Provider did not return an exact Prototype Studio main revision.", 502);
    return body.object.sha;
  }

  async function review(number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw closureError("review_invalid", "Invalid Prototype Closure review identity.");
    await assertIdentity();
    const value = await request(`${prefix}/pulls/${number}`);
    if (String(value.base?.repo?.id) !== String(repositoryId) || String(value.head?.repo?.id) !== String(repositoryId) ||
        value.base?.ref !== "main" || !BRANCH.test(value.head?.ref) || !SHA.test(value.head?.sha)) {
      throw closureError("review_source_invalid", "Review is not for the exact Prototype Studio boundary.");
    }
    const commit = await request(`${prefix}/git/commits/${value.head.sha}`);
    if (commit.parents?.length !== 1) throw closureError("review_history_invalid", "Prototype Closure source must preserve one exact parent.");
    let delegatedApproval = null;
    if (value.merged) {
      const reviews = await request(`${prefix}/pulls/${number}/reviews?per_page=100`);
      if (!Array.isArray(reviews) || reviews.length >= 100) throw closureError("review_evidence_incomplete", "Review history exceeds the bounded Prototype Closure proof.");
      const latest = new Map();
      for (const entry of reviews) {
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(entry.state)) latest.set(entry.user?.id, entry);
      }
      if (![...latest.values()].some((entry) => entry.state === "CHANGES_REQUESTED")) {
        delegatedApproval = [...latest.values()].map((entry) => approvalAttestation(entry, value, owner)).find(Boolean) ?? null;
      }
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
      merge_commit: value.merged === true ? value.merge_commit_sha ?? null : null,
      delegated_approval: delegatedApproval,
    };
  }

  async function findReview(branch) {
    if (!BRANCH.test(branch)) throw closureError("branch_invalid", "Invalid Prototype Closure branch.");
    await assertIdentity();
    const values = await request(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=main&per_page=2`);
    if (values.length > 1) throw closureError("review_ambiguous", "Multiple reviews exist for this Prototype Closure request.");
    return values.length ? review(values[0].number) : null;
  }

  async function contentAt(file, revision) {
    const value = await request(`${prefix}/contents/${encodePath(file.path)}?ref=${revision}`);
    if (value.encoding !== "base64") throw closureError("readback_invalid", `Canonical content could not be read for ${file.path}.`, 502);
    return Buffer.from(value.content.replace(/\s/g, ""), "base64");
  }

  async function checkPreparedHead(head, preparation) {
    const commit = await request(`${prefix}/git/commits/${head}`);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== preparation.base_commit) {
      throw closureError("branch_conflict", "Existing Prototype Closure branch has a different parent.");
    }
    const comparison = await request(`${prefix}/compare/${preparation.base_commit}...${head}`);
    const actualPaths = (comparison.files ?? []).map((file) => file.filename).sort();
    const expectedPaths = preparation.files.map((file) => file.path).sort();
    if (comparison.total_commits !== 1 || JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      throw closureError("branch_conflict", "Prototype Closure branch includes unexpected source changes.");
    }
    for (const file of preparation.files) {
      const actual = await contentAt(file, head);
      if (!actual.equals(Buffer.from(file.content_base64, "base64"))) {
        throw closureError("branch_conflict", `Prototype Closure branch content differs for ${file.path}.`);
      }
    }
  }

  async function assertValidatedMerge(value) {
    if (!value.merged || value.delegated_approval?.head_commit !== value.head_commit ||
        !value.delegated_approval?.review_ref ||
        !SHA.test(value.merge_commit)) {
      throw closureError("merge_unproven", "Prototype Closure requires an exact-head delegated approval record.");
    }
    const checks = await request(`${prefix}/commits/${value.head_commit}/check-runs?per_page=100`);
    if (!checks.total_count || checks.total_count > 100 || checks.check_runs?.length !== checks.total_count ||
        !checks.check_runs.some((check) => check.name === "validate" && check.conclusion === "success" && check.head_sha === value.head_commit) ||
        checks.check_runs.some((check) => check.head_sha !== value.head_commit || check.status !== "completed" || !["success", "skipped", "neutral"].includes(check.conclusion))) {
      throw closureError("validation_unproven", "Exact-head Prototype Studio validation has not completed successfully.");
    }
    const comparison = await request(`${prefix}/compare/${value.merge_commit}...main`);
    if (!["ahead", "identical"].includes(comparison.status)) throw closureError("merge_not_canonical", "Merge is not in canonical Prototype Studio main history.");
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
      if (!SHA.test(value.object?.sha)) throw closureError("source_invalid", "Provider did not return an exact Prototype Closure branch revision.", 502);
      await checkPreparedHead(value.object.sha, preparation);
      return true;
    },
    async prepareReview(preparation, { requestId, binding }) {
      if (!BRANCH.test(preparation.branch) || !SHA.test(preparation.base_commit)) throw closureError("preparation_invalid", "Invalid Prototype Closure source preparation.");
      await assertIdentity();
      const existing = await findReview(preparation.branch);
      if (existing) {
        await checkPreparedHead(existing.head_commit, preparation);
        return existing;
      }
      let branch = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
      if (!branch) {
        if (await mainRevision() !== preparation.base_commit) throw closureError("authority_stale", "Prototype Studio changed before publication; submit a fresh closure request.");
        const base = await request(`${prefix}/git/commits/${preparation.base_commit}`);
        const treeEntries = [];
        for (const file of preparation.files) {
          const blob = await request(`${prefix}/git/blobs`, { method: "POST", body: { content: file.content_base64, encoding: "base64" } });
          treeEntries.push({ path: file.path, mode: file.mode, type: "blob", sha: blob.sha });
        }
        const tree = await request(`${prefix}/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree: treeEntries } });
        const commit = await request(`${prefix}/git/commits`, { method: "POST", body: {
          message: `Transition Prototype: ${requestId}\n\nOOS binding: ${binding}`,
          tree: tree.sha,
          parents: [preparation.base_commit],
        } });
        branch = await request(`${prefix}/git/refs`, { method: "POST", body: { ref: `refs/heads/${preparation.branch}`, sha: commit.sha } });
      }
      await checkPreparedHead(branch.object.sha, preparation);
      const created = await request(`${prefix}/pulls`, { method: "POST", body: {
        title: `Transition Prototype: ${requestId}`,
        head: preparation.branch,
        base: "main",
        body: `OOS Prototype Closure request: ${requestId}\n\nBinding: ${binding}\n\nOperator authorization of this exact PR and head is required before delegated approval and merge. Closure approval does not grant Delivery, runtime, Security, or publication authority.`,
      } });
      return review(created.number);
    },
    async verifyMergedFiles(value, preparation) {
      await assertIdentity();
      await assertValidatedMerge(value);
      for (const file of preparation.files) {
        const actual = await contentAt(file, value.merge_commit);
        if (!actual.equals(Buffer.from(file.content_base64, "base64"))) {
          throw closureError("merged_readback_mismatch", `Merged authority differs from the reviewed source for ${file.path}.`);
        }
      }
    },
    async closeReview(value) {
      await assertIdentity();
      await request(`${prefix}/pulls/${value.number}`, { method: "PATCH", body: { state: "closed" } });
    },
  };
}
