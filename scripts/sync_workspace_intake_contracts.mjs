import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/workspace-intake");
const sources = [
  { repo: "workspace-governance", commit: "6fd843eb43405f6bdcc439d23b18e556eca05b26", files: [
    ["workspace-intake.yaml", "contracts/workspace-intake.yaml"],
    ...["request", "decision", "mutation", "readback", "receipt"].map((kind) => [
      `${kind}.schema.json`, `contracts/schemas/workspace-intake-${kind}.schema.json`,
    ]),
  ] },
  { repo: "workspace-governance-control-fabric", commit: "e8a96ecd01a1ea2481c436fd59fb339ab4fcb162", files: [
    ["readiness.schema.json", "contracts/workspace-intake/readiness.schema.json"],
    ["evaluation.schema.json", "contracts/workspace-intake/evaluation.schema.json"],
  ] },
];
const workspaceIndex = process.argv.indexOf("--workspace-root");
const workspace = workspaceIndex < 0 ? path.resolve(root, "..") : path.resolve(process.argv[workspaceIndex + 1]);
const check = process.argv.includes("--check");
const manifest = { schema_version: 1, contract_id: "oos.workspace-intake.v1", runtime_activation: false, files: {} };
function emit(filename, bytes) {
  if (check) {
    if (!readFileSync(path.join(target, filename)).equals(bytes)) throw new Error(`Intake bundle differs: ${filename}`);
  } else {
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, filename), bytes);
  }
}
for (const source of sources) {
  for (const [name, sourcePath] of source.files) {
    const bytes = execFileSync("git", ["-C", path.join(workspace, source.repo), "show", `${source.commit}:${sourcePath}`]);
    manifest.files[name] = { repo: source.repo, commit: source.commit, path: sourcePath, sha256: createHash("sha256").update(bytes).digest("hex") };
    emit(name, bytes);
  }
}
emit("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
console.log(`Workspace Intake bundle ${check ? "verified" : "synchronized"}.`);
