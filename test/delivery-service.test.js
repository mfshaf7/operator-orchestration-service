import test from "node:test";
import assert from "node:assert/strict";

import { OpenProjectError } from "../src/errors.js";
import { createDeliveryService } from "../src/delivery-service.js";

function createAudit() {
  return {
    events: [],
    emit(event) {
      this.events.push(event);
    },
  };
}

test("getDeliveryExecutionSummary returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryExecutionSummary({ recordId, includeDone, includeParked }) {
      calls.push({ includeDone, includeParked, recordId });
      return {
        deliveryRecordId: 38,
        deliveryRecordRef: "openproject://work_packages/38",
        executionSummary: {
          epic: {
            id: 38,
            status: "in-progress",
            subject: "Productize governed local-agent platform",
          },
          summary: {
            blocked_count: 0,
            total_items: 3,
          },
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryExecutionSummary({
    callerId: "codex-local",
    correlationId: "corr-delivery-1",
    deliveryId: "delivery-38",
    includeDone: false,
    includeParked: true,
  });

  assert.deepEqual(calls, [
    {
      includeDone: false,
      includeParked: true,
      recordId: 38,
    },
  ]);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.delivery_record_ref, "openproject://work_packages/38");
  assert.equal(result.workflow_id, "delivery-execution-summary");
  assert.equal(audit.events[0]?.event_type, "delivery.execution_summary.read");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("getDeliveryExecutionSummary returns null for an invalid delivery id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getDeliveryExecutionSummary() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryExecutionSummary({
    callerId: "codex-local",
    correlationId: "corr-delivery-2",
    deliveryId: "not-a-delivery-id",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("getDeliveryExecutionSummary returns null when the backend reports not found", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async getDeliveryExecutionSummary() {
      throw new OpenProjectError(
        "not_found",
        "missing",
        404,
        "delivery_not_found",
      );
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryExecutionSummary({
    callerId: "codex-local",
    correlationId: "corr-delivery-3",
    deliveryId: "38",
  });

  assert.equal(result, null);
});

test("updateDeliveryWorkItem returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async updateDeliveryWorkItem(input) {
      calls.push(input);
      return {
        changesApplied: {
          assignee_login: {
            from: null,
            to: "admin",
          },
          status: {
            from: "ready",
            to: "in-progress",
          },
        },
        workItem: {
          assigneeLogin: "admin",
          recordRef: "openproject://work_packages/56",
          status: "in-progress",
          subject: "Add bounded delivery work-item update mapping",
          targetPi: "PI-2026-02",
          type: "Task",
          updatedAt: "2026-04-21T02:00:00Z",
        },
        workItemRecordId: 56,
        workItemRecordRef: "openproject://work_packages/56",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.updateDeliveryWorkItem({
    assigneeLogin: "admin",
    callerId: "codex-local",
    correlationId: "corr-delivery-update-1",
    status: "in-progress",
    targetPi: "PI-2026-02",
    workItemId: "work-item-56",
    workNote: "Started implementation.",
  });

  assert.equal(calls[0].recordId, 56);
  assert.equal(calls[0].status, "in-progress");
  assert.equal(calls[0].workNoteAuthor, "codex-local");
  assert.equal(result.work_item_id, "work-item-56");
  assert.equal(result.work_item_record_ref, "openproject://work_packages/56");
  assert.equal(result.workflow_id, "delivery-work-item-update");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.updated");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("updateDeliveryWorkItem returns null for an invalid work-item id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async updateDeliveryWorkItem() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.updateDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-update-2",
    workItemId: "not-a-work-item-id",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("updateDeliveryWorkItem returns null when the backend reports not found", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async updateDeliveryWorkItem() {
      throw new OpenProjectError(
        "not_found",
        "missing",
        404,
        "work_item_not_found",
      );
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.updateDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-update-3",
    workItemId: "56",
  });

  assert.equal(result, null);
});

test("createDeliveryWorkItem returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async createDeliveryWorkItem(input) {
      calls.push(input);
      return {
        creationApplied: {
          status: "ready",
          subject: "Brokerize delivery work-item move",
          target_pi: "PI-2026-02",
          type: "Task",
        },
        parentWorkItemRecordId: 61,
        workItem: {
          parentId: 61,
          recordRef: "openproject://work_packages/69",
          status: "ready",
          subject: "Brokerize delivery work-item move",
          targetPi: "PI-2026-02",
          type: "Task",
        },
        workItemRecordId: 69,
        workItemRecordRef: "openproject://work_packages/69",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.createDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-create-1",
    parentWorkItemId: "work-item-61",
    status: "ready",
    subject: "Brokerize delivery work-item move",
    targetPi: "PI-2026-02",
    type: "Task",
  });

  assert.equal(calls[0].parentRecordId, 61);
  assert.equal(calls[0].type, "Task");
  assert.equal(result.work_item_id, "work-item-69");
  assert.equal(result.parent_work_item_id, "work-item-61");
  assert.equal(result.workflow_id, "delivery-work-item-create");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.created");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("moveDeliveryWorkItem returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async moveDeliveryWorkItem(input) {
      calls.push(input);
      return {
        changesApplied: {
          parent: {
            from: 61,
            to: 75,
          },
          work_note: {
            applied: true,
          },
        },
        noteApplied: "description_section",
        previousParentWorkItemRecordId: 61,
        workItem: {
          parentId: 75,
          recordRef: "openproject://work_packages/63",
          status: "ready",
          subject: "Enabler: Brokerize delivery work-item move",
          targetPi: "PI-2026-02",
          type: "Task",
        },
        workItemRecordId: 63,
        workItemRecordRef: "openproject://work_packages/63",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.moveDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-move-1",
    newParentWorkItemId: "work-item-75",
    workItemId: "work-item-63",
    workNote: "Move route is now broker-owned.",
  });

  assert.equal(calls[0].recordId, 63);
  assert.equal(calls[0].newParentRecordId, 75);
  assert.equal(calls[0].workNoteAuthor, "codex-local");
  assert.equal(result.work_item_id, "work-item-63");
  assert.equal(result.parent_work_item_id, "work-item-75");
  assert.equal(result.previous_parent_work_item_id, "work-item-61");
  assert.equal(result.workflow_id, "delivery-work-item-move");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.moved");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("moveDeliveryWorkItem returns null for an invalid work-item id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async moveDeliveryWorkItem() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.moveDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-move-2",
    newParentWorkItemId: "work-item-75",
    workItemId: "not-a-work-item-id",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("moveDeliveryWorkItem returns null when the backend reports not found", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async moveDeliveryWorkItem() {
      throw new OpenProjectError(
        "not_found",
        "missing",
        404,
        "work_item_not_found",
      );
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.moveDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-move-3",
    newParentWorkItemId: "75",
    workItemId: "63",
  });

  assert.equal(result, null);
});

test("createDeliveryWorkItem returns null for an invalid parent work-item id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async createDeliveryWorkItem() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.createDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-create-2",
    parentWorkItemId: "not-a-work-item-id",
    subject: "Brokerize delivery work-item move",
    type: "Task",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("createDeliveryWorkItem returns null when the backend reports not found", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async createDeliveryWorkItem() {
      throw new OpenProjectError(
        "not_found",
        "missing",
        404,
        "parent_work_item_not_found",
      );
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.createDeliveryWorkItem({
    callerId: "codex-local",
    correlationId: "corr-delivery-create-3",
    parentWorkItemId: "61",
    subject: "Brokerize delivery work-item move",
    type: "Task",
  });

  assert.equal(result, null);
});
