import {
  assertLifecycleTransitionEvent,
  assertLifecycleTransitionProjection,
  assertLifecycleTransitionRequest,
  lifecycleTransitionDigest,
  lifecycleTransitionError,
  lifecycleTransitionEventDigest,
  lifecycleTransitionId,
  lifecycleTransitionReference,
  lifecycleTransitionRoutes,
  lifecycleTransitionStates,
  lifecycleTransitionTerminalStates,
  parseBoundedLimit,
} from "./contracts.js";
import { createConsoleSourceProjection } from "../console-source-authority.js";

const NEXT_ACTION = {
  prepared: "start-validation",
  validating: "complete-validation",
  "awaiting-authority": "record-authority-decision",
  "awaiting-admission": "record-admission",
  authorized: "start-application",
  applying: "complete-application",
  blocked: "resolve-gate",
  returned: "correct-source",
  deferred: "review-deferred-transition",
  rejected: "review-rejection",
  failed: "retry-application",
};

const EVENT_AUTHORITY = {
  "validation-started": ["validation-authority", "validation_owner_ref"],
  "validation-completed": ["validation-authority", "validation_owner_ref"],
  "authority-decision-recorded": ["decision-authority", null],
  "target-admission-recorded": ["target-domain", "target_admission_owner_ref"],
  "application-started": ["orchestration", "execution_owner_ref"],
  "target-application-recorded": ["target-adapter", "target_application_owner_ref"],
  "application-failed": ["orchestration", "execution_owner_ref"],
  "gate-blocked": ["validation-authority", "validation_owner_ref"],
  "source-correction-returned": ["source-domain", "intent_owner_ref"],
  "transition-deferred": ["source-domain", "intent_owner_ref"],
  "transition-cancelled": ["source-domain", "intent_owner_ref"],
  "transition-superseded": ["orchestration", "execution_owner_ref"],
};

