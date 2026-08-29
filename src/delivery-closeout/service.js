import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { parseDeliveryId } from "../delivery-model.js";
import { HttpError, OpenProjectError } from "../errors.js";
import {
  assertDeliveryCloseoutCommand,
  assertDeliveryCloseoutError,
  assertDeliveryCloseoutEvent,
  assertDeliveryCloseoutProjection,
  assertDeliveryCloseoutResult,
} from "./contracts.js";
import {
  decodeDeliveryCloseoutEvent,
  encodeDeliveryCloseoutEvent,
} from "./event-codec.js";

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 20;
const COMMAND_IDENTITY_VERSION = "delivery-closeout-semantic-v1";

export class DeliveryCloseoutServiceError extends Error {
  constructor(code, message, {
    details = null,
    nextAction = {
      code: "refresh_delivery_closeout",
      label: "Refresh Delivery Closeout",
      authority: "operator-orchestration-service",
    },
    retryable = false,
    statusCode = 400,
  } = {}) {
    super(message);
    this.name = "DeliveryCloseoutServiceError";
    this.code = code;
    this.details = details;
    this.nextAction = nextAction;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }

  toResponse() {
    return assertDeliveryCloseoutError({
      schema_version: 1,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === null ? {} : { details: this.details }),
      next_action: this.nextAction,
    });
  }
}

function mapFailure(error) {
  if (error instanceof DeliveryCloseoutServiceError) return error;
  if (error instanceof HttpError) {
    return new DeliveryCloseoutServiceError(error.code, error.message, {
      details: error.details,
      statusCode: error.statusCode,
    });
  }
  if (error instanceof OpenProjectError) {
    const conflict = ["update_conflict", "validation_failure"].includes(
      error.errorClass,
    );
    return new DeliveryCloseoutServiceError(
      error.code ?? error.errorClass,
      error.message,
      {
        details: error.details,
        retryable: error.errorClass === "backend_unavailable",
        statusCode: conflict ? 409 : error.errorClass === "not_found" ? 404 : 502,
      },
    );
  }
  return new DeliveryCloseoutServiceError(
    "delivery_closeout_dependency_failed",
    "Delivery closeout could not be completed by its owning authority.",
    { retryable: true, statusCode: 502 },
  );
}

function revisionEvidence(projection) {
  return {
    record_ref: projection.record_ref,
    source_revision: projection.source_revision,
  };
}

function commandIdentityDigest(command) {
  const { accepted_at: _acceptedAt, ...acceptedDecision } = command.acceptance;
  return canonicalDigest({
    ...command,
    acceptance: acceptedDecision,
  });
}

function eventUsesSemanticCommandIdentity(event) {
  return event.effect?.command_identity_version === COMMAND_IDENTITY_VERSION;
}

function collectRecordRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectRecordRefs(entry, refs);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (
        ["record_ref", "recordRef", "work_item_record_ref"].includes(key) &&
        typeof entry === "string" &&
        entry.length > 0
      ) {
        refs.add(entry);
      } else {
        collectRecordRefs(entry, refs);
      }
    }
  }
  return refs;
}

