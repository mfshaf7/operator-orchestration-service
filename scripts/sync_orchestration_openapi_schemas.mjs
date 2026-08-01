import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORCHESTRATION_OPENAPI_SCHEMA_BINDINGS,
  projectCanonicalSchemaForOpenApi,
} from "./orchestration_openapi_schema_tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "orchestration");

function findObjectEnd(source, objectStart) {
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  throw new Error("unterminated OpenAPI component object");
}

function componentRange(source, componentName) {
  const marker = `      "${componentName}": {`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`OpenAPI component is missing: ${componentName}`);
  }
  const objectStart = source.indexOf("{", start + marker.length - 1);
  return { start, end: findObjectEnd(source, objectStart) };
}

function renderComponent(componentName, schema) {
  const lines = JSON.stringify(schema, null, 2).split("\n");
  return lines
    .map((line, index) =>
      index === 0
        ? `      "${componentName}": ${line}`
        : `      ${line}`,
    )
    .join("\n");
}

function replaceComponent(source, componentName, schema) {
  const { start, end } = componentRange(source, componentName);
  return `${source.slice(0, start)}${renderComponent(componentName, schema)}${source.slice(end)}`;
}

function removeComponent(source, componentName) {
  if (!source.includes(`      "${componentName}": {`)) {
    return source;
  }
  const { start, end } = componentRange(source, componentName);
  let removalEnd = end;
  if (source[removalEnd] === ",") {
    removalEnd += 1;
  }
  if (source[removalEnd] === "\n") {
    removalEnd += 1;
  }
  return `${source.slice(0, start)}${source.slice(removalEnd)}`;
}

const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName } of
  ORCHESTRATION_OPENAPI_SCHEMA_BINDINGS) {
  const canonicalSchema = JSON.parse(
    readFileSync(path.join(contractRoot, canonicalFilename), "utf8"),
  );
  const projected = projectCanonicalSchemaForOpenApi({
    canonicalFilename,
    canonicalSchema,
    componentName,
    existingSchema: spec.components.schemas[componentName],
  });
  synchronized = replaceComponent(synchronized, componentName, projected);
}

for (const obsoleteComponent of [
  "OrchestrationIdentifier",
  "OrchestrationApprovalRef",
]) {
  synchronized = removeComponent(synchronized, obsoleteComponent);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "ERROR: orchestration OpenAPI schemas are not synchronized; run npm run sync:orchestration-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("orchestration OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized orchestration OpenAPI schemas");
}
