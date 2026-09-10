import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindPrototypeMaturity,
  createPrototypeMaturityEvaluation,
} from "../src/prototype-maturity/contracts.js";
import { createPrototypeMaturityService } from "../src/prototype-maturity/service.js";
import { createPrototypeMaturitySourceClient } from "../src/prototype-maturity/source-client.js";
import { createPrototypeMaturityStore } from "../src/prototype-maturity/store.js";
import { at, caller } from "../test-fixtures/prototype-maturity/fixture.js";

const CASES = {
  gitNegative: "case:prototype-work-1100-git-negative",
  gitPositive: "case:prototype-work-1100-git-positive",
  negative: "case:prototype-work-1100-negative",
  positive: "case:prototype-work-1100-positive",
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const requiredArguments = [
  "--authority-root",
  "--console-root",
  "--evidence-output",
  "--wgcf-root",
  "--wgcf-python",
];
for (const name of requiredArguments) {
  if (!argument(name)) throw new Error(`Composed conformance requires ${name}.`);
}

const authorityRoot = path.resolve(argument("--authority-root"));
const consoleRoot = path.resolve(argument("--console-root"));
const evidenceOutput = path.resolve(argument("--evidence-output"));
const wgcfRoot = path.resolve(argument("--wgcf-root"));
const wgcfPython = path.resolve(argument("--wgcf-python"));
const wgcfEvaluator = fileURLToPath(
  new URL("./evaluate_prototype_maturity_wgcf.py", import.meta.url),
);
const oosRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function git(root, ...args) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function gitBytes(root, ...args) {
  return execFileSync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function exactOriginMain(root) {
  const revision = git(root, "rev-parse", "refs/remotes/origin/main");
  assert.equal(git(root, "rev-parse", "HEAD"), revision, `${root} is not at origin/main`);
  assert.equal(git(root, "status", "--short"), "", `${root} is not clean`);
  return revision;
}

const dependencyRevisions = {
  governance_operations_console: exactOriginMain(consoleRoot),
  workspace_governance_control_fabric: exactOriginMain(wgcfRoot),
  workspace_prototype_studio: exactOriginMain(authorityRoot),
};

const consoleClient = await import(
  pathToFileURL(
    path.join(
      consoleRoot,
      "src/domain-workspaces/prototype/server/prototype-maturity-oos-client.ts",
    ),
  ).href
);
const consoleContract = await import(
  pathToFileURL(
    path.join(
      consoleRoot,
      "src/domain-workspaces/prototype/live-runtime/prototype-maturity-live-contract.ts",
    ),
  ).href
);
const consoleProjection = await import(
  pathToFileURL(
    path.join(
      consoleRoot,
      "src/domain-workspaces/prototype/live-runtime/prototype-maturity-live-projection.ts",
    ),
  ).href
);
const consoleReadModel = await import(
  pathToFileURL(
    path.join(
      consoleRoot,
      "src/domain-workspaces/prototype/read-model/prototype-workspace-read-model.ts",
    ),
  ).href
);

const root = await mkdtemp(path.join(tmpdir(), "prototype-maturity-conformance-"));
const repo = path.join(root, "workspace-prototype-studio");
const initialRevision = dependencyRevisions.workspace_prototype_studio;
const scenarios = [];

function pass(name, ...caseIds) {
  scenarios.push({ case_ids: caseIds, name, outcome: "passed" });
  console.log(`PASS ${name}`);
}

function createReadinessClient() {
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
      assert.equal(evaluated.proof.authority_revision, git(repo, "rev-parse", "refs/remotes/origin/main"));
      assert.equal(
        evaluated.proof.implementation_ref,
        dependencyRevisions.workspace_governance_control_fabric,
      );
      return evaluated.result;
    },
  };
}

