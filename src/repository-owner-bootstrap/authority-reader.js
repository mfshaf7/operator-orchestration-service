import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { requireRecordAuthorityFreshnessSync } from "../record-authority-freshness.js";
import { intakeManifest } from "../workspace-intake/contracts.js";
import { assertOwnerSetupAuthority } from "./scaffold.js";
import { createConfiguredHostInstanceSourceReader } from "../instance-records/host-source-reader.js";

const helper = fileURLToPath(new URL("../../scripts/workspace_intake_source.py", import.meta.url));
const environment = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1", GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1",
  GIT_GRAFT_FILE: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };

// Executor-internal native owner reader, not a browser-selected authority or
// synthetic active Inventory projection. Platform owns record-cache freshness.
export function createCanonicalProposedSourceOwnerReader({ authorityRoot, python = "python3", clock = () => new Date(),
  instanceReader = createConfiguredHostInstanceSourceReader() }) {
  if (!authorityRoot || !path.isAbsolute(authorityRoot)) throw new TypeError("A commissioned absolute Workspace Governance authority root is required.");
  const git = (root, ...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
    env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 4_194_304, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  // Bundle provenance is a required ancestor of Platform's current approved baseline.
  const freshness = () => requireRecordAuthorityFreshnessSync({ authorityRoot, git, ownerRepo: "workspace-governance",
    reviewedRevision: intakeManifest.files["workspace-intake.yaml"].commit, clock });
  return ({ ownerRepo, providerRepository, intakeEntryRef, inventoryEntryRef = null, operation = "bootstrap" }) => {
    const before = freshness();
    if (instanceReader !== null) {
      const policyBytes = execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", authorityRoot, "show", `${before.record_revision}:contracts/instance-operational-records.yaml`],
        { env: environment, timeout: 60000, maxBuffer: 262144, stdio: ["ignore", "pipe", "pipe"] });
      const policyRef = { repo: "workspace-governance", revision: before.record_revision,
        contract_digest: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}` };
      const native = instanceReader({ ownerRepo, operation, policyRef });
      if (native !== null) {
        const result = assertOwnerSetupAuthority(native, operation), after = freshness();
        if (before.record_revision !== after.record_revision || result.owner_repo !== ownerRepo ||
            canonicalDigest(result.provider_repository) !== canonicalDigest(providerRepository) ||
            canonicalDigest(operation === "configure-verification" ? result.inventory_entry_ref : result.intake_entry_ref) !== canonicalDigest(operation === "configure-verification" ? inventoryEntryRef : intakeEntryRef)) {
          throw new Error("The current internal owner differs from the approved source plan.");
        }
        return result;
      }
    }
    const result = assertOwnerSetupAuthority(JSON.parse(execFileSync(python, [helper, operation === "configure-verification" ? "active-verification-owner" : "proposed-source-owner",
      "--source-root", authorityRoot, "--input", "-", "--output", "-"], {
      input: JSON.stringify({ target: { kind: "repo", name: ownerRepo }, expected_provider_repository: providerRepository }),
      env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 262_144, stdio: ["pipe", "pipe", "pipe"],
    })), operation);
    const after = freshness();
    if (before.record_revision !== after.record_revision || result.owner_repo !== ownerRepo ||
        canonicalDigest(result.provider_repository) !== canonicalDigest(providerRepository) ||
        canonicalDigest(operation === "configure-verification" ? result.inventory_entry_ref : result.intake_entry_ref) !== canonicalDigest(operation === "configure-verification" ? inventoryEntryRef : intakeEntryRef)) {
      throw new Error("The selected proposed owner changed or lost current canonical source authority.");
    }
    return { ...result, authority_revision: before.record_revision };
  };
}
