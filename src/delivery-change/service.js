import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { parseDeliveryId } from "../delivery-model.js";
import { HttpError, OpenProjectError } from "../errors.js";
import {
  assertDeliveryChangeCommand,
  assertDeliveryChangeError,
  assertDeliveryChangeEvent,
  assertDeliveryChangeProjection,
  assertDeliveryChangeResult,
} from "./contracts.js";
import {
  decodeDeliveryChangeEvent,
  encodeDeliveryChangeEvent,
} from "./event-codec.js";

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 20;

export class DeliveryChangeServiceError extends Error {
  constructor(code, message, {
    details = null,
    nextAction = {
      code: "refresh_delivery_package",
      label: "Refresh Delivery Package",
      authority: "operator-orchestration-service",
    },
    retryable = false,
    statusCode = 400,
  } = {}) {
    super(message);
    this.name = "DeliveryChangeServiceError";
    this.code = code;
    this.details = details;
    this.nextAction = nextAction;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }

  toResponse() {
    return assertDeliveryChangeError({
      schema_version: 1,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === null ? {} : { details: this.details }),
      next_action: this.nextAction,
    });
  }
}

function workItemId(value) {
  return String(value).startsWith("work-item-") ? String(value) : `work-item-${value}`;
}

function revisionEvidence(projection) {
  return {
    record_ref: projection.record_ref,
    source_revision: projection.source_revision,
  };
}

function operationNote(command) {
  return `[Delivery change ${command.command_id}] ${command.acceptance.note}`.trim();
}

function mappedRevisionChanges(changes) {
  const mapping = {
    acceptance_criteria: "acceptanceCriteria",
    assignee_login: "assigneeLogin",
    clear_assignee: "clearAssignee",
    clear_description: "clearDescription",
    clear_due_date: "clearDueDate",
    clear_estimated_work: "clearEstimatedWork",
    clear_remaining_work: "clearRemainingWork",
    clear_responsible: "clearResponsible",
    clear_start_date: "clearStartDate",
    clear_target_pi: "clearTargetPi",
    definition_of_done: "definitionOfDone",
    definition_of_ready: "definitionOfReady",
    delivery_team: "deliveryTeam",
    due_date: "dueDate",
    estimated_work: "estimatedWork",
    execution_classification: "executionClassification",
    nfr_category: "nfrCategory",
    owner_repo: "ownerRepo",
    percent_complete: "percentComplete",
    remaining_work: "remainingWork",
    responsible_login: "responsibleLogin",
    start_date: "startDate",
    target_pi: "targetPi",
  };
  return Object.fromEntries(Object.entries(changes).map(([key, value]) => [
    mapping[key] ?? key,
    value,
  ]));
}

function mapFailure(error) {
  if (error instanceof DeliveryChangeServiceError) return error;
  if (error instanceof HttpError) {
    return new DeliveryChangeServiceError(error.code, error.message, {
      details: error.details,
      statusCode: error.statusCode,
    });
  }
  if (error instanceof OpenProjectError) {
    const conflict = ["update_conflict", "validation_failure"].includes(error.errorClass);
    return new DeliveryChangeServiceError(
      error.code ?? error.errorClass,
      error.message,
      {
        details: error.details,
        retryable: error.errorClass === "backend_unavailable",
        statusCode: conflict ? 409 : error.errorClass === "not_found" ? 404 : 502,
      },
    );
  }
  return new DeliveryChangeServiceError(
    "delivery_change_dependency_failed",
    "The Delivery change could not be applied by its owning authority.",
    { retryable: true, statusCode: 502 },
  );
}

function nextActionFor(status, operationType) {
  if (operationType === "request_repository") {
    return {
      code: "open_repository_operation",
      label: "Open Repository Operation",
      authority: "governance-operations-console/repository-operation",
    };
  }
  if (status === "partial_failure") {
    return {
      code: "reconcile_repository_link",
      label: "Reconcile Repository Link",
      authority: "operator-orchestration-service",
    };
  }
  if (status === "rejected") {
    return {
      code: "prepare_compensating_command",
      label: "Prepare Compensating Command",
      authority: "operator-orchestration-service",
    };
  }
  return {
    code: "refresh_delivery_package",
    label: "Refresh Delivery Package",
    authority: "operator-orchestration-service",
  };
}

function rollbackFor(status, operationType) {
  if (status === "routed") {
    return { mode: "not_applicable", reason: "No Delivery package mutation was applied." };
  }
  if (operationType === "rollback_change") {
    return {
      mode: "not_supported",
      reason: "Automatic inversion is rejected until an exact operation-specific inverse is proven.",
    };
  }
  return {
    mode: "compensating_command_required",
    reason: "Rollback requires a new reviewed command against the current package revision.",
  };
}

