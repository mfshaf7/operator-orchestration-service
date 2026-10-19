import { createHash } from "node:crypto";
import { HttpError } from "../errors.js";
import { SOURCE_OWNER_BOOTSTRAP_PATHS } from "./scaffold.js";

const SHA = /^[0-9a-f]{40}$/;
const fail = message => { throw new HttpError(409, "repository_owner_bootstrap_source_unavailable", message); };

// Read-only public-source adapter for the currently qualified synthetic route.
// No credential, checkout, caller-selected URL, executable, or provider write.
// Private/client source requires separate qualification; never fall back to an
// ambient human token or silently make a private repository public.
export function createPublicBootstrapSourceReader({ fetchImpl = globalThis.fetch } = {}) {
  async function read(route, maxBytes) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${route}`, {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        fail("The exact public provider source is unavailable or exceeds its read bound.");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); fail("Provider source exceeds its bounded read."); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      fail("The exact public provider source could not be inspected safely.");
    }
  }
  function binding(value) {
    if (!value || Object.keys(value).sort().join(",") !== "full_name,provider,provider_repository_id" ||
        value.provider !== "github" || !/^[1-9][0-9]*$/.test(value.provider_repository_id ?? "") ||
        !Number.isSafeInteger(Number(value.provider_repository_id)) ||
        !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.full_name ?? "")) {
      fail("The proposed owner requires its exact canonical provider binding.");
    }
  }
  async function current(providerRepository) {
    binding(providerRepository);
    const repository = await read(`/repositories/${providerRepository.provider_repository_id}`, 262_144);
    if (String(repository.id) !== providerRepository.provider_repository_id || repository.full_name !== providerRepository.full_name ||
        repository.private !== false || repository.visibility !== "public" || repository.archived !== false || repository.disabled === true ||
        repository.default_branch !== "main") fail("Only the exact active public synthetic repository with main as its default branch is qualified.");
    const commit = await read(`/repos/${providerRepository.full_name}/commits/main`, 262_144);
    if (!SHA.test(commit.sha ?? "")) fail("The provider did not return an exact main commit.");
    return { repository, commit: commit.sha };
  }
  return {
    async inspect({ providerRepository, paths }) {
      if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length ||
          paths.some(value => !SOURCE_OWNER_BOOTSTRAP_PATHS.includes(value))) fail("Inspect only the finite trusted owner paths.");
      const before = await current(providerRepository);
      const tree = await read(`/repos/${providerRepository.full_name}/git/trees/${before.commit}?recursive=1`, 1_048_576);
      if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 8192) fail("The complete bounded provider tree is required.");
      const entries = new Map();
      for (const entry of tree.tree) {
        if (typeof entry.path !== "string" || entries.has(entry.path)) fail("The provider tree contains ambiguous source paths.");
        entries.set(entry.path, entry);
      }
      const observedFiles = {};
      for (const target of paths) {
        const parents = target.split("/").slice(0, -1);
        for (let i = 1; i <= parents.length; i++) {
          const parent = entries.get(parents.slice(0, i).join("/"));
          if (parent && (parent.type !== "tree" || parent.mode !== "040000")) fail("A bootstrap parent is not a regular source directory.");
        }
        const entry = entries.get(target);
        if (!entry) { observedFiles[target] = null; continue; }
        if (entry.type !== "blob" || entry.mode !== "100644" || !SHA.test(entry.sha ?? "") ||
            !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 65_536) fail("Bootstrap source must be a bounded regular file, not a symlink or submodule.");
        const blob = await read(`/repos/${providerRepository.full_name}/git/blobs/${entry.sha}`, 131_072);
        if (blob.sha !== entry.sha || blob.encoding !== "base64" || typeof blob.content !== "string" || blob.size !== entry.size) fail("The provider blob does not match the selected source tree.");
        const encoded = blob.content.replace(/[\r\n]/g, "");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("Provider source encoding is invalid.");
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.length !== entry.size || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.sha) fail("Provider source bytes do not match the exact Git blob.");
        try { observedFiles[target] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { fail("Bootstrap source must be valid UTF-8."); }
      }
      const after = await current(providerRepository);
      if (before.commit !== after.commit) fail("Provider main changed during inspection; prepare against its current source.");
      return { fetched_base: before.commit, observed_files: observedFiles, visibility: "public", default_branch: "main" };
    },
  };
}
