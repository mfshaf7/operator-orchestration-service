import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeliveryArtWorkSessionCloseAdapter,
  createDeliveryArtWorkSessionRuntime,
  deliveryWorkItemStatus,
} from
  "../src/delivery-art/work-session-runtime.js";

const SECRET = "source-executor-runtime-test-secret-material-1234567890";

function finalizedReviewPacket(workItemIds = ["work-item-1138"]) {
  return {
    artifact_type: "art_review_packet",
    completion_mapping: workItemIds.map((workItemId) => ({
      evidence_summary: `The runtime close adapter covers ${workItemId}.`,
      work_item_id: workItemId,
    })),
    packet_id: "review-packet:delivery-892-work-item-1138",
    covered_work_item_ids: workItemIds,
    delivery_id: "delivery-892",
    evidence: {
      acceptance_mapping: [
        {
          work_item_id: "work-item-1138",
          summary: "The runtime close adapter is composed and validated.",
        },
      ],
      changed_surfaces: [
        {
          path: "src/delivery-art/work-session-runtime.js",
          repo: "operator-orchestration-service",
          summary: "Composes ART completion into work-session closeout.",
        },
      ],
      tests: [
        {
          name: "runtime composition tests",
          result: "pass",
          summary: "The close adapter succeeds and fails closed.",
        },
      ],
      validations: [
        {
          name: "targeted test suite",
          result: "pass",
          summary: "Focused Delivery ART tests passed.",
        },
      ],
    },
    integrity: { content_digest: "sha256:review-packet" },
    landing_unit: {
      evidence_kind: "merged_pr",
      merge_commit: "b".repeat(40),
      pr_url: "https://example.test/pr/1",
      repos: [{
        branch: "main",
        changed_files: ["src/delivery-art/work-session-runtime.js"],
        repo_name: "operator-orchestration-service",
      }],
      rollback_boundary: "Revert the test landing unit.",
    },
    packet_digest: "digest-runtime-closeout",
    schema_version: 1,
    status: "finalized",
  };
}

function workItemEvidence(workItemId, status = "ready") {
  const id = Number.parseInt(workItemId.replace("work-item-", ""), 10);
  return {
    continuation_context: {
      open_siblings: [],
      parent_chain: [],
      summary: { open_child_count: 0, open_descendant_count: 0 },
      target_item: { id, status },
    },
    evidence_packet: {
      continuation_summary: { open_child_count: 0, open_descendant_count: 0 },
      parent_chain: [],
      target_item: {
        blocked: false,
        completion_narrative_contract_issues: [],
        completion_narrative_contract_satisfied: true,
        completion_status_transition_available: true,
        id,
        ready_contract_missing_fields: [],
        ready_contract_satisfied: true,
        status,
        subject: `Work item ${id}`,
        type: "User story",
      },
    },
    work_item_id: workItemId,
  };
}

function initiativeReadiness({
  openDescendantCount = 1,
  readyForCloseout = false,
  status = "in-progress",
} = {}) {
  return {
    closeoutReadiness: {
      epic: { status },
      ready_for_closeout: readyForCloseout,
      reasons: readyForCloseout ? [] : ["Open initiative work remains."],
      summary: { blocked_count: 0, open_descendant_count: openDescendantCount },
    },
  };
}

test("work-session runtime stays disabled without an admitted source executor", () => {
  assert.equal(createDeliveryArtWorkSessionRuntime({ config: {} }), null);
});

test("work-session runtime reads the bounded Delivery status response", () => {
  assert.equal(
    deliveryWorkItemStatus({ status: "done" }),
    "done",
  );
  assert.equal(deliveryWorkItemStatus({ target_item: { status: "in-progress" } }), null);
});

