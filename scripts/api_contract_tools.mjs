import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function loadOpenApiSpec() {
  return JSON.parse(readFileSync(openApiPath, "utf8"));
}

export function normalizeRoutePath(routePath, availablePaths) {
  if (availablePaths[routePath]) {
    return routePath;
  }

  for (const candidate of Object.keys(availablePaths)) {
    const regex = new RegExp(
      `^${escapeRegex(candidate).replace(/\\\{[^/]+\\\}/g, "[^/]+")}$`,
    );
    if (regex.test(routePath)) {
      return candidate;
    }
  }

  return null;
}

export function resolveRefSchema(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return null;
  }

  return ref
    .slice(2)
    .split("/")
    .reduce((cursor, segment) => cursor?.[segment], spec);
}

export function resolveRefObject(spec, value) {
  if (!value || typeof value !== "object" || !value.$ref) {
    return value ?? null;
  }

  return resolveRefSchema(spec, value.$ref) ?? null;
}

export function resolveOperation(spec, method, routePath) {
  const normalizedPath = normalizeRoutePath(routePath, spec.paths ?? {});
  if (!normalizedPath) {
    return null;
  }

  const operation = spec.paths?.[normalizedPath]?.[method.toLowerCase()] ?? null;
  if (!operation) {
    return null;
  }

  return {
    normalizedPath,
    operation,
  };
}

export function pickExample(spec, mediaType) {
  if (!mediaType || typeof mediaType !== "object") {
    return null;
  }
  if (Object.hasOwn(mediaType, "example")) {
    return mediaType.example;
  }

  if (
    mediaType.examples &&
    typeof mediaType.examples === "object" &&
    Object.keys(mediaType.examples).length > 0
  ) {
    const firstKey = Object.keys(mediaType.examples)[0];
    return mediaType.examples[firstKey]?.value ?? mediaType.examples[firstKey];
  }

  const schema = mediaType.schema;
  if (!schema || typeof schema !== "object") {
    return null;
  }
  if (Object.hasOwn(schema, "example")) {
    return schema.example;
  }
  if (schema.$ref) {
    const resolved = resolveRefSchema(spec, schema.$ref);
    if (resolved && Object.hasOwn(resolved, "example")) {
      return resolved.example;
    }
  }

  return null;
}

export function schemaName(schema) {
  if (!schema || typeof schema !== "object") {
    return "none";
  }

  if (schema.$ref) {
    return schema.$ref.split("/").pop();
  }

  return schema.type ?? "inline-object";
}

export function schemaHasExample(spec, schema) {
  if (!schema || typeof schema !== "object") {
    return false;
  }
  if (Object.hasOwn(schema, "example")) {
    return true;
  }
  if (
    schema.examples &&
    typeof schema.examples === "object" &&
    Object.keys(schema.examples).length > 0
  ) {
    return true;
  }
  if (schema.$ref) {
    return schemaHasExample(spec, resolveRefSchema(spec, schema.$ref));
  }

  return false;
}

export function responseHasExample(spec, jsonResponse) {
  if (!jsonResponse || typeof jsonResponse !== "object") {
    return false;
  }
  if (Object.hasOwn(jsonResponse, "example")) {
    return true;
  }
  if (
    jsonResponse.examples &&
    typeof jsonResponse.examples === "object" &&
    Object.keys(jsonResponse.examples).length > 0
  ) {
    return true;
  }

  return schemaHasExample(spec, jsonResponse.schema);
}

