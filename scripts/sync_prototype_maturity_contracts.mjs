import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/prototype-maturity");
const governanceCommit = "3a7e73dfdc4d96593f98ad76f4792dc2ea45f349";
const wgcfCommit = "3ae5aa97dfb40c5c892675ed8bd5fbfb3bbb6da9";
const studioCommit = "31a73628b0bfd5af1133bc3b633921a18e6e3941";
const securityCommit = "61c96e53cf87491e8d42ba076fa241844b5132e5";
const governanceFiles = [
  ["prototype-maturity.yaml", "contracts/prototype-maturity.yaml"],
  ["prototype-maturity.schema.json", "contracts/schemas/prototype-maturity.schema.json"],
  ...["request", "packet", "readiness", "decision", "readback", "receipt"].map(
    (kind) => [
      `prototype-maturity-${kind}.schema.json`,
      `contracts/schemas/prototype-maturity-${kind}.schema.json`,
    ],
  ),
];
const sources = [
  {
    repo: "workspace-governance",
    commit: governanceCommit,
    files: governanceFiles,
  },
  {
    repo: "workspace-governance-control-fabric",
    commit: wgcfCommit,
    files: [["evaluation.schema.json", "contracts/prototype-maturity/evaluation.schema.json"]],
  },
  {
    repo: "workspace-prototype-studio",
    commit: studioCommit,
    files: [["prototype-maturity-source-result.schema.json", "schemas/prototype-maturity-source-result.schema.json"]],
  },
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
  contract_id: "oos.prototype-maturity.v1",
  runtime_activation: false,
  source_authority: {
    repo: "workspace-prototype-studio",
    minimum_commit: studioCommit,
  },
  readiness_authority: {
    repo: "workspace-governance-control-fabric",
    minimum_commit: wgcfCommit,
  },
  security_review: {
    repo: "security-architecture",
    commit: securityCommit,
    path: "docs/reviews/components/2026-09-09-prototype-maturity-trust-boundary.md",
    content_sha256: "60ba959a5df1c9fb540ff2d14ded4e64c05cb31741d66a5da7cba5401763f739",
    decision: "approved-with-findings",
  },
  conformance_work_item: "openproject://work_packages/1097",
  files: {},
};

function emit(filename, bytes) {
  const destination = path.join(target, filename);
  if (check) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(`Prototype Maturity bundle differs: ${filename}`);
    }
  } else {
    mkdirSync(target, { recursive: true });
    writeFileSync(destination, bytes);
  }
}

for (const source of sources) {
  for (const [name, sourcePath] of source.files) {
    const bytes = execFileSync("git", [
      "-C",
      path.join(workspace, source.repo),
      "show",
      `${source.commit}:${sourcePath}`,
    ]);
    manifest.files[name] = {
      repo: source.repo,
      commit: source.commit,
      path: sourcePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    emit(name, bytes);
  }
}
emit("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
console.log(`Prototype Maturity bundle ${check ? "verified" : "synchronized"}.`);
