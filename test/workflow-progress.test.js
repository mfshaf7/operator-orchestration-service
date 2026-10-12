import assert from "node:assert/strict";
import test from "node:test";

import { persistWorkflowFailure } from "../src/workflow-progress.js";

test("durable workflow failures advance the source projection sequence", async () => {
  const record = {
    status: "review-required",
    failure: null,
    history: [
      { sequence: 1, at: "2026-10-12T19:00:00.000Z", status: "review-required", details: null },
    ],
  };
  let held = false;
  let persisted = null;
  const transaction = {
    assertHeld() { held = true; },
    async put(value) { persisted = structuredClone(value); },
  };
  const failure = {
    code: "workspace_inventory_provider_rejected",
    retryable: false,
    message: "bounded failure",
  };

  await persistWorkflowFailure({
    transaction,
    record,
    failure,
    clock: () => new Date("2026-10-12T19:01:00.000Z"),
  });

  assert.equal(held, true);
  assert.deepEqual(record.failure, failure);
  assert.deepEqual(record.history.at(-1), {
    sequence: 2,
    at: "2026-10-12T19:01:00.000Z",
    status: "review-required",
    details: {
      failure_code: "workspace_inventory_provider_rejected",
      retryable: false,
    },
  });
  assert.deepEqual(persisted, record);
});
