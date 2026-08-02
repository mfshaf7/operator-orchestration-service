import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  orchestrationIntentDigest,
  toTemporalRunBindings,
  toTemporalWorkflowInput,
} from "../src/orchestration/contracts.js";
import {
  CONTROLLED_PROOF_REQUIRED_RECEIPT_OWNERS,
  CONTROLLED_PROOF_REQUIRED_SCENARIOS,
  GENERATION_START_REGISTRY_WORKFLOW_TYPE,
  GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
  GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION,
  GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT,
  generationStartRegistryTaskQueueFor,
  generationStartRegistryWorkflowIdFor,
  validationReadinessWorkflowQueueFor,
} from "../src/orchestration/constants.js";
import {
  generationStartRegistryInputFor,
  generationStartRegistrationFor,
} from "../src/orchestration/generation-start-registry.js";

const digest = `sha256:${"a".repeat(64)}`;
const receiptKeyRoot = mkdtempSync(join(tmpdir(), "oos-receipt-keys-"));
const receiptKeyPair = generateKeyPairSync("ed25519");
const receiptPrivateKeyPath = join(receiptKeyRoot, "private.pem");
const receiptPublicKeyPath = join(receiptKeyRoot, "public.pem");
const receiptPrivateKey = receiptKeyPair.privateKey.export({
  format: "pem",
  type: "pkcs8",
});
const receiptPublicKey = receiptKeyPair.publicKey.export({
  format: "pem",
  type: "spki",
});
writeFileSync(receiptPrivateKeyPath, receiptPrivateKey, { mode: 0o600 });
writeFileSync(receiptPublicKeyPath, receiptPublicKey, { mode: 0o644 });
const receiptPublicKeyDigest =
  `sha256:${createHash("sha256").update(receiptPublicKey).digest("hex")}`;
export const TEST_ACTIVATION_EVIDENCE_DIGEST =
  `sha256:${"b".repeat(64)}`;
export const TEST_VALIDATION_READINESS_WORKFLOW_QUEUE =
  validationReadinessWorkflowQueueFor(TEST_ACTIVATION_EVIDENCE_DIGEST);
export const TEST_GENERATION_START_REGISTRY_QUEUE =
  generationStartRegistryTaskQueueFor(TEST_ACTIVATION_EVIDENCE_DIGEST);
export const TEST_GENERATION_START_REGISTRY_ID =
  generationStartRegistryWorkflowIdFor(TEST_ACTIVATION_EVIDENCE_DIGEST);
export const TEST_CONTROLLED_PROOF_OOS_REVISION = "c".repeat(40);
export const TEST_CONTROLLED_PROOF_WGCF_REVISION = "d".repeat(40);

export function validGenerationStartRegistryInput() {
  return generationStartRegistryInputFor(TEST_ACTIVATION_EVIDENCE_DIGEST);
}

export function validGenerationStartRegistration(
  workflowId = "oos:validation-readiness-run:v1:validation-readiness-abc123",
) {
  return generationStartRegistrationFor(
    TEST_ACTIVATION_EVIDENCE_DIGEST,
    workflowId,
  );
}

export function validGenerationStartRegistryResult(
  workflowIds = [
    "oos:validation-readiness-run:v1:validation-readiness-abc123",
  ],
  activationEvidenceDigest = TEST_ACTIVATION_EVIDENCE_DIGEST,
  sealAuthorizationDigest = `sha256:${"e".repeat(64)}`,
) {
  return {
    activation_evidence_digest: activationEvidenceDigest,
    business_workflow_task_queue:
      validationReadinessWorkflowQueueFor(activationEvidenceDigest),
    invalid_registration_count: 0,
    maximum_registration_count: 512,
    registration_update_id_scheme:
      GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
    registered_workflow_ids: [...workflowIds].sort(),
    registry_id:
      generationStartRegistryWorkflowIdFor(activationEvidenceDigest),
    registry_task_queue:
      generationStartRegistryTaskQueueFor(activationEvidenceDigest),
    registry_workflow_type: GENERATION_START_REGISTRY_WORKFLOW_TYPE,
    schema_version: 1,
    seal_authorization_digest: sealAuthorizationDigest,
    seal_ref:
      "platform-engineering://retirement/validation-readiness-run/v1/dev-integration/1",
    sealed_at: "2026-07-31T12:00:30.000Z",
  };
}

