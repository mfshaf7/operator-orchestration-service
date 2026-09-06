import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  assertInventory,
  createInventoryLifecycleEvaluation,
  inventoryDigest,
} from "../src/workspace-inventory/contracts.js";
import { createWorkspaceInventoryLifecycleService } from "../src/workspace-inventory/lifecycle-service.js";
import { createWorkspaceInventoryStore } from "../src/workspace-inventory/store.js";
import {
  at,
  caller,
  lifecycleInputFixture,
  lifecyclePreparationFixture,
  lifecycleReadinessFixture,
} from "../test-fixtures/workspace-inventory/fixture.js";

async function harness(t, { outcome = "ready", sourceClient = {} } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    clock: () => new Date(at),
    store: createWorkspaceInventoryStore({ root }),
    readinessClient: { evaluate: async (evaluation) => lifecycleReadinessFixture(evaluation, outcome) },
    sourceClient,
  };
  return {
    service: createWorkspaceInventoryLifecycleService(options),
    reopen: () => createWorkspaceInventoryLifecycleService({ ...options, store: createWorkspaceInventoryStore({ root }) }),
  };
}

test("lifecycle contracts are deterministic and caller-bound", () => {
  const { input } = lifecycleInputFixture();
  const evaluation = createInventoryLifecycleEvaluation(input, caller);
  assert.equal(assertInventory("lifecycle-request", input.request), input.request);
  assert.equal(assertInventory("lifecycle-evaluation", evaluation), evaluation);
  assert.throws(() => createInventoryLifecycleEvaluation(input, "operator:other"), /authenticated operator/);
});

test("lifecycle preparation returns exact active record and history bindings", async (t) => {
  const { input, currentRecord } = lifecycleInputFixture();
  const state = {
    authority_revision: input.authority_revision,
    target: input.request.target,
    ...input.request.expected_state,
    record: currentRecord,
    latest_event_ref: null,
  };
  const h = await harness(t, { sourceClient: { lifecycleState: async () => state } });
  const result = await h.service.prepare({ callerId: caller, input: { target: { kind: "component", name: "inventory-proof" } } });
  assert.deepEqual(result.expected_state, input.request.expected_state);
  assert.deepEqual(result.current_record, currentRecord);
  assert.equal(result.canonical_authority.history_path, "contracts/workspace-inventory-history.yaml");
  assert.equal(result.canonical_mutation, false);
});

test("blocked readiness is terminal and never prepares source", async (t) => {
  const { input } = lifecycleInputFixture();
  const h = await harness(t, {
    outcome: "blocked",
    sourceClient: { prepareLifecycle() { throw new Error("must not run"); } },
  });
  await h.service.submit({ callerId: caller, input });
  const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "blocked");
  assert.equal(result.canonical_mutation, false);
  assert.equal(result.next_action, "submit-corrected-request");
});

test("authority drift projects stale instead of a generic dependency failure", async (t) => {
  const { input } = lifecycleInputFixture();
  const error = new Error("authority changed");
  error.code = "workspace_inventory_authority_stale";
  error.statusCode = 409;
  const h = await harness(t, { sourceClient: { prepareLifecycle: async () => { throw error; } } });
  await h.service.submit({ callerId: caller, input });
  const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "stale");
  assert.equal(result.next_action, "refresh-and-resubmit");
  assert.equal(result.failure, null);
});

test("only exact reviewed merged inventory and history become canonical success", async (t) => {
  const { input, currentRecord } = lifecycleInputFixture();
  const evaluation = createInventoryLifecycleEvaluation(input, caller);
  const readiness = lifecycleReadinessFixture(evaluation);
  const preparation = lifecyclePreparationFixture(evaluation, readiness, currentRecord);
  const review = {
    repository: "workspace-governance",
    number: 52,
    url: "https://example.test/review/52",
    state: "open",
    branch: "inventory-lifecycle/test",
    base_branch: "main",
    base_commit: input.authority_revision,
    head_commit: "2".repeat(40),
    merged: false,
    merge_commit: null,
    human_reviewed: false,
  };
  let merged = false;
  const h = await harness(t, { sourceClient: {
    prepareLifecycle: async () => preparation,
    openLifecycleReview: async () => review,
    observeLifecycle: async () => merged ? {
      review: { ...review, state: "closed", merged: true, merge_commit: "3".repeat(40), human_reviewed: true },
      mergedState: {
        authority_revision: "3".repeat(40),
        observed_at: at,
        target: input.request.target,
        action: input.request.action,
        active_inventory_digest: preparation.readback.active_inventory_digest,
        history_digest: preparation.readback.history_digest,
        record: preparation.readback.record,
        history_event_ref: preparation.readback.history_event_ref,
      },
    } : { review },
  } });
  await h.service.submit({ callerId: caller, input });
  const waiting = await h.service.advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(waiting.status, "review-required");
  assert.equal(waiting.readback.authority_state, "review-branch");
  assert.equal(waiting.canonical_mutation, false);
  merged = true;
  const result = await h.reopen().advance({ callerId: caller, requestId: input.request.request_id });
  assert.equal(result.status, "succeeded");
  assert.equal(result.canonical_mutation, true);
  assert.equal(result.merged_state.authority_revision, "3".repeat(40));
  assert.equal(inventoryDigest(result.merged_state.record), inventoryDigest(preparation.readback.record));
  assert.equal(result.receipt.outcome, "prepared");
});

test("lifecycle cancellation remains restart-safe", async (t) => {
  const { input } = lifecycleInputFixture();
  const h = await harness(t, { sourceClient: { cancelLifecycle: async () => null } });
  await h.service.submit({ callerId: caller, input });
  const result = await h.service.advance({ callerId: caller, requestId: input.request.request_id, action: "cancel" });
  assert.equal(result.status, "cancelled");
  assert.deepEqual(await h.reopen().advance({ callerId: caller, requestId: input.request.request_id }), result);
});