function localReviewProvider() {
  const reviews = new Map();
  let nextNumber = 1;

  function assertPreparedHead(preparation, headCommit) {
    assert.equal(git(repo, "rev-parse", `${headCommit}^`), preparation.base_commit);
    const actualPaths = git(repo, "diff", "--name-only", preparation.base_commit, headCommit)
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(actualPaths, preparation.files.map((file) => file.path).sort());
    for (const file of preparation.files) {
      assert.deepEqual(
        gitBytes(repo, "show", `${headCommit}:${file.path}`),
        Buffer.from(file.content_base64, "base64"),
      );
    }
  }

  function byBranch(branch) {
    return [...reviews.values()].find((review) => review.branch === branch) ?? null;
  }

  return {
    async mainRevision() {
      return git(repo, "rev-parse", "refs/remotes/origin/main");
    },
    async prepareReview(preparation) {
      const existing = byBranch(preparation.branch);
      if (existing) return structuredClone(existing);
      git(repo, "checkout", "-B", preparation.branch, preparation.base_commit);
      for (const file of preparation.files) {
        const target = path.join(repo, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(file.content_base64, "base64"));
      }
      git(repo, "add", "--all");
      git(repo, "commit", "-m", "Prepare Prototype Maturity conformance source");
      const review = {
        repository: "workspace-prototype-studio",
        number: nextNumber++,
        url: `https://example.invalid/workspace-prototype-studio/pull/${nextNumber - 1}`,
        state: "open",
        branch: preparation.branch,
        base_branch: "main",
        base_commit: preparation.base_commit,
        head_commit: git(repo, "rev-parse", "HEAD"),
        merged: false,
        merge_commit: null,
        human_reviewed: false,
      };
      assertPreparedHead(preparation, review.head_commit);
      reviews.set(review.number, review);
      return structuredClone(review);
    },
    async review(number) {
      return structuredClone(reviews.get(number));
    },
    async findReview(branch) {
      return structuredClone(byBranch(branch));
    },
    async verifyPreparedReview(preparation, review) {
      assertPreparedHead(preparation, review.head_commit);
    },
    async verifyPreparedBranch(preparation) {
      try {
        assertPreparedHead(preparation, git(repo, "rev-parse", preparation.branch));
        return true;
      } catch {
        return false;
      }
    },
    async verifyMergedFiles(review, preparation) {
      git(repo, "merge-base", "--is-ancestor", review.merge_commit, "main");
      for (const file of preparation.files) {
        assert.deepEqual(
          gitBytes(repo, "show", `${review.merge_commit}:${file.path}`),
          Buffer.from(file.content_base64, "base64"),
        );
      }
    },
    async closeReview(review) {
      reviews.set(review.number, { ...reviews.get(review.number), state: "closed" });
    },
    merge(number) {
      const review = reviews.get(number);
      git(repo, "checkout", "main");
      git(repo, "merge", "--ff-only", review.branch);
      git(repo, "update-ref", "refs/remotes/origin/main", "main");
      reviews.set(number, {
        ...review,
        state: "closed",
        merged: true,
        merge_commit: git(repo, "rev-parse", "main"),
        human_reviewed: true,
      });
      return structuredClone(reviews.get(number));
    },
    update(number, changes) {
      reviews.set(number, { ...reviews.get(number), ...changes });
      return structuredClone(reviews.get(number));
    },
  };
}

function reviewedPreparation(state, transition) {
  return {
    authority_revision: state.authority_revision,
    canonical_authority: {
      branch: "main",
      registry_path: "prototypes.yaml",
      repo: "workspace-prototype-studio",
    },
    canonical_mutation: false,
    expected_state: state.expected_state,
    prototype_id: state.prototype_id,
    schema_version: 1,
    transition,
    workflow_id: "prototype-maturity",
  };
}

