import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  repositoryCustodyAuthority,
  withArtifactIntegrity,
} from "../src/repository-custody/contracts.js";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "repository-custody");
const workflowRoot = path.join(repoRoot, "contracts", "repository-custody-workflow");
const bindings = [
  ["RepositoryCustodyRequestV1", contractRoot, "repository-custody-request.schema.json"],
  ["RepositoryCustodyDecisionV1", contractRoot, "repository-custody-decision.schema.json"],
  ["RepositoryProviderReadbackV1", contractRoot, "repository-provider-readback.schema.json"],
  ["RepositoryCustodyReceiptV1", contractRoot, "repository-custody-receipt.schema.json"],
  ["RepositoryCustodyWorkflowResultV1", workflowRoot, "result.schema.json"],
];
const refMap = new Map([
  ["https://workspace-governance.local/schemas/repository-custody-request.schema.json", "RepositoryCustodyRequestV1"],
  ["https://workspace-governance.local/schemas/repository-custody-decision.schema.json", "RepositoryCustodyDecisionV1"],
  ["https://workspace-governance.local/schemas/repository-provider-readback.schema.json", "RepositoryProviderReadbackV1"],
  ["https://workspace-governance.local/schemas/repository-custody-receipt.schema.json", "RepositoryCustodyReceiptV1"],
]);

function projectSchema(value, componentName) {
  if (Array.isArray(value)) return value.map((entry) => projectSchema(entry, componentName));
  if (!value || typeof value !== "object") return value;
  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "$ref" && refMap.has(entry)) {
      projected[key] = `#/components/schemas/${refMap.get(entry)}`;
    } else if (key === "$ref" && entry.startsWith("#/$defs/")) {
      projected[key] = `#/components/schemas/${componentName}/${entry.slice(2)}`;
    } else {
      projected[key] = projectSchema(entry, componentName);
    }
  }
  return projected;
}

function examples() {
  const timestamp = "2026-08-29T08:00:00.000Z";
  const authority = repositoryCustodyAuthority();
  const request = {
    schema_version: 1,
    artifact_type: "repository_custody_request",
    request_id: "repository-custody-request:link-example-001",
    requested_at: "2026-08-29T07:59:00Z",
    action: "link-existing",
    operator_ref: {
      uri: "https://workspace-governance.local/operators/example",
      digest: `sha256:${"1".repeat(64)}`,
    },
    workflow: {
      workflow_id: "repository-custody",
      workflow_version: "1",
      execution_id: "repository-custody-link-example-001",
    },
    target: {
      provider: "github",
      provider_host: "github.com",
      owner: "example-owner",
      name: "example-repository",
      provider_repository_id: "123456789",
    },
    requested_custody: {
      workspace_owner_ref: "repo:example-repository",
      custody_kind: "dedicated-owner-repo",
    },
    authority: {
      policy_profile_ref: { uri: authority.uri, digest: authority.digest },
      approval_ref: {
        uri: "https://workspace-governance.local/approvals/repository-custody/link-example-001",
        digest: `sha256:${"8".repeat(64)}`,
      },
      credential_binding_ref: {
        uri: "https://platform-engineering.local/credential-bindings/github-app/repository-read",
        digest: `sha256:${"3".repeat(64)}`,
      },
    },
    correlation: {
      correlation_id: "repository-custody-link-example-001",
      causation_id: null,
    },
    idempotency_key: "repository-custody-link-example-001",
  };
  request.request_digest = canonicalDigest(request);
  const decision = withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_custody_decision",
    decision_id: "repository-custody-decision:0123456789abcdef01234567",
    request_ref: {
      uri: `wgcf://requests/repository-custody/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    evaluated_at: timestamp,
    policy_version: "repository-custody/v1",
    action: "link-existing",
    outcome: "allowed",
    resolved_identity: {
      provider: "github",
      provider_repository_id: "123456789",
    },
    approved_provisioning: null,
    findings: [],
    obligations: ["provider-readback-required"],
    next_action: "read-provider",
  });
  const decisionRef = {
    uri: "wgcf://decisions/repository-custody/0123456789abcdef01234567.json",
    digest: decision.integrity.content_digest,
  };
  const providerReadback = withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_provider_readback",
    readback_id: "repository-provider-readback:link-example-001",
    request_ref: decision.request_ref,
    observed_at: timestamp,
    action: "link-existing",
    repository_identity: decision.resolved_identity,
    canonical_owner: "example-owner",
    canonical_name: "example-repository",
    canonical_url: "https://github.com/example-owner/example-repository",
    default_branch: "main",
    visibility: "private",
    provider_lifecycle_state: "active",
    provider_version: "etag-1",
    credential_binding_ref: request.authority.credential_binding_ref,
    applied_provisioning: null,
  });
  const providerReadbackRef = {
    uri: `oos://readbacks/repository-provider/link-example-001-${providerReadback.integrity.content_digest.slice(7)}.json`,
    digest: providerReadback.integrity.content_digest,
  };
  const receipt = withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_custody_receipt",
    receipt_id: "repository-custody-receipt:0123456789abcdef01234567",
    request_ref: decision.request_ref,
    decision_ref: decisionRef,
    provider_readback_ref: providerReadbackRef,
    completed_at: timestamp,
    action: "link-existing",
    outcome: "succeeded",
    repository_identity: decision.resolved_identity,
    custody: {
      before: "unrecorded",
      after: "linked",
      workspace_owner_ref: "repo:example-repository",
    },
    workflow_status: "succeeded",
    findings: ["Provider readback matched the immutable repository identity."],
    downstream_handoffs: {
      workspace_intake: "request-available",
      active_inventory: "separate-action-required",
      delivery_catalog: "separate-action-required",
      product_admission: "separate-action-required",
    },
  });
  return {
    request,
    result: {
      schema_version: 1,
      workflow_id: "repository-custody",
      workflow_version: "1",
      execution_id: request.workflow.execution_id,
      request,
      status: "succeeded",
      replayed: false,
      retryable: false,
      decision,
      decision_ref: decisionRef,
      provider_operation: {
        command: "read-provider",
        state: "verified",
        attempt_count: 0,
        completion_path: "read-existing",
        provider_repository_id: "123456789",
      },
      provider_readback: providerReadback,
      provider_readback_ref: providerReadbackRef,
      receipt,
      receipt_ref: {
        uri: `oos://receipts/repository-custody/0123456789abcdef01234567-${receipt.integrity.content_digest.slice(7)}.json`,
        digest: receipt.integrity.content_digest,
      },
      failure: null,
      next_action: "complete",
    },
  };
}

