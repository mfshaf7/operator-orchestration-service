import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { closureDigest } from "../src/prototype-closure/contracts.js";
import { createPrototypeClosureAuthorityResolver } from "../src/prototype-closure/authority-resolver.js";
import { createPrototypeClosureService } from "../src/prototype-closure/service.js";
import { createPrototypeClosureSourceClient } from "../src/prototype-closure/source-client.js";
import { createPrototypeClosureStore } from "../src/prototype-closure/store.js";

const at = "2026-09-14T12:00:00.000Z";
const caller = "operator:workspace-owner";
const prototypeId = "client-review-portal";
const cases = {
  positive: "case:prototype-work-1109-positive",
  negative: "case:prototype-work-1109-negative",
  gitPositive: "case:prototype-work-1109-git-positive",
  gitNegative: "case:prototype-work-1109-git-negative",
};
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
for (const name of ["--studio-root", "--wgcf-root", "--console-root", "--wgcf-python", "--evidence-output"]) {
  if (!argument(name)) throw new Error(`Closure conformance requires ${name}.`);
}
const studioRoot = path.resolve(argument("--studio-root"));
const wgcfRoot = path.resolve(argument("--wgcf-root"));
const consoleRoot = path.resolve(argument("--console-root"));
const wgcfPython = path.resolve(argument("--wgcf-python"));
const evidenceOutput = path.resolve(argument("--evidence-output"));
const helper = fileURLToPath(new URL("./evaluate_prototype_closure_wgcf.py", import.meta.url));
const oosRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = await mkdtemp(path.join(tmpdir(), "prototype-closure-conformance-"));
const scenarios = [];
const outcomes = [];
const revisions = {};
let evidence;

