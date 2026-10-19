import { readFile } from "node:fs/promises";
import { inventoryError } from "./contracts.js";
import { inventorySourceFiles, inventorySourceDigest } from "./source-files.js";

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^(inventory|inventory-lifecycle)\/[0-9a-f]{64}$/;
const INTAKE_REGISTER = "contracts/intake-register.yaml";
const INVENTORY_HISTORY = "contracts/workspace-inventory-history.yaml";
const INVENTORY_PATHS = new Set([
  "contracts/repos.yaml",
  "contracts/products.yaml",
  "contracts/components.yaml",
]);

export function createWorkspaceInventoryGitHubClient({
  owner,
  repositoryId,
  tokenFile,
  apiBaseUrl = "https://api.github.com",
  sandbox = false,
  fetchImpl = globalThis.fetch,
}) {
  const url = new URL(apiBaseUrl);
  if (apiBaseUrl !== "https://api.github.com" && !(sandbox && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) {
    throw inventoryError("provider_destination_invalid", "Inventory provider destination is not admitted.", 503);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) || !/^\d+$/.test(String(repositoryId))) {
    throw inventoryError("provider_identity_invalid", "Configure the exact authority repository identity.", 503);
  }
  const prefix = `/repos/${owner}/workspace-governance`;

  async function request(route, { method = "GET", body, absent = false } = {}) {
    let token;
    try {
      token = (await readFile(tokenFile, "utf8")).trim();
    } catch {
      throw inventoryError("credential_unavailable", "The Platform-issued inventory credential is unavailable.", 503);
    }
    if (!token.startsWith("ghs_")) throw inventoryError("credential_invalid", "Inventory promotion requires a Platform-issued installation token.", 503);
    let response;
    try {
      response = await fetchImpl(`${apiBaseUrl}${route}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw inventoryError("provider_unavailable", "The inventory source provider is unavailable.", 503);
    }
    if (response.status === 404 && absent) return null;
    if (!response.ok) {
      throw inventoryError("provider_rejected", "The source provider did not accept the inventory operation.", response.status >= 500 || response.status === 429 ? 503 : 409);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 4194304) throw inventoryError("provider_response_large", "Provider response exceeded the inventory limit.", 502);
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw inventoryError("provider_response_invalid", "Provider response is not valid JSON.", 502);
    }
  }

  async function assertIdentity() {
    const installation = await request("/installation/repositories?per_page=2");
    const repositories = installation.repositories;
    if (installation.total_count !== 1 || repositories?.length !== 1 ||
        String(repositories[0].id) !== String(repositoryId) ||
        repositories[0].full_name !== `${owner}/workspace-governance`) {
      throw inventoryError("credential_scope_invalid", "The installation token must be restricted to the exact Workspace Governance repository.", 403);
    }
  }

  async function mainRevision() {
    await assertIdentity();
    const body = await request(`${prefix}/git/ref/heads/main`);
    if (!SHA.test(body.object?.sha)) throw inventoryError("source_invalid", "Provider did not return an exact main revision.", 502);
    return body.object.sha;
  }

  async function review(number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw inventoryError("review_invalid", "Invalid review identity.");
    await assertIdentity();
    const value = await request(`${prefix}/pulls/${number}`);
    if (String(value.base?.repo?.id) !== String(repositoryId) || String(value.head?.repo?.id) !== String(repositoryId) ||
        value.base?.ref !== "main" || !BRANCH.test(value.head?.ref) || !SHA.test(value.head?.sha)) {
      throw inventoryError("review_source_invalid", "Review is not for the exact inventory source boundary.");
    }
    const commit = await request(`${prefix}/git/commits/${value.head.sha}`);
    if (commit.parents?.length !== 1) throw inventoryError("review_history_invalid", "Inventory source must preserve one exact parent.");
    let humanReviewed = false;
    if (value.merged) {
      const reviews = await request(`${prefix}/pulls/${number}/reviews?per_page=100`);
      if (!Array.isArray(reviews) || reviews.length >= 100) throw inventoryError("review_evidence_incomplete", "Review history exceeds the bounded inventory proof; operator review is required.");
      const latest = new Map();
      for (const entry of reviews) {
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(entry.state)) latest.set(entry.user?.id, entry);
      }
      humanReviewed = [...latest.values()].some((entry) => entry.state === "APPROVED" && entry.commit_id === value.head.sha && entry.user?.type === "User") &&
        ![...latest.values()].some((entry) => entry.state === "CHANGES_REQUESTED") && value.merged_by?.type === "User";
    }
    return {
      repository: "workspace-governance",
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
    if (!BRANCH.test(branch)) throw inventoryError("branch_invalid", "Invalid inventory branch.");
    await assertIdentity();
    const results = await request(`${prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=main&per_page=2`);
    if (results.length > 1) throw inventoryError("review_ambiguous", "Multiple reviews exist for this inventory request.");
    return results.length ? review(results[0].number) : null;
  }

  async function readContent(path, revision) {
    const content = await request(`${prefix}/contents/${path}?ref=${revision}`);
    if (content.encoding !== "base64") throw inventoryError("readback_invalid", "Canonical inventory content could not be read.", 502);
    return Buffer.from(content.content, "base64").toString("utf8");
  }

  async function checkFileModes(treeSha, files) {
    if (!SHA.test(treeSha)) throw inventoryError("source_tree_invalid", "Inventory source tree identity is invalid.");
    const tree = await request(`${prefix}/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 8192) {
      throw inventoryError("source_tree_invalid", "Inventory source tree proof is incomplete.");
    }
    for (const name of Object.keys(files)) {
      const entries = tree.tree.filter((entry) => entry.path === name);
      if (entries.length !== 1 || entries[0].mode !== "100644" || entries[0].type !== "blob" || !SHA.test(entries[0].sha)) {
        throw inventoryError("source_tree_invalid", "Inventory registration requires regular, non-executable source files.");
      }
    }
  }

  async function checkPreparedHead(head, preparation) {
    if (!INVENTORY_PATHS.has(preparation.inventory_path)) throw inventoryError("preparation_invalid", "Invalid active inventory path.");
    const lifecycle = typeof preparation.history_text === "string";
    if (lifecycle !== preparation.branch.startsWith("inventory-lifecycle/")) {
      throw inventoryError("preparation_invalid", "Inventory source preparation does not match its branch family.");
    }
    const commit = await request(`${prefix}/git/commits/${head}`);
    if (commit.parents?.length !== 1 || commit.parents[0].sha !== preparation.base_commit) {
      throw inventoryError("branch_conflict", "Existing inventory branch has a different parent.");
    }
    const comparison = await request(`${prefix}/compare/${preparation.base_commit}...${head}`);
    const files = comparison.files?.map((entry) => entry.filename).sort();
    const sourceFiles = inventorySourceFiles(preparation);
    const expected = Object.keys(sourceFiles).sort();
    if (comparison.total_commits !== 1 || JSON.stringify(files) !== JSON.stringify(expected)) {
      throw inventoryError("branch_conflict", "Inventory branch includes unexpected changes.");
    }
    await checkFileModes(commit.tree?.sha, sourceFiles);
    for (const [name, text] of Object.entries(sourceFiles)) {
      if (await readContent(name, head) !== text) {
        throw inventoryError("branch_conflict", "Existing inventory branch content differs from the complete approved preparation.");
      }
    }
  }

  async function prepareSourceReview(preparation, { requestId, binding, target, action = null }) {
    const lifecycle = action !== null;
    const expectedPrefix = lifecycle ? "inventory-lifecycle/" : "inventory/";
    if (!BRANCH.test(preparation.branch) || !preparation.branch.startsWith(expectedPrefix) ||
        !SHA.test(preparation.base_commit) || !INVENTORY_PATHS.has(preparation.inventory_path) ||
        (lifecycle && preparation.history_path !== INVENTORY_HISTORY)) {
      throw inventoryError("preparation_invalid", "Invalid inventory source preparation.");
    }
    const sourceFiles = inventorySourceFiles(preparation);
    if (preparation.source_files && preparation.content_digest !== inventorySourceDigest(preparation)) {
      throw inventoryError("preparation_invalid", "Inventory source preparation does not bind its complete file set.");
    }
    await assertIdentity();
    const existing = await findReview(preparation.branch);
    if (existing) {
      await checkPreparedHead(existing.head_commit, preparation);
      return existing;
    }
    let branch = await request(`${prefix}/git/ref/heads/${preparation.branch}`, { absent: true });
    if (!branch) {
      if (await mainRevision() !== preparation.base_commit) throw inventoryError("authority_stale", "Authority changed before publication; submit a new request.");
      const base = await request(`${prefix}/git/commits/${preparation.base_commit}`);
      const entries = [];
      for (const [name, text] of Object.entries(sourceFiles)) {
        const blob = await request(`${prefix}/git/blobs`, { method: "POST", body: { content: text, encoding: "utf-8" } });
        if (!SHA.test(blob.sha)) throw inventoryError("source_tree_invalid", "Provider did not return an exact source blob.");
        entries.push({ path: name, mode: "100644", type: "blob", sha: blob.sha });
      }
      const tree = await request(`${prefix}/git/trees`, {
        method: "POST",
        body: {
          base_tree: base.tree.sha,
          tree: entries,
        },
      });
      const verb = lifecycle ? `${action[0].toUpperCase()}${action.slice(1)}` : "Promote";
      const commit = await request(`${prefix}/git/commits`, {
        method: "POST",
        body: {
          message: `${verb} workspace inventory ${target.record_id}\n\nOOS request: ${requestId}\nOOS binding: ${binding}`,
          tree: tree.sha,
          parents: [preparation.base_commit],
        },
      });
      branch = await request(`${prefix}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${preparation.branch}`, sha: commit.sha },
      });
    }
    await checkPreparedHead(branch.object.sha, preparation);
    const created = await request(`${prefix}/pulls`, {
      method: "POST",
      body: {
        title: lifecycle
          ? `${action[0].toUpperCase()}${action.slice(1)} active inventory: ${target.record_id}`
          : `Promote active inventory: ${target.record_id}`,
        head: preparation.branch,
        base: "main",
        body: lifecycle
          ? `OOS inventory lifecycle request: ${requestId}\n\nBinding: ${binding}\n\nReview this exact head and owner validation before human merge. This ${action} changes one active inventory record and appends one canonical history event; it does not activate runtime or release authority.`
          : `OOS inventory request: ${requestId}\n\nBinding: ${binding}\n\nReview this exact head and owner validation before human merge. Promotion removes the admitted intake entry and adds one active inventory record; it does not activate runtime or release authority.`,
      },
    });
    return review(created.number);
  }

  async function readMergedSourceFiles(value, inventoryPath, companionPath, preparation) {
    await assertIdentity();
    if (!value.merged || !value.human_reviewed || !SHA.test(value.merge_commit) || !INVENTORY_PATHS.has(inventoryPath)) {
      throw inventoryError("merge_unproven", "A reviewed canonical inventory merge is required.");
    }
    const checks = await request(`${prefix}/commits/${value.head_commit}/check-runs?per_page=100`);
    if (!checks.total_count || checks.total_count > 100 || checks.check_runs?.length !== checks.total_count ||
        !checks.check_runs.some((check) => check.conclusion === "success") ||
        checks.check_runs.some((check) => check.head_sha !== value.head_commit || check.status !== "completed" || !["success", "skipped", "neutral"].includes(check.conclusion))) {
      throw inventoryError("validation_unproven", "Exact-head source validation has not completed successfully.");
    }
    const comparison = await request(`${prefix}/compare/${value.merge_commit}...main`);
    if (!["ahead", "identical"].includes(comparison.status)) throw inventoryError("merge_not_canonical", "Merge is not in canonical main history.");
    if (preparation?.source_files) {
      await checkPreparedHead(value.head_commit, preparation);
      const expected = inventorySourceFiles(preparation);
      const mergedCommit = await request(`${prefix}/git/commits/${value.merge_commit}`);
      await checkFileModes(mergedCommit.tree?.sha, expected);
      const sourceFiles = {};
      for (const [name, text] of Object.entries(expected)) {
        sourceFiles[name] = await readContent(name, value.merge_commit);
        if (sourceFiles[name] !== text) throw inventoryError("readback_invalid", "Merged source differs from its complete reviewed registration.");
      }
      return { companionText: sourceFiles[companionPath], inventoryText: sourceFiles[inventoryPath], sourceFiles };
    }
    const [companionText, inventoryText] = await Promise.all([
      readContent(companionPath, value.merge_commit),
      readContent(inventoryPath, value.merge_commit),
    ]);
    return { companionText, inventoryText };
  }

  return {
    mainRevision,
    review,
    findReview,
    async verifyPreparedReview(preparation, value) {
      await checkPreparedHead(value.head_commit, preparation);
    },
    async prepareReview(preparation, { requestId, binding, target }) {
      return prepareSourceReview(preparation, { requestId, binding, target });
    },
    async prepareLifecycleReview(preparation, { requestId, binding, target, action }) {
      return prepareSourceReview(preparation, { requestId, binding, target, action });
    },
    async readMergedFiles(value, inventoryPath, preparation) {
      const result = await readMergedSourceFiles(value, inventoryPath, INTAKE_REGISTER, preparation);
      return { intakeText: result.companionText, inventoryText: result.inventoryText, ...(result.sourceFiles ? { sourceFiles: result.sourceFiles } : {}) };
    },
    async readMergedLifecycleFiles(value, inventoryPath, preparation) {
      const result = await readMergedSourceFiles(value, inventoryPath, INVENTORY_HISTORY, preparation);
      return { historyText: result.companionText, inventoryText: result.inventoryText, ...(result.sourceFiles ? { sourceFiles: result.sourceFiles } : {}) };
    },
    async verifyPreparedLifecycleReview(preparation, value) {
      await checkPreparedHead(value.head_commit, preparation);
    },
    async closeReview(value) {
      await assertIdentity();
      await request(`${prefix}/pulls/${value.number}`, { method: "PATCH", body: { state: "closed" } });
    },
  };
}
