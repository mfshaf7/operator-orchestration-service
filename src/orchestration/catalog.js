import { readFileSync } from "node:fs";

import {
  ORCHESTRATION_API_PROCESS_ROLE,
  ORCHESTRATION_WORKER_PROCESS_ROLE,
} from "../config.js";
import {
  VALIDATION_READINESS_API_CALLER_ID,
  VALIDATION_READINESS_SOURCE_DOMAIN,
  VALIDATION_READINESS_DEFINITION_ID,
  VALIDATION_READINESS_DEFINITION_VERSION,
} from "./constants.js";
import {
  ACTIVATION_EVIDENCE_DIGEST_KEY,
  ACTIVATION_EVIDENCE_GATES,
  ACTIVATION_EVIDENCE_PATH_KEY,
  resolveActivationEvidence,
} from "./activation-evidence.js";
import { OrchestrationContractError } from "./contracts.js";

const definitionUrl = new URL(
  "../../contracts/orchestration/definitions/validation-readiness-run.v1.json",
  import.meta.url,
);
const sourceDefinition = loadDefinition(definitionUrl);
const CALLER_AUTHENTICATION_GATE = callerAuthenticationGate();
const SWITCH_GATES = Object.freeze([
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
  const resolvedEvidence = resolveActivationEvidence(config, {
    processRole: ORCHESTRATION_API_PROCESS_ROLE,
  });
  const evidenceGates = ACTIVATION_EVIDENCE_GATES.map(({ gateId, owner }) => {
    const evidence = resolvedEvidence.valid
      ? resolvedEvidence.evidence[gateId]
      : null;
    return gate(
      gateId,
      Boolean(evidence),
      owner,
      evidence?.record_ref ?? resolvedEvidence.detail,
    );
  });
  const gates = [
    ...evidenceGates,
    CALLER_AUTHENTICATION_GATE.project(config),
    ...SWITCH_GATES.map((definition) => definition.project(config)),
  ];

  return {
    start_allowed: gates.every((entry) => entry.satisfied),
    gates,
  };
}

export function getOrchestrationActivationMissingConfig(config) {
  const missing = evidenceMissingConfig(
    config,
    ORCHESTRATION_API_PROCESS_ROLE,
  );
  missing.push(
    ...CALLER_AUTHENTICATION_GATE.missingEnvironmentKeys(config),
    ...SWITCH_GATES.flatMap((definition) =>
      definition.missingEnvironmentKeys(config),
    ),
  );
  return missing;
}

export function getOrchestrationWorkerActivationMissingConfig(config) {
  const missing = evidenceMissingConfig(
    config,
    ORCHESTRATION_WORKER_PROCESS_ROLE,
  );
  missing.push(
    ...SWITCH_GATES.flatMap((definition) =>
      definition.missingEnvironmentKeys(config),
    ),
  );
  return missing;
}

function evidenceMissingConfig(config, processRole) {
  const missing = [];
  const activationEvidence = config?.orchestration?.activationEvidence;
  if (!activationEvidence?.manifestPath?.trim()) {
    missing.push(ACTIVATION_EVIDENCE_PATH_KEY);
  }
  if (!activationEvidence?.manifestDigest?.trim()) {
    missing.push(ACTIVATION_EVIDENCE_DIGEST_KEY);
  }
  if (
    missing.length === 0 &&
    !resolveActivationEvidence(config, { processRole }).valid
  ) {
    missing.push(ACTIVATION_EVIDENCE_PATH_KEY);
  }
  return missing;
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

function callerAuthenticationGate() {
  return {
    missingEnvironmentKeys(config) {
      const missing = [];
      if (!config.callerAuth.sharedSecret.trim()) {
        missing.push("CALLER_AUTH_SHARED_SECRET");
      }
      if (
        !config.callerAuth.allowedIds.includes(
          VALIDATION_READINESS_API_CALLER_ID,
        )
      ) {
        missing.push("CALLER_ALLOWED_IDS");
      }
      return missing;
    },
    project(config) {
      const satisfied = this.missingEnvironmentKeys(config).length === 0;
      return gate(
        "operator-caller-authenticated",
        satisfied,
        "operator-orchestration-service",
        satisfied
          ? "The admitted console caller requires a shared credential."
          : "The durable run surface does not have an authenticated admitted console caller.",
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
    missingEnvironmentKeys(config) {
      return this.project(config).satisfied ? [] : [environmentKey];
    },
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
