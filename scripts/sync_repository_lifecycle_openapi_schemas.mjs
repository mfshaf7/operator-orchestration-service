import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  lifecycleArtifactReference,
  repositoryLifecycleAuthority,
  withRepositoryLifecycleIntegrity,
} from "../src/repository-lifecycle/contracts.js";
import { createRepositoryLifecycleService } from "../src/repository-lifecycle/service.js";
import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(root, "docs", "api", "openapi.json");
const contractRoot = path.join(root, "contracts", "repository-lifecycle");
const workflowRoot = path.join(root, "contracts", "repository-lifecycle-workflow");
const bindings = [
  ["RepositoryLifecycleRequestV1", contractRoot, "repository-lifecycle-request.schema.json"],
  ["RepositoryLifecycleDecisionV1", contractRoot, "repository-lifecycle-decision.schema.json"],
  ["RepositoryLifecycleReceiptV1", contractRoot, "repository-lifecycle-receipt.schema.json"],
  ["RepositoryLifecycleAuditV1", contractRoot, "repository-lifecycle-audit.schema.json"],
  ["RepositoryLifecycleWorkflowResultV1", workflowRoot, "result.schema.json"],
];
const refMap = new Map([
  ["https://workspace-governance.local/schemas/repository-lifecycle-request.schema.json", "RepositoryLifecycleRequestV1"],
  ["https://workspace-governance.local/schemas/repository-lifecycle-decision.schema.json", "RepositoryLifecycleDecisionV1"],
  ["https://workspace-governance.local/schemas/repository-lifecycle-receipt.schema.json", "RepositoryLifecycleReceiptV1"],
  ["https://workspace-governance.local/schemas/repository-lifecycle-audit.schema.json", "RepositoryLifecycleAuditV1"],
]);

function project(value, componentName) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, componentName));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "$ref" && refMap.has(entry)) {
      output[key] = `#/components/schemas/${refMap.get(entry)}`;
    } else if (key === "$ref" && entry.startsWith("#/$defs/")) {
      output[key] = `#/components/schemas/${componentName}/${entry.slice(2)}`;
    } else {
      output[key] = project(entry, componentName);
    }
  }
  return output;
}

