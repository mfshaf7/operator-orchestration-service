import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONSOLE_SOURCE_PROJECTION_COMPONENT,
  addConsoleSourceProjectionMedia,
} from "./console_source_authority_openapi_tools.mjs";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "console-source-authority");
const original = readFileSync(openApiPath, "utf8");
const openApi = JSON.parse(original);
const manifest = JSON.parse(
  readFileSync(path.join(contractRoot, "manifest.json"), "utf8"),
);
const projectionSchema = JSON.parse(
  readFileSync(
    path.join(contractRoot, manifest.projection_schema),
    "utf8",
  ),
);
delete projectionSchema.$schema;
delete projectionSchema.$id;
projectionSchema["x-oos-canonical-schema"] =
  "contracts/console-source-authority/console-source-projection.schema.json";

function projectComponentReferences(value) {
  if (Array.isArray(value)) return value.map(projectComponentReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        key === "$ref" &&
        typeof entry === "string" &&
        entry.startsWith("#/$defs/")
      ) {
        return [
          key,
          `#/components/schemas/${CONSOLE_SOURCE_PROJECTION_COMPONENT}/${entry.slice(2)}`,
        ];
      }
      return [key, projectComponentReferences(entry)];
    }),
  );
}

let synchronized = upsertOpenApiComponent(
  original,
  CONSOLE_SOURCE_PROJECTION_COMPONENT,
  projectComponentReferences(projectionSchema),
);

for (const { method, path: routePath } of manifest.projection_routes) {
  const pathItem = openApi.paths[routePath];
  if (!pathItem?.[method]) {
    throw new Error(
      `Console source projection route is missing: ${method.toUpperCase()} ${routePath}`,
    );
  }
  synchronized = upsertOpenApiPath(
    synchronized,
    routePath,
    addConsoleSourceProjectionMedia(pathItem, method),
  );
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "docs/api/openapi.json Console source-authority projection is stale",
    );
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
