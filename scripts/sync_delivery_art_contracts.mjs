import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_DIR = path.join(REPO_ROOT, "contracts", "delivery-art");
export const DELIVERY_ART_SCHEMA_FILES = Object.freeze([
  "delivery-art-architecture-packet.schema.json",
  "delivery-art-custody-receipt.schema.json",
  "delivery-art-readiness-receipt.schema.json",
  "delivery-art-review-packet.schema.json",
  "delivery-art-work-session-cleanup-receipt.schema.json",
  "delivery-art-work-session-resource-manifest.schema.json",
  "delivery-art-work-start-record.schema.json",
]);
export const DELIVERY_ART_FIXTURE_FILES = Object.freeze([
  "architecture-custody-receipt.valid.json",
  "architecture-packet.valid.json",
  "finalized-custody-receipt.valid.json",
  "merge-ready-custody-receipt.valid.json",
  "readiness-receipt.valid.json",
  "review-packet-finalized.valid.json",
  "review-packet-merge-ready.valid.json",
  "work-session-cleanup-receipt.valid.json",
  "work-session-resource-manifest.valid.json",
  "work-start-custody-receipt.valid.json",
  "work-start-record.valid.json",
]);

function defaultSourceRoot() {
  try {
    const commonGitDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    return path.resolve(path.dirname(commonGitDir), "..", "workspace-governance");
  } catch {
    return path.resolve(REPO_ROOT, "..", "workspace-governance");
  }
}

