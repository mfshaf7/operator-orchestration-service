import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_DIR = path.join(REPO_ROOT, "contracts", "delivery-art");
const SCHEMA_FILES = [
  "delivery-art-architecture-packet.schema.json",
  "delivery-art-custody-receipt.schema.json",
  "delivery-art-readiness-receipt.schema.json",
  "delivery-art-review-packet.schema.json",
  "delivery-art-work-start-record.schema.json",
];
const FIXTURE_FILES = [
  "architecture-custody-receipt.valid.json",
  "architecture-packet.valid.json",
  "finalized-custody-receipt.valid.json",
  "merge-ready-custody-receipt.valid.json",
  "readiness-receipt.valid.json",
  "review-packet-finalized.valid.json",
  "review-packet-merge-ready.valid.json",
  "work-start-custody-receipt.valid.json",
  "work-start-record.valid.json",
];

function parseArgs(argv) {
  const options = {
    check: false,
    sourceRoot: path.resolve(REPO_ROOT, "..", "workspace-governance"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--source-root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--source-root requires a path");
      }
      options.sourceRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  return options;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function sourceCommit(sourceRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
}

function expectedBundle(sourceRoot) {
  const schemaSourceDir = path.join(sourceRoot, "contracts", "schemas");
  const fixtureSourceDir = path.join(
    sourceRoot,
    "contracts",
    "fixtures",
    "delivery-art-workflow",
  );
  const schemas = {};
  const contents = new Map();
  for (const filename of SCHEMA_FILES) {
    const sourcePath = path.join(schemaSourceDir, filename);
    if (!existsSync(sourcePath)) {
      throw new Error(`missing authoritative Delivery ART schema: ${sourcePath}`);
    }
    const content = readFileSync(sourcePath);
    contents.set(filename, content);
    const artifactType = JSON.parse(content.toString("utf8")).properties.artifact_type.const;
    schemas[artifactType] = {
      path: filename,
      sha256: sha256(content),
    };
  }
  const fixtures = {};
  for (const filename of FIXTURE_FILES) {
    const sourcePath = path.join(fixtureSourceDir, filename);
    if (!existsSync(sourcePath)) {
      throw new Error(`missing authoritative Delivery ART fixture: ${sourcePath}`);
    }
    const content = readFileSync(sourcePath);
    const targetPath = path.join("fixtures", filename);
    contents.set(targetPath, content);
    fixtures[filename] = {
      path: targetPath,
      sha256: sha256(content),
    };
  }
  const manifest = {
    schema_version: 1,
    source: {
      commit: sourceCommit(sourceRoot),
      repo: "workspace-governance",
    },
    schemas,
    fixtures,
  };
  return {
    contents,
    manifest: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

function checkBundle(bundle) {
  const issues = [];
  for (const [filename, expected] of bundle.contents) {
    const targetPath = path.join(TARGET_DIR, filename);
    if (!existsSync(targetPath) || !readFileSync(targetPath).equals(expected)) {
      issues.push(filename);
    }
  }
  const manifestPath = path.join(TARGET_DIR, "manifest.json");
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== bundle.manifest) {
    issues.push("manifest.json");
  }
  if (issues.length > 0) {
    throw new Error(`Delivery ART contract bundle is stale: ${issues.join(", ")}`);
  }
}

function writeBundle(bundle) {
  mkdirSync(TARGET_DIR, { recursive: true });
  for (const [filename, content] of bundle.contents) {
    const targetPath = path.join(TARGET_DIR, filename);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
  }
  writeFileSync(path.join(TARGET_DIR, "manifest.json"), bundle.manifest, "utf8");
}

const options = parseArgs(process.argv.slice(2));
const bundle = expectedBundle(options.sourceRoot);
if (options.check) {
  checkBundle(bundle);
  process.stdout.write("Delivery ART contract bundle is current.\n");
} else {
  writeBundle(bundle);
  process.stdout.write(
    `Synced ${SCHEMA_FILES.length} Delivery ART schemas and ${FIXTURE_FILES.length} fixtures.\n`,
  );
}
