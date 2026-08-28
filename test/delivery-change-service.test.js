import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeliveryChangeService,
  DeliveryChangeServiceError,
} from "../src/delivery-change/service.js";

const timestamp = "2026-08-29T00:00:00.000Z";
const revisions = [
  `delivery-package:sha256:${"a".repeat(64)}`,
  `delivery-package:sha256:${"b".repeat(64)}`,
];
const digest = `sha256:${"c".repeat(64)}`;

function catalogRequest() {
  return {
    schema_version: 1,
    request_id: "catalog-mutation-1028",
    correlation_id: "delivery-change-command:1028-1",
    idempotency_key: "owner-repo-oos-v1",
    source_revision: "catalog-version-1",
    catalog_item_id: "owner-repo",
    mode: "add",
    target_value_id: null,
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Link the admitted repository.",
    },
    draft: {
      value_key: "operator-orchestration-service",
      label: "Operator Orchestration Service",
      description: "Shared operator workflow broker.",
      parent_catalog_value_key: null,
      planning_window_start_date: null,
      planning_window_end_date: null,
      repository_binding: {
        repo_name: "operator-orchestration-service",
        repo_ref: "repo://operator-orchestration-service",
        catalog_value_key: "operator-orchestration-service",
        receipt: {
          receipt_id: "repository-readiness-receipt:1234567890abcdef12345678",
          uri: `wgcf://receipts/repository-readiness/repository-readiness-receipt-1234567890abcdef12345678-${"c".repeat(64)}.json`,
          digest,
          issuer: "workspace-governance-control-fabric",
          target_scope: "repo:operator-orchestration-service",
          outcome: "ready",
          evaluated_at: timestamp,
          generation: 1,
        },
      },
    },
  };
}

function command(overrides = {}) {
  return {
    schema_version: 1,
    command_id: "delivery-change-command:1028-1",
    delivery_id: "delivery-886",
    expected_source_revision: revisions[0],
    operator: { id: "operator:workspace-owner" },
    acceptance: {
      decision: "apply",
      accepted_at: timestamp,
      accepted_by: "operator:workspace-owner",
      note: "Apply the reviewed change.",
    },
    operation: {
      type: "revise_work_item",
      payload: {
        work_item_id: "work-item-1028",
        changes: { subject: "Authoritative Delivery change contract" },
      },
    },
    ...overrides,
  };
}

function source(revision) {
  return {
    deliveryRecordId: 886,
    deliveryRecordRef: "openproject://work_packages/886",
    sourceRevision: revision,
    executionTree: {
      id: 886,
      record_ref: "openproject://work_packages/886",
      status: "in progress",
      subject: "Governed Console Execution",
      type: "Epic",
      children: [],
    },
    dependencyRelations: [],
  };
}

function harness({
  catalogFailure = false,
  deliveryFailure = false,
  terminalEventFailure = false,
} = {}) {
  const calls = [];
  const activities = [];
  let sourceIndex = 0;
  const service = createDeliveryChangeService({
    audit: { emit(event) { calls.push({ operation: "audit", event }); } },
    catalogService: {
      async mutate(input) {
        calls.push({ operation: "catalog", input });
        if (catalogFailure) throw new Error("catalog failed");
        return { mutation_id: "catalog-mutation-1", status: "applied" };
      },
    },
    clock: () => new Date(timestamp),
    deliveryService: {
      async createDeliveryWorkItem(input) {
        calls.push({ operation: "add", input });
        sourceIndex = 1;
        return { work_item_id: "work-item-1100", creation_applied: true };
      },
      async manageDeliveryBlocker(input) {
        calls.push({ operation: "blocker", input });
        sourceIndex = 1;
        return { work_item_id: input.workItemId, action_applied: input.action };
      },
      async manageDeliveryDependency(input) {
        calls.push({ operation: "dependency", input });
        sourceIndex = 1;
        return { target_work_item_id: input.targetWorkItemId, action_applied: input.action };
      },
      async manageDeliveryParking(input) {
        calls.push({ operation: "parking", input });
        sourceIndex = 1;
        return { work_item_id: input.workItemId, action_applied: input.action };
      },
      async moveDeliveryWorkItem(input) {
        calls.push({ operation: "move", input });
        sourceIndex = 1;
        return { work_item_id: input.workItemId, parent_work_item_id: input.newParentWorkItemId };
      },
      async updateDeliveryWorkItem(input) {
        calls.push({ operation: "revise", input });
        if (deliveryFailure) throw new Error("delivery failed");
        sourceIndex = 1;
        return { work_item_id: input.workItemId, changes_applied: { subject: true } };
      },
    },
    openProjectClient: {
      async addDeliveryChangeEvent({ raw }) {
        if (terminalEventFailure && activities.length === 1) {
          throw new Error("terminal event unavailable");
        }
        activities.push({ comment: raw, userRef: "/api/v3/users/1" });
      },
      async getDeliveryChangeAutomationUserRef() {
        return "/api/v3/users/1";
      },
      async getDeliveryChangeSource() {
        return source(revisions[sourceIndex]);
      },
      async listDeliveryChangeActivities() {
        return {
          items: activities,
          pageSize: 100,
          total: activities.length,
        };
      },
    },
  });
  return { activities, calls, service };
}

