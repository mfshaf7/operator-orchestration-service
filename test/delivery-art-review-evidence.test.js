import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applicableDeliveryArtConformanceCases,
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

function architectureV5() {
  return {
    schema_version: 5,
    integrity: architecture.integrity,
    custody: architecture.custody,
    architecture: {
      landing_units: [
        {
          id: "delivery-988-source",
          covered_work_item_ids: ["work-item-988"],
        },
        {
          id: "delivery-988-runtime",
          covered_work_item_ids: ["work-item-989"],
        },
      ],
    },
    conformance_plan: {
      required: true,
      cases: [
        {
          id: "case:v5-source",
          applies_to_work_item_ids: ["work-item-900", "work-item-988"],
          evidence_owner_landing_unit_id: "delivery-988-source",
          expected_outcome: "The source Landing Unit proves its merge contract.",
          fidelity: "filesystem",
          target_readiness: "merge-ready",
        },
        {
          id: "case:v5-operating",
          applies_to_work_item_ids: ["work-item-900", "work-item-988"],
          evidence_owner_landing_unit_id: "delivery-988-source",
          expected_outcome: "The source Landing Unit proves its operating contract.",
          fidelity: "sandbox-runtime",
          target_readiness: "operating-ready",
        },
        {
          id: "case:v5-other-owner",
          applies_to_work_item_ids: ["work-item-988", "work-item-989"],
          evidence_owner_landing_unit_id: "delivery-988-runtime",
          expected_outcome: "A separate Landing Unit owns this proof.",
          fidelity: "governed-runtime",
          target_readiness: "operating-ready",
        },
      ],
    },
  };
}

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

