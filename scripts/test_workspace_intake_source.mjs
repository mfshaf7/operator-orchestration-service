import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceIntakeSourceClient } from "../src/workspace-intake/source-client.js";
import { createWorkspaceIntakeService } from "../src/workspace-intake/service.js";
import { createWorkspaceIntakeStore } from "../src/workspace-intake/store.js";
import { assertIntake, intakeManifest } from "../src/workspace-intake/contracts.js";
import { at, caller, inputFixture, readinessFixture } from "../test-fixtures/workspace-intake/fixture.js";

const index = process.argv.indexOf("--authority-root");
if (index < 0) throw new Error("Provide --authority-root for the committed Workspace Governance test source.");
const authority = path.resolve(process.argv[index + 1]);
const root = await mkdtemp(path.join(tmpdir(), "intake-conformance-"));
const repo = path.join(root, "workspace-governance");
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let checks = 0;
function pass(name) { checks += 1; console.log(`PASS ${name}`); }
try {
  execFileSync("git", ["clone", "--shared", authority, repo], { stdio: "pipe" });
  const base = intakeManifest.files["workspace-intake.yaml"].commit;
  git("checkout", "-B", "main", base);
  git("update-ref", "refs/remotes/origin/main", base);
  git("config", "user.name", "Intake Conformance");
  git("config", "user.email", "intake@example.invalid");
  const state = JSON.parse(execFileSync("python3", [path.join(repo, "scripts/workspace_intake.py"), "state", "--kind", "product", "--name", "intake-proof"], { encoding: "utf8" }));
  const input = inputFixture(state.expected_state, base);
  let review = null;
  const provider = {
    async mainRevision() { return git("rev-parse", "main"); },
    async prepareReview(preparation) {
      if (review) return structuredClone(review);
      git("checkout", "-b", preparation.branch, base);
      await writeFile(path.join(repo, "contracts/intake-register.yaml"), preparation.register_text);
      git("add", "contracts/intake-register.yaml"); git("commit", "-m", "Reviewed intake test change");
      review = { repository: "workspace-governance", number: 1, url: "https://example.invalid/pull/1", state: "open", branch: preparation.branch,
        base_branch: "main", base_commit: base, head_commit: git("rev-parse", "HEAD"), merged: false, merge_commit: null, human_reviewed: false };
      return structuredClone(review);
    },
    async review() { return structuredClone(review); },
    async findReview() { return structuredClone(review); },
    async verifyPreparedReview(preparation, value) {
      assert.equal(git("show", `${value.head_commit}:contracts/intake-register.yaml`), preparation.register_text.trim());
    },
    async closeReview() { review.state = "closed"; },
    async readMergedRegister(value) {
      git("merge-base", "--is-ancestor", value.merge_commit, "main");
      return execFileSync("git", ["-C", repo, "show", `${value.merge_commit}:contracts/intake-register.yaml`], { encoding: "utf8" });
    },
  };
  const sourceClient = createWorkspaceIntakeSourceClient({ authorityRoot: repo, provider, clock: () => new Date(at) });
  const preparedState = await sourceClient.state({ kind: "product", name: "intake-proof" });
  assert.equal(preparedState.authority_revision, base);
  assert.deepEqual(preparedState.target, state.target);
  assert.deepEqual(preparedState.expected_state, state.expected_state);
  assert.equal(git("status", "--short"), "");
  pass("read-only preparation returns current committed bindings without source mutation");
  const storeRoot = path.join(root, "state");
  const make = () => createWorkspaceIntakeService({ store: createWorkspaceIntakeStore({ root: storeRoot }), sourceClient,
    readinessClient: { evaluate: async (evaluation) => readinessFixture(evaluation) }, clock: () => new Date(at) });
  const service = make();
  await service.submit({ callerId: caller, input });
  const prepared = await service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(prepared.status, "review-required");
  assert.equal(prepared.receipt, null);
  assert.equal(git("rev-parse", "main"), base);
  pass("owner command prepares only a review branch; no canonical success before merge");
  const stored = await createWorkspaceIntakeStore({ root: storeRoot }).get(input.request.request_id);
  assertIntake("mutation", stored.preparation.mutation);
  assertIntake("readback", stored.preparation.readback);
  const prior = review.head_commit;
  review.head_commit = "a".repeat(40);
  await assert.rejects(make().advance({ callerId: caller, requestId: input.request.request_id }), /source no longer matches/);
  review.head_commit = prior;
  const recovered = await make().advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(recovered.failure, null);
  assert.equal(recovered.next_action, "review-and-merge");
  pass("changed review head is denied after service restart");
  git("checkout", "main"); git("merge", "--no-ff", review.head_commit, "-m", "Human-reviewed test merge");
  review.merged = true; review.state = "closed"; review.merge_commit = git("rev-parse", "main");
  await assert.rejects(make().advance({ callerId: caller, requestId: input.request.request_id }), /human review/);
  review.human_reviewed = true;
  const result = await make().advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "succeeded"); assertIntake("receipt", result.receipt); assertIntake("readback", result.readback);
  assert.equal(result.readback.record.record.version, 1);
  assert.deepEqual(await make().advance({ callerId: caller, requestId: input.request.request_id }), result);
  pass("exact reviewed real-Git merge produces canonical readback and replay-stable receipt");

  const crashRoot = path.join(root, "crash-state");
  const fixturePath = path.join(root, "fixture.json");
  await writeFile(fixturePath, JSON.stringify({ input, preparation: stored.preparation, review, readback: result.readback }));
  const worker = fileURLToPath(new URL("../test-fixtures/workspace-intake/crash-worker.mjs", import.meta.url));
  const killed = spawnSync(process.execPath, [worker, crashRoot, fixturePath, "crash"], { encoding: "utf8", timeout: 20000 });
  assert.equal(killed.signal, "SIGKILL", killed.stderr);
  const resumed = spawnSync(process.execPath, [worker, crashRoot, fixturePath, "resume"], { encoding: "utf8", timeout: 20000 });
  assert.equal(resumed.status, 0, resumed.stderr);
  const resumedResult = JSON.parse(resumed.stdout);
  assert.equal(resumedResult.status, "succeeded");
  assert.equal(JSON.parse(await readFile(path.join(crashRoot, "provider.json"), "utf8")).creates, 1);
  pass("SIGKILL after remote acknowledgement recovers one change through a fresh process");
  const cancelledRoot = path.join(root, "cancel-state");
  const cancelled = spawnSync(process.execPath, [worker, cancelledRoot, fixturePath, "cancel"], { encoding: "utf8", timeout: 20000 });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");
  pass("cancelled request survives new process without source mutation");
  console.log(`Workspace Intake real-Git/process-crash conformance: ${checks} checks passed.`);
} finally { await rm(root, { recursive: true, force: true }); }
