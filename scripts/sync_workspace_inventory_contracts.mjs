import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/workspace-inventory");
const governanceCommit = "e3864940dd6961426de93fa5cdb2215a86a5aca1";
const wgcfCommit = "0d0b686ea78397d91f64b498d78a4aa6651e1c05";
const sources = [
  {
    repo: "workspace-governance",
    commit: governanceCommit,
    files: [
      ["workspace-active-inventory.yaml", "contracts/workspace-active-inventory.yaml"],
      ["operation.yaml", "contracts/workspace-intake-inventory-operation.yaml"],
      ["operation.schema.json", "contracts/schemas/workspace-intake-inventory-operation.schema.json"],
      ...["request", "readiness", "mutation", "readback", "receipt"].map((kind) => [
        `${kind}.schema.json`,
        `contracts/schemas/workspace-inventory-promotion-${kind}.schema.json`,
      ]),
      ["lifecycle-policy.yaml", "contracts/workspace-inventory-lifecycle.yaml"],
      ["history.schema.json", "contracts/schemas/workspace-inventory-history.schema.json"],
      ["lifecycle.schema.json", "contracts/schemas/workspace-inventory-lifecycle.schema.json"],
      ...["request", "readiness", "mutation", "readback", "receipt"].map((kind) => [
        `lifecycle-${kind}.schema.json`,
        `contracts/schemas/workspace-inventory-lifecycle-${kind}.schema.json`,
      ]),
    ],
  },
  {
    repo: "workspace-governance-control-fabric",
    commit: wgcfCommit,
    files: [
      ["evaluation.schema.json", "contracts/workspace-active-inventory/evaluation.schema.json"],
      ["lifecycle-evaluation.schema.json", "contracts/workspace-active-inventory/lifecycle-evaluation.schema.json"],
    ],
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
const wgcfManifest = JSON.parse(execFileSync("git", [
  "-C",
  path.join(workspace, "workspace-governance-control-fabric"),
  "show",
  `${wgcfCommit}:contracts/workspace-active-inventory/manifest.json`,
], { encoding: "utf8" }));
if (
  wgcfManifest.authority_commit !== governanceCommit ||
  wgcfManifest.runtime_activation !== true ||
  wgcfManifest.activation_contract?.contract_work_ref !== "openproject://work_packages/1206" ||
  wgcfManifest.activation_contract?.architecture_packet_ref !== "architecture-packet:delivery-1203-v1"
) {
  throw new Error("Workspace Inventory WGCF activation manifest does not match the approved operation chain.");
}
const manifest = {
  schema_version: 1,
  contract_id: "oos.workspace-inventory.v1",
  source_activation: {
    state: "ready-for-console-adapter",
    orchestration_work_ref: "openproject://work_packages/1208",
    authority: { repo: "workspace-governance", commit: governanceCommit },
    readiness_authority: {
      repo: "workspace-governance-control-fabric",
      commit: wgcfCommit,
      manifest_path: "contracts/workspace-active-inventory/manifest.json",
      contract_id: wgcfManifest.contract_id,
    },
    activation_contract: wgcfManifest.activation_contract,
    architecture_packet: {
      ref: "architecture-packet:delivery-1203-v1",
      digest: "sha256:0d079fe025eebd77da75e306e1e31d8281e141a1983907ad15c128ee41644557",
      uri: "wgcf://artifacts/delivery-art/sha256/0d079fe025eebd77da75e306e1e31d8281e141a1983907ad15c128ee41644557",
    },
  },
  runtime_activation: {
    eligible: true,
    profile: "dev-integration",
    state: "platform-composition-required",
    next_work_ref: "openproject://work_packages/1209",
    security_work_ref: "openproject://work_packages/1216",
    platform_work_ref: "openproject://work_packages/1217",
    operating_proof_work_ref: "openproject://work_packages/1210",
  },
  files: {},
};

function emit(filename, bytes) {
  const destination = path.join(target, filename);
  if (check) {
    if (!readFileSync(destination).equals(bytes)) {
      throw new Error(`Workspace Inventory bundle differs: ${filename}`);
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
console.log(`Workspace Inventory bundle ${check ? "verified" : "synchronized"}.`);