export function createDeliveryChangeService({
  audit = null,
  catalogService,
  clock = () => new Date(),
  deliveryService,
  openProjectClient,
} = {}) {
  let automationUserRefPromise = null;

  async function automationUserRef() {
    automationUserRefPromise ??= openProjectClient.getDeliveryChangeAutomationUserRef();
    return automationUserRefPromise;
  }

  async function readEvents(recordId) {
    const events = [];
    const userRef = await automationUserRef();
    let page = 1;
    for (let index = 0; index < MAX_ACTIVITY_PAGES && page !== null; index += 1) {
      const result = await openProjectClient.listDeliveryChangeActivities({
        offset: page,
        pageSize: ACTIVITY_PAGE_SIZE,
        recordId,
      });
      for (const activity of result.items) {
        if (!userRef || activity.userRef !== userRef) continue;
        const decoded = decodeDeliveryChangeEvent(activity.comment);
        if (!decoded) continue;
        try {
          events.push(assertDeliveryChangeEvent(decoded));
        } catch {
          throw new DeliveryChangeServiceError(
            "delivery_change_event_invalid",
            "An OOS-authored Delivery change event is invalid.",
            { statusCode: 502 },
          );
        }
      }
      page = page * result.pageSize < result.total ? page + 1 : null;
    }
    if (page !== null) {
      throw new DeliveryChangeServiceError(
        "delivery_change_history_limit_exceeded",
        "Delivery change history exceeds the bounded OOS scan limit.",
        { statusCode: 502 },
      );
    }
    return events.sort((left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
  }

  async function sourceProjection(recordId, deliveryId, events = null) {
    const source = await openProjectClient.getDeliveryChangeSource({ recordId });
    const history = events ?? await readEvents(recordId);
    return assertDeliveryChangeProjection({
      schema_version: 1,
      delivery_id: deliveryId,
      record_ref: source.deliveryRecordRef,
      source_revision: source.sourceRevision,
      projection_state: "current",
      package: {
        execution_tree: source.executionTree,
        dependency_relations: source.dependencyRelations,
      },
      last_event_ref: history.at(-1)?.event_id ?? null,
      projected_at: clock().toISOString(),
    });
  }

  async function dispatch(command, callerId) {
    const payload = command.operation.payload;
    const note = operationNote(command);
    switch (command.operation.type) {
      case "add_work_item":
        return deliveryService.createDeliveryWorkItem({
          acceptanceCriteria: payload.acceptance_criteria,
          callerId,
          correlationId: command.command_id,
          definitionOfDone: payload.definition_of_done,
          definitionOfReady: payload.definition_of_ready,
          deliveryTeam: payload.delivery_team,
          description: payload.description,
          executionClassification: payload.execution_classification,
          iteration: payload.iteration,
          nfrCategory: payload.nfr_category,
          ownerRepo: payload.owner_repo,
          parentWorkItemId: workItemId(payload.parent_work_item_id),
          status: payload.status,
          subject: payload.subject,
          targetPi: payload.target_pi,
          type: payload.type,
        });
      case "revise_work_item":
        return deliveryService.updateDeliveryWorkItem({
          ...mappedRevisionChanges(payload.changes),
          callerId,
          correlationId: command.command_id,
          workItemId: workItemId(payload.work_item_id),
          workNote: payload.work_note ?? note,
        });
      case "move_work_item":
        return deliveryService.moveDeliveryWorkItem({
          callerId,
          correlationId: command.command_id,
          newParentWorkItemId: workItemId(payload.new_parent_work_item_id),
          workItemId: workItemId(payload.work_item_id),
          workNote: payload.work_note ?? note,
        });
      case "remove_work_item":
        return deliveryService.manageDeliveryParking({
          action: "park",
          callerId,
          correlationId: command.command_id,
          parkDecision: "retire",
          parkReason: payload.retirement_reason,
          retirementReason: payload.retirement_reason,
          workItemId: workItemId(payload.work_item_id),
          workNote: payload.work_note ?? note,
        });
      case "manage_dependency":
        return deliveryService.manageDeliveryDependency({
          action: payload.action,
          callerId,
          clearDescription: payload.clear_description,
          clearLag: payload.clear_lag,
          correlationId: command.command_id,
          dependsOnWorkItemId: workItemId(payload.depends_on_work_item_id),
          description: payload.description,
          lag: payload.lag,
          targetWorkItemId: workItemId(payload.target_work_item_id),
        });
      case "manage_blocker":
        return deliveryService.manageDeliveryBlocker({
          action: payload.action,
          blockerDecisionPath: payload.blocker_decision_path,
          blockerDiscoveredOn: payload.blocker_discovered_on,
          blockerFollowUpOwner: payload.blocker_follow_up_owner,
          blockerImpact: payload.blocker_impact,
          blockerJustification: payload.blocker_justification,
          blockerOwner: payload.blocker_owner,
          blockerReviewDate: payload.blocker_review_date,
          blockerStatement: payload.blocker_statement,
          callerId,
          correlationId: command.command_id,
          resumeStatus: payload.resume_status,
          workItemId: workItemId(payload.work_item_id),
        });
      case "manage_parking":
        return deliveryService.manageDeliveryParking({
          action: payload.action,
          callerId,
          correlationId: command.command_id,
          parkDecision: payload.park_decision,
          parkReason: payload.park_reason,
          parkReviewDate: payload.park_review_date,
          resumeStatus: payload.resume_status,
          workItemId: workItemId(payload.work_item_id),
          workNote: payload.work_note ?? note,
        });
      default:
        return null;
    }
  }

  async function getProjectionInternal({ callerId, deliveryId }) {
    const recordId = parseDeliveryId(deliveryId);
    if (!recordId) return null;
    const projection = await sourceProjection(recordId, deliveryId);
    audit?.emit({
      caller: { id: callerId },
      delivery_id: deliveryId,
      event_type: "delivery.change.projection.read",
      source_revision: projection.source_revision,
      status: "succeeded",
    });
    return projection;
  }

  async function applyCommandInternal({ callerId, command: input, deliveryId }) {
    const command = assertDeliveryChangeCommand(input);
    if (command.delivery_id !== deliveryId) {
      throw new DeliveryChangeServiceError(
        "delivery_change_target_mismatch",
        "Command Delivery identity does not match the requested initiative.",
      );
    }
    const recordId = parseDeliveryId(deliveryId);
    if (!recordId) return null;
    const events = await readEvents(recordId);
    const commandDigest = canonicalDigest(command);
    const commandEvents = events.filter(
      (event) => event.command_id === command.command_id,
    );
    if (commandEvents.some((event) => event.command_digest !== commandDigest)) {
      throw new DeliveryChangeServiceError(
        "delivery_change_command_id_conflict",
        "Delivery change command id was already used for another payload.",
        { statusCode: 409 },
      );
    }
    const existing = commandEvents.find((event) => event.status !== "accepted");
    if (existing) {
      return assertDeliveryChangeResult({
        schema_version: 1,
        command_id: command.command_id,
        status: existing.status,
        replayed: true,
        before: { record_ref: `openproject://work_packages/${recordId}`, source_revision: existing.source_revision_before },
        after: { record_ref: `openproject://work_packages/${recordId}`, source_revision: existing.source_revision_after },
        event: existing,
        receipt: existing.receipt,
        next_action: existing.next_action,
      });
    }
    if (commandEvents.length > 0) {
      throw new DeliveryChangeServiceError(
        "delivery_change_reconciliation_required",
        "The command was durably accepted but no terminal result was recorded.",
        {
          details: { intent_event_ref: commandEvents.at(-1).event_id },
          nextAction: {
            code: "inspect_delivery_package",
            label: "Inspect Delivery Package",
            authority: "operator-orchestration-service",
          },
          statusCode: 409,
        },
      );
    }

    const before = await sourceProjection(recordId, deliveryId, events);
    if (command.expected_source_revision !== before.source_revision) {
      throw new DeliveryChangeServiceError(
        "delivery_change_source_revision_stale",
        "Delivery package changed after this command was prepared.",
        {
          details: {
            current_source_revision: before.source_revision,
            expected_source_revision: command.expected_source_revision,
          },
          statusCode: 409,
        },
      );
    }

    const intentReceipt = {
      ref: `oos://delivery-change-intents/${command.command_id}`,
      digest: canonicalDigest({
        command_digest: commandDigest,
        source_revision: before.source_revision,
      }),
    };
    const intent = assertDeliveryChangeEvent({
      schema_version: 1,
      event_id: `delivery-change-event:${command.command_id}:accepted`,
      command_id: command.command_id,
      command_digest: commandDigest,
      delivery_id: deliveryId,
      operation_type: command.operation.type,
      status: "accepted",
      occurred_at: clock().toISOString(),
      operator_id: command.operator.id,
      source_revision_before: before.source_revision,
      source_revision_after: before.source_revision,
      effect: { accepted: true },
      rollback: {
        mode: "not_applicable",
        reason: "No mutation is claimed by the accepted-command event.",
      },
      next_action: {
        code: "apply_delivery_change",
        label: "Apply Delivery Change",
        authority: "operator-orchestration-service",
      },
      receipt: intentReceipt,
    });
    await openProjectClient.addDeliveryChangeEvent({
      raw: encodeDeliveryChangeEvent(intent),
      recordId,
    });

    const acceptedProjection = await sourceProjection(
      recordId,
      deliveryId,
      [...events, intent],
    );
    let effect = {};
    let status = "applied";
    if (acceptedProjection.source_revision !== before.source_revision) {
      status = "rejected";
      effect = {
        code: "delivery_change_source_revision_stale",
        current_source_revision: acceptedProjection.source_revision,
        expected_source_revision: before.source_revision,
      };
    } else if (command.operation.type === "request_repository") {
      status = "routed";
      effect = {
        reason: command.operation.payload.reason,
        suggested_repo_name: command.operation.payload.suggested_repo_name ?? null,
        work_item_id: workItemId(command.operation.payload.work_item_id),
      };
    } else if (command.operation.type === "rollback_change") {
      status = "rejected";
      effect = {
        reason: "No exact automatic inverse is registered for the target event.",
        target_event_ref: command.operation.payload.target_event_ref,
      };
    } else if (command.operation.type === "link_repository") {
      const payload = command.operation.payload;
      let catalogResult = null;
      try {
        catalogResult = await catalogService.mutate({
          callerId,
          catalogItemId: payload.catalog_item_id,
          request: payload.catalog_request,
        });
        const updateResult = await deliveryService.updateDeliveryWorkItem({
          callerId,
          correlationId: command.command_id,
          ownerRepo: payload.owner_repo,
          workItemId: workItemId(payload.work_item_id),
          workNote: payload.work_note ?? operationNote(command),
        });
        effect = { catalog: catalogResult, delivery: updateResult };
      } catch (error) {
        const failure = mapFailure(error);
        status = catalogResult ? "partial_failure" : "rejected";
        effect = {
          ...(catalogResult ? { catalog: catalogResult } : {}),
          error: failure.toResponse(),
        };
      }
    } else {
      try {
        effect = await dispatch(command, callerId);
      } catch (error) {
        status = "rejected";
        effect = { error: mapFailure(error).toResponse() };
      }
      if (!effect && status === "applied") {
        status = "rejected";
        effect = {
          error: new DeliveryChangeServiceError(
            "delivery_change_operation_failed",
            "Delivery change authority did not return a mutation result.",
            { statusCode: 502 },
          ).toResponse(),
        };
      }
    }

    const after = await sourceProjection(recordId, deliveryId, events);
    const nextAction = nextActionFor(status, command.operation.type);
    const receipt = {
      ref: `oos://delivery-change-receipts/${command.command_id}`,
      digest: canonicalDigest({
        command_digest: commandDigest,
        effect,
        source_revision_after: after.source_revision,
        source_revision_before: before.source_revision,
        status,
      }),
    };
    const event = assertDeliveryChangeEvent({
      schema_version: 1,
      event_id: `delivery-change-event:${command.command_id}:result`,
      command_id: command.command_id,
      command_digest: commandDigest,
      delivery_id: deliveryId,
      operation_type: command.operation.type,
      status,
      occurred_at: clock().toISOString(),
      operator_id: command.operator.id,
      source_revision_before: before.source_revision,
      source_revision_after: after.source_revision,
      effect,
      rollback: rollbackFor(status, command.operation.type),
      next_action: nextAction,
      receipt,
    });
    await openProjectClient.addDeliveryChangeEvent({
      raw: encodeDeliveryChangeEvent(event),
      recordId,
    });
    audit?.emit({
      caller: { id: callerId },
      command_id: command.command_id,
      delivery_id: deliveryId,
      event_type: "delivery.change.command.acknowledged",
      operation_type: command.operation.type,
      receipt_ref: receipt.ref,
      status,
    });
    return assertDeliveryChangeResult({
      schema_version: 1,
      command_id: command.command_id,
      status,
      replayed: false,
      before: revisionEvidence(before),
      after: revisionEvidence(after),
      event,
      receipt,
      next_action: nextAction,
    });
  }

  async function getProjection(input) {
    try {
      return await getProjectionInternal(input);
    } catch (error) {
      throw mapFailure(error);
    }
  }

  async function applyCommand(input) {
    try {
      return await applyCommandInternal(input);
    } catch (error) {
      throw mapFailure(error);
    }
  }

  return { applyCommand, getProjection };
}