function consoleIntent(state, transition, sequence, decision, blocker = null) {
  const baseline = transition === "baseline-promotion";
  const evidenceRefs = baseline
    ? ["record://prototype-maturity/client-review-portal/candidate"]
    : [];
  return {
    accepted_at: at,
    input: baseline
      ? {
          transition,
          input: {
            baselineStatement: "The reviewed prototype workflow is accepted locally.",
            baselineTitle: "Client review portal baseline",
            decision,
            evidenceDisposition: "Current committed evidence supports this local baseline.",
            issueDisposition: "No visible issue blocks local baseline approval.",
          },
        }
      : {
          transition,
          input: {
            audience: { kind: "internal-user", label: "Workspace operator" },
            decision,
            objective: "Prove one bounded and reviewable client status workflow.",
            proof: {
              criterion: "The reviewed workflow behaves deterministically.",
              method: "technical-validation",
            },
            scope: {
              excluded: ["Delivery and runtime authority"],
              included: ["Local prototype workflow and synthetic evidence"],
            },
          },
        },
    prototype_id: state.prototype_id,
    record: {
      accepted_scope: ["Local prototype workflow and synthetic evidence"],
      blocker,
      evidence_refs: evidenceRefs,
      excluded_scope: ["Delivery and runtime authority"],
      landing_receipt_ref: "record://prototype-landings/client-review-portal",
      owner_ref: "workspace-prototype-studio",
      source_ref: "repo://workspace-prototype-studio/docs/prototypes/client-review-portal/brief.md",
    },
    request_id: `prototype-maturity-request:client-review-portal:${sequence}`,
    reviewed_preparation: reviewedPreparation(state, transition),
  };
}

function commandFor(state, transition, sequence, decision, blocker = null) {
  const intent = consoleIntent(state, transition, sequence, decision, blocker);
  const command = consoleClient.buildPrototypeMaturityCommand(
    intent,
    intent.reviewed_preparation,
    caller,
  );
  return { command, intent };
}

function serviceFor(storeRoot, sourceClient, readinessClient) {
  return createPrototypeMaturityService({
    store: createPrototypeMaturityStore({ root: storeRoot }),
    sourceClient,
    readinessClient,
    clock: () => new Date(at),
  });
}

async function ready(service, command) {
  await service.submit({ callerId: caller, input: command });
  return service.advance({ callerId: caller, requestId: command.request.request_id });
}

async function decideAndPrepare(service, command, decision, blocker = null) {
  await service.decide({
    callerId: caller,
    requestId: command.request.request_id,
    input: blocker ? { blocker, decision } : { decision },
  });
  return service.advance({ callerId: caller, requestId: command.request.request_id });
}

