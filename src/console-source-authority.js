import { createHash } from "node:crypto";

export const CONSOLE_SOURCE_PROJECTION_MEDIA_TYPE =
  "application/vnd.mfshaf7.console-source-projection+json";

const AUTHORITY = "operator-orchestration-service";
const DEFAULT_FRESHNESS_TTL_MS = 300_000;
const FRESHNESS_STATES = new Set([
  "current",
  "stale",
  "unavailable",
  "unknown",
]);

export class ConsoleSourceAuthorityError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = "ConsoleSourceAuthorityError";
    this.code = code;
    this.statusCode = statusCode;
  }

  toResponse() {
    return {
      error: this.code,
      message: this.message,
      details: null,
    };
  }
}

export function canonicalSourceProjectionRequested(request) {
  const accept = request?.headers?.accept;
  if (typeof accept !== "string") return false;
  let unsupportedCanonicalVersion = false;
  let defaultJsonAllowed = false;
  for (const entry of accept.split(",")) {
    const [rawMediaType, ...rawParameters] = entry.split(";");
    const mediaType = rawMediaType.trim().toLowerCase();
    const parameters = Object.fromEntries(
      rawParameters.map((parameter) => {
        const [name, ...value] = parameter.trim().split("=");
        return [name.toLowerCase(), value.join("=").replace(/^"|"$/g, "")];
      }),
    );
    if (parameters.q === "0") continue;
    if (mediaType === "application/json" || mediaType === "*/*") {
      defaultJsonAllowed = true;
    }
    if (mediaType !== CONSOLE_SOURCE_PROJECTION_MEDIA_TYPE) continue;
    if (parameters.version === "1") return true;
    unsupportedCanonicalVersion = true;
  }
  if (unsupportedCanonicalVersion && !defaultJsonAllowed) {
    throw new ConsoleSourceAuthorityError(
      "source_projection_version_not_acceptable",
      "The requested Console source projection version is not supported.",
      406,
    );
  }
  return false;
}

export function createConsoleSourceProjection({
  eventSequence,
  freshnessState = "current",
  observedAt = new Date().toISOString(),
  projection,
  recordRef,
  sourceOwner,
  sourceRef,
  sourceRevision,
  sourceTimestamp,
  ttlMs = DEFAULT_FRESHNESS_TTL_MS,
}) {
  const binding = {
    authority: AUTHORITY,
    record_ref: requiredText(recordRef, "record_ref"),
    source_owner: requiredText(sourceOwner, "source_owner"),
    source_ref: requiredText(sourceRef, "source_ref"),
  };
  const normalizedSourceRevision = requiredText(
    sourceRevision,
    "source_revision",
  );
  const normalizedObservedAt = timestamp(observedAt, "observed_at");
  const sequence = resolveEventSequence({
    eventSequence,
    sourceRevision: normalizedSourceRevision,
    sourceTimestamp,
  });
  if (!FRESHNESS_STATES.has(freshnessState)) {
    invalid("freshness_state is invalid.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    invalid("ttl_ms must be a positive safe integer.");
  }

  const revision = {
    event_cursor: eventCursor(binding, normalizedSourceRevision, sequence),
    event_sequence: sequence,
    source_revision: normalizedSourceRevision,
  };

  return {
    schema_version: 1,
    artifact_type: "console-source-projection",
    binding,
    revision,
    freshness: {
      observed_at: normalizedObservedAt,
      state: freshnessState,
      valid_until: new Date(
        Date.parse(normalizedObservedAt) + ttlMs,
      ).toISOString(),
    },
    projection,
  };
}

export function createConsoleSourceReceiptBinding({
  projection,
  receiptRef,
  recordedAt = new Date().toISOString(),
}) {
  if (
    projection?.artifact_type !== "console-source-projection" ||
    projection?.schema_version !== 1
  ) {
    invalid("projection must be a canonical Console source projection.");
  }
  const normalizedRecordedAt = timestamp(recordedAt, "recorded_at");
  if (
    Date.parse(normalizedRecordedAt) <
    Date.parse(projection.freshness.observed_at)
  ) {
    invalid("recorded_at must not predate the bound projection.");
  }
  return {
    schema_version: 1,
    artifact_type: "console-source-receipt-binding",
    binding: { ...projection.binding },
    revision: { ...projection.revision },
    receipt_ref: requiredText(receiptRef, "receipt_ref"),
    recorded_at: normalizedRecordedAt,
  };
}

export function sourceFreshnessState(projection) {
  const state = projection?.projection_state ?? projection?.projection_status;
  if (["current", "ready", "closed"].includes(state)) return "current";
  if (["offline", "unavailable"].includes(state)) return "unavailable";
  if (["stale", "error", "reconciliation_required"].includes(state)) {
    return "stale";
  }
  if (["syncing", "partial", "not_ready"].includes(state)) return "unknown";
  return "current";
}

export function sourceRevisionOf(projection) {
  return firstText([
    projection?.source_revision,
    projection?.record_version,
    projection?.source?.revision,
    projection?.session_revision,
    projection?.revision,
    projection?.version,
  ]);
}

export function sourceTimestampOf(projection) {
  return firstText([
    projection?.projected_at,
    projection?.updated_at,
    projection?.last_projected_at,
    projection?.recorded_at,
    projection?.created_at,
  ]);
}

export function sourceRevisionDigest(projection) {
  return `sha256:${createHash("sha256")
    .update(stableJson(projection))
    .digest("hex")}`;
}

function resolveEventSequence({ eventSequence, sourceRevision, sourceTimestamp }) {
  if (eventSequence !== undefined) {
    if (!Number.isSafeInteger(eventSequence) || eventSequence < 0) {
      invalid("event_sequence must be a non-negative safe integer.");
    }
    return eventSequence;
  }

  const versionMatch = /(?:^|[-:])(?:version-)?([0-9]+)$/.exec(sourceRevision);
  if (versionMatch) {
    const value = Number.parseInt(versionMatch[1], 10);
    if (Number.isSafeInteger(value)) return value;
  }

  if (sourceTimestamp) {
    const value = Date.parse(timestamp(sourceTimestamp, "source_timestamp"));
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }

  invalid(
    "Canonical source ordering requires an event sequence, an ordered revision, or a source timestamp.",
  );
}

function eventCursor(binding, sourceRevision, eventSequence) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        binding,
        event_sequence: eventSequence,
        source_revision: sourceRevision,
      }),
    )
    .digest("hex");
  return `oos-source-event:${digest}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) {
    invalid(`${field} must be a non-empty string of at most 1024 characters.`);
  }
  return value;
}

function firstText(values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

function timestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    invalid(`${field} must be an RFC 3339 timestamp.`);
  }
  return normalized;
}

function invalid(message) {
  throw new ConsoleSourceAuthorityError("source_authority_invalid", message);
}
