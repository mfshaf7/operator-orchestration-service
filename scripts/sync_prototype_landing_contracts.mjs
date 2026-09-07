import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "contracts/prototype-landing");
const governanceCommit = "eb7fb3c182073d050e2cb95c4f3256be3c535eaa";
const wgcfCommit = "c099752592825e8988dca32a1a0e40c590cd9d66";
const studioCommit = "2d18349ffab42bff052061e5adbc1d2c76d6210c";
const securityCommit = "484de62d69b5291d39a0e3d317862cdf44f77150";
const activationReviewCommit = "7acfd9f86c24e8d454c7df8ee29abfbf2ad8ae20";
const governanceFiles = [
  ["prototype-landing.yaml", "contracts/prototype-landing.yaml"],
  ["prototype-landing.schema.json", "contracts/schemas/prototype-landing.schema.json"],
  ...["entry-packet", "request", "plan", "readiness", "apply", "readback", "receipt"].map((kind) => [
    `prototype-landing-${kind}.schema.json`,
    `contracts/schemas/prototype-landing-${kind}.schema.json`,
  ]),
];
const sources = [
  { repo: "workspace-governance", commit: governanceCommit, files: governanceFiles },
  { repo: "workspace-governance-control-fabric", commit: wgcfCommit, files: [
    ["evaluation.schema.json", "contracts/prototype-landing/evaluation.schema.json"],
  ] },
];
const workspaceIndex = process.argv.indexOf("--workspace-root");
let workspace = workspaceIndex < 0 ? null : path.resolve(process.argv[workspaceIndex + 1]);
if (!workspace) {
  try {
    const commonGitDir = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    workspace = path.resolve(path.dirname(commonGitDir), "..");
  } catch {
    workspace = path.resolve(root, "..");
  }
}
const check = process.argv.includes("--check");
const manifest = {
  schema_version: 1,
  contract_id: "oos.prototype-landing.v1",
  runtime_activation: true,
  source_authority: {
    repo: "workspace-prototype-studio",
    minimum_commit: studioCommit,
  },
  security_review: {
    repo: "security-architecture",
    commit: securityCommit,
    path: "docs/reviews/components/2026-09-07-prototype-landing-trust-boundary.md",
    decision: "approved-with-findings",
  },
  activation_review: {
    repo: "security-architecture",
    commit: activationReviewCommit,
    path: "docs/reviews/components/2026-09-08-prototype-landing-normal-availability.md",
    content_sha256: "80091cb2ac0154711ed011edd832d07ef540ad7e9732e9eae2c68b9c237d076f",
    decision: "approved-with-findings",
  },
  activation_work_item: "openproject://work_packages/1113",
  conformance_work_item: "openproject://work_packages/1092",
  files: {},
};

function emit(filename, bytes) {
  const destination = path.join(target, filename);
  if (check) {
    if (!readFileSync(destination).equals(bytes)) throw new Error(`Prototype Landing bundle differs: ${filename}`);
  } else {
    mkdirSync(target, { recursive: true });
    writeFileSync(destination, bytes);
  }
}

for (const source of sources) {
  for (const [name, sourcePath] of source.files) {
    const bytes = execFileSync("git", ["-C", path.join(workspace, source.repo), "show", `${source.commit}:${sourcePath}`]);
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
console.log(`Prototype Landing bundle ${check ? "verified" : "synchronized"}.`);
