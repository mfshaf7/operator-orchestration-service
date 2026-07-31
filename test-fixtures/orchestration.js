import { orchestrationIntentDigest } from "../src/orchestration/contracts.js";

const digest = `sha256:${"a".repeat(64)}`;

export function validOrchestrationActivationEnv(overrides = {}) {
  return {
    OOS_ORCHESTRATION_IMPLEMENTATION_REVIEW_REF:
      "review-packet:oos-validation-readiness-source",
    OOS_ORCHESTRATION_DETERMINISTIC_REPLAY_TEST_REF:
      "test:deterministic-replay:validation-readiness-v1",
    OOS_ORCHESTRATION_ACTIVITY_IDEMPOTENCY_TEST_REF:
      "test:wgcf-activity-idempotency:validation-readiness-v1",
    OOS_ORCHESTRATION_FAILURE_AND_CONTROL_TEST_REF:
      "test:failure-control:validation-readiness-v1",
    OOS_ORCHESTRATION_DEVINT_PROFILE_REF:
      "devint-profile:accepted-idea-delivery:active",
    OOS_ORCHESTRATION_PLATFORM_ACCEPTANCE_REF:
      "platform:acceptance:validation-readiness-v1",
    OOS_ORCHESTRATION_SECURITY_ACTIVATION_REVIEW_REF:
      "security:activation-review:validation-readiness-v1",
    OOS_ORCHESTRATION_SOURCE_PROJECTION_VERIFICATION_REF:
      "projection:wgcf:validation-readiness-v1",
    OOS_ORCHESTRATION_ROLLBACK_AND_SUSPENSION_PROOF_REF:
      "proof:rollback-suspension:validation-readiness-v1",
    OOS_ORCHESTRATION_RUNTIME_ENABLED: "true",
    OOS_ORCHESTRATION_WORKER_ENABLED: "true",
    OOS_ORCHESTRATION_EXECUTION_AUTHORIZED: "true",
    ...overrides,
  };
}

export function validOrchestrationRequest() {
  const decidedAt = new Date(Date.now() - 60_000);
  const expiresAt = new Date(decidedAt.getTime() + 60 * 60 * 1000);
  const request = {
    schema_version: 1,
    request_id: "request:validation-readiness:1",
    definition_id: "validation-readiness-run",
    definition_version: 1,
    source_domain: "workspace-governance-control-fabric",
    source_record_ref: "art:delivery-698",
    source_version_ref: "git:workspace-governance-control-fabric:abc123",
    request_type: "validation-readiness",
    intent_summary: "Prove local validation readiness.",
    intent_digest: "",
    input_refs: [
      "art:delivery-698",
      "repo:workspace-governance",
      "repo:workspace-governance-control-fabric",
    ],
    approval_refs: [
      {
        decision_kind: "operator-approved",
        authority: "operator:mfshaf7",
        scope_ref: "art:delivery-698",
        source_version_ref: "git:workspace-governance-control-fabric:abc123",
        intent_digest: "",
        decision_ref: "decision:validation-readiness:1",
        decided_at: decidedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
    ],
    lock_refs: [],
    idempotency_key: "validation-readiness-abc123",
    expected_receipt: "orchestration-validation-readiness-receipt",
    return_projection: "oos.validation-readiness-run.v1",
    correlation_ref: "correlation:698",
    causation_ref: "openproject:work-package:698",
    source_projection_ref:
      "projection:workspace-governance-control-fabric:abc123",
    source_projection_version: "abc123",
    operator_id: "operator:mfshaf7",
  };
  request.intent_digest = orchestrationIntentDigest(request);
  request.approval_refs[0].intent_digest = request.intent_digest;
  return request;
}

export function validWgcfResult(statusCode = "ready") {
  return {
    schema_version: 1,
    activity_name: "wgcf.validation-readiness.evaluate",
    activity_id: "activity:1",
    attempt: 1,
    worker_id: "wgcf-worker:1",
    definition_id: "validation-readiness-run",
    definition_version: 1,
    run_id: "temporal-run:1",
    workflow_id: "oos:validation-readiness-run:v1:key",
    source_ref: "art:delivery-698",
    source_version: "git:workspace-governance-control-fabric:abc123",
    correlation_id: "correlation:698",
    causation_id: "openproject:work-package:698",
    idempotency_key:
      "activity:oos:validation-readiness-run:v1:key:1",
    status_code: statusCode,
    bounded_decision: {
      ready: statusCode === "ready",
      terminal: true,
      retryable: false,
      validation_outcome: statusCode === "ready" ? "success" : "blocked",
      readiness_outcome: statusCode === "ready" ? "ready" : "blocked",
      readiness_reason_count: statusCode === "ready" ? 0 : 1,
      readiness_decision_ref: "decision:1",
      validation_event_ref: "event:validation:1",
      readiness_event_ref: "event:readiness:1",
    },
    artifact_digest: digest,
    receipt_ref: {
      receipt_id: "receipt:wgcf:1",
      digest,
      outcome: statusCode === "ready" ? "success" : "blocked",
      target_scope: "component:workspace-governance",
      tier: "smoke",
    },
  };
}

export function validWgcfActivityRequest() {
  return {
    schema_version: 1,
    definition_id: "validation-readiness-run",
    definition_version: 1,
    run_id: "temporal-run:1",
    workflow_id: "oos:validation-readiness-run:v1:key",
    source_ref: "art:delivery-698",
    source_version: "git:workspace-governance-control-fabric:abc123",
    validation_scope: "component:workspace-governance",
    readiness_target: "repo:workspace-governance-control-fabric",
    profile: "local-read-only",
    tier: "smoke",
    correlation_id: "correlation:698",
    causation_id: "openproject:work-package:698",
    idempotency_key:
      "activity:oos:validation-readiness-run:v1:key:1",
    caller_id: "operator-orchestration-service",
    operator_id: "operator:mfshaf7",
  };
}