function git(repo, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitBytes(repo, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function cloneExact(source, target, branch = false) {
  const revision = git(source, "rev-parse", "refs/remotes/origin/main");
  const remote = git(source, "ls-remote", "origin", "refs/heads/main").split("\t")[0];
  assert.equal(revision, remote, `${source} must fetch current origin/main before conformance`);
  execFileSync("git", ["clone", "--shared", "--no-checkout", "--template=", source, target], { stdio: "pipe" });
  git(target, "checkout", branch ? "-B" : "--detach", ...(branch ? ["main", revision] : [revision]));
  git(target, "update-ref", "refs/remotes/origin/main", revision);
  git(target, "config", "user.name", "Prototype Closure Conformance");
  git(target, "config", "user.email", "prototype-closure@example.invalid");
  assert.equal(git(target, "status", "--porcelain"), "");
  return revision;
}

function proof(field, ref, ownerRef, { subjectRef = null, sourceRevision = null, sourcePacketRef = null, proofPrototypeId = null, state = "accepted" } = {}) {
  return {
    ref, owner_ref: ownerRef, digest: closureDigest({ field, ref, owner_ref: ownerRef }),
    state, subject_ref: subjectRef, source_revision: sourceRevision,
    source_packet_ref: sourcePacketRef, prototype_id: proofPrototypeId,
  };
}

function ownerEvidence(action, state, { missingTarget = false } = {}) {
  const sourceRevision = state.source_revision;
  if (action === "apply-delivery") {
    const target = "openproject://work_packages/900";
    return {
      accepted_baseline_receipt_ref: proof("baseline", "receipt://studio/baseline-accepted", "operator-orchestration-service", {
        subjectRef: state.design_baseline_ref, proofPrototypeId: prototypeId,
      }),
      target_delivery_ref: proof("target", target, "workspace-delivery-art", {
        state: missingTarget ? "missing" : "accepted",
      }),
      accepted_delivery_target_receipt_ref: proof("acceptance", "receipt://delivery/target-accepted", "operator-orchestration-service", {
        subjectRef: target, sourcePacketRef: state.delivery_packet_ref, proofPrototypeId: prototypeId,
      }),
    };
  }
  if (action === "graduate-source") {
    const repoRef = "repo://owner/client-review-portal";
    return {
      accepted_delivery_target_receipt_ref: proof("delivery", state.accepted_delivery_target_receipt_ref, "operator-orchestration-service", {
        sourcePacketRef: state.delivery_packet_ref, proofPrototypeId: prototypeId,
      }),
      durable_owner_acceptance_ref: proof("owner", "receipt://owner/source-accepted", "owner:client-review", {
        subjectRef: repoRef,
      }),
      source_transfer_receipt_ref: proof("transfer", "receipt://owner/source-transferred", "owner:client-review", {
        subjectRef: repoRef, sourceRevision,
      }),
    };
  }
  if (action === "retire-incubation") {
    const plan = "plan://platform/runtime-disposition";
    return {
      retention_plan_ref: proof("retention", "plan://studio/retention", "workspace-prototype-studio"),
      runtime_disposition_plan_ref: proof("runtime-plan", plan, "platform-engineering"),
      runtime_disposition_proof_ref: proof("runtime-proof", "proof://platform/runtime-absent", "platform-engineering", {
        subjectRef: plan,
      }),
    };
  }
  return {
    prior_retirement_receipt_ref: proof("retirement", "receipt://oos/retirement-complete", "operator-orchestration-service", {
      subjectRef: state.retirement_ref,
    }),
    retained_source_readback_ref: proof("retained", "readback://studio/source-retained", "workspace-prototype-studio", {
      sourceRevision,
    }),
  };
}

function fieldsFor(action, evidence) {
  if (action === "apply-delivery") return {
    accepted_baseline_receipt_ref: evidence.accepted_baseline_receipt_ref.ref,
    target_kind: "new-delivery-epic", target_delivery_ref: evidence.target_delivery_ref.ref,
    accepted_delivery_target_receipt_ref: evidence.accepted_delivery_target_receipt_ref.ref,
  };
  if (action === "graduate-source") return {
    accepted_delivery_target_receipt_ref: evidence.accepted_delivery_target_receipt_ref.ref,
    durable_owner_ref: "owner:client-review", durable_repo_ref: "repo://owner/client-review-portal",
    durable_owner_acceptance_ref: evidence.durable_owner_acceptance_ref.ref,
    transfer_strategy: "transfer",
  };
  if (action === "retire-incubation") return {
    retirement_reason: "Conformance fixture has completed local exploration",
    retention_plan_ref: evidence.retention_plan_ref.ref,
    runtime_disposition_plan_ref: evidence.runtime_disposition_plan_ref.ref,
  };
  return { prior_retirement_receipt_ref: evidence.prior_retirement_receipt_ref.ref };
}

function reviewProvider(repo) {
  const reviews = new Map();
  let nextNumber = 1;
  const byBranch = (branch) => [...reviews.values()].find((review) => review.branch === branch) ?? null;
  const verify = (preparation, head) => {
    assert.equal(git(repo, "rev-parse", `${head}^`), preparation.base_commit);
    const actual = git(repo, "diff", "--name-only", preparation.base_commit, head).split("\n").filter(Boolean).sort();
    assert.deepEqual(actual, preparation.files.map((file) => file.path).sort());
    for (const file of preparation.files) {
      assert.deepEqual(gitBytes(repo, "show", `${head}:${file.path}`), Buffer.from(file.content_base64, "base64"));
    }
  };
  return {
    async mainRevision() { return git(repo, "rev-parse", "refs/remotes/origin/main"); },
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
      git(repo, "commit", "-m", "Prepare isolated Prototype Closure event");
      const review = {
        repository: "workspace-prototype-studio", number: nextNumber++, state: "open",
        url: `https://example.invalid/workspace-prototype-studio/pull/${nextNumber - 1}`,
        branch: preparation.branch, base_branch: "main", base_commit: preparation.base_commit,
        head_commit: git(repo, "rev-parse", "HEAD"), merged: false, merge_commit: null,
        human_reviewed: false,
      };
      verify(preparation, review.head_commit);
      reviews.set(review.number, review);
      return structuredClone(review);
    },
    async review(number) { return structuredClone(reviews.get(number)); },
    async findReview(branch) { return structuredClone(byBranch(branch)); },
    async verifyPreparedReview(preparation, review) { verify(preparation, review.head_commit); },
    async verifyPreparedBranch(preparation) {
      try { verify(preparation, git(repo, "rev-parse", preparation.branch)); return true; }
      catch { return false; }
    },
    async verifyMergedFiles(review, preparation) {
      git(repo, "merge-base", "--is-ancestor", review.merge_commit, "main");
      verify(preparation, review.head_commit);
      for (const file of preparation.files) {
        assert.deepEqual(gitBytes(repo, "show", `${review.merge_commit}:${file.path}`), Buffer.from(file.content_base64, "base64"));
      }
    },
    async closeReview(review) { reviews.set(review.number, { ...reviews.get(review.number), state: "closed" }); },
    update(number, changes) { reviews.set(number, { ...reviews.get(number), ...changes }); },
    merge(number) {
      const review = reviews.get(number);
      git(repo, "checkout", "main");
      git(repo, "merge", "--ff-only", review.branch);
      git(repo, "update-ref", "refs/remotes/origin/main", "main");
      const merged = {
        ...review, state: "closed", merged: true, human_reviewed: true,
        merge_commit: git(repo, "rev-parse", "main"),
      };
      reviews.set(number, merged);
      return structuredClone(merged);
    },
    count() { return reviews.size; },
  };
}

function runtime({ repo, provider, storeRoot, wgcfClone, consoleClient }) {
  const source = createPrototypeClosureSourceClient({ authorityRoot: repo, provider });
  let failReadback = false;
  let failDisposition = false;
  const sourceClient = {
    ...source,
    async readback(record, assertHeld) {
      if (failReadback) { failReadback = false; throw new Error("isolated source readback unavailable"); }
      return source.readback(record, assertHeld);
    },
  };
  const readinessProofs = [];
  const evidenceByRequest = new Map();
  const readinessClient = {
    async evaluate(evaluation) {
      const ownerEvidence = evidenceByRequest.get(evaluation.request.request_id);
      assert.ok(ownerEvidence);
      const output = execFileSync(wgcfPython, [helper, "--wgcf-root", wgcfClone, "--studio-root", repo], {
        input: JSON.stringify({ at, evaluation, owner_evidence: ownerEvidence }), encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      const evaluated = JSON.parse(output);
      assert.equal(evaluated.proof.evidence_kind, "synthetic-owner-fixture");
      assert.equal(evaluated.proof.replay_resolution, "reused");
      assert.equal(evaluated.proof.readback_resolution, "read");
      readinessProofs.push(evaluated.proof);
      return evaluated.result;
    },
  };
  const authorityResolver = createPrototypeClosureAuthorityResolver({
    async readEvidence({ field, ref, request }) {
      const observed = evidenceByRequest.get(request.request_id)?.[field];
      assert.equal(observed?.ref, ref);
      return field === "source_transfer_receipt_ref"
        ? { ...observed, observed_source_custody: "dedicated-owner-repo" }
        : observed;
    },
  });
  const platformClient = {
    async readDisposition({ request, readback }) {
      if (failDisposition) { failDisposition = false; throw new Error("isolated Platform readback unavailable"); }
      const digest = closureDigest({ prototype_id: request.prototype_id, revision: readback.merged_source_revision });
      return {
        owner_ref: "platform-engineering", state: "accepted", disposition: "absent",
        prototype_id: request.prototype_id, merged_source_revision: readback.merged_source_revision,
        digest, ref: `proof://platform/runtime-disposition/${digest.slice(7)}`,
      };
    },
  };
  const service = () => createPrototypeClosureService({
    store: createPrototypeClosureStore({ root: storeRoot }), readinessClient,
    authorityResolver, sourceClient, platformClient, clock: () => new Date(at),
  });
  return {
    service, consoleClient, provider, repo, readinessProofs, evidenceByRequest,
    failReadbackOnce() { failReadback = true; },
    failDispositionOnce() { failDisposition = true; },
  };
}

function record(name, outcome, ...caseIds) {
  scenarios.push({ name, outcome, case_ids: caseIds });
  console.log(`${outcome.toUpperCase()} ${name}`);
}

async function commandFor(context, action, suffix, options = {}) {
  const service = context.service();
  const preparation = await service.prepare({ callerId: caller, input: { prototype_id: prototypeId } });
  const evidence = ownerEvidence(action, preparation.expected_state, options);
  const requestId = `prototype-closure-request:${prototypeId}:${suffix}`;
  context.evidenceByRequest.set(requestId, evidence);
  const command = context.consoleClient.buildPrototypeClosureCommand({
    preparation, request_id: requestId, action, fields: fieldsFor(action, evidence),
  }, caller);
  return { service, command, evidence, preparation };
}

async function advanceToReview(command, service) {
  await service.submit({ callerId: caller, input: command });
  const decision = await service.advance({ callerId: caller, requestId: command.request.request_id });
  assert.equal(decision.status, "decision-required", JSON.stringify(decision.readiness?.readiness?.findings));
  await service.decide({ callerId: caller, requestId: command.request.request_id, input: { decision: "approve" } });
  const waiting = await service.advance({ callerId: caller, requestId: command.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.canonical_mutation, false);
  return waiting;
}

async function success(context, action, suffix) {
  const { service, command, preparation } = await commandFor(context, action, suffix);
  const requestId = command.request.request_id;
  const accepted = await service.submit({ callerId: caller, input: command });
  assert.deepEqual(await service.submit({ callerId: caller, input: command }), accepted);
  await assert.rejects(service.project(requestId, { callerId: "operator:other" }), /not found/);
  const conflicting = structuredClone(command);
  conflicting.request.correlation_id = `${requestId}:changed`;
  await assert.rejects(service.submit({ callerId: caller, input: conflicting }), /different Closure input/);
  record(`${action} request replay and caller isolation`, "passed", cases.negative);

  const waiting = await advanceToReview(command, service);
  assert.equal(waiting.review.base_commit, preparation.authority_revision);
  const reviewCount = context.provider.count();
  const resumed = context.service();
  assert.equal((await resumed.project(requestId, { callerId: caller })).review.head_commit, waiting.review.head_commit);
  context.provider.update(waiting.review.number, { head_commit: preparation.authority_revision });
  await assert.rejects(resumed.advance({ callerId: caller, requestId }), /review head or base changed/);
  context.provider.update(waiting.review.number, { head_commit: waiting.review.head_commit });
  assert.equal(context.provider.count(), reviewCount);
  record(`${action} survives restart and rejects changed review head`, "passed", cases.negative, cases.gitNegative);

  const merged = context.provider.merge(waiting.review.number);
  assert.equal((await resumed.advance({ callerId: caller, requestId })).status, "pending-readback");
  context.failReadbackOnce();
  await assert.rejects(resumed.advance({ callerId: caller, requestId }), /exact readback reconciliation/);
  assert.equal((await resumed.project(requestId, { callerId: caller })).status, "pending-readback");
  assert.equal(context.provider.count(), reviewCount);
  let result = await resumed.advance({ callerId: caller, requestId });
  if (action === "graduate-source") {
    assert.equal(result.status, "pending-runtime-disposition");
    context.failDispositionOnce();
    await assert.rejects(resumed.advance({ callerId: caller, requestId }), /exact Platform disposition proof/);
    assert.equal((await resumed.project(requestId, { callerId: caller })).status, "pending-runtime-disposition");
    result = await resumed.advance({ callerId: caller, requestId });
  }
  assert.equal(result.status, "succeeded");
  assert.equal(result.receipt.outcome, "completed");
  assert.equal(result.receipt.merged_source_revision, merged.merge_commit);
  assert.equal(result.readback.source_event_ref, result.receipt.source_event_ref);
  assert.equal(result.receipt.source_event_digest, result.preparation.event_digest);
  assert.deepEqual(await resumed.advance({ callerId: caller, requestId }), result);
  const current = await createPrototypeClosureSourceClient({ authorityRoot: context.repo, provider: context.provider }).state(prototypeId);
  assert.equal(current.source_revision, merged.merge_commit);
  assert.equal(current.history.at(-1).event_id, result.receipt.source_event_ref);
  outcomes.push({
    action, request_id: requestId, outcome: result.receipt.outcome,
    readiness_digest: result.readiness.readiness.readiness_digest,
    owner_evidence: context.evidenceByRequest.get(requestId),
    review: {
      base_commit: waiting.review.base_commit, head_commit: waiting.review.head_commit,
      merge_commit: merged.merge_commit, human_reviewed: merged.human_reviewed,
    },
    source_event_ref: result.receipt.source_event_ref,
    source_event_digest: result.receipt.source_event_digest,
    merged_studio_readback_ref: result.receipt.merged_studio_readback_ref,
    merged_studio_readback_digest: result.receipt.merged_studio_readback_digest,
    runtime_disposition: result.runtime_disposition,
    receipt_id: result.receipt.receipt_id,
    receipt_digest: closureDigest(result.receipt, { ascii: true }),
  });
  record(`${action} exact merge, owner proof, recovery, and Studio history`, "passed",
    cases.positive, cases.negative, cases.gitPositive, cases.gitNegative);
  return result;
}

try {
  const inputRoots = [studioRoot, wgcfRoot, consoleRoot];
  const inputStates = inputRoots.map((repo) => ({
    repo, head: git(repo, "rev-parse", "HEAD"), status: git(repo, "status", "--porcelain"),
  }));
  const wgcfClone = path.join(root, "wgcf");
  const consoleClone = path.join(root, "console");
  revisions.wgcf = cloneExact(wgcfRoot, wgcfClone);
  revisions.console = cloneExact(consoleRoot, consoleClone);
  revisions.studio = git(studioRoot, "rev-parse", "refs/remotes/origin/main");
  revisions.oos = git(oosRoot, "rev-parse", "HEAD");
  const consoleClient = await import(pathToFileURL(path.join(consoleClone,
    "src/domain-workspaces/prototype/server/prototype-closure-oos-client.ts")).href);
  const deliveryRepo = path.join(root, "studio-delivery");
  const retirementRepo = path.join(root, "studio-retirement");
  const staleRepo = path.join(root, "studio-stale");
  const unreviewedRepo = path.join(root, "studio-unreviewed");
  cloneExact(studioRoot, deliveryRepo, true);
  cloneExact(studioRoot, retirementRepo, true);
  cloneExact(studioRoot, staleRepo, true);
  cloneExact(studioRoot, unreviewedRepo, true);

  const staleProvider = reviewProvider(staleRepo);
  const stale = runtime({ repo: staleRepo, provider: staleProvider,
    storeRoot: path.join(root, "stale-store"), wgcfClone, consoleClient });
  const staleCommand = await commandFor(stale, "retire-incubation", "source-stale");
  await staleCommand.service.submit({ callerId: caller, input: staleCommand.command });
  await writeFile(path.join(staleRepo, "CONFORMANCE_STALE_PROOF"), "Source advanced after request preparation.\n");
  git(staleRepo, "add", "CONFORMANCE_STALE_PROOF");
  git(staleRepo, "commit", "-m", "Advance isolated Studio source after request");
  git(staleRepo, "update-ref", "refs/remotes/origin/main", "main");
  const staleResult = await staleCommand.service.advance({ callerId: caller,
    requestId: staleCommand.command.request.request_id });
  assert.equal(staleResult.status, "denied");
  assert.equal(staleResult.readiness.readiness.outcome, "stale");
  assert.equal(staleProvider.count(), 0);
  assert.equal(staleResult.receipt.source_event_ref, undefined);
  outcomes.push({
    action: "retire-incubation", request_id: staleCommand.command.request.request_id,
    outcome: staleResult.receipt.outcome, finding_code: staleResult.receipt.finding_code,
    expected_source_revision: staleCommand.preparation.authority_revision,
    current_source_revision: git(staleRepo, "rev-parse", "refs/remotes/origin/main"),
    receipt_id: staleResult.receipt.receipt_id,
    receipt_digest: closureDigest(staleResult.receipt, { ascii: true }),
  });
  record("advanced Studio source denies stale request before review", "passed", cases.negative, cases.gitNegative);

  const unreviewedProvider = reviewProvider(unreviewedRepo);
  const unreviewed = runtime({ repo: unreviewedRepo, provider: unreviewedProvider,
    storeRoot: path.join(root, "unreviewed-store"), wgcfClone, consoleClient });
  const unreviewedCommand = await commandFor(unreviewed, "retire-incubation", "missing-human-review");
  const unreviewedWaiting = await advanceToReview(unreviewedCommand.command, unreviewedCommand.service);
  const unreviewedMerge = unreviewedProvider.merge(unreviewedWaiting.review.number);
  unreviewedProvider.update(unreviewedWaiting.review.number, { human_reviewed: false });
  assert.equal((await unreviewedCommand.service.advance({ callerId: caller,
    requestId: unreviewedCommand.command.request.request_id })).status, "pending-readback");
  await assert.rejects(unreviewedCommand.service.advance({ callerId: caller,
    requestId: unreviewedCommand.command.request.request_id }), /human review proof/);
  const unreviewedResult = await unreviewedCommand.service.project(
    unreviewedCommand.command.request.request_id, { callerId: caller });
  assert.equal(unreviewedResult.status, "pending-readback");
  assert.equal(unreviewedResult.receipt, null);
  outcomes.push({
    action: "retire-incubation", request_id: unreviewedCommand.command.request.request_id,
    outcome: "pending-readback", reason: "human-review-proof-missing",
    review_head: unreviewedWaiting.review.head_commit,
    merged_source_revision: unreviewedMerge.merge_commit,
    terminal_receipt_absent: true,
  });
  record("merged source without independent review remains nonterminal", "passed", cases.negative, cases.gitNegative);

  const registry = parseYaml(git(deliveryRepo, "show", "HEAD:prototypes.yaml"), { uniqueKeys: true });
  const item = registry.prototypes.find((entry) => entry.id === prototypeId);
  assert.ok(item);
  item.delivery_packet_ref = "record://delivery-packets/client-review-portal-synthetic";
  await writeFile(path.join(deliveryRepo, "prototypes.yaml"), stringifyYaml(registry));
  git(deliveryRepo, "add", "prototypes.yaml");
  git(deliveryRepo, "commit", "-m", "Seed isolated Delivery packet prerequisite");
  git(deliveryRepo, "update-ref", "refs/remotes/origin/main", "main");
  revisions.delivery_fixture = git(deliveryRepo, "rev-parse", "main");

  const deliveryProvider = reviewProvider(deliveryRepo);
  const delivery = runtime({ repo: deliveryRepo, provider: deliveryProvider,
    storeRoot: path.join(root, "delivery-store"), wgcfClone, consoleClient });
  const blocked = await commandFor(delivery, "apply-delivery", "missing-target", { missingTarget: true });
  const blockedStart = await blocked.service.submit({ callerId: caller, input: blocked.command });
  assert.equal(blockedStart.status, "accepted");
  const blockedResult = await blocked.service.advance({ callerId: caller, requestId: blocked.command.request.request_id });
  assert.equal(blockedResult.status, "denied");
  assert.equal(blockedResult.receipt.outcome, "denied");
  assert.equal(deliveryProvider.count(), 0);
  assert.equal(git(deliveryRepo, "rev-parse", "refs/remotes/origin/main"), revisions.delivery_fixture);
  outcomes.push({
    action: "apply-delivery", request_id: blocked.command.request.request_id,
    outcome: blockedResult.receipt.outcome, finding_code: blockedResult.receipt.finding_code,
    receipt_id: blockedResult.receipt.receipt_id,
    receipt_digest: closureDigest(blockedResult.receipt, { ascii: true }),
    source_revision_unchanged: revisions.delivery_fixture,
  });
  record("missing Delivery target is denied before source review", "passed", cases.negative, cases.gitNegative);

  const cancelled = await commandFor(delivery, "apply-delivery", "cancel-before-merge");
  const waiting = await advanceToReview(cancelled.command, cancelled.service);
  const cancelledResult = await cancelled.service.advance({ callerId: caller,
    requestId: cancelled.command.request.request_id, action: "cancel" });
  assert.equal(cancelledResult.status, "denied");
  assert.equal(cancelledResult.receipt.finding_code, "operator_cancelled");
  assert.equal(git(deliveryRepo, "rev-parse", "refs/remotes/origin/main"), revisions.delivery_fixture);
  assert.equal((await deliveryProvider.review(waiting.review.number)).state, "closed");
  outcomes.push({
    action: "apply-delivery", request_id: cancelled.command.request.request_id,
    outcome: cancelledResult.receipt.outcome, finding_code: cancelledResult.receipt.finding_code,
    receipt_id: cancelledResult.receipt.receipt_id,
    receipt_digest: closureDigest(cancelledResult.receipt, { ascii: true }),
    retained_branch: cancelledResult.history.at(-1).details?.retained_branch ?? waiting.preparation.branch,
    source_revision_unchanged: revisions.delivery_fixture,
  });
  record("pre-merge cancellation retains branch but not canonical event", "passed", cases.negative, cases.gitNegative);

  await success(delivery, "apply-delivery", "delivery-accepted");
  await success(delivery, "graduate-source", "source-graduated");
  const deliveryHistory = await createPrototypeClosureSourceClient({ authorityRoot: deliveryRepo,
    provider: deliveryProvider }).state(prototypeId);
  assert.deepEqual(deliveryHistory.history.map((event) => event.event_type), ["delivery-accepted", "source-graduated"]);
  assert.equal(deliveryHistory.source_custody, "dedicated-owner-repo");

  const retirementProvider = reviewProvider(retirementRepo);
  const retirement = runtime({ repo: retirementRepo, provider: retirementProvider,
    storeRoot: path.join(root, "retirement-store"), wgcfClone, consoleClient });
  await success(retirement, "retire-incubation", "incubation-retired");
  await success(retirement, "reopen-incubation", "incubation-reopened");
  const retirementHistory = await createPrototypeClosureSourceClient({ authorityRoot: retirementRepo,
    provider: retirementProvider }).state(prototypeId);
  assert.deepEqual(retirementHistory.history.map((event) => event.event_type), ["incubation-retired", "incubation-reopened"]);
  assert.equal(retirementHistory.lifecycle, "exploring");
  assert.equal(retirementHistory.source_custody, "incubation-repo");

  for (const context of [delivery, retirement]) {
    assert.ok(context.readinessProofs.length >= 2);
    assert.ok(context.readinessProofs.every((row) => row.evidence_kind === "synthetic-owner-fixture"));
  }
  for (const input of inputStates) {
    assert.equal(git(input.repo, "rev-parse", "HEAD"), input.head);
    assert.equal(git(input.repo, "status", "--porcelain"), input.status);
  }
  evidence = {
    schema_version: 1, artifact_type: "prototype-closure-conformance",
    work_item_id: "work-item-1109", fidelity: ["sandbox-runtime", "real-git"],
    runtime_activation: false, owner_evidence_kind: "synthetic-owner-fixture",
    source_revisions: revisions,
    final_revisions: {
      delivery: git(deliveryRepo, "rev-parse", "refs/remotes/origin/main"),
      retirement: git(retirementRepo, "rev-parse", "refs/remotes/origin/main"),
    },
    history: { delivery: deliveryHistory.history, retirement: retirementHistory.history },
    wgcf_readbacks: [...delivery.readinessProofs, ...retirement.readinessProofs],
    scenarios, outcomes, source_roots_unchanged: true,
    oos_worktree_clean: git(oosRoot, "status", "--porcelain") === "",
  };
  assert.deepEqual(new Set(scenarios.flatMap((row) => row.case_ids)), new Set(Object.values(cases)));
} finally {
  await rm(root, { recursive: true, force: true });
}
await assert.rejects(access(root), { code: "ENOENT" });
evidence.cleanup = { isolated_repositories_removed: true, live_source_mutation: false };
await mkdir(path.dirname(evidenceOutput), { recursive: true });
await writeFile(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Closure conformance passed: ${scenarios.length} scenarios; evidence=${evidenceOutput}`);
