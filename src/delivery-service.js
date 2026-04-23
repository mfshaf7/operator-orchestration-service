import { HttpError, OpenProjectError } from "./errors.js";
import {
  parseDeliveryId,
  parseWorkItemId,
  toDeliveryId,
  toWorkItemId,
} from "./delivery-model.js";

function toExecutionSummaryProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    execution_summary: result.executionSummary,
    workflow_id: "delivery-execution-summary",
  };
}

function toDeliveryInitiativesProjection(result) {
  return {
    initiatives: result.initiatives,
    project: result.project,
    summary: result.summary,
    workflow_id: "delivery-initiatives",
  };
}

function toDeliveryPlanningProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    planning_summary: result.planningSummary,
    workflow_id: "delivery-planning-summary",
  };
}

function toDeliveryPiObjectivesProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    pi_objectives: result.piObjectives,
    workflow_id: "delivery-pi-objectives",
  };
}

function toDeliveryCloseoutReadinessProjection(result) {
  return {
    closeout_readiness: result.closeoutReadiness,
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    workflow_id: "delivery-closeout-readiness",
  };
}

function toDeliverySystemDemoProjection(result, deliveryRecordId) {
  return {
    delivery_id: toDeliveryId(deliveryRecordId),
    delivery_record_ref: result.epic.recordRef,
    delivery_record_system: "openproject",
    epic: result.epic,
    field_length: result.fieldLength,
    recorded_entry: result.recordedEntry,
    workflow_id: "delivery-system-demo",
  };
}

function toDeliveryInspectAndAdaptProjection(result, deliveryRecordId) {
  return {
    delivery_id: toDeliveryId(deliveryRecordId),
    delivery_record_ref: result.epic.recordRef,
    delivery_record_system: "openproject",
    epic: result.epic,
    field_length: result.fieldLength,
    recorded_entry: result.recordedEntry,
    workflow_id: "delivery-inspect-and-adapt",
  };
}

function toDeliveryPiReviewProjection(result, deliveryRecordId) {
  return {
    delivery_id: toDeliveryId(deliveryRecordId),
    delivery_record_ref: result.epic.recordRef,
    delivery_record_system: "openproject",
    epic: result.epic,
    summary: result.summary,
    updated: result.updated,
    workflow_id: "delivery-pi-review",
  };
}

function toWorkItemCompleteProjection(result) {
  return {
    attachments_added: result.attachmentsAdded,
    attachments_replaced: result.attachmentsReplaced,
    changes_applied: result.changes,
    completion_evidence_state: result.completionEvidenceState,
    note_applied: result.noteApplied,
    work_item: result.workPackage,
    work_item_id: toWorkItemId(result.workPackage.id),
    work_item_record_ref: result.workPackage.recordRef,
    work_item_record_system: "openproject",
    workflow_id: "delivery-work-item-complete",
  };
}

function toWorkItemContinuationContextProjection(result) {
  return {
    continuation_context: result.continuationContext,
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    workflow_id: "delivery-work-item-continuation-context",
  };
}

function toWorkItemUpdateProjection(result) {
  return {
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    work_item: result.workItem,
    changes_applied: result.changesApplied,
    workflow_id: "delivery-work-item-update",
  };
}

function toWorkItemCreateProjection(result) {
  return {
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    parent_work_item_id: toWorkItemId(result.parentWorkItemRecordId),
    work_item: result.workItem,
    creation_applied: result.creationApplied,
    workflow_id: "delivery-work-item-create",
  };
}

function toWorkItemMoveProjection(result) {
  return {
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    parent_work_item_id:
      result.workItem?.parentId ? toWorkItemId(result.workItem.parentId) : null,
    previous_parent_work_item_id: result.previousParentWorkItemRecordId
      ? toWorkItemId(result.previousParentWorkItemRecordId)
      : null,
    work_item: result.workItem,
    changes_applied: result.changesApplied,
    note_applied: result.noteApplied ?? null,
    workflow_id: "delivery-work-item-move",
  };
}

function toWorkItemBlockerProjection(result) {
  return {
    action_applied: result.actionApplied,
    blocker: result.blocker,
    changes_applied: result.changesApplied,
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    work_item: result.workItem,
    workflow_id: "delivery-work-item-blocker",
  };
}

function toWorkItemParkingProjection(result) {
  return {
    action_applied: result.actionApplied,
    changes_applied: result.changesApplied,
    note_applied: result.noteApplied ?? null,
    parking: result.parking,
    work_item_id: toWorkItemId(result.workItemRecordId),
    work_item_record_ref: result.workItemRecordRef,
    work_item_record_system: "openproject",
    work_item: result.workItem,
    workflow_id: "delivery-work-item-parking",
  };
}

