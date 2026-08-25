import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import { projectCanonicalSchemaForOpenApi } from
  "./orchestration_openapi_schema_tools.mjs";
import {
  DELIVERY_INGRESS_OPENAPI_SCHEMA_BINDINGS,
  deliveryIngressExternalRefMap,
} from "./delivery_ingress_openapi_schema_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "delivery-ingress");
const schemas = DELIVERY_INGRESS_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
  ...binding,
  schema: JSON.parse(
    readFileSync(path.join(contractRoot, binding.canonicalFilename), "utf8"),
  ),
}));
const externalRefMap = deliveryIngressExternalRefMap(
  schemas.map(({ componentName, schema }) => ({ componentName, schema })),
);
const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName, schema } of schemas) {
  const projected = projectCanonicalSchemaForOpenApi({
    canonicalFilename,
    canonicalPath: `contracts/delivery-ingress/${canonicalFilename}`,
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
      "ERROR: Delivery ingress OpenAPI schemas are not synchronized; " +
      "run npm run sync:delivery-ingress-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("Delivery ingress OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized Delivery ingress OpenAPI schemas");
}
