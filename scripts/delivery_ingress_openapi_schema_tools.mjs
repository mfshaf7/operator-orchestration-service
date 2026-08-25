export const DELIVERY_INGRESS_OPENAPI_SCHEMA_BINDINGS = [
  {
    canonicalFilename: "prototype-delivery-packet.schema.json",
    componentName: "PrototypeDeliveryPacketV1",
  },
  {
    canonicalFilename: "prototype-application-request.schema.json",
    componentName: "PrototypeDeliveryApplicationRequestV1",
  },
  {
    canonicalFilename: "prototype-application-result.schema.json",
    componentName: "PrototypeDeliveryApplicationResultV1",
  },
];

export function deliveryIngressExternalRefMap(schemas) {
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