export function createLifecycleTransitionService({
  audit = null,
  clock = () => new Date(),
  store,
  writerBindings = {},
}) {
  function assertWriter(callerId, ownerRef) {
    const owners = writerBindings[callerId] ?? [];
    if (!owners.includes(ownerRef)) {
      throw lifecycleTransitionError(
        "writer_forbidden",
        `Caller is not authorized to write as ${ownerRef}.`,
        403,
      );
    }
  }

  async function create({ callerId, correlationId, request }) {
    assertLifecycleTransitionRequest(request);
    assertWriter(callerId, request.source.owner_ref);
    if (request.requested_by !== callerId) {
      throw lifecycleTransitionError(
        "requester_mismatch",
        "Lifecycle Transition requester must match the authenticated caller.",
        403,
      );
    }
    const transitionId = lifecycleTransitionId(request);
    const bindingDigest = lifecycleTransitionDigest(request);
    const createdAt = clock().toISOString();

    const result = await store.transact((transaction) => {
      const existing = transaction.findByIdempotency(request.idempotency_key);
      if (existing) {
        if (
          existing.transition_id !== transitionId ||
          existing.binding_digest !== bindingDigest
        ) {
          throw lifecycleTransitionError(
            "idempotency_conflict",
            "Lifecycle Transition idempotency key is bound to different input.",
          );
        }
        return { record: existing, replayed: true };
      }

      if (request.supersedes_transition_id) {
        const superseded = transaction.get(request.supersedes_transition_id);
        if (!superseded) {
          throw lifecycleTransitionError(
            "superseded_transition_not_found",
            "The transition being superseded was not found.",
            404,
          );
        }
        if (
          superseded.request.source.record_id !== request.source.record_id ||
          superseded.request.route_id !== request.route_id
        ) {
          throw lifecycleTransitionError(
            "supersession_binding_mismatch",
            "A transition may supersede only the same source record and route.",
          );
        }
        if (lifecycleTransitionTerminalStates.has(projectRecord(superseded).state)) {
          throw lifecycleTransitionError(
            "supersession_terminal",
            "A terminal Lifecycle Transition cannot be superseded.",
          );
        }
        const supersedingEvent = buildStoredEvent({
          event: {
            schema_version: 1,
            event_id: `superseded-by:${transitionId}`,
            expected_sequence: superseded.events.at(-1).sequence,
            artifact_kind: "transition-superseded",
            authority: {
              owner_ref: lifecycleTransitionRoutes[request.route_id].execution_owner_ref,
              role: "orchestration",
            },
            evidence_refs: request.evidence_refs,
            recorded_at: createdAt,
            details: { superseding_transition_id: transitionId },
          },
          sequence: superseded.events.at(-1).sequence + 1,
        });
        superseded.events.push(supersedingEvent);
        superseded.updated_at = createdAt;
        transaction.put(superseded);
      }

      const initialEvent = buildStoredEvent({
        event: {
          schema_version: 1,
          event_id: `prepared:${transitionId}`,
          expected_sequence: 0,
          artifact_kind: "source-packet-prepared",
          authority: {
            owner_ref: request.source.owner_ref,
            role: "source-domain",
          },
          evidence_refs: request.evidence_refs,
          recorded_at: createdAt,
          details: {},
        },
        sequence: 0,
      });
      const record = {
        schema_version: 1,
        transition_id: transitionId,
        binding_digest: bindingDigest,
        request: structuredClone(request),
        created_at: createdAt,
        updated_at: createdAt,
        events: [initialEvent],
      };
      transaction.put(record);
      return { record, replayed: false };
    });

    const projection = sourceProjection(result.record, clock());
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_type: result.replayed
        ? "lifecycle_transition.request.replayed"
        : "lifecycle_transition.request.acknowledged",
      route_id: request.route_id,
      transition_id: transitionId,
      status: "succeeded",
    });
    return { replayed: result.replayed, transition: projection };
  }

  async function append({ callerId, correlationId, event, transitionId }) {
    assertLifecycleTransitionEvent(event);
    const result = await store.transact((transaction) => {
      const record = transaction.get(transitionId);
      if (!record) {
        throw lifecycleTransitionError(
          "not_found",
          "Lifecycle Transition was not found.",
          404,
        );
      }
      const route = lifecycleTransitionRoutes[record.request.route_id];
      assertEventAuthority({ callerId, event, route, assertWriter });
      const replay = record.events.find((entry) => entry.event_id === event.event_id);
      if (replay) {
        if (replay.input_digest !== lifecycleTransitionDigest(event)) {
          throw lifecycleTransitionError(
            "event_replay_conflict",
            "Lifecycle Transition event id is bound to different input.",
          );
        }
        return { record, replayed: true };
      }
      const currentSequence = record.events.at(-1).sequence;
      if (event.expected_sequence !== currentSequence) {
        throw lifecycleTransitionError(
          "revision_conflict",
          "Lifecycle Transition changed; refresh before appending the event.",
          409,
          { current_sequence: currentSequence },
        );
      }
      const current = projectRecord(record);
      assertEventTransition({ current, event, route });
      if (Date.parse(event.recorded_at) < Date.parse(record.updated_at)) {
        throw lifecycleTransitionError(
          "event_time_regression",
          "Lifecycle Transition event time cannot move backward.",
        );
      }
      const stored = buildStoredEvent({ event, sequence: currentSequence + 1 });
      record.events.push(stored);
      record.updated_at = event.recorded_at;
      transaction.put(record);
      return { record, replayed: false };
    });
    const projection = sourceProjection(result.record, clock());
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_id: event.event_id,
      event_type: result.replayed
        ? "lifecycle_transition.event.replayed"
        : "lifecycle_transition.event.recorded",
      transition_id: transitionId,
      status: "succeeded",
    });
    return { replayed: result.replayed, transition: projection };
  }

  async function get({ callerId, correlationId, transitionId }) {
    const record = await store.get(transitionId);
    if (!record) {
      throw lifecycleTransitionError(
        "not_found",
        "Lifecycle Transition was not found.",
        404,
      );
    }
    const projection = sourceProjection(record, clock());
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_type: "lifecycle_transition.read",
      transition_id: transitionId,
      status: "succeeded",
    });
    return projection;
  }

  async function list({ callerId, correlationId, cursor, filters = {}, limit }) {
    const pageSize = parseBoundedLimit(limit);
    const offset = parseListCursor(cursor);
    if (filters.routeId && !lifecycleTransitionRoutes[filters.routeId]) {
      throw lifecycleTransitionError("filter_invalid", "Lifecycle Transition route filter is invalid.", 400);
    }
    if (filters.state && !lifecycleTransitionStates.has(filters.state)) {
      throw lifecycleTransitionError("filter_invalid", "Lifecycle Transition state filter is invalid.", 400);
    }
    let records = await store.list();
    records = records.filter((record) => {
      const projection = projectRecord(record);
      return (!filters.routeId || record.request.route_id === filters.routeId) &&
        (!filters.sourceRecordId || record.request.source.record_id === filters.sourceRecordId) &&
        (!filters.state || projection.state === filters.state);
    }).sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) ||
      left.transition_id.localeCompare(right.transition_id));
    const page = records.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const result = {
      schema_version: 1,
      transitions: page.map((record) => sourceProjection(record, clock())),
      next_cursor: nextOffset < records.length
        ? `transition-list:${nextOffset}`
        : null,
    };
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_type: "lifecycle_transition.list",
      result_count: result.transitions.length,
      status: "succeeded",
    });
    return result;
  }

  async function history({ callerId, correlationId, cursor, limit, transitionId }) {
    const record = await store.get(transitionId);
    if (!record) {
      throw lifecycleTransitionError(
        "not_found",
        "Lifecycle Transition was not found.",
        404,
      );
    }
    const pageSize = parseBoundedLimit(limit);
    const before = parseHistoryCursor(cursor, record.events.length);
    const start = Math.max(0, before - pageSize);
    const events = record.events.slice(start, before).reverse();
    const result = {
      schema_version: 1,
      transition_id: transitionId,
      entries: events.map(historyEntry),
      next_cursor: start > 0 ? `history-before:${start}` : null,
    };
    audit?.emit({
      caller: { id: callerId },
      correlation_id: correlationId,
      event_type: "lifecycle_transition.history.read",
      result_count: result.entries.length,
      transition_id: transitionId,
      status: "succeeded",
    });
    return result;
  }

  return { append, create, get, history, list };
}

