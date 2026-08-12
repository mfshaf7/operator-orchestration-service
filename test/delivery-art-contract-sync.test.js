import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkDeliveryArtContractBundle,
  DELIVERY_ART_FIXTURE_FILES,
  DELIVERY_ART_SCHEMA_FILES,
  syncDeliveryArtContractBundle,
} from "../scripts/sync_delivery_art_contracts.mjs";

function git(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

async function seedSourceRepo(root) {
  const schemaRoot = path.join(root, "contracts", "schemas");
  const fixtureRoot = path.join(
    root,
    "contracts",
    "fixtures",
    "delivery-art-workflow",
  );
  await mkdir(schemaRoot, { recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  for (const [index, filename] of DELIVERY_ART_SCHEMA_FILES.entries()) {
    await writeFile(
      path.join(schemaRoot, filename),
      `${JSON.stringify({
        properties: {
          artifact_type: { const: `test_artifact_${index}` },
        },
      }, null, 2)}\n`,
      "utf8",
    );
  }
  for (const [index, filename] of DELIVERY_ART_FIXTURE_FILES.entries()) {
    await writeFile(
      path.join(fixtureRoot, filename),
      `${JSON.stringify({ fixture: index }, null, 2)}\n`,
      "utf8",
    );
  }
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "operator@example.test"]);
  git(root, ["config", "user.name", "Operator"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "seed delivery art bundle"]);
}

test("Delivery ART contract provenance changes only when governed bytes change", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-delivery-art-contracts-"));
  const sourceRoot = path.join(root, "workspace-governance");
  const targetDir = path.join(root, "operator-orchestration-service", "contracts");
  await mkdir(sourceRoot, { recursive: true });
  await seedSourceRepo(sourceRoot);

  const initialCommit = git(sourceRoot, ["rev-parse", "HEAD"]);
  syncDeliveryArtContractBundle({ sourceRoot, targetDir });
  const initialManifest = JSON.parse(
    await readFile(path.join(targetDir, "manifest.json"), "utf8"),
  );
  assert.equal(initialManifest.source.commit, initialCommit);
  assert.doesNotThrow(() =>
    checkDeliveryArtContractBundle({ sourceRoot, targetDir }));

  await writeFile(path.join(sourceRoot, "unrelated.txt"), "unrelated\n", "utf8");
  git(sourceRoot, ["add", "unrelated.txt"]);
  git(sourceRoot, ["commit", "-m", "unrelated governance change"]);
  assert.doesNotThrow(() =>
    checkDeliveryArtContractBundle({ sourceRoot, targetDir }));
  const preserved = syncDeliveryArtContractBundle({ sourceRoot, targetDir });
  assert.equal(preserved.preserved_provenance, true);
  assert.equal(preserved.manifest.source.commit, initialCommit);

  const schemaPath = path.join(
    sourceRoot,
    "contracts",
    "schemas",
    DELIVERY_ART_SCHEMA_FILES[0],
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  schema.description = "governed schema change";
  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  assert.throws(
    () => syncDeliveryArtContractBundle({ sourceRoot, targetDir }),
    /source contracts must be committed before sync/,
  );
  git(sourceRoot, ["add", schemaPath]);
  git(sourceRoot, ["commit", "-m", "change delivery art schema"]);
  assert.throws(
    () => checkDeliveryArtContractBundle({ sourceRoot, targetDir }),
    new RegExp(DELIVERY_ART_SCHEMA_FILES[0]),
  );
  const schemaCommit = git(sourceRoot, ["rev-parse", "HEAD"]);
  const schemaSync = syncDeliveryArtContractBundle({ sourceRoot, targetDir });
  assert.equal(schemaSync.preserved_provenance, false);
  assert.equal(schemaSync.manifest.source.commit, schemaCommit);

  const fixturePath = path.join(
    sourceRoot,
    "contracts",
    "fixtures",
    "delivery-art-workflow",
    DELIVERY_ART_FIXTURE_FILES[0],
  );
  await writeFile(fixturePath, '{"fixture":"changed"}\n', "utf8");
  git(sourceRoot, ["add", fixturePath]);
  git(sourceRoot, ["commit", "-m", "change delivery art fixture"]);
  assert.throws(
    () => checkDeliveryArtContractBundle({ sourceRoot, targetDir }),
    /fixtures\//,
  );
  const fixtureCommit = git(sourceRoot, ["rev-parse", "HEAD"]);
  const fixtureSync = syncDeliveryArtContractBundle({ sourceRoot, targetDir });
  assert.equal(fixtureSync.manifest.source.commit, fixtureCommit);
  assert.doesNotThrow(() =>
    checkDeliveryArtContractBundle({ sourceRoot, targetDir }));
});