const original = readFileSync(openApiPath, "utf8");
let synchronized = original;
for (const [componentName, root, filename] of bindings) {
  const schema = projectSchema(
    JSON.parse(readFileSync(path.join(root, filename), "utf8")),
    componentName,
  );
  schema["x-oos-canonical-schema"] = path.relative(repoRoot, path.join(root, filename));
  synchronized = upsertOpenApiComponent(synchronized, componentName, schema);
}
synchronized = upsertOpenApiComponent(synchronized, "RepositoryCustodyErrorV1", {
  type: "object",
  required: ["error", "message", "details"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    details: { oneOf: [{ type: "array" }, { type: "object" }, { type: "null" }] },
  },
  additionalProperties: false,
});

const sample = examples();
const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryCustodyErrorV1" } } },
});
synchronized = upsertOpenApiPath(synchronized, "/v1/repository-custody/requests", {
  post: {
    tags: ["Repository Custody"],
    summary: "Execute a repository custody command",
    description: "Evaluates an exact link-existing or provision-new request through WGCF, performs only the authorized provider operation, verifies fresh provider truth, and records custody evidence without downstream admission mutation.",
    operationId: "executeRepositoryCustodyCommand",
    security,
    requestBody: {
      required: true,
      description: "Exact canonical repository-custody request with action-specific target data plus operator approval, policy, credential-binding, and correlation references.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryCustodyRequestV1" }, example: sample.request } },
    },
    responses: {
      200: {
        description: "Current idempotently replayable custody workflow result, including provider-operation checkpoint and terminal evidence when complete.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryCustodyWorkflowResultV1" }, example: sample.result } },
      },
      400: errorResponse("The request does not satisfy the custody contract."),
      403: errorResponse("Caller identity is not bound to a caller-specific credential."),
      409: errorResponse("Request identity, policy, readiness, or provider truth conflicts."),
      413: errorResponse("The canonical request exceeds the bounded body limit."),
      503: errorResponse("The workflow, WGCF, provider identity, or durable state is unavailable."),
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "operator-facing",
    "x-oos-workflow-family": "repository-custody",
  },
});
synchronized = upsertOpenApiPath(synchronized, "/v1/repository-custody/requests/{request_id}", {
  get: {
    tags: ["Repository Custody"],
    summary: "Read one repository custody workflow result",
    description: "Returns the exact persisted current result and digest-bound evidence for a custody request identity.",
    operationId: "getRepositoryCustodyResult",
    security,
    parameters: [{
      name: "request_id",
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^repository-custody-request:[A-Za-z0-9._:-]+$" },
    }],
    responses: {
      200: {
        description: "Persisted current repository custody workflow result.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/RepositoryCustodyWorkflowResultV1" }, example: { ...sample.result, replayed: true } } },
      },
      403: errorResponse("Caller identity is not bound to a caller-specific credential."),
      404: errorResponse("The custody request identity is not present."),
      503: errorResponse("The workflow runtime or durable state is unavailable."),
    },
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "operator-facing",
    "x-oos-workflow-family": "repository-custody",
  },
});

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json repository custody schemas or paths are stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
