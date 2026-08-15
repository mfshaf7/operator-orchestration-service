const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const DEFAULT_SERVICE_NAME = "operator-orchestration-service";
const DEFAULT_TEMPORAL_ADDRESS = "temporal-frontend.temporal.svc:7233";
const DEFAULT_TEMPORAL_NAMESPACE = "default";
export const ORCHESTRATION_API_TEMPORAL_IDENTITY =
  "operator-orchestration-service-api";
export const ORCHESTRATION_WORKER_TEMPORAL_IDENTITY = "oos-workflow-worker";

export const ORCHESTRATION_API_PROCESS_ROLE = "api";
export const ORCHESTRATION_WORKER_PROCESS_ROLE = "workflow-worker";

function parseInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseCsv(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJsonStringArray(value) {
  if (!value?.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseCallerSecretMap(value, sharedSecret) {
  if (!value?.trim()) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError(
      "CALLER_AUTH_SECRETS_JSON must be a valid JSON object of caller IDs to non-empty secrets.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(
      "CALLER_AUTH_SECRETS_JSON must be a JSON object of caller IDs to non-empty secrets.",
    );
  }

  const normalized = Object.entries(parsed).map(([callerId, secret]) => [
    callerId.trim(),
    typeof secret === "string" ? secret.trim() : "",
  ]);
  if (normalized.some(([callerId, secret]) => !callerId || !secret)) {
    throw new TypeError(
      "CALLER_AUTH_SECRETS_JSON caller IDs and secrets must be non-empty strings.",
    );
  }
  if (new Set(normalized.map(([callerId]) => callerId)).size !== normalized.length) {
    throw new TypeError(
      "CALLER_AUTH_SECRETS_JSON caller IDs must remain unique after normalization.",
    );
  }
  const secrets = normalized.map(([, secret]) => secret);
  if (new Set(secrets).size !== secrets.length || (sharedSecret && secrets.includes(sharedSecret))) {
    throw new TypeError(
      "CALLER_AUTH_SECRETS_JSON must use distinct secrets that differ from CALLER_AUTH_SHARED_SECRET.",
    );
  }
  return Object.fromEntries(normalized);
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeWgcfArtReadinessMode(env) {
  const explicitMode = env.WGCF_ART_READINESS_MODE;
  if (explicitMode !== undefined && explicitMode !== null && explicitMode !== "") {
    const normalized = String(explicitMode).trim().toLowerCase();
    if (["required", "enforced", "on"].includes(normalized)) {
      return "required";
    }
    return "off";
  }

  return parseBoolean(env.WGCF_ART_READINESS_REQUIRED) ? "required" : "off";
}

export function loadConfig(
  env = process.env,
  { orchestrationProcessRole = ORCHESTRATION_API_PROCESS_ROLE } = {},
) {
  if (
    ![
      ORCHESTRATION_API_PROCESS_ROLE,
      ORCHESTRATION_WORKER_PROCESS_ROLE,
    ].includes(orchestrationProcessRole)
  ) {
    throw new TypeError("Unsupported orchestration process role.");
  }
  const defaultTemporalIdentity =
    orchestrationProcessRole === ORCHESTRATION_WORKER_PROCESS_ROLE
      ? ORCHESTRATION_WORKER_TEMPORAL_IDENTITY
      : ORCHESTRATION_API_TEMPORAL_IDENTITY;
  const callerAuthSharedSecret = env.CALLER_AUTH_SHARED_SECRET ?? "";
  return {
    service: {
      name: DEFAULT_SERVICE_NAME,
      host: env.HOST ?? DEFAULT_HOST,
      port: parseInteger(env.PORT) ?? DEFAULT_PORT,
      version: env.SERVICE_VERSION ?? env.npm_package_version ?? "0.1.0-dev",
      gitCommit: env.GIT_COMMIT ?? null,
    },
    callerAuth: {
      allowedIds: parseCsv(env.CALLER_ALLOWED_IDS),
      callerSecrets: parseCallerSecretMap(
        env.CALLER_AUTH_SECRETS_JSON,
        callerAuthSharedSecret,
      ),
      sharedSecret: callerAuthSharedSecret,
    },
    openProject: {
      baseUrl: env.OPENPROJECT_BASE_URL ?? "",
      hostHeader: env.OPENPROJECT_HOST_HEADER ?? "",
      apiToken: env.OPENPROJECT_API_TOKEN ?? "",
      projectIdentifier: env.OPENPROJECT_PROJECT_IDENTIFIER ?? "workspace-proposals",
      deliveryProjectIdentifier: env.OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER ?? "",
      ideaTypeId: parseInteger(env.OPENPROJECT_IDEA_TYPE_ID),
      deliveryTopLevelTypeId: parseInteger(env.OPENPROJECT_DELIVERY_TOP_LEVEL_TYPE_ID),
      capturedStatusId: parseInteger(env.OPENPROJECT_CAPTURED_STATUS_ID),
      triagedStatusId: parseInteger(env.OPENPROJECT_TRIAGED_STATUS_ID),
      parkedStatusId: parseInteger(env.OPENPROJECT_PARKED_STATUS_ID),
      acceptedStatusId: parseInteger(env.OPENPROJECT_ACCEPTED_STATUS_ID),
      rejectedStatusId: parseInteger(env.OPENPROJECT_REJECTED_STATUS_ID),
      implementedStatusId: parseInteger(env.OPENPROJECT_IMPLEMENTED_STATUS_ID),
      deliveryNewStatusId: parseInteger(env.OPENPROJECT_DELIVERY_NEW_STATUS_ID),
      customFieldSuspectedOwnerId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_SUSPECTED_OWNER_ID,
      ),
      customFieldAffectedScopeId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_AFFECTED_SCOPE_ID,
      ),
      customFieldTrustBoundaryAreasId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_TRUST_BOUNDARY_AREAS_ID,
      ),
      customFieldTriageConfidenceId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_TRIAGE_CONFIDENCE_ID,
      ),
      customFieldAiAssistLaneId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_AI_ASSIST_LANE_ID,
      ),
      customFieldSourceSurfaceId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID,
      ),
      customFieldSourceReferenceId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID,
      ),
      customFieldDeliveryRefId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID,
      ),
      customFieldProposalWorkflowStateId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID,
      ),
      deliveryCustomFieldOriginIdeaRefId: parseInteger(
        env.OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID,
      ),
      deliveryCustomFieldPm2PhaseId: parseInteger(
        env.OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID,
      ),
      deliveryCustomFieldTargetPiId: parseInteger(
        env.OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID,
      ),
    },
    ideaEvaluation: {
      ownerTokens: parseJsonStringArray(env.WORKSPACE_OWNER_TOKENS_JSON),
      scopeTokens: parseJsonStringArray(env.WORKSPACE_SCOPE_TOKENS_JSON),
    },
    wgcf: {
      deliveryArtBaseUrl: env.WGCF_DELIVERY_ART_BASE_URL ?? "",
      deliveryArtCallerId:
        env.WGCF_DELIVERY_ART_CALLER_ID ?? "operator-orchestration-service",
      deliveryArtCallerSecret: env.WGCF_DELIVERY_ART_CALLER_SECRET ?? "",
      artReadinessBaseUrl: env.WGCF_ART_READINESS_BASE_URL ?? "",
      artReadinessMode: normalizeWgcfArtReadinessMode(env),
    },
    deliveryArt: {
      mutationEnabled: parseBoolean(env.OOS_DELIVERY_ART_MUTATION_ENABLED),
      writerTopology: env.OOS_DELIVERY_ART_WRITER_TOPOLOGY?.trim() || null,
    },
    orchestration: {
      processRole: orchestrationProcessRole,
      runtimeEnabled: parseBoolean(env.OOS_ORCHESTRATION_RUNTIME_ENABLED),
      workerEnabled: parseBoolean(env.OOS_ORCHESTRATION_WORKER_ENABLED),
      executionAuthorized: parseBoolean(
        env.OOS_ORCHESTRATION_EXECUTION_AUTHORIZED,
      ),
      activationEvidence: {
        manifestPath:
          env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_PATH ?? "",
        manifestDigest:
          env.OOS_ORCHESTRATION_ACTIVATION_EVIDENCE_DIGEST ?? "",
      },
      controlledProof: {
        enabled: parseBoolean(
          env.OOS_ORCHESTRATION_CONTROLLED_PROOF_ENABLED,
        ),
        contextPath:
          env.OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_PATH ?? "",
        contextDigest:
          env.OOS_ORCHESTRATION_CONTROLLED_PROOF_CONTEXT_DIGEST ?? "",
      },
      retirementEvidence: {
        manifestPath:
          env.OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_PATH ?? "",
        manifestDigest:
          env.OOS_ORCHESTRATION_RETIREMENT_EVIDENCE_DIGEST ?? "",
      },
      retirementReceiptAttestation: {
        keyId:
          env.OOS_ORCHESTRATION_RETIREMENT_RECEIPT_KEY_ID ?? "",
        privateKeyPath:
          env.OOS_ORCHESTRATION_RETIREMENT_RECEIPT_PRIVATE_KEY_PATH ?? "",
        publicKeyPath:
          env.OOS_ORCHESTRATION_RETIREMENT_RECEIPT_PUBLIC_KEY_PATH ?? "",
      },
      temporal: {
        address: env.OOS_TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS,
        namespace: env.OOS_TEMPORAL_NAMESPACE ?? DEFAULT_TEMPORAL_NAMESPACE,
        identity:
          env.OOS_TEMPORAL_IDENTITY ??
          defaultTemporalIdentity,
      },
    },
  };
}

