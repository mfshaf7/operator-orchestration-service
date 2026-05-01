import { HttpError, OpenProjectError } from "./errors.js";
import {
  parseDeliveryId,
  parseWorkItemId,
  toDeliveryId,
  toWorkItemId,
} from "./delivery-model.js";
import {
  DELIVERY_BACKLOG_ITERATION_LABEL,
  DELIVERY_TARGET_PI_REQUIRED_TYPES,
} from "./delivery-taxonomy.js";

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

function toDeliveryInitiativeReviewPackProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    review_pack: result.reviewPack,
    workflow_id: "delivery-initiative-review-pack",
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

function toDeliveryInitiativeCloseProjection(result, deliveryRecordId) {
  return {
    action_applied: result.actionApplied,
    completion_evidence_state: result.completionEvidenceState,
    delivery_id: toDeliveryId(deliveryRecordId),
    delivery_initiative: result.deliveryInitiative,
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    inspect_and_adapt_entry: result.inspectAndAdaptEntry,
    steps_applied: result.stepsApplied,
    system_demo_entry: result.systemDemoEntry,
    workflow_id: "delivery-initiative-close",
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

function toWorkItemStaleOpenCloseProjection(result) {
  return {
    action_applied: result.actionApplied,
    attachments_added: result.attachmentsAdded,
    attachments_replaced: result.attachmentsReplaced,
    changes_applied: result.changes,
    completion_evidence_state: result.completionEvidenceState,
    note_applied: result.noteApplied,
    stale_open_closeout: result.staleOpenCloseout,
    work_item: result.workPackage,
    work_item_id: toWorkItemId(result.workPackage.id),
    work_item_record_ref: result.workPackage.recordRef,
    work_item_record_system: "openproject",
    workflow_id: "delivery-work-item-stale-open-close",
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

function assertExecutableContinuationTarget(result) {
  const targetItem = result?.continuationContext?.target_item;
  if (!targetItem) {
    return;
  }

  if (targetItem.type === "Epic" && targetItem.parent_id === null) {
    throw new OpenProjectError(
      "validation_failure",
      "Top-level delivery Epic shells are not executable work items. Use delivery initiative planning, governance, or review-pack surfaces before choosing a child work item.",
      422,
      "initiative_epic_not_executable",
    );
  }
}

function normalizeWgcfArtReadinessMode(value) {
  return value === "required" ? "required" : "off";
}

function wgcfReadinessAllowed(readiness) {
  return (
    readiness &&
    typeof readiness === "object" &&
    !Array.isArray(readiness) &&
    readiness.mutation_allowed === true
  );
}

function isWgcfArtReadinessError(error) {
  if (error instanceof HttpError) {
    return String(error.code ?? "").startsWith("wgcf_art_readiness");
  }
  return (
    error instanceof OpenProjectError &&
    error.errorClass === "validation_failure" &&
    error.details?.workflow_id === "delivery-art-wgcf-readiness-required"
  );
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

function toDeliveryPlanningRepairProjection(result) {
  return {
    delivery_id: toDeliveryId(result.deliveryRecordId),
    delivery_record_ref: result.deliveryRecordRef,
    delivery_record_system: "openproject",
    repair_result: result.repairResult,
    workflow_id: "delivery-plan-repair",
  };
}

function compactPlanningPosture(node) {
  return {
    assignee_login: node?.assignee_login ?? null,
    delivery_team: node?.delivery_team ?? null,
    iteration: node?.iteration ?? null,
    owner_repo: node?.owner_repo ?? null,
    risk_disposition: node?.risk_disposition ?? null,
    risk_owner: node?.risk_owner ?? null,
    risk_review_date: node?.risk_review_date ?? null,
    roam_state: node?.roam_state ?? null,
    responsible_login: node?.responsible_login ?? null,
    status: node?.status ?? null,
    target_pi: node?.target_pi ?? null,
    type: node?.type ?? null,
  };
}

function renderPlanningRepairWorkNote({
  action,
  reason,
  workNote,
}) {
  const renderedAction =
    action === "retarget"
      ? "PI retarget"
      : action === "decommit"
        ? "decommit to backlog"
        : "execution posture correction";
  return [`[Planning repair: ${renderedAction}] ${reason}`, workNote]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
}

function countPlanningRepairActions(repairs) {
  const counts = {
    decommit: 0,
    execution_posture_correction: 0,
    retarget: 0,
  };

  for (const repair of repairs) {
    if (counts[repair.action] !== undefined) {
      counts[repair.action] += 1;
    }
  }

  return counts;
}

function compactBootstrapNode(node) {
  return {
    architecture_anchor_ref: node.architecture_anchor_ref ?? null,
    assignee_login: node.assignee_login ?? null,
    blocked: node.blocked ?? false,
    dependency_blocked: node.dependency_blocked ?? false,
    delivery_team: node.delivery_team ?? null,
    id: node.id,
    initiative_family: node.initiative_family ?? null,
    iteration: node.iteration ?? null,
    lineage_role: node.lineage_role ?? null,
    owner_repo: node.owner_repo ?? null,
    percent_complete: node.percent_complete ?? null,
    pm2_phase: node.pm2_phase ?? null,
    record_ref: node.record_ref,
    required_upstream_ref: node.required_upstream_ref ?? null,
    responsible_login: node.responsible_login ?? null,
    status: node.status,
    subject: node.subject,
    target_pi: node.target_pi ?? null,
    type: node.type,
    updated_at: node.updated_at ?? null,
  };
}

function toDeliverySessionBootstrapProjection(result) {
  return {
    active_fronts: result.activeFronts,
    assignables: result.assignables,
    caller: result.caller,
    review_backlog: result.reviewBacklog,
    runtime: result.runtime,
    workflow_id: "delivery-session-bootstrap",
  };
}

function toDeliverySessionWorkflowHealthProjection(result) {
  return {
    portfolio_summary: result.portfolioSummary,
    project: result.project,
    workflow_health: result.workflowHealth,
    workflow_id: "delivery-session-workflow-health",
  };
}

function toDeliveryProjectQualityPackProjection(result) {
  return {
    project: result.project,
    quality_pack: result.qualityPack,
    workflow_id: "delivery-project-quality-pack",
  };
}

export function createDeliveryService({
  openProjectClient,
  audit,
  runtimeContext = {},
  wgcfArtReadinessClient = null,
  wgcfArtReadinessMode = "off",
}) {
  const normalizedWgcfArtReadinessMode = normalizeWgcfArtReadinessMode(
    wgcfArtReadinessMode,
  );

  async function enforceWgcfArtReadiness({
    callerId,
    correlationId,
    operation,
    recordId,
  }) {
    if (normalizedWgcfArtReadinessMode !== "required") {
      return null;
    }

    if (!wgcfArtReadinessClient) {
      throw new HttpError(
        503,
        "wgcf_art_readiness_not_configured",
        "WGCF ART readiness is required but no readiness client is configured.",
      );
    }

    try {
      const contextResult = await openProjectClient.getDeliveryWorkItemContinuationContext({
        recordId,
      });
      assertExecutableContinuationTarget(contextResult);
      const brokerContext = toWorkItemContinuationContextProjection(contextResult);
      const readiness = await wgcfArtReadinessClient.evaluate({
        context: brokerContext,
        operation,
        targetItemId: recordId,
      });
      const allowed = wgcfReadinessAllowed(readiness);

      audit.emit({
        backend: {
          result: allowed ? "checked" : "blocked",
          system: "workspace-governance-control-fabric",
          target_ref: `openproject://work_packages/${recordId}`,
        },
        caller: {
          id: callerId,
        },
        correlation_id: correlationId,
        event_type: "delivery.work_item.wgcf_readiness.checked",
        operation,
        outcome: allowed ? "success" : "blocked",
        receipt_id: readiness?.receipt_id ?? null,
        status: readiness?.outcome ?? "unknown",
      });

      if (!allowed) {
        throw new OpenProjectError(
          "validation_failure",
          "WGCF ART readiness blocked this mutation.",
          422,
          {
            workflow_id: "delivery-art-wgcf-readiness-required",
            wgcf_art_readiness: readiness,
          },
        );
      }

      return readiness;
    } catch (error) {
      if (
        error instanceof OpenProjectError &&
        error.errorClass === "validation_failure" &&
        error.details?.workflow_id === "delivery-art-wgcf-readiness-required"
      ) {
        throw error;
      }

      audit.emit({
        backend: {
          result: "failed",
          system: "workspace-governance-control-fabric",
          target_ref: `openproject://work_packages/${recordId}`,
        },
        caller: {
          id: callerId,
        },
        correlation_id: correlationId,
        error_class:
          error instanceof HttpError
            ? error.code
            : error instanceof OpenProjectError
              ? error.errorClass
              : "unexpected_error",
        event_type: "delivery.work_item.wgcf_readiness.checked",
        operation,
        outcome: "failure",
        status: "readiness_failed",
      });

      throw error;
    }
  }

  return {
    async getDeliverySessionBootstrap({
      callerId,
      callerAuthMode,
      correlationId,
    }) {
      try {
        const [initiativeResult, assignableResult] = await Promise.all([
          openProjectClient.listDeliveryInitiatives({
            includeDone: false,
            includeInactive: true,
          }),
          openProjectClient.listDeliveryProjectAssignablePrincipals(),
        ]);

        const activeFronts = initiativeResult.initiatives
          .map((initiative) => {
            const activeItems = initiative.open_descendants
              .filter((node) => node.status.toLowerCase() === "in-progress")
              .map((node) => compactBootstrapNode(node));
            const nextReadyItems = initiative.open_descendants
              .filter((node) => node.status.toLowerCase() === "ready")
              .map((node) => compactBootstrapNode(node));

            if (activeItems.length === 0 && nextReadyItems.length === 0) {
              return null;
            }

            return {
              closing_ready: initiative.closing_ready,
              closeout_ready: initiative.closeout_ready,
              delivery_id: toDeliveryId(initiative.epic.id),
              delivery_record_ref: initiative.epic.record_ref,
              epic: compactBootstrapNode(initiative.epic),
              initiative_review: initiative.initiative_review,
              next_ready_items: nextReadyItems,
              open_active_items: activeItems,
              summary: {
                active_item_count: activeItems.length,
                blocked_count: initiative.summary.blocked_count,
                next_ready_count: nextReadyItems.length,
                open_descendant_count: initiative.summary.open_descendant_count,
              },
            };
          })
          .filter(Boolean);

        const compactReviewEntry = (initiative) => ({
          closing_reasons: initiative.closing_reasons,
          closeout_reasons: initiative.closeout_reasons,
          delivery_id: toDeliveryId(initiative.epic.id),
          delivery_record_ref: initiative.epic.record_ref,
          epic: compactBootstrapNode(initiative.epic),
          initiative_review: initiative.initiative_review,
          retirement_reasons: initiative.retirement_reasons,
          summary: {
            blocked_count: initiative.summary.blocked_count,
            completed_with_weak_evidence_count:
              initiative.summary.completed_with_weak_evidence_count,
            completed_with_weak_done_narrative_count:
              initiative.summary.completed_with_weak_done_narrative_count,
            completed_without_evidence_count:
              initiative.summary.completed_without_evidence_count,
            completed_without_owner_count:
              initiative.summary.completed_without_owner_count,
            open_descendant_count: initiative.summary.open_descendant_count,
            retired_count: initiative.summary.retired_count,
            unresolved_dependency_count:
              initiative.summary.unresolved_dependency_count,
          },
        });

        const readyForClosing = initiativeResult.initiatives
          .filter((initiative) => initiative.closing_ready)
          .map((initiative) => compactReviewEntry(initiative));
        const readyForCloseout = initiativeResult.initiatives
          .filter((initiative) => initiative.closeout_ready)
          .map((initiative) => compactReviewEntry(initiative));
        const readyForRetirement = initiativeResult.initiatives
          .filter((initiative) => initiative.retirement_ready)
          .map((initiative) => compactReviewEntry(initiative));
        const blockedInitiatives = initiativeResult.initiatives
          .filter((initiative) => initiative.summary.blocked_count > 0)
          .map((initiative) => compactReviewEntry(initiative));

        const activeItemCount = activeFronts.reduce(
          (total, initiative) => total + initiative.summary.active_item_count,
          0,
        );
        const nextReadyCount = activeFronts.reduce(
          (total, initiative) => total + initiative.summary.next_ready_count,
          0,
        );

        const projection = {
          activeFronts: {
            initiatives: activeFronts,
            summary: {
              active_initiative_count: activeFronts.length,
              active_item_count: activeItemCount,
              next_ready_count: nextReadyCount,
            },
          },
          assignables: {
            principals: assignableResult.principals,
            project: assignableResult.project,
            summary: {
              assignable_count: assignableResult.principals.length,
            },
          },
          caller: {
            auth_mode: callerAuthMode ?? null,
            id: callerId,
          },
          reviewBacklog: {
            blocked_initiatives: blockedInitiatives,
            ready_for_closing: readyForClosing,
            ready_for_closeout: readyForCloseout,
            ready_for_retirement: readyForRetirement,
            summary: {
              blocked_count: blockedInitiatives.length,
              ready_for_closing_count: readyForClosing.length,
              ready_for_closeout_count: readyForCloseout.length,
              ready_for_retirement_count: readyForRetirement.length,
            },
          },
          runtime: {
            broker_service: {
              git_commit: runtimeContext.brokerService?.gitCommit ?? null,
              name: runtimeContext.brokerService?.name ?? null,
              version: runtimeContext.brokerService?.version ?? null,
            },
            delivery_project_identifier:
              runtimeContext.deliveryProjectIdentifier ?? null,
            openproject_runtime: {
              cluster_domain:
                runtimeContext.openProjectRuntime?.clusterDomain ?? null,
              host: runtimeContext.openProjectRuntime?.host ?? null,
              namespace: runtimeContext.openProjectRuntime?.namespace ?? null,
              service_name:
                runtimeContext.openProjectRuntime?.serviceName ?? null,
            },
          },
        };

        audit.emit({
          backend: {
            result: "read",
            system: "openproject",
            target_ref: assignableResult.project.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.session_bootstrap.read",
          outcome: "success",
          status: "ok",
        });

        return toDeliverySessionBootstrapProjection(projection);
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
          event_type: "delivery.session_bootstrap.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async getDeliverySessionWorkflowHealth({
      callerId,
      correlationId,
    }) {
      try {
        const result = await openProjectClient.getDeliveryWorkflowHealth();

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
          event_type: "delivery.session_workflow_health.read",
          outcome: "success",
          status: result.workflow_health?.summary?.healthy ? "healthy" : "drift_detected",
        });

        return toDeliverySessionWorkflowHealthProjection({
          portfolioSummary: result.portfolio_summary,
          project: result.project,
          workflowHealth: result.workflow_health,
        });
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
          event_type: "delivery.session_workflow_health.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

    async getDeliveryProjectQualityPack({
      callerId,
      correlationId,
    }) {
      try {
        const result = await openProjectClient.getDeliveryProjectQualityPack();

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
          event_type: "delivery.project_quality_pack.read",
          outcome: "success",
          status:
            result.qualityPack?.summary?.roadmap_projection_drift_count ||
            result.qualityPack?.summary?.pm2_projection_drift_count
              ? "drift_detected"
              : "healthy",
        });

        return toDeliveryProjectQualityPackProjection({
          project: result.project,
          qualityPack: result.qualityPack,
        });
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
          event_type: "delivery.project_quality_pack.read",
          outcome: "failure",
          status: "read_failed",
        });

        throw error;
      }
    },

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

    async getDeliveryInitiativeReviewPack({
      callerId,
      correlationId,
      deliveryId,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.getDeliveryInitiativeReviewPack({
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
          event_type: "delivery.initiative_review_pack.read",
          outcome: "success",
          status: result.reviewPack?.epic?.status ?? "unknown",
        });

        return toDeliveryInitiativeReviewPackProjection(result);
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
          event_type: "delivery.initiative_review_pack.read",
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
        assertExecutableContinuationTarget(result);

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

    async closeDeliveryInitiative({
      actionItems,
      callerId,
      changedSurfaces,
      completionNote,
      completionSummary,
      correlationId,
      deliveryId,
      demoDate,
      demoEvidence,
      demoFollowUp,
      demoOutcome,
      demoSummary,
      inspectDate,
      inspectFollowUp,
      inspectSummary,
      residualFollowUp,
      testResultEvidence,
      validationEvidence,
    }) {
      const recordId = parseDeliveryId(deliveryId);
      if (!recordId) {
        return null;
      }

      try {
        const result = await openProjectClient.closeDeliveryInitiative({
          actionItems,
          changedSurfaces,
          completionNote,
          completionSummary,
          demoDate,
          demoEvidence,
          demoFollowUp,
          demoOutcome,
          demoSummary,
          inspectDate,
          inspectFollowUp,
          inspectSummary,
          recordId,
          residualFollowUp,
          testResultEvidence,
          validationEvidence,
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
          correlation_id: correlationId,
          event_type: "delivery.initiative.closed",
          outcome: "success",
          status: result.deliveryInitiative?.status ?? "unknown",
        });

        return toDeliveryInitiativeCloseProjection(result, recordId);
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
          event_type: "delivery.initiative.closed",
          outcome: "failure",
          status: "close_failed",
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
        const wgcfArtReadiness = await enforceWgcfArtReadiness({
          callerId,
          correlationId,
          operation: "complete",
          recordId,
        });
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

        return {
          ...toWorkItemCompleteProjection(result),
          ...(wgcfArtReadiness ? { wgcf_art_readiness: wgcfArtReadiness } : {}),
        };
      } catch (error) {
        if (isWgcfArtReadinessError(error)) {
          throw error;
        }

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

    async closeStaleOpenDeliveryWorkItem({
      callerId,
      changedSurfaces,
      completionNote,
      completionSummary,
      correlationId,
      residualFollowUp,
      staleOpenJustification,
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
        const wgcfArtReadiness = await enforceWgcfArtReadiness({
          callerId,
          correlationId,
          operation: "stale-open-close",
          recordId,
        });
        const result = await openProjectClient.closeStaleOpenDeliveryWorkItem({
          changedSurfaces,
          completionNote,
          completionSummary,
          recordId,
          residualFollowUp,
          staleOpenJustification,
          testResultArtifact,
          testResultEvidence,
          validationEvidence,
        });

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: result.workPackage.recordRef,
          },
          caller: {
            id: callerId,
          },
          correlation_id: correlationId,
          event_type: "delivery.work_item.stale_open_close.recorded",
          outcome: "success",
          status: result.workPackage?.status ?? "unknown",
        });

        return {
          ...toWorkItemStaleOpenCloseProjection(result),
          ...(wgcfArtReadiness ? { wgcf_art_readiness: wgcfArtReadiness } : {}),
        };
      } catch (error) {
        if (isWgcfArtReadinessError(error)) {
          throw error;
        }

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
          event_type: "delivery.work_item.stale_open_close.recorded",
          outcome: "failure",
          status: "record_failed",
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
      executionClassification,
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
          executionClassification,
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
      architectureAnchorRef,
      assigneeLogin,
      businessObjective,
      callerId,
      correlationId,
      description,
      inspectAndAdaptActions,
      initiativeFamily,
      lineageRole,
      nfrCategory,
      ownerRepo,
      pm2Phase,
      recordId,
      responsibleLogin,
      requiredUpstreamRef,
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
          architectureAnchorRef,
          assigneeLogin,
          businessObjective,
          description,
          inspectAndAdaptActions,
          initiativeFamily,
          lineageRole,
          nfrCategory,
          ownerRepo,
          pm2Phase,
          recordId: deliveryRecordId,
          responsibleLogin,
          requiredUpstreamRef,
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

    async repairDeliveryPlan({
      callerId,
      correlationId,
      recordId,
      repairs,
    }) {
      const deliveryRecordId = parseDeliveryId(recordId);
      if (!deliveryRecordId) {
        return null;
      }

      try {
        const updated = [];
        let deliveryRecordRef = null;
        let epic = null;

        for (const repair of repairs) {
          const targetRecordId = parseWorkItemId(repair.targetWorkItemId);
          if (!targetRecordId) {
            throw new OpenProjectError(
              "validation_failure",
              `Planning repair target ${repair.targetWorkItemId} is not a valid work item id.`,
              422,
              "planning_repair_target_invalid",
            );
          }

          const contextResult = await openProjectClient.getDeliveryWorkItemContinuationContext({
            recordId: targetRecordId,
          });

          if (contextResult.deliveryRecordId !== deliveryRecordId) {
            throw new OpenProjectError(
              "validation_failure",
              `Work item ${repair.targetWorkItemId} does not belong to initiative ${recordId}.`,
              422,
              "planning_repair_target_outside_initiative",
            );
          }

          deliveryRecordRef = contextResult.deliveryRecordRef;
          epic = contextResult.continuationContext?.delivery_epic ?? epic;

          const targetItem = contextResult.continuationContext?.target_item;
          if (!targetItem) {
            throw new OpenProjectError(
              "validation_failure",
              `Work item ${repair.targetWorkItemId} is missing continuation target metadata.`,
              422,
              "planning_repair_target_context_missing",
            );
          }

          if (targetItem.type === "Epic") {
            throw new OpenProjectError(
              "validation_failure",
              `Planning repair targets must be descendant work items, not the initiative epic ${repair.targetWorkItemId}.`,
              422,
              "planning_repair_target_epic_invalid",
            );
          }

          const currentStatus = String(targetItem.status || "").trim().toLowerCase();
          if (currentStatus === "done" || currentStatus === "retired") {
            throw new OpenProjectError(
              "validation_failure",
              `Planning repair cannot target terminal work item ${repair.targetWorkItemId}.`,
              422,
              "planning_repair_target_terminal",
            );
          }

          const openChildItems = contextResult.continuationContext?.open_child_items ?? [];
          const planningPostureBefore = compactPlanningPosture(targetItem);
          const workNote = renderPlanningRepairWorkNote({
            action: repair.action,
            reason: repair.reason,
            workNote: repair.workNote,
          });

          let updateInput;
          if (repair.action === "retarget") {
            updateInput = {
              assigneeLogin: repair.assigneeLogin,
              clearAssignee: repair.clearAssignee,
              clearResponsible: repair.clearResponsible,
              deliveryTeam: repair.deliveryTeam,
              iteration: repair.iteration,
              ownerRepo: repair.ownerRepo,
              riskDisposition: repair.riskDisposition,
              riskOwner: repair.riskOwner,
              riskReviewDate: repair.riskReviewDate,
              roamState: repair.roamState,
              responsibleLogin: repair.responsibleLogin,
              status: repair.status,
              targetPi: repair.targetPi,
              workNote,
            };
          } else if (repair.action === "decommit") {
            if (DELIVERY_TARGET_PI_REQUIRED_TYPES.has(targetItem.type)) {
              throw new OpenProjectError(
                "validation_failure",
                `${targetItem.type} cannot be decommitted to backlog posture; retarget, complete, retire, or move it instead.`,
                422,
                "planning_repair_decommit_forbidden_type",
              );
            }

            if (openChildItems.length > 0) {
              throw new OpenProjectError(
                "validation_failure",
                `Work item ${repair.targetWorkItemId} still has open child scope and cannot decommit to backlog posture.`,
                422,
                "planning_repair_decommit_open_children",
              );
            }

            updateInput = {
              clearTargetPi: true,
              iteration: DELIVERY_BACKLOG_ITERATION_LABEL,
              status: "new",
              workNote,
            };
          } else {
            updateInput = {
              assigneeLogin: repair.assigneeLogin,
              clearAssignee: repair.clearAssignee,
              clearResponsible: repair.clearResponsible,
              deliveryTeam: repair.deliveryTeam,
              iteration: repair.iteration,
              ownerRepo: repair.ownerRepo,
              riskDisposition: repair.riskDisposition,
              riskOwner: repair.riskOwner,
              riskReviewDate: repair.riskReviewDate,
              roamState: repair.roamState,
              responsibleLogin: repair.responsibleLogin,
              status: repair.status,
              targetPi: repair.targetPi,
              clearTargetPi: repair.clearTargetPi,
              workNote,
            };
          }

          const result = await openProjectClient.updateDeliveryWorkItem({
            ...updateInput,
            recordId: targetRecordId,
          });

          updated.push({
            action: repair.action,
            changes_applied: result.changesApplied,
            planning_posture_before: planningPostureBefore,
            reason: repair.reason,
            work_item: result.workItem,
            work_item_id: toWorkItemId(result.workItemRecordId),
            work_item_record_ref: result.workItemRecordRef,
          });
        }

        const byAction = countPlanningRepairActions(updated);
        const repairResult = {
          epic: epic
            ? {
                id: epic.id,
                record_ref: epic.record_ref,
                status: epic.status,
                subject: epic.subject,
                target_pi: epic.target_pi ?? null,
                type: epic.type,
              }
            : null,
          repairs: updated,
          summary: {
            by_action: byAction,
            repair_count: updated.length,
            updated_count: updated.length,
          },
        };

        audit.emit({
          backend: {
            result: "updated",
            system: "openproject",
            target_ref: deliveryRecordRef ?? `openproject://work_packages/${deliveryRecordId}`,
          },
          caller: {
            id: callerId,
          },
          changed_fields: [
            `repairs:${updated.length}`,
            `retarget:${byAction.retarget}`,
            `decommit:${byAction.decommit}`,
            `execution_posture_correction:${byAction.execution_posture_correction}`,
          ],
          correlation_id: correlationId,
          event_type: "delivery.plan.repaired",
          outcome: "success",
          status: "planning_repair_applied",
        });

        return toDeliveryPlanningRepairProjection({
          deliveryRecordId,
          deliveryRecordRef,
          repairResult,
        });
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
          event_type: "delivery.plan.repaired",
          outcome: "failure",
          status: "planning_repair_failed",
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
      executionClassification,
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
      subject,
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
          executionClassification,
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
          subject,
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