function buildStoredEvent({ event, sequence }) {
  const stored = {
    ...structuredClone(event),
    sequence,
    input_digest: lifecycleTransitionDigest(event),
  };
  return {
    ...stored,
    event_digest: lifecycleTransitionEventDigest(stored),
  };
}

function assertEventAuthority({ callerId, event, route, assertWriter }) {
  const [role, ownerField] = EVENT_AUTHORITY[event.artifact_kind] ?? [];
  if (event.authority.role !== role) {
    throw lifecycleTransitionError(
      "authority_role_invalid",
      "Lifecycle Transition event authority role is invalid for this event.",
      403,
    );
  }
  const expectedOwner = ownerField
    ? route[ownerField]
    : event.details.decision?.authority_owner_ref;
  if (!expectedOwner || event.authority.owner_ref !== expectedOwner) {
    throw lifecycleTransitionError(
      "authority_owner_invalid",
      "Lifecycle Transition event authority owner is invalid for this route.",
      403,
    );
  }
  assertWriter(callerId, expectedOwner);
}

function assertEventTransition({ current, event, route }) {
  if (lifecycleTransitionTerminalStates.has(current.state)) {
    throw lifecycleTransitionError(
      "terminal",
      "Terminal Lifecycle Transition cannot accept more events.",
    );
  }
  const allowed = {
    "validation-started": ["prepared", "blocked", "returned", "deferred", "rejected"],
    "validation-completed": ["validating"],
    "authority-decision-recorded": ["awaiting-authority"],
    "target-admission-recorded": ["awaiting-admission"],
    "application-started": ["authorized", "failed"],
    "target-application-recorded": ["applying"],
    "application-failed": ["applying"],
    "gate-blocked": ["validating", "awaiting-authority", "awaiting-admission", "authorized", "applying"],
    "source-correction-returned": ["validating", "awaiting-authority", "awaiting-admission", "blocked", "rejected"],
    "transition-deferred": [
      "prepared", "validating", "awaiting-authority", "awaiting-admission",
      "authorized", "applying", "blocked", "returned", "rejected", "failed",
    ],
    "transition-cancelled": [
      "prepared", "validating", "awaiting-authority", "awaiting-admission",
      "authorized", "applying", "blocked", "returned", "deferred", "rejected", "failed",
    ],
    "transition-superseded": [
      "prepared", "validating", "awaiting-authority", "awaiting-admission",
      "authorized", "applying", "blocked", "returned", "deferred", "rejected", "failed",
    ],
  }[event.artifact_kind] ?? [];
  if (!allowed.includes(current.state)) {
    throw lifecycleTransitionError(
      "event_order_invalid",
      `${event.artifact_kind} cannot follow ${current.state}.`,
    );
  }
  if (
    event.artifact_kind === "target-application-recorded" &&
    event.details.application.evidence_kind !== route.completion_evidence
  ) {
    throw lifecycleTransitionError(
      "completion_evidence_invalid",
      "Applied Lifecycle Transition must carry the route's required completion evidence.",
    );
  }
  if (
    event.artifact_kind === "source-correction-returned" &&
    event.details.correction.owner_ref !== route.intent_owner_ref
  ) {
    throw lifecycleTransitionError(
      "correction_owner_invalid",
      "Returned source correction must be owned by the locked route intent owner.",
    );
  }
}

