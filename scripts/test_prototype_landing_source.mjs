import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bindPrototypeLanding,
  prototypeLandingReference,
} from "../src/prototype-landing/contracts.js";
import { createPrototypeLandingService } from "../src/prototype-landing/service.js";
import { createPrototypeLandingSourceClient } from "../src/prototype-landing/source-client.js";
import { createPrototypeLandingStore } from "../src/prototype-landing/store.js";
import {
  at,
  caller,
  commandFixture,
  readinessFixture,
} from "../test-fixtures/prototype-landing/fixture.js";

const index = process.argv.indexOf("--authority-root");
if (index < 0) {
  throw new Error("Provide --authority-root for the committed Prototype Studio source.");
}

const authorityRoot = path.resolve(process.argv[index + 1]);
const authorityRevision = execFileSync(
  "git",
  ["-C", authorityRoot, "rev-parse", "refs/remotes/origin/main"],
  { encoding: "utf8" },
).trim();
const root = await mkdtemp(path.join(tmpdir(), "prototype-landing-conformance-"));
const repo = path.join(root, "workspace-prototype-studio");
const storeRoot = path.join(root, "state");
const git = (...args) => execFileSync(
  "git",
  ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
).trim();
const gitBytes = (...args) => execFileSync(
  "git",
  ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let checkCount = 0;
function pass(name) {
  checkCount += 1;
  console.log(`PASS ${name}`);
}

function commandFor(prototypeId, state) {
  const slug = prototypeId.replace(/^prototype:/, "");
  const input = commandFixture();
  input.authority_revision = state.authority_revision;
  input.entry_packet.entry_id = `prototype-entry:direct:${slug}`;
  input.entry_packet.source.ref = `operator-request:${slug}`;
  input.entry_packet.suggestions.name = "OOS Landing Proof";
  input.entry_packet = bindPrototypeLanding(input.entry_packet, "packet_digest");
  input.request.request_id = `prototype-landing-request:${slug}:1`;
  input.request.entry_packet_ref = prototypeLandingReference(input.entry_packet);
  input.request.prototype = {
    id: prototypeId,
    name: "OOS Landing Proof",
    objective: "Prove the durable Prototype Landing source path.",
  };
  input.request.source_plan.source_ref = `repo://workspace-prototype-studio/prototypes/${slug}`;
  input.request.expected_state = state.expected_state;
  input.request.idempotency_key = `landing:${slug}:1`;
  input.request.correlation_id = `correlation:${slug}:1`;
  input.request = bindPrototypeLanding(input.request, "request_digest");
  input.plan.plan_id = `prototype-landing-plan:${slug}:1`;
  input.plan.request_ref = prototypeLandingReference(input.request);
  input.plan.prototype_id = prototypeId;
  input.plan.source_plan = structuredClone(input.request.source_plan);
  input.plan.expected_outputs = input.plan.expected_outputs.map((output) => ({
    ...output,
    target_ref: output.target_ref.replaceAll("sample-tool", slug),
  }));
  input.plan = bindPrototypeLanding(input.plan, "plan_digest");
  input.operator_approval_ref = `approval:${slug}:1`;
  input.session_ref = `session:${slug}:1`;
  input.execution_ref = `execution:${slug}:1`;
  return input;
}

function localReviewProvider() {
  let review = null;

  function assertPreparedHead(preparation, headCommit) {
    assert.equal(git("rev-parse", `${headCommit}^`), preparation.base_commit);
    const actualPaths = git("diff", "--name-only", preparation.base_commit, headCommit)
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(actualPaths, preparation.files.map((file) => file.path).sort());
    for (const file of preparation.files) {
      assert.deepEqual(
        gitBytes("show", `${headCommit}:${file.path}`),
        Buffer.from(file.content_base64, "base64"),
      );
    }
  }

  return {
    async mainRevision() {
      return git("rev-parse", "refs/remotes/origin/main");
    },
    async prepareReview(preparation) {
      if (review) return structuredClone(review);
      git("checkout", "-B", preparation.branch, preparation.base_commit);
      for (const file of preparation.files) {
        const target = path.join(repo, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.content_base64, "base64"));
      }
      git("add", "--all");
      git("commit", "-m", "Prepare Prototype Landing conformance source");
      review = {
        repository: "workspace-prototype-studio",
        number: 1,
        url: "https://example.invalid/workspace-prototype-studio/pull/1",
        state: "open",
        branch: preparation.branch,
        base_branch: "main",
        base_commit: preparation.base_commit,
        head_commit: git("rev-parse", "HEAD"),
        merged: false,
        merge_commit: null,
        human_reviewed: false,
      };
      assertPreparedHead(preparation, review.head_commit);
      return structuredClone(review);
    },
    async review() {
      return structuredClone(review);
    },
    async findReview(branch) {
      return review?.branch === branch ? structuredClone(review) : null;
    },
    async verifyPreparedReview(preparation, value) {
      assertPreparedHead(preparation, value.head_commit);
    },
    async verifyPreparedBranch(preparation) {
      try {
        const headCommit = git("rev-parse", preparation.branch);
        assertPreparedHead(preparation, headCommit);
        return true;
      } catch {
        return false;
      }
    },
    async verifyMergedFiles(value, preparation) {
      git("merge-base", "--is-ancestor", value.merge_commit, "main");
      for (const file of preparation.files) {
        assert.deepEqual(
          gitBytes("show", `${value.merge_commit}:${file.path}`),
          Buffer.from(file.content_base64, "base64"),
        );
      }
    },
    async closeReview() {
      review.state = "closed";
    },
    setReview(changes) {
      review = { ...review, ...changes };
    },
    merge() {
      git("checkout", "main");
      git("merge", "--ff-only", review.branch);
      git("update-ref", "refs/remotes/origin/main", "main");
      review = {
        ...review,
        state: "closed",
        merged: true,
        merge_commit: git("rev-parse", "main"),
        human_reviewed: true,
      };
    },
  };
}

