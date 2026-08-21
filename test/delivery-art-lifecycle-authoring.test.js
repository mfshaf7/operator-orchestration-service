import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDeliveryArtReviewPacketFinalizationDraft,
  createDeliveryArtReviewPacketV2Draft,
  createDeliveryArtWorkStartDraft,
  DeliveryArtAuthoringError,
} from "../src/delivery-art/lifecycle-authoring.js";
import { validateDeliveryArtArtifact } from "../src/delivery-art/contracts.js";

const FIXTURE_DIR = fileURLToPath(
  new URL("../contracts/delivery-art/fixtures/", import.meta.url),
);

function fixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

test("work-start authoring binds exact ART and source-base truth", () => {
  const candidate = createDeliveryArtWorkStartDraft({
    architecture: {
      packet_digest: `sha256:${"a".repeat(64)}`,
      packet_ref: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
      readiness: "architecture-ready",
      required: true,
    },
    coveredWorkItemIds: ["work-item-819"],
    createdAt: "2026-08-12T17:00:00+08:00",
    deliveryId: "delivery-698",
    landingUnit: {
      branch_plan: [{
        base_commit: "2".repeat(40),
        base_ref: "origin/main",
        branch: "codex/art-819-delivery-art-lifecycle-reconcile",
        repo: "operator-orchestration-service",
      }],
      decision: "child_isolated_landing_unit",
      owner_repos: ["operator-orchestration-service"],
      planned_review_packet_ref: ".art/review-packets/delivery-698-819-v2.json",
      split_reason: "One OOS change owns the source and rollback boundary.",
    },
    operator: {
      decision_source: "operator",
      id: "operator:workspace-owner",
    },
    sourceSnapshot: {
      art_digest: `sha256:${"b".repeat(64)}`,
      art_ref: "openproject://work_packages/819",
      captured_at: "2026-08-12T16:59:00+08:00",
      repo_revisions: [{
        base_ref: "origin/main",
        commit: "2".repeat(40),
        repo: "operator-orchestration-service",
      }],
    },
  });

  assert.equal(candidate.readiness.level, "draft");
  assert.equal(candidate.custody.state, "local-draft");
  assert.match(
    candidate.artifact_id,
    /^work-start:delivery-698-work-item-819-scope-[0-9a-f]{64}$/,
  );
  assert.equal(validateDeliveryArtArtifact(candidate).valid, true);

  const changedSource = createDeliveryArtWorkStartDraft({
    architecture: candidate.architecture,
    coveredWorkItemIds: candidate.covered_work_item_ids,
    createdAt: candidate.created_at,
    deliveryId: candidate.delivery_id,
    landingUnit: {
      ...candidate.landing_unit,
      branch_plan: [{
        ...candidate.landing_unit.branch_plan[0],
        branch: "defect/819-reopened-source",
      }],
    },
    operator: candidate.operator,
    sourceSnapshot: candidate.source_snapshot,
  });
  assert.notEqual(changedSource.artifact_id, candidate.artifact_id);
});

test("Review Packet v2 authoring preserves work-start source boundaries", () => {
  const workStart = fixture("work-start-record.valid.json");
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const candidate = createDeliveryArtReviewPacketV2Draft({
    createdAt: mergeReady.created_at,
    evidence: mergeReady.evidence,
    landingUnit: {
      evidence_kind: "open_pr",
      repos: mergeReady.landing_unit.repos,
      rollback_boundary: mergeReady.landing_unit.rollback_boundary,
    },
    operator: mergeReady.operator,
    workStart,
  });

  assert.equal(candidate.schema_version, 2);
  assert.equal(candidate.status, "draft");
  assert.match(
    candidate.packet_id,
    /^review-packet:delivery-698-work-item-801-source-[0-9a-f]{64}$/,
  );
  assert.equal(candidate.work_start.artifact_ref, workStart.custody.uri);
  assert.equal(validateDeliveryArtArtifact(candidate).valid, true);

  const repeated = createDeliveryArtReviewPacketV2Draft({
    createdAt: mergeReady.created_at,
    evidence: mergeReady.evidence,
    landingUnit: {
      evidence_kind: "open_pr",
      repos: mergeReady.landing_unit.repos,
      rollback_boundary: mergeReady.landing_unit.rollback_boundary,
    },
    operator: mergeReady.operator,
    workStart,
  });
  assert.equal(repeated.packet_id, candidate.packet_id);

  const revisedSource = structuredClone(mergeReady.landing_unit);
  revisedSource.evidence_kind = "open_pr";
  revisedSource.repos[0].head_commit = "8".repeat(40);
  const revisedEvidence = structuredClone(mergeReady.evidence);
  for (const section of [
    "tests",
    "validations",
    "runtime_and_live",
    "security_and_trust",
  ]) {
    for (const entry of revisedEvidence[section] ?? []) {
      for (const revision of entry.source_revisions ?? []) {
        revision.commit = "8".repeat(40);
      }
    }
  }
  const revised = createDeliveryArtReviewPacketV2Draft({
    createdAt: mergeReady.created_at,
    evidence: revisedEvidence,
    landingUnit: revisedSource,
    operator: mergeReady.operator,
    workStart,
  });
  assert.notEqual(revised.packet_id, candidate.packet_id);
  assert.equal(validateDeliveryArtArtifact(revised).valid, true);

  const mismatched = structuredClone(mergeReady.landing_unit);
  mismatched.repos[0].base_commit = "9".repeat(40);
  assert.throws(
    () => createDeliveryArtReviewPacketV2Draft({
      createdAt: mergeReady.created_at,
      evidence: mergeReady.evidence,
      landingUnit: mismatched,
      operator: mergeReady.operator,
      workStart,
    }),
    (error) => error instanceof DeliveryArtAuthoringError &&
      error.code === "delivery_art_review_packet_source_mismatch",
  );
});

test("finalization authoring converts exactly one durable merge-ready packet", () => {
  const mergeReady = fixture("review-packet-merge-ready.valid.json");
  const candidate = createDeliveryArtReviewPacketFinalizationDraft({
    mergeReadyPacket: mergeReady,
    mergedRepos: [{
      head_commit: mergeReady.landing_unit.repos[0].head_commit,
      merge_commit: "4".repeat(40),
      pr_url: mergeReady.landing_unit.repos[0].pr_url,
      repo_name: "workspace-governance",
    }],
  });

  assert.equal(candidate.status, "draft");
  assert.equal(candidate.landing_unit.evidence_kind, "merged_pr");
  assert.deepEqual(candidate.custody.supersedes, {
    digest: mergeReady.integrity.content_digest,
    uri: mergeReady.custody.uri,
  });
  assert.equal(validateDeliveryArtArtifact(candidate).valid, true);
});