function sourceProjection(record, now) {
  const projection = projectRecord(record);
  const envelope = createConsoleSourceProjection({
    eventSequence: record.events.at(-1).sequence,
    observedAt: now.toISOString(),
    projection,
    recordRef: lifecycleTransitionReference(record.transition_id),
    sourceOwner: "operator-orchestration-service",
    sourceRef: `lifecycle-source://${record.request.route_id}/${encodeURIComponent(record.request.source.record_id)}`,
    sourceRevision: lifecycleTransitionDigest(record.events),
  });
  return assertLifecycleTransitionProjection(envelope);
}

function projectRecord(record) {
  const route = lifecycleTransitionRoutes[record.request.route_id];
  const projection = {
    transition_id: record.transition_id,
    route_id: record.request.route_id,
    state: "prepared",
    correlation_id: record.request.correlation_id,
    idempotency_key: record.request.idempotency_key,
    source: {
      domain: route.source_domain,
      owner_ref: record.request.source.owner_ref,
      projection_version: record.request.source.projection_version,
      record_id: record.request.source.record_id,
      source_version: record.request.source.source_version,
    },
    target: {
      admission_owner_ref: route.target_admission_owner_ref,
      application_owner_ref: route.target_application_owner_ref,
      domain: route.target_domain,
      home_ref: route.target_home_ref,
      ingress_ref: route.target_ingress_ref,
      lane_ref: route.target_lane_ref,
    },
    reason: structuredClone(record.request.reason),
    validation: { gates: [], receipt_ref: null, run_ref: null, state: "not-started" },
    authority_decisions: [],
    admission: {
      reason_code: null,
      receipt_ref: null,
      recorded_at: null,
      state: "not-started",
      target_record_ref: null,
    },
    application: {
      adapter_ref: route.target_application_owner_ref,
      evidence_kind: null,
      failure_code: null,
      failure_detail: null,
      receipt_ref: null,
      recorded_at: null,
      resulting_refs: [],
      retryable: null,
      run_ref: null,
      state: "not-started",
      target_record_ref: null,
    },
    blocked_gate: null,
    correction: null,
    deferred: null,
    rejection: null,
    cancelled_reason_code: null,
    supersedes_transition_id: record.request.supersedes_transition_id,
    superseded_by_transition_id: null,
    next_action: null,
    history: historyProjection(record.events),
    updated_at: record.updated_at,
  };

  for (const event of record.events.slice(1)) applyEvent(projection, event);
  projection.next_action = nextAction(projection, route);
  return projection;
}

function applyEvent(projection, event) {
  const details = event.details;
  switch (event.artifact_kind) {
    case "validation-started":
      projection.state = "validating";
      projection.validation = {
        gates: [], receipt_ref: null, run_ref: details.run_ref, state: "running",
      };
      projection.blocked_gate = null;
      projection.correction = null;
      projection.deferred = null;
      projection.rejection = null;
      break;
    case "validation-completed":
      projection.validation = {
        gates: structuredClone(details.gates),
        receipt_ref: details.receipt_ref,
        run_ref: projection.validation.run_ref,
        state: details.state,
      };
      if (details.state === "passed") {
        projection.state = details.requires_authority_decision
          ? "awaiting-authority"
          : "awaiting-admission";
      } else {
        projection.state = "blocked";
        projection.blocked_gate = details.gates.find((gate) => gate.state === "blocked") ?? null;
      }
      break;
    case "authority-decision-recorded":
      projection.authority_decisions = [
        ...projection.authority_decisions.filter(
          (entry) => entry.control_id !== details.decision.control_id,
        ),
        structuredClone(details.decision),
      ];
      projection.state = details.decision.decision === "approved"
        ? "awaiting-admission"
        : details.decision.decision === "deferred"
          ? "deferred"
          : "awaiting-authority";
      if (details.decision.decision === "deferred") {
        projection.deferred = {
          justification: details.decision.justification,
          reason_code: details.decision.control_id,
          review_at: details.decision.review_at,
        };
      }
      break;
    case "target-admission-recorded":
      projection.admission = structuredClone(details.admission);
      if (details.admission.state === "admitted") {
        projection.state = "authorized";
        projection.rejection = null;
      } else {
        projection.state = "rejected";
        projection.rejection = {
          reason_code: details.admission.reason_code,
          reason_detail: "Target admission rejected the transition.",
        };
      }
      break;
    case "application-started":
      projection.state = "applying";
      projection.application = {
        ...projection.application,
        failure_code: null,
        failure_detail: null,
        retryable: null,
        run_ref: details.run_ref,
        state: "running",
      };
      break;
    case "target-application-recorded":
      projection.state = "applied";
      projection.application = {
        ...projection.application,
        evidence_kind: details.application.evidence_kind,
        failure_code: null,
        failure_detail: null,
        receipt_ref: details.application.receipt_ref,
        recorded_at: event.recorded_at,
        resulting_refs: structuredClone(details.application.resulting_refs),
        retryable: null,
        state: "applied",
        target_record_ref: details.application.target_record_ref,
      };
      break;
    case "application-failed":
      projection.state = "failed";
      projection.application = {
        ...projection.application,
        failure_code: details.failure.code,
        failure_detail: details.failure.detail,
        recorded_at: event.recorded_at,
        retryable: details.failure.retryable,
        run_ref: details.failure.run_ref,
        state: "failed",
      };
      break;
    case "gate-blocked":
      projection.state = "blocked";
      projection.blocked_gate = structuredClone(details.gate);
      break;
    case "source-correction-returned":
      projection.state = "returned";
      projection.correction = structuredClone(details.correction);
      break;
    case "transition-deferred":
      projection.state = "deferred";
      projection.deferred = structuredClone(details.deferred);
      break;
    case "transition-cancelled":
      projection.state = "cancelled";
      projection.cancelled_reason_code = details.reason_code;
      break;
    case "transition-superseded":
      projection.state = "superseded";
      projection.superseded_by_transition_id = details.superseding_transition_id;
      break;
  }
}

