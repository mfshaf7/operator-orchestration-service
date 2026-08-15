import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import {
  projectCanonicalSchemaForOpenApi,
} from "./orchestration_openapi_schema_tools.mjs";
import {
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS,
} from "./proposal_openapi_schema_tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "proposal-workflow");

const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName } of
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS) {
  const canonicalSchema = JSON.parse(
    readFileSync(path.join(contractRoot, canonicalFilename), "utf8"),
  );
  const projected = projectCanonicalSchemaForOpenApi({
    canonicalFilename,
    canonicalPath: `contracts/proposal-workflow/${canonicalFilename}`,
    canonicalSchema,
    componentName,
    existingSchema: spec.components.schemas[componentName],
  });
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projected,
  );
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "ERROR: Proposal OpenAPI schemas are not synchronized; run npm run sync:proposal-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("Proposal OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized Proposal OpenAPI schemas");
}
