import { readFileSync } from "node:fs";

import {
  VALIDATION_READINESS_SOURCE_DOMAIN,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
} from "./constants.js";
import { OrchestrationContractError } from "./contracts.js";

const definitionUrl = new URL(
  "../../contracts/orchestration/definitions/validation-readiness-run.v1.json",
  import.meta.url,
);
const sourceDefinition = loadDefinition(definitionUrl);
const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;

const ACTIVATION_GATES = Object.freeze([
  evidenceGate(
    "contract-valid",
    null,
    "workspace-governance",
    () => "workspace-governance:durable-orchestration:v1",
    "The workspace durable-orchestration contract is bound to this definition version.",
  ),
  evidenceGate(
    "implementation-reviewed",
    "OOS_ORCHESTRATION_IMPLEMENTATION_REVIEW_REF",
    "operator-orchestration-service",
    (config) => config.orchestration.activationEvidence.implementationReviewRef,
    "No finalized implementation review reference is configured.",
  ),
  evidenceGate(
    "deterministic-replay-tested",
    "OOS_ORCHESTRATION_DETERMINISTIC_REPLAY_TEST_REF",
    "operator-orchestration-service",
    (config) => config.orchestration.activationEvidence.deterministicReplayTestRef,
    "No deterministic replay test reference is configured.",
  ),
  evidenceGate(
    "activity-idempotency-tested",
    "OOS_ORCHESTRATION_ACTIVITY_IDEMPOTENCY_TEST_REF",
    "workspace-governance-control-fabric",
    (config) => config.orchestration.activationEvidence.activityIdempotencyTestRef,
    "No owner-activity idempotency test reference is configured.",
  ),
  evidenceGate(
    "failure-and-control-tested",
    "OOS_ORCHESTRATION_FAILURE_AND_CONTROL_TEST_REF",
    "operator-orchestration-service",
    (config) => config.orchestration.activationEvidence.failureAndControlTestRef,
    "No failure and control test reference is configured.",
  ),
  evidenceGate(
    "dev-integration-profile-active",
    "OOS_ORCHESTRATION_DEVINT_PROFILE_REF",
    "platform-engineering",
    (config) => config.orchestration.activationEvidence.devIntegrationProfileRef,
    "No active dev-integration profile reference is configured.",
  ),
  evidenceGate(
    "platform-runtime-accepted",
    "OOS_ORCHESTRATION_PLATFORM_ACCEPTANCE_REF",
    "platform-engineering",
    (config) => config.orchestration.activationEvidence.platformAcceptanceRef,
    "No Platform runtime acceptance reference is configured.",
  ),
  evidenceGate(
    "security-review-accepted",
    "OOS_ORCHESTRATION_SECURITY_ACTIVATION_REVIEW_REF",
    "security-architecture",
    (config) => config.orchestration.activationEvidence.securityActivationReviewRef,
    "No fresh Security activation review reference is configured.",
  ),
  evidenceGate(
    "source-projection-verified",
    "OOS_ORCHESTRATION_SOURCE_PROJECTION_VERIFICATION_REF",
    "workspace-governance-control-fabric",
    (config) => config.orchestration.activationEvidence.sourceProjectionVerificationRef,
    "No source projection verification reference is configured.",
  ),
  evidenceGate(
    "rollback-and-suspension-proven",
    "OOS_ORCHESTRATION_ROLLBACK_AND_SUSPENSION_PROOF_REF",
    "platform-engineering",
    (config) => config.orchestration.activationEvidence.rollbackAndSuspensionProofRef,
    "No rollback and suspension proof reference is configured.",
  ),
  switchGate(
    "runtime-enabled",
    "OOS_ORCHESTRATION_RUNTIME_ENABLED",
    "platform-engineering",
    (config) => config.orchestration.runtimeEnabled,
    "The Temporal runtime adapter is enabled.",
    "The Temporal runtime adapter is disabled.",
  ),
  switchGate(
    "workflow-worker-enabled",
    "OOS_ORCHESTRATION_WORKER_ENABLED",
    "operator-orchestration-service",
    (config) => config.orchestration.workerEnabled,
    "The OOS workflow worker is enabled.",
    "The OOS workflow worker is disabled.",
  ),
  switchGate(
    "activity-execution-authorized",
    "OOS_ORCHESTRATION_EXECUTION_AUTHORIZED",
    "security-architecture",
    (config) => config.orchestration.executionAuthorized,
    "Owner activity execution is explicitly authorized.",
    "Owner activity execution is not authorized.",
  ),
]);

export function listOrchestrationDefinitions(config) {
  return [projectDefinition(sourceDefinition, config)];
}