test("work-session runtime close adapter completes ART from the finalized Review Packet", async () => {
  const packet = finalizedReviewPacket();
  const calls = [];
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout is not expected");
      },
      async completeDeliveryWorkItem(input) {
        calls.push(input);
        return { work_item: { status: "done" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        return workItemEvidence(workItemId);
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness();
      },
    },
    store: {
      readArtifact(session, artifactFile) {
        assert.equal(session.session_id, "work-session:test");
        assert.equal(artifactFile, "artifacts/review-packet.json");
        return packet;
      },
    },
  });

  const result = await adapter.close({
    session: {
      artifacts: { review_packet_file: "artifacts/review-packet.json" },
      session_id: "work-session:test",
    },
    workItemId: "work-item-1138",
  });

  assert.equal(result.complete, true);
  assert.equal(result.closeout.state, "complete");
  assert.deepEqual(result.closeout.covered_work_item_ids, ["work-item-1138"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callerId, "operator-orchestration-service");
  assert.equal(calls[0].workItemId, "work-item-1138");
  assert.equal(
    calls[0].completionSummary,
    "The runtime close adapter is composed and validated.",
  );
  assert.match(calls[0].changedSurfaces, /work-session-runtime\.js/);
  assert.equal(result.next_action.code, "initiative-work-remains");
  assert.equal(
    result.closeout.initiative_disposition.disposition,
    "retained-open-work",
  );
});

test("work-session runtime close adapter retains partial failure for retry", async () => {
  const failure = new Error("simulated ART completion failure");
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout is not expected");
      },
      async completeDeliveryWorkItem() {
        throw failure;
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        return workItemEvidence(workItemId);
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness();
      },
    },
    store: { readArtifact: () => finalizedReviewPacket() },
  });

  const result = await adapter.close({
    session: {
      artifacts: { review_packet_file: "artifacts/review-packet.json" },
    },
    workItemId: "work-item-1138",
  });

  assert.equal(result.complete, false);
  assert.equal(result.closeout.state, "partial_failure");
  assert.equal(result.closeout.failed[0].work_item_id, "work-item-1138");
  assert.equal(result.next_action.code, "landing-unit-closeout-retry-required");
});

test("work-session runtime rejects a non-terminal completion response", async () => {
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout is not expected");
      },
      async completeDeliveryWorkItem() {
        return { work_item: { status: "in-progress" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        return workItemEvidence(workItemId);
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness();
      },
    },
    store: { readArtifact: () => finalizedReviewPacket() },
  });

  const result = await adapter.close({
    session: { artifacts: { review_packet_file: "artifacts/review-packet.json" } },
    workItemId: "work-item-1138",
  });

  assert.equal(result.complete, false);
  assert.equal(result.closeout.state, "partial_failure");
  assert.equal(result.closeout.failed[0].work_item_id, "work-item-1138");
});

test("work-session runtime close adapter completes every covered work item", async () => {
  const packet = finalizedReviewPacket(["work-item-1138", "work-item-1139"]);
  const completed = [];
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout is not expected");
      },
      async completeDeliveryWorkItem({ workItemId }) {
        completed.push(workItemId);
        return { work_item: { status: "done" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        return workItemEvidence(workItemId);
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness();
      },
    },
    store: { readArtifact: () => packet },
  });

  const result = await adapter.close({
    session: {
      artifacts: { review_packet_file: "artifacts/review-packet.json" },
    },
    workItemId: "work-item-1139",
  });

  assert.equal(result.complete, true);
  assert.deepEqual(completed, ["work-item-1138", "work-item-1139"]);
  assert.deepEqual(
    result.closeout.completed.map((entry) => entry.work_item_id),
    completed,
  );
});

test("work-session runtime close adapter resumes from authoritative closed state", async () => {
  const packet = finalizedReviewPacket(["work-item-1138", "work-item-1139"]);
  const completed = [];
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout is not expected");
      },
      async completeDeliveryWorkItem({ workItemId }) {
        completed.push(workItemId);
        return { work_item: { status: "done" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        return workItemEvidence(
          workItemId,
          workItemId === "work-item-1138" ? "done" : "ready",
        );
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness({ openDescendantCount: 0, readyForCloseout: true });
      },
    },
    store: { readArtifact: () => packet },
  });

  const result = await adapter.close({
    session: {
      artifacts: { review_packet_file: "artifacts/review-packet.json" },
    },
    workItemId: "work-item-1138",
  });

  assert.equal(result.complete, true);
  assert.deepEqual(completed, ["work-item-1139"]);
  assert.equal(result.closeout.skipped_work_items[0].reason, "already_closed");
  assert.equal(result.next_action.code, "initiative-closeout-required");
});

