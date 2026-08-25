import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import {
  WORK_DESIGN_OPENAPI_SCHEMA_BINDINGS,
  projectWorkDesignSchemaForOpenApi,
  workDesignExternalRefMap,
} from "./work_design_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "work-design");
const schemas = WORK_DESIGN_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(
    readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8"),
  ),
}));
const externalRefMap = workDesignExternalRefMap(schemas);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  const projected = projectWorkDesignSchemaForOpenApi({
    canonicalFilename,
    canonicalSchema: schema,
    componentName,
    externalRefMap,
    existingSchema: spec.components.schemas[componentName],
  });
  synchronized = upsertOpenApiComponent(synchronized, componentName, projected);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "ERROR: Work Design OpenAPI schemas are not synchronized; " +
      "run npm run sync:work-design-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("Work Design OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized Work Design OpenAPI schemas");
}
