import { canonicalDigest } from "../src/delivery-art/canonical-json.js";
import {
  repositoryLifecycleAuthority,
  withRepositoryLifecycleIntegrity,
} from "../src/repository-lifecycle/contracts.js";

export const LIFECYCLE_TIME = "2026-08-30T03:00:00.000Z";
export const lifecycleClock = () => new Date(LIFECYCLE_TIME);
const ref = (name, fill = "a") => ({
  uri: `https://workspace-governance.local/${name}`,
  digest: `sha256:${fill.repeat(64)}`,
});

export function lifecycleRequest(action = "archive-provider", overrides = {}) {
  const authority = repositoryLifecycleAuthority();
  const providerAction = ["archive-provider", "unarchive-provider"].includes(action);
  const transfer = action === "transfer-workspace-custody";
  const reverse = ["unarchive-provider", "restore-workspace-record"].includes(action);
  const current = {
    custody_state: "linked",
    workspace_owner_ref: "repo:example-owner",
    provider_lifecycle_state: action === "unarchive-provider" ? "archived" : "active",
    workspace_record_state: action === "restore-workspace-record" ? "retired" : "active",
    custody_version: "custody-v1",
    provider_version: "etag-before",
  };
  const target = {
    workspace_owner_ref: transfer ? "repo:next-owner" : null,
    provider_lifecycle_state: providerAction
      ? action === "archive-provider" ? "archived" : "active"
      : null,
    workspace_record_state: ["retire-workspace-record", "restore-workspace-record"].includes(action)
      ? action === "retire-workspace-record" ? "retired" : "active"
      : null,
  };
  const request = {
    schema_version: 1,
    artifact_type: "repository_lifecycle_request",
    request_id: `repository-lifecycle-request:${action}-001`,
    requested_at: LIFECYCLE_TIME,
    action,
    operator_ref: ref("operators/example", "1"),
    workflow: {
      workflow_id: "repository-lifecycle",
      workflow_version: "1",
      execution_id: `repository-lifecycle-${action}-001`,
    },
    repository_identity: { provider: "github", provider_repository_id: "123456789" },
    current_state: current,
    target,
    impact: {
      impact_assessment_ref: ref(`impact/${action}`, "2"),
      finding_count: 0,
      blocking_finding_count: 0,
      blocker_disposition: null,
    },
    authority: {
      policy_profile_ref: { uri: authority.uri, digest: authority.digest },
      approval_ref: ref(`approvals/${action}`, "3"),
      source_owner_acceptance_ref: transfer ? ref(`acceptance/source/${action}`, "4") : null,
      target_owner_acceptance_ref: transfer ? ref(`acceptance/target/${action}`, "5") : null,
      provider_credential_binding_ref: providerAction ? ref(`credentials/${action}`, "6") : null,
    },
    reversal_of_receipt_ref: reverse ? ref(`receipts/reversal/${action}`, "7") : null,
    correlation: { correlation_id: `correlation-${action}`, causation_id: null },
    idempotency_key: `idempotency-${action}`,
    ...structuredClone(overrides),
  };
  request.request_digest = canonicalDigest(request);
  return request;
}

export function lifecycleDecision(request, overrides = {}) {
  const gateMap = {
    "transfer-workspace-custody": ["exact-operator-approval", "source-owner-acceptance", "target-owner-acceptance"],
    "archive-provider": ["exact-operator-approval", "governed-provider-credential-binding"],
    "unarchive-provider": ["exact-operator-approval", "governed-provider-credential-binding"],
    "retire-workspace-record": ["exact-operator-approval"],
    "restore-workspace-record": ["exact-operator-approval"],
  };
  const nextMap = {
    "transfer-workspace-custody": "apply-workspace-custody",
    "archive-provider": "archive-provider",
    "unarchive-provider": "unarchive-provider",
    "retire-workspace-record": "retire-workspace-record",
    "restore-workspace-record": "restore-workspace-record",
  };
  return withRepositoryLifecycleIntegrity({
    schema_version: 1,
    artifact_type: "repository_lifecycle_decision",
    decision_id: "repository-lifecycle-decision:0123456789abcdef01234567",
    request_ref: {
      uri: `wgcf://requests/repository-lifecycle/${request.request_digest.slice(7)}.json`,
      digest: request.request_digest,
    },
    evaluated_at: LIFECYCLE_TIME,
    policy_version: "repository-lifecycle/v1",
    action: request.action,
    outcome: "allowed",
    current_state: structuredClone(request.current_state),
    approved_target: structuredClone(request.target),
    impact: { ...structuredClone(request.impact), downstream_mutation: "none" },
    required_human_gates: gateMap[request.action],
    findings: [],
    obligations: ["fresh-readback-required", "immutable-receipt-required"],
    next_action: nextMap[request.action],
    ...structuredClone(overrides),
  });
}

export function lifecycleProviderReadback(request, overrides = {}) {
  const targetState = request.target.provider_lifecycle_state ?? request.current_state.provider_lifecycle_state;
  return withRepositoryLifecycleIntegrity({
    readback_id: `repository-lifecycle-provider-readback:${request.request_id.split(":").at(-1)}`,
    observed_at: LIFECYCLE_TIME,
    repository_identity: structuredClone(request.repository_identity),
    provider_lifecycle_state: targetState,
    provider_version: targetState === request.current_state.provider_lifecycle_state
      ? request.current_state.provider_version
      : "etag-after",
    coordinates: { owner: "example-owner", name: "example-repository" },
    ...structuredClone(overrides),
  });
}
