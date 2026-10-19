import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { requireRecordAuthorityFreshnessSync } from "../record-authority-freshness.js";
import { intakeManifest } from "../workspace-intake/contracts.js";
import { assertProposedSourceOwnerAuthority } from "./scaffold.js";

const helper = fileURLToPath(new URL("../../scripts/workspace_intake_source.py", import.meta.url));
const environment = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1",
  GIT_GRAFT_FILE: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };

// Executor-internal native owner reader, not a browser-selected authority or
// synthetic active Inventory projection. Platform owns record-cache freshness.
export function createCanonicalProposedSourceOwnerReader({ authorityRoot, python = "python3", clock = () => new Date() }) {
  if (!authorityRoot || !path.isAbsolute(authorityRoot)) throw new TypeError("A commissioned absolute Workspace Governance authority root is required.");
  const git = (root, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 4_194_304, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const freshness = () => requireRecordAuthorityFreshnessSync({ authorityRoot, git, ownerRepo: "workspace-governance",
    reviewedRevision: intakeManifest.files["workspace-intake.yaml"].commit, clock });
  return ({ ownerRepo, providerRepository, intakeEntryRef }) => {
    const before = freshness();
    const result = assertProposedSourceOwnerAuthority(JSON.parse(execFileSync(python, [helper, "proposed-source-owner",
      "--source-root", authorityRoot, "--input", "-", "--output", "-"], {
      input: JSON.stringify({ target: { kind: "repo", name: ownerRepo }, expected_provider_repository: providerRepository }),
      env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 262_144, stdio: ["pipe", "pipe", "pipe"],
    })));
    const after = freshness();
    if (before.record_revision !== after.record_revision || result.owner_repo !== ownerRepo ||
        canonicalDigest(result.provider_repository) !== canonicalDigest(providerRepository) ||
        canonicalDigest(result.intake_entry_ref) !== canonicalDigest(intakeEntryRef)) {
      throw new Error("The selected proposed owner changed or lost current canonical source authority.");
    }
    return { ...result, authority_revision: before.record_revision };
  };
}
