import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeliveryArtWorkSessionSourceAdapter } from "../src/delivery-art/work-session-cli-adapters.js";
import { createDeliveryArtWorkSessionResourceRetirementController } from "../src/delivery-art/work-session-resource-retirement-controller.js";
import {
  validateDeliveryArtWorkSession,
  validateDeliveryArtWorkSessionDecision,
} from "../src/delivery-art/work-session.js";
import { createDeliveryArtWorkSessionStore } from "../src/delivery-art/work-session-store.js";
import {
  completeDeliveryArtWorkSessionCleanup,
  createDeliveryArtWorkSessionCleanupReceipt,
  createDeliveryArtWorkSessionResourceManifest,
  prepareDeliveryArtWorkSessionCleanup,
  recordDeliveryArtWorkSessionResourceOutcome,
  startDeliveryArtWorkSessionCleanup,
  validateDeliveryArtWorkSessionCleanupReceipt,
  validateDeliveryArtWorkSessionResourceManifest,
} from "../src/delivery-art/work-session-resource-retirement.js";

function git(cwd, args) {
  return String(execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

async function repositoryFixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "oos-retirement-git-"));
  t.after(() => rm(workspaceRoot, { force: true, recursive: true }));
  const remoteRoot = path.join(workspaceRoot, "remote.git");
  const repoRoot = path.join(workspaceRoot, "operator-orchestration-service");
  await mkdir(remoteRoot, { recursive: true });
  git(remoteRoot, ["init", "--bare"]);
  git(workspaceRoot, ["clone", remoteRoot, repoRoot]);
  git(repoRoot, ["config", "user.email", "retirement@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Retirement Test"]);
  await writeFile(path.join(repoRoot, "README.md"), "base\n", "utf8");
  git(repoRoot, ["add", "README.md"]);
  git(repoRoot, ["commit", "-m", "base"]);
  git(repoRoot, ["branch", "-M", "main"]);
  git(repoRoot, ["push", "--set-upstream", "origin", "main"]);
  const baseCommit = git(repoRoot, ["rev-parse", "HEAD"]);
  const session = {
    session_id: "work-session:delivery-958:delivery-958-work-item-968",
    delivery_id: "delivery-958",
    landing_unit_id: "delivery-958-work-item-968",
    owner_repo: "operator-orchestration-service",
    operator: { id: "operator:workspace-owner" },
    landing_unit: {
      base_commit: baseCommit,
      base_ref: "origin/main",
      branch: "feature/968-work-session-resource-retirement",
    },
  };
  const adapter = createDeliveryArtWorkSessionSourceAdapter({ workspaceRoot });
  const ownership = await adapter.ensureOwnedWorktree(session);
  return { adapter, ownership, remoteRoot, repoRoot, session, workspaceRoot };
}

async function mergeFixtureBranch(fixture) {
  const worktree = fixture.ownership.path;
  await writeFile(path.join(worktree, "resource-retirement.txt"), "owned\n", "utf8");
  git(worktree, ["add", "resource-retirement.txt"]);
  git(worktree, ["commit", "-m", "add owned resource"]);
  const head = git(worktree, ["rev-parse", "HEAD"]);
  git(worktree, ["push", "--set-upstream", "origin", fixture.session.landing_unit.branch]);
  git(fixture.repoRoot, ["merge", "--ff-only", fixture.session.landing_unit.branch]);
  git(fixture.repoRoot, ["push", "origin", "main"]);
  return {
    head_commit: head,
    merge_commit: head,
    state: "merged",
    url: "https://example.test/operator-orchestration-service/pull/968",
  };
}

