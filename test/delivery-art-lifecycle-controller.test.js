import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  artifactContentDigest,
  workStartScopeFingerprint,
} from "../src/delivery-art/contracts.js";
import { createDeliveryArtLifecycleController } from "../src/delivery-art/lifecycle-controller.js";
import {
  createDeliveryArtReviewPacketFinalizationDraft,
  createDeliveryArtReviewPacketV2Draft,
} from "../src/delivery-art/lifecycle-authoring.js";

const plan = {
  schema_version: 1,
  artifact_type: "delivery_art_lifecycle_plan",
  lifecycle_id: "lifecycle:delivery-698-work-item-819",
  created_at: "2026-08-12T17:00:00+08:00",
  delivery_id: "delivery-698",
  covered_work_item_ids: ["work-item-819"],
  operator: { id: "operator:workspace-owner", decision_source: "operator" },
  landing_unit: {
    decision: "child_isolated_landing_unit",
    split_reason: "One owner-repo source and rollback boundary.",
    repo_root: "/workspace/operator-orchestration-service",
    owner_repo: "operator-orchestration-service",
    base_ref: "origin/main",
    branch: "codex/art-819-delivery-art-lifecycle-reconcile",
    rollback_boundary: "Revert the OOS pull request and supersede its evidence.",
  },
  architecture: { required: false, packet_path: null },
  artifacts: {
    work_start_path: ".art/review-packets/work-start.json",
    review_packet_path: ".art/review-packets/review.json",
    readiness_receipt_path: ".art/review-packets/readiness.json",
    evidence_path: ".art/review-packets/evidence.json",
  },
};

const finalizationPlan = {
  ...plan,
  lifecycle_id: "lifecycle:delivery-698-work-item-801",
  covered_work_item_ids: ["work-item-801"],
  landing_unit: {
    ...plan.landing_unit,
    repo_root: "/workspace/workspace-governance",
    owner_repo: "workspace-governance",
    base_ref: "origin/main",
    branch: "codex/art-801-work-start-contract",
    rollback_boundary:
      "One workspace-governance pull request and its generated contract artifacts roll back together.",
    split_reason:
      "The workspace contract must merge before dependent runtime implementations consume it.",
  },
  architecture: {
    required: true,
    packet_path: ".art/review-packets/architecture.json",
  },
};

function durable(artifact, state) {
  const next = structuredClone(artifact);
  if (state) {
    Object.assign(next, state);
  }
  next.integrity.content_digest = artifactContentDigest(next);
  next.custody = {
    ...next.custody,
    backend: "wgcf-artifact-registry",
    persisted_at: "2026-08-12T17:01:00+08:00",
    receipt_ref: {
      digest: `sha256:${"b".repeat(64)}`,
      uri: `wgcf://receipts/artifact-custody/${"b".repeat(24)}-${"b".repeat(64)}.json`,
    },
    state: "durable",
    uri: `wgcf://artifacts/delivery-art/sha256/${next.integrity.content_digest.slice(7)}`,
  };
  return next;
}

function adapters(initial = {}) {
  const files = new Map(Object.entries(initial));
  const requests = [];
  const sourceBindings = [];
  const source = {
    base_commit: "1".repeat(40),
    branch: plan.landing_unit.branch,
    changed_files: ["src/delivery-art/lifecycle.js"],
    head_commit: "2".repeat(40),
    state: "pushed",
  };
  const pullRequest = {
    head_commit: source.head_commit,
    merge_commit: null,
    state: "open",
    url: "https://github.com/example/operator-orchestration-service/pull/1",
  };
  return {
    artAdapter: { async statuses() { return ["in-progress"]; } },
    brokerAdapter: {
      async request(request) {
        requests.push(request);
        return { body: {}, ok: true };
      },
    },
    fileAdapter: {
      async read(filePath) { return files.get(filePath) ?? null; },
      async write(filePath, value) { files.set(filePath, structuredClone(value)); },
    },
    files,
    pullRequest,
    requests,
    source,
    sourceBindings,
    sourceAdapter: {
      async inspect(landingUnit) {
        sourceBindings.push(structuredClone(landingUnit));
        return structuredClone(source);
      },
      async pullRequest() { return structuredClone(pullRequest); },
    },
  };
}

