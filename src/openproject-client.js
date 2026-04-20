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
    renderedTriageSummary,
    "",
    "## Operator decision notes",
    "",
    renderedOperatorDecisionNotes,
    "",
    "## Internal evaluation",
    "",
    renderedEvaluationNotes,
  ].join("\n");
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
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}/form`),
        {
          body: JSON.stringify({ lockVersion }),
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

  async function getProjectWorkPackageFormPayload(projectIdentifier, payload = {}) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(
          config.baseUrl,
          `/api/v3/projects/${projectIdentifier}/work_packages/form`,
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
  };
}