test("resource manifests reject unsafe paths and inferred deletion authority", async (t) => {
  const fixture = await repositoryFixture(t);
  const manifest = createDeliveryArtWorkSessionResourceManifest({
    resources: fixture.ownership.resources,
    session: fixture.session,
  });
  assert.equal(validateDeliveryArtWorkSessionResourceManifest(manifest).valid, true);

  const traversal = structuredClone(manifest);
  traversal.resources[0].locator.workspace_relative_path = "../outside";
  assert.equal(
    validateDeliveryArtWorkSessionResourceManifest(traversal).valid,
    false,
  );

  const inferred = structuredClone(manifest);
  inferred.resources[0].ownership_provenance = "ambiguous";
  assert.equal(
    validateDeliveryArtWorkSessionResourceManifest(inferred).valid,
    false,
  );
});

test("real Git retirement resumes after a crash without repeating deletion", async (t) => {
  const fixture = await repositoryFixture(t);
  assert.equal(
    fixture.ownership.resources.every(
      (resource) => resource.ownership_provenance === "session-created",
    ),
    true,
  );
  const pullRequest = await mergeFixtureBranch(fixture);
  let manifest = createDeliveryArtWorkSessionResourceManifest({
    resources: fixture.ownership.resources,
    session: fixture.session,
  });
  let resources = await fixture.adapter.planResourceRetirement({
    manifest,
    pullRequest,
    session: fixture.session,
  });
  manifest = prepareDeliveryArtWorkSessionCleanup({ manifest, resources });
  assert.equal(manifest.cleanup.state, "ready");
  manifest = startDeliveryArtWorkSessionCleanup(manifest);

  const worktreeResource = manifest.resources.find(
    (resource) => resource.resource_type === "git-worktree",
  );
  await fixture.adapter.retireResource({
    pullRequest,
    resource: worktreeResource,
    session: fixture.session,
  });
  assert.equal(existsSync(fixture.ownership.path), false);

  // Simulate process loss after deletion but before its outcome was persisted.
  resources = await fixture.adapter.planResourceRetirement({
    manifest,
    pullRequest,
    session: fixture.session,
  });
  assert.equal(
    resources.find((resource) => resource.resource_type === "git-worktree").outcome,
    "removed",
  );
  manifest = prepareDeliveryArtWorkSessionCleanup({ manifest, resources });
  manifest = startDeliveryArtWorkSessionCleanup(manifest);
  for (const resource of manifest.resources.filter(
    (entry) => entry.outcome === "eligible",
  )) {
    await fixture.adapter.retireResource({
      pullRequest,
      resource,
      session: fixture.session,
    });
    manifest = recordDeliveryArtWorkSessionResourceOutcome({
      manifest,
      outcome: "removed",
      resourceId: resource.resource_id,
    });
  }
  manifest = completeDeliveryArtWorkSessionCleanup(manifest);
  const receipt = createDeliveryArtWorkSessionCleanupReceipt({
    closedBy: "operator:workspace-owner",
    manifest,
    protectedEvidenceRefs: ["openproject://work_packages/968"],
  });

  assert.equal(receipt.outcome, "complete");
  assert.equal(
    git(fixture.repoRoot, ["branch", "--list", fixture.session.landing_unit.branch]),
    "",
  );
  assert.equal(
    git(fixture.repoRoot, [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${fixture.session.landing_unit.branch}`,
    ]),
    "",
  );
});

test("dirty worktree blocks the whole cleanup plan before any deletion", async (t) => {
  const fixture = await repositoryFixture(t);
  const pullRequest = await mergeFixtureBranch(fixture);
  await writeFile(path.join(fixture.ownership.path, "dirty.txt"), "dirty\n", "utf8");
  const manifest = createDeliveryArtWorkSessionResourceManifest({
    resources: fixture.ownership.resources,
    session: fixture.session,
  });
  const resources = await fixture.adapter.planResourceRetirement({
    manifest,
    pullRequest,
    session: fixture.session,
  });
  const planned = prepareDeliveryArtWorkSessionCleanup({ manifest, resources });

  assert.equal(planned.cleanup.state, "blocked");
  assert.match(planned.cleanup.last_error, /uncommitted changes/);
  assert.equal(existsSync(fixture.ownership.path), true);
  assert.notEqual(
    git(fixture.repoRoot, ["branch", "--list", fixture.session.landing_unit.branch]),
    "",
  );
  assert.notEqual(
    git(fixture.repoRoot, [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${fixture.session.landing_unit.branch}`,
    ]),
    "",
  );
});

