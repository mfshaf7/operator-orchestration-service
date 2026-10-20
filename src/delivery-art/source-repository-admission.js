import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requireRecordAuthorityFreshnessSync } from "../record-authority-freshness.js";
import { inventoryManifest } from "../workspace-inventory/contracts.js";

const helper = fileURLToPath(new URL("../../scripts/workspace_inventory_source.py", import.meta.url));
const sourceEnv = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
  GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };

export function createCanonicalSourceRepositoryReader({ authorityRoot, python = "python3", clock = () => new Date() }) {
  if (!authorityRoot || !path.isAbsolute(authorityRoot)) throw new Error("Canonical source repository reader requires its owner-selected absolute authority root.");
  const git = (root, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env: sourceEnv, encoding: "utf8", timeout: 60000, maxBuffer: 4194304, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const freshness = () => requireRecordAuthorityFreshnessSync({ authorityRoot, git,
    ownerRepo: "workspace-governance", reviewedRevision: inventoryManifest.source_activation.authority.commit, clock });
  return ({ ownerRepo, legacyRepository }) => {
    if (typeof ownerRepo !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(ownerRepo)) throw new Error("Invalid canonical source owner selector.");
    const before = freshness();
    const legacy = legacyRepository ? { provider: "github", full_name: legacyRepository.full_name,
      provider_repository_id: String(legacyRepository.id) } : null;
    const result = JSON.parse(execFileSync(python, [helper, "source-admission", "--source-root", authorityRoot,
      "--input", "-", "--output", "-"], { input: JSON.stringify({ owner_repo: ownerRepo, legacy_provider: legacy }),
      env: sourceEnv, encoding: "utf8", timeout: 60000, maxBuffer: 262144, stdio: ["pipe", "pipe", "pipe"] }));
    const after = freshness();
    const binding = result.provider_repository;
    if (before.record_revision !== after.record_revision || result.owner_repo !== ownerRepo ||
        binding?.provider !== "github" || !/^[1-9][0-9]*$/.test(binding?.provider_repository_id ?? "") ||
        !Number.isSafeInteger(Number(binding.provider_repository_id)) ||
        typeof binding.full_name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(binding.full_name) ||
        !/^sha256:[0-9a-f]{64}$/.test(result.inventory_digest ?? "")) {
      throw new Error("Canonical source admission changed or returned invalid provider coordinates.");
    }
    return { owner_repo: ownerRepo, repository: { full_name: binding.full_name, id: Number(binding.provider_repository_id) },
      inventory_revision: before.record_revision, inventory_digest: result.inventory_digest };
  };
}
