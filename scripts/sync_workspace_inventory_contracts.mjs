import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/workspace-inventory");
const sources = [
  {
    repo: "workspace-governance",
    commit: "0926e18a6661e895169c47969894c41effcd2ff5",
    files: [
      ["workspace-active-inventory.yaml", "contracts/workspace-active-inventory.yaml"],
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
    commit: "1ceb4ae01e4d0ca1f6d131237dc226692e895da0",
    files: [
      ["evaluation.schema.json", "contracts/workspace-active-inventory/evaluation.schema.json"],
      ["lifecycle-evaluation.schema.json", "contracts/workspace-active-inventory/lifecycle-evaluation.schema.json"],
    ],
  },
];
const workspaceIndex = process.argv.indexOf("--workspace-root");
const workspace = workspaceIndex < 0
  ? path.resolve(root, "..")
  : path.resolve(process.argv[workspaceIndex + 1]);
const check = process.argv.includes("--check");
const manifest = {
  schema_version: 1,
  contract_id: "oos.workspace-inventory.v1",
  runtime_activation: false,
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
