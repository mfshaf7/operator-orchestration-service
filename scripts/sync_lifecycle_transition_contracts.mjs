import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/lifecycle-transition");
const governanceCommit = "aec87fd55b1669aad36012300a62f098464ac0ff";
const files = [
  ["project-lifecycle.yaml", "contracts/project-lifecycle.yaml"],
  [
    "lifecycle-transition-projection.schema.json",
    "contracts/schemas/lifecycle-transition-projection.schema.json",
  ],
  [
    "prototype-to-delivery.current.valid.json",
    "contracts/fixtures/lifecycle-transition-projection/prototype-to-delivery.current.valid.json",
  ],
];
const workspaceIndex = process.argv.indexOf("--workspace-root");
let workspace = workspaceIndex < 0
  ? null
  : path.resolve(process.argv[workspaceIndex + 1]);
if (!workspace) {
  const commonGitDir = execFileSync(
    "git",
    ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  workspace = path.resolve(path.dirname(commonGitDir), "..");
}
const check = process.argv.includes("--check");
const manifest = {
  schema_version: 1,
  contract_id: "oos.lifecycle-transition-journal.v1",
  runtime_activation: true,
  runtime_profile: "dev-integration",
  source_authority: {
    repo: "workspace-governance",
    minimum_commit: governanceCommit,
  },
  files: {},
};

function emit(filename, bytes) {
  const destination = path.join(target, filename);
  if (check) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(`Lifecycle Transition bundle differs: ${filename}`);
    }
  } else {
    mkdirSync(target, { recursive: true });
    writeFileSync(destination, bytes);
  }
}

for (const [name, sourcePath] of files) {
  const bytes = execFileSync("git", [
    "-C",
    path.join(workspace, "workspace-governance"),
    "show",
    `${governanceCommit}:${sourcePath}`,
  ]);
  manifest.files[name] = {
    repo: "workspace-governance",
    commit: governanceCommit,
    path: sourcePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  emit(name, bytes);
}
emit("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
console.log(`Lifecycle Transition bundle ${check ? "verified" : "synchronized"}.`);
