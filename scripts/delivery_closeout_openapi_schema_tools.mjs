export const DELIVERY_CLOSEOUT_OPENAPI_SCHEMA_BINDINGS = [
  { canonicalFilename: "command.schema.json", componentName: "DeliveryCloseoutCommandV1" },
  { canonicalFilename: "event.schema.json", componentName: "DeliveryCloseoutEventV1" },
  { canonicalFilename: "projection.schema.json", componentName: "DeliveryCloseoutProjectionV1" },
  { canonicalFilename: "result.schema.json", componentName: "DeliveryCloseoutResultV1" },
  { canonicalFilename: "error.schema.json", componentName: "DeliveryCloseoutErrorV1" },
];

export function deliveryCloseoutExternalRefMap(schemas) {
  return Object.fromEntries(schemas.flatMap(({ componentName, schema }) => [
    [schema.$id, componentName],
    ...Object.keys(schema.$defs ?? {}).map((name) => [
      `${schema.$id}#/$defs/${name}`,
      `${componentName}/$defs/${name}`,
    ]),
  ]));
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
          throw new Error(`unsupported Delivery closeout schema ref: ${entry}`);
        }
        projected.$ref = `#/components/schemas/${externalComponent}`;
      }
      continue;
    }
    projected[key] = projectNode(entry, componentName, externalRefMap);
  }
  return projected;
}

export function projectDeliveryCloseoutSchemaForOpenApi({
  canonicalFilename,
  canonicalSchema,
  componentName,
  externalRefMap,
  existingSchema = {},
}) {
  const projected = projectNode(canonicalSchema, componentName, externalRefMap);
  projected["x-oos-canonical-schema"] =
    `contracts/delivery-closeout/${canonicalFilename}`;
  for (const key of ["description", "example", "examples"]) {
    if (Object.hasOwn(existingSchema, key)) projected[key] = existingSchema[key];
  }
  return projected;
}