export function getCallerAuthMode(config) {
  return config.callerAuth.sharedSecret ||
      Object.keys(config.callerAuth.callerSecrets ?? {}).length > 0
    ? "required"
    : "development-bypass";
}

export function getOpenProjectMissingConfig(config) {
  const missing = [];
  const target = config.openProject;

  if (!target.baseUrl) {
    missing.push("OPENPROJECT_BASE_URL");
  }

  if (!target.apiToken) {
    missing.push("OPENPROJECT_API_TOKEN");
  }

  if (!target.projectIdentifier) {
    missing.push("OPENPROJECT_PROJECT_IDENTIFIER");
  }

  if (!target.ideaTypeId) {
    missing.push("OPENPROJECT_IDEA_TYPE_ID");
  }

  if (!target.capturedStatusId) {
    missing.push("OPENPROJECT_CAPTURED_STATUS_ID");
  }

  if (!target.triagedStatusId) {
    missing.push("OPENPROJECT_TRIAGED_STATUS_ID");
  }

  if (!target.parkedStatusId) {
    missing.push("OPENPROJECT_PARKED_STATUS_ID");
  }

  if (!target.acceptedStatusId) {
    missing.push("OPENPROJECT_ACCEPTED_STATUS_ID");
  }

  if (!target.rejectedStatusId) {
    missing.push("OPENPROJECT_REJECTED_STATUS_ID");
  }

  if (!target.customFieldSourceSurfaceId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID");
  }

  if (!target.customFieldSourceReferenceId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID");
  }

  return missing;
}