test("projection inherits omitted conformance fidelity from architecture truth", () => {
  const inheritedEvidence = resultEvidence({ source_revisions: [] });
  delete inheritedEvidence.fidelity;
  const projected = projectDeliveryArtReviewEvidence({
    architecture,
    currentDocument: {
      evidence: {
        changed_surfaces: [],
        tests: [inheritedEvidence],
        validations: [resultEvidence({
          conformance_case_ids: [],
          id: "evidence:validation-review-evidence",
          source_revisions: [],
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

  assert.equal(
    projected.evidence_document.evidence.tests[0].fidelity,
    "filesystem",
  );
  assert.deepEqual(
    projected.evidence_document.projection.required_conformance_cases,
    [{
      applies_to_work_item_ids: ["work-item-988"],
      expected_outcome:
        "Authoritative source truth projects deterministic evidence requirements.",
      fidelity: "filesystem",
      id: "case:review-evidence-positive",
    }],
  );
});

test("projection rejects explicit fidelity that contradicts architecture truth", () => {
  const projected = projectDeliveryArtReviewEvidence({
    architecture,
    currentDocument: {
      evidence: {
        changed_surfaces: [],
        tests: [resultEvidence({ fidelity: "real-git", source_revisions: [] })],
        validations: [resultEvidence({
          conformance_case_ids: [],
          id: "evidence:validation-review-evidence",
          source_revisions: [],
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
      entry.code === "conformance_case_fidelity_mismatch"),
    true,
  );
});

test("projection requires separate evidence for mixed architecture fidelities", () => {
  const mixedArchitecture = structuredClone(architecture);
  mixedArchitecture.conformance_plan.cases.push({
    id: "case:review-evidence-real-git",
    applies_to_work_item_ids: ["work-item-988"],
    expected_outcome: "Real Git history proves source causality.",
    fidelity: "real-git",
    target_readiness: "merge-ready",
  });
  const mixedEvidence = resultEvidence({
    conformance_case_ids: [
      "case:review-evidence-positive",
      "case:review-evidence-real-git",
    ],
    source_revisions: [],
  });
  delete mixedEvidence.fidelity;
  const projected = projectDeliveryArtReviewEvidence({
    architecture: mixedArchitecture,
    currentDocument: {
      evidence: {
        changed_surfaces: [],
        tests: [mixedEvidence],
        validations: [resultEvidence({
          conformance_case_ids: [],
          id: "evidence:validation-review-evidence",
          source_revisions: [],
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
      entry.code === "conformance_case_fidelity_ambiguous"),
    true,
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

test("v5 conformance selection is exact by evidence owner and readiness phase", () => {
  const candidate = architectureV5();

  assert.deepEqual(
    applicableDeliveryArtConformanceCases(
      candidate,
      ["work-item-988"],
      "merge-ready",
      "delivery-988-source",
    ).map((entry) => entry.id),
    ["case:v5-source"],
  );
  assert.deepEqual(
    applicableDeliveryArtConformanceCases(
      candidate,
      ["work-item-988"],
      "operating-ready",
      "delivery-988-source",
    ).map((entry) => entry.id),
    ["case:v5-operating"],
  );
});

test("v5 owner-and-phase selection matches the canonical parity vectors", () => {
  const fixture = JSON.parse(readFileSync(new URL(
    "../contracts/delivery-art/fixtures/architecture-packet-v5-parity-vectors.valid.json",
    import.meta.url,
  ), "utf8"));

  for (const vector of fixture.vectors) {
    const candidate = {
      schema_version: fixture.architecture_packet_schema_version,
      conformance_plan: { required: true, cases: vector.cases },
    };
    for (const expectation of vector.selection_expectations) {
      assert.deepEqual(
        applicableDeliveryArtConformanceCases(
          candidate,
          [],
          expectation.target_readiness,
          expectation.landing_unit_id,
        ).map((entry) => entry.id),
        [...expectation.selected_case_ids].sort(),
        `${vector.id}: ${expectation.landing_unit_id}/${expectation.target_readiness}`,
      );
    }
  }
});

test("v5 evidence projection emits phase-specific schema-v2 ownership truth", () => {
  const projected = projectDeliveryArtReviewEvidence({
    architecture: architectureV5(),
    currentDocument: null,
    source,
    targetReadiness: "operating-ready",
    workStart,
  });

  assert.equal(projected.evidence_document.projection.schema_version, 2);
  assert.equal(
    projected.evidence_document.projection.target_readiness,
    "operating-ready",
  );
  assert.deepEqual(
    projected.evidence_document.projection.required_conformance_case_ids,
    ["case:v5-operating"],
  );
  assert.equal(
    projected.requirements.conformance_cases[0]
      .evidence_owner_landing_unit_id,
    "delivery-988-source",
  );
  assert.throws(
    () => projectDeliveryArtReviewEvidence({
      architecture: architectureV5(),
      currentDocument: null,
      source,
      targetReadiness: "implementation-ready",
      workStart,
    }),
    (error) =>
      error instanceof DeliveryArtReviewEvidenceError &&
      error.code === "delivery_art_review_evidence_readiness_invalid",
  );
});

test("v5 operating projection preserves owned merge-phase evidence", () => {
  const mergeEvidence = resultEvidence({
    conformance_case_ids: ["case:v5-source"],
    source_revisions: [],
  });
  const operatingEvidence = resultEvidence({
    conformance_case_ids: ["case:v5-operating"],
    fidelity: "sandbox-runtime",
    id: "evidence:v5-operating",
    source_revisions: [],
  });
  const projected = projectDeliveryArtReviewEvidence({
    architecture: architectureV5(),
    currentDocument: {
      evidence: {
        acceptance_mapping: [],
        changed_surfaces: [],
        runtime_and_live: [operatingEvidence],
        security_and_trust: [],
        tests: [mergeEvidence],
        validations: [resultEvidence({
          conformance_case_ids: [],
          id: "evidence:v5-validation",
          source_revisions: [],
        })],
      },
      exceptions: [],
      change_record_refs: [],
    },
    source,
    targetReadiness: "operating-ready",
    workStart,
  });

  assert.equal(projected.readiness.ready, true);
  assert.equal(
    projected.readiness.findings.some(
      (entry) => entry.code === "conformance_case_out_of_scope",
    ),
    false,
  );
  assert.deepEqual(
    projected.evidence_document.evidence.tests[0].conformance_case_ids,
    ["case:v5-source"],
  );
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
