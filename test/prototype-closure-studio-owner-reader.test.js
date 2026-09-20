import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrototypeClosureSourceClient } from "../src/prototype-closure/source-client.js";

const studioRoot = process.env.OOS_PROTOTYPE_STUDIO_ROOT;
const prototypeId = "client-review-portal";
const operatorId = "operator:owner-readback-test";
const reason = "Retain source for isolated owner-readback proof";

test("Studio retention proof binds a committed plan and exact operator decision", { skip: !studioRoot }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "oos-studio-owner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "studio");
  const studioRevision = execFileSync("git", ["-C", studioRoot, "rev-parse", "refs/remotes/origin/main"],
    { encoding: "utf8" }).trim();
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
  execFileSync("git", ["clone", "--shared", "--template=", studioRoot, source]);
  git("checkout", "-b", "owner-readback-test", studioRevision);
  git("config", "user.name", "Closure test");
  git("config", "user.email", "closure-test@example.invalid");
  const prepared = JSON.parse(execFileSync("python3", [
    path.join(source, "scripts/prototype_closure.py"), "--repo-root", source,
    "prepare-retention", "--prototype-id", prototypeId,
    "--operator-id", operatorId, "--reason", reason,
  ], { encoding: "utf8" }));
  git("add", "--", path.relative(source, prepared.path));
  git("commit", "-m", "Prepare isolated retention plan");
  const revision = git("rev-parse", "HEAD");
  git("branch", "main", revision);
  git("update-ref", "refs/remotes/origin/main", revision);
  const client = createPrototypeClosureSourceClient({
    authorityRoot: source, provider: { mainRevision: async () => revision },
  });
  const lookup = {
    field: "retention_plan_ref", ref: prepared.ref,
    prototype_id: prototypeId, source_revision: revision,
    operator_id: operatorId, retirement_reason: reason,
  };
  const proof = await client.ownerReadback(lookup);
  assert.equal(proof.ref, prepared.ref);
  assert.equal(proof.source_revision, revision);
  assert.equal(proof.digest, prepared.digest);
  await assert.rejects(client.ownerReadback({ ...lookup, retirement_reason: "different decision" }),
    { code: "prototype_closure_retention_decision_mismatch" });
  await assert.rejects(client.ownerReadback({ ...lookup, source_revision: "a".repeat(40) }),
    { code: "prototype_closure_authority_stale" });
});
