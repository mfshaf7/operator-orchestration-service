const DEFAULT_HOST = "127.0.0.1";
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
      ideaTypeId: parseInteger(env.OPENPROJECT_IDEA_TYPE_ID),
      capturedStatusId: parseInteger(env.OPENPROJECT_CAPTURED_STATUS_ID),
      customFieldSourceSurfaceId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID,
      ),
      customFieldSourceReferenceId: parseInteger(
        env.OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID,
      ),
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

  if (!target.customFieldSourceSurfaceId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_SOURCE_SURFACE_ID");
  }

  if (!target.customFieldSourceReferenceId) {
    missing.push("OPENPROJECT_CUSTOM_FIELD_SOURCE_REFERENCE_ID");
  }

  return missing;
}
