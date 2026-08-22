import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeliveryArtWorkSessionSourceAdapter } from "../src/delivery-art/work-session-cli-adapters.js";

function git(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

test("source adapter reconstructs a planned branch after worktree cleanup", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-work-source-"));
  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const repoRoot = path.join(workspaceRoot, "operator-orchestration-service");
  await mkdir(remoteRoot, { recursive: true });
  git(remoteRoot, ["init", "--bare"]);
  git(workspaceRoot, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "work-session@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Work Session Test"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n", "utf8");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);

  const adapter = createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot });
  const base = await adapter.resolveBase({
    baseRef: "origin/main",
    ownerRepo: "operator-orchestration-service",
  });
  const session = {
    landing_unit_id: "delivery-958-work-item-963",
    owner_repo: "operator-orchestration-service",
    landing_unit: {
      base_commit: base.commit,
      branch: "feature/963-resumable-work-session",
    },
  };

  const firstPath = await adapter.ensureWorktree(session);
  assert.equal(await adapter.resolveWorktree(session), firstPath);
  assert.equal(git(firstPath, ["rev-parse", "HEAD"]), base.commit);

  git(repoRoot, ["worktree", "remove", "--force", firstPath]);
  assert.equal(await adapter.resolveWorktree(session), null);
  const reconstructedPath = await adapter.ensureWorktree(session);
  assert.equal(reconstructedPath, firstPath);
  assert.equal(git(reconstructedPath, ["rev-parse", "--abbrev-ref", "HEAD"]), session.landing_unit.branch);

  await writeFile(path.join(repoRoot, "architecture.json"), '{"scope":"repo"}\n', "utf8");
  assert.deepEqual(
    await adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "architecture.json",
    }),
    { scope: "repo" },
  );

  const outsideArtifact = path.join(workspaceRoot, "outside.json");
  await writeFile(outsideArtifact, '{"scope":"outside"}\n', "utf8");
  await symlink(outsideArtifact, path.join(repoRoot, "linked-architecture.json"));
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "../outside.json",
    }),
    /escapes its repository/,
  );
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "operator-orchestration-service",
      relative_path: "linked-architecture.json",
    }),
    /resolves outside its repository/,
  );
  await assert.rejects(
    () => adapter.readArtifact({
      repo: "../operator-orchestration-service",
      relative_path: "architecture.json",
    }),
    /name is invalid/,
  );
});
