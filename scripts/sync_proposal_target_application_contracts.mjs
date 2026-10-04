import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authorityCandidates = [
  process.env.OOS_PROPOSAL_TARGET_AUTHORITY_ROOT,
  path.resolve(root, "../workspace-prototype-studio"),
  path.resolve(root, "../../../workspace-prototype-studio"),
].filter(Boolean);
const authorityRoot = authorityCandidates.find((candidate) => existsSync(path.join(candidate, ".git")));
if (!authorityRoot) throw new Error("Workspace Prototype Studio authority checkout was not found.");
const authorityCommit = "18abb5bb5369e5e8720dc4815261bff745a691ff";
const destination = path.join(root, "contracts/proposal-target-application");
const names = ["record.schema.json", "request.schema.json", "result.schema.json"];
const check = process.argv.includes("--check");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

mkdirSync(destination, { recursive: true });
const files = {};
for (const name of names) {
  const sourcePath = `contracts/proposal-target-application/${name}`;
  const bytes = execFileSync("git", ["-C", authorityRoot, "show", `${authorityCommit}:${sourcePath}`]);
  const target = path.join(destination, name);
  if (check) {
    if (!readFileSync(target).equals(bytes)) throw new Error(`${name} differs from the pinned Prototype Studio authority.`);
  } else {
    writeFileSync(target, bytes);
  }
  files[name] = { repo: "workspace-prototype-studio", commit: authorityCommit, path: sourcePath, sha256: sha256(bytes) };
}

const manifest = {
  schema_version: 1,
  contract_id: "oos.proposal-target-application.v1",
  runtime_activation: false,
  source_authority: { repo: "workspace-prototype-studio", commit: authorityCommit },
  activation_work_item: "openproject://work_packages/1236",
  security_review_work_item: "openproject://work_packages/1235",
  files,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestPath = path.join(destination, "manifest.json");
if (check) {
  if (!readFileSync(manifestPath).equals(manifestBytes)) throw new Error("Proposal target application manifest is stale.");
} else {
  writeFileSync(manifestPath, manifestBytes);
}
console.log("Proposal target application contracts are synchronized.");
