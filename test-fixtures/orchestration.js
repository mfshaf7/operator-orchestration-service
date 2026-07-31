import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { orchestrationIntentDigest } from "../src/orchestration/contracts.js";

const digest = `sha256:${"a".repeat(64)}`;

export function validOrchestrationActivationEnv(overrides = {}) {
  return orchestrationActivationEnvForManifest(
    validOrchestrationActivationManifest(),
    overrides,
    validOrchestrationActivationEvidenceRecords(),
  );
}

export function orchestrationActivationEnvForManifest(
  manifest,
  overrides = {},
  evidenceRecords = validOrchestrationActivationEvidenceRecords(),
) {
  const manifestRoot = mkdtempSync(join(tmpdir(), "oos-activation-evidence-"));
  const recordsRoot = join(manifestRoot, "records");
  mkdirSync(recordsRoot, { mode: 0o700 });
  for (const [gateId, record] of Object.entries(evidenceRecords)) {
    const rawRecord = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(join(recordsRoot, `${gateId}.json`), rawRecord, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (manifest.evidence?.[gateId]) {
      manifest.evidence[gateId].artifact_digest =
        `sha256:${createHash("sha256").update(rawRecord).digest("hex")}`;
    }
  }
  const manifestPath = join(manifestRoot, "manifest.json");
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, raw, { encoding: "utf8", mode: 0o600 });

  return {
    OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH: manifestPath,
    OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST:
      `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    OOS_ORCHESTRATION_RUNTIME_ENABLED: "true",
    OOS_ORCHESTRATION_WORKER_ENABLED: "true",
    OOS_ORCHESTRATION_EXECUTION_AUTHORIZED: "true",
    ...overrides,
  };
}

export function validOrchestrationActivationManifest() {
  return {
    schema_version: 1,
    manifest_id:
      "platform-engineering://activation/validation-readiness-run/v1/dev-integration",
    definition_id: "validation-readiness-run",
    definition_version: 1,
    environment: "dev-integration",
    profile_id: "temporal",
    profile_lifecycle: "active",
    issued_at: "2026-07-31T00:00:00.000Z",
    expires_at: "2099-12-31T23:59:59.000Z",
    issued_by: "platform-engineering",
    decision: "accepted",
    decision_ref:
      "platform-engineering://decisions/temporal-dev-integration-activation",
    evidence: Object.fromEntries(
      Object.keys(activationEvidenceOwners()).map((gateId) => [
        gateId,
        {
          artifact_path: `records/${gateId}.json`,
          artifact_digest: digest,
        },
      ]),
    ),
  };
}

export function validOrchestrationActivationEvidenceRecords() {
  return Object.fromEntries(
    Object.entries(activationEvidenceOwners()).map(
      ([gateId, owner], index) => [
        gateId,
        {
          schema_version: 1,
          gate_id: gateId,
          owner,
          record_ref: `https://evidence.test/${gateId}`,
          source_version: `git:${owner}:${String(index).padStart(40, "a")}`,
          outcome: "accepted",
        },
      ],
    ),
  );
}

function activationEvidenceOwners() {
  const owners = {
    "contract-valid": "workspace-governance",
    "implementation-reviewed": "operator-orchestration-service",
    "deterministic-replay-tested": "operator-orchestration-service",
    "activity-idempotency-tested":
      "workspace-governance-control-fabric",
    "failure-and-control-tested": "operator-orchestration-service",
    "dev-integration-profile-active": "platform-engineering",
    "platform-runtime-accepted": "platform-engineering",
    "security-review-accepted": "security-architecture",
    "source-projection-verified":
      "workspace-governance-control-fabric",
    "rollback-and-suspension-proven": "platform-engineering",
  };
  return owners;
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
