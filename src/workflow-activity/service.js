import { createHash } from "node:crypto";

const OUTCOMES = new Set([
  "blocked",
  "failed",
  "informational",
  "started",
  "succeeded",
  "waiting",
]);
const CATEGORIES = new Set([
  "blocker",
  "command",
  "receipt",
  "runtime",
  "state-change",
  "transition",
]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export class WorkflowActivityError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = "WorkflowActivityError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toResponse() {
    return { error: this.code, message: this.message, details: this.details };
  }
}

export function createWorkflowActivityService({
  clock = () => new Date(),
  sources = [],
} = {}) {
  const registered = new Map();
  for (const source of sources) {
    assertSource(source);
    if (registered.has(source.id)) {
      invalid("workflow_activity_source_duplicate", `Duplicate activity source: ${source.id}.`);
    }
    registered.set(source.id, source);
  }

  async function list({
    callerId,
    correlationId,
    cursor = null,
    filters = {},
    limit = null,
  }) {
    const pageSize = parseLimit(limit);
    const normalizedFilters = normalizeFilters(filters, registered);
    const filterDigest = digest(normalizedFilters);
    const boundary = parseCursor(cursor, filterDigest);
    const selected = normalizedFilters.source_id
      ? [registered.get(normalizedFilters.source_id)]
      : [...registered.values()];

    const results = await Promise.all(selected.map(async (source) => {
      try {
        const result = await source.read({
          callerId,
          correlationId,
          limit: MAX_LIMIT,
        });
        return normalizeSourceResult(source, result, clock());
      } catch (error) {
        if (isAuthorizationFailure(error)) throw error;
        return unavailableSource(source, clock(), error);
      }
    }));

    const eventById = new Map();
    const sourcesProjection = [];
    for (const result of results) {
      sourcesProjection.push(result.source);
      for (const event of result.events) {
        const existing = eventById.get(event.event_id);
        if (existing && digest(existing) !== digest(event)) {
          throw new WorkflowActivityError(
            "workflow_activity_event_conflict",
            `Activity event ${event.event_id} has conflicting owner projections.`,
            502,
          );
        }
        eventById.set(event.event_id, event);
      }
    }

    let events = [...eventById.values()]
      .filter((event) => matchesFilters(event, normalizedFilters))
      .sort(compareEvents);
    if (boundary) {
      events = events.filter((event) => followsBoundary(event, boundary));
    }
    const hasMore = events.length > pageSize;
    const page = events.slice(0, pageSize);
    const last = page.at(-1);
    const partial = sourcesProjection.some((source) =>
      source.state !== "current" || source.truncated);

    return {
      schema_version: 1,
      artifact_type: "workflow-activity-page",
      projection_status: partial ? "partial" : "current",
      observed_at: clock().toISOString(),
      filters: normalizedFilters,
      events: page,
      next_cursor: hasMore && last
        ? encodeCursor({
            filter_digest: filterDigest,
            occurred_at: last.occurred_at,
            event_id: last.event_id,
          })
        : null,
      sources: sourcesProjection.sort((left, right) =>
        left.source_id.localeCompare(right.source_id)),
    };
  }

  return { list };
}

function normalizeSourceResult(source, result, observedAt) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Activity source returned an invalid result.");
  }
  if (!Array.isArray(result.events)) {
    throw new Error("Activity source did not return events.");
  }
  const events = result.events.map((event) => normalizeEvent(event, source));
  if (!["current", "stale", "unavailable"].includes(result.state ?? "current")) {
    throw new Error("Activity source returned an invalid state.");
  }
  return {
    events,
    source: {
      source_id: source.id,
      authority: source.authority,
      owner: source.owner,
      state: result.state ?? "current",
      observed_at: timestamp(result.observed_at ?? observedAt.toISOString(), "source observed_at"),
      source_revision: text(result.source_revision, "source revision"),
      event_count: events.length,
      truncated: result.truncated === true,
      error_code: result.state === "current"
        ? null
        : safeErrorCode({ code: result.error_code }),
    },
  };
}

function unavailableSource(source, observedAt, error) {
  return {
    events: [],
    source: {
      source_id: source.id,
      authority: source.authority,
      owner: source.owner,
      state: "unavailable",
      observed_at: observedAt.toISOString(),
      source_revision: "unavailable",
      event_count: 0,
      truncated: false,
      error_code: safeErrorCode(error),
    },
  };
}

