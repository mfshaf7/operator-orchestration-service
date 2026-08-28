import assert from "node:assert/strict";
import test from "node:test";

import {
  DeliveryArtReviewEvidenceError,
  deliveryArtReviewEvidenceProjectionDigest,
  projectDeliveryArtReviewEvidence,
} from "../src/delivery-art/review-evidence.js";

const source = {
  base_commit: "1".repeat(40),
  base_ref: "origin/main",
  branch: "feature/988-authoritative-review-evidence",
  changed_files: ["src/delivery-art/review-evidence.js", "test/review-evidence.test.js"],
  head_commit: "2".repeat(40),
  repo_name: "operator-orchestration-service",
};

const workStart = {
  artifact_type: "delivery_art_work_start_record",
  covered_work_item_ids: ["work-item-988"],
  landing_unit: {
    branch_plan: [{
      base_commit: source.base_commit,
      base_ref: source.base_ref,
      branch: source.branch,
      repo: source.repo_name,
    }],
  },
  readiness: { level: "implementation-ready" },
  integrity: { content_digest: `sha256:${"a".repeat(64)}` },
  custody: {
    state: "durable",
    uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
  },
};

const architecture = {
  integrity: { content_digest: `sha256:${"b".repeat(64)}` },
  custody: {
    uri: `wgcf://artifacts/delivery-art/sha256/${"b".repeat(64)}`,
  },
  conformance_plan: {
    required: true,
    cases: [{
      id: "case:review-evidence-positive",
      applies_to_work_item_ids: ["work-item-988"],
      expected_outcome: "Authoritative source truth projects deterministic evidence requirements.",
      fidelity: "filesystem",
      target_readiness: "merge-ready",
    }],
  },
};

function resultEvidence(overrides = {}) {
  return {
    id: "evidence:test-review-evidence",
    name: "Review evidence projection tests",
    command: "node --test test/delivery-art-review-evidence.test.js",
    fidelity: "filesystem",
    result: "pass",
    summary: "Projection tests passed.",
    conformance_case_ids: ["case:review-evidence-positive"],
    source_revisions: [{ repo: source.repo_name, commit: "3".repeat(40) }],
    evidence_refs: [{ uri: "local://test-output", digest: `sha256:${"c".repeat(64)}` }],
    not_applicable_reason: null,
    authority_ref: null,
    ...overrides,
  };
}

test("projection derives source and acceptance evidence while preserving authored judgment", () => {
  const projected = projectDeliveryArtReviewEvidence({
    architecture,
    currentDocument: {
      evidence: {
        changed_surfaces: [{
          id: "evidence:old-surface",
          repo: source.repo_name,
          path: source.changed_files[0],
          summary: "Implements the authoritative projection domain.",
        }],
        tests: [resultEvidence({ source_revisions: [] })],
        validations: [resultEvidence({
          id: "evidence:validation-review-evidence",
          name: "Repository validation",
          command: "npm test",
          source_revisions: [],
        })],
        acceptance_mapping: [],
        runtime_and_live: [],
        security_and_trust: [],
      },
      exceptions: [],
      change_record_refs: ["docs/records/change-records/review-evidence.md"],
    },
    source,
    workStart,
  });

  assert.equal(projected.readiness.ready, true);
  assert.equal(projected.evidence_document.evidence.changed_surfaces.length, 2);
  assert.equal(
    projected.evidence_document.evidence.changed_surfaces[0].summary,
    "Implements the authoritative projection domain.",
  );
  assert.deepEqual(
    projected.evidence_document.evidence.tests[0].source_revisions,
    [{ repo: source.repo_name, commit: source.head_commit }],
  );
  assert.equal(
    projected.evidence_document.evidence.acceptance_mapping[0].work_item_id,
    "work-item-988",
  );
  assert.ok(
    projected.evidence_document.evidence.acceptance_mapping[0].evidence_ids.length >= 3,
  );
  assert.deepEqual(
    projected.evidence_document.projection.required_conformance_case_ids,
    ["case:review-evidence-positive"],
  );
});

