import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  bindPrototypeMaturity,
  createPrototypeMaturityDecision,
  createPrototypeMaturityEvaluation,
  prototypeMaturityDigest,
  prototypeMaturityReference,
} from "../src/prototype-maturity/contracts.js";
import { createPrototypeMaturitySourceClient } from "../src/prototype-maturity/source-client.js";
import {
  at,
  caller,
  commandFixture,
  readinessFixture,
} from "../test-fixtures/prototype-maturity/fixture.js";

const authorityIndex = process.argv.indexOf("--authority-root");
if (authorityIndex < 0 || !process.argv[authorityIndex + 1]) {
  throw new Error(
    "Provide --authority-root for the committed Prototype Studio source.",
  );
}
const studioRoot = path.resolve(process.argv[authorityIndex + 1]);

function git(root, ...args) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function commandFor(state, sequence) {
  const input = commandFixture("candidate-promotion", sequence);
  const slug = state.prototype_id.replace(/^prototype:/, "");
  input.authority_revision = state.authority_revision;
  input.request.request_id = `prototype-maturity-request:${slug}:${sequence}`;
  input.request.prototype_id = state.prototype_id;
  input.request.expected_state = structuredClone(state.expected_state);
  input.request.inputs.source_refs = input.request.inputs.source_refs.map((value) =>
    value.replaceAll("sample-tool", slug),
  );
  input.request.correlation_id = `prototype-maturity:${slug}:${sequence}`;
  input.request.idempotency_key = `prototype-maturity:${slug}:${sequence}`;
  input.request = bindPrototypeMaturity(input.request, "request_digest");
  input.packet.packet_id = `prototype-maturity-packet:${slug}:${sequence}`;
  input.packet.prototype_id = state.prototype_id;
  input.packet.request_ref = prototypeMaturityReference(input.request);
  input.packet.sections = input.packet.sections.map((section) => ({
    ...section,
    evidence_refs: section.evidence_refs.map((value) =>
      value.replaceAll("sample-tool", slug),
    ),
  }));
  input.packet = bindPrototypeMaturity(input.packet, "packet_digest");
  return input;
}

function recordFor(input, decisionValue, blocker = null) {
  const evaluation = createPrototypeMaturityEvaluation(input, caller);
  const readiness = readinessFixture(evaluation);
  const record = {
    caller_id: caller,
    evaluation,
    readiness,
    decision: null,
    preparation: null,
    review: null,
  };
  record.binding_digest = prototypeMaturityDigest({ caller_id: caller, evaluation });
  record.decision = createPrototypeMaturityDecision({
    evaluation,
    readiness: readiness.readiness,
    operatorRef: caller,
    decision: decisionValue,
    blocker,
    sourceBranch: `prototype-maturity/${record.binding_digest.slice(7)}`,
    decidedAt: at,
  });
  return record;
}

test("source client proves unchanged decisions and exact reviewed promotion", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "oos-maturity-source-test-"));
  const repo = path.join(root, "workspace-prototype-studio");
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["clone", "--shared", studioRoot, repo], { stdio: "pipe" });
  git(repo, "config", "user.name", "Prototype Maturity Test");
  git(repo, "config", "user.email", "prototype-maturity@example.invalid");
  git(repo, "checkout", "-B", "main", "origin/main");

  let review = null;
  const provider = {
    async mainRevision() {
      return git(repo, "rev-parse", "refs/remotes/origin/main");
    },
    async prepareReview(preparation) {
      git(repo, "checkout", "-B", preparation.branch, preparation.base_commit);
      for (const file of preparation.files) {
        const destination = path.join(repo, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, Buffer.from(file.content_base64, "base64"));
      }
      git(repo, "add", "--all");
      git(repo, "commit", "-m", "Prepare Prototype maturity test source");
      review = {
        repository: "workspace-prototype-studio",
        number: 1,
        url: "https://example.invalid/pull/1",
        state: "open",
        branch: preparation.branch,
        base_branch: "main",
        base_commit: preparation.base_commit,
        head_commit: git(repo, "rev-parse", "HEAD"),
        merged: false,
        merge_commit: null,
        human_reviewed: false,
      };
      return structuredClone(review);
    },
    async review() {
      return structuredClone(review);
    },
    async findReview(branch) {
      return review?.branch === branch ? structuredClone(review) : null;
    },
    async verifyPreparedReview(preparation, value) {
      assert.equal(value.head_commit, git(repo, "rev-parse", preparation.branch));
    },
    async verifyPreparedBranch() {
      return false;
    },
    async verifyMergedFiles(value, preparation) {
      git(repo, "merge-base", "--is-ancestor", value.merge_commit, "main");
      for (const file of preparation.files) {
        assert.deepEqual(
          execFileSync("git", ["-C", repo, "show", `${value.merge_commit}:${file.path}`]),
          Buffer.from(file.content_base64, "base64"),
        );
      }
    },
    async closeReview() {
      review.state = "closed";
    },
  };
  const source = createPrototypeMaturitySourceClient({
    authorityRoot: repo,
    provider,
    clock: () => new Date(at),
  });
  const state = await source.state("prototype:client-review-portal");
  assert.equal(state.expected_state.lifecycle, "exploring");

  const block = recordFor(
    commandFor(state, 3),
    "block-promotion",
    {
      issue_ref: "openproject://work_packages/999",
      owner_ref: "workspace-prototype-studio",
      required_fix: "Resolve the visible evidence gap.",
    },
  );
  const unchanged = await source.prepare(block, () => {});
  assert.equal(unchanged.source_result.outcome, "unchanged");
  assert.equal(unchanged.readback.authority_state, "unchanged-authority");
  assert.equal(git(repo, "status", "--short"), "");

  const promotion = recordFor(commandFor(state, 1), "promote-candidate");
  promotion.preparation = await source.prepare(promotion, () => {});
  assert.equal(promotion.preparation.source_result.outcome, "prepared");
  assert.deepEqual(promotion.preparation.changed_paths, [
    "prototypes.yaml",
    "records/prototype-maturity/client-review-portal/candidate.json",
    "records/prototype-maturity/client-review-portal/history/prototype-maturity-decision-client-review-portal-1.json",
  ]);
  promotion.review = await source.openReview(promotion, () => {});
  git(repo, "checkout", "main");
  git(repo, "merge", "--ff-only", promotion.review.branch);
  git(repo, "update-ref", "refs/remotes/origin/main", "main");
  review = {
    ...review,
    state: "closed",
    merged: true,
    merge_commit: git(repo, "rev-parse", "main"),
    human_reviewed: true,
  };
  const merged = await source.observe(promotion, () => {});
  assert.equal(merged.readback.authority_state, "merged-authority");
  assert.equal(merged.readback.observed_lifecycle, "candidate");
  assert.equal(merged.readback.source_revision, review.merge_commit);
  assert.equal(
    merged.readback.record_digest,
    promotion.preparation.source_result.record_digest,
  );
  assert.equal((await readFile(path.join(repo, "prototypes.yaml"), "utf8")).includes("client-review-portal"), true);
});
