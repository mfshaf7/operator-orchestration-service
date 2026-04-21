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

function buildIdeaListQuery(config, { limit, offset }) {
  const filters = JSON.stringify([
    {
      type: {
        operator: "=",
        values: [String(config.ideaTypeId)],
      },
    },
  ]);

  return new URLSearchParams({
    filters,
    offset: String(offset),
    pageSize: String(limit),
    sortBy: JSON.stringify([["id", "desc"]]),
  });
}

const PENDING_TRIAGE_SENTINEL = "_Pending triage._";
const PENDING_OPERATOR_DECISION_SENTINEL = "_Pending operator decision._";
const PENDING_INTERNAL_EVALUATION_SENTINEL = "_No internal evaluation recorded._";
const NO_BODY_SENTINEL = "_No body supplied._";
const DELIVERY_PM2_PHASE_DEFAULT = "Initiating";

function buildIdeaDescription({
  body,
  closeoutNotes,
  evaluationNotes,
  operator,
  source,
  triageSummary,
  operatorDecisionNotes,
}) {
  const renderedBody = body?.trim() ? body.trim() : "_No body supplied._";
  const operatorHandle = operator.handle ? `@${operator.handle}` : "_none_";
  const renderedTriageSummary = triageSummary?.trim()
    ? triageSummary.trim()
    : PENDING_TRIAGE_SENTINEL;
  const renderedOperatorDecisionNotes = operatorDecisionNotes?.trim()
    ? operatorDecisionNotes.trim()
    : PENDING_OPERATOR_DECISION_SENTINEL;
  const renderedEvaluationNotes = evaluationNotes?.trim()
    ? evaluationNotes.trim()
    : PENDING_INTERNAL_EVALUATION_SENTINEL;
  const renderedCloseoutNotes =
    typeof closeoutNotes === "string" && closeoutNotes.trim()
      ? closeoutNotes.trim()
      : null;

  const sections = [
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
    renderedTriageSummary,
    "",
    "## Operator decision notes",
    "",
    renderedOperatorDecisionNotes,
  ];

  if (renderedCloseoutNotes) {
    sections.push(
      "",
      "## Delivery closeout",
      "",
      renderedCloseoutNotes,
    );
  }

  sections.push(
    "",
    "## Internal evaluation",
    "",
    renderedEvaluationNotes,
  );

  return sections.join("\n");
}

