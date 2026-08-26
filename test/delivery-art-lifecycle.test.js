import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_ART_LIFECYCLE_ACTIONS,
  DELIVERY_ART_LIFECYCLE_GATES,
  bindFinalizedReviewPacketReference,
  deliveryArtLifecycleCapabilities,
  deriveDeliveryArtLifecycleState,
  validateDeliveryArtLifecyclePlan,
} from "../src/delivery-art/lifecycle.js";

const validPlan = {
  schema_version: 1,
  artifact_type: "delivery_art_lifecycle_plan",
  lifecycle_id: "lifecycle:delivery-698-work-item-819",
  created_at: "2026-08-12T16:47:00+08:00",
  delivery_id: "delivery-698",
  covered_work_item_ids: ["work-item-819"],
  operator: {
    id: "operator:workspace-owner",
    decision_source: "operator",
  },
  landing_unit: {
    decision: "child_isolated_landing_unit",
    split_reason: "One OOS Landing Unit owns this source and rollback boundary.",
    repo_root: "/home/operator/projects/operator-orchestration-service",
    owner_repo: "operator-orchestration-service",
    base_ref: "origin/main",
    branch: "codex/art-819-delivery-art-lifecycle-reconcile",
    rollback_boundary: "Revert the OOS pull request and supersede its evidence.",
  },
  architecture: {
    required: true,
    packet_path: ".art/review-packets/delivery-698-819-820-architecture.json",
  },
  artifacts: {
    work_start_path: ".art/review-packets/delivery-698-819-work-start.json",
    review_packet_path: ".art/review-packets/delivery-698-819-v2.json",
    readiness_receipt_path: ".art/review-packets/delivery-698-819-readiness.json",
    evidence_path: ".art/review-packets/delivery-698-819-evidence.json",
  },
};

test("lifecycle capability truth is source-owned and separates normal from compatibility paths", () => {
  const contract = deliveryArtLifecycleCapabilities();
  const byId = new Map(contract.capabilities.map((entry) => [entry.id, entry]));

  assert.equal(contract.schema_version, 2);
  assert.equal(contract.owner_repo, "operator-orchestration-service");
  assert.equal(
    contract.normal_operator_surface.start_command,
    "npm run art -- work start <work-item-id>",
  );
  assert.equal(
    contract.compatibility_operator_surface.plan_artifact_type,
    "delivery_art_lifecycle_plan",
  );
  assert.deepEqual(contract.target_operator_surface, {
    primary_adapter: "governance-operations-console",
    workflow_semantics_owner: "operator-orchestration-service",
    cli_posture: "transitional-engineering-recovery-diagnostics",
    shared_api_required: true,
    adapter_local_state_machine_allowed: false,
  });
  assert.equal(byId.get("persistent-work-session").normal_path, true);
  assert.equal(byId.get("historical-material-freshness").contract_version, 2);
  assert.equal(byId.get("review-packet-v2-authoring").normal_path, true);
  assert.equal(
    byId.get("authoritative-review-evidence-projection").state,
    "implemented",
  );
  assert.equal(byId.get("review-packet-v1-compatibility").state, "compatibility");
  assert.equal(byId.get("review-packet-v1-compatibility").normal_path, false);
  assert.equal(byId.get("temporal-lifecycle-adapter").state, "planned");
  assert.equal(byId.get("work-session-resource-retirement").state, "human-gated");
  assert.equal(
    byId.get("work-session-resource-retirement").activation_work_item_id,
    "work-item-970",
  );
  assert.deepEqual(contract.human_gates, [
    "architecture-decision",
    "landing-unit-decision",
    "exception-or-risk-acceptance",
    "pull-request-review",
    "source-merge",
    "security-acceptance",
    "art-closeout",
  ]);
});

test("lifecycle plans bind one owner-repo Landing Unit and explicit artifact paths", () => {
  assert.deepEqual(validateDeliveryArtLifecyclePlan(validPlan), {
    errors: [],
    valid: true,
  });

  const invalid = structuredClone(validPlan);
  invalid.architecture.packet_path = null;
  const result = validateDeliveryArtLifecyclePlan(invalid);
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.includes("packet_path")), true);
});

test("finalized Review Packet custody is recorded in the lifecycle plan", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const updated = bindFinalizedReviewPacketReference(validPlan, {
    artifact_type: "art_review_packet",
    status: "finalized",
    custody: {
      state: "durable",
      uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
    },
    integrity: { content_digest: digest },
  });

  assert.deepEqual(updated.artifacts.finalized_review_packet_ref, {
    uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
    digest,
  });
  assert.equal(validateDeliveryArtLifecyclePlan(updated).valid, true);
  assert.equal(validPlan.artifacts.finalized_review_packet_ref, undefined);
});

test("lifecycle state projection advances mechanics and preserves human gates", () => {
  assert.equal(
    deriveDeliveryArtLifecycleState({ architecture: "local-ready" }).next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.PERSIST_ARCHITECTURE,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({ architecture: "required-missing" }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.ARCHITECTURE_DECISION,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      architecture: "ready",
      work_start: "missing",
    }).next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_WORK_START,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      architecture: "ready",
      work_start: "implementation-ready",
      source: "pushed",
      evidence: "ready",
      evidence_projection: "current",
      review_packet: "local-draft",
      pull_request: "open",
    }).next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.MARK_MERGE_READY,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      architecture: "ready",
      work_start: "implementation-ready",
      source: "pushed",
      evidence: "ready",
      review_packet: "merge-ready",
      pull_request: "open",
    }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.SOURCE_MERGE,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      architecture: "ready",
      work_start: "implementation-ready",
      source: "pushed",
      evidence: "ready",
      review_packet: "finalized",
      art: "open",
    }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.ART_CLOSEOUT,
  );
});

