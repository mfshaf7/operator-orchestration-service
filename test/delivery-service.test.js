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

test("getDeliverySessionBootstrap returns caller, runtime, assignables, active fronts, and review backlog", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async listDeliveryInitiatives({ includeDone, includeInactive }) {
      calls.push({
        includeDone,
        includeInactive,
        method: "listDeliveryInitiatives",
      });
      return {
        initiatives: [
          {
            closeout_ready: false,
            closing_ready: true,
            closeout_reasons: ["pm2_phase_not_closing"],
            closing_reasons: [],
            epic: {
              id: 304,
              owner_repo: "operator-orchestration-service",
              pm2_phase: "Executing",
              record_ref: "openproject://work_packages/304",
              status: "in-progress",
              subject: "Establish seamless broker-owned ART workflow",
              target_pi: "PI-2026-03",
              type: "Epic",
            },
            initiative_review: {
              closing_transition_ready: true,
              completion_transition_ready: false,
              retirement_transition_ready: false,
            },
            open_descendants: [
              {
                id: 308,
                owner_repo: "operator-orchestration-service",
                record_ref: "openproject://work_packages/308",
                status: "in-progress",
                subject: "Provide broker-native ART session resume and status reads",
                target_pi: "PI-2026-03",
                type: "Feature",
              },
              {
                id: 318,
                owner_repo: "operator-orchestration-service",
                record_ref: "openproject://work_packages/318",
                status: "ready",
                subject: "Add one broker-native ART session bootstrap read",
                target_pi: "PI-2026-03",
                type: "User story",
              },
            ],
            retirement_ready: false,
            retirement_reasons: ["open_descendants_present"],
            summary: {
              blocked_count: 0,
              completed_with_weak_evidence_count: 0,
              completed_with_weak_done_narrative_count: 0,
              completed_without_evidence_count: 0,
              completed_without_owner_count: 0,
              open_descendant_count: 2,
              retired_count: 0,
              unresolved_dependency_count: 0,
            },
          },
        ],
      };
    },
    async listDeliveryProjectAssignablePrincipals() {
      calls.push({ method: "listDeliveryProjectAssignablePrincipals" });
      return {
        principals: [
          {
            id: 7,
            login: "operator-orchestration-service",
            name: "Operator Orchestration Service",
            record_ref: "openproject://principals/7",
            type: "Group",
          },
          {
            id: 8,
            login: "platform-engineering",
            name: "Platform Engineering",
            record_ref: "openproject://principals/8",
            type: "Group",
          },
        ],
        project: {
          id: 4,
          identifier: "workspace-delivery-art",
          name: "Workspace Delivery ART",
          recordRef: "openproject://projects/workspace-delivery-art",
        },
      };
    },
  };

  const service = createDeliveryService({
    audit,
    openProjectClient,
    runtimeContext: {
      brokerService: {
        gitCommit: "abc123",
        name: "operator-orchestration-service",
        version: "0.1.0-test",
      },
      deliveryProjectIdentifier: "workspace-delivery-art",
      openProjectRuntime: {
        clusterDomain: "cluster.local",
        host: "devint-accepted-idea-delivery-openproject.devint-accepted-idea-delivery-mfshaf7.svc.cluster.local",
        namespace: "devint-accepted-idea-delivery-mfshaf7",
        serviceName: "devint-accepted-idea-delivery-openproject",
      },
    },
  });

  const result = await service.getDeliverySessionBootstrap({
    callerId: "accepted-idea-delivery-smoke",
    callerAuthMode: "required",
    correlationId: "corr-session-bootstrap-1",
  });

  assert.deepEqual(calls, [
    {
      includeDone: false,
      includeInactive: true,
      method: "listDeliveryInitiatives",
    },
    {
      method: "listDeliveryProjectAssignablePrincipals",
    },
  ]);
  assert.equal(result.workflow_id, "delivery-session-bootstrap");
  assert.equal(result.caller.id, "accepted-idea-delivery-smoke");
  assert.equal(result.runtime.openproject_runtime.namespace, "devint-accepted-idea-delivery-mfshaf7");
  assert.equal(result.assignables.summary.assignable_count, 2);
  assert.equal(result.active_fronts.summary.active_initiative_count, 1);
  assert.equal(result.active_fronts.summary.active_item_count, 1);
  assert.equal(result.active_fronts.summary.next_ready_count, 1);
  assert.equal(result.review_backlog.summary.ready_for_closing_count, 1);
  assert.equal(audit.events[0]?.event_type, "delivery.session_bootstrap.read");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("getDeliverySessionWorkflowHealth returns a broker projection with roadmap and PM2 drift summary", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryWorkflowHealth() {
      calls.push("getDeliveryWorkflowHealth");
      return {
        portfolio_summary: {
          active_initiatives: 2,
          by_pm2_phase: {
            Closing: 1,
            Executing: 1,
          },
          ready_for_closing_count: 1,
          ready_for_retirement_count: 0,
          total_initiatives: 2,
        },
        project: {
          identifier: "workspace-delivery-art",
        },
        workflow_health: {
          compatible_views: {
            roadmap: {
              canonical_field: "Target PI",
              projected_field: "version",
              truthful: false,
              unassigned_bucket: "Not yet committed to a PI",
              retired_bucket: "Retired scope",
            },
          },
          pm2_phase: {
            drift: [],
            healthy: true,
          },
          roadmap: {
            drift: [
              {
                issue_type: "target_pi_version_drift",
              },
            ],
            healthy: false,
            unassigned_bucket: "Not yet committed to a PI",
            retired_bucket: "Retired scope",
          },
          summary: {
            healthy: false,
            pm2_projection_drift_count: 0,
            ready_for_closing_count: 1,
            ready_for_closeout_count: 0,
            ready_for_retirement_count: 0,
            roadmap_projection_drift_count: 1,
          },
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliverySessionWorkflowHealth({
    callerId: "codex-local",
    correlationId: "corr-workflow-health-1",
  });

  assert.deepEqual(calls, ["getDeliveryWorkflowHealth"]);
  assert.equal(result.workflow_id, "delivery-session-workflow-health");
  assert.equal(result.project.identifier, "workspace-delivery-art");
  assert.equal(result.workflow_health.summary.healthy, false);
  assert.equal(result.portfolio_summary.active_initiatives, 2);
  assert.equal(
    audit.events[0]?.event_type,
    "delivery.session_workflow_health.read",
  );
  assert.equal(audit.events[0]?.status, "drift_detected");
});

test("getDeliveryProjectQualityPack returns a broker projection with quality-pack summary", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryProjectQualityPack() {
      calls.push("getDeliveryProjectQualityPack");
      return {
        project: {
          identifier: "workspace-delivery-art",
        },
        qualityPack: {
          compatible_views: {
            pm2_phase_board: {
              truthful: true,
            },
            roadmap: {
              truthful: true,
              unassigned_bucket: "Not yet committed to a PI",
              retired_bucket: "Retired scope",
            },
          },
          projection_health: {
            pm2_phase: {
              drift: [],
              healthy: true,
            },
            roadmap: {
              drift: [],
              healthy: true,
              unassigned_bucket: "Not yet committed to a PI",
              retired_bucket: "Retired scope",
            },
          },
          summary: {
            pm2_projection_drift_count: 0,
            roadmap_projection_drift_count: 0,
            work_package_count: 12,
          },
          work_packages: [
            {
              id: 304,
              record_ref: "openproject://work_packages/304",
              status: "in-progress",
              subject: "Establish seamless broker-owned ART workflow",
              type: "Epic",
              version_name: "PI-2026-03",
            },
          ],
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryProjectQualityPack({
    callerId: "codex-local",
    correlationId: "corr-quality-pack-1",
  });

  assert.deepEqual(calls, ["getDeliveryProjectQualityPack"]);
  assert.equal(result.workflow_id, "delivery-project-quality-pack");
  assert.equal(result.quality_pack.work_packages.length, 1);
  assert.equal(result.quality_pack.summary.work_package_count, 12);
  assert.equal(
    audit.events[0]?.event_type,
    "delivery.project_quality_pack.read",
  );
  assert.equal(audit.events[0]?.status, "healthy");
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

test("getDeliveryInitiativeReviewPack returns a broker projection with delivery id", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryInitiativeReviewPack({ recordId }) {
      calls.push({ recordId });
      return {
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        reviewPack: {
          epic: {
            id: 304,
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow",
          },
          initiative_review: {
            closing_transition_ready: false,
            completion_transition_ready: false,
            retirement_transition_ready: true,
          },
          quality_drift: {
            ready_without_contract: [],
            completed_with_weak_evidence: [],
            completed_with_weak_done_narrative: [],
            completed_without_evidence: [],
            completed_without_owner: [],
          },
          stale_open_candidates: [
            {
              item: {
                id: 308,
                record_ref: "openproject://work_packages/308",
                status: "in-progress",
                subject: "Provide broker-native ART session resume and status reads",
                type: "Feature",
              },
              reason: "children_terminal_but_parent_open",
            },
          ],
          summary: {
            ready_for_closing: false,
            ready_for_closeout: false,
            ready_for_retirement: true,
            stale_open_candidate_count: 1,
          },
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryInitiativeReviewPack({
    callerId: "codex-local",
    correlationId: "corr-review-pack-1",
    deliveryId: "delivery-304",
  });

  assert.deepEqual(calls, [{ recordId: 304 }]);
  assert.equal(result.delivery_id, "delivery-304");
  assert.equal(result.workflow_id, "delivery-initiative-review-pack");
  assert.equal(result.review_pack.stale_open_candidates.length, 1);
  assert.equal(
    result.review_pack.stale_open_candidates[0].reason,
    "children_terminal_but_parent_open",
  );
  assert.equal(audit.events[0]?.event_type, "delivery.initiative_review_pack.read");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("getDeliveryWorkItemContinuationContext returns a broker projection with compact resume context", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext({ recordId }) {
      calls.push({ recordId });
      return {
        continuationContext: {
          delivery_epic: {
            architecture_anchor_ref: null,
            id: 38,
            initiative_family: "governed-ai-control-plane",
            lineage_role: "architecture-anchor",
            pm2_phase: "Executing",
            record_ref: "openproject://work_packages/38",
            required_upstream_ref: null,
            status: "in-progress",
            subject: "Productize governed local-agent platform",
            type: "Epic",
          },
          open_siblings: [
            {
              execution_classification: null,
              id: 178,
              record_ref: "openproject://work_packages/178",
              status: "new",
              subject: "Add aggregate fail-closed environment readiness validation and operator workflow",
              type: "Task",
            },
          ],
          parent_chain: [
            {
              execution_classification: "Enabler",
              id: 172,
              record_ref: "openproject://work_packages/172",
              status: "in-progress",
              subject: "Enabler: Standardize governed source-to-stage-to-prod release control across products and shared components",
              type: "Feature",
            },
          ],
          previously_completed_related_items: [
            {
              item: {
                execution_classification: null,
                id: 176,
                record_ref: "openproject://work_packages/176",
                status: "done",
                subject: "Add governed OpenProject release records and runbook",
                type: "Task",
              },
              relation: "completed_sibling",
            },
          ],
          summary: {
            completed_related_count: 1,
            open_sibling_count: 1,
          },
          target_item: {
            execution_classification: null,
            id: 177,
            record_ref: "openproject://work_packages/177",
            status: "in-progress",
            subject: "Add supporting-component readiness contracts for shared stage and prod services",
            type: "Task",
          },
        },
        deliveryRecordId: 38,
        deliveryRecordRef: "openproject://work_packages/38",
        workItemRecordId: 177,
        workItemRecordRef: "openproject://work_packages/177",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.getDeliveryWorkItemContinuationContext({
    callerId: "codex-local",
    correlationId: "corr-continuation-1",
    workItemId: "work-item-177",
  });

  assert.deepEqual(calls, [{ recordId: 177 }]);
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.work_item_id, "work-item-177");
  assert.equal(result.workflow_id, "delivery-work-item-continuation-context");
  assert.equal(result.continuation_context.target_item.subject.includes("supporting-component"), true);
  assert.equal(
    result.continuation_context.delivery_epic.initiative_family,
    "governed-ai-control-plane",
  );
  assert.equal(result.continuation_context.parent_chain[0].execution_classification, "Enabler");
  assert.equal(
    result.continuation_context.previously_completed_related_items[0].relation,
    "completed_sibling",
  );
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.continuation_context.read");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("getDeliveryWorkItemContinuationContext rejects top-level Epic shells as executable targets", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext({ recordId }) {
      calls.push({ recordId });
      return {
        continuationContext: {
          delivery_epic: {
            id: 362,
            record_ref: "openproject://work_packages/362",
            status: "new",
            subject: "Introduce universal governed work-tracking home controls",
            type: "Epic",
          },
          open_child_items: [],
          parent_chain: [],
          summary: {
            open_child_count: 0,
          },
          target_item: {
            id: 362,
            parent_id: null,
            record_ref: "openproject://work_packages/362",
            status: "new",
            subject: "Introduce universal governed work-tracking home controls",
            type: "Epic",
          },
        },
        deliveryRecordId: 362,
        deliveryRecordRef: "openproject://work_packages/362",
        workItemRecordId: 362,
        workItemRecordRef: "openproject://work_packages/362",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  await assert.rejects(
    () =>
      service.getDeliveryWorkItemContinuationContext({
        callerId: "codex-local",
        correlationId: "corr-continuation-shell-1",
        workItemId: "work-item-362",
      }),
    (error) =>
      error instanceof OpenProjectError &&
      error.errorClass === "validation_failure" &&
      error.details === "initiative_epic_not_executable",
  );

  assert.deepEqual(calls, [{ recordId: 362 }]);
  assert.equal(audit.events[0]?.event_type, "delivery.work_item.continuation_context.read");
  assert.equal(audit.events[0]?.outcome, "failure");
  assert.equal(audit.events[0]?.error_class, "validation_failure");
});

test("closeStaleOpenDeliveryWorkItem returns a broker projection with closeout metadata", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async closeStaleOpenDeliveryWorkItem(input) {
      calls.push(input);
      return {
        actionApplied: "close_stale_open",
        attachmentsAdded: [],
        attachmentsReplaced: [],
        changes: {
          status: {
            from: "in-progress",
            to: "done",
          },
        },
        completionEvidenceState: {
          formattingValid: true,
        },
        noteApplied: "description_section",
        staleOpenCloseout: {
          childStatusSummary: {
            done: 1,
          },
          completedChildCount: 1,
          justification: "Completed child scope already satisfies the parent read surface.",
          retiredChildCount: 0,
        },
        workPackage: {
          id: 310,
          recordRef: "openproject://work_packages/310",
          status: "done",
          subject: "Brokerize guided closeout, stale-open, planning-repair, and initiative-write parity workflows",
          type: "Feature",
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.closeStaleOpenDeliveryWorkItem({
    callerId: "codex-local",
    changedSurfaces: "- `src/openproject-client.js`: implements the broker closeout behavior.",
    completionNote: "Live proof against a stale-open candidate.",
    completionSummary: "Closed the stale-open ART feature through one broker route.",
    correlationId: "corr-stale-open-1",
    residualFollowUp: null,
    staleOpenJustification:
      "Completed child scope already satisfies the parent read surface.",
    testResultArtifact: null,
    testResultEvidence: "- PASS: `npm test`",
    validationEvidence: "- PASS: live stale-open closeout proof recorded.",
    workItemId: "work-item-310",
  });

  assert.equal(calls[0].recordId, 310);
  assert.equal(
    calls[0].staleOpenJustification,
    "Completed child scope already satisfies the parent read surface.",
  );
  assert.equal(result.workflow_id, "delivery-work-item-stale-open-close");
  assert.equal(result.action_applied, "close_stale_open");
  assert.equal(result.work_item_id, "work-item-310");
  assert.equal(result.stale_open_closeout.completedChildCount, 1);
  assert.equal(
    audit.events[0]?.event_type,
    "delivery.work_item.stale_open_close.recorded",
  );
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
  assert.deepEqual(calls[0].reviews, [
    {
      actualBusinessValue: 10,
      reviewOutcome: "Met",
      targetWorkPackageId: 186,
    },
  ]);
  // OpenProject client owns the PI-review form schema and allowedValues validation.
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(result.workflow_id, "delivery-pi-review");
  assert.equal(result.summary.reviewed_count, 1);
  assert.equal(audit.events[0]?.event_type, "delivery.pi_review.recorded");
  assert.equal(audit.events[0]?.outcome, "success");
  assert.equal(audit.events[0]?.target_pi, "PI-2026-02");
});

test("closeDeliveryInitiative returns a broker projection with guided closeout metadata", async () => {
  const audit = createAudit();
  const calls = [];
  const openProjectClient = {
    async closeDeliveryInitiative(input) {
      calls.push(input);
      return {
        actionApplied: "close_initiative",
        completionEvidenceState: {
          formattingValid: true,
          present: true,
          sections: {
            "Changed Surfaces": true,
            "Completion Summary": true,
            "Test Result Evidence": true,
            "Validation Evidence": true,
          },
        },
        deliveryInitiative: {
          id: 304,
          pm2_phase: "Closing",
          recordRef: "openproject://work_packages/304",
          status: "done",
          subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
        },
        deliveryRecordRef: "openproject://work_packages/304",
        inspectAndAdaptEntry: {
          actionItems: "- Keep initiative closeout broker-owned.",
          date: "2026-04-25",
          followUp: null,
          summary: "Closeout workflow landed cleanly.",
        },
        stepsApplied: {
          inspect_and_adapt_recorded: true,
          initiative_completed: true,
          pm2_closing_entered: true,
          system_demo_recorded: true,
        },
        systemDemoEntry: {
          date: "2026-04-25",
          evidence: "Live devint initiative closed through one route.",
          followUp: null,
          outcome: "reviewed",
          summary: "Broker preserved the full closeout sequence.",
        },
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.closeDeliveryInitiative({
    actionItems: "- Keep initiative closeout broker-owned.",
    callerId: "codex-local",
    changedSurfaces: "- `src/openproject-client.js`: implements the broker closeout behavior.",
    completionNote: "Live proof against a real initiative.",
    completionSummary: "Closed the initiative through one broker workflow.",
    correlationId: "corr-initiative-close-1",
    deliveryId: "delivery-304",
    demoDate: "2026-04-25",
    demoEvidence: "Live devint initiative closed through one route.",
    demoFollowUp: null,
    demoOutcome: "reviewed",
    demoSummary: "Broker preserved the full closeout sequence.",
    inspectDate: "2026-04-25",
    inspectFollowUp: null,
    inspectSummary: "Closeout workflow landed cleanly.",
    residualFollowUp: null,
    testResultEvidence: "- PASS: `npm test`",
    validationEvidence: "- PASS: live initiative closeout proof recorded.",
  });

  assert.equal(calls[0].recordId, 304);
  assert.equal(result.workflow_id, "delivery-initiative-close");
  assert.equal(result.action_applied, "close_initiative");
  assert.equal(result.delivery_id, "delivery-304");
  assert.equal(result.steps_applied.initiative_completed, true);
  assert.equal(result.system_demo_entry.outcome, "reviewed");
  assert.equal(audit.events[0]?.event_type, "delivery.initiative.closed");
  assert.equal(audit.events[0]?.outcome, "success");
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
    changedSurfaces: "- `operator-orchestration-service/src/app.js`: maps the HTTP route to the broker completion service.",
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
          architectureAnchorRef: "openproject://work_packages/277",
          initiativeFamily: "delivery-art-operator-surfaces",
          lineageRole: "control-hardening",
          owner_repo: "operator-orchestration-service",
          pm2Phase: "Executing",
          recordRef: "openproject://work_packages/38",
          requiredUpstreamRef: null,
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
    architectureAnchorRef: "openproject://work_packages/277",
    callerId: "codex-local",
    correlationId: "corr-delivery-initiative-1",
    initiativeFamily: "delivery-art-operator-surfaces",
    lineageRole: "control-hardening",
    ownerRepo: "operator-orchestration-service",
    recordId: "delivery-38",
    pm2Phase: "Executing",
    systemDemoEvidence: "Broker governance route proved in devint.",
  });

  assert.equal(calls[0].recordId, 38);
  assert.equal(calls[0].architectureAnchorRef, "openproject://work_packages/277");
  assert.equal(calls[0].initiativeFamily, "delivery-art-operator-surfaces");
  assert.equal(calls[0].lineageRole, "control-hardening");
  assert.equal(calls[0].ownerRepo, "operator-orchestration-service");
  assert.equal(calls[0].pm2Phase, "Executing");
  assert.equal(result.delivery_id, "delivery-38");
  assert.equal(
    result.delivery_initiative.owner_repo,
    "operator-orchestration-service",
  );
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

test("repairDeliveryPlan returns a broker projection for execution posture correction", async () => {
  const audit = createAudit();
  const continuationCalls = [];
  const updateCalls = [];
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext({ recordId }) {
      continuationCalls.push(recordId);
      return {
        continuationContext: {
          delivery_epic: {
            id: 304,
            record_ref: "openproject://work_packages/304",
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [],
          target_item: {
            assignee_login: "Operator Orchestration-Service",
            delivery_team: null,
            id: 311,
            iteration: "Program-wide / planning",
            owner_repo: "operator-orchestration-service",
            responsible_login: "Operator Orchestration-Service",
            status: "new",
            subject: "Enabler: Harden ART writes with safe retry, idempotency, and duplicate-note protection",
            target_pi: "PI-2026-03",
            type: "Feature",
          },
        },
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        workItemRecordId: 311,
        workItemRecordRef: "openproject://work_packages/311",
      };
    },
    async updateDeliveryWorkItem(input) {
      updateCalls.push(input);
      return {
        changesApplied: {
          delivery_team: {
            from: null,
            to: "Operator Orchestration Service",
          },
        },
        workItem: {
          assigneeLogin: "Operator Orchestration-Service",
          deliveryTeam: "Operator Orchestration Service",
          iteration: "Program-wide / planning",
          ownerRepo: "operator-orchestration-service",
          recordRef: "openproject://work_packages/311",
          responsibleLogin: "Operator Orchestration-Service",
          status: "new",
          subject: "Enabler: Harden ART writes with safe retry, idempotency, and duplicate-note protection",
          targetPi: "PI-2026-03",
          type: "Feature",
        },
        workItemRecordId: 311,
        workItemRecordRef: "openproject://work_packages/311",
      };
    },
  };

  const service = createDeliveryService({ audit, openProjectClient });
  const result = await service.repairDeliveryPlan({
    callerId: "codex-local",
    correlationId: "corr-delivery-plan-repair-1",
    recordId: "delivery-304",
    repairs: [
      {
        action: "execution_posture_correction",
        deliveryTeam: "Operator Orchestration Service",
        reason: "Fill the missing delivery team before the feature moves forward.",
        targetWorkItemId: "work-item-311",
      },
    ],
  });

  assert.deepEqual(continuationCalls, [311]);
  assert.equal(updateCalls[0].recordId, 311);
  assert.equal(updateCalls[0].deliveryTeam, "Operator Orchestration Service");
  assert.match(updateCalls[0].workNote, /^\[Planning repair: execution posture correction\]/);
  assert.equal(result.delivery_id, "delivery-304");
  assert.equal(result.workflow_id, "delivery-plan-repair");
  assert.equal(result.repair_result.summary.repair_count, 1);
  assert.equal(result.repair_result.summary.by_action.execution_posture_correction, 1);
  assert.equal(result.repair_result.repairs[0].work_item_id, "work-item-311");
  assert.equal(audit.events[0]?.event_type, "delivery.plan.repaired");
  assert.equal(audit.events[0]?.outcome, "success");
});

test("repairDeliveryPlan forwards risk posture fields through the bounded update path", async () => {
  const updateCalls = [];
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext() {
      return {
        continuationContext: {
          delivery_epic: {
            id: 304,
            record_ref: "openproject://work_packages/304",
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [],
          target_item: {
            delivery_team: "Platform Engineering",
            id: 317,
            iteration: "Program-wide / planning",
            owner_repo: "platform-engineering",
            risk_disposition: null,
            risk_owner: null,
            risk_review_date: null,
            roam_state: "owned",
            status: "ready",
            subject: "Risk: Residual OpenProject admin seams may keep hidden Rails dependency in the normal operator path longer than planned",
            target_pi: "PI-2026-03",
            type: "Risk",
          },
        },
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        workItemRecordId: 317,
        workItemRecordRef: "openproject://work_packages/317",
      };
    },
    async updateDeliveryWorkItem(input) {
      updateCalls.push(input);
      return {
        changesApplied: {
          risk_disposition: {
            from: null,
            to: "defer",
          },
          risk_owner: {
            from: null,
            to: "Platform Engineering",
          },
          risk_review_date: {
            from: null,
            to: "2026-04-25",
          },
          roam_state: {
            from: "owned",
            to: "accepted",
          },
        },
        workItem: {
          deliveryTeam: "Platform Engineering",
          iteration: "Program-wide / planning",
          ownerRepo: "platform-engineering",
          recordRef: "openproject://work_packages/317",
          riskDisposition: "defer",
          riskOwner: "Platform Engineering",
          riskReviewDate: "2026-04-25",
          roamState: "accepted",
          status: "ready",
          subject: "Risk: Residual OpenProject admin seams may keep hidden Rails dependency in the normal operator path longer than planned",
          targetPi: "PI-2026-03",
          type: "Risk",
        },
        workItemRecordId: 317,
        workItemRecordRef: "openproject://work_packages/317",
      };
    },
  };

  const service = createDeliveryService({ audit: createAudit(), openProjectClient });
  const result = await service.repairDeliveryPlan({
    callerId: "codex-local",
    correlationId: "corr-delivery-plan-repair-risk-1",
    recordId: "delivery-304",
    repairs: [
      {
        action: "execution_posture_correction",
        reason: "Keep the risk in governed review posture without falling back to a generic work-item update.",
        riskDisposition: "defer",
        riskOwner: "Platform Engineering",
        riskReviewDate: "2026-04-25",
        roamState: "accepted",
        targetWorkItemId: "work-item-317",
      },
    ],
  });

  assert.equal(updateCalls[0].recordId, 317);
  assert.equal(updateCalls[0].riskDisposition, "defer");
  assert.equal(updateCalls[0].riskOwner, "Platform Engineering");
  assert.equal(updateCalls[0].riskReviewDate, "2026-04-25");
  assert.equal(updateCalls[0].roamState, "accepted");
  assert.equal(result.repair_result.repairs[0].planning_posture_before.risk_disposition, null);
  assert.equal(result.repair_result.repairs[0].planning_posture_before.risk_owner, null);
  assert.equal(result.repair_result.repairs[0].planning_posture_before.risk_review_date, null);
  assert.equal(result.repair_result.repairs[0].planning_posture_before.roam_state, "owned");
});

test("repairDeliveryPlan retargets work through the bounded update path", async () => {
  const updateCalls = [];
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext() {
      return {
        continuationContext: {
          delivery_epic: {
            id: 304,
            record_ref: "openproject://work_packages/304",
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [],
          target_item: {
            delivery_team: "Operator Orchestration Service",
            id: 325,
            iteration: "Program-wide / planning",
            owner_repo: "operator-orchestration-service",
            status: "ready",
            subject: "Enabler: Add one broker-native planning-repair workflow for PI retarget, decommit, and execution-posture correction",
            target_pi: "PI-2026-03",
            type: "User story",
          },
        },
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        workItemRecordId: 325,
        workItemRecordRef: "openproject://work_packages/325",
      };
    },
    async updateDeliveryWorkItem(input) {
      updateCalls.push(input);
      return {
        changesApplied: {
          iteration: {
            from: "Program-wide / planning",
            to: "Program-wide / planning",
          },
          target_pi: {
            from: "PI-2026-03",
            to: "PI-2026-04",
          },
        },
        workItem: {
          recordRef: "openproject://work_packages/325",
          status: "ready",
          subject: "Enabler: Add one broker-native planning-repair workflow for PI retarget, decommit, and execution-posture correction",
          targetPi: "PI-2026-04",
          type: "User story",
        },
        workItemRecordId: 325,
        workItemRecordRef: "openproject://work_packages/325",
      };
    },
  };

  const service = createDeliveryService({ audit: createAudit(), openProjectClient });
  await service.repairDeliveryPlan({
    callerId: "codex-local",
    correlationId: "corr-delivery-plan-repair-2",
    recordId: "delivery-304",
    repairs: [
      {
        action: "retarget",
        iteration: "Program-wide / planning",
        reason: "Carry this work into the next PI instead of leaving stale PI metadata behind.",
        targetPi: "PI-2026-04",
        targetWorkItemId: "work-item-325",
      },
    ],
  });

  assert.equal(updateCalls[0].targetPi, "PI-2026-04");
  assert.equal(updateCalls[0].iteration, "Program-wide / planning");
  assert.match(updateCalls[0].workNote, /^\[Planning repair: PI retarget\]/);
});

test("repairDeliveryPlan rejects decommit for target-pi-required work types", async () => {
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext() {
      return {
        continuationContext: {
          delivery_epic: {
            id: 304,
            record_ref: "openproject://work_packages/304",
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [],
          target_item: {
            id: 325,
            iteration: "Program-wide / planning",
            owner_repo: "operator-orchestration-service",
            status: "ready",
            subject: "Verify the broker-native planning-repair workflow",
            target_pi: "PI-2026-03",
            type: "Task",
          },
        },
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        workItemRecordId: 325,
        workItemRecordRef: "openproject://work_packages/325",
      };
    },
    async updateDeliveryWorkItem() {
      throw new Error("updateDeliveryWorkItem should not be called");
    },
  };

  const service = createDeliveryService({ audit: createAudit(), openProjectClient });

  await assert.rejects(
    () =>
      service.repairDeliveryPlan({
        callerId: "codex-local",
        correlationId: "corr-delivery-plan-repair-3",
        recordId: "delivery-304",
        repairs: [
          {
            action: "decommit",
            reason: "This should be rejected for task-shaped work.",
            targetWorkItemId: "work-item-325",
          },
        ],
      }),
    /cannot be decommitted to backlog posture/,
  );
});

test("repairDeliveryPlan rejects targets outside the requested initiative", async () => {
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext() {
      return {
        continuationContext: {
          delivery_epic: {
            id: 999,
            record_ref: "openproject://work_packages/999",
            status: "in-progress",
            subject: "Different initiative",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [],
          target_item: {
            id: 325,
            iteration: "Program-wide / planning",
            owner_repo: "operator-orchestration-service",
            status: "ready",
            subject: "Enabler: Add one broker-native planning-repair workflow for PI retarget, decommit, and execution-posture correction",
            target_pi: "PI-2026-03",
            type: "User story",
          },
        },
        deliveryRecordId: 999,
        deliveryRecordRef: "openproject://work_packages/999",
        workItemRecordId: 325,
        workItemRecordRef: "openproject://work_packages/325",
      };
    },
    async updateDeliveryWorkItem() {
      throw new Error("updateDeliveryWorkItem should not be called");
    },
  };

  const service = createDeliveryService({ audit: createAudit(), openProjectClient });

  await assert.rejects(
    () =>
      service.repairDeliveryPlan({
        callerId: "codex-local",
        correlationId: "corr-delivery-plan-repair-4",
        recordId: "delivery-304",
        repairs: [
          {
            action: "execution_posture_correction",
            deliveryTeam: "Operator Orchestration Service",
            reason: "This item belongs to another initiative.",
            targetWorkItemId: "work-item-325",
          },
        ],
      }),
    /does not belong to initiative/,
  );
});

test("repairDeliveryPlan rejects decommit when open child scope still exists", async () => {
  const openProjectClient = {
    async getDeliveryWorkItemContinuationContext() {
      return {
        continuationContext: {
          delivery_epic: {
            id: 304,
            record_ref: "openproject://work_packages/304",
            status: "in-progress",
            subject: "Establish seamless broker-owned ART workflow and zero-Rails normal operator path",
            target_pi: "PI-2026-03",
            type: "Epic",
          },
          open_child_items: [
            {
              id: 401,
              status: "ready",
              subject: "Task: Repair the leaf planning posture",
              type: "Task",
            },
          ],
          target_item: {
            id: 311,
            iteration: "ART backlog / uncommitted",
            owner_repo: "operator-orchestration-service",
            status: "new",
            subject: "Enabler: Harden ART writes with safe retry, idempotency, and duplicate-note protection",
            target_pi: null,
            type: "Feature",
          },
        },
        deliveryRecordId: 304,
        deliveryRecordRef: "openproject://work_packages/304",
        workItemRecordId: 311,
        workItemRecordRef: "openproject://work_packages/311",
      };
    },
    async updateDeliveryWorkItem() {
      throw new Error("updateDeliveryWorkItem should not be called");
    },
  };

  const service = createDeliveryService({ audit: createAudit(), openProjectClient });

  await assert.rejects(
    () =>
      service.repairDeliveryPlan({
        callerId: "codex-local",
        correlationId: "corr-delivery-plan-repair-5",
        recordId: "delivery-304",
        repairs: [
          {
            action: "decommit",
            reason: "This should fail while open child scope still exists.",
            targetWorkItemId: "work-item-311",
          },
        ],
      }),
    /still has open child scope/,
  );
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