function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../contracts/delivery-art/fixtures/${name}`, import.meta.url)),
  );
}

test("status stops at source work after durable work-start", async () => {
  const setup = adapters();
  const workStartPath = "/workspace/operator-orchestration-service/.art/review-packets/work-start.json";
  setup.files.set(workStartPath, {
    artifact_type: "delivery_art_work_start_record",
    readiness: { level: "blocked" },
  });
  const controller = createDeliveryArtLifecycleController(setup);
  const status = await controller.inspect(plan);

  assert.equal(status.facts.work_start, "invalid");
  assert.equal(status.projection.gate, "blocked");
  assert.equal(setup.requests.length, 0);
});

test("reconcile advances work-start draft and evaluation then stops at source work", async () => {
  const setup = adapters();
  setup.source.state = "dirty";
  let localDraft;
  setup.brokerAdapter.request = async (request) => {
    setup.requests.push(request);
    if (request.path.endsWith("/work-start/draft")) {
      localDraft = {
        schema_version: 1,
        artifact_type: "delivery_art_work_start_record",
        artifact_id: "work-start:delivery-698-work-item-819",
        delivery_id: "delivery-698",
        covered_work_item_ids: ["work-item-819"],
        created_at: "2026-08-12T17:00:00+08:00",
        operator: plan.operator,
        landing_unit: {
          decision: plan.landing_unit.decision,
          split_reason: plan.landing_unit.split_reason,
          owner_repos: [plan.landing_unit.owner_repo],
          branch_plan: [{
            repo: plan.landing_unit.owner_repo,
            branch: plan.landing_unit.branch,
            base_ref: plan.landing_unit.base_ref,
            base_commit: setup.source.base_commit,
          }],
          planned_review_packet_ref: plan.artifacts.review_packet_path,
        },
        architecture: {
          required: false,
          packet_ref: null,
          packet_digest: null,
          readiness: "not-required",
        },
        source_snapshot: {
          captured_at: "2026-08-12T17:00:00+08:00",
          art_ref: "openproject://work_packages/819",
          art_digest: `sha256:${"a".repeat(64)}`,
          repo_revisions: [{
            repo: plan.landing_unit.owner_repo,
            base_ref: plan.landing_unit.base_ref,
            commit: setup.source.base_commit,
          }],
        },
        scope_fingerprint: `sha256:${"c".repeat(64)}`,
        invalidation_inputs: [
          "art-descendant-or-dependency-change",
          "owner-or-rollback-boundary-change",
          "base-ref-or-commit-change",
          "architecture-decision-or-digest-change",
          "validation-or-security-obligation-change",
        ],
        readiness: { level: "draft", evaluated_at: null, blockers: [] },
        integrity: {
          canonicalization: "RFC8785",
          algorithm: "sha256",
          content_digest: `sha256:${"0".repeat(64)}`,
        },
        custody: {
          state: "local-draft",
          backend: "local-filesystem",
          uri: "local://delivery-art/work-start.json",
          receipt_ref: null,
          persisted_at: null,
          supersedes: null,
        },
      };
      localDraft.scope_fingerprint = workStartScopeFingerprint(localDraft);
      localDraft.integrity.content_digest = artifactContentDigest(localDraft);
      return { body: { work_start: localDraft }, ok: true };
    }
    return {
      body: {
        artifact: durable(localDraft, {
          readiness: {
            level: "implementation-ready",
            evaluated_at: localDraft.created_at,
            blockers: [],
          },
        }),
      },
      ok: true,
    };
  };
  const controller = createDeliveryArtLifecycleController(setup);
  const result = await controller.reconcile(plan);

  assert.deepEqual(result.executed_actions, ["draft-work-start", "evaluate-work-start"]);
  assert.equal(result.projection.gate, "source-work");
  assert.equal(setup.requests.length, 2);
});

test("reconcile performs no mutation when a human gate is active", async () => {
  const setup = adapters();
  setup.source.state = "pushed";
  setup.pullRequest.state = "missing";
  const workStart = {
    schema_version: 1,
    artifact_type: "delivery_art_work_start_record",
    artifact_id: "work-start:delivery-698-work-item-819",
    delivery_id: "delivery-698",
    covered_work_item_ids: ["work-item-819"],
    created_at: "2026-08-12T17:00:00+08:00",
    operator: plan.operator,
    landing_unit: {
      decision: plan.landing_unit.decision,
      split_reason: plan.landing_unit.split_reason,
      owner_repos: [plan.landing_unit.owner_repo],
      branch_plan: [{
        repo: plan.landing_unit.owner_repo,
        branch: plan.landing_unit.branch,
        base_ref: plan.landing_unit.base_ref,
        base_commit: setup.source.base_commit,
      }],
      planned_review_packet_ref: plan.artifacts.review_packet_path,
    },
    architecture: { required: false, packet_ref: null, packet_digest: null, readiness: "not-required" },
    source_snapshot: {
      captured_at: "2026-08-12T17:00:00+08:00",
      art_ref: "openproject://work_packages/819",
      art_digest: `sha256:${"a".repeat(64)}`,
      repo_revisions: [{ repo: plan.landing_unit.owner_repo, base_ref: plan.landing_unit.base_ref, commit: setup.source.base_commit }],
    },
    scope_fingerprint: `sha256:${"c".repeat(64)}`,
    invalidation_inputs: [
      "art-descendant-or-dependency-change",
      "owner-or-rollback-boundary-change",
      "base-ref-or-commit-change",
      "architecture-decision-or-digest-change",
      "validation-or-security-obligation-change",
    ],
    readiness: { level: "implementation-ready", evaluated_at: "2026-08-12T17:00:00+08:00", blockers: [] },
    integrity: { canonicalization: "RFC8785", algorithm: "sha256", content_digest: `sha256:${"0".repeat(64)}` },
    custody: { state: "local-draft", backend: "local-filesystem", uri: "local://delivery-art/work-start.json", receipt_ref: null, persisted_at: null, supersedes: null },
  };
  workStart.scope_fingerprint = workStartScopeFingerprint(workStart);
  setup.files.set(
    "/workspace/operator-orchestration-service/.art/review-packets/work-start.json",
    durable(workStart),
  );
  setup.files.set(
    "/workspace/operator-orchestration-service/.art/review-packets/evidence.json",
    (() => {
      const evidence = fixture("review-packet-merge-ready.valid.json").evidence;
      evidence.acceptance_mapping[0].work_item_id = "work-item-819";
      evidence.acceptance_mapping[0].acceptance_ref =
        "openproject://work_packages/819";
      return evidence;
    })(),
  );
  const controller = createDeliveryArtLifecycleController(setup);
  const result = await controller.reconcile(plan);

  assert.equal(result.projection.gate, "pull-request");
  assert.deepEqual(result.executed_actions, []);
  assert.equal(setup.requests.length, 0);
  assert.equal(setup.sourceBindings.at(-1).base_commit, setup.source.base_commit);

  const evidencePath =
    "/workspace/operator-orchestration-service/.art/review-packets/evidence.json";
  const malformedEvidence = structuredClone(setup.files.get(evidencePath));
  delete malformedEvidence.tests[0].summary;
  setup.files.set(evidencePath, malformedEvidence);
  setup.pullRequest.state = "open";
  const malformedStatus = await controller.inspect(plan);
  assert.equal(malformedStatus.facts.evidence, "invalid");
  assert.equal(malformedStatus.projection.gate, "evidence");
});

test("reconcile advances merged evidence to finalized custody then stops for ART closeout", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalized = fixture("review-packet-finalized.valid.json");
  const readinessReceipt = fixture("readiness-receipt.valid.json");
  const finalizationCandidate = createDeliveryArtReviewPacketFinalizationDraft({
    evidence: finalized.evidence,
    exceptions: finalized.exceptions,
    mergeReadyPacket: mergeReady,
    mergedRepos: [{
      head_commit: mergeReady.landing_unit.repos[0].head_commit,
      merge_commit: finalized.landing_unit.repos[0].merge_commit,
      pr_url: mergeReady.landing_unit.repos[0].pr_url,
      repo_name: "workspace-governance",
    }],
  });
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/evidence.json`]: {
      evidence: finalized.evidence,
      exceptions: finalized.exceptions,
    },
    [`${repoRoot}/.art/review-packets/review.json`]: mergeReady,
    [`${repoRoot}/.art/review-packets/work-start.json`]: workStart,
  });
  setup.source.branch = "main";
  setup.source.state = "dirty";
  setup.pullRequest.head_commit = mergeReady.landing_unit.repos[0].head_commit;
  setup.pullRequest.merge_commit = finalized.landing_unit.repos[0].merge_commit;
  setup.pullRequest.state = "merged";
  setup.pullRequest.url = mergeReady.landing_unit.repos[0].pr_url;
  setup.brokerAdapter.request = async (request) => {
    setup.requests.push(request);
    if (request.path.endsWith("/finalization-drafts")) {
      return { body: { finalization_candidate: finalizationCandidate }, ok: true };
    }
    if (request.path.endsWith("/operating-readiness")) {
      return {
        body: {
          finalization_candidate: finalizationCandidate,
          readiness_receipt: readinessReceipt,
        },
        ok: true,
      };
    }
    return { body: { artifact: finalized }, ok: true };
  };
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.reconcile(finalizationPlan);

  assert.deepEqual(result.executed_actions, [
    "draft-finalization",
    "issue-operating-readiness",
    "finalize-review-packet",
  ]);
  assert.equal(result.projection.gate, "art-closeout");
  assert.equal(setup.sourceBindings.length, 0);
  assert.deepEqual(
    setup.requests.map((request) => request.path),
    [
      "/v1/delivery-art/review-packets/finalization-drafts",
      "/v1/delivery-art/review-packets/operating-readiness",
      "/v1/delivery-art/review-packets/finalize",
    ],
  );

  setup.artAdapter.statuses = async () => ["done"];
  const completed = await controller.reconcile(finalizationPlan);
  assert.equal(completed.projection.complete, true);
  assert.deepEqual(completed.executed_actions, []);
  assert.equal(setup.requests.length, 3);
});

