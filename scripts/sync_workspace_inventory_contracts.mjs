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
    commit: "c7bf95ee0009a95331bf2bd5e07622ab34d1c0cf",
    files: [
      ["workspace-active-inventory.yaml", "contracts/workspace-active-inventory.yaml"],
      ...["request", "readiness", "mutation", "readback", "receipt"].map((kind) => [
        `${kind}.schema.json`,
        `contracts/schemas/workspace-inventory-promotion-${kind}.schema.json`,
      ]),
    ],
  },
  {
    repo: "workspace-governance-control-fabric",
    commit: "1bffe1a74795acb6519fce234f043e3aea0e4158",
    files: [["evaluation.schema.json", "contracts/workspace-active-inventory/evaluation.schema.json"]],
  },
];
const workspaceIndex = process.argv.indexOf("--workspace-root");
const workspace = workspaceIndex < 0
  ? path.resolve(root, "..")
  : path.resolve(process.argv[workspaceIndex + 1]);
const check = process.argv.includes("--check");
const manifest = {
  schema_version: 1,
  contract_id: "oos.workspace-inventory-promotion.v1",
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