function validateByType(expectedType, value) {
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

export function validateValueAgainstSchema(spec, schema, value, pathLabel = "$") {
  const referencedSchema = schema?.$ref
    ? resolveRefSchema(spec, schema.$ref)
    : null;
  const effectiveSchema = referencedSchema
    ? { ...referencedSchema, ...schema, $ref: undefined }
    : schema;

  if (!effectiveSchema || typeof effectiveSchema !== "object") {
    return [];
  }

  const errors = [];

  if (Array.isArray(effectiveSchema.oneOf) && effectiveSchema.oneOf.length > 0) {
    const validBranchCount = effectiveSchema.oneOf.filter(
      (candidate) =>
        validateValueAgainstSchema(spec, candidate, value, pathLabel).length === 0,
    ).length;
    if (validBranchCount !== 1) {
      errors.push(
        `${pathLabel}: value must match exactly one oneOf branch; matched ${validBranchCount}`,
      );
    }
  }

  if (Array.isArray(effectiveSchema.anyOf) && effectiveSchema.anyOf.length > 0) {
    const validBranch = effectiveSchema.anyOf.some(
      (candidate) =>
        validateValueAgainstSchema(spec, candidate, value, pathLabel).length === 0,
    );
    if (!validBranch) {
      errors.push(`${pathLabel}: value does not match any anyOf branch`);
    }
  }

  if (
    effectiveSchema.not &&
    validateValueAgainstSchema(spec, effectiveSchema.not, value, pathLabel)
      .length === 0
  ) {
    errors.push(`${pathLabel}: value matches a forbidden schema`);
  }

  if (Object.hasOwn(effectiveSchema, "const") && value !== effectiveSchema.const) {
    errors.push(
      `${pathLabel}: expected const ${JSON.stringify(effectiveSchema.const)}`,
    );
  }

  if (Array.isArray(effectiveSchema.enum) && !effectiveSchema.enum.includes(value)) {
    errors.push(
      `${pathLabel}: expected one of ${effectiveSchema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`,
    );
  }

  const declaredTypes = Array.isArray(effectiveSchema.type)
    ? effectiveSchema.type
    : effectiveSchema.type
      ? [effectiveSchema.type]
      : [];

  if (declaredTypes.length > 0) {
    const matchesDeclaredType = declaredTypes.some((entry) => validateByType(entry, value));
    if (!matchesDeclaredType) {
      errors.push(
        `${pathLabel}: expected ${declaredTypes.join(" or ")}, got ${
          value === null ? "null" : Array.isArray(value) ? "array" : typeof value
        }`,
      );
      return errors;
    }
  }

  if (typeof value === "string") {
    if (
      Number.isInteger(effectiveSchema.minLength) &&
      value.length < effectiveSchema.minLength
    ) {
      errors.push(
        `${pathLabel}: expected at least ${effectiveSchema.minLength} characters`,
      );
    }
    if (
      Number.isInteger(effectiveSchema.maxLength) &&
      value.length > effectiveSchema.maxLength
    ) {
      errors.push(
        `${pathLabel}: expected at most ${effectiveSchema.maxLength} characters`,
      );
    }
    if (
      typeof effectiveSchema.pattern === "string" &&
      !new RegExp(effectiveSchema.pattern, "u").test(value)
    ) {
      errors.push(`${pathLabel}: value does not match the required pattern`);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (
      typeof effectiveSchema.minimum === "number" &&
      value < effectiveSchema.minimum
    ) {
      errors.push(`${pathLabel}: expected a value >= ${effectiveSchema.minimum}`);
    }
    if (
      typeof effectiveSchema.maximum === "number" &&
      value > effectiveSchema.maximum
    ) {
      errors.push(`${pathLabel}: expected a value <= ${effectiveSchema.maximum}`);
    }
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(effectiveSchema.required)
      ? effectiveSchema.required
      : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        errors.push(`${pathLabel}: missing required property ${key}`);
      }
    }

    const properties = isPlainObject(effectiveSchema.properties)
      ? effectiveSchema.properties
      : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) {
        continue;
      }
      errors.push(
        ...validateValueAgainstSchema(
          spec,
          propertySchema,
          value[key],
          `${pathLabel}.${key}`,
        ),
      );
    }

    const additional = effectiveSchema.additionalProperties;
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(properties, key)) {
        continue;
      }
      if (additional === false) {
        errors.push(`${pathLabel}: unexpected property ${key}`);
        continue;
      }
      if (isPlainObject(additional)) {
        errors.push(
          ...validateValueAgainstSchema(
            spec,
            additional,
            value[key],
            `${pathLabel}.${key}`,
          ),
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (
      Number.isInteger(effectiveSchema.minItems) &&
      value.length < effectiveSchema.minItems
    ) {
      errors.push(
        `${pathLabel}: expected at least ${effectiveSchema.minItems} items`,
      );
    }
    if (
      Number.isInteger(effectiveSchema.maxItems) &&
      value.length > effectiveSchema.maxItems
    ) {
      errors.push(
        `${pathLabel}: expected at most ${effectiveSchema.maxItems} items`,
      );
    }
    if (
      effectiveSchema.uniqueItems === true &&
      new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
    ) {
      errors.push(`${pathLabel}: expected unique items`);
    }
    if (effectiveSchema.items) {
      value.forEach((entry, index) => {
        errors.push(
          ...validateValueAgainstSchema(
            spec,
            effectiveSchema.items,
            entry,
            `${pathLabel}[${index}]`,
          ),
        );
      });
    }
  }

  return errors;
}

export function validateExampleAgainstMediaType(spec, mediaType, pathLabel) {
  const example = pickExample(spec, mediaType);
  if (example === null || example === undefined) {
    return [];
  }

  return validateValueAgainstSchema(spec, mediaType.schema, example, pathLabel);
}