try {
  execFileSync("git", ["clone", "--shared", authorityRoot, repo], { stdio: "pipe" });
  git("config", "user.name", "Prototype Landing Conformance");
  git("config", "user.email", "prototype-landing@example.invalid");
  git("checkout", "-B", "main", authorityRevision);
  git("update-ref", "refs/remotes/origin/main", authorityRevision);

  const provider = localReviewProvider();
  const sourceClient = createPrototypeLandingSourceClient({
    authorityRoot: repo,
    provider,
    clock: () => new Date(at),
  });
  const service = createPrototypeLandingService({
    store: createPrototypeLandingStore({ root: storeRoot }),
    sourceClient,
    readinessClient: { evaluate: async (evaluation) => readinessFixture(evaluation) },
    clock: () => new Date(at),
  });

  const staleId = "prototype:stale-landing-proof";
  const staleState = await sourceClient.state(staleId);
  const staleInput = commandFor(staleId, staleState);
  await service.submit({ callerId: caller, input: staleInput });
  await writeFile(path.join(repo, "STALE_PROOF"), "new authority state\n");
  git("add", "STALE_PROOF");
  git("commit", "-m", "Advance authority for stale request proof");
  git("update-ref", "refs/remotes/origin/main", "main");
  await assert.rejects(
    service.advance({ callerId: caller, requestId: staleInput.request.request_id }),
    /Prototype Studio changed/,
  );
  const staleResult = await service.project(staleInput.request.request_id, { callerId: caller });
  assert.equal(staleResult.status, "preparing");
  assert.equal(staleResult.canonical_mutation, false);
  assert.equal(git("branch", "--list", "prototype-landing/*"), "");
  pass("stale authority is rejected before a source branch or canonical mutation exists");

  git("reset", "--hard", authorityRevision);
  git("update-ref", "refs/remotes/origin/main", authorityRevision);
  const prototypeId = "prototype:oos-landing-proof";
  const state = await sourceClient.state(prototypeId);
  const input = commandFor(prototypeId, state);
  const prepared = await service.prepare({ callerId: caller, input: { prototype_id: prototypeId } });
  assert.equal(prepared.canonical_mutation, false);
  assert.equal(prepared.authority_revision, authorityRevision);
  await service.submit({ callerId: caller, input });
  const waiting = await service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.ok(waiting.preparation.file_count >= 8);
  assert.ok(waiting.preparation.changed_paths.includes("prototypes.yaml"));
  assert.ok(waiting.preparation.changed_paths.includes("records/prototype-landings/oos-landing-proof/record.json"));
  assert.equal(waiting.preparation.readback.authority_state, "review-branch");
  assert.equal(waiting.preparation.receipt.outcome, "prepared");
  pass("one exact-parent review branch contains only the bounded generated source set");

  provider.setReview({ head_commit: authorityRevision });
  await assert.rejects(
    service.advance({ callerId: caller, requestId: input.request.request_id }),
    /review no longer matches/,
  );
  const rejectedHead = await service.project(input.request.request_id, { callerId: caller });
  assert.equal(rejectedHead.status, "review-required");
  assert.equal(rejectedHead.canonical_mutation, false);
  provider.setReview({ head_commit: waiting.review.head_commit });
  pass("changed review head is rejected without false success projection");

  provider.merge();
  const completed = await service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.canonical_mutation, true);
  assert.equal(completed.readback.source_revision, git("rev-parse", "main"));
  assert.equal(completed.receipt.next_action.code, "candidate-promotion");
  assert.deepEqual(
    await service.advance({ callerId: caller, requestId: input.request.request_id }),
    completed,
  );
  assert.equal(git("status", "--short"), "");
  pass("human-reviewed canonical merge readback succeeds and terminal replay is stable");

  console.log(
    `Prototype Landing real-Git conformance: ${checkCount} cases passed from ${authorityRevision}.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
