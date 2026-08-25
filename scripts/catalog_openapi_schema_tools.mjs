export const CATALOG_OPENAPI_SCHEMA_BINDINGS = [
  { canonicalFilename: "repository-readiness-reference.schema.json", componentName: "CatalogRepositoryReadinessReferenceV1" },
  { canonicalFilename: "projection-result.schema.json", componentName: "DeliveryCatalogProjectionV1" },
  { canonicalFilename: "mutation-request.schema.json", componentName: "DeliveryCatalogMutationRequestV1" },
  { canonicalFilename: "mutation-result.schema.json", componentName: "DeliveryCatalogMutationResultV1" },
  { canonicalFilename: "error.schema.json", componentName: "DeliveryCatalogErrorV1" },
];

export function catalogExternalRefMap(schemas) {
  const entries = [];
  for (const { componentName, schema } of schemas) {
    entries.push([schema.$id, componentName]);
    for (const definitionName of Object.keys(schema.$defs ?? {})) {
      entries.push([
        `${schema.$id}#/$defs/${definitionName}`,
        `${componentName}/$defs/${definitionName}`,
      ]);
    }
  }
  return Object.fromEntries(entries);
}

function projectNode(value, componentName, externalRefMap) {
  if (Array.isArray(value)) {
    return value.map((entry) => projectNode(entry, componentName, externalRefMap));
  }
  if (!value || typeof value !== "object") return value;
  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "$ref") {
      if (entry.startsWith("#/")) {
        projected.$ref = `#/components/schemas/${componentName}${entry.slice(1)}`;
      } else {
        const externalComponent = externalRefMap[entry];
        if (!externalComponent) throw new Error(`unsupported Catalog schema ref: ${entry}`);
        projected.$ref = `#/components/schemas/${externalComponent}`;
      }
      continue;
    }
    projected[key] = projectNode(entry, componentName, externalRefMap);
  }
  return projected;
}

export function projectCatalogSchemaForOpenApi({
  canonicalFilename,
  canonicalSchema,
  componentName,
  externalRefMap = {},
  existingSchema = {},
}) {
  const projected = projectNode(canonicalSchema, componentName, externalRefMap);
  projected["x-oos-canonical-schema"] = `contracts/catalog/${canonicalFilename}`;
  for (const key of ["description", "example", "examples"]) {
    if (Object.hasOwn(existingSchema, key)) projected[key] = existingSchema[key];
  }
  return projected;
}