try {
  execFileSync("git", ["clone", "--shared", authorityRoot, repo], { stdio: "pipe" });
  git(repo, "config", "user.name", "Prototype Maturity Conformance");
  git(repo, "config", "user.email", "prototype-maturity@example.invalid");
  git(repo, "checkout", "-B", "main", initialRevision);
  git(repo, "update-ref", "refs/remotes/origin/main", initialRevision);

  const provider = localReviewProvider();
  const sourceClient = createPrototypeMaturitySourceClient({
    authorityRoot: repo,
    provider,
    clock: () => new Date(at),
  });
  const readinessClient = createReadinessClient();

  const blockedState = await sourceClient.state("prototype:client-review-portal");
  const blocked = commandFor(
    blockedState,
    "candidate-promotion",
    1,
    "promote-candidate",
  );
  blocked.command.request.inputs.source_refs[1] =
    "repo://workspace-prototype-studio/docs/prototypes/client-review-portal/missing.md";
  blocked.command.request = bindPrototypeMaturity(blocked.command.request, "request_digest");
  blocked.command.packet.request_ref = {
    id: blocked.command.request.request_id,
    digest: blocked.command.request.request_digest,
  };
  blocked.command.packet.sections = blocked.command.packet.sections.map((section) => ({
    ...section,
    evidence_refs: blocked.command.request.inputs.source_refs,
  }));
  blocked.command.packet = bindPrototypeMaturity(blocked.command.packet, "packet_digest");
  const blockedService = serviceFor(
    path.join(root, "blocked-state"),
    sourceClient,
    readinessClient,
  );
  const blockedResult = await ready(blockedService, blocked.command);
  assert.equal(blockedResult.status, "requires-action");
  assert.equal(blockedResult.canonical_mutation, false);
  assert.equal(blockedResult.decision, null);
  pass("actual WGCF policy blocks unresolved evidence without source mutation", CASES.negative);

  const returnState = await sourceClient.state("prototype:client-review-portal");
  const blocker = {
    issue_ref: "openproject://work_packages/1100",
    owner_ref: "workspace-prototype-studio",
    required_fix: "Correct the visible evidence before promotion.",
  };
  const returned = commandFor(
    returnState,
    "candidate-promotion",
    2,
    "block-promotion",
    blocker,
  );
  const returnService = serviceFor(
    path.join(root, "return-state"),
    sourceClient,
    readinessClient,
  );
  assert.equal((await ready(returnService, returned.command)).status, "decision-required");
  const returnedResult = await decideAndPrepare(
    returnService,
    returned.command,
    "block-promotion",
    blocker,
  );
  consoleContract.assertPrototypeMaturityResult(returnedResult);
  assert.equal(returnedResult.status, "blocked");
  assert.equal(returnedResult.readback.authority_state, "unchanged-authority");
  assert.equal(returnedResult.receipt.outcome, "blocked");
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/main"), initialRevision);
  pass("block decision returns actionable evidence and preserves authority", CASES.positive, CASES.gitPositive);

  const staleState = await sourceClient.state("prototype:client-review-portal");
  const stale = commandFor(staleState, "candidate-promotion", 3, "promote-candidate");
  const staleService = serviceFor(
    path.join(root, "stale-state"),
    sourceClient,
    readinessClient,
  );
  assert.equal((await ready(staleService, stale.command)).status, "decision-required");
  await staleService.decide({
    callerId: caller,
    requestId: stale.command.request.request_id,
    input: { decision: "promote-candidate" },
  });
  git(repo, "checkout", "main");
  await writeFile(path.join(repo, "STALE_PROOF"), "new authority state\n");
  git(repo, "add", "STALE_PROOF");
  git(repo, "commit", "-m", "Advance authority after maturity readiness");
  git(repo, "update-ref", "refs/remotes/origin/main", "main");
  await assert.rejects(
    staleService.advance({ callerId: caller, requestId: stale.command.request.request_id }),
    /submit a fresh maturity request/,
  );
  const staleResult = await staleService.project(stale.command.request.request_id, { callerId: caller });
  assert.equal(staleResult.status, "preparing");
  assert.equal(staleResult.canonical_mutation, false);
  git(repo, "reset", "--hard", initialRevision);
  git(repo, "update-ref", "refs/remotes/origin/main", initialRevision);
  pass("stale authority is rejected before canonical mutation", CASES.negative, CASES.gitNegative);

  const cancelState = await sourceClient.state("prototype:client-review-portal");
  const cancelled = commandFor(cancelState, "candidate-promotion", 4, "promote-candidate");
  const cancelService = serviceFor(
    path.join(root, "cancel-state"),
    sourceClient,
    readinessClient,
  );
  await ready(cancelService, cancelled.command);
  const cancelWaiting = await decideAndPrepare(
    cancelService,
    cancelled.command,
    "promote-candidate",
  );
  assert.equal(cancelWaiting.status, "review-required");
  const cancelResult = await cancelService.advance({
    callerId: caller,
    requestId: cancelled.command.request.request_id,
    action: "cancel",
  });
  assert.equal(cancelResult.status, "cancelled");
  assert.equal(cancelResult.receipt, null);
  assert.equal(cancelResult.canonical_mutation, false);
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/main"), initialRevision);
  pass("review cancellation rolls back without a terminal success receipt", CASES.negative, CASES.gitNegative);

  const candidateState = await sourceClient.state("prototype:client-review-portal");
  const candidate = commandFor(
    candidateState,
    "candidate-promotion",
    5,
    "promote-candidate",
  );
  const candidateStore = path.join(root, "candidate-state");
  let candidateService = serviceFor(candidateStore, sourceClient, readinessClient);
  const accepted = await candidateService.submit({ callerId: caller, input: candidate.command });
  assert.deepEqual(
    await candidateService.submit({ callerId: caller, input: candidate.command }),
    accepted,
  );
  const conflicting = structuredClone(candidate.command);
  conflicting.execution_ref = "console://prototype-maturity/executions/conflict";
  await assert.rejects(
    candidateService.submit({ callerId: caller, input: conflicting }),
    /different maturity input/,
  );
  await assert.rejects(
    candidateService.project(candidate.command.request.request_id, { callerId: "operator:other" }),
    /not found/,
  );
  pass("caller isolation and replay conflicts fail closed", CASES.negative);

  assert.equal(
    (
      await candidateService.advance({
        callerId: caller,
        requestId: candidate.command.request.request_id,
      })
    ).status,
    "decision-required",
  );
  const candidateWaiting = await decideAndPrepare(
    candidateService,
    candidate.command,
    "promote-candidate",
  );
  assert.equal(candidateWaiting.status, "review-required");
  assert.equal(candidateWaiting.review.base_commit, initialRevision);
  const candidateReview = candidateWaiting.review;

  candidateService = serviceFor(candidateStore, sourceClient, readinessClient);
  assert.equal(
    (
      await candidateService.project(candidate.command.request.request_id, {
        callerId: caller,
      })
    ).review.head_commit,
    candidateReview.head_commit,
  );
  pass("review wait survives service reconstruction", CASES.positive);

  provider.update(candidateReview.number, { head_commit: initialRevision });
  await assert.rejects(
    candidateService.advance({ callerId: caller, requestId: candidate.command.request.request_id }),
    /review no longer matches/,
  );
  provider.update(candidateReview.number, { head_commit: candidateReview.head_commit });
  assert.equal(
    (
      await candidateService.project(candidate.command.request.request_id, {
        callerId: caller,
      })
    ).canonical_mutation,
    false,
  );
  pass("changed review head is rejected without false success", CASES.negative, CASES.gitNegative);

  const candidateMergedReview = provider.merge(candidateReview.number);
  let alterReadback = true;
  const mismatchingSource = {
    ...sourceClient,
    async observe(record, assertHeld) {
      const observed = await sourceClient.observe(record, assertHeld);
      if (!observed.readback || !alterReadback) return observed;
      alterReadback = false;
      return {
        ...observed,
        readback: bindPrototypeMaturity(
          { ...observed.readback, observed_lifecycle: "exploring" },
          "readback_digest",
        ),
      };
    },
  };
  candidateService = serviceFor(candidateStore, mismatchingSource, readinessClient);
  await assert.rejects(
    candidateService.advance({ callerId: caller, requestId: candidate.command.request.request_id }),
    /does not match the approved maturity decision/,
  );
  assert.equal(
    (
      await candidateService.project(candidate.command.request.request_id, {
        callerId: caller,
      })
    ).status,
    "review-required",
  );
  candidateService = serviceFor(candidateStore, sourceClient, readinessClient);
  const candidateCompleted = await candidateService.advance({
    callerId: caller,
    requestId: candidate.command.request.request_id,
  });
  consoleContract.assertPrototypeMaturityResult(candidateCompleted);
  assert.equal(candidateCompleted.status, "succeeded");
  assert.equal(candidateCompleted.readback.source_revision, candidateMergedReview.merge_commit);
  assert.equal(candidateCompleted.receipt.next_action.code, "baseline-promotion");
  assert.deepEqual(
    await candidateService.advance({ callerId: caller, requestId: candidate.command.request.request_id }),
    candidateCompleted,
  );
  pass("readback mismatch fails closed and exact retry emits one stable candidate receipt", CASES.positive, CASES.negative, CASES.gitPositive, CASES.gitNegative);

  const baselineState = await sourceClient.state("prototype:client-review-portal");
  assert.equal(baselineState.expected_state.lifecycle, "candidate");
  const baseline = commandFor(
    baselineState,
    "baseline-promotion",
    6,
    "approve-baseline",
  );
  const baselineStore = path.join(root, "baseline-state");
  let baselineService = serviceFor(baselineStore, sourceClient, readinessClient);
  assert.equal((await ready(baselineService, baseline.command)).status, "decision-required");
  const baselineWaiting = await decideAndPrepare(
    baselineService,
    baseline.command,
    "approve-baseline",
  );
  assert.equal(baselineWaiting.status, "review-required");
  const baselineMergedReview = provider.merge(baselineWaiting.review.number);
  baselineService = serviceFor(baselineStore, sourceClient, readinessClient);
  const baselineCompleted = await baselineService.advance({
    callerId: caller,
    requestId: baseline.command.request.request_id,
  });
  consoleContract.assertPrototypeMaturityResult(baselineCompleted);
  assert.equal(baselineCompleted.status, "succeeded");
  assert.equal(baselineCompleted.readback.observed_lifecycle, "baseline-approved");
  assert.equal(baselineCompleted.readback.source_revision, baselineMergedReview.merge_commit);
  assert.equal(baselineCompleted.receipt.next_action.code, "movement-request");
  pass("baseline approval binds exact reviewed authority and terminal receipt", CASES.positive, CASES.gitPositive);

  const fixtureRecordTemplate = consoleReadModel
    .getPrototypeWorkspaceReadModel()
    .records.find((record) => record.id === "prototype-candidate-promotion-fixture");
  assert.ok(fixtureRecordTemplate);
  const fixtureRecord = {
    ...structuredClone(fixtureRecordTemplate),
    id: "prototype-client-review-portal",
    name: "Client Review Portal",
    preview: {
      ...fixtureRecordTemplate.preview,
      lastProofRef: "record://prototype-preview/client-review-portal/proof",
      proofState: "proof-ready",
    },
    sourcePath: "docs/prototypes/client-review-portal",
    sourceRef:
      "repo://workspace-prototype-studio/docs/prototypes/client-review-portal/brief.md",
  };
  const projectedCandidate = consoleProjection.projectPrototypeMaturity({
    projection: {
      input: candidate.intent.input,
      inputKey: JSON.stringify(candidate.intent.input),
      recordId: fixtureRecord.id,
      result: candidateCompleted,
    },
    record: fixtureRecord,
  });
  assert.equal(projectedCandidate.lifecycle, "candidate");
  const projectedBaseline = consoleProjection.projectPrototypeMaturity({
    projection: {
      input: baseline.intent.input,
      inputKey: JSON.stringify(baseline.intent.input),
      recordId: fixtureRecord.id,
      result: baselineCompleted,
    },
    record: projectedCandidate,
  });
  assert.equal(projectedBaseline.lifecycle, "baseline-approved");
  pass("Console projection advances only from validated terminal authority", CASES.positive);

  assert.equal(exactOriginMain(authorityRoot), initialRevision);
  const architectureCases = [
    { fidelity: "sandbox-runtime", id: CASES.positive },
    { fidelity: "sandbox-runtime", id: CASES.negative },
    { fidelity: "real-git", id: CASES.gitPositive },
    { fidelity: "real-git", id: CASES.gitNegative },
  ].map((entry) => {
    assert.ok(scenarios.some((scenario) => scenario.case_ids.includes(entry.id)));
    return { ...entry, outcome: "passed" };
  });

  await mkdir(path.dirname(evidenceOutput), { recursive: true });
  await writeFile(
    evidenceOutput,
    `${JSON.stringify({
      schema_version: 1,
      proof_type: "prototype-maturity-composed-conformance",
      generated_at: new Date().toISOString(),
      runtime_scope: "isolated-dev-integration-conformance",
      normal_runtime_activation: false,
      source_revisions: {
        operator_orchestration_service: git(oosRoot, "rev-parse", "HEAD"),
        ...dependencyRevisions,
      },
      architecture_cases: architectureCases,
      scenarios,
      sandbox_authority: {
        revision_before: initialRevision,
        revision_after: git(repo, "rev-parse", "refs/remotes/origin/main"),
        resulting_lifecycle: baselineCompleted.readback.observed_lifecycle,
      },
      canonical_authority: {
        repo: "workspace-prototype-studio",
        revision_before: initialRevision,
        revision_after: exactOriginMain(authorityRoot),
        unchanged: true,
      },
      result: "passed",
    }, null, 2)}\n`,
  );

  console.log(
    `Prototype Maturity composed conformance: ${scenarios.length} scenarios and ${architectureCases.length} architecture cases passed.`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