function toWorkItemDependencyProjection(result) {
  return {
    action_applied: result.actionApplied,
    created: result.created ?? false,
    depends_on_work_item_id: result.dependsOnWorkItemRecordId
      ? toWorkItemId(result.dependsOnWorkItemRecordId)
      : null,
    relation: result.relation,
    removed_count: result.removedCount ?? 0,
    removed_duplicate_relation_ids: result.removedDuplicateRelationIds ?? [],
    removed_relation_ids: result.removedRelationIds ?? [],
    target_work_item_id: result.targetWorkItemRecordId
      ? toWorkItemId(result.targetWorkItemRecordId)
      : null,
    updated: result.updated ?? false,
    workflow_id: "delivery-work-item-dependency",
  };
}

function toDeliveryInitiativeProjection(result) {
  return {
    changes_applied: result.changesApplied,
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_initiative: result.deliveryInitiative,
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    workflow_id: "delivery-initiative-governance",
  };
}

function toDeliveryPlanProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    plan_result: result.planResult,
    workflow_id: "delivery-plan-apply",
  };
}

export function createDeliveryService({ openProjectClient, audit }) {
  return {
    async getDeliveryExecutionSummary({
      callerId,
      correlationId,
      deliveryId,
      includeDone = true,
      includeParked = false,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryExecutionSummary({
          includeDone,
          includeParked,
          recordId,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.execution_summary.read",
          include_done: includeDone,
          include_parked: includeParked,
          outcome: "success",
          status: result.executionSummary?.epic?.status ?? "unknown",
        });

        return toExecutionSummaryProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.execution_summary.read",
          include_done: includeDone,
          include_parked: includeParked,
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async listDeliveryInitiatives({
      callerId,
      correlationId,
      includeDone = true,
      includeInactive = false,
    }) {
      try {
        const result = await openProjectClient.listDeliveryInitiatives({
          includeDone,
          includeInactive,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: `openproject://projects/${result.project.identifier}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.initiatives.read",
          include_done: includeDone,
          include_inactive: includeInactive,
          outcome: "success",
          status: "ok",
        });

        return toDeliveryInitiativesProjection(result);
      } catch (error) {
        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: "openproject://projects/workspace-delivery-art",
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.initiatives.read",
          include_done: includeDone,
          include_inactive: includeInactive,
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async getDeliveryPlanningSummary({
      callerId,
      correlationId,
      deliveryId,
      includeDone = false,
      includeInactive = false,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryPlanningSummary({
          includeDone,
          includeInactive,
          recordId,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.planning.read",
          include_done: includeDone,
          include_inactive: includeInactive,
          outcome: "success",
          status: result.planningSummary?.epic?.status ?? "unknown",
        });

        return toDeliveryPlanningProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.planning.read",
          include_done: includeDone,
          include_inactive: includeInactive,
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async getDeliveryPiObjectives({
      callerId,
      correlationId,
      deliveryId,
      targetPi = null,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryPiObjectives({
          recordId,
          targetPi,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.pi_objectives.read",
          outcome: "success",
          status: result.piObjectives?.epic?.status ?? "unknown",
          target_pi: targetPi,
        });

        return toDeliveryPiObjectivesProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.pi_objectives.read",
          outcome: "failure",
          status: "read_failed",
          target_pi: targetPi,
        });

        throw error;
      }
    },

    async getDeliveryCloseoutReadiness({
      callerId,
      correlationId,
      deliveryId,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryCloseoutReadiness({
          recordId,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.closeout_readiness.read",
          outcome: "success",
          status: result.closeoutReadiness?.epic?.status ?? "unknown",
        });

        return toDeliveryCloseoutReadinessProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.closeout_readiness.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async getDeliveryWorkItemContinuationContext({
      callerId,
      correlationId,
      workItemId,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryWorkItemContinuationContext({
          recordId,
        });

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          delivery_ref: result.deliveryRecordRef,
          event_type: "delivery.work_item.continuation_context.read",
          outcome: "success",
          status: result.continuationContext?.target_item?.status ?? "unknown",
        });

        return toWorkItemContinuationContextProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.continuation_context.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async recordDeliverySystemDemo({
      callerId,
      correlationId,
      deliveryId,
      demoDate,
      demoEvidence,
      demoFollowUp,
      demoOutcome,
      demoSummary,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.recordDeliverySystemDemo({
          demoDate,
          demoEvidence,
          demoFollowUp,
          demoOutcome,
          demoSummary,
          recordId,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.epic.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.system_demo.recorded",
          outcome: "success",
          status: "recorded",
        });

        return toDeliverySystemDemoProjection(result, recordId);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.system_demo.recorded",
          outcome: "failure",
          status: "record_failed",
        });

        throw error;
      }
    },

    async recordDeliveryInspectAndAdapt({
      actionItems,
      callerId,
      correlationId,
      deliveryId,
      inspectDate,
      inspectFollowUp,
      inspectSummary,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.recordDeliveryInspectAndAdapt({
          actionItems,
          inspectDate,
          inspectFollowUp,
          inspectSummary,
          recordId,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.epic.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.inspect_and_adapt.recorded",
          outcome: "success",
          status: "recorded",
        });

        return toDeliveryInspectAndAdaptProjection(result, recordId);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.inspect_and_adapt.recorded",
          outcome: "failure",
          status: "record_failed",
        });

        throw error;
      }
    },

    async recordDeliveryPiReview({
      callerId,
      correlationId,
      deliveryId,
      piReviewDate,
      reviews,
      targetPi,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.recordDeliveryPiReview({
          piReviewDate,
          recordId,
          reviews,
          targetPi,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.epic.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.pi_review.recorded",
          outcome: "success",
          status: "recorded",
          target_pi: targetPi ?? null,
        });

        return toDeliveryPiReviewProjection(result, recordId);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.pi_review.recorded",
          outcome: "failure",
          status: "record_failed",
          target_pi: targetPi ?? null,
        });

        throw error;
      }
    },

    async completeDeliveryWorkItem({
      callerId,
      changedSurfaces,
      completionNote,
      completionSummary,
      correlationId,
      residualFollowUp,
      testResultArtifact,
      testResultEvidence,
      validationEvidence,
      workItemId,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.completeDeliveryWorkItem({
          changedSurfaces,
          completionNote,
          completionSummary,
          recordId,
          residualFollowUp,
          testResultArtifact,
          testResultEvidence,
          validationEvidence,
        });

        audit.emit({
          attachments_added: result.attachmentsAdded.length,
          attachments_replaced: result.attachmentsReplaced.length,
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.workPackage.recordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changes ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.completed",
          outcome: "success",
          status: result.workPackage?.status ?? "unknown",
        });

        return toWorkItemCompleteProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.completed",
          outcome: "failure",
          status: "completion_failed",
        });

        throw error;
      }
    },

    async createDeliveryWorkItem({
      acceptanceCriteria,
      actualBusinessValue,
      assigneeLogin,
      callerId,
      definitionOfDone,
      definitionOfReady,
      correlationId,
      deliveryTeam,
      description,
      dueDate,
      estimatedWork,
      iteration,
      nfrCategory,
      ownerRepo,
      parentWorkItemId,
      percentComplete,
      piObjectiveType,
      piObjectiveReviewOutcome,
      plannedBusinessValue,
      remainingWork,
      responsibleLogin,
      riskDisposition,
      riskOwner,
      riskReviewDate,
      roamState,
      startDate,
      status,
      subject,
      targetPi,
      type,
      wsjfJobSize,
      wsjfRiskReductionOpportunityEnablement,
      wsjfTimeCriticality,
      wsjfUserBusinessValue,
    }) {
      const parentRecordId = parseWorkItemId(parentWorkItemId);
      if (!parentRecordId) {
        return null;
      }

      try {
        const result = await openProjectClient.createDeliveryWorkItem({
          acceptanceCriteria,
          actualBusinessValue,
          assigneeLogin,
          definitionOfDone,
          definitionOfReady,
          deliveryTeam,
          description,
          dueDate,
          estimatedWork,
          iteration,
          nfrCategory,
          ownerRepo,
          parentRecordId,
          percentComplete,
          piObjectiveType,
          piObjectiveReviewOutcome,
          plannedBusinessValue,
          remainingWork,
          responsibleLogin,
          riskDisposition,
          riskOwner,
          riskReviewDate,
          roamState,
          startDate,
          status,
          subject,
          targetPi,
          type,
          wsjfJobSize,
          wsjfRiskReductionOpportunityEnablement,
          wsjfTimeCriticality,
          wsjfUserBusinessValue,
        });

        audit.emit({
          backend: {
            result: "created",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.creationApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.created",
          outcome: "success",
          parent_ref: `openproject://work_packages/${parentRecordId}`,
          status: result.workItem?.status ?? "unknown",
        });

        return toWorkItemCreateProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${parentRecordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.created",
          outcome: "failure",
          status: "create_failed",
        });

        throw error;
      }
    },

    async updateDeliveryInitiative({
      businessObjective,
      callerId,
      correlationId,
      description,
      inspectAndAdaptActions,
      nfrCategory,
      pm2Phase,
      recordId,
      sponsor,
      status,
      successCriteria,
      systemDemoEvidence,
      targetPi,
    }) {
      const deliveryRecordId = parseDeliveryId(recordId);
      if (!deliveryRecordId) {
        return null;
      }

      try {
        const result = await openProjectClient.updateDeliveryInitiative({
          businessObjective,
          description,
          inspectAndAdaptActions,
          nfrCategory,
          pm2Phase,
          recordId: deliveryRecordId,
          sponsor,
          status,
          successCriteria,
          systemDemoEvidence,
          targetPi,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.initiative.governance_updated",
          outcome: "success",
          status: result.deliveryInitiative?.status ?? "unknown",
        });

        return toDeliveryInitiativeProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${deliveryRecordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.initiative.governance_updated",
          outcome: "failure",
          status: "initiative_update_failed",
        });

        throw error;
      }
    },

    async applyDeliveryPlan({
      callerId,
      correlationId,
      plan,
      recordId,
      reconcileDecision,
      reconcileMissing,
      reconcileReason,
      reconcileRetirementReason,
      reconcileReviewDate,
    }) {
      const deliveryRecordId = parseDeliveryId(recordId);
      if (!deliveryRecordId) {
        return null;
      }

      try {
        const result = await openProjectClient.applyDeliveryPlan({
          plan,
          recordId: deliveryRecordId,
          reconcileDecision,
          reconcileMissing,
          reconcileReason,
          reconcileRetirementReason,
          reconcileReviewDate,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.deliveryRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: [
            ...Object.keys(result.planResult?.epic?.changes ?? {}),
            `created:${result.planResult?.summary?.created_count ?? 0}`,
            `updated:${result.planResult?.summary?.updated_count ?? 0}`,
            `reused:${result.planResult?.summary?.reused_count ?? 0}`,
            `deferred:${result.planResult?.summary?.deferred_count ?? 0}`,
            `retired:${result.planResult?.summary?.retired_count ?? 0}`,
          ],
          correlation_id: correlationId,
          event_type: "delivery.plan.applied",
          outcome: "success",
          status: "plan_applied",
        });

        return toDeliveryPlanProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${deliveryRecordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.plan.applied",
          outcome: "failure",
          status: "plan_apply_failed",
        });

        throw error;
      }
    },

    async updateDeliveryWorkItem({
      acceptanceCriteria,
      actualBusinessValue,
      assigneeLogin,
      callerId,
      clearAssignee = false,
      clearDescription = false,
      clearDueDate = false,
      clearEstimatedWork = false,
      clearRemainingWork = false,
      clearResponsible = false,
      clearStartDate = false,
      clearTargetPi = false,
      correlationId,
      definitionOfDone,
      definitionOfReady,
      deliveryTeam,
      description,
      dueDate,
      estimatedWork,
      iteration,
      nfrCategory,
      ownerRepo,
      percentComplete,
      piObjectiveType,
      piObjectiveReviewOutcome,
      plannedBusinessValue,
      remainingWork,
      responsibleLogin,
      riskDisposition,
      riskOwner,
      riskReviewDate,
      roamState,
      startDate,
      status,
      targetPi,
      workItemId,
      workNote,
      wsjfJobSize,
      wsjfRiskReductionOpportunityEnablement,
      wsjfTimeCriticality,
      wsjfUserBusinessValue,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.updateDeliveryWorkItem({
          acceptanceCriteria,
          actualBusinessValue,
          assigneeLogin,
          clearAssignee,
          clearDescription,
          clearDueDate,
          clearEstimatedWork,
          clearRemainingWork,
          clearResponsible,
          clearStartDate,
          clearTargetPi,
          definitionOfDone,
          definitionOfReady,
          deliveryTeam,
          description,
          dueDate,
          estimatedWork,
          iteration,
          nfrCategory,
          ownerRepo,
          percentComplete,
          piObjectiveType,
          piObjectiveReviewOutcome,
          plannedBusinessValue,
          recordId,
          remainingWork,
          responsibleLogin,
          riskDisposition,
          riskOwner,
          riskReviewDate,
          roamState,
          startDate,
          status,
          targetPi,
          workNote,
          workNoteAuthor: callerId,
          wsjfJobSize,
          wsjfRiskReductionOpportunityEnablement,
          wsjfTimeCriticality,
          wsjfUserBusinessValue,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.updated",
          outcome: "success",
          status: result.workItem?.status ?? "unknown",
        });

        return toWorkItemUpdateProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.updated",
          outcome: "failure",
          status: "update_failed",
        });

        throw error;
      }
    },

    async moveDeliveryWorkItem({
      callerId,
      correlationId,
      newParentWorkItemId,
      workItemId,
      workNote,
    }) {
      const recordId = parseWorkItemId(workItemId);
      const newParentRecordId = parseWorkItemId(newParentWorkItemId);
      if (!recordId || !newParentRecordId) {
        return null;
      }

      try {
        const result = await openProjectClient.moveDeliveryWorkItem({
          newParentRecordId,
          recordId,
          workNote,
          workNoteAuthor: callerId,
        });

        audit.emit({
          backend: {
            result: "moved",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.moved",
          new_parent_ref: `openproject://work_packages/${newParentRecordId}`,
          outcome: "success",
          previous_parent_ref: result.previousParentWorkItemRecordId
            ? `openproject://work_packages/${result.previousParentWorkItemRecordId}`
            : null,
          status: result.workItem?.status ?? "unknown",
        });

        return toWorkItemMoveProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.moved",
          new_parent_ref: `openproject://work_packages/${newParentRecordId}`,
          outcome: "failure",
          status: "move_failed",
        });

        throw error;
      }
    },

    async manageDeliveryBlocker({
      action,
      blockerDecisionPath,
      blockerDiscoveredOn,
      blockerFollowUpOwner,
      blockerImpact,
      blockerJustification,
      blockerOwner,
      blockerReviewDate,
      blockerStatement,
      callerId,
      correlationId,
      resumeStatus,
      workItemId,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.manageDeliveryBlocker({
          action,
          blockerDecisionPath,
          blockerDiscoveredOn,
          blockerFollowUpOwner,
          blockerImpact,
          blockerJustification,
          blockerOwner,
          blockerReviewDate,
          blockerStatement,
          recordId,
          resumeStatus,
        });

        audit.emit({
          action_applied: result.actionApplied,
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.blocker_managed",
          outcome: "success",
          status: result.workItem?.status ?? "unknown",
        });

        return toWorkItemBlockerProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          action_applied: action,
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.blocker_managed",
          outcome: "failure",
          status: "blocker_update_failed",
        });

        throw error;
      }
    },

    async manageDeliveryDependency({
      action,
      callerId,
      clearDescription = false,
      clearLag = false,
      correlationId,
      dependsOnWorkItemId,
      description,
      lag,
      targetWorkItemId,
    }) {
      const recordId = parseWorkItemId(targetWorkItemId);
      const dependsOnRecordId = parseWorkItemId(dependsOnWorkItemId);
      if (!recordId || !dependsOnRecordId) {
        return null;
      }

      try {
        const result = await openProjectClient.manageDeliveryDependency({
          action,
          clearDescription,
          clearLag,
          dependsOnRecordId,
          description,
          lag,
          recordId,
        });

        audit.emit({
          action_applied: result.actionApplied,
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.dependency_managed",
          outcome: "success",
          relation_ref: result.relation?.id ? `openproject://relations/${result.relation.id}` : null,
          status: result.relation ? "dependency_managed" : "dependency_cleared",
        });

        return toWorkItemDependencyProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          action_applied: action,
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.dependency_managed",
          outcome: "failure",
          status: "dependency_update_failed",
        });

        throw error;
      }
    },

    async manageDeliveryParking({
      action,
      callerId,
      correlationId,
      parkDecision,
      parkReason,
      parkReviewDate,
      resumeStatus,
      retirementReason,
      workItemId,
      workNote,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.manageDeliveryParking({
          action,
          parkDecision,
          parkReason,
          parkReviewDate,
          recordId,
          resumeStatus,
          retirementReason,
          workNote,
          workNoteAuthor: callerId,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.workItemRecordRef,
          },
          caller: {
            id: callerId,
          },
          changed_fields: Object.keys(result.changesApplied ?? {}),
          correlation_id: correlationId,
          event_type: "delivery.work_item.parking_managed",
          outcome: "success",
          status: result.workItem?.status ?? "unknown",
        });

        return toWorkItemParkingProjection(result);
      } catch (error) {
        if (error instanceof OpenProjectError && error.errorClass === "not_found") {
          return null;
        }

        audit.emit({
          backend: {
            result: "failed",
            system: "openproject",
            target_ref: `openproject://work_packages/${recordId}`,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          error_class:
            error instanceof OpenProjectError ? error.errorClass : "unexpected_error",
          event_type: "delivery.work_item.parking_managed",
          outcome: "failure",
          status: "parking_failed",
        });

        throw error;
      }
    },
  };
}