function normalizeEvent(event, source) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Activity source returned an invalid event.");
  }
  const normalized = {
    event_id: text(event.event_id, "event_id"),
    action: {
      id: text(event.action?.id, "action.id"),
      label: text(event.action?.label, "action.label"),
    },
    actor: {
      kind: ["agent", "operator", "system", "unknown"].includes(event.actor?.kind)
        ? event.actor.kind
        : "unknown",
      ref: text(event.actor?.ref, "actor.ref"),
    },
    category: event.category,
    outcome: event.outcome,
    occurred_at: timestamp(event.occurred_at, "occurred_at"),
    correlation_id: nullableText(event.correlation_id, "correlation_id"),
    causation_id: nullableText(event.causation_id, "causation_id"),
    durability: "source-projected",
    evidence_refs: referenceList(event.evidence_refs, "evidence_refs"),
    receipt_ref: nullableText(event.receipt_ref, "receipt_ref"),
    next_actions: normalizeNextActions(event.next_actions),
    source: {
      authority: source.authority,
      label: source.label,
      mode: "source-projected",
      owner: source.owner,
      ref: text(event.source_ref, "source_ref"),
      revision: text(event.source_revision, "source_revision"),
    },
    subject: {
      kind: text(event.subject?.kind, "subject.kind"),
      label: text(event.subject?.label, "subject.label"),
      ref: text(event.subject?.ref, "subject.ref"),
    },
    summary: text(event.summary, "summary"),
  };
  if (!CATEGORIES.has(normalized.category)) {
    throw new Error("Activity source returned an invalid category.");
  }
  if (!OUTCOMES.has(normalized.outcome)) {
    throw new Error("Activity source returned an invalid outcome.");
  }
  return normalized;
}

function normalizeNextActions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error("Activity next_actions are invalid.");
  }
  return value.map((entry) => ({
    action: text(entry?.action, "next_actions.action"),
    owner_ref: text(entry?.owner_ref, "next_actions.owner_ref"),
    review_at: nullableTimestamp(entry?.review_at, "next_actions.review_at"),
  }));
}

function normalizeFilters(filters, sources) {
  const normalized = {
    source_id: nullableText(filters.sourceId, "source_id"),
    category: nullableText(filters.category, "category"),
    outcome: nullableText(filters.outcome, "outcome"),
    subject_ref: nullableText(filters.subjectRef, "subject_ref"),
  };
  if (normalized.source_id && !sources.has(normalized.source_id)) {
    invalid("workflow_activity_filter_invalid", "source_id is not a registered activity source.");
  }
  if (normalized.category && !CATEGORIES.has(normalized.category)) {
    invalid("workflow_activity_filter_invalid", "category is invalid.");
  }
  if (normalized.outcome && !OUTCOMES.has(normalized.outcome)) {
    invalid("workflow_activity_filter_invalid", "outcome is invalid.");
  }
  return normalized;
}

function matchesFilters(event, filters) {
  return (!filters.source_id || event.source.ref.startsWith(`${filters.source_id}:`)) &&
    (!filters.category || event.category === filters.category) &&
    (!filters.outcome || event.outcome === filters.outcome) &&
    (!filters.subject_ref || event.subject.ref === filters.subject_ref);
}

function compareEvents(left, right) {
  return right.occurred_at.localeCompare(left.occurred_at) ||
    left.event_id.localeCompare(right.event_id);
}

function followsBoundary(event, boundary) {
  return event.occurred_at < boundary.occurred_at ||
    (event.occurred_at === boundary.occurred_at && event.event_id > boundary.event_id);
}

function parseLimit(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    invalid("workflow_activity_limit_invalid", `limit must be between 1 and ${MAX_LIMIT}.`);
  }
  return parsed;
}

function parseCursor(value, filterDigest) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      parsed?.schema_version !== 1 ||
      parsed.filter_digest !== filterDigest ||
      typeof parsed.event_id !== "string" ||
      !Number.isFinite(Date.parse(parsed.occurred_at))
    ) {
      throw new Error("cursor binding mismatch");
    }
    return parsed;
  } catch {
    invalid("workflow_activity_cursor_invalid", "Workflow activity cursor is invalid for this query.");
  }
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify({ schema_version: 1, ...value }), "utf8").toString("base64url");
}

function assertSource(source) {
  if (!source || typeof source.read !== "function") {
    throw new Error("Workflow activity sources require read().");
  }
  for (const field of ["id", "label", "authority", "owner"]) {
    text(source[field], `source.${field}`);
  }
}

function isAuthorizationFailure(error) {
  return error?.statusCode === 401 || error?.statusCode === 403 ||
    error?.status === 401 || error?.status === 403;
}

function safeErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "source_unavailable";
  return /^[a-z0-9_.-]{1,80}$/i.test(code) ? code : "source_unavailable";
}

function referenceList(value, field) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${field} is invalid.`);
  }
  return [...new Set(value.map((entry) => text(entry, field)))];
}

function nullableText(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return text(value, field);
}

function nullableTimestamp(value, field) {
  if (value === null || value === undefined || value === "") return null;
  return timestamp(value, field);
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) {
    throw new Error(`${field} must be non-empty text of at most 1024 characters.`);
  }
  return value.trim();
}

function timestamp(value, field) {
  const normalized = text(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${field} must be an RFC 3339 timestamp.`);
  }
  return normalized;
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function invalid(code, message) {
  throw new WorkflowActivityError(code, message);
}