export function validTemporalWorkflowInput(request) {
  return toTemporalWorkflowInput(request, {
    activationEvidenceDigest: TEST_ACTIVATION_EVIDENCE_DIGEST,
    workflowTaskQueue: TEST_VALIDATION_READINESS_WORKFLOW_QUEUE,
  });
}

export function validTemporalRunBindings(
  request,
  activationEvidenceDigest = TEST_ACTIVATION_EVIDENCE_DIGEST,
) {
  return toTemporalRunBindings(request, activationEvidenceDigest);
}

export function validTemporalStartOptions() {
  return {
    activationEvidenceDigest: TEST_ACTIVATION_EVIDENCE_DIGEST,
  };
}

export function validOrchestrationActivationEnv(overrides = {}) {
  return orchestrationActivationEnvForManifest(
    validOrchestrationActivationManifest(),
    overrides,
    validOrchestrationActivationEvidenceRecords(),
  );
}

export function validControlledProofContext({
  issuedAt = "2026-08-01T00:00:00.000Z",
  consumedAt = "2026-08-01T00:01:00.000Z",
  startedAt = "2026-08-01T00:02:00.000Z",
  expiresAt = "2099-12-31T23:59:59.000Z",
  oosRevision = TEST_CONTROLLED_PROOF_OOS_REVISION,
  wgcfRevision = TEST_CONTROLLED_PROOF_WGCF_REVISION,
} = {}) {
  return {
    schema_version: 1,
    context_id:
      "platform-controlled-proof://contexts/commissioning-session-698-1",
    authorization: {
      authorization_id:
        "workspace-governance://controlled-runtime-proof/authorization-698-1",
      authorization_digest: `sha256:${"1".repeat(64)}`,
      canonical_claims_digest: `sha256:${"2".repeat(64)}`,
      operator_approval_ref:
        "openproject://work_packages/792/operator-approval",
      operator_approval_digest: `sha256:${"3".repeat(64)}`,
      security_authorization_ref:
        "security-architecture://authorizations/controlled-proof-698-1",
      security_authorization_digest: `sha256:${"4".repeat(64)}`,
      issued_at: issuedAt,
      expires_at: expiresAt,
      consumption_receipt_ref:
        "platform-engineering://controlled-proof/consumption-698-1",
      consumption_receipt_digest: `sha256:${"5".repeat(64)}`,
      consumed_at: consumedAt,
    },
    commissioning_session: {
      commissioning_session_id: "commissioning-session-698-1",
      started_at: startedAt,
      scenario_executions: CONTROLLED_PROOF_REQUIRED_SCENARIOS.map(
        (scenarioId, index) => ({
          scenario_id: scenarioId,
          scenario_execution_id:
            `scenario-execution-${String(index + 1).padStart(2, "0")}`,
          required_receipt_owners: [
            ...CONTROLLED_PROOF_REQUIRED_RECEIPT_OWNERS,
          ],
        }),
      ),
    },
    definition: {
      definition_id: "validation-readiness-run",
      definition_version: 1,
    },
    request_binding: {
      source_record_ref: "art:delivery-698",
      source_version_ref:
        `git:workspace-governance-control-fabric:${wgcfRevision}`,
      source_projection_ref: "wgcf:art:delivery-698",
      source_projection_version: wgcfRevision,
      operator_id: "operator:mfshaf7",
    },
    runtime: {
      profile_id: "temporal",
      profile_lifecycle: "build-admitted",
      environment: "dev-integration",
      temporal_address: "temporal-frontend.temporal.svc:7233",
      temporal_namespace: "default",
      api_identity: "operator-orchestration-service-api",
      workflow_worker_identity: "oos-workflow-worker",
      workflow_task_queue: "oos.controlled-proof.validation-readiness.v1",
      activity_task_queue: "wgcf.controlled-proof.validation-readiness.v1",
    },
    source_revisions: {
      operator_orchestration_service: oosRevision,
      workspace_governance_control_fabric: wgcfRevision,
    },
  };
}

