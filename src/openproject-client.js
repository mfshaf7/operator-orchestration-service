import { OpenProjectError } from "./errors.js";

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function toStableJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJson(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = toStableJson(value[key]);
        return result;
      }, {});
  }

  return value;
}

function serializeSourceRef(sourceRef) {
  return JSON.stringify(toStableJson(sourceRef));
}

function buildCapturedDescription({ operator, source, sourceRef, body }) {
  const renderedBody = body?.trim() ? body.trim() : "_No body supplied._";
  const operatorHandle = operator.handle ? `@${operator.handle}` : "_none_";

  return [
    "## Captured idea",
    "",
    renderedBody,
    "",
    "## Discussion excerpt or source context",
    "",
    `- source surface: ${source}`,
    `- source ref: \`${serializeSourceRef(sourceRef)}\``,
    `- operator id: ${operator.id}`,
    `- operator handle: ${operatorHandle}`,
    "",
    "## Triage summary",
    "",
    "_Pending triage._",
    "",
    "## Operator decision notes",
    "",
    "_Pending operator decision._",
  ].join("\n");
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function mapOpenProjectError(statusCode, payload) {
  const message = payload?.message ?? "OpenProject request failed";
  const errorIdentifier = payload?.errorIdentifier ?? null;

  if (statusCode === 401 || statusCode === 403) {
    return new OpenProjectError(
      "authentication_failure",
      message,
      statusCode,
      errorIdentifier,
    );
  }

  if (statusCode === 409) {
    return new OpenProjectError(
      "duplicate_source_ref",
      message,
      statusCode,
      errorIdentifier,
    );
  }

  if (statusCode === 422) {
    return new OpenProjectError(
      "validation_failure",
      message,
      statusCode,
      errorIdentifier,
    );
  }

  return new OpenProjectError(
    "backend_unavailable",
    message,
    statusCode,
    errorIdentifier,
  );
}

export function createCapturePayload(config, capture) {
  return {
    subject: capture.title.trim(),
    description: {
      format: "markdown",
      raw: buildCapturedDescription(capture),
    },
    _links: {
      type: {
        href: `/api/v3/types/${config.ideaTypeId}`,
      },
      status: {
        href: `/api/v3/statuses/${config.capturedStatusId}`,
      },
    },
    [`customField${config.customFieldSourceSurfaceId}`]: capture.source,
    [`customField${config.customFieldSourceReferenceId}`]: serializeSourceRef(
      capture.sourceRef,
    ),
  };
}

export function createOpenProjectClient({
  config,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }

  const requestHeaders = () => {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };

    if (config.hostHeader) {
      headers.Host = config.hostHeader;
    }

    return headers;
  };

  return {
    async checkProjectReachability() {
      let response;

      try {
        response = await fetchImpl(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
        );
      } catch (error) {
        throw new OpenProjectError(
          "backend_unavailable",
          error.message,
          503,
          "network_error",
        );
      }

      if (!response.ok) {
        throw mapOpenProjectError(response.status, await readJson(response));
      }

      const payload = await readJson(response);

      return {
        targetRef: `openproject://projects/${payload.identifier ?? config.projectIdentifier}`,
      };
    },

    async captureIdea(capture) {
      const payload = createCapturePayload(config, capture);
      let response;

      try {
        response = await fetchImpl(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}/work_packages`,
          ),
          {
            body: JSON.stringify(payload),
            headers: requestHeaders(),
            method: "POST",
          },
        );
      } catch (error) {
        throw new OpenProjectError(
          "backend_unavailable",
          error.message,
          503,
          "network_error",
        );
      }

      const responsePayload = await readJson(response);

      if (!response.ok) {
        throw mapOpenProjectError(response.status, responsePayload);
      }

      return {
        id: responsePayload.id,
        recordRef: `openproject://work_packages/${responsePayload.id}`,
        status:
          responsePayload._links?.status?.title ??
          responsePayload.status ??
          "captured",
      };
    },
  };
}