function buildAcceptedIdeaDeliveryDescription({ currentRecord }) {
  const operatorHandle = currentRecord.operator?.handle
    ? `@${currentRecord.operator.handle}`
    : "_none_";
  const renderedBody = currentRecord.body?.trim()
    ? currentRecord.body.trim()
    : NO_BODY_SENTINEL;
  const renderedTriageSummary = currentRecord.triageSummary?.trim()
    ? currentRecord.triageSummary.trim()
    : PENDING_TRIAGE_SENTINEL;
  const renderedOperatorDecisionNotes = currentRecord.operatorDecisionNotes?.trim()
    ? currentRecord.operatorDecisionNotes.trim()
    : PENDING_OPERATOR_DECISION_SENTINEL;

  const evaluationLines = [];
  if (currentRecord.evaluation?.suspectedOwner) {
    evaluationLines.push(
      `- suspected owner: ${currentRecord.evaluation.suspectedOwner}`,
    );
  }
  if (currentRecord.evaluation?.affectedScope?.length) {
    evaluationLines.push(
      `- affected scope: ${currentRecord.evaluation.affectedScope.join(", ")}`,
    );
  }
  if (currentRecord.evaluation?.trustBoundaryAreas?.length) {
    evaluationLines.push(
      `- trust boundary areas: ${currentRecord.evaluation.trustBoundaryAreas.join(", ")}`,
    );
  }
  if (currentRecord.evaluation?.confidence) {
    evaluationLines.push(`- confidence: ${currentRecord.evaluation.confidence}`);
  }
  if (currentRecord.evaluation?.aiAssistLane) {
    evaluationLines.push(`- AI assist lane: ${currentRecord.evaluation.aiAssistLane}`);
  }
  if (currentRecord.evaluation?.notes?.trim()) {
    evaluationLines.push("- notes:");
    evaluationLines.push(currentRecord.evaluation.notes.trim());
  }

  const renderedEvaluation = evaluationLines.length > 0
    ? evaluationLines.join("\n")
    : PENDING_INTERNAL_EVALUATION_SENTINEL;

  return [
    "## Accepted proposal",
    "",
    renderedBody,
    "",
    "## Proposal reference",
    "",
    `- origin idea ref: ${currentRecord.ideaId}`,
    `- proposal record ref: \`${currentRecord.recordRef}\``,
    `- source surface: ${currentRecord.source.surface}`,
    `- source ref: \`${serializeSourceIdentity(currentRecord.source)}\``,
    `- operator id: ${currentRecord.operator?.id ?? "_unknown_"}`,
    `- operator handle: ${operatorHandle}`,
    "",
    "## Triage summary",
    "",
    renderedTriageSummary,
    "",
    "## Operator decision notes",
    "",
    renderedOperatorDecisionNotes,
    "",
    "## Internal evaluation",
    "",
    renderedEvaluation,
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
      raw: buildIdeaDescription({
        body: capture.body,
        closeoutNotes: null,
        evaluationNotes: null,
        operator: capture.operator,
        operatorDecisionNotes: null,
        source,
        triageSummary: null,
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

  if (value === NO_BODY_SENTINEL) {
    return "";
  }

  return value;
}

function normalizeStringValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeStringList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return values.join(", ");
}

function readCustomField(payload, fieldId) {
  if (!fieldId) {
    return null;
  }

  const key = `customField${fieldId}`;
  if (payload?.[key] !== undefined) {
    return payload[key];
  }

  const linkedValue = payload?._links?.[key];
  if (Array.isArray(linkedValue)) {
    return linkedValue
      .map((entry) =>
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : null,
      )
      .filter(Boolean);
  }

  if (
    linkedValue &&
    typeof linkedValue === "object" &&
    typeof linkedValue.title === "string" &&
    linkedValue.title.trim()
  ) {
    return linkedValue.title.trim();
  }

  return null;
}

function buildCustomOptionHrefMap(formPayload, fieldId) {
  if (!fieldId) {
    return new Map();
  }

  const allowedValues =
    formPayload?._embedded?.schema?.[`customField${fieldId}`]?._links
      ?.allowedValues;

  if (!Array.isArray(allowedValues)) {
    return new Map();
  }

  return new Map(
    allowedValues
      .filter(
        (entry) =>
          entry &&
          typeof entry.href === "string" &&
          typeof entry.title === "string" &&
          entry.title.trim(),
      )
      .map((entry) => [entry.title.trim(), entry.href]),
  );
}

function resolveCustomOptionLink({ formPayload, fieldId, value, multiValue = false }) {
  const normalizedValue = multiValue ? normalizeStringList(value) : normalizeStringValue(value);

  if (multiValue) {
    if (normalizedValue.length === 0) {
      return [];
    }
  } else if (!normalizedValue) {
    return {
      href: null,
      title: null,
    };
  }

  const hrefMap = buildCustomOptionHrefMap(formPayload, fieldId);
  const values = multiValue ? normalizedValue : [normalizedValue];
  const links = values.map((entry) => {
    const href = hrefMap.get(entry);
    if (!href) {
      throw new OpenProjectError(
        "backend_contract_drift",
        `OpenProject form schema does not expose custom option ${entry} for customField${fieldId}.`,
        502,
        "missing_custom_option_link",
      );
    }

    return {
      href,
      title: entry,
    };
  });

  return multiValue ? links : links[0];
}

function getDecisionStatusId(config, status) {
  switch (status) {
    case "parked":
      return config.parkedStatusId;
    case "accepted":
      return config.acceptedStatusId;
    case "rejected":
      return config.rejectedStatusId;
    default:
      return null;
  }
}

function parseWorkPackageIdFromRecordRef(recordRef, fieldName) {
  if (typeof recordRef !== "string" || !recordRef.trim()) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} is required.`,
      422,
      "missing_record_ref",
    );
  }

  const match = recordRef.trim().match(/^openproject:\/\/work_packages\/(\d+)$/);
  if (!match) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be an OpenProject work package ref.`,
      422,
      "invalid_record_ref",
    );
  }

  return Number.parseInt(match[1], 10);
}

