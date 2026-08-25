import assert from "node:assert/strict";
import test from "node:test";

import {
  REFINEMENT_ACTIVITY_TASK_QUEUE,
  REFINEMENT_WORKFLOW_TASK_QUEUE,
} from "../src/refinement/runtime-constants.js";
import {
  refinementWorkerStatus,
  runRefinementWorker,
} from "../src/refinement/worker.js";

function config(refinement = {}) {
  return {
    refinement: {
      executionAuthorized: false,
      workerEnabled: false,
      ...refinement,
    },
    orchestration: {
      temporal: {
        address: "temporal.test:7233",
        identity: "oos-refinement-worker",
        namespace: "default",
      },
    },
  };
}

test("Refinement worker is denied until both activation gates are explicit", async () => {
  assert.equal(refinementWorkerStatus(config()).run_allowed, false);
  let connected = false;
  await assert.rejects(
    runRefinementWorker(config(), {}, {
      async connect() { connected = true; },
    }),
    /activation is not authorized/,
  );
  assert.equal(connected, false);
});

test("Refinement worker creates fixed workflow and activity queues", async () => {
  const queues = [];
  let closeCount = 0;
  let runCount = 0;
  let shutdownCount = 0;
  await runRefinementWorker(
    config({ executionAuthorized: true, workerEnabled: true }),
    { applyRefinementOperation() {} },
    {
      async connect() {
        return { async close() { closeCount += 1; } };
      },
      async createWorker(options) {
        queues.push(options.taskQueue);
        return {
          async run() { runCount += 1; },
          async shutdown() { shutdownCount += 1; },
        };
      },
    },
  );
  assert.deepEqual(queues, [
    REFINEMENT_WORKFLOW_TASK_QUEUE,
    REFINEMENT_ACTIVITY_TASK_QUEUE,
  ]);
  assert.equal(runCount, 2);
  assert.equal(shutdownCount, 2);
  assert.equal(closeCount, 1);
});

test("Refinement worker cleans up when companion construction fails", async () => {
  let closeCount = 0;
  let shutdownCount = 0;
  let createCount = 0;
  await assert.rejects(
    runRefinementWorker(
      config({ executionAuthorized: true, workerEnabled: true }),
      {},
      {
        async connect() {
          return { async close() { closeCount += 1; } };
        },
        async createWorker() {
          createCount += 1;
          if (createCount === 2) throw new Error("activity worker failed");
          return {
            async run() { throw new Error("must not run"); },
            async shutdown() { shutdownCount += 1; },
          };
        },
      },
    ),
    /activity worker failed/,
  );
  assert.equal(shutdownCount, 1);
  assert.equal(closeCount, 1);
});