export function getIdeaEvaluationMissingConfig(config) {
  const missing = [];
  const target = config.openProject;

  if (!target.customFieldSuspectedOwnerId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_SUSPECTED_OWNER_ID");
  }

  if (!target.customFieldAffectedScopeId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_AFFECTED_SCOPE_ID");
  }

  if (!target.customFieldTrustBoundaryAreasId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_TRUST_BOUNDARY_AREAS_ID");
  }

  if (!target.customFieldTriageConfidenceId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_TRIAGE_CONFIDENCE_ID");
  }

  if (!target.customFieldAiAssistLaneId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_AI_ASSIST_LANE_ID");
  }

  if (!config.ideaEvaluation.ownerTokens.length) {
    missing.push("WORKSPACE_OWNER_TOKENS_JSON");
  }

  if (!config.ideaEvaluation.scopeTokens.length) {
    missing.push("WORKSPACE_SCOPE_TOKENS_JSON");
  }

  return missing;
}

export function getProposalWorkflowMissingConfig(config) {
  const missing = getOpenProjectMissingConfig(config);

  if (!config.openProject.customFieldProposalWorkflowStateId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID");
  }

  return [...new Set(missing)];
}

export function getAcceptedIdeaDeliveryMissingConfig(config) {
  const missing = [];
  const target = config.openProject;

  if (!target.deliveryProjectIdentifier) {
    missing.push("OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER");
  }

  if (!target.deliveryTopLevelTypeId) {
    missing.push("OPENPROJECT_DELIVERY_TOP_LEVEL_TYPE_ID");
  }

  if (!target.deliveryNewStatusId) {
    missing.push("OPENPROJECT_DELIVERY_NEW_STATUS_ID");
  }

  if (!target.customFieldDeliveryRefId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID");
  }

  if (!target.deliveryCustomFieldOriginIdeaRefId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID");
  }

  if (!target.deliveryCustomFieldPm2PhaseId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID");
  }

  if (!target.deliveryCustomFieldTargetPiId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID");
  }

  return missing;
}