function parseWorkPackageIdFromHref(href) {
  if (typeof href !== "string" || !href.trim()) {
    return null;
  }

  const match = href.trim().match(/\/api\/v3\/work_packages\/(\d+)$/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function workPackageTypeName(payload) {
  return payload?._links?.type?.title ?? payload?.type ?? null;
}

function workPackageStatusName(payload) {
  return payload?._links?.status?.title ?? payload?.status ?? "new";
}

function workPackageAssigneeLogin(payload) {
  return normalizeStringValue(
    payload?._links?.assignee?.title ??
      payload?._links?.assignedTo?.title ??
      payload?.assignee ??
      null,
  );
}

function buildAllowedValueLinkMap(formPayload, fieldNames) {
  for (const fieldName of fieldNames) {
    const allowedValues =
      formPayload?._embedded?.schema?.[fieldName]?._links?.allowedValues;
    if (!Array.isArray(allowedValues)) {
      continue;
    }

    return new Map(
      allowedValues
        .filter(
          (entry) =>
            entry &&
            typeof entry.href === "string" &&
            typeof entry.title === "string" &&
            entry.title.trim(),
        )
        .map((entry) => [
          entry.title.trim().toLowerCase(),
          {
            href: entry.href,
            title: entry.title.trim(),
          },
        ]),
    );
  }

  return new Map();
}

function resolveAllowedValueLink({
  fieldNames,
  formPayload,
  value,
  fieldLabel,
}) {
  const normalizedValue = normalizeStringValue(value);
  if (!normalizedValue) {
    return {
      href: null,
      title: null,
    };
  }

  const hrefMap = buildAllowedValueLinkMap(formPayload, fieldNames);
  const resolved = hrefMap.get(normalizedValue.toLowerCase());
  if (!resolved) {
    throw new OpenProjectError(
      "backend_contract_drift",
      `OpenProject form schema does not expose ${fieldLabel} option ${normalizedValue}.`,
      502,
      "missing_allowed_value_link",
    );
  }

  return resolved;
}

function appendOperatorWorkNote(currentDescription, note, authorLabel) {
  const renderedDescription = currentDescription?.trim()
    ? currentDescription.trim()
    : "";
  const timestamp = new Date().toISOString();
  const actor = normalizeStringValue(authorLabel) ?? "broker";
  const noteHeading = "## Operator work notes";
  const noteEntry = `- ${timestamp} ${actor}: ${note.trim()}`;

  if (!renderedDescription) {
    return [noteHeading, "", noteEntry].join("\n");
  }

  if (renderedDescription.includes(noteHeading)) {
    return [renderedDescription, noteEntry].join("\n");
  }

  return [renderedDescription, "", noteHeading, "", noteEntry].join("\n");
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
  const sourceSurface = readCustomField(
    payload,
    config.customFieldSourceSurfaceId,
  ) ?? "";
  const sourceReference = readCustomField(
    payload,
    config.customFieldSourceReferenceId,
  ) ?? "";
  const suspectedOwner = readCustomField(
    payload,
    config.customFieldSuspectedOwnerId,
  );
  const affectedScope = readCustomField(
    payload,
    config.customFieldAffectedScopeId,
  );
  const trustBoundaryAreas = readCustomField(
    payload,
    config.customFieldTrustBoundaryAreasId,
  );
  const confidence = readCustomField(
    payload,
    config.customFieldTriageConfidenceId,
  );
  const aiAssistLane = readCustomField(
    payload,
    config.customFieldAiAssistLaneId,
  );
  const deliveryRef = readCustomField(
    payload,
    config.customFieldDeliveryRefId,
  );

  return {
    body: normalizePendingSection(
      extractDescriptionSection(rawDescription, "Captured idea"),
      NO_BODY_SENTINEL,
    ),
    createdAt: payload?.createdAt ?? null,
    deliveryCloseoutNotes: normalizeStringValue(
      extractDescriptionSection(rawDescription, "Delivery closeout"),
    ),
    deliveryRef: normalizeStringValue(deliveryRef),
    evaluation: {
      affectedScope: normalizeStringList(affectedScope),
      aiAssistLane: normalizeStringValue(aiAssistLane),
      confidence: normalizeStringValue(confidence),
      notes: normalizePendingSection(
        extractDescriptionSection(rawDescription, "Internal evaluation"),
        PENDING_INTERNAL_EVALUATION_SENTINEL,
      ),
      suspectedOwner: normalizeStringValue(suspectedOwner),
      trustBoundaryAreas: normalizeStringList(trustBoundaryAreas),
    },
    ideaId: toIdeaId(payload.id),
    operator: parseOperatorContext(rawDescription),
    operatorDecisionNotes: normalizePendingSection(
      extractDescriptionSection(rawDescription, "Operator decision notes"),
      PENDING_OPERATOR_DECISION_SENTINEL,
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
      PENDING_TRIAGE_SENTINEL,
    ),
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryRecord(config, payload) {
  return {
    originIdeaRef: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldOriginIdeaRefId),
    ),
    pm2Phase: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldPm2PhaseId),
    ),
    recordRef: `openproject://work_packages/${payload.id}`,
    status:
      payload?._links?.status?.title ??
      payload?.status ??
      "new",
    targetPi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    title: payload?.subject ?? "",
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryWorkItem(config, payload) {
  const description = payload?.description?.raw ?? "";

  return {
    assigneeLogin: workPackageAssigneeLogin(payload),
    description,
    descriptionHeadings:
      description.match(/^## ([^\n]+)$/gm)?.map((entry) => entry.replace(/^## /, "")) ??
      [],
    descriptionPresent: description.trim().length > 0,
    recordRef: `openproject://work_packages/${payload.id}`,
    status: workPackageStatusName(payload),
    subject: payload?.subject ?? "",
    targetPi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    type: workPackageTypeName(payload),
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryExecutionNode(config, payload) {
  const status = workPackageStatusName(payload);

  return {
    assignee: workPackageAssigneeLogin(payload),
    blocked: status.trim().toLowerCase() === "blocked",
    blocker_fields: null,
    children: [],
    dependency_blocked: false,
    depends_on_work_package_ids: [],
    id: payload.id,
    parent_id: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
    parked: status.trim().toLowerCase() === "parked",
    record_ref: `openproject://work_packages/${payload.id}`,
    required_by_work_package_ids: [],
    status,
    subject: payload?.subject ?? "",
    target_pi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    type: workPackageTypeName(payload),
    unresolved_dependency_work_package_ids: [],
  };
}

function mapRelationPayload(payload) {
  return {
    description:
      normalizeStringValue(payload?.description?.raw) ??
      normalizeStringValue(payload?.description),
    fromId: parseWorkPackageIdFromHref(payload?._links?.from?.href),
    id: payload?.id ?? null,
    lag:
      typeof payload?.lag === "number"
        ? payload.lag
        : null,
    relationType: normalizeStringValue(
      payload?.relationType ??
      payload?.type ??
      payload?.name,
    ),
    toId: parseWorkPackageIdFromHref(payload?._links?.to?.href),
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
          agent: false,
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

  async function getWorkPackagePayload(recordId) {
    let response;

    try {
      response = await executeRequestWithRetry(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}`),
        {
          headers: requestHeaders(),
          method: "GET",
        },
        {
          retries: 1,
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

    return responsePayload;
  }

  async function patchWorkPackagePayload(recordId, payload) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}`),
        {
          body: JSON.stringify(payload),
          headers: requestHeaders(),
          method: "PATCH",
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

    return responsePayload;
  }

  async function getWorkPackageFormPayload(recordId, lockVersion) {
    let response;

    try {
      response = await executeRequestWithRetry(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}/form`),
        {
          body: JSON.stringify({ lockVersion }),
          headers: requestHeaders(),
          method: "POST",
        },
        {
          retries: 1,
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

    return responsePayload;
  }

  async function getProjectWorkPackageFormPayload(projectIdentifier, payload = {}) {
    let response;

    try {
      response = await executeRequestWithRetry(
        joinUrl(
          config.baseUrl,
          `/api/v3/projects/${projectIdentifier}/work_packages/form`,
        ),
        {
          body: JSON.stringify(payload),
          headers: requestHeaders(),
          method: "POST",
        },
        {
          retries: 1,
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

    return responsePayload;
  }

  async function listProjectWorkPackages(projectIdentifier, { pageSize = 100 } = {}) {
    const items = [];
    let offset = 1;

    while (true) {
      let response;
      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${projectIdentifier}/work_packages?pageSize=${pageSize}&offset=${offset}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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
      items.push(...elements);

      const count =
        typeof responsePayload?.count === "number"
          ? responsePayload.count
          : elements.length;
      const total =
        typeof responsePayload?.total === "number"
          ? responsePayload.total
          : items.length;
      if (items.length >= total || count === 0) {
        break;
      }

      offset += count;
    }

    return items;
  }

  async function listWorkPackageRelations(recordId, { pageSize = 100 } = {}) {
    const items = [];
    let offset = 1;

    while (true) {
      const params = new URLSearchParams({
        filters: JSON.stringify([
          {
            involved: {
              operator: "=",
              values: [String(recordId)],
            },
          },
        ]),
        offset: String(offset),
        pageSize: String(pageSize),
      });
      let response;
      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/relations?${params.toString()}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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
      items.push(...elements);

      const count =
        typeof responsePayload?.count === "number"
          ? responsePayload.count
          : elements.length;
      const total =
        typeof responsePayload?.total === "number"
          ? responsePayload.total
          : items.length;
      if (items.length >= total || count === 0) {
        break;
      }

      offset += count;
    }

    return items;
  }

  async function createProjectWorkPackagePayload(projectIdentifier, payload) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(
          config.baseUrl,
          `/api/v3/projects/${projectIdentifier}/work_packages`,
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

    return responsePayload;
  }

  function isRecoverableNetworkError(error) {
    return error instanceof OpenProjectError &&
      error.errorClass === "backend_unavailable" &&
      error.details === "network_error";
  }

  async function executeRequestWithRetry(url, options, { retries = 1 } = {}) {
    let attempts = 0;

    while (true) {
      try {
        return await executeRequest(url, options);
      } catch (error) {
        if (attempts >= retries) {
          throw error;
        }
        attempts += 1;
      }
    }
  }

  return {
    async checkProjectReachability() {
      let response;

      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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
      const responsePayload = await createProjectWorkPackagePayload(
        config.projectIdentifier,
        payload,
      );

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
      return mapWorkPackageToIdeaRecord(config, await getWorkPackagePayload(recordId));
    },

    async listIdeas({ limit, offset }) {
      const params = buildIdeaListQuery(config, { limit, offset });
      let response;

      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}/work_packages?${params.toString()}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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

      return {
        count:
          typeof responsePayload?.count === "number"
            ? responsePayload.count
            : elements.length,
        items: elements.map((entry) => mapWorkPackageToIdeaRecord(config, entry)),
        limit:
          typeof responsePayload?.pageSize === "number"
            ? responsePayload.pageSize
            : limit,
        offset:
          typeof responsePayload?.offset === "number"
            ? responsePayload.offset
            : offset,
        total:
          typeof responsePayload?.total === "number"
            ? responsePayload.total
            : elements.length,
      };
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
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.projectIdentifier}/work_packages?${params.toString()}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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

    async lookupDeliveryByOriginIdeaRef(originIdeaRef) {
      const filters = JSON.stringify([
        {
          [`customField${config.deliveryCustomFieldOriginIdeaRefId}`]: {
            operator: "=",
            values: [originIdeaRef],
          },
        },
      ]);
      const params = new URLSearchParams({ filters });
      let response;

      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${config.deliveryProjectIdentifier}/work_packages?${params.toString()}`,
          ),
          {
            headers: requestHeaders(),
            method: "GET",
          },
          {
            retries: 1,
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
          "backend_contract_drift",
          `Multiple delivery records matched origin idea ref ${originIdeaRef}.`,
          502,
          "duplicate_origin_idea_ref",
        );
      }

      return mapWorkPackageToDeliveryRecord(config, elements[0]);
    },

    async triageIdea({ recordId, summary }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      const currentRecord = mapWorkPackageToIdeaRecord(config, currentPayload);
      const updatedPayload = await patchWorkPackagePayload(recordId, {
        lockVersion: currentPayload.lockVersion,
        description: {
          format: "markdown",
          raw: buildIdeaDescription({
            body: currentRecord.body ?? "",
            closeoutNotes: currentRecord.deliveryCloseoutNotes,
            evaluationNotes: currentRecord.evaluation?.notes,
            operator: currentRecord.operator,
            operatorDecisionNotes: currentRecord.operatorDecisionNotes,
            source: currentRecord.source,
            triageSummary: summary,
          }),
        },
        _links: {
          status: {
            href: `/api/v3/statuses/${config.triagedStatusId}`,
          },
        },
      });

      return mapWorkPackageToIdeaRecord(config, updatedPayload);
    },

    async decideIdea({ recordId, status, notes }) {
      const targetStatusId = getDecisionStatusId(config, status);
      if (!targetStatusId) {
        throw new OpenProjectError(
          "validation_failure",
          `Unsupported decision status: ${status}.`,
          422,
          "unsupported_decision_status",
        );
      }

      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      const currentRecord = mapWorkPackageToIdeaRecord(config, currentPayload);
      const updatedPayload = await patchWorkPackagePayload(recordId, {
        lockVersion: currentPayload.lockVersion,
        description: {
          format: "markdown",
          raw: buildIdeaDescription({
            body: currentRecord.body ?? "",
            closeoutNotes: currentRecord.deliveryCloseoutNotes,
            evaluationNotes: currentRecord.evaluation?.notes,
            operator: currentRecord.operator,
            operatorDecisionNotes: notes,
            source: currentRecord.source,
            triageSummary: currentRecord.triageSummary,
          }),
        },
        _links: {
          status: {
            href: `/api/v3/statuses/${targetStatusId}`,
          },
        },
      });

      return mapWorkPackageToIdeaRecord(config, updatedPayload);
    },

    async recordIdeaEvaluation({ recordId, evaluation }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      const currentRecord = mapWorkPackageToIdeaRecord(config, currentPayload);
      const currentForm = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const mergedEvaluation = {
        affectedScope:
          evaluation.affectedScope ?? currentRecord.evaluation?.affectedScope ?? [],
        aiAssistLane:
          evaluation.aiAssistLane ?? currentRecord.evaluation?.aiAssistLane ?? null,
        confidence:
          evaluation.confidence ?? currentRecord.evaluation?.confidence ?? null,
        notes: evaluation.notes ?? currentRecord.evaluation?.notes ?? null,
        suspectedOwner:
          evaluation.suspectedOwner ?? currentRecord.evaluation?.suspectedOwner ?? null,
        trustBoundaryAreas:
          evaluation.trustBoundaryAreas ??
          currentRecord.evaluation?.trustBoundaryAreas ??
          [],
      };

      const updatedPayload = await patchWorkPackagePayload(recordId, {
        lockVersion: currentPayload.lockVersion,
        description: {
          format: "markdown",
          raw: buildIdeaDescription({
            body: currentRecord.body ?? "",
            closeoutNotes: currentRecord.deliveryCloseoutNotes,
            evaluationNotes: mergedEvaluation.notes,
            operator: currentRecord.operator,
            operatorDecisionNotes: currentRecord.operatorDecisionNotes,
            source: currentRecord.source,
            triageSummary: currentRecord.triageSummary,
          }),
        },
        [`customField${config.customFieldSuspectedOwnerId}`]:
          mergedEvaluation.suspectedOwner,
        [`customField${config.customFieldAffectedScopeId}`]:
          serializeStringList(mergedEvaluation.affectedScope),
        _links: {
          [`customField${config.customFieldTrustBoundaryAreasId}`]:
            resolveCustomOptionLink({
              fieldId: config.customFieldTrustBoundaryAreasId,
              formPayload: currentForm,
              multiValue: true,
              value: mergedEvaluation.trustBoundaryAreas,
            }),
          [`customField${config.customFieldTriageConfidenceId}`]:
            resolveCustomOptionLink({
              fieldId: config.customFieldTriageConfidenceId,
              formPayload: currentForm,
              value: mergedEvaluation.confidence,
            }),
          [`customField${config.customFieldAiAssistLaneId}`]:
            resolveCustomOptionLink({
              fieldId: config.customFieldAiAssistLaneId,
              formPayload: currentForm,
              value: mergedEvaluation.aiAssistLane,
            }),
        },
      });

      return mapWorkPackageToIdeaRecord(config, updatedPayload);
    },

    async setIdeaDeliveryRef({ recordId, deliveryRef }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      try {
        const updatedPayload = await patchWorkPackagePayload(recordId, {
          lockVersion: currentPayload.lockVersion,
          [`customField${config.customFieldDeliveryRefId}`]: deliveryRef,
        });

        return mapWorkPackageToIdeaRecord(config, updatedPayload);
      } catch (error) {
        if (!isRecoverableNetworkError(error)) {
          throw error;
        }

        try {
          const recoveredPayload = await getWorkPackagePayload(recordId);
          const recoveredRecord = mapWorkPackageToIdeaRecord(config, recoveredPayload);
          if (recoveredRecord.deliveryRef === deliveryRef) {
            return recoveredRecord;
          }
        } catch {
          // Preserve the original network error when recovery read-back also fails.
        }

        throw error;
      }
    },

    async createDeliveryRecordFromIdea({ currentRecord, targetPi = null }) {
      const createForm = await getProjectWorkPackageFormPayload(
        config.deliveryProjectIdentifier,
        {
          _links: {
            type: {
              href: `/api/v3/types/${config.deliveryTopLevelTypeId}`,
            },
          },
        },
      );

      const payload = {
        subject: currentRecord.title.trim(),
        description: {
          format: "markdown",
          raw: buildAcceptedIdeaDeliveryDescription({ currentRecord }),
        },
        _links: {
          type: {
            href: `/api/v3/types/${config.deliveryTopLevelTypeId}`,
          },
          status: {
            href: `/api/v3/statuses/${config.deliveryNewStatusId}`,
          },
          [`customField${config.deliveryCustomFieldPm2PhaseId}`]:
            resolveCustomOptionLink({
              fieldId: config.deliveryCustomFieldPm2PhaseId,
              formPayload: createForm,
              value: DELIVERY_PM2_PHASE_DEFAULT,
            }),
        },
        [`customField${config.deliveryCustomFieldOriginIdeaRefId}`]:
          currentRecord.ideaId,
      };

      if (typeof targetPi === "string" && targetPi.trim()) {
        payload[`customField${config.deliveryCustomFieldTargetPiId}`] =
          targetPi.trim();
      }

      const responsePayload = await createProjectWorkPackagePayload(
        config.deliveryProjectIdentifier,
        payload,
      );

      return mapWorkPackageToDeliveryRecord(config, responsePayload);
    },

    async consumeAcceptedIdea({ currentRecord, recordId, targetPi = null }) {
      let deliveryRecord = null;
      let deliveryCreated = false;

      if (currentRecord.deliveryRef) {
        deliveryRecord = {
          originIdeaRef: currentRecord.ideaId,
          pm2Phase: null,
          recordRef: currentRecord.deliveryRef,
          status: null,
          targetPi: null,
          title: null,
          updatedAt: currentRecord.updatedAt,
        };
      } else {
        deliveryRecord = await this.lookupDeliveryByOriginIdeaRef(currentRecord.ideaId);
      }

      if (!deliveryRecord) {
        deliveryRecord = await this.createDeliveryRecordFromIdea({
          currentRecord,
          targetPi,
        });
        deliveryCreated = true;
      }

      let sourceRecord = currentRecord;
      let sourceUpdated = false;

      if (sourceRecord.deliveryRef !== deliveryRecord.recordRef) {
        sourceRecord = await this.setIdeaDeliveryRef({
          deliveryRef: deliveryRecord.recordRef,
          recordId,
        });
        sourceUpdated = true;
      }

      return {
        deliveryCreated,
        deliveryRecord,
        sourceRecord,
        sourceUpdated,
      };
    },

    async closeAcceptedIdeaDelivery({ currentRecord, recordId, closeoutNotes }) {
      const deliveryRecordId = parseWorkPackageIdFromRecordRef(
        currentRecord.deliveryRef,
        "delivery_ref",
      );
      const deliveryPayload = await getWorkPackagePayload(deliveryRecordId);
      const deliveryRecord = mapWorkPackageToDeliveryRecord(config, deliveryPayload);

      if (deliveryRecord.originIdeaRef !== currentRecord.ideaId) {
        throw new OpenProjectError(
          "backend_contract_drift",
          `Delivery record ${deliveryRecord.recordRef} does not point back to ${currentRecord.ideaId}.`,
          502,
          "delivery_origin_mismatch",
        );
      }

      if ((deliveryRecord.status ?? "").trim().toLowerCase() !== "done") {
        throw new OpenProjectError(
          "validation_failure",
          `Delivery record ${deliveryRecord.recordRef} is ${deliveryRecord.status} and cannot close the source idea yet.`,
          422,
          "delivery_not_done",
        );
      }

      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      const updatedPayload = await patchWorkPackagePayload(recordId, {
        lockVersion: currentPayload.lockVersion,
        description: {
          format: "markdown",
          raw: buildIdeaDescription({
            body: currentRecord.body ?? "",
            closeoutNotes,
            evaluationNotes: currentRecord.evaluation?.notes,
            operator: currentRecord.operator,
            operatorDecisionNotes: currentRecord.operatorDecisionNotes,
            source: currentRecord.source,
            triageSummary: currentRecord.triageSummary,
          }),
        },
        _links: {
          status: {
            href: `/api/v3/statuses/${config.implementedStatusId}`,
          },
        },
      });

      return {
        deliveryRecord,
        sourceRecord: mapWorkPackageToIdeaRecord(config, updatedPayload),
      };
    },

    async updateDeliveryWorkItem({
      assigneeLogin,
      clearAssignee = false,
      clearDescription = false,
      clearTargetPi = false,
      description,
      recordId,
      status,
      targetPi,
      workNote,
      workNoteAuthor,
    }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      if (workPackageTypeName(currentPayload) === "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Top-level delivery initiatives must be updated through the initiative workflow surface.",
          422,
          "update_initiative_required",
        );
      }

      const currentDescription = currentPayload?.description?.raw ?? "";
      const currentAssigneeLogin = workPackageAssigneeLogin(currentPayload);
      const currentStatus = workPackageStatusName(currentPayload);
      const currentTargetPi = normalizeStringValue(
        readCustomField(currentPayload, config.deliveryCustomFieldTargetPiId),
      );
      const formPayload = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};
      let descriptionRaw = currentDescription;

      if (typeof status === "string" && status.trim()) {
        if (status.trim().toLowerCase() === "done") {
          throw new OpenProjectError(
            "validation_failure",
            "Use the completion workflow to mark delivery work done with evidence.",
            422,
            "completion_requires_evidence",
          );
        }

        const resolvedStatus = resolveAllowedValueLink({
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          value: status,
        });

        if (currentStatus.toLowerCase() !== resolvedStatus.title.toLowerCase()) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.status = resolvedStatus;
          changesApplied.status = {
            from: currentStatus,
            to: resolvedStatus.title,
          };
        }
      }

      if (clearTargetPi || targetPi !== undefined) {
        const desiredTargetPi = clearTargetPi
          ? null
          : normalizeStringValue(targetPi);
        if (currentTargetPi !== desiredTargetPi) {
          patchPayload[`customField${config.deliveryCustomFieldTargetPiId}`] =
            desiredTargetPi;
          changesApplied.target_pi = {
            from: currentTargetPi,
            to: desiredTargetPi,
          };
        }
      }

      if (clearAssignee || assigneeLogin !== undefined) {
        const desiredAssigneeLogin = clearAssignee
          ? null
          : normalizeStringValue(assigneeLogin);
        if (currentAssigneeLogin !== desiredAssigneeLogin) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.assignee = clearAssignee
            ? { href: null, title: null }
            : resolveAllowedValueLink({
                fieldNames: ["assignee", "assignedTo"],
                fieldLabel: "assignee",
                formPayload,
                value: desiredAssigneeLogin,
              });
          changesApplied.assignee_login = {
            from: currentAssigneeLogin,
            to: desiredAssigneeLogin,
          };
        }
      }

      if (clearDescription) {
        descriptionRaw = "";
      } else if (description !== undefined) {
        descriptionRaw = description.trim();
      }

      if (typeof workNote === "string" && workNote.trim()) {
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        changesApplied.work_note = {
          applied: true,
        };
      }

      if (descriptionRaw !== currentDescription) {
        patchPayload.description = {
          format: "markdown",
          raw: descriptionRaw,
        };
        changesApplied.description = {
          from_present: currentDescription.trim().length > 0,
          to_present: descriptionRaw.trim().length > 0,
        };
      }

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        changesApplied,
        workItem: mapWorkPackageToDeliveryWorkItem(config, updatedPayload),
        workItemRecordId: updatedPayload.id,
        workItemRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async getDeliveryExecutionSummary({
      recordId,
      includeDone = true,
      includeParked = false,
    }) {
      const workPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
      );
      const nodesById = new Map(
        workPackages.map((payload) => [
          payload.id,
          mapWorkPackageToDeliveryExecutionNode(config, payload),
        ]),
      );
      const epic = nodesById.get(recordId);

      if (!epic) {
        throw new OpenProjectError(
          "not_found",
          `Delivery initiative ${recordId} was not found in ${config.deliveryProjectIdentifier}.`,
          404,
          "delivery_not_found",
        );
      }

      const childrenByParentId = new Map();
      for (const node of nodesById.values()) {
        if (!node.parent_id) {
          continue;
        }

        const siblings = childrenByParentId.get(node.parent_id) ?? [];
        siblings.push(node.id);
        childrenByParentId.set(node.parent_id, siblings);
      }

      const relationMap = new Map();
      for (const node of nodesById.values()) {
        const relations = await listWorkPackageRelations(node.id);
        for (const payload of relations) {
          if (payload?.id === undefined || payload?.id === null) {
            continue;
          }
          relationMap.set(payload.id, payload);
        }
      }

      const descendantIds = new Set();
      const queue = [recordId];
      while (queue.length > 0) {
        const currentId = queue.shift();
        const childIds = childrenByParentId.get(currentId) ?? [];
        for (const childId of childIds) {
          if (!descendantIds.has(childId)) {
            descendantIds.add(childId);
            queue.push(childId);
          }
        }
      }

      const scopedIds = new Set([recordId, ...descendantIds]);
      const dependencyRelations = [];
      const unresolvedDependencyRelations = [];

      for (const payload of relationMap.values()) {
        const relation = mapRelationPayload(payload);
        if (
          relation.relationType !== "follows" ||
          !relation.fromId ||
          !relation.toId ||
          !scopedIds.has(relation.fromId) ||
          !scopedIds.has(relation.toId)
        ) {
          continue;
        }

        const predecessor = nodesById.get(relation.fromId);
        const target = nodesById.get(relation.toId);
        if (!predecessor || !target) {
          continue;
        }

        target.depends_on_work_package_ids.push(predecessor.id);
        predecessor.required_by_work_package_ids.push(target.id);

        const relationSummary = {
          depends_on: {
            id: predecessor.id,
            record_ref: predecessor.record_ref,
            status: predecessor.status,
            subject: predecessor.subject,
          },
          description: relation.description,
          id: relation.id,
          lag: relation.lag,
          relation_type: relation.relationType,
          target: {
            id: target.id,
            record_ref: target.record_ref,
            status: target.status,
            subject: target.subject,
          },
          unresolved: predecessor.status.trim().toLowerCase() !== "done",
        };
        dependencyRelations.push(relationSummary);

        if (relationSummary.unresolved) {
          target.unresolved_dependency_work_package_ids.push(predecessor.id);
          unresolvedDependencyRelations.push(relationSummary);
        }
      }

      for (const node of nodesById.values()) {
        node.depends_on_work_package_ids.sort((a, b) => a - b);
        node.required_by_work_package_ids.sort((a, b) => a - b);
        node.unresolved_dependency_work_package_ids.sort((a, b) => a - b);
        node.dependency_blocked = node.unresolved_dependency_work_package_ids.length > 0;
      }

      const sortNodeIds = (leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        return left.id - right.id || left.subject.localeCompare(right.subject);
      };

      const buildTree = (nodeId) => {
        const node = structuredClone(nodesById.get(nodeId));
        const childIds = (childrenByParentId.get(nodeId) ?? []).sort(sortNodeIds);
        node.children = childIds.map((childId) => buildTree(childId));
        return node;
      };

      const filterTree = (node) => {
        if (node.id !== recordId && !includeDone && node.status.trim().toLowerCase() === "done") {
          return null;
        }

        if (node.id !== recordId && !includeParked && node.parked) {
          return null;
        }

        const filteredChildren = node.children
          .map((child) => filterTree(child))
          .filter(Boolean);
        return {
          ...node,
          children: filteredChildren,
        };
      };

      const fullTree = buildTree(recordId);
      const filteredTree = filterTree(fullTree);

      const flattenTree = (node) => [
        node,
        ...node.children.flatMap((child) => flattenTree(child)),
      ];

      const allNodes = flattenTree(fullTree);
      const descendantNodes = allNodes.filter((node) => node.id !== recordId);
      const blockedItems = descendantNodes.filter((node) => node.blocked);
      const parkedItems = descendantNodes.filter((node) => node.parked);

      const countBy = (nodes, key) =>
        Object.fromEntries(
          [...nodes.reduce((result, node) => {
            const rawValue = node[key];
            const value =
              rawValue === null || rawValue === undefined || rawValue === ""
                ? "_none_"
                : rawValue;
            result.set(value, (result.get(value) ?? 0) + 1);
            return result;
          }, new Map()).entries()].sort(([left], [right]) =>
            String(left).localeCompare(String(right)),
          ),
        );

      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: epic.record_ref,
        executionSummary: {
          blocked_items: blockedItems.map((node) => ({
            ...node,
            children: [],
          })),
          dependency_relations: dependencyRelations,
          epic: {
            ...epic,
            children: [],
          },
          execution_tree: filteredTree,
          parked_items: parkedItems.map((node) => ({
            ...node,
            children: [],
          })),
          summary: {
            blocked_count: blockedItems.length,
            by_assignee: countBy(descendantNodes, "assignee"),
            by_status: countBy(descendantNodes, "status"),
            by_target_pi: countBy(descendantNodes, "target_pi"),
            by_type: countBy(descendantNodes, "type"),
            dependency_blocked_count: descendantNodes.filter(
              (node) => node.dependency_blocked,
            ).length,
            dependency_count: dependencyRelations.length,
            include_done: includeDone,
            include_parked: includeParked,
            parked_count: parkedItems.length,
            total_items: descendantNodes.length,
            unresolved_dependency_count: unresolvedDependencyRelations.length,
          },
          unresolved_dependency_relations: unresolvedDependencyRelations,
        },
      };
    },
  };
}
