import { createHash } from "node:crypto";
import { parseCanonicalJson } from "../delivery-art/canonical-json.js";
import { closureError } from "./contracts.js";

const SHA = /^[0-9a-f]{40}$/;
const fail = () => closureError("owner_readback_unavailable", "The exact reviewed Prototype source could not be verified.", 503);

export function createPrototypeImportSourceReader(platform) {
  return {
    async inspectPrototypeImport({ ownerRepo, providerRepository, mergeCommit, prototypeId, validateManifest }) {
      if (!platform?.inspectPrototypeImport) throw fail();
      const input = { owner_repo: ownerRepo, provider_repository: providerRepository,
        merge_commit: mergeCommit, prototype_id: prototypeId, expected_main: null };
      const source = await platform.inspectPrototypeImport(input);
      if (!source || Object.keys(source).sort().join(",") !== "current_main,files,manifest_text" ||
          !SHA.test(source.current_main ?? "") || typeof source.manifest_text !== "string" ||
          Buffer.byteLength(source.manifest_text) > 262144 || !source.files ||
          typeof source.files !== "object" || Array.isArray(source.files)) throw fail();
      let manifest;
      try { manifest = parseCanonicalJson(source.manifest_text); }
      catch { throw fail(); }
      validateManifest(manifest);
      const paths = manifest.file_mappings.map(row => row.owner_path);
      if (new Set(paths).size !== paths.length || Object.keys(source.files).length !== paths.length) throw fail();
      for (const path of paths) {
        const entry = Object.hasOwn(source.files, path) && source.files[path];
        if (!entry || Object.keys(entry).sort().join(",") !== "git_blob,git_mode,size" ||
            !SHA.test(entry.git_blob ?? "") || !["100644", "100755"].includes(entry.git_mode) ||
            !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 4194304) throw fail();
      }
      return {
        manifest,
        metadata_digest: `sha256:${createHash("sha256").update(source.manifest_text).digest("hex")}`,
        regularFile(path) {
          if (!Object.hasOwn(source.files, path)) throw fail();
          return source.files[path];
        },
        async recheckCurrent() {
          const current = await platform.inspectPrototypeImport({ ...input, expected_main: source.current_main });
          if (current?.current_main !== source.current_main) throw fail();
        },
      };
    },
  };
}
