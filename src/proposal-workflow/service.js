import { parseIdeaId } from "../idea-model.js";
import { HttpError } from "../errors.js";
import {
  assertProposalCommand,
  assertProposalCommandResult,
  assertProposalEvent,
  assertProposalHistory,
  assertProposalProjection,
} from "./contracts.js";
import { decodeProposalEvent, encodeProposalEvent } from "./event-codec.js";
import {
  applyProposalCommandToState,
  parseProposalRecordVersion,
  parseProposalState,
  proposalCommandReceiptRef,
  proposalEventId,
  proposalEventType,
  proposalRecordVersion,
  proposalStatusAfterCommand,
} from "./state.js";

const MAX_ACTIVITY_PAGES = 20;
const ACTIVITY_PAGE_SIZE = 100;

function boundedObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      ["string", "number", "boolean"].includes(typeof entry)),
  );
}

function sourceIngress(surface) {
  const normalized = String(surface ?? "").toLowerCase();
  if (normalized.includes("console")) {
    return "console";
  }
  if (normalized === "api" || normalized.includes("webhook")) {
    return "api";
  }
  if (
    normalized.includes("telegram") ||
    normalized.includes("agent") ||
    normalized.includes("openclaw")
  ) {
    return "agent";
  }
  return "system";
}

function parseHistoryCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") {
    return 1;
  }
  const match = /^activity-page:([1-9][0-9]*)$/.exec(cursor);
  if (!match) {
    throw new HttpError(
      400,
      "proposal_history_cursor_invalid",
      "Proposal history cursor is invalid.",
    );
  }
  return Number.parseInt(match[1], 10);
}

function commandSummary(command) {
  if (command.command.type === "triage") {
    return command.command.summary.slice(0, 1000);
  }
  return command.command.notes.slice(0, 1000);
}

function buildEvent({ command, occurredAt, recordVersion, receiptRef }) {
  return assertProposalEvent({
    schema_version: 1,
    event_id: proposalEventId(command.proposal_id, command.command_id),
    proposal_id: command.proposal_id,
    record_version: recordVersion,
    event_type: proposalEventType(command),
    status_before: command.source.status,
    status_after: proposalStatusAfterCommand(command),
    actor: {
      kind: "operator",
      id: command.operator.id,
    },
    command_id: command.command_id,
    receipt_refs: [receiptRef],
    summary: commandSummary(command),
    occurred_at: occurredAt,
  });
}

function commandMutationFields(command) {
  if (command.command.type === "triage") {
    return {
      decisionNotes: null,
      status: "triaged",
      triageSummary: command.command.summary,
    };
  }
  if (command.command.type === "disposition") {
    return {
      decisionNotes: command.command.notes,
      status: command.command.outcome,
      triageSummary: null,
    };
  }
  return {
    decisionNotes: null,
    status: "accepted",
    triageSummary: null,
  };
}

function assertCommandBinding({ callerId, command, proposalId }) {
  if (command.proposal_id !== proposalId) {
    throw new HttpError(
      409,
      "proposal_command_target_mismatch",
      "Proposal command target does not match the requested Proposal.",
    );
  }
  if (command.operator.id !== callerId) {
    throw new HttpError(
      403,
      "proposal_operator_binding_mismatch",
      "Proposal command operator must match the authenticated caller.",
    );
  }
}

function assertSourcePrecondition({ command, record }) {
  const currentVersion = proposalRecordVersion(record.lockVersion);
  if (
    command.source.record_ref !== record.recordRef ||
    command.source.record_version !== currentVersion ||
    parseProposalRecordVersion(command.source.record_version) !== record.lockVersion ||
    command.source.status !== record.status
  ) {
    throw new HttpError(
      409,
      "proposal_version_stale",
      "Proposal source state changed; refresh before submitting the command.",
      {
        current_record_ref: record.recordRef,
        current_record_version: currentVersion,
        current_status: record.status,
      },
    );
  }
}

function resultReceipt({ event, projection, receiptRef }) {
  return {
    receipt_ref: receiptRef,
    owner: "operator-orchestration-service",
    record_ref: projection.record_ref,
    record_version: event.record_version,
    recorded_at: event.occurred_at,
  };
}

function acceptedRecordVersion(command) {
  return proposalRecordVersion(
    parseProposalRecordVersion(command.source.record_version) + 1,
  );
}

