import { randomUUID } from "node:crypto";

import { HttpError, OpenProjectError } from "./errors.js";
import {
  getDeliveryInitiativeGovernanceMissingConfig,
  getDeliveryPlanApplyMissingConfig,
  getAcceptedIdeaDeliveryCloseoutMissingConfig,
  getAcceptedIdeaDeliveryMissingConfig,
  getCallerAuthMode,
  getDeliveryExecutionMissingConfig,
  getDeliveryWorkItemBlockerMissingConfig,
  getDeliveryWorkItemParkingMissingConfig,
  getDeliveryWorkItemCreateMissingConfig,
  getDeliveryWorkItemDependencyMissingConfig,
  getDeliveryWorkItemMoveMissingConfig,
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

function openProjectErrorHttpStatus(error) {
  const operatorResolvableErrors = new Set([
    "duplicate_source_ref",
    "not_found",
    "update_conflict",
    "validation_failure",
  ]);

  if (
    operatorResolvableErrors.has(error.errorClass) &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode;
  }

  return 502;
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

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const DELIVERY_PLANNING_REPAIR_ACTIONS = new Set([
  "retarget",
  "decommit",
  "execution_posture_correction",
]);

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
  const ownerRepo =
    body.input.owner_repo === undefined
      ? null
      : (() => {
          assertNonEmptyString(body.input.owner_repo, "input.owner_repo");
          return body.input.owner_repo.trim();
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
    ownerRepo,
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

async function handleListDeliveryInitiatives({
  config,
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
      `Delivery initiative reads are not configured: ${missing.join(", ")}.`,
    );
  }

  const includeDone = parseBooleanQuery(
    url.searchParams.get("include_done"),
    "include_done",
  ) ?? true;
  const includeInactive = parseBooleanQuery(
    url.searchParams.get("include_inactive"),
    "include_inactive",
  ) ?? false;

  const record = await deliveryService.listDeliveryInitiatives({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    includeDone,
    includeInactive,
  });

  sendJson(response, 200, record);
}

async function handleDeliverySessionBootstrap({
  config,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery session bootstrap is not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliverySessionBootstrap({
    callerId: caller.id,
    callerAuthMode: caller.authMode,
    correlationId: createCorrelationId(request),
  });

  sendJson(response, 200, record);
}

async function handleDeliverySessionWorkflowHealth({
  config,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery workflow health is not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliverySessionWorkflowHealth({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
  });

  sendJson(response, 200, record);
}

async function handleDeliveryProjectQualityPack({
  config,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery project quality pack is not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliveryProjectQualityPack({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
  });

  sendJson(response, 200, record);
}

async function handleDeliveryPlanningSummary({
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
      `Delivery planning reads are not configured: ${missing.join(", ")}.`,
    );
  }

  const includeDone = parseBooleanQuery(
    url.searchParams.get("include_done"),
    "include_done",
  ) ?? false;
  const includeInactive = parseBooleanQuery(
    url.searchParams.get("include_inactive"),
    "include_inactive",
  ) ?? false;

  const record = await deliveryService.getDeliveryPlanningSummary({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    includeDone,
    includeInactive,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryPiObjectives({
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
      `Delivery PI objective reads are not configured: ${missing.join(", ")}.`,
    );
  }

  const targetPi = url.searchParams.get("target_pi");
  const normalizedTargetPi =
    targetPi === null || targetPi === ""
      ? null
      : (() => {
          assertNonEmptyString(targetPi, "target_pi");
          return targetPi.trim();
        })();

  const record = await deliveryService.getDeliveryPiObjectives({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    targetPi: normalizedTargetPi,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryCloseoutReadiness({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery closeout readiness is not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliveryCloseoutReadiness({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryInitiativeReviewPack({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery initiative review pack is not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliveryInitiativeReviewPack({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemContinuationContext({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery work-item continuation reads are not configured: ${missing.join(", ")}.`,
    );
  }

  const record = await deliveryService.getDeliveryWorkItemContinuationContext({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    workItemId,
  });

  if (!record) {
    throw new HttpError(404, "delivery_work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

async function handleRecordDeliverySystemDemo({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery system demo recording is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.demo_summary, "input.demo_summary");
  assertNonEmptyString(body.input.demo_evidence, "input.demo_evidence");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const record = await deliveryService.recordDeliverySystemDemo({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    demoDate:
      normalizeOptionalString(body.input.demo_date, "input.demo_date") ?? currentIsoDate(),
    demoEvidence: body.input.demo_evidence.trim(),
    demoFollowUp: normalizeOptionalString(
      body.input.demo_follow_up,
      "input.demo_follow_up",
    ),
    demoOutcome:
      normalizeOptionalString(body.input.demo_outcome, "input.demo_outcome") ??
      "reviewed",
    demoSummary: body.input.demo_summary.trim(),
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleRecordDeliveryInspectAndAdapt({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery inspect-and-adapt recording is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.inspect_summary, "input.inspect_summary");
  assertNonEmptyString(body.input.action_items, "input.action_items");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const record = await deliveryService.recordDeliveryInspectAndAdapt({
    actionItems: body.input.action_items.trim(),
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    inspectDate:
      normalizeOptionalString(body.input.inspect_date, "input.inspect_date") ??
      currentIsoDate(),
    inspectFollowUp: normalizeOptionalString(
      body.input.inspect_follow_up,
      "input.inspect_follow_up",
    ),
    inspectSummary: body.input.inspect_summary.trim(),
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleRecordDeliveryPiReview({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery PI review recording is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");

  if (!Array.isArray(body.input.reviews)) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.reviews must be an array.",
    );
  }

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const reviews = body.input.reviews.map((review, index) => {
    assertObject(review, `input.reviews[${index}]`);
    assertNonEmptyString(
      review.target_work_package_id,
      `input.reviews[${index}].target_work_package_id`,
    );
    assertNonEmptyString(
      review.review_outcome,
      `input.reviews[${index}].review_outcome`,
    );

    const actualBusinessValue = parsePositiveInteger(
      review.actual_business_value,
      `input.reviews[${index}].actual_business_value`,
      { min: 0 },
    );
    if (actualBusinessValue === null) {
      throw new HttpError(
        400,
        "validation_failed",
        `input.reviews[${index}].actual_business_value must be provided.`,
      );
    }

    return {
      actualBusinessValue,
      reviewNote: normalizeOptionalString(
        review.review_note,
        `input.reviews[${index}].review_note`,
      ),
      reviewOutcome: review.review_outcome.trim(),
      targetWorkPackageId: parsePositiveInteger(
        review.target_work_package_id,
        `input.reviews[${index}].target_work_package_id`,
      ),
    };
  });

  const targetPi = normalizeOptionalString(body.input.target_pi, "input.target_pi") ?? null;
  const record = await deliveryService.recordDeliveryPiReview({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    deliveryId,
    piReviewDate:
      normalizeOptionalString(body.input.pi_review_date, "input.pi_review_date") ??
      currentIsoDate(),
    reviews,
    targetPi,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

function parseInitiativeCloseRequestInput(body) {
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.demo_outcome, "input.demo_outcome");
  assertNonEmptyString(body.input.demo_summary, "input.demo_summary");
  assertNonEmptyString(body.input.demo_evidence, "input.demo_evidence");
  assertNonEmptyString(body.input.inspect_summary, "input.inspect_summary");
  assertNonEmptyString(body.input.inspect_action_items, "input.inspect_action_items");

  const completionInput = parseCompletionRequestInput(body);

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  return {
    actionItems: body.input.inspect_action_items.trim(),
    changedSurfaces: completionInput.changedSurfaces,
    completionNote: completionInput.completionNote,
    completionSummary: completionInput.completionSummary,
    demoDate:
      normalizeOptionalString(body.input.demo_date, "input.demo_date") ??
      currentIsoDate(),
    demoEvidence: body.input.demo_evidence.trim(),
    demoFollowUp: normalizeOptionalString(
      body.input.demo_follow_up,
      "input.demo_follow_up",
    ),
    demoOutcome: body.input.demo_outcome.trim(),
    demoSummary: body.input.demo_summary.trim(),
    inspectDate:
      normalizeOptionalString(body.input.inspect_date, "input.inspect_date") ??
      currentIsoDate(),
    inspectFollowUp: normalizeOptionalString(
      body.input.inspect_follow_up,
      "input.inspect_follow_up",
    ),
    inspectSummary: body.input.inspect_summary.trim(),
    residualFollowUp: completionInput.residualFollowUp,
    testResultEvidence: completionInput.testResultEvidence,
    validationEvidence: completionInput.validationEvidence,
  };
}

async function handleCloseDeliveryInitiative({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery initiative closeout is not configured: ${missing.join(", ")}.`,
    );
  }

  const closeInput = parseInitiativeCloseRequestInput(await readJsonBody(request));
  const record = await deliveryService.closeDeliveryInitiative({
    actionItems: closeInput.actionItems,
    callerId: caller.id,
    changedSurfaces: closeInput.changedSurfaces,
    completionNote: closeInput.completionNote,
    completionSummary: closeInput.completionSummary,
    correlationId: createCorrelationId(request),
    deliveryId,
    demoDate: closeInput.demoDate,
    demoEvidence: closeInput.demoEvidence,
    demoFollowUp: closeInput.demoFollowUp,
    demoOutcome: closeInput.demoOutcome,
    demoSummary: closeInput.demoSummary,
    inspectDate: closeInput.inspectDate,
    inspectFollowUp: closeInput.inspectFollowUp,
    inspectSummary: closeInput.inspectSummary,
    residualFollowUp: closeInput.residualFollowUp,
    testResultEvidence: closeInput.testResultEvidence,
    validationEvidence: closeInput.validationEvidence,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleCompleteDeliveryWorkItem({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery work-item completion is not configured: ${missing.join(", ")}.`,
    );
  }

  const completionInput = parseCompletionRequestInput(await readJsonBody(request));

  const record = await deliveryService.completeDeliveryWorkItem({
    callerId: caller.id,
    changedSurfaces: completionInput.changedSurfaces,
    completionNote: completionInput.completionNote,
    completionSummary: completionInput.completionSummary,
    correlationId: createCorrelationId(request),
    residualFollowUp: completionInput.residualFollowUp,
    testResultArtifact: completionInput.testResultArtifact,
    testResultEvidence: completionInput.testResultEvidence,
    validationEvidence: completionInput.validationEvidence,
    workItemId,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

function parseCompletionRequestInput(body) {
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.completion_summary, "input.completion_summary");
  assertNonEmptyString(body.input.changed_surfaces, "input.changed_surfaces");
  assertNonEmptyString(body.input.test_result_evidence, "input.test_result_evidence");
  assertNonEmptyString(body.input.validation_evidence, "input.validation_evidence");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  let testResultArtifact = null;
  if (body.input.test_result_artifact !== undefined) {
    assertObject(body.input.test_result_artifact, "input.test_result_artifact");
    assertNonEmptyString(
      body.input.test_result_artifact.file_name,
      "input.test_result_artifact.file_name",
    );
    assertNonEmptyString(
      body.input.test_result_artifact.content_base64,
      "input.test_result_artifact.content_base64",
    );
    testResultArtifact = {
      contentBase64: body.input.test_result_artifact.content_base64.trim(),
      contentType:
        normalizeOptionalString(
          body.input.test_result_artifact.content_type,
          "input.test_result_artifact.content_type",
        ) ?? "text/plain",
      description:
        normalizeOptionalString(
          body.input.test_result_artifact.description,
          "input.test_result_artifact.description",
        ) ?? null,
      fileName: body.input.test_result_artifact.file_name.trim(),
    };
  }

  return {
    changedSurfaces: body.input.changed_surfaces.trim(),
    completionNote: normalizeOptionalString(
      body.input.completion_note,
      "input.completion_note",
    ),
    completionSummary: body.input.completion_summary.trim(),
    residualFollowUp: normalizeOptionalString(
      body.input.residual_follow_up,
      "input.residual_follow_up",
    ),
    testResultArtifact,
    testResultEvidence: body.input.test_result_evidence.trim(),
    validationEvidence: body.input.validation_evidence.trim(),
  };
}

async function handleCloseStaleOpenDeliveryWorkItem({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryExecutionMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_execution_not_configured",
      `Delivery stale-open closeout is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  const completionInput = parseCompletionRequestInput(body);
  assertNonEmptyString(
    body.input.stale_open_justification,
    "input.stale_open_justification",
  );

  const record = await deliveryService.closeStaleOpenDeliveryWorkItem({
    callerId: caller.id,
    changedSurfaces: completionInput.changedSurfaces,
    completionNote: completionInput.completionNote,
    completionSummary: completionInput.completionSummary,
    correlationId: createCorrelationId(request),
    residualFollowUp: completionInput.residualFollowUp,
    staleOpenJustification: body.input.stale_open_justification.trim(),
    testResultArtifact: completionInput.testResultArtifact,
    testResultEvidence: completionInput.testResultEvidence,
    validationEvidence: completionInput.validationEvidence,
    workItemId,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryInitiativeGovernance({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryInitiativeGovernanceMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_initiative_governance_not_configured",
      `Delivery initiative governance is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const updates = {
    assignee_login: normalizeOptionalString(
      body.input.assignee_login,
      "input.assignee_login",
    ),
    architecture_anchor_ref: normalizeOptionalString(
      body.input.architecture_anchor_ref,
      "input.architecture_anchor_ref",
    ),
    business_objective: normalizeOptionalString(
      body.input.business_objective,
      "input.business_objective",
    ),
    description: normalizeOptionalString(body.input.description, "input.description"),
    inspect_and_adapt_actions: normalizeOptionalString(
      body.input.inspect_and_adapt_actions,
      "input.inspect_and_adapt_actions",
    ),
    initiative_family: normalizeOptionalString(
      body.input.initiative_family,
      "input.initiative_family",
    ),
    lineage_role: normalizeOptionalString(
      body.input.lineage_role,
      "input.lineage_role",
    ),
    nfr_category: normalizeOptionalString(body.input.nfr_category, "input.nfr_category"),
    owner_repo: normalizeOptionalString(body.input.owner_repo, "input.owner_repo"),
    pm2_phase: normalizeOptionalString(body.input.pm2_phase, "input.pm2_phase"),
    responsible_login: normalizeOptionalString(
      body.input.responsible_login,
      "input.responsible_login",
    ),
    required_upstream_ref: normalizeOptionalString(
      body.input.required_upstream_ref,
      "input.required_upstream_ref",
    ),
    sponsor: normalizeOptionalString(body.input.sponsor, "input.sponsor"),
    status: normalizeOptionalString(body.input.status, "input.status"),
    success_criteria: normalizeOptionalString(
      body.input.success_criteria,
      "input.success_criteria",
    ),
    system_demo_evidence: normalizeOptionalString(
      body.input.system_demo_evidence,
      "input.system_demo_evidence",
    ),
    target_pi: normalizeOptionalString(body.input.target_pi, "input.target_pi"),
  };

  if (Object.values(updates).every((value) => value === undefined)) {
    throw new HttpError(
      400,
      "validation_failed",
      "input must provide at least one initiative governance field.",
    );
  }

  const record = await deliveryService.updateDeliveryInitiative({
    architectureAnchorRef: updates.architecture_anchor_ref,
    assigneeLogin: updates.assignee_login,
    businessObjective: updates.business_objective,
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    description: updates.description,
    inspectAndAdaptActions: updates.inspect_and_adapt_actions,
    initiativeFamily: updates.initiative_family,
    lineageRole: updates.lineage_role,
    nfrCategory: updates.nfr_category,
    ownerRepo: updates.owner_repo,
    pm2Phase: updates.pm2_phase,
    recordId: deliveryId,
    responsibleLogin: updates.responsible_login,
    requiredUpstreamRef: updates.required_upstream_ref,
    sponsor: updates.sponsor,
    status: updates.status,
    successCriteria: updates.success_criteria,
    systemDemoEvidence: updates.system_demo_evidence,
    targetPi: updates.target_pi,
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryPlanApply({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryPlanApplyMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_plan_apply_not_configured",
      `Delivery plan application is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertObject(body.input.plan, "input.plan");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const record = await deliveryService.applyDeliveryPlan({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    plan: body.input.plan,
    recordId: deliveryId,
    reconcileDecision: normalizeOptionalString(
      body.input.reconcile_decision,
      "input.reconcile_decision",
    ),
    reconcileMissing: normalizeOptionalString(
      body.input.reconcile_missing,
      "input.reconcile_missing",
    ),
    reconcileReason: normalizeOptionalString(
      body.input.reconcile_reason,
      "input.reconcile_reason",
    ),
    reconcileRetirementReason: normalizeOptionalString(
      body.input.reconcile_retirement_reason,
      "input.reconcile_retirement_reason",
    ),
    reconcileReviewDate: normalizeOptionalString(
      body.input.reconcile_review_date,
      "input.reconcile_review_date",
    ),
  });

  if (!record) {
    throw new HttpError(404, "delivery_not_found", "Delivery initiative not found.");
  }

  sendJson(response, 200, record);
}

function parseDeliveryPlanningRepairInput(input) {
  assertObject(input, "input");

  if (input.schema_version !== 1) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.schema_version must equal 1.",
    );
  }

  if (!Array.isArray(input.repairs) || input.repairs.length === 0) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.repairs must be a non-empty array.",
    );
  }

  return input.repairs.map((repair, index) => {
    assertObject(repair, `input.repairs[${index}]`);
    assertNonEmptyString(
      repair.action,
      `input.repairs[${index}].action`,
    );
    assertNonEmptyString(
      repair.target_work_item_id,
      `input.repairs[${index}].target_work_item_id`,
    );
    assertNonEmptyString(
      repair.reason,
      `input.repairs[${index}].reason`,
    );

    const action = repair.action.trim();
    if (!DELIVERY_PLANNING_REPAIR_ACTIONS.has(action)) {
      throw new HttpError(
        400,
        "validation_failed",
        `input.repairs[${index}].action must be one of ${Array.from(DELIVERY_PLANNING_REPAIR_ACTIONS).join(", ")}.`,
      );
    }

    const parsedUpdate = parseDeliveryWorkItemUpdateInput(repair);
    return {
      action,
      reason: repair.reason.trim(),
      targetWorkItemId: repair.target_work_item_id.trim(),
      ...parsedUpdate,
    };
  });
}

async function handleDeliveryPlanRepair({
  config,
  deliveryId,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryPlanApplyMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_plan_repair_not_configured",
      `Delivery planning repair is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");

  const record = await deliveryService.repairDeliveryPlan({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    recordId: deliveryId,
    repairs: parseDeliveryPlanningRepairInput(body.input),
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

  const input = parseDeliveryWorkItemUpdateInput(body.input);

  const record = await deliveryService.updateDeliveryWorkItem({
    ...input,
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    workItemId,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

function parseDeliveryWorkItemUpdateInput(input) {
  assertObject(input, "input");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const status = normalizeOptionalString(input.status, "input.status");
  const targetPi = normalizeOptionalString(input.target_pi, "input.target_pi");
  const clearTargetPi =
    parseOptionalBooleanInput(
      input.clear_target_pi,
      "input.clear_target_pi",
    ) ?? false;
  const assigneeLogin = normalizeOptionalString(
    input.assignee_login,
    "input.assignee_login",
  );
  const clearAssignee =
    parseOptionalBooleanInput(
      input.clear_assignee,
      "input.clear_assignee",
    ) ?? false;
  const responsibleLogin = normalizeOptionalString(
    input.responsible_login,
    "input.responsible_login",
  );
  const clearResponsible =
    parseOptionalBooleanInput(
      input.clear_responsible,
      "input.clear_responsible",
    ) ?? false;
  const description = normalizeOptionalString(
    input.description,
    "input.description",
  );
  const clearDescription =
    parseOptionalBooleanInput(
      input.clear_description,
      "input.clear_description",
    ) ?? false;
  const workNote = normalizeOptionalString(input.work_note, "input.work_note");
  const startDate = normalizeOptionalString(input.start_date, "input.start_date");
  const clearStartDate =
    parseOptionalBooleanInput(
      input.clear_start_date,
      "input.clear_start_date",
    ) ?? false;
  const dueDate = normalizeOptionalString(input.due_date, "input.due_date");
  const clearDueDate =
    parseOptionalBooleanInput(
      input.clear_due_date,
      "input.clear_due_date",
    ) ?? false;
  const estimatedWork = normalizeOptionalString(
    input.estimated_work,
    "input.estimated_work",
  );
  const clearEstimatedWork =
    parseOptionalBooleanInput(
      input.clear_estimated_work,
      "input.clear_estimated_work",
    ) ?? false;
  const remainingWork = normalizeOptionalString(
    input.remaining_work,
    "input.remaining_work",
  );
  const clearRemainingWork =
    parseOptionalBooleanInput(
      input.clear_remaining_work,
      "input.clear_remaining_work",
    ) ?? false;
  const percentComplete =
    input.percent_complete === undefined
      ? undefined
      : parsePositiveInteger(input.percent_complete, "input.percent_complete", {
          min: 0,
          max: 100,
        });
  const ownerRepo = normalizeOptionalString(input.owner_repo, "input.owner_repo");
  const deliveryTeam = normalizeOptionalString(
    input.delivery_team,
    "input.delivery_team",
  );
  const iteration = normalizeOptionalString(input.iteration, "input.iteration");
  const executionClassification = normalizeOptionalString(
    input.execution_classification,
    "input.execution_classification",
  );
  const acceptanceCriteria = normalizeOptionalString(
    input.acceptance_criteria,
    "input.acceptance_criteria",
  );
  const definitionOfReady = normalizeOptionalString(
    input.definition_of_ready,
    "input.definition_of_ready",
  );
  const definitionOfDone = normalizeOptionalString(
    input.definition_of_done,
    "input.definition_of_done",
  );
  const nfrCategory = normalizeOptionalString(
    input.nfr_category,
    "input.nfr_category",
  );
  const piObjectiveType = normalizeOptionalString(
    input.pi_objective_type,
    "input.pi_objective_type",
  );
  const piObjectiveReviewOutcome = normalizeOptionalString(
    input.pi_objective_review_outcome,
    "input.pi_objective_review_outcome",
  );
  const plannedBusinessValue =
    input.planned_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          input.planned_business_value,
          "input.planned_business_value",
          { min: 0 },
        );
  const actualBusinessValue =
    input.actual_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          input.actual_business_value,
          "input.actual_business_value",
          { min: 0 },
        );
  const roamState = normalizeOptionalString(input.roam_state, "input.roam_state");
  const riskOwner = normalizeOptionalString(input.risk_owner, "input.risk_owner");
  const riskReviewDate = normalizeOptionalString(
    input.risk_review_date,
    "input.risk_review_date",
  );
  const riskDisposition = normalizeOptionalString(
    input.risk_disposition,
    "input.risk_disposition",
  );
  const wsjfUserBusinessValue =
    input.wsjf_user_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          input.wsjf_user_business_value,
          "input.wsjf_user_business_value",
          { min: 0 },
        );
  const wsjfTimeCriticality =
    input.wsjf_time_criticality === undefined
      ? undefined
      : parsePositiveInteger(
          input.wsjf_time_criticality,
          "input.wsjf_time_criticality",
          { min: 0 },
        );
  const wsjfRiskReductionOpportunityEnablement =
    input.wsjf_rr_oe === undefined
      ? undefined
      : parsePositiveInteger(input.wsjf_rr_oe, "input.wsjf_rr_oe", {
          min: 0,
        });
  const wsjfJobSize =
    input.wsjf_job_size === undefined
      ? undefined
      : parsePositiveInteger(input.wsjf_job_size, "input.wsjf_job_size", {
          min: 1,
        });

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

  if (responsibleLogin !== undefined && clearResponsible) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.responsible_login and input.clear_responsible=true cannot be used together.",
    );
  }

  if (description !== undefined && clearDescription) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.description and input.clear_description=true cannot be used together.",
    );
  }

  if (startDate !== undefined && clearStartDate) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.start_date and input.clear_start_date=true cannot be used together.",
    );
  }

  if (dueDate !== undefined && clearDueDate) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.due_date and input.clear_due_date=true cannot be used together.",
    );
  }

  if (estimatedWork !== undefined && clearEstimatedWork) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.estimated_work and input.clear_estimated_work=true cannot be used together.",
    );
  }

  if (remainingWork !== undefined && clearRemainingWork) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.remaining_work and input.clear_remaining_work=true cannot be used together.",
    );
  }

  if (
    status === undefined &&
    targetPi === undefined &&
    !clearTargetPi &&
    assigneeLogin === undefined &&
    !clearAssignee &&
    responsibleLogin === undefined &&
    !clearResponsible &&
    description === undefined &&
    !clearDescription &&
    workNote === undefined &&
    startDate === undefined &&
    !clearStartDate &&
    dueDate === undefined &&
    !clearDueDate &&
    estimatedWork === undefined &&
    !clearEstimatedWork &&
    remainingWork === undefined &&
    !clearRemainingWork &&
    percentComplete === undefined &&
    input.subject === undefined &&
    executionClassification === undefined &&
    ownerRepo === undefined &&
    deliveryTeam === undefined &&
    iteration === undefined &&
    acceptanceCriteria === undefined &&
    definitionOfReady === undefined &&
    definitionOfDone === undefined &&
    nfrCategory === undefined &&
    piObjectiveType === undefined &&
    piObjectiveReviewOutcome === undefined &&
    plannedBusinessValue === undefined &&
    actualBusinessValue === undefined &&
    roamState === undefined &&
    riskOwner === undefined &&
    riskReviewDate === undefined &&
    riskDisposition === undefined &&
    wsjfUserBusinessValue === undefined &&
    wsjfTimeCriticality === undefined &&
    wsjfRiskReductionOpportunityEnablement === undefined &&
    wsjfJobSize === undefined
  ) {
    throw new HttpError(
      400,
      "validation_failed",
      "input must provide at least one delivery work-item update field.",
    );
  }

  return {
    acceptanceCriteria,
    actualBusinessValue,
    assigneeLogin,
    clearAssignee,
    clearDescription,
    clearDueDate,
    clearEstimatedWork,
    clearRemainingWork,
    clearResponsible,
    clearStartDate,
    clearTargetPi,
    definitionOfDone,
    definitionOfReady,
    deliveryTeam,
    description,
    dueDate,
    estimatedWork,
    executionClassification,
    iteration,
    nfrCategory,
    ownerRepo,
    percentComplete,
    piObjectiveType,
    piObjectiveReviewOutcome,
    plannedBusinessValue,
    remainingWork,
    responsibleLogin,
    riskDisposition,
    riskOwner,
    riskReviewDate,
    roamState,
    startDate,
    status,
    subject: normalizeOptionalString(input.subject, "input.subject"),
    targetPi,
    workNote,
    wsjfJobSize,
    wsjfRiskReductionOpportunityEnablement,
    wsjfTimeCriticality,
    wsjfUserBusinessValue,
  };
}

async function handleDeliveryWorkItemBulkUpdate({
  config,
  deliveryService,
  request,
  response,
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

  if (body.input.schema_version !== 1) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.schema_version must equal 1.",
    );
  }

  if (!Array.isArray(body.input.updates)) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.updates must be an array.",
    );
  }

  const correlationId = createCorrelationId(request);
  const results = [];

  for (let index = 0; index < body.input.updates.length; index += 1) {
    const update = body.input.updates[index];
    assertObject(update, `input.updates[${index}]`);
    assertNonEmptyString(
      update.target_work_package_id,
      `input.updates[${index}].target_work_package_id`,
    );

    const parsedInput = parseDeliveryWorkItemUpdateInput(update);
    const record = await deliveryService.updateDeliveryWorkItem({
      ...parsedInput,
      callerId: caller.id,
      correlationId: `${correlationId}-${index}`,
      workItemId: update.target_work_package_id.trim(),
    });

    if (!record) {
      throw new HttpError(
        404,
        "work_item_not_found",
        `Delivery work item ${update.target_work_package_id.trim()} not found.`,
      );
    }

    results.push(record);
  }

  sendJson(response, 200, {
    schema_version: 1,
    updated_count: results.length,
    workflow_id: "delivery-work-item-bulk-update",
    results,
  });
}

async function handleDeliveryWorkItemCreate({
  config,
  deliveryService,
  request,
  response,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemCreateMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_create_not_configured",
      `Delivery work-item create is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.parent_work_item_id, "input.parent_work_item_id");
  assertNonEmptyString(body.input.type, "input.type");
  assertNonEmptyString(body.input.subject, "input.subject");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const status = normalizeOptionalString(body.input.status, "input.status");
  const targetPi = normalizeOptionalString(body.input.target_pi, "input.target_pi");
  const assigneeLogin = normalizeOptionalString(
    body.input.assignee_login,
    "input.assignee_login",
  );
  const responsibleLogin = normalizeOptionalString(
    body.input.responsible_login,
    "input.responsible_login",
  );
  const description = normalizeOptionalString(
    body.input.description,
    "input.description",
  );
  const startDate = normalizeOptionalString(body.input.start_date, "input.start_date");
  const dueDate = normalizeOptionalString(body.input.due_date, "input.due_date");
  const ownerRepo = normalizeOptionalString(body.input.owner_repo, "input.owner_repo");
  const deliveryTeam = normalizeOptionalString(
    body.input.delivery_team,
    "input.delivery_team",
  );
  const iteration = normalizeOptionalString(body.input.iteration, "input.iteration");
  const executionClassification = normalizeOptionalString(
    body.input.execution_classification,
    "input.execution_classification",
  );
  const acceptanceCriteria = normalizeOptionalString(
    body.input.acceptance_criteria,
    "input.acceptance_criteria",
  );
  const definitionOfReady = normalizeOptionalString(
    body.input.definition_of_ready,
    "input.definition_of_ready",
  );
  const definitionOfDone = normalizeOptionalString(
    body.input.definition_of_done,
    "input.definition_of_done",
  );
  const nfrCategory = normalizeOptionalString(
    body.input.nfr_category,
    "input.nfr_category",
  );
  const piObjectiveType = normalizeOptionalString(
    body.input.pi_objective_type,
    "input.pi_objective_type",
  );
  const piObjectiveReviewOutcome = normalizeOptionalString(
    body.input.pi_objective_review_outcome,
    "input.pi_objective_review_outcome",
  );
  const plannedBusinessValue =
    body.input.planned_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          body.input.planned_business_value,
          "input.planned_business_value",
          { min: 0 },
        );
  const actualBusinessValue =
    body.input.actual_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          body.input.actual_business_value,
          "input.actual_business_value",
          { min: 0 },
        );
  const roamState = normalizeOptionalString(body.input.roam_state, "input.roam_state");
  const riskOwner = normalizeOptionalString(body.input.risk_owner, "input.risk_owner");
  const riskReviewDate = normalizeOptionalString(
    body.input.risk_review_date,
    "input.risk_review_date",
  );
  const riskDisposition = normalizeOptionalString(
    body.input.risk_disposition,
    "input.risk_disposition",
  );
  const wsjfUserBusinessValue =
    body.input.wsjf_user_business_value === undefined
      ? undefined
      : parsePositiveInteger(
          body.input.wsjf_user_business_value,
          "input.wsjf_user_business_value",
          { min: 0 },
        );
  const wsjfTimeCriticality =
    body.input.wsjf_time_criticality === undefined
      ? undefined
      : parsePositiveInteger(
          body.input.wsjf_time_criticality,
          "input.wsjf_time_criticality",
          { min: 0 },
        );
  const wsjfRiskReductionOpportunityEnablement =
    body.input.wsjf_rr_oe === undefined
      ? undefined
      : parsePositiveInteger(body.input.wsjf_rr_oe, "input.wsjf_rr_oe", {
          min: 0,
        });
  const wsjfJobSize =
    body.input.wsjf_job_size === undefined
      ? undefined
      : parsePositiveInteger(body.input.wsjf_job_size, "input.wsjf_job_size", {
          min: 1,
        });

  const estimatedWork =
    body.input.estimated_work === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.estimated_work, "input.estimated_work");
          return body.input.estimated_work.trim();
        })();
  const remainingWork =
    body.input.remaining_work === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.remaining_work, "input.remaining_work");
          return body.input.remaining_work.trim();
        })();
  const percentComplete =
    body.input.percent_complete === undefined
      ? undefined
      : parsePositiveInteger(body.input.percent_complete, "input.percent_complete", {
          min: 0,
          max: 100,
        });

  const record = await deliveryService.createDeliveryWorkItem({
    acceptanceCriteria,
    actualBusinessValue,
    assigneeLogin,
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    definitionOfDone,
    definitionOfReady,
    deliveryTeam,
    description,
    dueDate,
    estimatedWork,
    executionClassification,
    iteration,
    nfrCategory,
    ownerRepo,
    parentWorkItemId: body.input.parent_work_item_id.trim(),
    percentComplete,
    piObjectiveType,
    piObjectiveReviewOutcome,
    plannedBusinessValue,
    remainingWork,
    responsibleLogin,
    riskDisposition,
    riskOwner,
    riskReviewDate,
    roamState,
    startDate,
    status,
    subject: body.input.subject.trim(),
    targetPi,
    type: body.input.type.trim(),
    wsjfJobSize,
    wsjfRiskReductionOpportunityEnablement,
    wsjfTimeCriticality,
    wsjfUserBusinessValue,
  });

  if (!record) {
    throw new HttpError(
      404,
      "parent_work_item_not_found",
      "Parent delivery work item not found.",
    );
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemMove({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemMoveMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_move_not_configured",
      `Delivery work-item move is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.new_parent_work_item_id, "input.new_parent_work_item_id");

  const workNote =
    body.input.work_note === undefined
      ? undefined
      : (() => {
          assertNonEmptyString(body.input.work_note, "input.work_note");
          return body.input.work_note.trim();
        })();

  const record = await deliveryService.moveDeliveryWorkItem({
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    newParentWorkItemId: body.input.new_parent_work_item_id.trim(),
    workItemId,
    workNote,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemBlocker({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemBlockerMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_blocker_not_configured",
      `Delivery work-item blocker management is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.action, "input.action");

  const action = body.input.action.trim();
  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const record = await deliveryService.manageDeliveryBlocker({
    action,
    blockerDecisionPath: normalizeOptionalString(
      body.input.blocker_decision_path,
      "input.blocker_decision_path",
    ),
    blockerDiscoveredOn: normalizeOptionalString(
      body.input.blocker_discovered_on,
      "input.blocker_discovered_on",
    ),
    blockerFollowUpOwner: normalizeOptionalString(
      body.input.blocker_follow_up_owner,
      "input.blocker_follow_up_owner",
    ),
    blockerImpact: normalizeOptionalString(
      body.input.blocker_impact,
      "input.blocker_impact",
    ),
    blockerJustification: normalizeOptionalString(
      body.input.blocker_justification,
      "input.blocker_justification",
    ),
    blockerOwner: normalizeOptionalString(
      body.input.blocker_owner,
      "input.blocker_owner",
    ),
    blockerReviewDate: normalizeOptionalString(
      body.input.blocker_review_date,
      "input.blocker_review_date",
    ),
    blockerStatement: normalizeOptionalString(
      body.input.blocker_statement,
      "input.blocker_statement",
    ),
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    resumeStatus: normalizeOptionalString(
      body.input.resume_status,
      "input.resume_status",
    ),
    workItemId,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemDependency({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemDependencyMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_dependency_not_configured",
      `Delivery work-item dependency management is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.action, "input.action");
  assertNonEmptyString(body.input.depends_on_work_item_id, "input.depends_on_work_item_id");

  const action = body.input.action.trim();
  const lag =
    body.input.lag === undefined
      ? undefined
      : parsePositiveInteger(body.input.lag, "input.lag", {
          min: Number.MIN_SAFE_INTEGER,
          max: Number.MAX_SAFE_INTEGER,
        });
  const clearLag =
    parseOptionalBooleanInput(body.input.clear_lag, "input.clear_lag") ?? false;
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

  if (lag !== undefined && clearLag) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.lag and input.clear_lag=true cannot be used together.",
    );
  }

  if (description !== undefined && clearDescription) {
    throw new HttpError(
      400,
      "validation_failed",
      "input.description and input.clear_description=true cannot be used together.",
    );
  }

  const record = await deliveryService.manageDeliveryDependency({
    action,
    callerId: caller.id,
    clearDescription,
    clearLag,
    correlationId: createCorrelationId(request),
    dependsOnWorkItemId: body.input.depends_on_work_item_id.trim(),
    description,
    lag,
    targetWorkItemId: workItemId,
  });

  if (!record) {
    throw new HttpError(404, "work_item_not_found", "Delivery work item not found.");
  }

  sendJson(response, 200, record);
}

async function handleDeliveryWorkItemParking({
  config,
  deliveryService,
  request,
  response,
  workItemId,
}) {
  const caller = authenticateCaller(request, config);
  const missing = getDeliveryWorkItemParkingMissingConfig(config);
  if (missing.length > 0) {
    throw new HttpError(
      503,
      "delivery_work_item_parking_not_configured",
      `Delivery work-item parking is not configured: ${missing.join(", ")}.`,
    );
  }

  const body = await readJsonBody(request);
  assertObject(body.input, "input");
  assertNonEmptyString(body.input.action, "input.action");

  const normalizeOptionalString = (value, fieldName) => {
    if (value === undefined) {
      return undefined;
    }

    assertNonEmptyString(value, fieldName);
    return value.trim();
  };

  const record = await deliveryService.manageDeliveryParking({
    action: body.input.action.trim(),
    callerId: caller.id,
    correlationId: createCorrelationId(request),
    parkDecision: normalizeOptionalString(
      body.input.park_decision,
      "input.park_decision",
    ),
    parkReason: normalizeOptionalString(
      body.input.park_reason,
      "input.park_reason",
    ),
    parkReviewDate: normalizeOptionalString(
      body.input.park_review_date,
      "input.park_review_date",
    ),
    resumeStatus: normalizeOptionalString(
      body.input.resume_status,
      "input.resume_status",
    ),
    retirementReason: normalizeOptionalString(
      body.input.retirement_reason,
      "input.retirement_reason",
    ),
    workItemId,
    workNote: normalizeOptionalString(
      body.input.work_note,
      "input.work_note",
    ),
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
        url.pathname === "/v1/delivery-initiatives"
      ) {
        await handleListDeliveryInitiatives({
          config,
          deliveryService,
          request,
          response,
          url,
        });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/delivery-session/bootstrap"
      ) {
        await handleDeliverySessionBootstrap({
          config,
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/delivery-session/workflow-health"
      ) {
        await handleDeliverySessionWorkflowHealth({
          config,
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/delivery-session/quality-pack"
      ) {
        await handleDeliveryProjectQualityPack({
          config,
          deliveryService,
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
        request.method === "GET" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/planning$/.test(url.pathname)
      ) {
        await handleDeliveryPlanningSummary({
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
        request.method === "GET" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/pi-objectives$/.test(url.pathname)
      ) {
        await handleDeliveryPiObjectives({
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
        request.method === "GET" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/closeout-readiness$/.test(url.pathname)
      ) {
        await handleDeliveryCloseoutReadiness({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/review-pack$/.test(url.pathname)
      ) {
        await handleDeliveryInitiativeReviewPack({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/governance$/.test(url.pathname)
      ) {
        await handleDeliveryInitiativeGovernance({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/system-demo$/.test(url.pathname)
      ) {
        await handleRecordDeliverySystemDemo({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/inspect-and-adapt$/.test(url.pathname)
      ) {
        await handleRecordDeliveryInspectAndAdapt({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/pi-review$/.test(url.pathname)
      ) {
        await handleRecordDeliveryPiReview({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/close$/.test(url.pathname)
      ) {
        await handleCloseDeliveryInitiative({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/plan\/apply$/.test(url.pathname)
      ) {
        await handleDeliveryPlanApply({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-initiatives\/[^/]+\/plan\/repair$/.test(url.pathname)
      ) {
        await handleDeliveryPlanRepair({
          config,
          deliveryId: url.pathname.split("/")[3],
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/delivery-work-items\/[^/]+\/continuation-context$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemContinuationContext({
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
        /^\/v1\/delivery-work-items\/[^/]+\/complete$/.test(url.pathname)
      ) {
        await handleCompleteDeliveryWorkItem({
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
        /^\/v1\/delivery-work-items\/[^/]+\/stale-open-close$/.test(url.pathname)
      ) {
        await handleCloseStaleOpenDeliveryWorkItem({
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
        url.pathname === "/v1/delivery-work-items"
      ) {
        await handleDeliveryWorkItemCreate({
          config,
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/delivery-work-items/bulk-update"
      ) {
        await handleDeliveryWorkItemBulkUpdate({
          config,
          deliveryService,
          request,
          response,
        });
        return;
      }

      if (
        request.method === "POST" &&
        /^\/v1\/delivery-work-items\/[^/]+\/blocker$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemBlocker({
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
        /^\/v1\/delivery-work-items\/[^/]+\/dependency$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemDependency({
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
        /^\/v1\/delivery-work-items\/[^/]+\/parking$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemParking({
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
        /^\/v1\/delivery-work-items\/[^/]+\/move$/.test(url.pathname)
      ) {
        await handleDeliveryWorkItemMove({
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
        sendJson(response, openProjectErrorHttpStatus(error), {
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