function parseArgs(argv) {
  const options = {
    check: false,
    sourceRoot: defaultSourceRoot(),
    targetDir: TARGET_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (["--source-root", "--target-dir"].includes(argument)) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a path`);
      }
      options[argument === "--source-root" ? "sourceRoot" : "targetDir"] =
        path.resolve(value);
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

function gitOutput(sourceRoot, args) {
  return execFileSync("git", args, {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sourceCommit(sourceRoot) {
  return gitOutput(sourceRoot, ["rev-parse", "HEAD"]);
}

function sourceDescriptors(sourceRoot) {
  const schemaSourceDir = path.join(sourceRoot, "contracts", "schemas");
  const fixtureSourceDir = path.join(
    sourceRoot,
    "contracts",
    "fixtures",
    "delivery-art-workflow",
  );
  return [
    ...DELIVERY_ART_SCHEMA_FILES.map((filename) => ({
      filename,
      kind: "schemas",
      sourcePath: path.join(schemaSourceDir, filename),
      sourceRepoPath: path.posix.join("contracts", "schemas", filename),
      targetPath: filename,
    })),
    ...DELIVERY_ART_FIXTURE_FILES.map((filename) => ({
      filename,
      kind: "fixtures",
      sourcePath: path.join(fixtureSourceDir, filename),
      sourceRepoPath: path.posix.join(
        "contracts",
        "fixtures",
        "delivery-art-workflow",
        filename,
      ),
      targetPath: path.join("fixtures", filename),
    })),
  ];
}

function sourceBundle(sourceRoot) {
  const contents = new Map();
  const descriptors = sourceDescriptors(sourceRoot).map((descriptor) => {
    if (!existsSync(descriptor.sourcePath)) {
      throw new Error(
        `missing authoritative Delivery ART ${descriptor.kind.slice(0, -1)}: ${descriptor.sourcePath}`,
      );
    }
    const content = readFileSync(descriptor.sourcePath);
    contents.set(descriptor.targetPath, content);
    return {
      ...descriptor,
      key: descriptor.kind === "schemas"
        ? JSON.parse(content.toString("utf8")).properties.artifact_type.const
        : descriptor.filename,
      sha256: sha256(content),
    };
  });
  return { contents, descriptors };
}

function manifestFor(bundle, commit) {
  const manifest = {
    schema_version: 1,
    source: {
      commit,
      repo: "workspace-governance",
    },
    schemas: {},
    fixtures: {},
  };
  for (const descriptor of bundle.descriptors) {
    manifest[descriptor.kind][descriptor.key] = {
      path: descriptor.targetPath.split(path.sep).join(path.posix.sep),
      sha256: descriptor.sha256,
    };
  }
  return manifest;
}

function readManifest(targetDir) {
  const manifestPath = path.join(targetDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function commitExists(sourceRoot, commit) {
  return spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    cwd: sourceRoot,
    stdio: "ignore",
  }).status === 0;
}

function commitIsAncestor(sourceRoot, commit) {
  return spawnSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
    cwd: sourceRoot,
    stdio: "ignore",
  }).status === 0;
}

function contentAtCommit(sourceRoot, commit, repoPath) {
  try {
    return execFileSync("git", ["show", `${commit}:${repoPath}`], {
      cwd: sourceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function bundleIssues({ sourceRoot, targetDir }) {
  const bundle = sourceBundle(sourceRoot);
  const manifest = readManifest(targetDir);
  const issues = new Set();
  const pinnedCommit = manifest?.source?.commit;
  const manifestShapeValid =
    manifest?.schema_version === 1 &&
    manifest?.source?.repo === "workspace-governance" &&
    /^[0-9a-f]{40}$/.test(String(pinnedCommit ?? ""));
  const pinnedCommitExists =
    manifestShapeValid && commitExists(sourceRoot, pinnedCommit);
  const pinnedCommitIsAncestor =
    pinnedCommitExists && commitIsAncestor(sourceRoot, pinnedCommit);

  if (!manifestShapeValid) {
    issues.add("manifest.json");
  }
  if (manifestShapeValid && !pinnedCommitIsAncestor) {
    issues.add("manifest.json");
  }

  for (const descriptor of bundle.descriptors) {
    const targetPath = path.join(targetDir, descriptor.targetPath);
    const targetContent = existsSync(targetPath) ? readFileSync(targetPath) : null;
    if (!targetContent?.equals(bundle.contents.get(descriptor.targetPath))) {
      issues.add(descriptor.targetPath);
    }

    const manifestEntry = manifest?.[descriptor.kind]?.[descriptor.key];
    const expectedManifestPath = descriptor.targetPath
      .split(path.sep)
      .join(path.posix.sep);
    if (
      manifestEntry?.path !== expectedManifestPath ||
      manifestEntry?.sha256 !== (targetContent ? sha256(targetContent) : null)
    ) {
      issues.add("manifest.json");
    }

    if (pinnedCommitExists) {
      const pinnedContent = contentAtCommit(
        sourceRoot,
        pinnedCommit,
        descriptor.sourceRepoPath,
      );
      if (!targetContent || !pinnedContent?.equals(targetContent)) {
        issues.add("manifest.json");
      }
    }
  }

  const expectedKeys = (kind) => bundle.descriptors
    .filter((descriptor) => descriptor.kind === kind)
    .map((descriptor) => descriptor.key)
    .sort();
  for (const kind of ["schemas", "fixtures"]) {
    const actualKeys = Object.keys(manifest?.[kind] ?? {}).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys(kind))) {
      issues.add("manifest.json");
    }
  }
  return { bundle, issues: [...issues].sort(), manifest };
}

export function checkDeliveryArtContractBundle({ sourceRoot, targetDir }) {
  const result = bundleIssues({ sourceRoot, targetDir });
  if (result.issues.length > 0) {
    throw new Error(
      `Delivery ART contract bundle is stale: ${result.issues.join(", ")}`,
    );
  }
  return result;
}

export function syncDeliveryArtContractBundle({ sourceRoot, targetDir }) {
  const inspected = bundleIssues({ sourceRoot, targetDir });
  const preserveManifest = inspected.issues.length === 0;
  let manifest = inspected.manifest;
  if (!preserveManifest) {
    const commit = sourceCommit(sourceRoot);
    const uncommittedSources = inspected.bundle.descriptors
      .filter((descriptor) => {
        const committedContent = contentAtCommit(
          sourceRoot,
          commit,
          descriptor.sourceRepoPath,
        );
        return !committedContent?.equals(
          inspected.bundle.contents.get(descriptor.targetPath),
        );
      })
      .map((descriptor) => descriptor.sourceRepoPath);
    if (uncommittedSources.length > 0) {
      throw new Error(
        `Delivery ART source contracts must be committed before sync: ${uncommittedSources.join(", ")}`,
      );
    }
    manifest = manifestFor(inspected.bundle, commit);
  }

  mkdirSync(targetDir, { recursive: true });
  for (const [filename, content] of inspected.bundle.contents) {
    const targetPath = path.join(targetDir, filename);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
  }
  writeFileSync(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { manifest, preserved_provenance: preserveManifest };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.check) {
    checkDeliveryArtContractBundle(options);
    process.stdout.write("Delivery ART contract bundle is current.\n");
    return;
  }
  const result = syncDeliveryArtContractBundle(options);
  process.stdout.write(
    `Synced ${DELIVERY_ART_SCHEMA_FILES.length} Delivery ART schemas and ${DELIVERY_ART_FIXTURE_FILES.length} fixtures (${result.preserved_provenance ? "preserved" : "updated"} provenance).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
