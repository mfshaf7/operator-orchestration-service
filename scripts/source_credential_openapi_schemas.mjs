import { SOURCE_CREDENTIAL_ACTIONS, SOURCE_CREDENTIAL_RECEIPT_FIELDS, SOURCE_INTENT_FIELDS } from "../src/platform-operation/source-credentials.js";
import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import { SOURCE_OWNER_BOOTSTRAP_PATHS } from "../src/repository-owner-bootstrap/scaffold.js";

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const id = { type: "string", minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/@+\\-]*$" };
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const commit = { type: "string", pattern: "^[0-9a-f]{40}$" };
const timestamp = { type: "string", format: "date-time" };
const nullable = schema => ({ oneOf: [schema, { type: "null" }] });
const closed = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const repository = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*$" };
const positive = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const prototypeId = { type: "string", pattern: "^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$" };
const workItem = { type: "string", pattern: "^work-item-[1-9][0-9]*$" };
const coordinates = {
  repository, repository_id: positive, installation_id: positive,
  landing_unit_id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{2,127}$" },
  branch: { type: "string", pattern: "^(?!main$)(?!.*\\.\\.)(?!.*//)[a-z0-9](?:[a-z0-9._/-]*[a-z0-9._-])?$" },
  fetched_base: commit, human_reviewer_id: id,
};
export const sourceCredentialSchemas = {
  SourceCredentialSubject: { oneOf: [
    closed({ kind: { const: "delivery" }, work_item_ref: workItem, snapshot_digest: digest }),
    closed({ kind: { const: "prototype" }, prototype_id: prototypeId, registry_ref: { type: "string", pattern: "^record://prototypes/[a-z0-9]+(?:-[a-z0-9]+)*$" },
      registry_revision: commit, source_ref: { type: "string", pattern: "^repo://[a-z0-9][a-z0-9._/-]*$" }, source_revision: commit }),
  ] },
  SourceCredentialIntent: closed({ schema_version: { const: 1 }, purpose: { const: "ordinary-source" }, intent_id: id,
    caller_id: id, operator_id: id, subject: ref("SourceCredentialSubject"), source_start_digest: digest,
    ...coordinates, expires_at: timestamp, supersedes_intent_digest: nullable(digest),
  }, [...SOURCE_INTENT_FIELDS]),
  SourceCredentialInput: closed({ source_intent: ref("SourceCredentialIntent"), session_id: nullable(id) }),
  SourceCredentialReceipt: closed({
    schema_version: { const: 1 }, artifact_type: { const: "source-intent-credential-receipt" }, command_id: id,
    action: { enum: SOURCE_CREDENTIAL_ACTIONS }, outcome: { enum: ["issued", "renewed", "current", "revoked"] },
    source_intent_digest: digest, source_intent_id: id, supersedes_intent_digest: nullable(digest),
    subject: ref("SourceCredentialSubject"), session_id: nullable(id), ...coordinates,
    caller_id: id, operator_id: id, source_start_digest: digest, identity_id: id, logical_agent_id: id,
    provider_principal: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9-]*\\[bot\\]$" }, app_id: positive, definition_digest: digest,
    permissions: closed({ metadata: { const: "read" }, contents: { const: "write" }, pull_requests: { const: "write" }, checks: { const: "read" } }),
    token_expires_at: nullable(timestamp), authorization_expires_at: timestamp, recorded_at: timestamp,
    secret_values_embedded: { const: false }, receipt_digest: digest,
  }, [...SOURCE_CREDENTIAL_RECEIPT_FIELDS]),
  SourceCredentialPreparationRequest: closed({ preparation: closed({
    preparation_id: { ...id, maxLength: 190 }, subject: { oneOf: [
      closed({ kind: { const: "delivery" }, work_item_ref: workItem }),
      closed({ kind: { const: "prototype" }, prototype_id: prototypeId, source_request_id: id }),
      closed({ kind: { const: "repository-bootstrap" }, owner_repo: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" }, source_request_id: id }),
    ] }, decision: nullable({ type: "object" }), expires_at: timestamp, supersedes_intent_digest: nullable(digest),
  }) }),
  SourceCredentialPreparation: closed({ schema_version: { const: 1 }, workflow_id: { const: "source-credential-preparation" },
    intent_id: id, source_intent: ref("SourceCredentialOperationIntent"), source_intent_digest: digest, session_id: nullable(id), created_at: timestamp,
    operation_refs: closed({ issue: nullable(id), revoke: nullable(id) }),
    start_decision: nullable(ref("DeliveryArtWorkSessionDecisionV1")),
    authorization: closed({ state: { enum: ["prepared", "approved", "expired", "revocation-requested", "revoked"] }, approval_ref: nullable(id), credential_receipt: nullable(ref("SourceCredentialOperationReceipt")) }),
    authority: { const: "operator-orchestration-service" }, secret_values_embedded: { const: false },
  }),
  SourceCredentialPreparationList: closed({ workflow_id: { const: "source-credential-preparation-list" },
    preparations: { type: "array", maxItems: 200, items: ref("SourceCredentialPreparation") } }),
};

// Keep ordinary schemas closed and unchanged. Only the authenticated Platform
// operation boundary dispatches the explicitly marked repository purpose.
sourceCredentialSchemas.SourceBootstrapSubject = closed({ kind: { const: "repository-bootstrap" },
  owner_repo: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
  intake_entry_ref: closed({ id: { type: "string", pattern: "^repo:[a-z0-9][a-z0-9._-]*$" }, version: positive, digest }),
  custody_receipt_digest: digest, template_digest: digest, plan_digest: digest, decision_ref: id,
  workflow_write: { type: "boolean" }, workflow_approval_ref: nullable(id),
  allowed_paths: { type: "array", minItems: 1, maxItems: SOURCE_OWNER_BOOTSTRAP_PATHS.length, uniqueItems: true, items: { enum: SOURCE_OWNER_BOOTSTRAP_PATHS } },
});
sourceCredentialSchemas.SourceBootstrapIntent = closed({ ...sourceCredentialSchemas.SourceCredentialIntent.properties,
  purpose: { const: "trusted-owner-bootstrap" }, subject: ref("SourceBootstrapSubject") });
sourceCredentialSchemas.SourceCredentialOperationIntent = { oneOf: [ref("SourceCredentialIntent"), ref("SourceBootstrapIntent")] };
sourceCredentialSchemas.SourceCredentialOperationInput = { oneOf: [ref("SourceCredentialInput"),
  closed({ source_intent: ref("SourceBootstrapIntent"), session_id: nullable(id) })] };
const bootstrapPermissions = { ...sourceCredentialSchemas.SourceCredentialReceipt.properties.permissions.properties, workflows: { const: "write" } };
sourceCredentialSchemas.SourceBootstrapReceipt = closed({ ...sourceCredentialSchemas.SourceCredentialReceipt.properties,
  purpose: { const: "trusted-owner-bootstrap" }, subject: ref("SourceBootstrapSubject"),
  permissions: { oneOf: [sourceCredentialSchemas.SourceCredentialReceipt.properties.permissions, closed(bootstrapPermissions)] },
});
sourceCredentialSchemas.SourceCredentialOperationReceipt = { oneOf: [ref("SourceCredentialReceipt"), ref("SourceBootstrapReceipt")] };

export const sourcePreparationRequestExample = { preparation: { preparation_id: "delivery-42-source-start", subject: { kind: "delivery", work_item_ref: "work-item-42" },
  decision: { schema_version: 1, artifact_type: "delivery_art_work_session_decision", work_item_id: "work-item-42", covered_work_item_ids: ["work-item-42"],
    caller_id: "governance-operations-console", operator: { id: "operator:workspace-owner", decision_source: "operator" },
    landing_unit: { id: "delivery-42-source", decision: "feature_single_landing_unit", split_reason: "The same owner, validation and rollback boundary cover this feature.",
      base_ref: "origin/main", branch: "topic/source", rollback_boundary: "Revert the reviewed source Landing Unit." },
    architecture: { required: false, artifact_location: null }, human_gate_work_item_ids: { security_acceptance: [] },
  }, expires_at: "2026-10-18T12:00:00.000Z", supersedes_intent_digest: null } };
export const sourcePreparationExample = {
  schema_version: 1, workflow_id: "source-credential-preparation", intent_id: "source-intent:delivery-42-source-start",
  source_intent: { schema_version: 1, purpose: "ordinary-source", intent_id: "source-intent:delivery-42-source-start", caller_id: "operator-orchestration-service",
    operator_id: "operator:workspace-owner", subject: { kind: "delivery", work_item_ref: "work-item-42", snapshot_digest: `sha256:${"a".repeat(64)}` },
    source_start_digest: `sha256:${"b".repeat(64)}`, repository: "example/source", repository_id: 42, installation_id: 123,
    landing_unit_id: "delivery-42-source", branch: "topic/source", fetched_base: "c".repeat(40), human_reviewer_id: "reviewer",
    expires_at: "2026-10-18T12:00:00.000Z", supersedes_intent_digest: null },
  source_intent_digest: `sha256:${"d".repeat(64)}`, session_id: null, created_at: "2026-10-18T10:00:00.000Z",
  operation_refs: { issue: null, revoke: null },
  start_decision: sourcePreparationRequestExample.preparation.decision,
  authorization: { state: "prepared", approval_ref: null, credential_receipt: null }, authority: "operator-orchestration-service", secret_values_embedded: false,
};
sourcePreparationExample.source_intent_digest = canonicalDigest(sourcePreparationExample.source_intent);