async function examples() {
  const timestamp = "2026-08-30T03:00:00.000Z";
  const authority = repositoryLifecycleAuthority();
  const reference = (name, fill) => ({
    uri: `https://workspace-governance.local/${name}`,
    digest: `sha256:${fill.repeat(64)}`,
  });
  const request = {
    schema_version: 1,
    artifact_type: "repository_lifecycle_request",
    request_id: "repository-lifecycle-request:archive-example-001",
    requested_at: timestamp,
    action: "archive-provider",
    operator_ref: reference("operators/example", "1"),
    workflow: {
      workflow_id: "repository-lifecycle",
      workflow_version: "1",
      execution_id: "repository-lifecycle-archive-example-001",
    },
    repository_identity: {
      provider: "github",
      provider_repository_id: "123456789",
    },
    current_state: {
      custody_state: "linked",
      workspace_owner_ref: "repo:example-repository",
      provider_lifecycle_state: "active",
      workspace_record_state: "active",
      custody_version: "custody-v1",
      provider_version: "etag-before",
    },
    target: {
      workspace_owner_ref: null,
      provider_lifecycle_state: "archived",
      workspace_record_state: null,
    },
    impact: {
      impact_assessment_ref: reference("impact/archive-example-001", "2"),
      finding_count: 0,
      blocking_finding_count: 0,
      blocker_disposition: null,
    },
    authority: {
      policy_profile_ref: { uri: authority.uri, digest: authority.digest },
      approval_ref: reference("approvals/archive-example-001", "3"),
      source_owner_acceptance_ref: null,
      target_owner_acceptance_ref: null,
      provider_credential_binding_ref: reference(
        "credential-bindings/github-app/repository-lifecycle",
        "4",
      ),
    },
    reversal_of_receipt_ref: null,
    correlation: {
      correlation_id: "repository-lifecycle-archive-example-001",
      causation_id: null,
    },
    idempotency_key: "repository-lifecycle-archive-example-001",
  };
  request.request_digest = canonicalDigest(request);

  const decision = withRepositoryLifecycleIntegrity({
    schema_version: 1,
    artifact_type: "repository_lifecycle_decision",
    decision_id: "repository-lifecycle-decision:0123456789abcdef01234567",
    request_ref: {
      uri: `wgcf://requests/repository-lifecycle/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    evaluated_at: timestamp,
    policy_version: "repository-lifecycle/v1",
    action: request.action,
    outcome: "allowed",
    current_state: structuredClone(request.current_state),
    approved_target: structuredClone(request.target),
    impact: {
      ...structuredClone(request.impact),
      downstream_mutation: "none",
    },
    required_human_gates: [
      "exact-operator-approval",
      "governed-provider-credential-binding",
    ],
    findings: [],
    obligations: ["fresh-readback-required", "immutable-receipt-required"],
    next_action: "archive-provider",
  });
  const decisionRef = lifecycleArtifactReference(
    "wgcf://decisions/repository-lifecycle/0123456789abcdef01234567.json",
    decision,
  );
  const providerReadback = (state, version) => withRepositoryLifecycleIntegrity({
    readback_id: "repository-lifecycle-provider-readback:archive-example-001",
    observed_at: timestamp,
    repository_identity: structuredClone(request.repository_identity),
    provider_lifecycle_state: state,
    provider_version: version,
    coordinates: {
      owner: "example-owner",
      name: "example-repository",
    },
  });

  let requestState = null;
  let repositoryState = null;
  const service = createRepositoryLifecycleService({
    audit: { emit() {} },
    clock: () => new Date(timestamp),
    providerClient: {
      async read() {
        return providerReadback("active", "etag-before");
      },
      async setArchived() {
        return providerReadback("archived", "etag-after");
      },
    },
    readinessClient: {
      async evaluate() {
        return { decision, decisionRef };
      },
    },
    store: {
      getRequest() {
        return requestState;
      },
      getRepository() {
        return repositoryState;
      },
      async transact(_request, operation) {
        return operation({
          aggregate: repositoryState,
          currentRequest: requestState,
          putAggregate(value) {
            repositoryState = structuredClone(value);
          },
          putRequest(value) {
            requestState = structuredClone(value);
          },
        });
      },
    },
  });
  const result = await service.execute({
    callerId: "governance-operations-console",
    input: request,
  });
  return {
    audit: result.audit,
    request,
    result,
  };
}

const original = readFileSync(openApiPath, "utf8");
let synchronized = original;
for (const [name, directory, filename] of bindings) {
  const schema = project(JSON.parse(readFileSync(path.join(directory, filename), "utf8")), name);
  schema["x-oos-canonical-schema"] = path.relative(root, path.join(directory, filename));
  synchronized = upsertOpenApiComponent(synchronized, name, schema);
}
synchronized = upsertOpenApiComponent(synchronized, "RepositoryLifecycleErrorV1", {
  type: "object",
  required: ["error", "message", "details"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    details: { oneOf: [{ type: "array" }, { type: "object" }, { type: "null" }] },
  },
  additionalProperties: false,
});

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const sample = await examples();
const error = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryLifecycleErrorV1" } } },
});
synchronized = upsertOpenApiPath(synchronized, "/v1/repository-lifecycle/requests", {
  post: {
    tags: ["Repository Lifecycle"],
    summary: "Execute one approved repository lifecycle action",
    description: "Consumes an exact WGCF decision, checkpoints before mutation, reads back provider or workspace truth, and records an immutable receipt without hard deletion or downstream mutation.",
    operationId: "executeRepositoryLifecycleCommand",
    security,
    requestBody: {
      required: true,
      description: "Exact canonical lifecycle request with current and target state, impact assessment, approvals, policy, provider authority when required, correlation, and idempotency evidence.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RepositoryLifecycleRequestV1" },
          example: sample.request,
        },
      },
    },
    responses: {
      200: {
        description: "Current idempotently replayable workflow result.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RepositoryLifecycleWorkflowResultV1" },
            example: sample.result,
          },
        },
      },
      400: error("The request does not satisfy the lifecycle contract."),
      403: error("Caller identity is not bound to a caller-specific credential."),
      409: error("Request, policy, decision, state, version, or replay conflicts."),
      413: error("The canonical request exceeds the bounded body limit."),
      503: error("WGCF, provider authority, or durable state is unavailable."),
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "operator-facing",
    "x-oos-workflow-family": "repository-lifecycle",
  },
});
synchronized = upsertOpenApiPath(synchronized, "/v1/repository-lifecycle/requests/{request_id}", {
  get: {
    tags: ["Repository Lifecycle"],
    summary: "Read one repository lifecycle workflow result",
    description: "Returns the exact persisted result and digest-bound evidence for one lifecycle request identity.",
    operationId: "getRepositoryLifecycleResult",
    security,
    parameters: [{ name: "request_id", in: "path", required: true, schema: { type: "string", pattern: "^repository-lifecycle-request:[A-Za-z0-9._:-]+$" } }],
    responses: {
      200: {
        description: "Persisted lifecycle workflow result.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RepositoryLifecycleWorkflowResultV1" },
            example: { ...sample.result, replayed: true },
          },
        },
      },
      403: error("Caller identity is not bound to a caller-specific credential."),
      404: error("The request identity is not present."),
      503: error("The workflow state is unavailable."),
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "operator-facing",
    "x-oos-workflow-family": "repository-lifecycle",
  },
});
synchronized = upsertOpenApiPath(synchronized, "/v1/repository-lifecycle/repositories/{provider}/{provider_repository_id}", {
  get: {
    tags: ["Repository Lifecycle"],
    summary: "Read authoritative repository lifecycle state and history",
    description: "Returns the current OOS-owned repository lifecycle projection and immutable terminal history without mutating provider or downstream state.",
    operationId: "getRepositoryLifecycleAudit",
    security,
    parameters: [
      { name: "provider", in: "path", required: true, schema: { type: "string" } },
      { name: "provider_repository_id", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: {
        description: "Current immutable lifecycle audit projection.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RepositoryLifecycleAuditV1" },
            example: sample.audit,
          },
        },
      },
      403: error("Caller identity is not bound to a caller-specific credential."),
      404: error("The repository lifecycle projection is not present."),
      503: error("The lifecycle audit state is unavailable."),
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "operator-facing",
    "x-oos-workflow-family": "repository-lifecycle",
  },
});

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json repository lifecycle schemas or paths are stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