export function createProposalWorkflowService({ audit, openProjectClient }) {
  let automationUserRefPromise = null;

  async function automationUserRef() {
    automationUserRefPromise ??=
      openProjectClient.getProposalAutomationUserRef();
    return automationUserRefPromise;
  }

  async function parseActivityEvent(activity) {
    const currentUserRef = await automationUserRef();
    if (!currentUserRef || activity.userRef !== currentUserRef) {
      return null;
    }
    const event = decodeProposalEvent(activity.comment);
    if (!event) {
      return null;
    }
    try {
      return assertProposalEvent(event);
    } catch (error) {
      throw new HttpError(
        502,
        "proposal_event_invalid",
        "An OOS-authored Proposal event does not satisfy the event contract.",
        error.details,
      );
    }
  }

  async function readEventPage({ page, recordId }) {
    const activityPage = await openProjectClient.listProposalActivities({
      offset: page,
      pageSize: ACTIVITY_PAGE_SIZE,
      recordId,
    });
    const events = (
      await Promise.all(activityPage.items.map(parseActivityEvent))
    ).filter(Boolean).sort((left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
    const hasMore = page * activityPage.pageSize < activityPage.total;
    return {
      events,
      nextPage: hasMore ? page + 1 : null,
    };
  }

  async function readAllEvents(recordId) {
    const events = [];
    let page = 1;
    for (let index = 0; index < MAX_ACTIVITY_PAGES && page !== null; index += 1) {
      const result = await readEventPage({ page, recordId });
      events.push(...result.events);
      page = result.nextPage;
    }
    if (page !== null) {
      throw new HttpError(
        502,
        "proposal_history_limit_exceeded",
        "Proposal history exceeds the bounded OOS scan limit.",
      );
    }
    return events;
  }

  function projectionFromRecord(record, events = []) {
    if (!Number.isInteger(record.lockVersion)) {
      throw new HttpError(
        502,
        "proposal_record_version_missing",
        "Canonical Proposal record does not expose a lock version.",
      );
    }
    const state = parseProposalState(
      record.workflowState,
      record.updatedAt ?? new Date().toISOString(),
    );
    const lastEvent = events.at(-1) ?? null;
    return assertProposalProjection({
      schema_version: 1,
      proposal_id: record.ideaId,
      record_ref: record.recordRef,
      record_system: "openproject",
      record_project: "workspace-proposals",
      record_version: proposalRecordVersion(record.lockVersion),
      projection_state: "current",
      status: record.status,
      title: record.title,
      body: record.body,
      triage_summary: record.triageSummary,
      decision_notes: record.operatorDecisionNotes,
      route: state.route,
      handoff: state.handoff,
      source: {
        ingress: sourceIngress(record.source?.surface),
        surface: record.source?.surface || "unknown",
        context_ref: boundedObject(record.source?.context_ref),
        native_ref: boundedObject(record.source?.native_ref),
      },
      last_event_ref: lastEvent?.event_id ?? null,
      updated_at: record.updatedAt ?? state.updated_at,
    });
  }

  async function getRecordAndEvents(proposalId) {
    const recordId = parseIdeaId(proposalId);
    const [record, events] = await Promise.all([
      openProjectClient.getIdea(recordId),
      readAllEvents(recordId),
    ]);
    if (!record) {
      throw new HttpError(404, "proposal_not_found", "Proposal was not found.");
    }
    return { events, record, recordId };
  }

  async function getProjection({ callerId, correlationId, proposalId }) {
    const { events, record } = await getRecordAndEvents(proposalId);
    const projection = projectionFromRecord(record, events);
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_type: "proposal.projection.read",
      proposal_id: proposalId,
      record_version: projection.record_version,
      status: "succeeded",
    });
    return projection;
  }

  async function getHistory({ callerId, correlationId, cursor, proposalId }) {
    const recordId = parseIdeaId(proposalId);
    const record = await openProjectClient.getIdea(recordId);
    const page = parseHistoryCursor(cursor);
    const result = await readEventPage({ page, recordId });
    const history = assertProposalHistory({
      schema_version: 1,
      proposal_id: proposalId,
      record_version: proposalRecordVersion(record.lockVersion),
      events: result.events,
      next_cursor: result.nextPage === null
        ? null
        : `activity-page:${result.nextPage}`,
    });
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_count: history.events.length,
      event_type: "proposal.history.read",
      proposal_id: proposalId,
      status: "succeeded",
    });
    return history;
  }

  async function getEvent({ callerId, correlationId, eventId, proposalId }) {
    const recordId = parseIdeaId(proposalId);
    const events = await readAllEvents(recordId);
    const event = events.find((entry) => entry.event_id === eventId);
    if (!event) {
      throw new HttpError(
        404,
        "proposal_event_not_found",
        "Proposal event was not found.",
      );
    }
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_id: eventId,
      event_type: "proposal.event.read",
      proposal_id: proposalId,
      status: "succeeded",
    });
    return event;
  }

  async function applyCommand({ callerId, command, correlationId, proposalId }) {
    assertProposalCommand(command);
    assertCommandBinding({ callerId, command, proposalId });
    const recordId = parseIdeaId(proposalId);
    let record = await openProjectClient.getIdea(recordId);
    const currentState = parseProposalState(
      record.workflowState,
      record.updatedAt ?? new Date().toISOString(),
    );
    const receiptRef = proposalCommandReceiptRef(proposalId, command);
    const existingEvents = await readAllEvents(recordId);
    const existingEvent = existingEvents.find(
      (event) => event.command_id === command.command_id,
    );

    if (existingEvent) {
      if (!existingEvent.receipt_refs.includes(receiptRef)) {
        throw new HttpError(
          409,
          "proposal_command_id_conflict",
          "Proposal command id was already used for a different command payload.",
        );
      }
      const projection = projectionFromRecord(record, existingEvents);
      const history = assertProposalHistory({
        schema_version: 1,
        proposal_id: proposalId,
        record_version: projection.record_version,
        events: existingEvents.slice(-100),
        next_cursor: null,
      });
      return assertProposalCommandResult({
        schema_version: 1,
        command_id: command.command_id,
        replayed: true,
        receipt: resultReceipt({
          event: existingEvent,
          projection,
          receiptRef,
        }),
        projection,
        event: existingEvent,
        history,
      });
    }

    let replayed = false;
    let event;
    if (currentState.last_accepted_command?.command_id === command.command_id) {
      if (!currentState.receipt_refs.includes(receiptRef)) {
        throw new HttpError(
          409,
          "proposal_command_id_conflict",
          "Proposal command id was already used for a different command payload.",
        );
      }
      replayed = true;
      event = buildEvent({
        command,
        occurredAt: currentState.last_accepted_command.accepted_at,
        receiptRef,
        recordVersion: acceptedRecordVersion(command),
      });
    } else {
      assertSourcePrecondition({ command, record });
      const acceptedAt = new Date().toISOString();
      const workflowState = applyProposalCommandToState({
        acceptedAt,
        command,
        currentState,
        receiptRef,
      });
      const mutation = commandMutationFields(command);
      record = await openProjectClient.applyProposalWorkflowMutation({
        currentRecord: record,
        decisionNotes: mutation.decisionNotes,
        expectedLockVersion: record.lockVersion,
        recordId,
        status: mutation.status,
        triageSummary: mutation.triageSummary,
        workflowState,
      });
      if (proposalRecordVersion(record.lockVersion) !== acceptedRecordVersion(command)) {
        throw new HttpError(
          502,
          "proposal_record_version_unexpected",
          "Canonical Proposal mutation returned an unexpected record version.",
        );
      }
      event = buildEvent({
        command,
        occurredAt: acceptedAt,
        receiptRef,
        recordVersion: proposalRecordVersion(record.lockVersion),
      });
    }

    await openProjectClient.addProposalEvent({
      raw: encodeProposalEvent(event),
      recordId,
    });
    const finalEvents = [...existingEvents, event].sort((left, right) =>
      left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
    const projection = projectionFromRecord(record, finalEvents);
    const history = assertProposalHistory({
      schema_version: 1,
      proposal_id: proposalId,
      record_version: projection.record_version,
      events: finalEvents.slice(-100),
      next_cursor: null,
    });
    const result = assertProposalCommandResult({
      schema_version: 1,
      command_id: command.command_id,
      replayed,
      receipt: resultReceipt({ event, projection, receiptRef }),
      projection,
      event,
      history,
    });
    audit?.emit({
      caller: { id: callerId },
      command_id: command.command_id,
      command_type: command.command.type,
      correlation_id: correlationId,
      event_type: "proposal.command.acknowledged",
      proposal_id: proposalId,
      receipt_ref: receiptRef,
      replayed,
      status: "succeeded",
    });
    return result;
  }

  return {
    applyCommand,
    getEvent,
    getHistory,
    getProjection,
  };
}