test("lifecycle state projection is retry-safe for every durable checkpoint", () => {
  const cases = [
    [
      { architecture: "ready", work_start: "local-draft" },
      DELIVERY_ART_LIFECYCLE_ACTIONS.EVALUATE_WORK_START,
    ],
    [
      {
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        evidence_projection: "current",
        review_packet: "missing",
        pull_request: "open",
      },
      DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
    ],
    [
      {
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        evidence_projection: "current",
        review_packet: "legacy-local-draft",
        pull_request: "open",
      },
      DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
    ],
    [
      {
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        review_packet: "merge-ready",
        pull_request: "merged",
      },
      DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_FINALIZATION,
    ],
    [
      {
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        review_packet: "finalization-draft",
        readiness_receipt: "missing",
      },
      DELIVERY_ART_LIFECYCLE_ACTIONS.ISSUE_OPERATING_READINESS,
    ],
    [
      {
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        review_packet: "finalization-draft",
        readiness_receipt: "ready",
      },
      DELIVERY_ART_LIFECYCLE_ACTIONS.FINALIZE_REVIEW_PACKET,
    ],
  ];

  for (const [facts, expectedAction] of cases) {
    assert.equal(deriveDeliveryArtLifecycleState(facts).next_action, expectedAction);
  }

  const complete = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "dirty",
    evidence: "missing",
    review_packet: "finalized",
    art: "closed",
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.state, "complete");
});

test("durable post-merge checkpoints ignore mutable checkout and evidence state", () => {
  const merged = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "wrong-branch",
    evidence: "missing",
    review_packet: "merge-ready",
    pull_request: "merged",
  });
  assert.equal(
    merged.next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_FINALIZATION,
  );

  const finalization = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "dirty",
    evidence: "invalid",
    review_packet: "finalization-draft",
    readiness_receipt: "ready",
  });
  assert.equal(
    finalization.next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.FINALIZE_REVIEW_PACKET,
  );

  const invalidReceipt = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    review_packet: "finalization-draft",
    readiness_receipt: "invalid",
  });
  assert.equal(invalidReceipt.gate, DELIVERY_ART_LIFECYCLE_GATES.BLOCKED);
  assert.equal(invalidReceipt.state, "operating-readiness-receipt-invalid");

  const mismatched = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "pushed",
    evidence: "ready",
    evidence_projection: "current",
    review_packet: "merge-ready",
    pull_request: "mismatch",
  });
  assert.equal(mismatched.gate, DELIVERY_ART_LIFECYCLE_GATES.BLOCKED);
  assert.equal(mismatched.state, "merge-ready-source-binding-invalid");

  const revised = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "pushed",
    evidence: "ready",
    evidence_projection: "current",
    exceptions: "approved",
    review_packet: "merge-ready",
    pull_request: "stale-head",
  });
  assert.equal(
    revised.next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
  );
  assert.equal(revised.state, "review-packet-revision-required");
});

test("pre-merge packet authoring permits only the exact open pull request", () => {
  for (const reviewPacket of ["missing", "local-draft"]) {
    for (const pullRequest of ["merged", "mismatch", "unknown"]) {
      const result = deriveDeliveryArtLifecycleState({
        architecture: "ready",
        work_start: "implementation-ready",
        source: "pushed",
        evidence: "ready",
        evidence_projection: "current",
        review_packet: reviewPacket,
        pull_request: pullRequest,
      });
      assert.equal(result.gate, DELIVERY_ART_LIFECYCLE_GATES.BLOCKED);
      assert.equal(result.next_action, null);
    }
  }
});

test("Review Packet authoring waits for an exact non-draft pull request head", () => {
  const baseFacts = {
    architecture: "ready",
    work_start: "implementation-ready",
    source: "pushed",
    evidence: "ready",
    evidence_projection: "current",
    review_packet: "missing",
  };
  assert.equal(
    deriveDeliveryArtLifecycleState({
      ...baseFacts,
      pull_request: "missing",
    }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      ...baseFacts,
      source: "base-diverged",
      pull_request: "open",
    }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.SOURCE_WORK,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      ...baseFacts,
      pull_request: "wrong-base",
    }).gate,
    DELIVERY_ART_LIFECYCLE_GATES.PULL_REQUEST,
  );
  assert.equal(
    deriveDeliveryArtLifecycleState({
      ...baseFacts,
      pull_request: "open",
    }).next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.DRAFT_REVIEW_PACKET,
  );
});

test("pre-merge authoring projects authoritative evidence before evaluating authored results", () => {
  const result = deriveDeliveryArtLifecycleState({
    architecture: "ready",
    work_start: "implementation-ready",
    source: "pushed",
    evidence: "ready",
    evidence_projection: "required",
    review_packet: "missing",
    pull_request: "open",
  });

  assert.equal(
    result.next_action,
    DELIVERY_ART_LIFECYCLE_ACTIONS.PROJECT_REVIEW_EVIDENCE,
  );
  assert.equal(result.gate, null);
});
