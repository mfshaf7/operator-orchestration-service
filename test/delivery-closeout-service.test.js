import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeliveryCloseoutService,
  DeliveryCloseoutServiceError,
} from "../src/delivery-closeout/service.js";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { encodeDeliveryCloseoutEvent } from "../src/delivery-closeout/event-codec.js";

const timestamp = "2026-08-29T00:00:00.000Z";
const revisions = [
  `delivery-package:sha256:${"a".repeat(64)}`,
  `delivery-package:sha256:${"b".repeat(64)}`,
];

function command(overrides = {}) {
  return {
    schema_version: 1,
    command_id: "delivery-closeout-command:1030-1",
    delivery_id: "delivery-886",
    expected_source_revision: revisions[0],
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed Delivery closeout.",
    },
    operation: {
      type: "apply_closeout",
      payload: {
        evidence: {
          changed_surfaces: "- Delivery closeout API.",
          completion_summary: "Delivery work is complete.",
          demo_evidence: "System demo receipt.",
          demo_outcome: "reviewed",
          demo_summary: "The completed behavior was demonstrated.",
          evidence_refs: ["review-packet://delivery-886/final"],
          inspect_action_items: "- Retain outcome history.",
          inspect_summary: "Closeout evidence was inspected.",
          test_result_evidence: "- PASS: npm test",
          validation_evidence: "- PASS: composed closeout proof",
        },
        impact: { kind: "none" },
      },
    },
    ...overrides,
  };
}

function source(revision, status) {
  return {
    deliveryRecordId: 886,
    deliveryRecordRef: "openproject://work_packages/886",
    sourceRevision: revision,
    executionTree: {
      id: 886,
      record_ref: "openproject://work_packages/886",
      status,
      subject: "Governed Console Execution",
      type: "Epic",
      children: [],
    },
    dependencyRelations: [],
  };
}

function readiness(ready, status) {
  return {
    closeout_readiness: {
      blocked_items: [],
      closing_reasons: ready ? [] : ["open_descendants_present"],
      completed_with_weak_evidence: [],
      completed_with_weak_done_narrative: [],
      completed_without_evidence: [],
      completed_without_owner: [],
      epic: {
        id: 886,
        record_ref: "openproject://work_packages/886",
        status,
        subject: "Governed Console Execution",
      },
      open_descendants: ready ? [] : [{ record_ref: "openproject://work_packages/1031" }],
      ready_for_closing: ready,
      ready_for_closeout: ready,
      reasons: ready ? [] : ["open_descendants_present"],
      summary: {
        blocked_count: 0,
        completed_with_weak_evidence_count: 0,
        completed_with_weak_done_narrative_count: 0,
        completed_without_evidence_count: 0,
        completed_without_owner_count: 0,
        open_descendant_count: ready ? 0 : 1,
      },
    },
    delivery_id: "delivery-886",
    delivery_record_ref: "openproject://work_packages/886",
    delivery_record_system: "openproject",
    workflow_id: "delivery-closeout-readiness",
  };
}

function harness({ beforeClose = null, closeFailure = false, ready = true, sourceCloseoutPending = false, terminalEventFailure = false } = {}) {
  const calls = [];
  const activities = [];
  let sourceIndex = 0;
  const deliveryService = {
    async closeDeliveryInitiative(input) {
      calls.push({ operation: "close", input });
      await beforeClose?.();
      if (closeFailure) throw new Error("close failed");
      sourceIndex = 1;
      return {
        action_applied: "close_initiative",
        delivery_id: "delivery-886",
        delivery_initiative: { id: 886, status: "done" },
        delivery_record_ref: "openproject://work_packages/886",
        source_closeout_receipt: sourceCloseoutPending
          ? { status: "source_closeout_pending" }
          : { status: "not_applicable" },
        source_closeout_status: sourceCloseoutPending
          ? "source_closeout_pending"
          : "not_applicable",
        steps_applied: { initiative_completed: true },
      };
    },
    async getDeliveryCloseoutReadiness(input) {
      calls.push({ operation: "readiness", input });
      return readiness(sourceIndex === 1 || ready, sourceIndex === 1 ? "done" : "in-progress");
    },
  };
  const service = createDeliveryCloseoutService({
    audit: { emit(event) { calls.push({ operation: "audit", event }); } },
    clock: () => new Date(timestamp),
    deliveryService,
    openProjectClient: {
      async addDeliveryCloseoutEvent({ raw }) {
        if (terminalEventFailure && activities.length === 1) {
          throw new Error("terminal event unavailable");
        }
        activities.push({ comment: raw, userRef: "/api/v3/users/1" });
      },
      async getDeliveryChangeSource() {
        return source(
          revisions[sourceIndex],
          sourceIndex === 1 ? "done" : "in-progress",
        );
      },
      async getDeliveryCloseoutAutomationUserRef() {
        return "/api/v3/users/1";
      },
      async listDeliveryCloseoutActivities() {
        return { items: activities, pageSize: 100, total: activities.length };
      },
    },
  });
  return { activities, calls, service };
}