function count(summary, key) {
  const value = summary?.[key];
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeReadiness(readiness, recordRef, sourceRevision) {
  const summary = readiness?.summary ?? {};
  const evidenceRefs = collectRecordRefs([
    readiness?.blocked_items,
    readiness?.completed_with_weak_evidence,
    readiness?.completed_with_weak_done_narrative,
    readiness?.completed_without_evidence,
    readiness?.completed_without_owner,
    readiness?.open_descendants,
  ]);
  const readinessRef = `${recordRef}#closeout-readiness@${sourceRevision}`;
  evidenceRefs.add(readinessRef);
  return {
    readiness_ref: readinessRef,
    ready_for_closing: readiness?.ready_for_closing === true,
    ready_for_closeout: readiness?.ready_for_closeout === true,
    reasons: [...new Set([
      ...(Array.isArray(readiness?.closing_reasons)
        ? readiness.closing_reasons
        : []),
      ...(Array.isArray(readiness?.reasons) ? readiness.reasons : []),
    ].filter((reason) => typeof reason === "string" && reason.length > 0))],
    counts: {
      blocked: count(summary, "blocked_count"),
      open_descendants: count(summary, "open_descendant_count"),
      weak_evidence: count(summary, "completed_with_weak_evidence_count"),
      weak_done_narrative: count(
        summary,
        "completed_with_weak_done_narrative_count",
      ),
      without_evidence: count(summary, "completed_without_evidence_count"),
      without_owner: count(summary, "completed_without_owner_count"),
    },
    evidence_refs: [...evidenceRefs].sort(),
  };
}

function terminalEventFor(events, commandId) {
  return events.find(
    (event) => event.command_id === commandId && event.status !== "accepted",
  );
}

function hasUnfinishedAcceptance(events) {
  return events.some(
    (event) =>
      event.status === "accepted" && !terminalEventFor(events, event.command_id),
  );
}

function projectionNextAction({ events, packageStatus, readiness }) {
  if (hasUnfinishedAcceptance(events)) {
    return {
      code: "reconcile_delivery_closeout",
      label: "Reconcile Delivery Closeout",
      authority: "operator-orchestration-service",
    };
  }
  const lastTerminal = [...events].reverse().find((event) => event.status !== "accepted");
  if (lastTerminal?.status === "partial_failure") return lastTerminal.next_action;
  if (["done", "closed", "implemented"].includes(packageStatus.toLowerCase())) {
    return {
      code: "inspect_delivery_outcome_history",
      label: "Inspect Outcome History",
      authority: "operator-orchestration-service",
    };
  }
  if (readiness.ready_for_closeout) {
    return {
      code: "prepare_delivery_closeout",
      label: "Prepare Delivery Closeout",
      authority: "governance-operations-console",
    };
  }
  return {
    code: "resolve_delivery_closeout_gates",
    label: "Resolve Closeout Gates",
    authority: "workspace-delivery-art",
  };
}

function projectionState({ events, packageStatus, readiness }) {
  if (hasUnfinishedAcceptance(events)) return "reconciliation_required";
  if (["done", "closed", "implemented"].includes(packageStatus.toLowerCase())) {
    return "closed";
  }
  return readiness.ready_for_closeout ? "ready" : "not_ready";
}

function resultNextAction(status, impact) {
  if (status === "partial_failure") {
    return {
      code: "reconcile_source_closeout",
      label: "Reconcile Source Closeout",
      authority: "operator-orchestration-service",
    };
  }
  if (status === "rejected") {
    return {
      code: "reconcile_delivery_closeout",
      label: "Reconcile Delivery Closeout",
      authority: "operator-orchestration-service",
    };
  }
  if (impact.kind === "workspace_entrant") {
    return {
      code: "open_workspace_intake",
      label: "Open Workspace Intake",
      authority: "workspace-governance",
    };
  }
  if (impact.kind === "existing_product_change") {
    return {
      code: "handoff_product_outcome",
      label: "Handoff Product Outcome",
      authority: "product-owner",
    };
  }
  return {
    code: "inspect_delivery_outcome_history",
    label: "Inspect Outcome History",
    authority: "operator-orchestration-service",
  };
}

export function createDeliveryCloseoutService({
  audit = null,
  clock = () => new Date(),
  deliveryService,
  openProjectClient,
} = {}) {
  let automationUserRefPromise = null;
  const inFlightCommands = new Map();

  async function automationUserRef() {
    automationUserRefPromise ??=
      openProjectClient.getDeliveryCloseoutAutomationUserRef();
    return automationUserRefPromise;
  }

  async function readEvents(recordId) {
    const events = [];
    const userRef = await automationUserRef();
    let page = 1;
    for (let index = 0; index < MAX_ACTIVITY_PAGES && page !== null; index += 1) {
      const result = await openProjectClient.listDeliveryCloseoutActivities({
        offset: page,
        pageSize: ACTIVITY_PAGE_SIZE,
        recordId,
      });
      for (const activity of result.items) {
        if (!userRef || activity.userRef !== userRef) continue;
        const decoded = decodeDeliveryCloseoutEvent(activity.comment);
        if (!decoded) continue;
        try {
          events.push(assertDeliveryCloseoutEvent(decoded));
        } catch {
          throw new DeliveryCloseoutServiceError(
            "delivery_closeout_event_invalid",
            "An OOS-authored Delivery closeout event is invalid.",
            { statusCode: 502 },
          );
        }
      }
      page = page * result.pageSize < result.total ? page + 1 : null;
    }
    if (page !== null) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_history_limit_exceeded",
        "Delivery closeout history exceeds the bounded OOS scan limit.",
        { statusCode: 502 },
      );
    }
    return events.sort((left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
  }

  async function sourceProjection({
    callerId,
    correlationId,
    deliveryId,
    events = null,
    recordId,
  }) {
    const [source, readinessProjection] = await Promise.all([
      openProjectClient.getDeliveryChangeSource({ recordId }),
      deliveryService.getDeliveryCloseoutReadiness({
        callerId,
        correlationId,
        deliveryId,
      }),
    ]);
    if (!readinessProjection) return null;
    const history = events ?? await readEvents(recordId);
    const readiness = normalizeReadiness(
      readinessProjection.closeout_readiness,
      source.deliveryRecordRef,
      source.sourceRevision,
    );
    const packageStatus =
      readinessProjection.closeout_readiness?.epic?.status ??
      source.executionTree.status;
    const packageSubject =
      readinessProjection.closeout_readiness?.epic?.subject ??
      source.executionTree.subject;
    return assertDeliveryCloseoutProjection({
      schema_version: 1,
      delivery_id: deliveryId,
      record_ref: source.deliveryRecordRef,
      source_revision: source.sourceRevision,
      projection_state: projectionState({
        events: history,
        packageStatus,
        readiness,
      }),
      package: {
        subject: packageSubject,
        status: packageStatus,
      },
      readiness,
      outcome_history: history,
      last_event_ref: history.at(-1)?.event_id ?? null,
      next_action: projectionNextAction({
        events: history,
        packageStatus,
        readiness,
      }),
      projected_at: clock().toISOString(),
    });
  }

  async function getProjectionInternal({ callerId, correlationId, deliveryId }) {
    const recordId = parseDeliveryId(deliveryId);
    if (!recordId) return null;
    const projection = await sourceProjection({
      callerId,
      correlationId: correlationId ?? `delivery-closeout-read:${deliveryId}`,
      deliveryId,
      recordId,
    });
    audit?.emit({
      caller: { id: callerId },
      delivery_id: deliveryId,
      event_type: "delivery.closeout.projection.read",
      source_revision: projection.source_revision,
      status: projection.projection_state,
    });
    return projection;
  }

  async function applyCommandInternal({ callerId, command: input, deliveryId }) {
    const command = assertDeliveryCloseoutCommand(input);
    if (command.delivery_id !== deliveryId) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_target_mismatch",
        "Command Delivery identity does not match the requested initiative.",
      );
    }
    const recordId = parseDeliveryId(deliveryId);
    if (!recordId) return null;
    const events = await readEvents(recordId);
    const commandDigest = commandIdentityDigest(command);
    const commandEvents = events.filter(
      (event) => event.command_id === command.command_id,
    );
    const digestMismatch = commandEvents.some(
      (event) => event.command_digest !== commandDigest,
    );
    if (
      digestMismatch &&
      commandEvents.some(eventUsesSemanticCommandIdentity)
    ) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_command_id_conflict",
        "Delivery closeout command id was already used for another payload.",
        { statusCode: 409 },
      );
    }
    if (digestMismatch) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_reconciliation_required",
        "The closeout command predates semantic replay identity and requires explicit reconciliation.",
        {
          details: { command_id: command.command_id },
          nextAction: {
            code: "reconcile_delivery_closeout",
            label: "Reconcile Delivery Closeout",
            authority: "operator-orchestration-service",
          },
          statusCode: 409,
        },
      );
    }
    const existing = commandEvents.find((event) => event.status !== "accepted");
    if (existing) {
      return assertDeliveryCloseoutResult({
        schema_version: 1,
        command_id: command.command_id,
        status: existing.status,
        replayed: true,
        before: {
          record_ref: `openproject://work_packages/${recordId}`,
          source_revision: existing.source_revision_before,
        },
        after: {
          record_ref: `openproject://work_packages/${recordId}`,
          source_revision: existing.source_revision_after,
        },
        event: existing,
        receipt: existing.receipt,
        next_action: existing.next_action,
      });
    }
    if (commandEvents.length > 0) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_reconciliation_required",
        "The closeout command was durably accepted but no terminal result was recorded.",
        {
          details: { intent_event_ref: commandEvents.at(-1).event_id },
          nextAction: {
            code: "reconcile_delivery_closeout",
            label: "Reconcile Delivery Closeout",
            authority: "operator-orchestration-service",
          },
          statusCode: 409,
        },
      );
    }

    const before = await sourceProjection({
      callerId,
      correlationId: command.command_id,
      deliveryId,
      events,
      recordId,
    });
    if (command.expected_source_revision !== before.source_revision) {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_source_revision_stale",
        "Delivery package changed after this closeout was prepared.",
        {
          details: {
            current_source_revision: before.source_revision,
            expected_source_revision: command.expected_source_revision,
          },
          statusCode: 409,
        },
      );
    }
    if (before.projection_state !== "ready") {
      throw new DeliveryCloseoutServiceError(
        "delivery_closeout_not_ready",
        "Delivery closeout gates are not ready for a terminal mutation.",
        {
          details: {
            projection_state: before.projection_state,
            reasons: before.readiness.reasons,
          },
          nextAction: before.next_action,
          statusCode: 409,
        },
      );
    }

    const impact = structuredClone(command.operation.payload.impact);
    const outcomeRef = `oos://delivery-closeout-outcomes/${command.command_id}`;
    const intentReceipt = {
      ref: `oos://delivery-closeout-intents/${command.command_id}`,
      digest: canonicalDigest({
        command_digest: commandDigest,
        source_revision: before.source_revision,
      }),
    };
    const intent = assertDeliveryCloseoutEvent({
      schema_version: 1,
      event_id: `delivery-closeout-event:${command.command_id}:accepted`,
      command_id: command.command_id,
      command_digest: commandDigest,
      delivery_id: deliveryId,
      operation_type: "apply_closeout",
      status: "accepted",
      occurred_at: clock().toISOString(),
      operator_id: command.operator.id,
      source_revision_before: before.source_revision,
      source_revision_after: before.source_revision,
      outcome_ref: outcomeRef,
      impact,
      effect: {
        accepted: true,
        command_identity_version: COMMAND_IDENTITY_VERSION,
      },
      next_action: {
        code: "apply_delivery_closeout",
        label: "Apply Delivery Closeout",
        authority: "operator-orchestration-service",
      },
      receipt: intentReceipt,
    });
    await openProjectClient.addDeliveryCloseoutEvent({
      raw: encodeDeliveryCloseoutEvent(intent),
      recordId,
    });

    const acceptedProjection = await sourceProjection({
      callerId,
      correlationId: command.command_id,
      deliveryId,
      events: [...events, intent],
      recordId,
    });
    let effect;
    let status;
    if (acceptedProjection.source_revision !== before.source_revision) {
      status = "rejected";
      effect = {
        error: new DeliveryCloseoutServiceError(
          "delivery_closeout_source_revision_stale",
          "Delivery package changed after closeout acceptance was recorded.",
          { statusCode: 409 },
        ).toResponse(),
      };
    } else {
      const evidence = command.operation.payload.evidence;
      try {
        const closeout = await deliveryService.closeDeliveryInitiative({
          actionItems: evidence.inspect_action_items,
          callerId,
          changedSurfaces: evidence.changed_surfaces,
          completionNote: evidence.completion_note,
          completionSummary: evidence.completion_summary,
          correlationId: command.command_id,
          deliveryId,
          demoDate: evidence.demo_date ?? clock().toISOString().slice(0, 10),
          demoEvidence: evidence.demo_evidence,
          demoFollowUp: evidence.demo_follow_up,
          demoOutcome: evidence.demo_outcome,
          demoSummary: evidence.demo_summary,
          inspectDate: evidence.inspect_date ?? clock().toISOString().slice(0, 10),
          inspectFollowUp: evidence.inspect_follow_up,
          inspectSummary: evidence.inspect_summary,
          residualFollowUp: evidence.residual_follow_up,
          testResultEvidence: evidence.test_result_evidence,
          validationEvidence: evidence.validation_evidence,
        });
        if (!closeout) {
          status = "rejected";
          effect = {
            error: new DeliveryCloseoutServiceError(
              "delivery_closeout_target_missing",
              "Delivery closeout authority did not return the target initiative.",
              { statusCode: 404 },
            ).toResponse(),
          };
        } else {
          status = closeout.source_closeout_status === "source_closeout_pending"
            ? "partial_failure"
            : "applied";
          effect = {
            closeout,
            evidence_refs: [...evidence.evidence_refs],
          };
        }
      } catch (error) {
        status = "rejected";
        effect = { error: mapFailure(error).toResponse() };
      }
    }

    effect = {
      ...effect,
      command_identity_version: COMMAND_IDENTITY_VERSION,
    };
    const after = await sourceProjection({
      callerId,
      correlationId: command.command_id,
      deliveryId,
      events: [...events, intent],
      recordId,
    });
    const nextAction = resultNextAction(status, impact);
    const receipt = {
      ref: `oos://delivery-closeout-receipts/${command.command_id}`,
      digest: canonicalDigest({
        command_digest: commandDigest,
        effect,
        impact,
        outcome_ref: outcomeRef,
        source_revision_after: after.source_revision,
        source_revision_before: before.source_revision,
        status,
      }),
    };
    const event = assertDeliveryCloseoutEvent({
      schema_version: 1,
      event_id: `delivery-closeout-event:${command.command_id}:result`,
      command_id: command.command_id,
      command_digest: commandDigest,
      delivery_id: deliveryId,
      operation_type: "apply_closeout",
      status,
      occurred_at: clock().toISOString(),
      operator_id: command.operator.id,
      source_revision_before: before.source_revision,
      source_revision_after: after.source_revision,
      outcome_ref: outcomeRef,
      impact,
      effect,
      next_action: nextAction,
      receipt,
    });
    await openProjectClient.addDeliveryCloseoutEvent({
      raw: encodeDeliveryCloseoutEvent(event),
      recordId,
    });
    audit?.emit({
      caller: { id: callerId },
      command_id: command.command_id,
      delivery_id: deliveryId,
      event_type: "delivery.closeout.command.acknowledged",
      outcome_ref: outcomeRef,
      receipt_ref: receipt.ref,
      status,
    });
    return assertDeliveryCloseoutResult({
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
    const deliveryId = input?.deliveryId;
    const execute = async () => {
      try {
        return await applyCommandInternal(input);
      } catch (error) {
        throw mapFailure(error);
      }
    };
    const active = inFlightCommands.get(deliveryId);
    if (active) {
      try {
        await active;
      } catch {
        // Durable closeout events, not the prior process promise, decide replay.
      }
      return execute();
    }
    const operation = execute();
    inFlightCommands.set(deliveryId, operation);
    try {
      return await operation;
    } finally {
      if (inFlightCommands.get(deliveryId) === operation) {
        inFlightCommands.delete(deliveryId);
      }
    }
  }

  return { applyCommand, getProjection };
}