export function getOrchestrationDefinition(
  definitionId,
  definitionVersion,
  config,
) {
  if (
    definitionId !== VALIDATION_READINESS_DEFINITION_ID ||
    Number(definitionVersion) !== VALIDATION_READINESS_DEFINITION_VERSION
  ) {
    return null;
  }
  return projectDefinition(sourceDefinition, config);
}

export function orchestrationActivationGates(config) {
  const gates = ACTIVATION_GATES.map((definition) => definition.project(config));

  return {
    start_allowed: gates.every((entry) => entry.satisfied),
    gates,
  };
}

export function getOrchestrationActivationMissingConfig(config) {
  return ACTIVATION_GATES.filter(
    (definition) =>
      definition.environmentKey && !definition.project(config).satisfied,
  ).map((definition) => definition.environmentKey);
}

function projectDefinition(definition, config) {
  const admission = orchestrationActivationGates(config);
  return {
    ...definition,
    lifecycle: admission.start_allowed ? "active" : definition.lifecycle,
    admission,
  };
}

function gate(gateId, satisfied, owner, detail) {
  return {
    gate_id: gateId,
    satisfied,
    owner,
    detail,
  };
}

function evidenceGate(
  gateId,
  environmentKey,
  owner,
  readEvidence,
  missingDetail,
) {
  return {
    environmentKey,
    project(config) {
      const evidenceRef = readEvidence(config);
      const normalized =
        typeof evidenceRef === "string" ? evidenceRef.trim() : "";
      const satisfied = EVIDENCE_REF_PATTERN.test(normalized);
      return gate(
        gateId,
        satisfied,
        owner,
        satisfied
          ? normalized
          : normalized
            ? "Configured activation evidence is not a bounded reference."
            : missingDetail,
      );
    },
  };
}

function switchGate(
  gateId,
  environmentKey,
  owner,
  readState,
  enabledDetail,
  disabledDetail,
) {
  return {
    environmentKey,
    project(config) {
      const satisfied = readState(config) === true;
      return gate(
        gateId,
        satisfied,
        owner,
        satisfied ? enabledDetail : disabledDetail,
      );
    },
  };
}

function loadDefinition(url) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    throw new OrchestrationContractError(
      "definition_catalog_invalid",
      "The orchestration definition catalog cannot be loaded.",
      error instanceof Error ? error.message : String(error),
    );
  }
  assertDefinition(parsed);
  return deepFreeze(parsed);
}

function assertDefinition(definition) {
  const expected = {
    schema_version: 1,
    definition_id: VALIDATION_READINESS_DEFINITION_ID,
    definition_version: VALIDATION_READINESS_DEFINITION_VERSION,
    qualification: "durable-candidate",
    lifecycle: "admission-review",
    source_domain: VALIDATION_READINESS_SOURCE_DOMAIN,
    source_record_type: "workspace-delivery-art-initiative",
    business_owner: "workspace-governance",
    implementation_repo: "operator-orchestration-service",
    execution_owner: "operator-orchestration-service",
    expected_receipt: "orchestration-validation-readiness-receipt",
    return_projection: "oos.validation-readiness-run.v1",
  };
  const violations = Object.entries(expected)
    .filter(([field, value]) => definition?.[field] !== value)
    .map(([field, value]) => `${field} must be ${JSON.stringify(value)}`);

  const required = [
    "title",
    "purpose",
    "qualification",
    "lifecycle",
    "source_domain",
    "source_record_type",
    "business_owner",
    "execution_node_owners",
    "trigger",
    "approval_requirements",
    "source_version_refs",
    "idempotency_strategy",
    "lock_strategy",
    "execution_graph",
    "wait_and_signal_contract",
    "retry_and_timeout_contract",
    "compensation_strategy",
    "cancellation_boundary",
    "completion_condition",
    "evidence_and_retention",
    "security_requirements",
    "rollout_and_rollback",
  ];
  for (const field of required) {
    if (!Object.hasOwn(definition ?? {}, field)) {
      violations.push(`${field} is required`);
    }
  }
  const allowedFields = new Set([
    ...Object.keys(expected),
    ...required,
  ]);
  for (const field of Object.keys(definition ?? {})) {
    if (!allowedFields.has(field)) {
      violations.push(`${field} is not part of the definition contract`);
    }
  }
  if (
    JSON.stringify(definition?.security_requirements?.allowed_caller_ids) !==
    JSON.stringify(["governance-operations-console"])
  ) {
    violations.push(
      "security_requirements.allowed_caller_ids must contain only governance-operations-console",
    );
  }

  if (violations.length > 0) {
    throw new OrchestrationContractError(
      "definition_catalog_invalid",
      "The versioned orchestration definition is invalid.",
      violations,
    );
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
