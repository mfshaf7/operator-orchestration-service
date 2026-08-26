import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDeliveryArtWorkSessionRuntime,
  deliveryWorkItemStatus,
} from
  "../src/delivery-art/work-session-runtime.js";

const SECRET = "source-executor-runtime-test-secret-material-1234567890";

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
