import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bindPrototypeLanding,
  createPrototypeLandingEvaluation,
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
const wgcfIndex = process.argv.indexOf("--wgcf-root");
const wgcfPythonIndex = process.argv.indexOf("--wgcf-python");
const evidenceIndex = process.argv.indexOf("--evidence-output");
const wgcfRoot = wgcfIndex < 0 ? null : path.resolve(process.argv[wgcfIndex + 1]);
const evidenceOutput = evidenceIndex < 0 ? null : path.resolve(process.argv[evidenceIndex + 1]);
const composedConformance = process.env.npm_lifecycle_event === "test:prototype-landing-conformance";
if (composedConformance && (!wgcfRoot || wgcfPythonIndex < 0 || !evidenceOutput)) {
  throw new Error("Composed conformance requires --wgcf-root, --wgcf-python, and --evidence-output.");
}
const wgcfPython = wgcfRoot
  ? path.resolve(
      wgcfPythonIndex < 0
        ? path.join(wgcfRoot, ".venv", "bin", "python")
        : process.argv[wgcfPythonIndex + 1],
    )
  : null;
const wgcfEvaluator = fileURLToPath(
  new URL("./evaluate_prototype_landing_wgcf.py", import.meta.url),
);
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
const cases = [];
function pass(name) {
  checkCount += 1;
  cases.push({ name, outcome: "passed" });
  console.log(`PASS ${name}`);
}

function exactRevision(rootPath) {
  return execFileSync(
    "git",
    ["-C", rootPath, "rev-parse", "refs/remotes/origin/main"],
    { encoding: "utf8" },
  ).trim();
}

function createReadinessClient() {
  if (!wgcfRoot) {
    return { evaluate: async (evaluation) => readinessFixture(evaluation) };
  }
  return {
    async evaluate(evaluation) {
      const output = execFileSync(
        wgcfPython,
        [wgcfEvaluator, "--wgcf-root", wgcfRoot, "--authority-root", repo],
        {
          encoding: "utf8",
          input: JSON.stringify(evaluation),
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const evaluated = JSON.parse(output);
      assert.equal(evaluated.proof.issue_resolution, "created");
      assert.equal(evaluated.proof.replay_resolution, "reused");
      assert.equal(evaluated.proof.readback_resolution, "read");
      assert.equal(evaluated.proof.authority_revision, git("rev-parse", "refs/remotes/origin/main"));
      assert.equal(evaluated.proof.implementation_ref, exactRevision(wgcfRoot));
      return evaluated.result;
    },
  };
}

function rebindCommand(input) {
  input.request = bindPrototypeLanding(input.request, "request_digest");
  input.plan.request_ref = prototypeLandingReference(input.request);
  input.plan = bindPrototypeLanding(input.plan, "plan_digest");
  return input;
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
  const readinessClient = createReadinessClient();
  const createService = () => createPrototypeLandingService({
    store: createPrototypeLandingStore({ root: storeRoot }),
    sourceClient,
    readinessClient,
    clock: () => new Date(at),
  });
  let service = createService();

  if (wgcfRoot) {
    const blockedId = "prototype:blocked-landing-proof";
    const blockedState = await sourceClient.state(blockedId);
    const blockedInput = commandFor(blockedId, blockedState);
    blockedInput.request.setup.support_profile = "custom";
    blockedInput.request.setup.support_rows.forEach((row) => {
      row.generated = false;
    });
    blockedInput.request.setup.support_rows.find(
      (row) => row.dimension === "runtime",
    ).state = "unknown";
    rebindCommand(blockedInput);
    const blockedEvaluation = createPrototypeLandingEvaluation(blockedInput, caller);
    const blockedReadiness = await readinessClient.evaluate(blockedEvaluation);
    assert.equal(blockedReadiness.readiness.outcome, "blocked");
    assert.equal(git("branch", "--list", "prototype-landing/*"), "");
    pass("actual WGCF policy blocks unresolved support without source mutation");
  }

  const staleId = "prototype:stale-landing-proof";
  const staleState = await sourceClient.state(staleId);
  const staleInput = commandFor(staleId, staleState);
  let advanceAfterReadiness = true;
  const staleService = createPrototypeLandingService({
    store: createPrototypeLandingStore({ root: path.join(root, "stale-state") }),
    sourceClient,
    readinessClient: {
      async evaluate(evaluation) {
        const result = await readinessClient.evaluate(evaluation);
        if (advanceAfterReadiness) {
          advanceAfterReadiness = false;
          await writeFile(path.join(repo, "STALE_PROOF"), "new authority state\n");
          git("add", "STALE_PROOF");
          git("commit", "-m", "Advance authority after readiness proof");
          git("update-ref", "refs/remotes/origin/main", "main");
        }
        return result;
      },
    },
    clock: () => new Date(at),
  });
  await staleService.submit({ callerId: caller, input: staleInput });
  await assert.rejects(
    staleService.advance({ callerId: caller, requestId: staleInput.request.request_id }),
    /Prototype Studio changed/,
  );
  const staleResult = await staleService.project(staleInput.request.request_id, { callerId: caller });
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

  service = createService();
  const resumed = await service.project(input.request.request_id, { callerId: caller });
  assert.equal(resumed.status, "review-required");
  assert.equal(resumed.review.head_commit, waiting.review.head_commit);
  pass("durable review wait resumes from persisted state after service reconstruction");

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

  if (evidenceOutput) {
    await mkdir(path.dirname(evidenceOutput), { recursive: true });
    await writeFile(evidenceOutput, `${JSON.stringify({
      schema_version: 1,
      proof_type: "prototype-landing-composed-conformance",
      generated_at: new Date().toISOString(),
      runtime_scope: "isolated-dev-integration-conformance",
      normal_runtime_activation: false,
      source_revisions: {
        operator_orchestration_service: execFileSync(
          "git",
          ["-C", path.dirname(fileURLToPath(import.meta.url)), "rev-parse", "HEAD"],
          { encoding: "utf8" },
        ).trim(),
        workspace_governance_control_fabric: wgcfRoot ? exactRevision(wgcfRoot) : null,
        workspace_prototype_studio: authorityRevision,
      },
      cases,
      canonical_authority: {
        repo: "workspace-prototype-studio",
        revision_before: authorityRevision,
        revision_after: exactRevision(authorityRoot),
        unchanged: exactRevision(authorityRoot) === authorityRevision,
      },
      result: "passed",
    }, null, 2)}\n`);
  }

  console.log(
    `Prototype Landing real-Git conformance: ${checkCount} cases passed from ${authorityRevision}.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