test("Delivery closeout projects normalized readiness and exact next action", async () => {
  const target = harness();
  const projection = await target.service.getProjection({
    callerId: "governance-operations-console",
    correlationId: "read-1030",
    deliveryId: "delivery-886",
  });
  assert.equal(projection.projection_state, "ready");
  assert.equal(projection.readiness.ready_for_closeout, true);
  assert.equal(projection.next_action.code, "prepare_delivery_closeout");
  assert.match(projection.readiness.readiness_ref, /#closeout-readiness@/);
});

test("Delivery closeout applies once and replays its durable result", async () => {
  const target = harness();
  const first = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  const replay = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  assert.equal(first.status, "applied");
  assert.equal(first.after.source_revision, revisions[1]);
  assert.equal(first.next_action.code, "inspect_delivery_outcome_history");
  assert.equal(replay.replayed, true);
  assert.equal(target.calls.filter((call) => call.operation === "close").length, 1);
  assert.equal(target.activities.length, 2);
});

test("Delivery closeout replay ignores a newly issued acceptance timestamp", async () => {
  const target = harness();
  const first = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  const replay = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command({
      acceptance: {
        ...command().acceptance,
        accepted_at: "2026-08-29T00:05:00.000Z",
      },
    }),
    deliveryId: "delivery-886",
  });

  assert.equal(first.status, "applied");
  assert.equal(replay.replayed, true);
  assert.equal(target.calls.filter((call) => call.operation === "close").length, 1);
});

test("Delivery closeout replay rejects a changed semantic payload", async () => {
  const target = harness();
  await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });

  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: command({
        acceptance: {
          ...command().acceptance,
          accepted_at: "2026-08-29T00:05:00.000Z",
          note: "Apply a different closeout decision.",
        },
      }),
      deliveryId: "delivery-886",
    }),
    (error) =>
      error instanceof DeliveryCloseoutServiceError &&
      error.code === "delivery_closeout_command_id_conflict",
  );
});

test("Delivery closeout sends a pre-semantic event to reconciliation", async () => {
  const target = harness();
  const firstCommand = command();
  const first = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: firstCommand,
    deliveryId: "delivery-886",
  });
  const legacyEvent = structuredClone(first.event);
  legacyEvent.command_digest = canonicalDigest(firstCommand);
  delete legacyEvent.effect.command_identity_version;
  target.activities.splice(0, target.activities.length, {
    comment: encodeDeliveryCloseoutEvent(legacyEvent),
    userRef: "/api/v3/users/1",
  });

  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: firstCommand,
      deliveryId: "delivery-886",
    }),
    (error) =>
      error instanceof DeliveryCloseoutServiceError &&
      error.code === "delivery_closeout_reconciliation_required" &&
      error.nextAction.code === "reconcile_delivery_closeout",
  );
});

test("Delivery closeout serializes concurrent commands around durable truth", async () => {
  let releaseClose;
  let reportCloseStarted;
  const closeStarted = new Promise((resolve) => {
    reportCloseStarted = resolve;
  });
  const closeBarrier = new Promise((resolve) => {
    releaseClose = resolve;
  });
  const target = harness({
    beforeClose: async () => {
      reportCloseStarted();
      await closeBarrier;
    },
  });

  const firstPromise = target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  await closeStarted;
  const replayPromise = target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  releaseClose();

  const [first, replay] = await Promise.all([firstPromise, replayPromise]);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(
    target.calls.filter(({ operation }) => operation === "close").length,
    1,
  );
});

test("Delivery closeout rejects stale and not-ready commands before acceptance", async () => {
  const stale = harness();
  await assert.rejects(
    stale.service.applyCommand({
      callerId: "governance-operations-console",
      command: command({ expected_source_revision: revisions[1] }),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryCloseoutServiceError &&
      error.code === "delivery_closeout_source_revision_stale",
  );
  assert.equal(stale.activities.length, 0);

  const blocked = harness({ ready: false });
  await assert.rejects(
    blocked.service.applyCommand({
      callerId: "governance-operations-console",
      command: command(),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryCloseoutServiceError &&
      error.code === "delivery_closeout_not_ready",
  );
  assert.equal(blocked.activities.length, 0);
});

test("Delivery closeout preserves source-closeout partial failure", async () => {
  const target = harness({ sourceCloseoutPending: true });
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  assert.equal(result.status, "partial_failure");
  assert.equal(result.next_action.code, "reconcile_source_closeout");
  assert.equal(result.event.effect.closeout.delivery_initiative.status, "done");
});

test("Delivery closeout records a bounded rejection after accepted dependency failure", async () => {
  const target = harness({ closeFailure: true });
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.next_action.code, "reconcile_delivery_closeout");
  assert.equal(target.activities.length, 2);
});

test("Delivery closeout fails closed when terminal evidence cannot be written", async () => {
  const target = harness({ terminalEventFailure: true });
  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: command(),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryCloseoutServiceError && error.retryable,
  );
  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: command(),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryCloseoutServiceError &&
      error.code === "delivery_closeout_reconciliation_required",
  );
  assert.equal(target.calls.filter((call) => call.operation === "close").length, 1);
});

test("Delivery closeout routes typed impact without claiming downstream mutation", async () => {
  const target = harness();
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command({
      operation: {
        type: "apply_closeout",
        payload: {
          ...command().operation.payload,
          impact: {
            kind: "existing_product_change",
            active_product: {
              product_id: "governance-console",
              registry_ref: "workspace-governance://products/governance-console",
              registry_version: "products-v4",
            },
            change_summary: "Delivery updated the active product.",
            product_owner_ref: "repo://governance-operations-console",
          },
        },
      },
    }),
    deliveryId: "delivery-886",
  });
  assert.equal(result.status, "applied");
  assert.equal(result.next_action.code, "handoff_product_outcome");
  assert.equal(result.event.impact.kind, "existing_product_change");
});