test("work-session runtime reports every ancestor without closing ancestors outside the Landing Unit", async () => {
  const packet = finalizedReviewPacket();
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("ancestor closeout is not part of Landing Unit closeout");
      },
      async completeDeliveryWorkItem() {
        return { work_item: { status: "done" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        if (workItemId === "work-item-900") {
          return workItemEvidence(workItemId, "in-progress");
        }
        const evidence = workItemEvidence(workItemId);
        const ancestors = [
          { id: 892, status: "in-progress", subject: "Initiative", type: "Epic" },
          { id: 900, status: "in-progress", subject: "Objective", type: "PI Objective" },
        ];
        evidence.continuation_context.parent_chain = ancestors;
        evidence.evidence_packet.parent_chain = ancestors;
        return evidence;
      },
      async getDeliveryCloseoutReadiness() {
        return initiativeReadiness({ openDescendantCount: 0, readyForCloseout: true });
      },
    },
    store: { readArtifact: () => packet },
  });

  const result = await adapter.close({
    session: { artifacts: { review_packet_file: "artifacts/review-packet.json" } },
    workItemId: "work-item-1138",
  });

  assert.deepEqual(
    result.closeout.ancestor_dispositions.map((entry) => [
      entry.work_item_id,
      entry.disposition,
    ]),
    [
      ["work-item-892", "initiative-readiness-evaluated-separately"],
      ["work-item-900", "ready-for-closeout"],
    ],
  );
  assert.equal(result.next_action.code, "initiative-closeout-required");
});

test("work-session runtime retains the session when a covered parent remains open", async () => {
  const packet = finalizedReviewPacket(["work-item-1138", "work-item-1140"]);
  let parentReads = 0;
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async closeStaleOpenDeliveryWorkItem() {
        throw new Error("parent closeout must wait for authoritative child readback");
      },
      async completeDeliveryWorkItem() {
        return { work_item: { status: "done" } };
      },
      async getDeliveryWorkItemEvidencePacket({ workItemId }) {
        if (workItemId === "work-item-1138") {
          const evidence = workItemEvidence(workItemId);
          const parent = {
            id: 1140,
            status: "in-progress",
            subject: "Parent feature",
            type: "Feature",
          };
          evidence.continuation_context.parent_chain = [parent];
          evidence.evidence_packet.parent_chain = [parent];
          return evidence;
        }
        parentReads += 1;
        const evidence = workItemEvidence(workItemId, "in-progress");
        if (parentReads > 1) {
          evidence.continuation_context.summary.open_child_count = 1;
          evidence.evidence_packet.continuation_summary.open_child_count = 1;
        }
        return evidence;
      },
    },
    store: { readArtifact: () => packet },
  });

  const result = await adapter.close({
    session: { artifacts: { review_packet_file: "artifacts/review-packet.json" } },
    workItemId: "work-item-1138",
  });

  assert.equal(result.complete, false);
  assert.equal(result.closeout.state, "partial_failure");
  assert.equal(result.closeout.failed[0].parent_id, "work-item-1140");
  assert.equal(result.closeout.parent_closeouts[0].reason, "open_children_remain");
});

test("work-session runtime fails closed before source work when its executor is absent", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "oos-work-session-runtime-"));
  const service = createDeliveryArtWorkSessionRuntime({
    artifactService: {},
    config: {
      deliveryArt: {
        workSession: {
          executorId: "delivery-source-executor",
          executorSecret: SECRET,
          executorSocketPath: path.join(stateRoot, "missing-executor.sock"),
        },
      },
    },
    deliveryService: {},
    env: { OOS_DELIVERY_WORK_SESSION_STATE_ROOT: stateRoot },
  });

  await assert.rejects(
    service.read({
      callerId: "governance-operations-console",
      operatorId: "operator:test",
      workItemId: "1027",
    }),
    {
      code: "delivery_art_work_session_executor_unavailable",
      statusCode: 503,
    },
  );
});
