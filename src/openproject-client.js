import http from "node:http";
import https from "node:https";

import { OpenProjectError } from "./errors.js";
import {
  deserializeSourceIdentity,
  normalizeSourceIdentity,
  serializeSourceIdentity,
  toIdeaId,
} from "./idea-model.js";

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function buildCapturedDescription({ operator, source, body }) {
  const renderedBody = body?.trim() ? body.trim() : "_No body supplied._";
  const operatorHandle = operator.handle ? `@${operator.handle}` : "_none_";

  return [
    "## Captured idea",
    "",
    renderedBody,
    "",
    "## Discussion excerpt or source context",
    "",
    `- source surface: ${source.surface}`,
    `- source ref: \`${serializeSourceIdentity(source)}\``,
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

  if (statusCode === 404) {
    return new OpenProjectError(
      "not_found",
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
  const source = normalizeSourceIdentity(capture.source);

  return {
    subject: capture.title.trim(),
    description: {
      format: "markdown",
      raw: buildCapturedDescription({
        body: capture.body,
        operator: capture.operator,
        source,
      }),
    },
    _links: {
      type: {
        href: `/api/v3/types/${config.ideaTypeId}`,
      },
      status: {
        href: `/api/v3/statuses/${config.capturedStatusId}`,
      },
    },
    [`customField${config.customFieldSourceSurfaceId}`]: source.surface,
    [`customField${config.customFieldSourceReferenceId}`]: serializeSourceIdentity(
      source,
    ),
  };
}

function extractDescriptionSection(rawDescription, heading) {
  if (!rawDescription) {
    return null;
  }

  const marker = `## ${heading}`;
  const start = rawDescription.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const sectionStart = start + marker.length;
  const nextHeading = rawDescription.indexOf("\n## ", sectionStart);
  const section = rawDescription
    .slice(sectionStart, nextHeading === -1 ? undefined : nextHeading)
    .trim();

  return section || null;
}

function normalizePendingSection(value, pendingSentinel) {
  if (!value || value === pendingSentinel) {
    return null;
  }

  if (value === "_No body supplied._") {
    return "";
  }

  return value;
}

function parseOperatorContext(rawDescription) {
  const sourceContext = extractDescriptionSection(
    rawDescription,
    "Discussion excerpt or source context",
  );

  if (!sourceContext) {
    return {
      handle: null,
      id: null,
    };
  }

  const operatorIdMatch = sourceContext.match(/^- operator id: (.+)$/m);
  const operatorHandleMatch = sourceContext.match(/^- operator handle: (.+)$/m);
  const operatorHandle = operatorHandleMatch?.[1]?.trim() ?? null;

  return {
    handle:
      operatorHandle && operatorHandle !== "_none_"
        ? operatorHandle.replace(/^@/, "")
        : null,
    id: operatorIdMatch?.[1]?.trim() ?? null,
  };
}

export function mapWorkPackageToIdeaRecord(config, payload) {
  const rawDescription = payload?.description?.raw ?? "";
  const sourceSurface =
    payload?.[`customField${config.customFieldSourceSurfaceId}`] ?? "";
  const sourceReference =
    payload?.[`customField${config.customFieldSourceReferenceId}`] ?? "";

  return {
    body: normalizePendingSection(
      extractDescriptionSection(rawDescription, "Captured idea"),
      "_No body supplied._",
    ),
    createdAt: payload?.createdAt ?? null,
    ideaId: toIdeaId(payload.id),
    operator: parseOperatorContext(rawDescription),
    operatorDecisionNotes: normalizePendingSection(
      extractDescriptionSection(rawDescription, "Operator decision notes"),
      "_Pending operator decision._",
    ),
    recordRef: `openproject://work_packages/${payload.id}`,
    source: deserializeSourceIdentity(sourceReference, sourceSurface),
    status:
      payload?._links?.status?.title ??
      payload?.status ??
      "captured",
    title: payload?.subject ?? "",
    triageSummary: normalizePendingSection(
      extractDescriptionSection(rawDescription, "Triage summary"),
      "_Pending triage._",
    ),
    updatedAt: payload?.updatedAt ?? null,
  };
}

export function createNodeRequestImpl({
  httpImpl = http,
  httpsImpl = https,
} = {}) {
  return function nodeRequestImpl(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === "https:" ? httpsImpl : httpImpl;
      const request = transport.request(
        parsedUrl,
        {
          headers: options.headers,
          method: options.method ?? "GET",
        },
        (response) => {
          const chunks = [];

          response.on("data", (chunk) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              ok:
                typeof response.statusCode === "number" &&
                response.statusCode >= 200 &&
                response.statusCode < 300,
              status: response.statusCode ?? 0,
              text: async () => text,
            });
          });
        },
      );

      request.on("error", reject);

      if (options.body) {
        request.write(options.body);
      }

      request.end();
    });
  };
}

export function createOpenProjectClient({
  config,
  requestImpl,
  fetchImpl,
} = {}) {
  const executeRequest =
    requestImpl ?? fetchImpl ?? createNodeRequestImpl();

  if (!executeRequest) {
    throw new Error("request implementation is required");
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
        response = await executeRequest(
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
        response = await executeRequest(
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

    async getIdea(recordId) {
      let response;

      try {
        response = await executeRequest(
          joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}`),
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

      const responsePayload = await readJson(response);

      if (!response.ok) {
        throw mapOpenProjectError(response.status, responsePayload);
      }

      return mapWorkPackageToIdeaRecord(config, responsePayload);
    },

    async lookupIdeaBySource(source) {
      const normalizedSource = normalizeSourceIdentity(source);
      const filters = JSON.stringify([
        {
          [`customField${config.customFieldSourceSurfaceId}`]: {
            operator: "=",
            values: [normalizedSource.surface],
          },
        },
        {
          [`customField${config.customFieldSourceReferenceId}`]: {
            operator: "=",
            values: [serializeSourceIdentity(normalizedSource)],
          },
        },
      ]);
      const params = new URLSearchParams({
        filters,
      });
      let response;

      try {
        response = await executeRequest(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}/work_packages?${params.toString()}`,
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

      const responsePayload = await readJson(response);

      if (!response.ok) {
        throw mapOpenProjectError(response.status, responsePayload);
      }

      const elements = Array.isArray(responsePayload?._embedded?.elements)
        ? responsePayload._embedded.elements
        : [];

      if (elements.length === 0) {
        return null;
      }

      if (elements.length > 1) {
        throw new OpenProjectError(
          "duplicate_source_ref",
          "Multiple idea records matched the provided source identity.",
          409,
          "duplicate_source_ref",
        );
      }

      return mapWorkPackageToIdeaRecord(config, elements[0]);
    },
  };
}