test("Delivery change applies once and replays its durable event", async () => {
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
  assert.equal(replay.replayed, true);
  assert.equal(target.calls.filter((call) => call.operation === "revise").length, 1);
  assert.equal(target.activities.length, 2);
});

test("Delivery change rejects a stale package before mutation", async () => {
  const target = harness();
  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: command({ expected_source_revision: revisions[1] }),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryChangeServiceError &&
      error.code === "delivery_change_source_revision_stale",
  );
  assert.equal(target.calls.some((call) => call.operation === "revise"), false);
});

test("Repository request routes to Repository without mutating Delivery", async () => {
  const target = harness();
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    deliveryId: "delivery-886",
    command: command({
      operation: {
        type: "request_repository",
        payload: {
          work_item_id: "work-item-1028",
          reason: "The active work now needs independent source custody.",
        },
      },
    }),
  });
  assert.equal(result.status, "routed");
  assert.equal(result.next_action.code, "open_repository_operation");
  assert.equal(target.calls.some((call) => call.operation === "revise"), false);
});

test("Catalog success followed by Delivery failure is explicit partial failure", async () => {
  const target = harness({ deliveryFailure: true });
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    deliveryId: "delivery-886",
    command: command({
      operation: {
        type: "link_repository",
        payload: {
          work_item_id: "work-item-1028",
          owner_repo: "operator-orchestration-service",
          catalog_item_id: "owner-repo",
          catalog_request: catalogRequest(),
        },
      },
    }),
  });
  assert.equal(result.status, "partial_failure");
  assert.equal(result.next_action.code, "reconcile_repository_link");
  assert.equal(target.calls.filter((call) => call.operation === "catalog").length, 1);
});

test("Rollback without a proven inverse is rejected without hidden mutation", async () => {
  const target = harness();
  const result = await target.service.applyCommand({
    callerId: "governance-operations-console",
    deliveryId: "delivery-886",
    command: command({
      operation: {
        type: "rollback_change",
        payload: {
          target_event_ref: "delivery-change-event:earlier-command",
          reason: "Operator rejected the prior effect.",
        },
      },
    }),
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.event.rollback.mode, "not_supported");
  assert.equal(target.calls.some((call) => call.operation === "revise"), false);
});

test("accepted intent prevents blind replay after terminal evidence loss", async () => {
  const target = harness({ terminalEventFailure: true });
  await assert.rejects(target.service.applyCommand({
    callerId: "governance-operations-console",
    command: command(),
    deliveryId: "delivery-886",
  }));
  await assert.rejects(
    target.service.applyCommand({
      callerId: "governance-operations-console",
      command: command(),
      deliveryId: "delivery-886",
    }),
    (error) => error instanceof DeliveryChangeServiceError &&
      error.code === "delivery_change_reconciliation_required",
  );
  assert.equal(target.calls.filter((call) => call.operation === "revise").length, 1);
});

for (const [type, payload, dispatched] of [
  ["add_work_item", {
    parent_work_item_id: "work-item-1028",
    type: "Task",
    subject: "Add proof task",
  }, "add"],
  ["move_work_item", {
    work_item_id: "work-item-1028",
    new_parent_work_item_id: "work-item-911",
  }, "move"],
  ["remove_work_item", {
    work_item_id: "work-item-1028",
    retirement_reason: "The work is no longer required.",
  }, "parking"],
  ["manage_dependency", {
    action: "set",
    target_work_item_id: "work-item-1028",
    depends_on_work_item_id: "work-item-1027",
  }, "dependency"],
  ["manage_blocker", {
    action: "set",
    work_item_id: "work-item-1028",
  }, "blocker"],
  ["manage_parking", {
    action: "park",
    work_item_id: "work-item-1028",
    park_decision: "defer",
    park_reason: "Wait for an external decision.",
  }, "parking"],
]) {
  test(`${type} composes the existing Delivery authority`, async () => {
    const target = harness();
    const result = await target.service.applyCommand({
      callerId: "governance-operations-console",
      deliveryId: "delivery-886",
      command: command({ operation: { type, payload } }),
    });
    assert.equal(result.status, "applied");
    assert.equal(target.calls.filter((call) => call.operation === dispatched).length, 1);
  });
}