test("projection preserves prior-head evidence and blocks automatic restamping", () => {
  const priorHead = "3".repeat(40);
  const projected = projectDeliveryArtReviewEvidence({
    architecture,
    currentDocument: {
      evidence: {
        changed_surfaces: [],
        tests: [resultEvidence({
          source_revisions: [{ repo: source.repo_name, commit: priorHead }],
        })],
        validations: [resultEvidence({
          id: "evidence:validation-review-evidence",
          source_revisions: [{ repo: source.repo_name, commit: priorHead }],
        })],
        acceptance_mapping: [],
        runtime_and_live: [],
        security_and_trust: [],
      },
      exceptions: [],
      change_record_refs: [],
    },
    source,
    workStart,
  });

  assert.equal(projected.readiness.ready, false);
  assert.deepEqual(
    projected.evidence_document.evidence.tests[0].source_revisions,
    [{ repo: source.repo_name, commit: priorHead }],
  );
  assert.deepEqual(
    projected.readiness.findings
      .filter((entry) => entry.code === "evidence_source_revision_stale")
      .map((entry) => entry.target),
    ["evidence:test-review-evidence", "evidence:validation-review-evidence"],
  );
});

test("projection returns exact corrective findings for incomplete evidence", () => {
  const projected = projectDeliveryArtReviewEvidence({
    architecture,
    currentDocument: null,
    source,
    workStart,
  });

  assert.equal(projected.readiness.ready, false);
  assert.deepEqual(
    projected.readiness.findings.map((entry) => entry.code),
    [
      "test_evidence_missing",
      "validation_evidence_missing",
      "conformance_case_evidence_missing",
    ],
  );
});

test("projection rejects source that does not match durable work-start truth", () => {
  assert.throws(
    () => projectDeliveryArtReviewEvidence({
      currentDocument: null,
      source: { ...source, branch: "feature/wrong-branch" },
      workStart,
    }),
    (error) =>
      error instanceof DeliveryArtReviewEvidenceError &&
      error.code === "delivery_art_review_evidence_source_mismatch",
  );
});

test("projection does not report readiness when authored result evidence failed", () => {
  const projected = projectDeliveryArtReviewEvidence({
    currentDocument: {
      evidence: {
        changed_surfaces: [],
        tests: [resultEvidence({
          conformance_case_ids: [],
          evidence_refs: [],
          result: "fail",
        })],
        validations: [resultEvidence({
          conformance_case_ids: [],
          id: "evidence:validation-review-evidence",
        })],
        acceptance_mapping: [],
        runtime_and_live: [],
        security_and_trust: [],
      },
      exceptions: [],
      change_record_refs: [],
    },
    source,
    workStart,
  });

  assert.equal(projected.readiness.ready, false);
  assert.equal(
    projected.readiness.findings.some((entry) =>
      entry.code === "evidence_result_failed"),
    true,
  );
});

test("projection digest changes when authoritative source truth changes", () => {
  const first = deliveryArtReviewEvidenceProjectionDigest({
    architecture,
    source,
    workStart,
  });
  const second = deliveryArtReviewEvidenceProjectionDigest({
    architecture,
    source: { ...source, head_commit: "4".repeat(40) },
    workStart,
  });

  assert.notEqual(first, second);
});

test("projection digest changes for authored results but not generated source revisions", () => {
  const authored = resultEvidence({ conformance_case_ids: [] });
  const first = deliveryArtReviewEvidenceProjectionDigest({
    currentDocument: { evidence: { tests: [authored] } },
    source,
    workStart,
  });
  const second = deliveryArtReviewEvidenceProjectionDigest({
    currentDocument: {
      evidence: {
        tests: [{
          ...authored,
          source_revisions: [{ repo: source.repo_name, commit: "5".repeat(40) }],
        }],
      },
    },
    source,
    workStart,
  });
  const changed = deliveryArtReviewEvidenceProjectionDigest({
    currentDocument: {
      evidence: {
        tests: [{ ...authored, result: "fail" }],
      },
    },
    source,
    workStart,
  });

  assert.equal(first, second);
  assert.notEqual(first, changed);
});
