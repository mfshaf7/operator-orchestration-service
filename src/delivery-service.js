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
      parentWorkItemId,
      percentComplete,
      piObjectiveType,
      plannedBusinessValue,
      remainingWork,
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
          parentRecordId,
          percentComplete,
          piObjectiveType,
          plannedBusinessValue,
          remainingWork,
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

    async updateDeliveryWorkItem({
      assigneeLogin,
      callerId,
      clearAssignee = false,
      clearDescription = false,
      clearTargetPi = false,
      correlationId,
      description,
      status,
      targetPi,
      workItemId,
      workNote,
    }) {
      const recordId = parseWorkItemId(workItemId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.updateDeliveryWorkItem({
          assigneeLogin,
          clearAssignee,
          clearDescription,
          clearTargetPi,
          description,
          recordId,
          status,
          targetPi,
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
  };
}