export function getAcceptedIdeaDeliveryCloseoutMissingConfig(config) {
  const missing = [];
  const target = config.openProject;

  if (!target.deliveryProjectIdentifier) {
    missing.push("OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER");
  }

  if (!target.customFieldDeliveryRefId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_DELIVERY_REF_ID");
  }

  if (!target.deliveryCustomFieldOriginIdeaRefId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_ORIGIN_IDEA_REF_ID");
  }

  if (!target.implementedStatusId) {
    missing.push("OPENPROJECT_IMPLEMENTED_STATUS_ID");
  }

  return missing;
}

export function getDeliveryExecutionMissingConfig(config) {
  const missing = [];
  const target = config.openProject;

  if (!target.baseUrl) {
    missing.push("OPENPROJECT_BASE_URL");
  }

  if (!target.apiToken) {
    missing.push("OPENPROJECT_API_TOKEN");
  }

  if (!target.deliveryProjectIdentifier) {
    missing.push("OPENPROJECT_DELIVERY_PROJECT_IDENTIFIER");
  }

  return missing;
}

export function getDeliveryInitiativeMissingConfig(config) {
  const missing = getDeliveryExecutionMissingConfig(config);
  const target = config.openProject;

  if (!target.deliveryCustomFieldPm2PhaseId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_PM2_PHASE_ID");
  }

  if (!target.deliveryCustomFieldTargetPiId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID");
  }

  return [...new Set(missing)];
}

export function getDeliveryInitiativeGovernanceMissingConfig(config) {
  return getDeliveryInitiativeMissingConfig(config);
}

export function getDeliveryPlanApplyMissingConfig(config) {
  return getDeliveryInitiativeMissingConfig(config);
}

export function getDeliveryWorkItemCreateMissingConfig(config) {
  return getDeliveryExecutionMissingConfig(config);
}

export function getDeliveryWorkItemMoveMissingConfig(config) {
  return getDeliveryExecutionMissingConfig(config);
}

export function getDeliveryWorkItemBlockerMissingConfig(config) {
  return getDeliveryExecutionMissingConfig(config);
}

export function getDeliveryWorkItemParkingMissingConfig(config) {
  return getDeliveryExecutionMissingConfig(config);
}

export function getDeliveryWorkItemDependencyMissingConfig(config) {
  return getDeliveryExecutionMissingConfig(config);
}

export function getDeliveryWorkItemUpdateMissingConfig(config) {
  const missing = getDeliveryExecutionMissingConfig(config);
  const target = config.openProject;

  if (!target.deliveryCustomFieldTargetPiId) {
    missing.push("OPENPROJECT_DELIVERY_CUSTOM_FIELD_TARGET_PI_ID");
  }

  return [...new Set(missing)];
}

export function getWgcfArtReadinessMissingConfig(config) {
  const missing = [];
  if (config.wgcf.artReadinessMode === "required" && !config.wgcf.artReadinessBaseUrl) {
    missing.push("WGCF_ART_READINESS_BASE_URL");
  }
  return missing;
}
