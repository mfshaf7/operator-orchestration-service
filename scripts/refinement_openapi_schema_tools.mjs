export const REFINEMENT_OPENAPI_SCHEMA_BINDINGS = [
  { canonicalFilename: "packet.schema.json", componentName: "RefinementPacketV1" },
  { canonicalFilename: "assist-request.schema.json", componentName: "RefinementAssistRequestV1" },
  { canonicalFilename: "assist-result.schema.json", componentName: "RefinementAssistResultV1" },
  { canonicalFilename: "apply-request.schema.json", componentName: "RefinementApplyRequestV1" },
  { canonicalFilename: "apply-receipt.schema.json", componentName: "RefinementApplyReceiptV1" },
  { canonicalFilename: "run-projection.schema.json", componentName: "RefinementRunProjectionV1" },
  { canonicalFilename: "projection-result.schema.json", componentName: "RefinementProjectionResultV1" },
  { canonicalFilename: "error.schema.json", componentName: "RefinementErrorV1" },
];

export function refinementExternalRefMap(schemas) {
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
        if (!externalComponent) {
          throw new Error(`unsupported Refinement schema ref: ${entry}`);
        }
        projected.$ref = `#/components/schemas/${externalComponent}`;
      }
      continue;
    }
    projected[key] = projectNode(entry, componentName, externalRefMap);
  }
  return projected;
}

export function projectRefinementSchemaForOpenApi({
  canonicalFilename,
  canonicalSchema,
  componentName,
  externalRefMap = {},
  existingSchema = {},
}) {
  const projected = projectNode(canonicalSchema, componentName, externalRefMap);
  projected["x-oos-canonical-schema"] = `contracts/refinement/${canonicalFilename}`;
  for (const key of ["description", "example", "examples"]) {
    if (Object.hasOwn(existingSchema, key)) projected[key] = existingSchema[key];
  }
  return projected;
}
