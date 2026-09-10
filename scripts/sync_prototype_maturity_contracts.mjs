import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/prototype-maturity");
const governanceCommit = "3a7e73dfdc4d96593f98ad76f4792dc2ea45f349";
const wgcfCommit = "4136e643dc05b0df02cf860c3cbd3052fae8df55";
const studioCommit = "31a73628b0bfd5af1133bc3b633921a18e6e3941";
const securityCommit = "61c96e53cf87491e8d42ba076fa241844b5132e5";
const activationReviewCommit = "087118a5f79034684f0ca895a85cb735d1298627";
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
  runtime_activation: true,
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
  activation_review: {
    repo: "security-architecture",
    commit: activationReviewCommit,
    path: "docs/reviews/components/2026-09-10-prototype-maturity-normal-availability.md",
    content_sha256: "e0923786d5e19f7843ec4a8941fc007c701dec55e7b3d523695d2049923665da",
    decision: "approved-with-findings",
  },
  activation_evidence: {
    conformance_review_packet: {
      uri: "wgcf://artifacts/delivery-art/sha256/1267af69967d433caea791dbadc600bef718b8489ddd9ac5778799431d86f01f",
      digest: "sha256:1267af69967d433caea791dbadc600bef718b8489ddd9ac5778799431d86f01f",
    },
    identity_review_packet: {
      uri: "wgcf://artifacts/delivery-art/sha256/1a1ec22ccd4456db99f67157c084a3c46ce4fb03ed1f4be820afadd60e676c45",
      digest: "sha256:1a1ec22ccd4456db99f67157c084a3c46ce4fb03ed1f4be820afadd60e676c45",
    },
    readiness_activation_review_packet: {
      uri: "wgcf://artifacts/delivery-art/sha256/9a081dfab86b71176fb11aca5e8bc7565a5543532cb329a9e3f44d95b6b8ca6c",
      digest: "sha256:9a081dfab86b71176fb11aca5e8bc7565a5543532cb329a9e3f44d95b6b8ca6c",
    },
    identity_definition: {
      repo: "platform-engineering",
      commit: "f2b3b5f0f96b13217487250fd16d59dc77496d16",
      path: "security/prototype-maturity-identity.yaml",
      content_sha256: "a951e0c46de67cd53e362075d0c2d585a56678bfdf4031de04c97d09d692738c",
    },
  },
  activation_work_item: "openproject://work_packages/1130",
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
