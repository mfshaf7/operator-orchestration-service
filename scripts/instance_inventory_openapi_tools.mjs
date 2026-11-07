const ref = name => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1 }, date = { type: "string", format: "date-time" };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const nullable = shape => ({ oneOf: [shape, { type: "null" }] });
const authority = object({ kind: { const: "internal-instance-record" }, instance_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$" } });
const recordAuthority = { ...authority, required: [...authority.required, "record_id"], properties: { ...authority.properties, record_id: { type: "string", pattern: "^repo:[a-z0-9][a-z0-9._-]{0,185}$" } } };

export function extendInstanceInventoryWorkflow(schemas, prefix, requestSchema) {
  const nativePreparation = object({ schema_version: { const: 1 }, workflow_id: schemas[`${prefix}Preparation`].properties.workflow_id,
    authority_kind: { const: "internal-instance-record" }, authority_revision: requestSchema.properties.policy_ref.properties.revision,
    canonical_authority: recordAuthority, policy_ref: requestSchema.properties.policy_ref, expected_state: requestSchema.properties.expected_state,
    target: requestSchema.properties.target, current_record: { type: "object", minProperties: 1 },
    latest_receipt_ref: object({ version: { type: "integer", minimum: 1 }, digest, action: text }), canonical_mutation: { const: false },
    ...(prefix === "WorkspaceInventory" ? { intake_entry_ref: object({ id: text, version: { type: "integer", minimum: 1 }, digest }),
      candidate: { type: "object", minProperties: 1 } } : {}),
  });
  const command = structuredClone(schemas[`${prefix}Command`]);
  command.properties.request = ref("InstanceRepositoryInventoryRequest");
  const legacy = schemas[`${prefix}Result`], result = structuredClone(legacy);
  Object.assign(result.properties, { authority_kind: { const: "internal-instance-record" }, canonical_authority: recordAuthority,
    cancel_allowed: { type: "boolean" }, request: ref("InstanceRepositoryInventoryRequest"), readiness: { type: "null" }, review: { type: "null" },
    readback: nullable(object({ record: { type: "object" }, receipt: ref("InstanceOperationalRecordReceipt") })),
    receipt: nullable(ref("InstanceOperationalRecordReceipt")), ...(prefix === "WorkspaceInventoryLifecycle" ? { merged_state: { type: "null" } } : {}),
    status: { enum: ["accepted", "preparing", "cancelled", "blocked", "succeeded"] },
  });
  result.required.push("authority_kind", "canonical_authority", "cancel_allowed");
  for (const [suffix, native] of [["Preparation", nativePreparation], ["Command", command], ["Result", result]]) {
    schemas[`${prefix}${suffix}`] = { oneOf: [schemas[`${prefix}${suffix}`], native] };
  }
}

export function instanceInventoryPageSchema(record, candidate) {
  const extend = schema => ({ ...schema, required: [...schema.required, "authority_kind", "canonical_authority"], properties: { ...schema.properties,
    authority_kind: { const: "internal-instance-record" }, canonical_authority: recordAuthority,
    provider_repository: object({provider: {const: "github"}, provider_repository_id: {type: "string", pattern: "^[1-9][0-9]*$"},
      full_name: {type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"}}) } });
  return { oneOf: [object({ schema_version: { const: 1 }, mode: { const: "not-configured" }, projected_at: date }),
    object({ schema_version: { const: 1 }, mode: { const: "current" }, artifact_type: { const: "instance-repository-registry-page" },
      authority, selection: object({ query: { type: "string", maxLength: 128 }, scope: { enum: ["inventory", "eligible"] } }),
      after: nullable(text), next_after: nullable(text), projected_at: date, projection_digest: digest,
      counts: object({ intake: object({ "out-of-scope": { type: "integer", minimum: 0 }, proposed: { type: "integer", minimum: 0 }, admitted: { type: "integer", minimum: 0 } }),
        inventory: object({ active: { type: "integer", minimum: 0 }, suspended: { type: "integer", minimum: 0 }, retired: { type: "integer", minimum: 0 } }) }),
      records: { type: "array", maxItems: 100, items: extend(record) }, eligible_promotions: { type: "array", maxItems: 100, items: extend(candidate) },
    }),
  ] };
}
