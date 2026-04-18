import { randomUUID } from "node:crypto";

import { HttpError, OpenProjectError } from "./errors.js";
import {
  getCallerAuthMode,
  getOpenProjectMissingConfig,
} from "./config.js";
import { normalizeSourceIdentity } from "./idea-model.js";

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} must be a non-empty string.`,
    );
  }
}

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} must be an object.`,
    );
  }
}

function authenticateCaller(request, config) {
  const callerId = request.headers["x-oos-caller-id"];
  const callerSecret = request.headers["x-oos-caller-secret"];

  if (!config.callerAuth.sharedSecret) {
    return {
      id:
        typeof callerId === "string" && callerId.trim()
          ? callerId.trim()
          : "development-bypass",
      authMode: getCallerAuthMode(config),
    };
  }

  if (typeof callerId !== "string" || !callerId.trim()) {
    throw new HttpError(
      401,
      "caller_auth_required",
      "Caller id header is required.",
    );
  }

  if (callerSecret !== config.callerAuth.sharedSecret) {
    throw new HttpError(
      401,
      "caller_auth_invalid",
      "Caller secret is invalid.",
    );
  }

  if (
    config.callerAuth.allowedIds.length > 0 &&
    !config.callerAuth.allowedIds.includes(callerId.trim())
  ) {
    throw new HttpError(
      403,
      "caller_not_allowed",
      "Caller id is not allowed.",
    );
  }

  return {
    id: callerId.trim(),
    authMode: getCallerAuthMode(config),
  };
}

function createCorrelationId(request) {
  return typeof request.headers["x-correlation-id"] === "string" &&
    request.headers["x-correlation-id"].trim()
    ? request.headers["x-correlation-id"].trim()
    : randomUUID();
}

function normalizeIdeaSource(body) {
  if (typeof body.source === "string") {
    assertNonEmptyString(body.source, "source");
    assertObject(body.source_ref, "source_ref");

    return normalizeSourceIdentity(
      {
        surface: body.source.trim(),
      },
      body.source_ref,
    );
  }

  assertObject(body.source, "source");
  assertNonEmptyString(body.source.surface, "source.surface");

  if (body.source.context_ref !== undefined) {
    assertObject(body.source.context_ref, "source.context_ref");
  }

  if (body.source.native_ref !== undefined) {
    assertObject(body.source.native_ref, "source.native_ref");
  }

  return normalizeSourceIdentity(body.source);
}

async function buildReadiness(config, openProjectClient) {
  const failing = [];
  const checks = {};
  const missing = getOpenProjectMissingConfig(config);

  if (missing.length > 0) {
    failing.push(`openproject.config_missing:${missing.join(",")}`);
    checks.openproject = "config-missing";
    return {
      ready: false,
      failing,
      checks,
    };
  }

  try {
    const reachability = await openProjectClient.checkProjectReachability();
    checks.openproject = "reachable";
    checks.openproject_target = reachability.targetRef;
  } catch (error) {
    checks.openproject = "unreachable";
    failing.push(
      `openproject.${error instanceof OpenProjectError ? error.errorClass : "unexpected_error"}`,
    );
  }

  return {
    ready: failing.length === 0,
    failing,
    checks,
  };
}

async function handleCapture({
  request,
  response,
  config,
  ideaService,
}) {
  const caller = authenticateCaller(request, config);
  const body = await readJsonBody(request);
  assertObject(body.operator, "operator");
  assertNonEmptyString(body.operator.id, "operator.id");
  assertNonEmptyString(body.title, "title");
  const source = normalizeIdeaSource(body);

  const result = await ideaService.captureIdea({
    body: typeof body.body === "string" ? body.body : "",
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    operator: {
      handle:
        typeof body.operator.handle === "string"
          ? body.operator.handle.trim()
          : "",
      id: body.operator.id.trim(),
    },
    source,
    title: body.title.trim(),
  });

  sendJson(response, 200, result);
}

async function handleWorkflowCatalog({
  config,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const result = await ideaService.listWorkflows({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
  });

  sendJson(response, 200, result);
}

async function handleWorkflowDescriptor({
  config,
  ideaService,
  request,
  response,
  workflowId,
}) {
  const caller = authenticateCaller(request, config);
  const descriptor = await ideaService.getWorkflowDescriptor({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    workflowId,
  });

  if (!descriptor) {
    throw new HttpError(404, "workflow_not_found", "Workflow descriptor not found.");
  }

  sendJson(response, 200, descriptor);
}

async function handleGetIdea({
  config,
  ideaService,
  request,
  response,
  ideaId,
}) {
  const caller = authenticateCaller(request, config);
  const record = await ideaService.getIdea({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    ideaId,
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleIdeaLookup({
  config,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const body = await readJsonBody(request);
  const source = normalizeIdeaSource(body);
  const record = await ideaService.lookupIdea({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    source,
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

export function createApp({ config, ideaService, openProjectClient }) {
  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, {
          ok: true,
          status: "live",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/readyz") {
        const readiness = await buildReadiness(config, openProjectClient);
        sendJson(response, readiness.ready ? 200 : 503, readiness);
        return;
      }

      if (request.method === "GET" && url.pathname === "/version") {
        sendJson(response, 200, {
          service: config.service.name,
          version: config.service.version,
          gitCommit: config.service.gitCommit,
          callerAuthMode: getCallerAuthMode(config),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/workflows") {
        await handleWorkflowCatalog({
          config,
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/workflows\/[^/]+$/.test(url.pathname)
      ) {
        await handleWorkflowDescriptor({
          config,
          ideaService,
          request,
          response,
          workflowId: url.pathname.split("/").at(-1),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/ideas/capture") {
        await handleCapture({
          config,
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/ideas\/[^/]+$/.test(url.pathname)
      ) {
        await handleGetIdea({
          config,
          ideaService,
          request,
          response,
          ideaId: url.pathname.split("/").at(-1),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/ideas/lookup") {
        await handleIdeaLookup({
          config,
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/triage$/.test(url.pathname)
      ) {
        throw new HttpError(
          501,
          "not_implemented",
          "Triage workflow is not implemented in phase 1.",
        );
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/decision$/.test(url.pathname)
      ) {
        throw new HttpError(
          501,
          "not_implemented",
          "Decision workflow is not implemented in phase 1.",
        );
      }

      throw new HttpError(404, "not_found", "Endpoint not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, {
          error: error.code,
          message: error.message,
          details: error.details,
        });
        return;
      }

      if (error instanceof OpenProjectError) {
        sendJson(response, 502, {
          error: error.errorClass,
          message: error.message,
          details: error.details,
        });
        return;
      }

      sendJson(response, 500, {
        error: "internal_error",
        message: "Unexpected server error.",
      });
    }
  };
}
