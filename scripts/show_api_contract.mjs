import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");

function usage() {
  console.error(
    "usage: node scripts/show_api_contract.mjs <METHOD> <PATH>\n" +
      "example: node scripts/show_api_contract.mjs GET /v1/delivery-work-items/work-item-188/continuation-context",
  );
  process.exit(1);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function pretty(value) {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRoutePath(routePath, availablePaths) {
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

function resolveRef(spec, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return null;
  }

  return ref
    .slice(2)
    .split("/")
    .reduce((cursor, segment) => cursor?.[segment], spec);
}

function pickExample(spec, mediaType) {
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
    const resolved = resolveRef(spec, schema.$ref);
    if (resolved && Object.hasOwn(resolved, "example")) {
      return resolved.example;
    }
  }

  return null;
}

function schemaName(schema) {
  if (!schema || typeof schema !== "object") {
    return "none";
  }

  if (schema.$ref) {
    return schema.$ref.split("/").pop();
  }

  return schema.type ?? "inline-object";
}

function printSection(title, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  console.log(`\n${title}`);
  console.log(pretty(value));
}

const args = process.argv.slice(2);
if (args.length < 2) {
  usage();
}

const method = args[0].trim().toUpperCase();
const pathInput = args.slice(1).join(" ").trim();
if (!method || !pathInput.startsWith("/")) {
  usage();
}

let spec;
try {
  spec = JSON.parse(readFileSync(openApiPath, "utf8"));
} catch (error) {
  fail(`could not read OpenAPI spec: ${error.message}`);
}

const normalizedPath = normalizeRoutePath(pathInput, spec.paths ?? {});
if (!normalizedPath) {
  fail(`route not found in docs/api/openapi.json: ${pathInput}`);
}

const operation = spec.paths?.[normalizedPath]?.[method.toLowerCase()];
if (!operation) {
  const supported = Object.keys(spec.paths?.[normalizedPath] ?? {})
    .map((entry) => entry.toUpperCase())
    .join(", ");
  fail(
    `method ${method} is not documented for ${normalizedPath}` +
      (supported ? ` (supported: ${supported})` : ""),
  );
}

const requestJson = operation.requestBody?.content?.["application/json"] ?? null;
const responseJson = operation.responses?.["200"]?.content?.["application/json"] ?? null;

console.log(`${method} ${normalizedPath}`);
if (normalizedPath !== pathInput) {
  console.log(`matched_from: ${pathInput}`);
}

printSection("Title", operation.summary ?? null);
printSection("Tags", operation.tags?.join(", ") ?? null);
printSection("Description", operation.description ?? null);
printSection(
  "Security",
  Array.isArray(operation.security) && operation.security.length > 0
    ? "caller auth required"
    : "none",
);

if (requestJson) {
  printSection("Request Schema", schemaName(requestJson.schema));
  printSection("Request Body Description", operation.requestBody?.description ?? null);
  printSection("Request Example", pickExample(spec, requestJson));
}

if (responseJson) {
  printSection("Response Schema", schemaName(responseJson.schema));
  printSection("Response Example", pickExample(spec, responseJson));
}
