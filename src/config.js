const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const DEFAULT_SERVICE_NAME = "operator-orchestration-service";

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

export function loadConfig(env = process.env) {
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
      sharedSecret: env.CALLER_AUTH_SHARED_SECRET ?? "",
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
      artReadinessBaseUrl: env.WGCF_ART_READINESS_BASE_URL ?? "",
      artReadinessMode: normalizeWgcfArtReadinessMode(env),
    },
  };
}

export function getCallerAuthMode(config) {
  return config.callerAuth.sharedSecret ? "required" : "development-bypass";
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
