import { randomUUID } from "node:crypto";

import { HttpError, OpenProjectError } from "./errors.js";
import {
  getAcceptedIdeaDeliveryCloseoutMissingConfig,
  getAcceptedIdeaDeliveryMissingConfig,
  getCallerAuthMode,
  getDeliveryExecutionMissingConfig,
  getDeliveryWorkItemUpdateMissingConfig,
  getIdeaEvaluationMissingConfig,
  getOpenProjectMissingConfig,
} from "./config.js";
import { normalizeSourceIdentity } from "./idea-model.js";
import {
  listIdeaLifecycleStatuses,
  normalizeIdeaLifecycleStatus,
} from "./workflow-catalog.js";

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

function normalizeStringArray(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} must be an array of strings.`,
    );
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new HttpError(
        400,
        "validation_failed",
        `${fieldName}[${index}] must be a non-empty string.`,
      );
    }

    return entry.trim();
  });
}

function validateEvaluationTokens(values, allowedValues, fieldName) {
  const unknown = values.filter((entry) => !allowedValues.includes(entry));
  if (unknown.length > 0) {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} contains unsupported values: ${unknown.join(", ")}.`,
    );
  }
}

function parsePositiveInteger(value, fieldName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} must be an integer between ${min} and ${max}.`,
    );
  }

  return parsed;
}

function parseBooleanQuery(value, fieldName) {
  if (value === null) {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new HttpError(
    400,
    "validation_failed",
    `${fieldName} must be true or false when provided.`,
  );
}

function parseOptionalBooleanInput(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(
      400,
      "validation_failed",
      `${fieldName} must be a boolean when provided.`,
    );
  }

  return value;
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

async function handleListIdeas({
  config,
  ideaService,
  request,
  response,
  url,
}) {
  const caller = authenticateCaller(request, config);
  const limit = parsePositiveInteger(url.searchParams.get("limit"), "limit", {
    max: 25,
  }) ?? 10;
  const offset = parsePositiveInteger(url.searchParams.get("offset"), "offset") ?? 1;
  const rawStatus = url.searchParams.get("status");
  let status = null;
  if (rawStatus !== null) {
    status = normalizeIdeaLifecycleStatus(rawStatus);
    if (!status) {
      throw new HttpError(
        400,
        "validation_failed",
        `status must be one of: ${listIdeaLifecycleStatuses().join(", ")}.`,
      );
    }
  }

  const records = await ideaService.listIdeas({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    limit,
    offset,
    status,
  });

  sendJson(response, 200, records);
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

async function handleIdeaTriage({
  config,
  ideaId,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const body = await readJsonBody(request);
  assertObject(body.operator, "operator");
  assertNonEmptyString(body.operator.id, "operator.id");
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.summary, "input.summary");

  const record = await ideaService.triageIdea({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    ideaId,
    operator: {
      handle:
        typeof body.operator.handle === "string"
          ? body.operator.handle.trim()
          : "",
      id: body.operator.id.trim(),
    },
    summary: body.input.summary.trim(),
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleIdeaDecision({
  config,
  ideaId,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const body = await readJsonBody(request);
  assertObject(body.operator, "operator");
  assertNonEmptyString(body.operator.id, "operator.id");
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.status, "input.status");
  assertNonEmptyString(body.input.notes, "input.notes");

  const status = normalizeIdeaLifecycleStatus(body.input.status);
  if (!status || !["parked", "accepted", "rejected"].includes(status)) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.status must be one of: parked, accepted, rejected.",
    );
  }

  const record = await ideaService.decideIdea({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    ideaId,
    operator: {
      handle:
        typeof body.operator.handle === "string"
          ? body.operator.handle.trim()
          : "",
      id: body.operator.id.trim(),
    },
    notes: body.input.notes.trim(),
    status,
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleIdeaConsume({
  config,
  ideaId,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = [
    ...new Set([
      ...getOpenProjectMissingConfig(config),
      ...getAcceptedIdeaDeliveryMissingConfig(config),
    ]),
  ];
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "accepted_idea_delivery_not_configured",
      `Accepted idea delivery consumption is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.operator, "operator");
  assertNonEmptyString(body.operator.id, "operator.id");
  assertObject(body.input, "input");

  const targetPi =
    body.input.target_pi === undefined
      ? null
      : (() => {
          assertNonEmptyString(body.input.target_pi, "input.target_pi");
          return body.input.target_pi.trim();
        })();

  const record = await ideaService.consumeIdea({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    ideaId,
    operator: {
      handle:
        typeof body.operator.handle === "string"
          ? body.operator.handle.trim()
          : "",
      id: body.operator.id.trim(),
    },
    targetPi,
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleIdeaCloseout({
  config,
  ideaId,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = [
    ...new Set([
      ...getOpenProjectMissingConfig(config),
      ...getAcceptedIdeaDeliveryCloseoutMissingConfig(config),
    ]),
  ];
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "accepted_idea_delivery_closeout_not_configured",
      `Accepted idea delivery closeout is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.operator, "operator");
  assertNonEmptyString(body.operator.id, "operator.id");
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.closeout_notes, "input.closeout_notes");

  const record = await ideaService.closeoutIdea({
    callerId: caller.id,
    closeoutNotes: body.input.closeout_notes.trim(),
    correlationId: createCorrelationId(request),
    ideaId,
    operator: {
      handle:
        typeof body.operator.handle === "string"
          ? body.operator.handle.trim()
          : "",
      id: body.operator.id.trim(),
    },
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleIdeaEvaluation({
  config,
  ideaId,
  ideaService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getIdeaEvaluationMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "idea_evaluation_not_configured",
      `Idea evaluation metadata is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");

  const suspectedOwner =
    body.input.suspected_owner === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.suspected_owner, "input.suspected_owner");
          return body.input.suspected_owner.trim();
        })();
  const affectedScope = normalizeStringArray(
    body.input.affected_scope,
    "input.affected_scope",
  );
  const trustBoundaryAreas = normalizeStringArray(
    body.input.trust_boundary_areas,
    "input.trust_boundary_areas",
  );
  const confidence =
    body.input.confidence === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.confidence, "input.confidence");
          return body.input.confidence.trim().toLowerCase();
        })();
  const aiAssistLane =
    body.input.ai_assist_lane === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.ai_assist_lane, "input.ai_assist_lane");
          return body.input.ai_assist_lane.trim().toLowerCase();
        })();
  const notes =
    body.input.notes === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.notes, "input.notes");
          return body.input.notes.trim();
        })();

  if (
    suspectedOwner === undefined &&
    affectedScope === undefined &&
    trustBoundaryAreas === undefined &&
    confidence === undefined &&
    aiAssistLane === undefined &&
    notes === undefined
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "input must provide at least one evaluation field.",
    );
  }

  if (suspectedOwner) {
    validateEvaluationTokens(
      [suspectedOwner],
      config.ideaEvaluation.ownerTokens,
      "input.suspected_owner",
    );
  }

  if (affectedScope) {
    validateEvaluationTokens(
      affectedScope,
      config.ideaEvaluation.scopeTokens,
      "input.affected_scope",
    );
  }

  if (trustBoundaryAreas) {
    validateEvaluationTokens(
      trustBoundaryAreas,
      ["identity", "secrets", "delivery", "runtime", "ai"],
      "input.trust_boundary_areas",
    );
  }

  if (
    confidence !== undefined &&
    !["low", "medium", "high"].includes(confidence)
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.confidence must be one of: low, medium, high.",
    );
  }

  if (
    aiAssistLane !== undefined &&
    !["none", "local", "governed", "exception"].includes(aiAssistLane)
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.ai_assist_lane must be one of: none, local, governed, exception.",
    );
  }

  const record = await ideaService.recordIdeaEvaluation({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    evaluation: {
      affectedScope,
      aiAssistLane,
      confidence,
      notes,
      suspectedOwner,
      trustBoundaryAreas,
    },
    ideaId,
  });

  if (!record) {
    throw new HttpError(404, "idea_not_found", "Idea record not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryExecutionSummary({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
  url,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery execution summary is not configured: ${missing.join(", ")}.`,
    );
  }

  const includeDone = parseBooleanQuery(
    url.searchParams.get("include_done"),
    "include_done",
  ) ?? true;
  const includeParked = parseBooleanQuery(
    url.searchParams.get("include_parked"),
    "include_parked",
  ) ?? false;

  const record = await deliveryService.getDeliveryExecutionSummary({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    includeDone,
    includeParked,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemUpdate({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemUpdateMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_update_not_configured",
      `Delivery work-item update is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");

  const status =
    body.input.status === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.status, "input.status");
          return body.input.status.trim();
        })();
  const targetPi =
    body.input.target_pi === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.target_pi, "input.target_pi");
          return body.input.target_pi.trim();
        })();
  const clearTargetPi =
    parseOptionalBooleanInput(
      body.input.clear_target_pi,
      "input.clear_target_pi",
    ) ?? false;
  const assigneeLogin =
    body.input.assignee_login === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.assignee_login, "input.assignee_login");
          return body.input.assignee_login.trim();
        })();
  const clearAssignee =
    parseOptionalBooleanInput(
      body.input.clear_assignee,
      "input.clear_assignee",
    ) ?? false;
  const description =
    body.input.description === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.description, "input.description");
          return body.input.description.trim();
        })();
  const clearDescription =
    parseOptionalBooleanInput(
      body.input.clear_description,
      "input.clear_description",
    ) ?? false;
  const workNote =
    body.input.work_note === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.work_note, "input.work_note");
          return body.input.work_note.trim();
        })();

  if (targetPi !== undefined && clearTargetPi) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.target_pi and input.clear_target_pi=true cannot be used together.",
    );
  }

  if (assigneeLogin !== undefined && clearAssignee) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.assignee_login and input.clear_assignee=true cannot be used together.",
    );
  }

  if (description !== undefined && clearDescription) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.description and input.clear_description=true cannot be used together.",
    );
  }

  if (
    status === undefined &&
    targetPi === undefined &&
    !clearTargetPi &&
    assigneeLogin === undefined &&
    !clearAssignee &&
    description === undefined &&
    !clearDescription &&
    workNote === undefined
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "input must provide at least one delivery work-item update field.",
    );
  }

  const record = await deliveryService.updateDeliveryWorkItem({
    assigneeLogin,
    callerId: caller.id,
    clearAssignee,
    clearDescription,
    clearTargetPi,
    correlationId: createCorrelationId(request),
    description,
    status,
    targetPi,
    workItemId,
    workNote,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

export function createApp({
  config,
  deliveryService,
  ideaService,
  openProjectClient,
}) {
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

      if (request.method === "GET" && url.pathname === "/v1/ideas") {
        await handleListIdeas({
          config,
          ideaService,
          request,
          response,
          url,
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
        await handleIdeaTriage({
          config,
          ideaId: url.pathname.split("/")[3],
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/decision$/.test(url.pathname)
      ) {
        await handleIdeaDecision({
          config,
          ideaId: url.pathname.split("/")[3],
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/consume$/.test(url.pathname)
      ) {
        await handleIdeaConsume({
          config,
          ideaId: url.pathname.split("/")[3],
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/closeout$/.test(url.pathname)
      ) {
        await handleIdeaCloseout({
          config,
          ideaId: url.pathname.split("/")[3],
          ideaService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/execution-summary$/.test(url.pathname)
      ) {
        await handleDeliveryExecutionSummary({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
          url,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-work-items\/[^/]+\/update$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemUpdate({
          config,
          deliveryService,
          request,
          response,
          workItemId: url.pathname.split("/")[3],
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/ideas\/[^/]+\/evaluation$/.test(url.pathname)
      ) {
        await handleIdeaEvaluation({
          config,
          ideaId: url.pathname.split("/")[3],
          ideaService,
          request,
          response,
        });
        return;
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