function nextAction(projection, route) {
  if (lifecycleTransitionTerminalStates.has(projection.state)) return null;
  let ownerRef;
  if (["prepared", "validating"].includes(projection.state)) {
    ownerRef = route.validation_owner_ref;
  } else if (projection.state === "awaiting-authority") {
    ownerRef = projection.authority_decisions.find(
      (entry) => entry.decision !== "approved",
    )?.authority_owner_ref ?? route.validation_owner_ref;
  } else if (projection.state === "awaiting-admission") {
    ownerRef = route.target_admission_owner_ref;
  } else if (["authorized", "applying", "failed"].includes(projection.state)) {
    ownerRef = route.execution_owner_ref;
  } else if (projection.state === "blocked") {
    ownerRef = projection.blocked_gate?.owner_ref ?? route.validation_owner_ref;
  } else if (projection.state === "returned") {
    ownerRef = projection.correction?.owner_ref ?? route.intent_owner_ref;
  } else if (projection.state === "deferred") {
    ownerRef = projection.authority_decisions.find(
      (entry) => entry.decision === "deferred",
    )?.authority_owner_ref ?? route.intent_owner_ref;
  } else {
    ownerRef = route.intent_owner_ref;
  }
  return {
    action: NEXT_ACTION[projection.state],
    owner_ref: ownerRef,
    review_at: projection.state === "deferred" ? projection.deferred?.review_at ?? null : null,
  };
}

function historyProjection(events) {
  const visible = events.slice(-100);
  return {
    entries: visible.map(historyEntry),
    next_cursor: events.length > visible.length
      ? `history-before:${events.length - visible.length}`
      : null,
    truncated: events.length > visible.length,
  };
}

function historyEntry(event) {
  return {
    artifact_id: event.event_id,
    artifact_kind: event.artifact_kind,
    authority: structuredClone(event.authority),
    evidence_refs: structuredClone(event.evidence_refs),
    recorded_at: event.recorded_at,
    sequence: event.sequence,
  };
}

function parseListCursor(cursor) {
  if (!cursor) return 0;
  const match = /^transition-list:(\d+)$/.exec(cursor);
  if (!match) {
    throw lifecycleTransitionError("cursor_invalid", "Lifecycle Transition list cursor is invalid.", 400);
  }
  return Number.parseInt(match[1], 10);
}

function parseHistoryCursor(cursor, length) {
  if (!cursor) return length;
  const match = /^history-before:(\d+)$/.exec(cursor);
  if (!match) {
    throw lifecycleTransitionError("cursor_invalid", "Lifecycle Transition history cursor is invalid.", 400);
  }
  const value = Number.parseInt(match[1], 10);
  if (value < 0 || value > length) {
    throw lifecycleTransitionError("cursor_invalid", "Lifecycle Transition history cursor is out of range.", 400);
  }
  return value;
}