test("finalized lifecycle truth remains complete after source and architecture cleanup", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const finalized = fixture("review-packet-finalized.valid.json");
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/readiness.json`]:
      fixture("readiness-receipt.valid.json"),
    [`${repoRoot}/.art/review-packets/review.json`]: finalized,
    [`${repoRoot}/.art/review-packets/work-start.json`]:
      fixture("work-start-record.valid.json"),
  });
  setup.artAdapter.statuses = async () => ["done"];
  setup.sourceAdapter.inspect = async () => {
    throw new Error("terminal status must not inspect a cleaned worktree");
  };
  setup.sourceAdapter.pullRequest = async () => {
    throw new Error("terminal status must not rediscover a merged pull request");
  };
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.inspect(finalizationPlan);

  assert.equal(result.projection.complete, true);
  assert.equal(result.facts.architecture, "ready");
  assert.equal(result.facts.work_start, "implementation-ready");
  assert.equal(result.facts.source, "merged");
  assert.equal(result.facts.pull_request, "merged");
  assert.equal(
    result.source.merge_commit,
    finalized.landing_unit.repos[0].merge_commit,
  );
  assert.equal(result.pull_request.url, finalized.landing_unit.repos[0].pr_url);
  assert.equal(setup.sourceBindings.length, 0);
});

test("finalized lifecycle truth resolves durable custody after the source worktree is removed", async () => {
  const finalized = fixture("review-packet-finalized.valid.json");
  const terminalPlan = {
    ...finalizationPlan,
    artifacts: {
      ...finalizationPlan.artifacts,
      finalized_review_packet_ref: {
        uri: finalized.custody.uri,
        digest: finalized.integrity.content_digest,
      },
    },
  };
  const setup = adapters();
  setup.artAdapter.statuses = async () => ["done"];
  setup.sourceAdapter.inspect = async () => {
    throw Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
  };
  setup.sourceAdapter.pullRequest = async () => {
    throw new Error("terminal status must not rediscover a merged pull request");
  };
  setup.brokerAdapter.request = async (request) => {
    setup.requests.push(request);
    return { body: { artifact: finalized }, ok: true };
  };
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.inspect(terminalPlan);

  assert.equal(result.projection.complete, true);
  assert.equal(result.facts.review_packet, "finalized");
  assert.equal(result.facts.source, "merged");
  assert.equal(result.facts.pull_request, "merged");
  assert.equal(setup.sourceBindings.length, 0);
  assert.deepEqual(
    setup.requests.map((request) => request.path),
    ["/v1/delivery-art/artifacts/resolve"],
  );
});

test("pre-final lifecycle status still fails closed when its source worktree is removed", async () => {
  const setup = adapters();
  setup.sourceAdapter.inspect = async () => {
    throw Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
  };
  const controller = createDeliveryArtLifecycleController(setup);

  await assert.rejects(
    controller.inspect(plan),
    /spawnSync git ENOENT/,
  );
  assert.equal(setup.requests.length, 0);
});

test("terminal lifecycle status rejects durable custody for another Landing Unit", async () => {
  const finalized = fixture("review-packet-finalized.valid.json");
  const terminalPlan = {
    ...finalizationPlan,
    covered_work_item_ids: ["work-item-999"],
    artifacts: {
      ...finalizationPlan.artifacts,
      finalized_review_packet_ref: {
        uri: finalized.custody.uri,
        digest: finalized.integrity.content_digest,
      },
    },
  };
  const setup = adapters();
  setup.brokerAdapter.request = async () => ({
    body: { artifact: finalized },
    ok: true,
  });
  const controller = createDeliveryArtLifecycleController(setup);

  await assert.rejects(
    controller.inspect(terminalPlan),
    (error) =>
      error.code === "delivery_art_lifecycle_terminal_reference_invalid",
  );
  assert.equal(setup.sourceBindings.length, 0);
});

test("merge-ready reconciliation rejects pull-request evidence that changed identity", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/review.json`]: mergeReady,
    [`${repoRoot}/.art/review-packets/work-start.json`]: workStart,
  });
  setup.source.branch = "main";
  setup.source.state = "dirty";
  setup.pullRequest.head_commit = "f".repeat(40);
  setup.pullRequest.merge_commit = "e".repeat(40);
  setup.pullRequest.state = "merged";
  setup.pullRequest.url = mergeReady.landing_unit.repos[0].pr_url;
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.reconcile(finalizationPlan);

  assert.equal(result.facts.pull_request, "mismatch");
  assert.equal(result.projection.gate, "blocked");
  assert.equal(result.projection.state, "merge-ready-source-binding-invalid");
  assert.deepEqual(result.executed_actions, []);
  assert.equal(setup.sourceBindings.length, 0);
  assert.equal(setup.requests.length, 0);
});

