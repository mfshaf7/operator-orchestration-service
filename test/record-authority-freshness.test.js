import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { requireRecordAuthorityFreshness } from "../src/record-authority-freshness.js";
import { createPrototypeLandingSourceClient } from "../src/prototype-landing/source-client.js";
import { createProposalTargetSourceClient } from "../src/proposal-target-application/source-client.js";
import { createPrototypeMaturitySourceClient } from "../src/prototype-maturity/source-client.js";
import { createPrototypeClosureSourceClient } from "../src/prototype-closure/source-client.js";
import { createWorkspaceIntakeSourceClient } from "../src/workspace-intake/source-client.js";
import { createWorkspaceInventorySourceClient } from "../src/workspace-inventory/source-client.js";

const execute = promisify(execFile);
const git = async (root, ...args) => (await execute("git", ["-C", root, ...args])).stdout.trim();
const now = "2026-10-16T07:00:00.000Z";
const clock = () => new Date(now);

test("deployment checkpoint permits real Git record advancement, but denies expiry, ref mismatch, owner confusion and symlink substitution", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-record-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Synthetic Test");
  await git(root, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(root, "record.json"), "{}");
  await git(root, "add", "."); await git(root, "commit", "-m", "Reviewed synthetic source");
  const base = await git(root, "rev-parse", "HEAD");
  await writeFile(path.join(root, "record.json"), '{"version":2}');
  await git(root, "add", "."); await git(root, "commit", "-m", "Approved synthetic record");
  const revision = await git(root, "rev-parse", "HEAD");
  await git(root, "update-ref", "refs/remotes/origin/main", revision);
  const checkpoint = { schema_version: 1, owner_repo: "workspace-prototype-studio", trusted_ref: "refs/remotes/origin/main", reviewed_revision: base, record_revision: revision, observed_at: now, valid_until: "2026-10-16T07:10:00.000Z" };
  const file = path.join(root, ".git/console-record-authority.json");
  const options = { authorityRoot: root, git, ownerRepo: checkpoint.owner_repo, clock, required: true };
  const denied = () => assert.rejects(requireRecordAuthorityFreshness(options), { code: "record_authority_unavailable", statusCode: 503 });
  await denied();
  await writeFile(file, JSON.stringify(checkpoint));
  await requireRecordAuthorityFreshness(options);
  assert.equal(await git(root, "status", "--porcelain"), "");
  assert.equal(await git(root, "rev-parse", "HEAD"), revision);
  for (const delta of [
    { valid_until: now }, { valid_until: "2026-10-16T07:11:00.000Z" },
    { observed_at: "2026-10-16T07:01:00.000Z" },
    { owner_repo: "workspace-governance" }, { record_revision: base },
    { reviewed_revision: "a".repeat(40) }, { trusted_ref: "HEAD" },
  ]) {
    await writeFile(file, JSON.stringify({ ...checkpoint, ...delta })); await denied();
  }
  await rm(file);
  await writeFile(path.join(root, "checkpoint.json"), JSON.stringify(checkpoint));
  await symlink(path.join(root, "checkpoint.json"), file);
  await denied();
});

test("every existing Studio and Workspace source adapter denies a missing commissioned checkpoint before owner execution", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-record-clients-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED;
  process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED;
    else process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED = previous;
  });
  await mkdir(path.join(root, ".git"));
  const options = { authorityRoot: root, clock, provider: { mainRevision: async () => "a".repeat(40) } };
  for (const create of [createPrototypeLandingSourceClient, createProposalTargetSourceClient, createPrototypeMaturitySourceClient, createPrototypeClosureSourceClient, createWorkspaceIntakeSourceClient, createWorkspaceInventorySourceClient]) {
    const client = create(options);
    await assert.rejects(client.state("prototype:sample"), (error) => error.statusCode === 503);
  }
  await assert.rejects(createPrototypeLandingSourceClient(options).records(), { code: "record_authority_unavailable" });
});
