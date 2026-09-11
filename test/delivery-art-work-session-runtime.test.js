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

function finalizedReviewPacket() {
  return {
    packet_id: "review-packet:delivery-892-work-item-1138",
    covered_work_item_ids: ["work-item-1138"],
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
    },
    status: "finalized",
  };
}

test("work-session runtime stays disabled without an admitted source executor", () => {
  assert.equal(createDeliveryArtWorkSessionRuntime({ config: {} }), null);
});

test("work-session runtime reads Security status from the Delivery evidence envelope", () => {
  assert.equal(
    deliveryWorkItemStatus({
      evidence_packet: { target_item: { status: "done" } },
    }),
    "done",
  );
  assert.equal(
    deliveryWorkItemStatus({ target_item: { status: "in-progress" } }),
    "in-progress",
  );
});

test("work-session runtime close adapter completes ART from the finalized Review Packet", async () => {
  const packet = finalizedReviewPacket();
  const calls = [];
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async completeDeliveryWorkItem(input) {
        calls.push(input);
        return { work_item: { status: "done" } };
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callerId, "operator-orchestration-service");
  assert.equal(calls[0].workItemId, "work-item-1138");
  assert.equal(
    calls[0].completionSummary,
    "The runtime close adapter is composed and validated.",
  );
  assert.match(calls[0].changedSurfaces, /work-session-runtime\.js/);
});

test("work-session runtime close adapter propagates ART completion failure", async () => {
  const failure = new Error("simulated ART completion failure");
  const adapter = createDeliveryArtWorkSessionCloseAdapter({
    deliveryService: {
      async completeDeliveryWorkItem() {
        throw failure;
      },
    },
    store: { readArtifact: () => finalizedReviewPacket() },
  });

  await assert.rejects(
    () => adapter.close({
      session: {
        artifacts: { review_packet_file: "artifacts/review-packet.json" },
      },
      workItemId: "work-item-1138",
    }),
    failure,
  );
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