test("merge-ready reconciliation replaces a stale open PR head with a new immutable packet", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const previousDigest = mergeReady.integrity.content_digest;
  const nextHead = "8".repeat(40);
  const evidence = structuredClone(mergeReady.evidence);
  for (const section of [
    "tests",
    "validations",
    "runtime_and_live",
    "security_and_trust",
  ]) {
    for (const entry of evidence[section] ?? []) {
      for (const revision of entry.source_revisions ?? []) {
        revision.commit = nextHead;
      }
    }
  }
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/evidence.json`]: {
      evidence,
      exceptions: mergeReady.exceptions,
    },
    [`${repoRoot}/.art/review-packets/review.json`]: mergeReady,
    [`${repoRoot}/.art/review-packets/work-start.json`]: workStart,
  });
  setup.source.base_commit = mergeReady.landing_unit.repos[0].base_commit;
  setup.source.branch = finalizationPlan.landing_unit.branch;
  setup.source.changed_files = mergeReady.landing_unit.repos[0].changed_files;
  setup.source.head_commit = nextHead;
  setup.source.state = "pushed";
  setup.pullRequest.head_commit = nextHead;
  setup.pullRequest.state = "open";
  setup.pullRequest.url = mergeReady.landing_unit.repos[0].pr_url;
  let revisedDraft;
  setup.brokerAdapter.request = async (request) => {
    setup.requests.push(request);
    if (request.path === "/v1/delivery-art/review-packets") {
      revisedDraft = createDeliveryArtReviewPacketV2Draft({
        createdAt: request.body.input.created_at,
        evidence: request.body.input.evidence,
        exceptions: request.body.input.exceptions,
        landingUnit: request.body.input.landing_unit,
        operator: mergeReady.operator,
        workStart,
      });
      return { body: { review_packet: revisedDraft }, ok: true };
    }
    if (request.path === "/v1/delivery-art/review-packets/readiness") {
      return {
        body: {
          artifact: durable(request.body.review_packet, {
            status: "merge-ready",
            readiness: {
              ...request.body.review_packet.readiness,
              level: "merge-ready",
            },
          }),
        },
        ok: true,
      };
    }
    return { body: {}, ok: false };
  };
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.reconcile(finalizationPlan);

  assert.deepEqual(result.executed_actions, [
    "draft-review-packet",
    "mark-merge-ready",
  ]);
  assert.equal(result.projection.gate, "source-merge");
  assert.equal(result.facts.pull_request, "open");
  assert.notEqual(revisedDraft.packet_id, mergeReady.packet_id);
  assert.equal(mergeReady.integrity.content_digest, previousDigest);
  assert.notEqual(
    result.artifacts.review_packet.integrity.content_digest,
    previousDigest,
  );
  assert.deepEqual(
    setup.requests.map((request) => request.path),
    [
      "/v1/delivery-art/review-packets",
      "/v1/delivery-art/review-packets/readiness",
    ],
  );
});

test("status rejects durable work-start state belonging to another lifecycle plan", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/work-start.json`]:
      fixture("work-start-record.valid.json"),
  });
  const controller = createDeliveryArtLifecycleController(setup);
  const foreignPlan = {
    ...finalizationPlan,
    lifecycle_id: "lifecycle:delivery-698-work-item-802",
    covered_work_item_ids: ["work-item-802"],
  };

  const result = await controller.inspect(foreignPlan);

  assert.equal(result.facts.work_start, "invalid");
  assert.equal(result.projection.gate, "blocked");
  assert.equal(setup.sourceBindings.length, 0);
});