test("remote inspection failure blocks cleanup instead of claiming removal", async (t) => {
  const fixture = await repositoryFixture(t);
  const pullRequest = await mergeFixtureBranch(fixture);
  const manifest = createDeliveryArtWorkSessionResourceManifest({
    resources: fixture.ownership.resources,
    session: fixture.session,
  });
  git(fixture.repoRoot, [
    "config",
    "remote.origin.url",
    path.join(fixture.workspaceRoot, "missing-remote.git"),
  ]);

  const resources = await fixture.adapter.planResourceRetirement({
    manifest,
    pullRequest,
    session: fixture.session,
  });
  const planned = prepareDeliveryArtWorkSessionCleanup({ manifest, resources });

  assert.equal(planned.cleanup.state, "blocked");
  assert.match(planned.cleanup.last_error, /resource inspection failed/);
  assert.equal(existsSync(fixture.ownership.path), true);
});

test("remote branch retirement preserves a head that changes after inspection", async (t) => {
  const fixture = await repositoryFixture(t);
  const pullRequest = await mergeFixtureBranch(fixture);
  const competitor = path.join(fixture.workspaceRoot, "competitor");
  git(fixture.workspaceRoot, ["clone", fixture.remoteRoot, competitor]);
  git(competitor, ["config", "user.email", "competitor@example.invalid"]);
  git(competitor, ["config", "user.name", "Competing Writer"]);
  git(competitor, [
    "checkout",
    "-b",
    fixture.session.landing_unit.branch,
    `origin/${fixture.session.landing_unit.branch}`,
  ]);
  await writeFile(path.join(competitor, "competing.txt"), "newer head\n", "utf8");
  git(competitor, ["add", "competing.txt"]);
  git(competitor, ["commit", "-m", "advance remote head"]);
  const competingHead = git(competitor, ["rev-parse", "HEAD"]);
  let raced = false;
  const racingAdapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot: fixture.workspaceRoot,
    execFileSyncImpl(executable, args, options) {
      if (!raced && args[0] === "push" && args.includes("--delete")) {
        raced = true;
        git(competitor, ["push", "origin", fixture.session.landing_unit.branch]);
      }
      return execFileSync(executable, args, options);
    },
  });
  const remoteResource = fixture.ownership.resources.find(
    (resource) => resource.resource_type === "git-remote-branch",
  );

  await assert.rejects(
    racingAdapter.retireResource({
      pullRequest,
      resource: remoteResource,
      session: fixture.session,
    }),
    /stale info/,
  );
  assert.equal(raced, true);
  assert.equal(
    git(fixture.repoRoot, [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${fixture.session.landing_unit.branch}`,
    ]).split(/\s+/)[0],
    competingHead,
  );
});

test("local branch retirement preserves a head that changes after inspection", async (t) => {
  const fixture = await repositoryFixture(t);
  const pullRequest = await mergeFixtureBranch(fixture);
  const worktreeResource = fixture.ownership.resources.find(
    (resource) => resource.resource_type === "git-worktree",
  );
  await fixture.adapter.retireResource({
    pullRequest,
    resource: worktreeResource,
    session: fixture.session,
  });
  const competingHead = git(fixture.repoRoot, [
    "commit-tree",
    `${pullRequest.head_commit}^{tree}`,
    "-p",
    pullRequest.head_commit,
    "-m",
    "advance local head",
  ]);
  let raced = false;
  const racingAdapter = createDeliveryArtWorkSessionSourceAdapter({
    workspaceRoot: fixture.workspaceRoot,
    execFileSyncImpl(executable, args, options) {
      if (!raced && args[0] === "update-ref" && args[1] === "-d") {
        raced = true;
        git(fixture.repoRoot, [
          "update-ref",
          `refs/heads/${fixture.session.landing_unit.branch}`,
          competingHead,
          pullRequest.head_commit,
        ]);
      }
      return execFileSync(executable, args, options);
    },
  });
  const localBranchResource = fixture.ownership.resources.find(
    (resource) => resource.resource_type === "git-local-branch",
  );

  await assert.rejects(
    racingAdapter.retireResource({
      pullRequest,
      resource: localBranchResource,
      session: fixture.session,
    }),
    /cannot lock ref/,
  );
  assert.equal(raced, true);
  assert.equal(
    git(fixture.repoRoot, [
      "rev-parse",
      `refs/heads/${fixture.session.landing_unit.branch}`,
    ]),
    competingHead,
  );
});

test("managed session state is removable only below its owned allowlist", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-retirement-state-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const store = createDeliveryArtWorkSessionStore({
    root,
    validateCleanupReceipt: validateDeliveryArtWorkSessionCleanupReceipt,
    validateDecision: validateDeliveryArtWorkSessionDecision,
    validateResourceManifest: validateDeliveryArtWorkSessionResourceManifest,
    validateSession: validateDeliveryArtWorkSession,
  });
  const session = {
    session_id: "work-session:delivery-958:delivery-958-work-item-968",
  };
  const managedRoot = store.managedStateRoot(session);
  await mkdir(path.join(managedRoot, "cache"), { recursive: true });
  await writeFile(
    path.join(managedRoot, ".ownership.json"),
    `${JSON.stringify({ session_id: session.session_id })}\n`,
    "utf8",
  );
  const resource = {
    resource_id: "resource:managed-state:operator-orchestration-service",
    resource_type: "managed-session-state",
    ownership_provenance: "session-created",
    retention_class: "retire-on-terminal-close",
    outcome: "pending",
    locator: {
      kind: "managed-session-state",
      relative_path: path.relative(root, managedRoot).split(path.sep).join("/"),
      ownership_marker: session.session_id,
    },
    last_error: null,
  };

  assert.equal(store.inspectManagedResource(session, resource).outcome, "eligible");
  store.retireManagedResource(session, resource);
  assert.equal(existsSync(managedRoot), false);

  const outside = structuredClone(resource);
  outside.locator.relative_path = "sessions/unowned";
  assert.equal(store.inspectManagedResource(session, outside).outcome, "blocked");
});

test("receipt replay repairs its alias index before active session removal", async () => {
  const session = {
    session_id: "work-session:delivery-958:delivery-958-work-item-968",
  };
  const receipt = { receipt_id: `cleanup-receipt:${session.session_id}` };
  let indexRepaired = false;
  let sessionRemoved = false;
  const retirement = createDeliveryArtWorkSessionResourceRetirementController({
    sourceAdapter: {
      async ensureOwnedWorktree() {},
      async inspectResourceOwnership() {},
      async planResourceRetirement() {},
      async resolveWorktree() {},
      async retireResource() {},
    },
    store: {
      inspectManagedResource() {},
      readArtifact() {},
      readCleanupReceiptByAlias() {},
      readCleanupReceiptBySessionId() {
        return receipt;
      },
      readResourceManifest() {},
      removeSession() {
        assert.equal(indexRepaired, true);
        sessionRemoved = true;
      },
      retireManagedResource() {},
      writeCleanupReceipt(_session, value) {
        assert.equal(value, receipt);
        indexRepaired = true;
        return value;
      },
      writeCleanupManifest() {},
      writeResourceManifest() {},
      writeSession() {},
    },
  });

  const result = await retirement.retire({ pullRequest: null, session });

  assert.equal(result.receipt, receipt);
  assert.equal(sessionRemoved, true);
});
