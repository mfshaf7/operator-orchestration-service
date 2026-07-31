const RFC3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

export function parseRfc3339Timestamp(value) {
  if (typeof value !== "string" || !RFC3339_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function canonicalRfc3339Timestamp(value) {
  const timestamp = parseRfc3339Timestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}