test("status rejects a valid Review Packet whose operator is outside the plan", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const foreignReviewPacket = durable(mergeReady, {
    operator: {
      decision_source: "operator",
      id: "operator:different-owner",
    },
  });
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/review.json`]: foreignReviewPacket,
    [`${repoRoot}/.art/review-packets/work-start.json`]:
      fixture("work-start-record.valid.json"),
  });
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.inspect(finalizationPlan);

  assert.equal(result.facts.review_packet, "invalid");
  assert.equal(result.projection.gate, "blocked");
  assert.equal(setup.sourceBindings.length, 0);
});

test("status rejects a durable readiness receipt for another finalization subject", async () => {
  const repoRoot = finalizationPlan.landing_unit.repo_root;
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const finalizationCandidate = createDeliveryArtReviewPacketFinalizationDraft({
    mergeReadyPacket: mergeReady,
    mergedRepos: fixture("review-packet-finalized.valid.json").landing_unit.repos,
  });
  const foreignReceipt = fixture("readiness-receipt.valid.json");
  foreignReceipt.subject.digest = `sha256:${"f".repeat(64)}`;
  foreignReceipt.integrity.content_digest = artifactContentDigest(foreignReceipt);
  foreignReceipt.custody.uri = foreignReceipt.custody.uri.replace(
    /[0-9a-f]{64}\.json$/,
    `${foreignReceipt.integrity.content_digest.slice("sha256:".length)}.json`,
  );
  const setup = adapters({
    [`${repoRoot}/.art/review-packets/architecture.json`]:
      fixture("architecture-packet.valid.json"),
    [`${repoRoot}/.art/review-packets/readiness.json`]:
      foreignReceipt,
    [`${repoRoot}/.art/review-packets/review.json`]: finalizationCandidate,
    [`${repoRoot}/.art/review-packets/work-start.json`]:
      fixture("work-start-record.valid.json"),
  });
  const controller = createDeliveryArtLifecycleController(setup);

  const result = await controller.inspect(finalizationPlan);

  assert.equal(result.facts.review_packet, "finalization-draft");
  assert.equal(result.facts.readiness_receipt, "invalid");
  assert.equal(result.projection.gate, "blocked");
  assert.equal(result.projection.state, "operating-readiness-receipt-invalid");
  assert.equal(setup.requests.length, 0);
});
