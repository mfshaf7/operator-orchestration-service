import { createHash } from "node:crypto";

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;

export class CanonicalJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function skipWhitespace(source, cursor) {
  while (cursor.index < source.length && /[\t\n\r ]/.test(source[cursor.index])) {
    cursor.index += 1;
  }
}

function scanString(source, cursor) {
  const start = cursor.index;
  cursor.index += 1;
  let escaped = false;

  while (cursor.index < source.length) {
    const character = source[cursor.index];
    cursor.index += 1;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      const token = source.slice(start, cursor.index);
      try {
        return JSON.parse(token);
      } catch {
        throw new CanonicalJsonError("JSON contains an invalid string token.");
      }
    }
    if (character.charCodeAt(0) <= 0x1f) {
      throw new CanonicalJsonError("JSON strings must escape control characters.");
    }
  }

  throw new CanonicalJsonError("JSON contains an unterminated string.");
}

function scanNumber(source, cursor) {
  const remaining = source.slice(cursor.index);
  const match = remaining.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) {
    throw new CanonicalJsonError("JSON contains an invalid number token.");
  }
  cursor.index += match[0].length;
  if (/[.eE]/.test(match[0])) {
    throw new CanonicalJsonError(
      "Delivery ART artifacts require integral number tokens without decimal or exponent notation.",
    );
  }
  const value = Number(match[0]);
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(
      "Delivery ART artifacts require integral numbers inside the RFC 8785 safe range.",
    );
  }
}

function scanLiteral(source, cursor, literal) {
  if (source.slice(cursor.index, cursor.index + literal.length) !== literal) {
    throw new CanonicalJsonError(`JSON contains an invalid token at offset ${cursor.index}.`);
  }
  cursor.index += literal.length;
}

function scanArray(source, cursor) {
  cursor.index += 1;
  skipWhitespace(source, cursor);
  if (source[cursor.index] === "]") {
    cursor.index += 1;
    return;
  }

  while (cursor.index < source.length) {
    scanValue(source, cursor);
    skipWhitespace(source, cursor);
    if (source[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    if (source[cursor.index] !== ",") {
      throw new CanonicalJsonError(`JSON array expects a comma at offset ${cursor.index}.`);
    }
    cursor.index += 1;
    skipWhitespace(source, cursor);
  }

  throw new CanonicalJsonError("JSON contains an unterminated array.");
}

function scanObject(source, cursor) {
  cursor.index += 1;
  skipWhitespace(source, cursor);
  const keys = new Set();
  if (source[cursor.index] === "}") {
    cursor.index += 1;
    return;
  }

  while (cursor.index < source.length) {
    if (source[cursor.index] !== '"') {
      throw new CanonicalJsonError(`JSON object expects a key at offset ${cursor.index}.`);
    }
    const key = scanString(source, cursor);
    if (keys.has(key)) {
      throw new CanonicalJsonError(`JSON contains duplicate object key ${JSON.stringify(key)}.`);
    }
    keys.add(key);
    skipWhitespace(source, cursor);
    if (source[cursor.index] !== ":") {
      throw new CanonicalJsonError(`JSON object expects a colon at offset ${cursor.index}.`);
    }
    cursor.index += 1;
    scanValue(source, cursor);
    skipWhitespace(source, cursor);
    if (source[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    if (source[cursor.index] !== ",") {
      throw new CanonicalJsonError(`JSON object expects a comma at offset ${cursor.index}.`);
    }
    cursor.index += 1;
    skipWhitespace(source, cursor);
  }

  throw new CanonicalJsonError("JSON contains an unterminated object.");
}

function scanValue(source, cursor) {
  skipWhitespace(source, cursor);
  const character = source[cursor.index];
  if (character === "{") {
    scanObject(source, cursor);
    return;
  }
  if (character === "[") {
    scanArray(source, cursor);
    return;
  }
  if (character === '"') {
    scanString(source, cursor);
    return;
  }
  if (character === "t") {
    scanLiteral(source, cursor, "true");
    return;
  }
  if (character === "f") {
    scanLiteral(source, cursor, "false");
    return;
  }
  if (character === "n") {
    scanLiteral(source, cursor, "null");
    return;
  }
  scanNumber(source, cursor);
}

export function parseCanonicalJson(raw) {
  if (typeof raw !== "string") {
    throw new CanonicalJsonError("Canonical JSON input must be text.");
  }
  const cursor = { index: 0 };
  scanValue(raw, cursor);
  skipWhitespace(raw, cursor);
  if (cursor.index !== raw.length) {
    throw new CanonicalJsonError(`JSON contains trailing content at offset ${cursor.index}.`);
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CanonicalJsonError("Request body must be valid JSON.");
  }
  assertCanonicalJson(value);
  return value;
}

export function canonicalJsonErrors(value, path = "<root>") {
  const errors = [];
  if (typeof value === "string") {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
        errors.push(`${path} contains a lone UTF-16 surrogate`);
      }
    }
    return errors;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      errors.push(`${path} uses a floating-point value`);
    } else if (Math.abs(value) > MAX_SAFE_INTEGER) {
      errors.push(`${path} exceeds the RFC 8785 safe integer range`);
    }
    return errors;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      errors.push(...canonicalJsonErrors(entry, `${path}[${index}]`));
    });
    return errors;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      errors.push(...canonicalJsonErrors(key, `${path} key`));
      errors.push(...canonicalJsonErrors(entry, `${path}[${JSON.stringify(key)}]`));
    }
    return errors;
  }
  if (value !== null && typeof value !== "boolean") {
    errors.push(`${path} contains unsupported canonical JSON value ${typeof value}`);
  }
  return errors;
}

export function assertCanonicalJson(value) {
  const errors = canonicalJsonErrors(value);
  if (errors.length > 0) {
    throw new CanonicalJsonError(errors.join("; "));
  }
}

export function canonicalStringify(value) {
  assertCanonicalJson(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalStringify(value)).digest("hex")}`;
}
