import { createHash } from "node:crypto";
import { HttpError } from "../errors.js";
import { SOURCE_OWNER_BOOTSTRAP_PATHS } from "./scaffold.js";
import { parseCanonicalJson } from "../delivery-art/canonical-json.js";

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
    // Read-only companion for native finalized source-import evidence. It does
    // not widen bootstrap's finite write/read plan or accept a caller URL.
    async inspectPrototypeImport({ providerRepository, mergeCommit, prototypeId, validateManifest }) {
      if (typeof mergeCommit !== "string" || !SHA.test(mergeCommit) || typeof prototypeId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prototypeId) ||
          prototypeId.length > 128 || typeof validateManifest !== "function") fail("Source import requires its exact native merge and Prototype identity.");
      const before = await current(providerRepository);
      const comparison = await read(`/repos/${providerRepository.full_name}/compare/${mergeCommit}...${before.commit}`, 1_048_576);
      if (!["ahead", "identical"].includes(comparison.status) || comparison.merge_base_commit?.sha !== mergeCommit) {
        fail("The accepted owner merge is not in current canonical main.");
      }
      const tree = await read(`/repos/${providerRepository.full_name}/git/trees/${mergeCommit}?recursive=1`, 1_048_576);
      if (tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 8192) fail("Source import requires the complete bounded canonical tree.");
      const entries = new Map();
      for (const entry of tree.tree) {
        if (typeof entry.path !== "string" || entries.has(entry.path)) fail("The owner tree contains ambiguous source paths.");
        entries.set(entry.path, entry);
      }
      const regularFile = (target, maxBytes, applicationFile = false) => {
        if (typeof target !== "string" || target.length > 512 ||
            !/^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(target)) fail("The imported file path is unsafe.");
        const components = target.split("/");
        for (let n = 1; n < components.length; n++) {
          const parent = entries.get(components.slice(0, n).join("/"));
          if (!parent || parent.type !== "tree" || parent.mode !== "040000") fail("An imported file parent is not a regular Git directory.");
        }
        const entry = entries.get(target);
        if (!entry || entry.type !== "blob" || !(applicationFile ? ["100644", "100755"] : ["100644"]).includes(entry.mode) || !SHA.test(entry.sha ?? "") ||
            !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maxBytes) fail("Imported source must be a bounded regular committed file.");
        return { git_blob: entry.sha, git_mode: entry.mode, size: entry.size };
      };
      const metadataPath = `records/prototype-source-imports/${prototypeId}.json`;
      const metadata = regularFile(metadataPath, 262_144);
      const blob = await read(`/repos/${providerRepository.full_name}/git/blobs/${metadata.git_blob}`, 524_288);
      if (blob.sha !== metadata.git_blob || blob.encoding !== "base64" || typeof blob.content !== "string" || blob.size !== metadata.size) fail("Source-import metadata does not match the canonical Git tree.");
      const encoded = blob.content.replace(/[\r\n]/g, "");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("Source-import metadata encoding is invalid.");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== metadata.size || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== metadata.git_blob) fail("Source-import metadata bytes do not match their Git identity.");
      let manifest;
      try { manifest = parseCanonicalJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
      catch { fail("Source-import metadata is not strict UTF-8 JSON."); }
      validateManifest(manifest);
      return {
        manifest, metadata_path: metadataPath, metadata_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        merge_commit: mergeCommit, current_main: before.commit,
        // Git's content-addressed blob identity binds the target to the exact
        // Studio bytes independently hashed with SHA-256 by its owner reader.
        // Never execute application code or project its contents here.
        regularFile: target => regularFile(target, 4 * 1024 * 1024, true),
        async recheckCurrent() {
          if ((await current(providerRepository)).commit !== before.commit) fail("Canonical owner main changed during source-import inspection.");
        },
      };
    },
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
