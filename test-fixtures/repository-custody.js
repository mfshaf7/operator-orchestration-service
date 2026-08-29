import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  repositoryCustodyAuthority,
  withArtifactIntegrity,
} from "../src/repository-custody/contracts.js";

export const TEST_TIME = "2026-08-29T08:00:00.000Z";
export const TEST_CLOCK = () => new Date(TEST_TIME);

export function custodyRequest(overrides = {}) {
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
    ...structuredClone(overrides),
  };
  request.request_digest = canonicalDigest(request);
  return request;
}

export function custodyDecision(request, overrides = {}) {
  return withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_custody_decision",
    decision_id: "repository-custody-decision:0123456789abcdef01234567",
    request_ref: {
      uri: `wgcf://requests/repository-custody/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    evaluated_at: TEST_TIME,
    policy_version: "repository-custody/v1",
    action: request.action,
    outcome: "allowed",
    resolved_identity: {
      provider: request.target.provider,
      provider_repository_id: request.target.provider_repository_id,
    },
    approved_provisioning: null,
    findings: [],
    obligations: ["provider-readback-required"],
    next_action: "read-provider",
    ...structuredClone(overrides),
  });
}

export function decisionEnvelope(request, overrides = {}) {
  const decision = custodyDecision(request, overrides);
  return {
    decision,
    ledger: {
      state: "durable",
      resolution: "created",
      ref: {
        uri: `wgcf://decisions/repository-custody/${decision.decision_id.split(":").at(-1)}.json`,
        digest: decision.integrity.content_digest,
      },
    },
  };
}

export function providerReadback(request, overrides = {}) {
  return withArtifactIntegrity({
    schema_version: 1,
    artifact_type: "repository_provider_readback",
    readback_id: "repository-provider-readback:link-example-001",
    request_ref: {
      uri: `wgcf://requests/repository-custody/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    observed_at: TEST_TIME,
    action: request.action,
    repository_identity: {
      provider: request.target.provider,
      provider_repository_id: request.target.provider_repository_id,
    },
    canonical_owner: "example-owner",
    canonical_name: "example-repository",
    canonical_url: "https://github.com/example-owner/example-repository",
    default_branch: "main",
    visibility: "private",
    provider_lifecycle_state: "active",
    provider_version: "etag-1",
    credential_binding_ref: request.authority.credential_binding_ref,
    applied_provisioning: null,
    ...structuredClone(overrides),
  });
}

export function provisionRequest(overrides = {}) {
  return custodyRequest({
    request_id: "repository-custody-request:provision-example-001",
    action: "provision-new",
    workflow: {
      workflow_id: "repository-custody",
      workflow_version: "1",
      execution_id: "repository-custody-provision-example-001",
    },
    target: {
      provider: "github",
      provider_host: "github.com",
      owner: "example-organization",
      owner_scope: "organization",
      name: "example-repository",
      provider_repository_id: null,
    },
    provisioning: {
      description: "Example governed repository.",
      visibility: "private",
      initialize_with_readme: true,
      features: {
        issues: true,
        projects: false,
        wiki: false,
        discussions: false,
      },
      merge_policy: {
        allow_squash_merge: true,
        allow_merge_commit: false,
        allow_rebase_merge: false,
        delete_branch_on_merge: true,
      },
    },
    authority: {
      ...custodyRequest().authority,
      approval_ref: {
        uri: "https://workspace-governance.local/approvals/repository-custody/provision-example-001",
        digest: `sha256:${"8".repeat(64)}`,
      },
      credential_binding_ref: {
        uri: "https://platform-engineering.local/credential-bindings/github-app/repository-create",
        digest: `sha256:${"3".repeat(64)}`,
      },
    },
    correlation: {
      correlation_id: "repository-custody-provision-example-001",
      causation_id: null,
    },
    idempotency_key: "repository-custody-provision-example-001",
    ...structuredClone(overrides),
  });
}

export function provisionDecision(request, overrides = {}) {
  return custodyDecision(request, {
    resolved_identity: null,
    approved_provisioning: {
      provider: request.target.provider,
      provider_host: request.target.provider_host,
      owner: request.target.owner,
      owner_scope: request.target.owner_scope,
      name: request.target.name,
      settings: request.provisioning,
    },
    obligations: [
      "create-provider-once",
      "require-fresh-provider-readback",
      "never-compensate-with-delete",
    ],
    next_action: "create-provider",
    ...structuredClone(overrides),
  });
}

export function provisionReadback(request, overrides = {}) {
  return providerReadback(request, {
    readback_id: "repository-provider-readback:provision-example-001",
    repository_identity: {
      provider: request.target.provider,
      provider_repository_id: "987654321",
    },
    canonical_owner: request.target.owner,
    canonical_name: request.target.name,
    canonical_url: `https://github.com/${request.target.owner}/${request.target.name}`,
    applied_provisioning: {
      owner_scope: "organization",
      initialization_state: "initialized",
      settings: request.provisioning,
    },
    ...structuredClone(overrides),
  });
}