export function controlledProofEnvForContext(
  context = validControlledProofContext(),
  overrides = {},
) {
  const root = mkdtempSync(join(tmpdir(), "oos-controlled-proof-"));
  const contextPath = join(root, "context.json");
  const raw = `${JSON.stringify(context, null, 2)}\n`;
  writeFileSync(contextPath, raw, { encoding: "utf8", mode: 0o600 });
  return {
    CALLER_ALLOWED_IDS: "platform-controlled-proof-executor",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
    GIT_COMMIT: context.source_revisions.operator_orchestration_service,
    OOS_ORCHESTRATION_CONTROLLED_PROOF_ENABLED: "true",
    OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_PATH: contextPath,
    OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_DIGEST:
      `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    ...overrides,
  };
}

export function validOrchestrationRetirementEnv(overrides = {}) {
  const activationEnv = validOrchestrationActivationEnv();
  const manifest = validOrchestrationRetirementManifest(
    activationEnv.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST,
  );
  return orchestrationRetirementEnvForManifest(
    manifest,
    activationEnv,
    overrides,
  );
}

export function orchestrationRetirementEnvForManifest(
  manifest,
  activationEnv = validOrchestrationActivationEnv(),
  overrides = {},
) {
  const manifestRoot = mkdtempSync(join(tmpdir(), "oos-retirement-evidence-"));
  const manifestPath = join(manifestRoot, "manifest.json");
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, raw, { encoding: "utf8", mode: 0o600 });
  return {
    ...activationEnv,
    OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_PATH: manifestPath,
    OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_DIGEST:
      `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    OOS_ORCHESTRATION_RETIREMENT_RECEIPT_KEY_ID:
      "oos-retirement-receipt-test",
    OOS_ORCHESTRATION_RETIREMENT_RECEIPT_PRIVATE_KEY_PATH:
      receiptPrivateKeyPath,
    OOS_ORCHESTRATION_RETIREMENT_RECEIPT_PUBLIC_KEY_PATH:
      receiptPublicKeyPath,
    ...overrides,
  };
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
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
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
    temporal_target: {
      address: "temporal-frontend.temporal.svc:7233",
      namespace: "default",
      identities: {
        api: "operator-orchestration-service-api",
        workflow_worker: "oos-workflow-worker",
      },
    },
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

export function validOrchestrationRetirementManifest(
  activationEvidenceDigest,
) {
  return {
    schema_version: 1,
    retirement_id:
      "platform-engineering://retirement/validation-readiness-run/v1/dev-integration/1",
    definition_id: "validation-readiness-run",
    definition_version: 1,
    environment: "dev-integration",
    profile_id: "temporal",
    issued_at: "2026-07-31T12:00:00.000Z",
    expires_at: "2026-07-31T12:15:00.000Z",
    issued_by: "platform-engineering",
    receipt_verification: {
      algorithm: "Ed25519",
      canonicalization: GENERATION_RETIREMENT_RECEIPT_CANONICALIZATION,
      issuer: "operator-orchestration-service",
      key_id: "oos-retirement-receipt-test",
      public_key_digest: receiptPublicKeyDigest,
      signed_content: GENERATION_RETIREMENT_RECEIPT_SIGNED_CONTENT,
    },
    reason_ref:
      "platform-engineering://decisions/temporal-generation-retirement/1",
    registry_seal_resume: null,
    activation_manifest_ref:
      "platform-engineering://activation/validation-readiness-run/v1/dev-integration",
    activation_evidence_digest: activationEvidenceDigest,
    workflow_task_queue:
      validationReadinessWorkflowQueueFor(activationEvidenceDigest),
    temporal_target: {
      address: "temporal-frontend.temporal.svc:7233",
      namespace: "default",
      workflow_worker_identity: "oos-workflow-worker",
    },
    start_ingress: {
      state: "drained",
      active_replicas: 0,
      in_flight_starts: 0,
      observed_at: "2026-07-31T11:58:00.000Z",
      evidence_ref:
        "platform-engineering://evidence/oos-start-ingress-drained/1",
    },
    start_registry: {
      registration_update_id_scheme:
        GENERATION_START_REGISTRY_UPDATE_ID_SCHEME,
      workflow_id:
        generationStartRegistryWorkflowIdFor(activationEvidenceDigest),
      workflow_type: GENERATION_START_REGISTRY_WORKFLOW_TYPE,
      task_queue:
        generationStartRegistryTaskQueueFor(activationEvidenceDigest),
    },
    workflow_poller: {
      state: "drained",
      active_replicas: 0,
      observed_at: "2026-07-31T11:59:00.000Z",
      evidence_ref:
        "platform-engineering://evidence/oos-workflow-poller-drained/1",
    },
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
