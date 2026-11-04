// Extend the existing operator route with an explicit authority alternative.
// Existing pending Git requests keep their schema, review and receipt contract.
export function addInstanceIntakeSchemas(schemas, { nativeRequest, nativeReceipt }) {
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const text = { type: "string", minLength: 1 }, digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
  const nullable = shape => ({ oneOf: [shape, { type: "null" }] });
  const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
  const authority = object({ kind: { const: "internal-instance-record" }, instance_id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$" },
    record_id: { type: "string", pattern: "^repo:[a-z0-9][a-z0-9._-]{0,185}$" } });
  schemas.InstanceRepositoryIntakeRequest = nativeRequest;
  schemas.InstanceOperationalRecordReceipt = nativeReceipt;
  const preparation = structuredClone(schemas.WorkspaceIntakePreparation);
  Object.assign(preparation.properties, { authority_kind: { const: "internal-instance-record" }, canonical_authority: authority,
    custody_request_id: text, policy_ref: nativeRequest.properties.policy_ref, expected_state: nativeRequest.properties.expected_state,
    source_candidate: ref("WorkspaceIntakeSourceCandidate") });
  preparation.required.push("authority_kind", "custody_request_id", "policy_ref", "source_candidate");
  preparation.properties.target = nativeRequest.properties.target;
  schemas.WorkspaceIntakePreparation = { oneOf: [schemas.WorkspaceIntakePreparation, preparation] };
  const command = structuredClone(schemas.WorkspaceIntakeCommand);
  command.properties.request = ref("InstanceRepositoryIntakeRequest");
  schemas.WorkspaceIntakeCommand = { oneOf: [schemas.WorkspaceIntakeCommand, command] };
  const legacyResult = schemas.WorkspaceIntakeResult, result = structuredClone(legacyResult);
  Object.assign(result.properties, { authority_kind: { const: "internal-instance-record" }, canonical_authority: authority, cancel_allowed: { type: "boolean" },
    request: ref("InstanceRepositoryIntakeRequest"), readiness: { type: "null" }, review: { type: "null" },
    receipt: nullable(ref("InstanceOperationalRecordReceipt")),
    readback: nullable(object({ record: { type: "object" }, receipt: ref("InstanceOperationalRecordReceipt") })),
    source_attestation: object({ candidate_digest: digest, source: nativeRequest.properties.source,
      evidence_refs: { type: "array", minItems: 1, uniqueItems: true, items: text }, current_custody_digest: digest,
      attested_by: { const: "operator-orchestration-service" }, attested_at: { type: "string", format: "date-time" } }),
  });
  result.required.push("authority_kind", "canonical_authority", "cancel_allowed");
  result.properties.history.items.properties.details = nullable({ oneOf: [object({ receipt_digest: digest }), object({ failure: text })] });
  result.properties.status = { enum: ["accepted", "evaluating", "preparing", "cancelled", "requires-action", "succeeded"] };
  result.properties.next_action = { enum: ["continue", "complete", "submit-corrected-request", "restore-dependency-and-retry"] };
  schemas.WorkspaceIntakeResult = { properties: { status: legacyResult.properties.status }, oneOf: [legacyResult, result] };
  const page = schemas.WorkspaceIntakeRequestPage.oneOf[0], entry = structuredClone(page.properties.records.items);
  entry.required.push("authority_kind", "custody_request_id");
  Object.assign(entry.properties, { authority_kind: { const: "internal-instance-record" }, custody_request_id: text });
  page.properties.records.items = { oneOf: [page.properties.records.items, entry] };
}
