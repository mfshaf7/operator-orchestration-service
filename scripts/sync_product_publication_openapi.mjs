import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  addConsoleSourceProjectionMedia,
  upsertConsoleCompatibleOpenApiPath,
} from "./console_source_authority_openapi_tools.mjs";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";
import {
  createProductPublicationEvaluation,
  createProductPublicationPacket,
  createProductPublicationReceipt,
  productPublicationDigest,
} from "../src/product-publication/contracts.js";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const original = readFileSync(openapiPath, "utf8");
let source = original;
const check = process.argv.includes("--check");
const components = {
  "command.schema.json": "ProductPublicationCommand",
  "evaluation.schema.json": "ProductPublicationEvaluation",
  "readiness.schema.json": "ProductPublicationReadiness",
  "packet.schema.json": "ProductPublicationPacket",
  "receipt.schema.json": "ProductPublicationReceipt",
};
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

function project(value, currentName) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, currentName));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["$schema", "$id"].includes(key))
    .map(([key, entry]) => [
      key,
      key === "$ref" && entry.startsWith("#/$defs/")
        ? `#/components/schemas/${currentName}/$defs/${entry.slice(8)}`
        : project(entry, currentName),
    ]));
}

for (const [file, name] of Object.entries(components)) {
  const schema = JSON.parse(readFileSync(
    new URL(`contracts/product-publication/${file}`, root),
    "utf8",
  ));
  source = upsertOpenApiComponent(source, name, project(schema, name));
}
source = upsertOpenApiComponent(source, "ProductLifecycleMaintenanceProjection", {
  type: "object",
  required: [
    "schema_version", "product_id", "lifecycle", "publication", "owner_route",
    "evidence_posture", "operational_health", "history", "next_action", "implications",
  ],
  properties: {
    schema_version: { const: 1 },
    product_id: { type: "string", pattern: "^product:[a-z0-9][a-z0-9._-]*$" },
    lifecycle: {
      type: "object",
      required: ["state", "record_version", "record_digest", "receipt_ref", "history_event_ref"],
      properties: {
        state: { enum: ["not-projected", "active", "suspended", "retired"] },
        record_version: { type: ["integer", "null"], minimum: 1 },
        record_digest: { type: ["string", "null"] },
        receipt_ref: { type: ["object", "null"] },
        history_event_ref: { type: ["object", "null"] },
      },
      additionalProperties: false,
    },
    publication: {
      type: "object",
      required: ["posture", "version", "receipt_ref"],
      properties: {
        posture: { enum: ["unlisted", "internal", "client", "public", "archived"] },
        version: { type: "integer", minimum: 0 },
        receipt_ref: { type: ["object", "null"] },
      },
      additionalProperties: false,
    },
    owner_route: {
      type: "object",
      required: ["repo", "revision", "manifest_id", "manifest_digest"],
      properties: {
        repo: { type: "string" },
        revision: { type: "string", pattern: "^[0-9a-f]{40}$" },
        manifest_id: { type: "string" },
        manifest_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      },
      additionalProperties: false,
    },
    evidence_posture: {
      type: "object",
      required: ["state", "findings", "valid_until"],
      properties: {
        state: { enum: ["ready", "stale", "blocked"] },
        findings: { type: "array", items: { type: "object" } },
        valid_until: { type: "string", format: "date-time" },
      },
      additionalProperties: false,
    },
    operational_health: { const: "not-projected" },
    history: { type: "array", maxItems: 50, items: { type: "object" } },
    next_action: { enum: ["refresh-portfolio-projection", "correct-owner-evidence-and-submit-new-request"] },
    implications: {
      type: "object",
      required: ["runtime_restored", "release_restored", "access_restored", "security_acceptance_granted"],
      properties: {
        runtime_restored: { const: false },
        release_restored: { const: false },
        access_restored: { const: false },
        security_acceptance_granted: { const: false },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
});
source = upsertOpenApiComponent(source, "ProductPublicationProjection", {
  type: "object",
  required: [
    "schema_version", "workflow_id", "request_id", "revision", "resolution",
    "state", "command_digest", "command", "evaluation", "readiness",
    "packet", "receipt", "receipt_digest", "owner_receipt", "maintenance_projection", "history",
    "next_action", "cross_boundary_authority_granted",
  ],
  properties: {
    schema_version: { const: 1 },
    workflow_id: { const: "product-publication" },
    request_id: { type: "string" },
    revision: { const: 1 },
    resolution: { enum: ["created", "replayed", "read"] },
    state: { enum: ["applied", "rejected"] },
    command_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    command: ref("ProductPublicationCommand"),
    evaluation: ref("ProductPublicationEvaluation"),
    readiness: {
      type: "object",
      required: ["readiness", "ledger"],
      properties: {
        readiness: ref("ProductPublicationReadiness"),
        ledger: { type: "object" },
      },
    },
    packet: ref("ProductPublicationPacket"),
    receipt: ref("ProductPublicationReceipt"),
    receipt_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    owner_receipt: { type: "object" },
    maintenance_projection: ref("ProductLifecycleMaintenanceProjection"),
    history: { type: "array", items: { type: "object" } },
    next_action: { enum: ["refresh-portfolio-projection", "correct-owner-evidence-and-submit-new-request"] },
    cross_boundary_authority_granted: { const: false },
  },
  additionalProperties: false,
});

const commandExample = {
  schema_version: 1,
  artifact_type: "product-publication-command",
  request_id: "product-publication-request:governance-operations-console:1",
  idempotency_key: "product-publication:governance-operations-console:1",
  session_ref: "session:portfolio:1",
  execution_ref: "execution:portfolio:1",
  authority_revision: "a".repeat(40),
  manifest_source: {
    repo: "governance-operations-console",
    path: "product-publication/manifest.json",
    source_revision: "b".repeat(40),
    manifest_revision: "c".repeat(40),
    manifest_digest: `sha256:${"d".repeat(64)}`,
  },
  action: "publish",
  expected_publication_version: 0,
  current_publication_posture: "unlisted",
  target_publication: {
    posture: "internal",
    listing_scope: "workspace-portfolio",
    audience: "workspace-operators",
    access_class: "workspace-authenticated",
  },
  previous_receipt: null,
  operator_id: "operator:mfshaf7",
  operator_decision: {
    decision: "approve",
    reason: "Publish the reviewed internal portfolio record.",
    decided_at: "2026-10-12T05:00:00Z",
  },
  security_decision: {
    uri: "security-architecture://product-publication/decisions/console-internal-v1",
    digest: `sha256:${"e".repeat(64)}`,
    revision: "f".repeat(40),
  },
  requested_at: "2026-10-12T05:01:00Z",
};
const evaluationExample = createProductPublicationEvaluation(commandExample);
const readinessExample = {
  schema_version: 1,
  artifact_type: "product-publication-readiness",
  readiness_id: "product-publication-readiness:governance-operations-console:1",
  evaluated_at: "2026-10-12T05:02:00Z",
  expires_at: "2026-10-12T05:17:00Z",
  request_ref: {
    id: evaluationExample.request.request_id,
    digest: evaluationExample.request.request_digest,
    idempotency_key: evaluationExample.request.idempotency_key,
  },
  product_id: "product:governance-operations-console",
  manifest_binding: {
    manifest_id: "product-publication-manifest:governance-operations-console:1",
    manifest_digest: commandExample.manifest_source.manifest_digest,
    owner_repo: commandExample.manifest_source.repo,
    owner_revision: commandExample.manifest_source.source_revision,
    manifest_revision: commandExample.manifest_source.manifest_revision,
    path: commandExample.manifest_source.path,
  },
  authority_binding: {
    revision: commandExample.authority_revision,
    contract_digest: `sha256:${"1".repeat(64)}`,
    products_digest: `sha256:${"2".repeat(64)}`,
  },
  target_publication: commandExample.target_publication,
  outcome: "ready",
  findings: [],
  secret_values_embedded: false,
};
readinessExample.readiness_digest = productPublicationDigest(readinessExample, "readiness_digest");
const readinessRef = {
  uri: `wgcf://product-publication/readiness-receipts/${readinessExample.readiness_digest.slice(7)}`,
  digest: readinessExample.readiness_digest,
};
const packetExample = createProductPublicationPacket({
  command: commandExample,
  evaluation: evaluationExample,
  readiness: readinessExample,
  readinessRef,
});
const receiptExample = createProductPublicationReceipt({
  command: commandExample,
  packet: packetExample,
  readiness: readinessExample,
  recordedAt: "2026-10-12T05:03:00Z",
});
const receiptDigest = productPublicationDigest(receiptExample);
const projectionExample = {
  schema_version: 1,
  workflow_id: "product-publication",
  request_id: commandExample.request_id,
  revision: 1,
  resolution: "created",
  state: "applied",
  command_digest: productPublicationDigest(commandExample),
  command: commandExample,
  evaluation: evaluationExample,
  readiness: {
    readiness: readinessExample,
    ledger: {
      resolution: "read",
      state: "durable",
      ref: readinessRef,
      authority_revision: commandExample.authority_revision,
    },
  },
  packet: packetExample,
  receipt: receiptExample,
  receipt_digest: receiptDigest,
  owner_receipt: { uri: receiptExample.owner_receipt_ref, digest: receiptDigest },
  maintenance_projection: {
    schema_version: 1,
    product_id: readinessExample.product_id,
    lifecycle: {
      state: "not-projected",
      record_version: null,
      record_digest: null,
      receipt_ref: null,
      history_event_ref: null,
    },
    publication: {
      posture: receiptExample.publication_posture,
      version: receiptExample.publication_version,
      receipt_ref: { id: receiptExample.receipt_id, digest: receiptDigest },
    },
    owner_route: {
      repo: readinessExample.manifest_binding.owner_repo,
      revision: readinessExample.manifest_binding.owner_revision,
      manifest_id: readinessExample.manifest_binding.manifest_id,
      manifest_digest: readinessExample.manifest_binding.manifest_digest,
    },
    evidence_posture: {
      state: readinessExample.outcome,
      findings: readinessExample.findings,
      valid_until: readinessExample.expires_at,
    },
    operational_health: "not-projected",
    history: [],
    next_action: "refresh-portfolio-projection",
    implications: {
      runtime_restored: false,
      release_restored: false,
      access_restored: false,
      security_acceptance_granted: false,
    },
  },
  history: [{ sequence: 1, event_type: "publication-applied", occurred_at: receiptExample.recorded_at }],
  next_action: "refresh-portfolio-projection",
  cross_boundary_authority_granted: false,
};
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 500, 502, 503].map((status) => [String(status), {
  description: "Bounded validation, authorization, conflict, upstream-integrity, or availability failure.",
}]));
const metadata = {
  security: [{ CallerIdHeader: [], CallerSecretHeader: [] }],
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-surface": "product-publication",
  "x-oos-workflow-family": "product-publication",
  "x-oos-primary-caller": "governance-operations-console",
  tags: ["Product Publication"],
};
const response = (description) => ({
  description,
  content: { "application/json": { schema: ref("ProductPublicationProjection"), example: projectionExample } },
});

source = upsertOpenApiPath(source, "/v1/product-publications", {
  post: {
    ...metadata,
    operationId: "submitProductPublication",
    summary: "Journal one exact Product Publication decision",
    description: "Obtains and rereads WGCF readiness, binds exact operator and Security decision evidence, and emits one immutable OOS terminal receipt without granting another control plane's authority.",
    parameters: [{ name: "x-oos-operator-id", in: "header", required: true, schema: { type: "string" } }],
    requestBody: {
      required: true,
      description: "Submit one operator-bound request with exact owner, WGCF, Security, version, and replay evidence.",
      content: { "application/json": { schema: ref("ProductPublicationCommand"), example: commandExample } },
    },
    responses: { 201: response("Created or safely replayed Product Publication projection."), ...errors },
  },
});
source = upsertConsoleCompatibleOpenApiPath(
  source,
  "/v1/product-publications/{request_id}",
  addConsoleSourceProjectionMedia({
    get: {
      ...metadata,
      operationId: "getProductPublication",
      summary: "Read one caller-owned Product Publication receipt",
      description: "Returns the exact readiness, packet, terminal receipt, replay identity, and next action for one caller-owned request.",
      parameters: [{ name: "request_id", in: "path", required: true, schema: { type: "string" } }],
      responses: { 200: response("Current immutable Product Publication projection."), ...errors },
    },
  }, "get"),
);

if (check) {
  if (source !== original) throw new Error("Product Publication OpenAPI projection is stale.");
} else {
  writeFileSync(openapiPath, source);
}
console.log(`Product Publication OpenAPI ${check ? "verified" : "synchronized"}.`);
