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

test("getDeliveryCloseoutReadiness returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryCloseoutReadiness({ recordId }) {
      calls.push({ recordId });
      return {
        closeoutReadiness: {
          epic: {
            id: 38,
            status: "in-progress",
            subject: "Productize governed local-agent platform",
          },
          ready_for_closeout: false,
          reasons: ["open_descendants_present"],
          summary: {
            open_descendant_count: 2,
          },
        },
        deliveryRecordId: 38,
        deliveryRecordRef: "openproject://work_packages/38",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryCloseoutReadiness({
    callerId: "codex-local",
    correlationId: "corr-closeout-1",
    deliveryId: "delivery-38",
  });

  assert.deepEqual(calls, [{ recordId: 38 }]);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.workflow_id, "delivery-closeout-readiness");
  assert.equal(result.closeout_readiness.ready_for_closeout, false);
  assert.equal(audit.events[0]?.event_type, "delivery.closeout_readiness.read");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("recordDeliverySystemDemo returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async recordDeliverySystemDemo(input) {
      calls.push(input);
      return {
        epic: {
          id: 38,
          recordRef: "openproject://work_packages/38",
          subject: "Productize governed local-agent platform",
        },
        fieldLength: 144,
        recordedEntry: {
          date: "2026-04-23",
          evidence: "Stage rehearsal captured in devint.",
          followUp: "Carry the same proof path into stage.",
          outcome: "pass",
          summary: "Broker route preserved the PM2 evidence field entry.",
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.recordDeliverySystemDemo({
    callerId: "codex-local",
    correlationId: "corr-system-demo-1",
    deliveryId: "delivery-38",
    demoDate: "2026-04-23",
    demoEvidence: "Stage rehearsal captured in devint.",
    demoFollowUp: "Carry the same proof path into stage.",
    demoOutcome: "pass",
    demoSummary: "Broker route preserved the PM2 evidence field entry.",
  });

  assert.equal(calls[0].recordId, 38);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.workflow_id, "delivery-system-demo");
  assert.equal(result.recorded_entry.outcome, "pass");
  assert.equal(audit.events[0]?.event_type, "delivery.system_demo.recorded");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("recordDeliveryInspectAndAdapt returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async recordDeliveryInspectAndAdapt(input) {
      calls.push(input);
      return {
        epic: {
          id: 38,
          recordRef: "openproject://work_packages/38",
          subject: "Productize governed local-agent platform",
        },
        fieldLength: 128,
        recordedEntry: {
          actionItems: "- Add the parent-closeout guard to the broker.\n- Flag done parents with open descendants in ART quality checks.",
          date: "2026-04-23",
          followUp: "Land the guard before any more parent closeout.",
          summary: "The ART guardrail gap was treated as a workflow control defect.",
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.recordDeliveryInspectAndAdapt({
    actionItems:
      "- Add the parent-closeout guard to the broker.\n- Flag done parents with open descendants in ART quality checks.",
    callerId: "codex-local",
    correlationId: "corr-ia-1",
    deliveryId: "delivery-38",
    inspectDate: "2026-04-23",
    inspectFollowUp: "Land the guard before any more parent closeout.",
    inspectSummary: "The ART guardrail gap was treated as a workflow control defect.",
  });

  assert.equal(calls[0].recordId, 38);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.workflow_id, "delivery-inspect-and-adapt");
  assert.equal(audit.events[0]?.event_type, "delivery.inspect_and_adapt.recorded");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("recordDeliveryPiReview returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async recordDeliveryPiReview(input) {
      calls.push(input);
      return {
        epic: {
          id: 38,
          recordRef: "openproject://work_packages/38",
          subject: "Productize governed local-agent platform",
        },
        summary: {
          actual_business_value_total: 10,
          reviewed_count: 1,
        },
        updated: [
          {
            actual_business_value: 10,
            id: 186,
            review_outcome: "Met",
          },
        ],
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.recordDeliveryPiReview({
    callerId: "codex-local",
    correlationId: "corr-pi-review-1",
    deliveryId: "delivery-38",
    piReviewDate: "2026-04-23",
    reviews: [
      {
        actualBusinessValue: 10,
        reviewOutcome: "Met",
        targetWorkPackageId: 186,
      },
    ],
    targetPi: "PI-2026-02",
  });

  assert.equal(calls[0].recordId, 38);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.workflow_id, "delivery-pi-review");
  assert.equal(result.summary.reviewed_count, 1);
  assert.equal(audit.events[0]?.event_type, "delivery.pi_review.recorded");
  assert.equal(audit.events[0]?.outcome, "success");
  assert.equal(audit.events[0]?.target_pi, "PI-2026-02");
});

test("completeDeliveryWorkItem returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async completeDeliveryWorkItem(input) {
      calls.push(input);
      return {
        attachmentsAdded: [],
        attachmentsReplaced: [],
        changes: {
          status: {
            from: "in-progress",
            to: "done",
          },
        },
        completionEvidenceState: {
          formattingIssues: [],
          present: true,
          sections: {
            "Changed Surfaces": true,
            "Completion Summary": true,
            "Test Result Evidence": true,
            "Validation Evidence": true,
          },
        },
        noteApplied: "description_section",
        workPackage: {
          id: 184,
          percent_complete: 100,
          recordRef: "openproject://work_packages/184",
          remaining_work: 0,
          status: "done",
          subject: "Add broker-owned completion, review, and closeout-readiness workflows",
          type: "Task",
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.completeDeliveryWorkItem({
    callerId: "codex-local",
    changedSurfaces: "- operator-orchestration-service/src/app.js",
    completionNote: "Validated completion through the broker route.",
    completionSummary:
      "Completed the broker closeout workflow family and kept completion as an evidence-backed route.",
    correlationId: "corr-complete-1",
    residualFollowUp: "- None.",
    testResultEvidence:
      "- PASS: Live broker closeout-readiness read returned the active descendant count.\n- PASS: Parent completion guard rejected an invalid closeout while descendants remained open.",
    validationEvidence:
      "- PASS: node --test test/openproject-client.test.js test/delivery-service.test.js test/http.test.js",
    workItemId: "work-item-184",
  });

  assert.equal(calls[0].recordId, 184);
  assert.equal(result.work_item_id, "work-item-184");
  assert.equal(result.workflow_id, "delivery-work-item-complete");
  assert.equal(result.work_item.status, "done");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.completed");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("updateDeliveryInitiative returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async updateDeliveryInitiative(input) {
      calls.push(input);
      return {
        changesApplied: {
          pm2_phase: {
            from: "Planning",
            to: "Executing",
          },
          system_demo_evidence: {
            from: null,
            to: "Broker governance route proved in devint.",
          },
        },
        deliveryInitiative: {
          pm2Phase: "Executing",
          recordRef: "openproject://work_packages/38",
          status: "in-progress",
          subject: "Productize governed local-agent platform",
          targetPi: "PI-2026-02",
          type: "Epic",
        },
        deliveryRecordId: 38,
        deliveryRecordRef: "openproject://work_packages/38",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.updateDeliveryInitiative({
    callerId: "codex-local",
    correlationId: "corr-delivery-initiative-1",
    recordId: "delivery-38",
    pm2Phase: "Executing",
    systemDemoEvidence: "Broker governance route proved in devint.",
  });

  assert.equal(calls[0].recordId, 38);
  assert.equal(calls[0].pm2Phase, "Executing");
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.delivery_record_ref, "openproject://work_packages/38");
  assert.equal(result.workflow_id, "delivery-initiative-governance");
  assert.equal(audit.events[0]?.event_type, "delivery.initiative.governance_updated");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("applyDeliveryPlan returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async applyDeliveryPlan(input) {
      calls.push(input);
      return {
        deliveryRecordId: 38,
        deliveryRecordRef: "openproject://work_packages/38",
        planResult: {
          created: [],
          deferred: [],
          epic: {
            changes: {
              description: {
                from_present: false,
                to_present: true,
              },
            },
            id: 38,
            record_ref: "openproject://work_packages/38",
            subject: "Productize governed local-agent platform",
            target_pi: "PI-2026-02",
            updated: true,
          },
          retired: [],
          reused: [],
          summary: {
            created_count: 0,
            deferred_count: 0,
            reused_count: 1,
            retired_count: 0,
            total_requested: 2,
            updated_count: 1,
          },
          updated: [
            {
              id: 70,
              parent_id: 61,
              record_ref: "openproject://work_packages/70",
              status: "in-progress",
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
              target_pi: "PI-2026-02",
              type: "Task",
            },
          ],
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const plan = {
    schema_version: 1,
    items: [
      {
        subject: "Enabler: Brokerize delivery initiative governance update",
        type: "Task",
      },
      {
        description: "Broker route owns the operator plan path.",
        subject: "Enabler: Brokerize delivery plan apply and reconciliation",
        type: "Task",
      },
    ],
  };
  const result = await service.applyDeliveryPlan({
    callerId: "codex-local",
    correlationId: "corr-delivery-plan-1",
    plan,
    recordId: "delivery-38",
    reconcileDecision: "retire",
    reconcileMissing: "ignore",
  });

  assert.equal(calls[0].recordId, 38);
  assert.deepEqual(calls[0].plan, plan);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.delivery_record_ref, "openproject://work_packages/38");
  assert.equal(result.workflow_id, "delivery-plan-apply");
  assert.equal(audit.events[0]?.event_type, "delivery.plan.applied");
  assert.equal(audit.events[0]?.outcome, "success");
  assert.ok(audit.events[0]?.changed_fields.includes("created:0"));
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

test("manageDeliveryBlocker returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async manageDeliveryBlocker(input) {
      calls.push(input);
      return {
        actionApplied: "set",
        blocker: {
          decision_path: "workaround",
          discovered_on: "2026-04-21",
          follow_up_owner: "mfshaf7",
          impact: "Execution proof cannot continue until the blocker workflow is broker-owned.",
          justification: "Lift the existing blocker semantics behind the broker before continuing.",
          owner: "mfshaf7",
          review_date: "2026-04-24",
          statement: "Current blocker workflow still depends on the platform-side runner.",
        },
        changesApplied: {
          status: {
            from: "in-progress",
            to: "blocked",
          },
        },
        workItem: {
          recordRef: "openproject://work_packages/64",
          status: "blocked",
          subject: "Enabler: Brokerize delivery blocker management",
          targetPi: "PI-2026-02",
          type: "Task",
        },
        workItemRecordId: 64,
        workItemRecordRef: "openproject://work_packages/64",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.manageDeliveryBlocker({
    action: "set",
    blockerDecisionPath: "workaround",
    blockerDiscoveredOn: "2026-04-21",
    blockerFollowUpOwner: "mfshaf7",
    blockerImpact: "Execution proof cannot continue until the blocker workflow is broker-owned.",
    blockerJustification: "Lift the existing blocker semantics behind the broker before continuing.",
    blockerOwner: "mfshaf7",
    blockerReviewDate: "2026-04-24",
    blockerStatement: "Current blocker workflow still depends on the platform-side runner.",
    callerId: "codex-local",
    correlationId: "corr-delivery-blocker-1",
    workItemId: "work-item-64",
  });

  assert.equal(calls[0].recordId, 64);
  assert.equal(calls[0].blockerDecisionPath, "workaround");
  assert.equal(result.work_item_id, "work-item-64");
  assert.equal(result.action_applied, "set");
  assert.equal(result.workflow_id, "delivery-work-item-blocker");
  assert.equal(result.blocker.statement, "Current blocker workflow still depends on the platform-side runner.");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.blocker_managed");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("manageDeliveryBlocker returns null for an invalid work-item id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async manageDeliveryBlocker() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.manageDeliveryBlocker({
    action: "set",
    callerId: "codex-local",
    correlationId: "corr-delivery-blocker-2",
    workItemId: "not-a-work-item-id",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("manageDeliveryParking returns a broker projection with work-item id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async manageDeliveryParking(input) {
      calls.push(input);
      return {
        actionApplied: "park",
        changesApplied: {
          status: {
            from: "new",
            to: "parked",
          },
          work_note: {
            applied: true,
          },
        },
        noteApplied: "description_section",
        parking: {
          decision: "defer",
          reason: "Hold this task outside active scope until the next slice starts.",
          review_date: "2026-05-01",
          retirement_reason: null,
        },
        workItem: {
          recordRef: "openproject://work_packages/66",
          status: "parked",
          subject: "Enabler: Brokerize delivery parking and resume",
          targetPi: "PI-2026-02",
          type: "Task",
        },
        workItemRecordId: 66,
        workItemRecordRef: "openproject://work_packages/66",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.manageDeliveryParking({
    action: "park",
    callerId: "codex-local",
    correlationId: "corr-delivery-parking-1",
    parkDecision: "defer",
    parkReason: "Hold this task outside active scope until the next slice starts.",
    parkReviewDate: "2026-05-01",
    workItemId: "work-item-66",
    workNote: "Parking proof is running through the broker route.",
  });

  assert.equal(calls[0].recordId, 66);
  assert.equal(calls[0].parkDecision, "defer");
  assert.equal(calls[0].workNoteAuthor, "codex-local");
  assert.equal(result.work_item_id, "work-item-66");
  assert.equal(result.action_applied, "park");
  assert.equal(result.workflow_id, "delivery-work-item-parking");
  assert.equal(result.parking.decision, "defer");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.parking_managed");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("manageDeliveryParking returns null for an invalid work-item id", async () => {
  const audit = createAudit();
  const openProjectClient = {
    async manageDeliveryParking() {
      throw new Error("should not be called");
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.manageDeliveryParking({
    action: "park",
    callerId: "codex-local",
    correlationId: "corr-delivery-parking-2",
    workItemId: "not-a-work-item-id",
  });

  assert.equal(result, null);
  assert.equal(audit.events.length, 0);
});

test("manageDeliveryDependency returns a broker projection with work-item ids", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async manageDeliveryDependency(input) {
      calls.push(input);
      return {
        actionApplied: "set",
        changesApplied: {
          description: {
            from: null,
            to: "Dependency proof through the broker route.",
          },
          lag: {
            from: null,
            to: 2,
          },
        },
        created: true,
        dependsOnWorkItemRecordId: 67,
        relation: {
          description: "Dependency proof through the broker route.",
          depends_on: {
            id: 67,
            record_ref: "openproject://work_packages/67",
            status: "ready",
            subject: "Enabler: Brokerize delivery initiative governance update",
          },
          id: 12,
          lag: 2,
          relation_type: "follows",
          target: {
            id: 70,
            record_ref: "openproject://work_packages/70",
            status: "new",
            subject: "Enabler: Brokerize delivery plan apply and reconciliation",
          },
        },
        removedDuplicateRelationIds: [],
        targetWorkItemRecordId: 70,
        updated: false,
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.manageDeliveryDependency({
    action: "set",
    callerId: "codex-local",
    correlationId: "corr-delivery-dependency-1",
    dependsOnWorkItemId: "work-item-67",
    description: "Dependency proof through the broker route.",
    lag: 2,
    targetWorkItemId: "work-item-70",
  });

  assert.equal(calls[0].recordId, 70);
  assert.equal(calls[0].dependsOnRecordId, 67);
  assert.equal(result.target_work_item_id, "work-item-70");
  assert.equal(result.depends_on_work_item_id, "work-item-67");
  assert.equal(result.workflow_id, "delivery-work-item-dependency");
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.dependency_managed");
  assert.equal(audit.events[0]?.outcome, "success");
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
