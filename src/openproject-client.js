import http from "node:http";
import https from "node:https";

import {
  buildCompletionSections,
  DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES,
  DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES,
  validateCompletionSection,
  validateCompletionSections,
} from "./completion-evidence.js";
import {
  DELIVERY_FORBIDDEN_STRUCTURED_DESCRIPTION_HEADINGS,
  descriptionHeadings,
  descriptionStartsWithHeading,
  forbiddenStructuredDescriptionHeadings,
  missingRequiredNarrativeHeadings,
  readMarkdownSections,
  validateDoneNarrativeState,
} from "./delivery-narrative.js";
import {
  DELIVERY_PM2_CLOSING_PHASE,
  DELIVERY_RETIRED_STATUS,
  describeDeliveryInitiativeReviewReasons,
  evaluateDeliveryInitiativeReviewState,
} from "./delivery-initiative-review.js";
import {
  DELIVERY_ALLOWED_PARENT_TYPES_BY_TYPE,
  DELIVERY_CLASSIFICATION_FIELD_NAME,
  DELIVERY_PLANNING_WORKFLOW,
  validateDeliveryPlanningState,
  resolveDeliveryTaxonomy,
  supportsDeliveryClassification,
} from "./delivery-taxonomy.js";
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
const DELIVERY_ROADMAP_UNASSIGNED_VERSION_NAME =
  DELIVERY_PLANNING_WORKFLOW.roadmap_unassigned_version_name;

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
  const errorDetails = payload?.details ?? null;
  const normalizedMarker = [errorIdentifier, errorDetails, message]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();

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
    if (
      normalizedMarker.includes("updateconflict") ||
      normalizedMarker.includes("conflicting modifications") ||
      normalizedMarker.includes("lockversion")
    ) {
      return new OpenProjectError(
        "update_conflict",
        message,
        statusCode,
        errorIdentifier ?? errorDetails,
      );
    }
    return new OpenProjectError(
      "duplicate_source_ref",
      message,
      statusCode,
      errorIdentifier,
    );
  }

  if (statusCode === 422) {
    if (
      normalizedMarker.includes("updateconflict") ||
      normalizedMarker.includes("conflicting modifications") ||
      normalizedMarker.includes("lockversion")
    ) {
      return new OpenProjectError(
        "update_conflict",
        message,
        statusCode,
        errorIdentifier ?? errorDetails,
      );
    }
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
    const directValue = payload[key];
    if (
      directValue &&
      typeof directValue === "object" &&
      typeof directValue.raw === "string"
    ) {
      return directValue.raw;
    }
    return directValue;
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

function buildAllowedValueEntryMap(entries) {
  if (!Array.isArray(entries)) {
    return new Map();
  }

  const hrefMap = new Map();

  for (const entry of entries) {
    const href = normalizeStringValue(
      entry?._links?.self?.href ??
        entry?.href ??
        null,
    );
    const title = normalizeStringValue(
      entry?._links?.self?.title ??
        entry?.title ??
        entry?.name ??
        null,
    );
    const login = normalizeStringValue(entry?.login ?? null);

    if (!href || !title) {
      continue;
    }

    hrefMap.set(title.toLowerCase(), { href, title });
    if (login) {
      hrefMap.set(login.toLowerCase(), { href, title });
    }
  }

  return hrefMap;
}

async function buildCustomOptionLinkMap({
  baseUrl,
  executeRequest,
  fieldId,
  formPayload,
  requestHeaders,
}) {
  if (!fieldId) {
    return new Map();
  }

  const allowedValues =
    formPayload?._embedded?.schema?.[`customField${fieldId}`]?._links
      ?.allowedValues;

  if (Array.isArray(allowedValues)) {
    return buildAllowedValueEntryMap(allowedValues);
  }

  const collectionHref = normalizeStringValue(allowedValues?.href ?? null);
  if (!collectionHref) {
    return new Map();
  }

  let response;
  try {
    response = await executeRequest(joinUrl(baseUrl, collectionHref), {
      headers: requestHeaders(),
      method: "GET",
    });
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
  return buildAllowedValueEntryMap(elements);
}

async function resolveCustomOptionLink({
  baseUrl,
  executeRequest,
  fieldId,
  formPayload,
  requestHeaders,
  value,
  multiValue = false,
}) {
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

  const hrefMap = await buildCustomOptionLinkMap({
    baseUrl,
    executeRequest,
    fieldId,
    formPayload,
    requestHeaders,
  });
  const values = multiValue ? normalizedValue : [normalizedValue];
  const links = values.map((entry) => {
    const resolved = hrefMap.get(entry.toLowerCase());
    if (!resolved) {
      throw new OpenProjectError(
        "backend_contract_drift",
        `OpenProject form schema does not expose custom option ${entry} for customField${fieldId}.`,
        502,
        "missing_custom_option_link",
      );
    }

    return resolved;
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

function parseAttachmentIdFromHref(href) {
  if (typeof href !== "string" || !href.trim()) {
    return null;
  }

  const match = href.trim().match(/\/api\/v3\/attachments\/(\d+)$/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function parsePrincipalIdFromHref(href) {
  if (typeof href !== "string" || !href.trim()) {
    return null;
  }

  const match = href.trim().match(/\/api\/v3\/(?:users|principals)\/(\d+)$/);
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

function workPackageResponsibleLogin(payload) {
  return normalizeStringValue(
    payload?._links?.responsible?.title ??
      payload?.responsible ??
      null,
  );
}

function completionEvidenceState(rawDescription) {
  const sections = readMarkdownSections(rawDescription);
  const sectionBodies = Object.fromEntries(
    [...DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES, ...DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES]
      .filter((heading) => sections.has(heading))
      .map((heading) => [heading, sections.get(heading)]),
  );
  return validateCompletionSections(sectionBodies);
}

function normalizeMarkdownSections(markdown) {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])## /g, "$1\n\n## ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeMarkdownSection(markdown, heading) {
  const rendered = normalizeMarkdownSections(markdown);
  const pattern = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=^## |\\z)`, "gm");
  return rendered.replace(pattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

function replaceOrAppendMarkdownSection(markdown, heading, body) {
  const rendered = removeMarkdownSection(markdown, heading);
  const section = `## ${heading}\n${String(body || "").trim()}`;

  return rendered ? `${rendered}\n\n${section}` : section;
}

function renderExecutionContextBullet(label, value, { code = false } = {}) {
  const renderedValue = normalizeStringValue(value);
  if (!renderedValue) {
    return null;
  }

  return code ? `- ${label}: \`${renderedValue}\`` : `- ${label}: ${renderedValue}`;
}

function buildExecutionContextBody({
  currentBody,
  deliveryTeam,
  iteration,
  ownerRepo,
  parentId,
  parentSubject,
}) {
  const requiredLines = [
    renderExecutionContextBullet("Owner repo", ownerRepo, { code: true }),
    Number.isInteger(parentId)
      ? renderExecutionContextBullet(
          "Parent item",
          `#${parentId}${normalizeStringValue(parentSubject) ? ` ${normalizeStringValue(parentSubject)}` : ""}`,
        )
      : null,
    renderExecutionContextBullet("Delivery team", deliveryTeam, { code: true }),
    renderExecutionContextBullet("Iteration", iteration, { code: true }),
  ].filter(Boolean);

  const reservedLabels = new Set([
    "owner repo",
    "parent item",
    "delivery team",
    "iteration",
  ]);
  const extraLines = String(currentBody || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (!line.startsWith("- ")) {
        return true;
      }

      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return true;
      }

      const label = line.slice(2, separatorIndex).trim().toLowerCase();
      return !reservedLabels.has(label);
    });

  return [...requiredLines, ...extraLines].join("\n").trim();
}

function syncExecutionContextSection(markdown, {
  deliveryTeam,
  iteration,
  ownerRepo,
  parentId,
  parentSubject,
}) {
  const renderedMarkdown = String(markdown || "").trim();
  if (!renderedMarkdown) {
    return renderedMarkdown;
  }

  const currentSectionBody = readMarkdownSections(renderedMarkdown).get("Execution Context");
  const hasContextValues =
    Number.isInteger(parentId) ||
    normalizeStringValue(ownerRepo) ||
    normalizeStringValue(deliveryTeam) ||
    normalizeStringValue(iteration);
  if (currentSectionBody === undefined && !hasContextValues) {
    return renderedMarkdown;
  }

  const nextBody = buildExecutionContextBody({
    currentBody: currentSectionBody,
    deliveryTeam,
    iteration,
    ownerRepo,
    parentId,
    parentSubject,
  });
  if (!nextBody) {
    return removeMarkdownSection(renderedMarkdown, "Execution Context");
  }

  return replaceOrAppendMarkdownSection(renderedMarkdown, "Execution Context", nextBody);
}

function readAttachmentEntries(payload) {
  const elements = payload?._embedded?.attachments?._embedded?.elements;
  if (!Array.isArray(elements)) {
    return [];
  }

  return elements
    .map((entry) => {
      const id =
        typeof entry?.id === "number"
          ? entry.id
          : parseAttachmentIdFromHref(entry?._links?.self?.href);
      const filename = normalizeStringValue(
        entry?.fileName ??
          entry?.file_name ??
          entry?.name ??
          entry?.title ??
          entry?._links?.self?.title ??
          null,
      );

      if (!Number.isInteger(id) || !filename) {
        return null;
      }

      return {
        description: normalizeStringValue(entry?.description?.raw ?? entry?.description ?? null),
        filename,
        id,
      };
    })
    .filter(Boolean);
}

function buildWorkPackageMap(workPackages) {
  return new Map(workPackages.map((payload) => [payload.id, payload]));
}

function findInitiativeRootId(workPackagesById, recordId) {
  let currentId = recordId;
  const visited = new Set();

  while (currentId) {
    if (visited.has(currentId)) {
      throw new OpenProjectError(
        "backend_contract_drift",
        `Detected a parent loop while resolving initiative root for ${recordId}.`,
        502,
        "parent_loop_detected",
      );
    }
    visited.add(currentId);

    const payload = workPackagesById.get(currentId);
    if (!payload) {
      return null;
    }

    const parentId = parseWorkPackageIdFromHref(payload?._links?.parent?.href);
    if (!parentId) {
      return currentId;
    }

    currentId = parentId;
  }

  return null;
}

function assertMoveAllowedParentType({ childType, parentType }) {
  const allowedParentTypes = DELIVERY_MOVE_ALLOWED_PARENT_TYPES_BY_TYPE[childType];
  if (!allowedParentTypes) {
    throw new OpenProjectError(
      "validation_failure",
      `Move is not supported for delivery work-item type ${childType}.`,
      422,
      "unsupported_move_type",
    );
  }

  if (!allowedParentTypes.includes(parentType)) {
    throw new OpenProjectError(
      "validation_failure",
      `Delivery work-item type ${childType} cannot move under parent type ${parentType}.`,
      422,
      "unsupported_parent_type",
    );
  }
}

async function buildAllowedValueLinkMap({
  baseUrl,
  executeRequest,
  fieldNames,
  formPayload,
  requestHeaders,
}) {
  for (const fieldName of fieldNames) {
    const allowedValueLinks =
      formPayload?._embedded?.schema?.[fieldName]?._links?.allowedValues;

    if (Array.isArray(allowedValueLinks)) {
      return buildAllowedValueEntryMap(allowedValueLinks);
    }

    const collectionHref = normalizeStringValue(allowedValueLinks?.href ?? null);
    if (!collectionHref) {
      continue;
    }

    let response;
    try {
      response = await executeRequest(joinUrl(baseUrl, collectionHref), {
        headers: requestHeaders(),
        method: "GET",
      });
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
    return buildAllowedValueEntryMap(elements);
  }

  return new Map();
}

async function resolveAllowedValueLink({
  baseUrl,
  executeRequest,
  fieldNames,
  formPayload,
  requestHeaders,
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

  const hrefMap = await buildAllowedValueLinkMap({
    baseUrl,
    executeRequest,
    fieldNames,
    formPayload,
    requestHeaders,
  });
  const resolved = hrefMap.get(normalizedValue.toLowerCase());
  if (!resolved) {
    const extraGuidance =
      fieldLabel === "assignee"
        ? " The assignee must be assignable in the target project or work item."
        : "";
    throw new OpenProjectError(
      "backend_contract_drift",
      `OpenProject form schema does not expose ${fieldLabel} option ${normalizedValue}.${extraGuidance}`,
      502,
      "missing_allowed_value_link",
    );
  }

  return resolved;
}

const DELIVERY_CREATE_CUSTOM_FIELD_SPECS = [
  { inputName: "ownerRepo", fieldName: "Owner Repo", kind: "string" },
  { inputName: "deliveryTeam", fieldName: "Delivery Team", kind: "string" },
  { inputName: "iteration", fieldName: "Iteration", kind: "string" },
  {
    inputName: "executionClassification",
    fieldName: DELIVERY_CLASSIFICATION_FIELD_NAME,
    kind: "list",
  },
  {
    inputName: "acceptanceCriteria",
    fieldName: "Acceptance Criteria",
    kind: "text",
  },
  {
    inputName: "definitionOfReady",
    fieldName: "Definition of Ready",
    kind: "text",
  },
  {
    inputName: "definitionOfDone",
    fieldName: "Definition of Done",
    kind: "text",
  },
  { inputName: "nfrCategory", fieldName: "NFR Category", kind: "list" },
  {
    inputName: "piObjectiveType",
    fieldName: "PI Objective Type",
    kind: "list",
  },
  {
    inputName: "plannedBusinessValue",
    fieldName: "Planned Business Value",
    kind: "int",
  },
  {
    inputName: "actualBusinessValue",
    fieldName: "Actual Business Value",
    kind: "int",
  },
  {
    inputName: "piObjectiveReviewOutcome",
    fieldName: "PI Objective Review Outcome",
    kind: "list",
  },
  { inputName: "roamState", fieldName: "ROAM State", kind: "list" },
  { inputName: "riskOwner", fieldName: "Risk Owner", kind: "string" },
  { inputName: "riskReviewDate", fieldName: "Risk Review Date", kind: "date" },
  {
    inputName: "riskDisposition",
    fieldName: "Risk Disposition",
    kind: "text",
  },
  {
    inputName: "wsjfUserBusinessValue",
    fieldName: "WSJF User-Business Value",
    kind: "int",
  },
  {
    inputName: "wsjfTimeCriticality",
    fieldName: "WSJF Time Criticality",
    kind: "int",
  },
  {
    inputName: "wsjfRiskReductionOpportunityEnablement",
    fieldName: "WSJF Risk Reduction / Opportunity Enablement",
    kind: "int",
  },
  { inputName: "wsjfJobSize", fieldName: "WSJF Job Size", kind: "int" },
];

const DELIVERY_UPDATE_CUSTOM_FIELD_SPECS = [...DELIVERY_CREATE_CUSTOM_FIELD_SPECS];

const DELIVERY_EPIC_UPDATE_FIELD_SPECS = [
  { inputName: "pm2Phase", fieldName: "PM² Phase", kind: "list" },
  { inputName: "sponsor", fieldName: "Sponsor", kind: "string" },
  { inputName: "businessObjective", fieldName: "Business Objective", kind: "text" },
  { inputName: "successCriteria", fieldName: "Success Criteria", kind: "text" },
  {
    inputName: "systemDemoEvidence",
    fieldName: "System Demo Evidence",
    kind: "text",
  },
  {
    inputName: "inspectAndAdaptActions",
    fieldName: "Inspect & Adapt Actions",
    kind: "text",
  },
  { inputName: "nfrCategory", fieldName: "NFR Category", kind: "list" },
  { inputName: "ownerRepo", fieldName: "Owner Repo", kind: "string" },
];

const DELIVERY_WSJF_COMPONENT_FIELD_NAMES = [
  "WSJF User-Business Value",
  "WSJF Time Criticality",
  "WSJF Risk Reduction / Opportunity Enablement",
  "WSJF Job Size",
];

const DELIVERY_WSJF_SCORE_FIELD = "WSJF Score";

const DELIVERY_READY_REQUIRED_FIELD_NAMES_BY_TYPE = {
  Feature: [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    DELIVERY_CLASSIFICATION_FIELD_NAME,
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  "User story": [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    DELIVERY_CLASSIFICATION_FIELD_NAME,
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  Defect: [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  Task: [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  "PI Objective": [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
    "PI Objective Type",
    "Planned Business Value",
    "Actual Business Value",
  ],
  Risk: [
    "Owner Repo",
    "Delivery Team",
    "Iteration",
    "ROAM State",
    "Risk Owner",
    "Risk Review Date",
    "Risk Disposition",
  ],
};

const DELIVERY_ACTIVE_EXECUTION_CONTRACT_STATUSES = new Set([
  "ready",
  "in-progress",
  "blocked",
  "parked",
]);

const DELIVERY_MOVE_ALLOWED_PARENT_TYPES_BY_TYPE = {
  ...DELIVERY_ALLOWED_PARENT_TYPES_BY_TYPE,
};

const DELIVERY_BLOCKER_FIELD_SPECS = [
  {
    fieldName: "Blocker Statement",
    inputName: "blockerStatement",
    responseKey: "statement",
  },
  {
    fieldName: "Blocker Impact",
    inputName: "blockerImpact",
    responseKey: "impact",
  },
  {
    fieldName: "Blocker Owner",
    inputName: "blockerOwner",
    responseKey: "owner",
  },
  {
    fieldName: "Blocker Discovered On",
    inputName: "blockerDiscoveredOn",
    responseKey: "discovered_on",
  },
  {
    fieldName: "Blocker Decision Path",
    inputName: "blockerDecisionPath",
    responseKey: "decision_path",
  },
  {
    fieldName: "Blocker Justification",
    inputName: "blockerJustification",
    responseKey: "justification",
  },
  {
    fieldName: "Blocker Follow-Up Owner",
    inputName: "blockerFollowUpOwner",
    responseKey: "follow_up_owner",
  },
  {
    fieldName: "Blocker Review Date",
    inputName: "blockerReviewDate",
    responseKey: "review_date",
  },
];

const DELIVERY_PARKING_FIELD_SPECS = [
  {
    fieldName: "Parking Decision",
    inputName: "parkDecision",
    responseKey: "decision",
  },
  {
    fieldName: "Parking Reason",
    inputName: "parkReason",
    responseKey: "reason",
  },
  {
    fieldName: "Parking Review Date",
    inputName: "parkReviewDate",
    responseKey: "review_date",
  },
  {
    fieldName: "Retirement Reason",
    inputName: "retirementReason",
    responseKey: "retirement_reason",
  },
];

const DELIVERY_INACTIVE_STATUSES = new Set(["parked", "retired"]);
const DELIVERY_CLOSEOUT_TERMINAL_STATUSES = new Set(["done", "retired"]);

function parseCustomFieldIdFromSchemaKey(key) {
  if (typeof key !== "string") {
    return null;
  }

  const match = key.match(/^customField(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function buildCustomFieldSchemaMap(formPayload) {
  const schema = formPayload?._embedded?.schema ?? {};
  return new Map(
    Object.entries(schema)
      .filter(([key, value]) => {
        const fieldId = parseCustomFieldIdFromSchemaKey(key);
        const name = normalizeStringValue(value?.name ?? value?.title ?? null);
        return Number.isInteger(fieldId) && Boolean(name);
      })
      .map(([key, value]) => {
        const fieldId = parseCustomFieldIdFromSchemaKey(key);
        const name = normalizeStringValue(value?.name ?? value?.title ?? null);

        return [
          name,
          {
            fieldId,
            key,
            location: value?.location === "_links" ? "_links" : "payload",
            name,
            required: value?.required === true,
            schema: value,
            type: normalizeStringValue(value?.type ?? null),
            writable: value?.writable !== false,
          },
        ];
      }),
  );
}

function readCustomFieldValueFromSchemaEntry(payload, entry) {
  if (!entry) {
    return null;
  }

  if (entry.location === "_links") {
    const linkedValue = payload?._links?.[entry.key];
    if (Array.isArray(linkedValue)) {
      return linkedValue
        .map((item) => normalizeStringValue(item?.title ?? null))
        .filter(Boolean);
    }

    return normalizeStringValue(linkedValue?.title ?? null);
  }

  const directValue = payload?.[entry.key];
  if (
    directValue &&
    typeof directValue === "object" &&
    typeof directValue.raw === "string"
  ) {
    return directValue.raw;
  }

  return directValue ?? null;
}

function setCustomFieldPayloadValue(payload, entry, value) {
  if (!entry) {
    return;
  }

  if (entry.location === "_links") {
    payload._links = payload._links ?? {};
    payload._links[entry.key] = value;
    return;
  }

  payload[entry.key] = value;
}

function parseIsoDateString(value, fieldName) {
  const normalized = normalizeStringValue(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be an ISO date (YYYY-MM-DD).`,
      422,
      "invalid_iso_date",
    );
  }

  const [year, month, day] = match.slice(1).map((entry) => Number.parseInt(entry, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be an ISO date (YYYY-MM-DD).`,
      422,
      "invalid_iso_date",
    );
  }

  return normalized;
}

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be an integer.`,
      422,
      "invalid_integer",
    );
  }

  return parsed;
}

function parseCreateHoursValue(rawValue, fieldName) {
  const normalized = normalizeStringValue(rawValue);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be a numeric value greater than or equal to zero.`,
      422,
      "invalid_hours_value",
    );
  }

  return parsed;
}

function serializeDurationHours(hoursValue) {
  if (hoursValue === null || hoursValue === undefined) {
    return null;
  }

  return `PT${String(hoursValue)}H`;
}

function parseCreateDateValue(rawValue, fieldName) {
  const normalized = normalizeStringValue(rawValue);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new OpenProjectError(
      "validation_failure",
      `${fieldName} must be an ISO date (YYYY-MM-DD).`,
      422,
      "invalid_date_value",
    );
  }

  return normalized;
}

function parseCreatePercentComplete(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new OpenProjectError(
      "validation_failure",
      "percent_complete must be an integer between 0 and 100.",
      422,
      "invalid_percent_complete",
    );
  }

  return parsed;
}

function parseDurationToHours(rawValue) {
  const normalized = normalizeStringValue(rawValue);
  if (!normalized) {
    return null;
  }

  const hourMatch = normalized.match(/^PT([0-9]+(?:\.[0-9]+)?)H$/i);
  if (hourMatch) {
    return Number.parseFloat(hourMatch[1]);
  }

  const minuteMatch = normalized.match(/^PT([0-9]+(?:\.[0-9]+)?)M$/i);
  if (minuteMatch) {
    return Number.parseFloat(minuteMatch[1]) / 60;
  }

  return normalized;
}

async function parseCreateCustomFieldValue({
  baseUrl,
  executeRequest,
  entry,
  formPayload,
  requestHeaders,
  kind,
  rawValue,
}) {
  switch (kind) {
    case "int": {
      const parsed = Number.parseInt(String(rawValue), 10);
      if (!Number.isInteger(parsed)) {
        throw new OpenProjectError(
          "validation_failure",
          `${entry.name} must be an integer.`,
          422,
          "invalid_custom_field_integer",
        );
      }
      return String(parsed);
    }
    case "date":
      return parseCreateDateValue(rawValue, entry.name);
    case "list":
      return resolveCustomOptionLink({
        baseUrl,
        executeRequest,
        fieldId: entry.fieldId,
        formPayload,
        requestHeaders,
        value: rawValue,
      });
    case "string":
    case "text": {
      const normalized = normalizeStringValue(rawValue);
      if (!normalized) {
        throw new OpenProjectError(
          "validation_failure",
          `${entry.name} must be a non-empty string.`,
          422,
          "invalid_custom_field_string",
        );
      }
      if (entry.type === "Formattable") {
        return {
          format: "markdown",
          raw: normalized,
        };
      }
      return normalized;
    }
    default:
      return rawValue;
  }
}

function customFieldValueComparable(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function validateDeliveryExecutionContract({
  customFieldMap,
  parentTypeName = null,
  payload,
  typeName,
}) {
  const requiredFieldNames = DELIVERY_READY_REQUIRED_FIELD_NAMES_BY_TYPE[typeName] ?? [];
  const missingFieldNames = requiredFieldNames.filter((fieldName) => {
    const entry = customFieldMap.get(fieldName);
    const value = readCustomFieldValueFromSchemaEntry(payload, entry);
    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return value === null || value === undefined || `${value}`.trim() === "";
  });

  if (!workPackageAssigneeLogin(payload)) {
    missingFieldNames.push("Assignee");
  }

  if (!workPackageResponsibleLogin(payload)) {
    missingFieldNames.push("Responsible");
  }

  const executionClassification = readDeliveryExecutionClassification(payload, customFieldMap);
  let resolvedTaxonomy;
  try {
    resolvedTaxonomy = resolveDeliveryTaxonomy({
      classification: executionClassification,
      enforceParentType: false,
      parentTypeName,
      subject: payload?.subject ?? "",
      typeName,
    });
  } catch (error) {
    throw new OpenProjectError(
      "validation_failure",
      error.message,
      422,
      "delivery_taxonomy_invalid",
    );
  }

  const rawDescription = payload?.description?.raw ?? "";
  if (!descriptionStartsWithHeading(rawDescription)) {
    missingFieldNames.push("Description heading start");
  }

  const duplicatedStructuredHeadings = forbiddenStructuredDescriptionHeadings(rawDescription);
  if (duplicatedStructuredHeadings.length > 0) {
    missingFieldNames.push(
      `Forbidden structured headings: ${duplicatedStructuredHeadings.join(", ")}`,
    );
  }

  const missingNarrativeHeadings = missingRequiredNarrativeHeadings(
    rawDescription,
    typeName,
    resolvedTaxonomy.classification,
  );
  if (missingNarrativeHeadings.length > 0) {
    missingFieldNames.push(`Narrative headings: ${missingNarrativeHeadings.join(", ")}`);
  }

  if (missingFieldNames.length > 0) {
    throw new OpenProjectError(
      "validation_failure",
      `Work item cannot remain in ${payload?._links?.status?.title ?? typeName} while required execution fields are missing: ${missingFieldNames.join(", ")}.`,
      422,
      "ready_fields_missing",
    );
  }
}

function normalizePlanCustomValue({ field, kind, rawValue }) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  switch (kind) {
    case "int":
      return String(Number.parseInt(String(rawValue), 10));
    case "date":
      return parseCreateDateValue(rawValue, field.name);
    case "list":
      return rawValue;
    case "string":
    case "text": {
      const normalized = normalizeStringValue(rawValue);
      if (!normalized) {
        return null;
      }
      if (field.type === "Formattable") {
        return {
          format: "markdown",
          raw: normalized,
        };
      }
      return normalized;
    }
    default:
      return rawValue;
  }
}

function buildCustomFieldValuesByName({ payload, customFieldMap }) {
  return Object.fromEntries(
    [...customFieldMap.entries()]
      .map(([fieldName, entry]) => {
        const value = readCustomFieldValueFromSchemaEntry(payload, entry);
        if (
          value === null ||
          value === undefined ||
          (typeof value === "string" && !value.trim()) ||
          (Array.isArray(value) && value.length === 0)
        ) {
          return null;
        }

        return [fieldName, value];
      })
      .filter(Boolean)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function appendOperatorWorkNote(currentDescription, note, authorLabel) {
  const renderedDescription = currentDescription?.trim()
    ? currentDescription.trim()
    : "";
  const timestamp = new Date().toISOString();
  const actor = normalizeStringValue(authorLabel) ?? "broker";
  const noteHeading = "## Operator work notes";
  const noteEntry = `- ${timestamp} ${actor}: ${note.trim()}`;

  if (operatorWorkNoteAlreadyPresent(renderedDescription, note, actor)) {
    return renderedDescription;
  }

  if (!renderedDescription) {
    return [noteHeading, "", noteEntry].join("\n");
  }

  const sections = readMarkdownSections(renderedDescription);
  if (sections.has("Operator work notes")) {
    const existingBody = sections.get("Operator work notes");
    const nextBody = existingBody?.trim()
      ? `${existingBody.trim()}\n${noteEntry}`
      : noteEntry;
    return replaceOrAppendMarkdownSection(
      renderedDescription,
      "Operator work notes",
      nextBody,
    );
  }

  return [renderedDescription, "", noteHeading, "", noteEntry].join("\n");
}

function assertCompletionEvidenceValid(rawDescription) {
  const completionState = completionEvidenceState(rawDescription);
  if (completionState.issues.length > 0) {
    throw new OpenProjectError(
      "validation_failure",
      `Completion evidence does not meet the ART closeout standard: ${completionState.issues.join("; ")}`,
      422,
      "completion_evidence_invalid",
    );
  }

  return completionState;
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

function mapWorkPackageToDeliveryInitiative(config, payload, fieldMap = null) {
  const description = payload?.description?.raw ?? "";

  return {
    assignee_login: workPackageAssigneeLogin(payload),
    description,
    descriptionPresent: description.trim().length > 0,
    originIdeaRef: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldOriginIdeaRefId),
    ),
    owner_repo: fieldMap
      ? normalizeStringValue(
          readCustomFieldValueFromSchemaEntry(payload, fieldMap.get("Owner Repo")),
        )
      : null,
    pm2Phase: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldPm2PhaseId),
    ),
    recordRef: `openproject://work_packages/${payload.id}`,
    status:
      payload?._links?.status?.title ??
      payload?.status ??
      "new",
    subject: payload?.subject ?? "",
    responsible_login: workPackageResponsibleLogin(payload),
    targetPi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    type: workPackageTypeName(payload),
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryWorkItem(config, payload, fieldMap = null) {
  const description = payload?.description?.raw ?? "";
  const fallbackTaxonomy = (() => {
    try {
      return resolveDeliveryTaxonomy({
        subject: payload?.subject ?? "",
        typeName: workPackageTypeName(payload),
      });
    } catch {
      return null;
    }
  })();

  return {
    assigneeLogin: workPackageAssigneeLogin(payload),
    description,
    descriptionHeadings:
      description.match(/^## ([^\n]+)$/gm)?.map((entry) => entry.replace(/^## /, "")) ??
      [],
    descriptionPresent: description.trim().length > 0,
    dueDate: normalizeStringValue(payload?.dueDate ?? null),
    estimatedWork: parseDurationToHours(payload?.estimatedTime ?? null),
    parentId: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
    percentComplete:
      typeof payload?.percentageDone === "number" ? payload.percentageDone : null,
    recordRef: `openproject://work_packages/${payload.id}`,
    remainingWork: parseDurationToHours(payload?.remainingTime ?? null),
    startDate: normalizeStringValue(payload?.startDate ?? null),
    status: workPackageStatusName(payload),
    subject: payload?.subject ?? "",
    targetPi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    executionClassification: fieldMap
      ? readDeliveryExecutionClassification(payload, fieldMap)
      : fallbackTaxonomy?.classification ?? null,
    type: workPackageTypeName(payload),
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryExecutionNode(config, payload, fieldMap = null) {
  const status = workPackageStatusName(payload);
  const normalizedStatus = status.trim().toLowerCase();
  const fallbackTaxonomy = (() => {
    try {
      return resolveDeliveryTaxonomy({
        subject: payload?.subject ?? "",
        typeName: workPackageTypeName(payload),
      });
    } catch {
      return null;
    }
  })();

  return {
    assignee: workPackageAssigneeLogin(payload),
    blocked: normalizedStatus === "blocked",
    blocker_fields: null,
    children: [],
    dependency_blocked: false,
    depends_on_work_package_ids: [],
    id: payload.id,
    parent_id: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
    parked: normalizedStatus === "parked",
    retired: normalizedStatus === "retired",
    record_ref: `openproject://work_packages/${payload.id}`,
    required_by_work_package_ids: [],
    status,
    subject: payload?.subject ?? "",
    target_pi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    execution_classification: fieldMap
      ? readDeliveryExecutionClassification(payload, fieldMap)
      : fallbackTaxonomy?.classification ?? null,
    type: workPackageTypeName(payload),
    unresolved_dependency_work_package_ids: [],
  };
}

function buildDeliveryInitiativeFieldEntryMap(formPayload) {
  const customFieldMap = buildCustomFieldSchemaMap(formPayload);
  const initiativeFields = new Map();

  for (const spec of DELIVERY_EPIC_UPDATE_FIELD_SPECS) {
    const entry = customFieldMap.get(spec.fieldName);
    if (entry) {
      initiativeFields.set(spec.fieldName, entry);
    }
  }

  return initiativeFields;
}

function buildDeliveryItemFieldMap(formPayload) {
  return buildCustomFieldSchemaMap(formPayload);
}

function readDeliveryExecutionClassification(payload, fieldMap) {
  return normalizeStringValue(
    readCustomFieldValueFromSchemaEntry(payload, fieldMap.get(DELIVERY_CLASSIFICATION_FIELD_NAME)),
  );
}

function validateReadyDeliveryFields({
  fieldMap,
  payload,
  typeName,
}) {
  const requiredFieldNames =
    DELIVERY_READY_REQUIRED_FIELD_NAMES_BY_TYPE[typeName] ?? [];
  const missingFieldNames = requiredFieldNames.filter((fieldName) => {
    const entry = fieldMap.get(fieldName);
    const value = readCustomFieldValueFromSchemaEntry(payload, entry);
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    return value === null || value === undefined || `${value}`.trim() === "";
  });

  if (missingFieldNames.length > 0) {
    throw new OpenProjectError(
      "validation_failure",
      `Work item cannot be in ready while required fields are missing: ${missingFieldNames.join(", ")}.`,
      422,
      "ready_fields_missing",
    );
  }
}

function buildDoneNarrativeContractState({
  fieldMap,
  payload,
  typeName,
}) {
  const classification = readDeliveryExecutionClassification(payload, fieldMap);
  return validateDoneNarrativeState({
    classification,
    deliveryTeam: normalizeStringValue(
      readCustomFieldValueFromSchemaEntry(payload, fieldMap.get("Delivery Team")),
    ),
    iteration: normalizeStringValue(
      readCustomFieldValueFromSchemaEntry(payload, fieldMap.get("Iteration")),
    ),
    ownerRepo: normalizeStringValue(
      readCustomFieldValueFromSchemaEntry(payload, fieldMap.get("Owner Repo")),
    ),
    parentId: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
    rawDescription: payload?.description?.raw ?? "",
    typeName,
  });
}

function buildPatchedWorkPackagePreview(currentPayload, patchPayload) {
  const previewPayload = JSON.parse(JSON.stringify(currentPayload ?? {}));
  for (const [key, value] of Object.entries(patchPayload ?? {})) {
    if (key === "lockVersion") {
      continue;
    }

    if (key === "_links") {
      previewPayload._links = {
        ...(previewPayload._links ?? {}),
        ...(value ?? {}),
      };
      continue;
    }

    previewPayload[key] = value;
  }

  return previewPayload;
}

function normalizeComparableText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function operatorWorkNoteAlreadyPresent(currentDescription, note, authorLabel) {
  const renderedDescription = currentDescription?.trim()
    ? currentDescription.trim()
    : "";
  if (!renderedDescription) {
    return false;
  }

  const normalizedActor = normalizeComparableText(
    normalizeStringValue(authorLabel) ?? "broker",
  );
  const normalizedNote = normalizeComparableText(note);
  if (!normalizedNote) {
    return false;
  }

  return normalizeComparableText(renderedDescription).includes(
    `${normalizedActor}: ${normalizedNote}`,
  );
}

function appendFormattableEntryIfMissing(currentValue, entryBody) {
  const normalizedEntryBody = typeof entryBody === "string"
    ? entryBody.trim()
    : "";
  const normalizedCurrentValue = normalizeStringValue(currentValue);

  if (!normalizedEntryBody) {
    return {
      appended: false,
      value: normalizedCurrentValue,
    };
  }

  if (!normalizedCurrentValue) {
    return {
      appended: true,
      value: normalizedEntryBody,
    };
  }

  if (normalizedCurrentValue.includes(normalizedEntryBody)) {
    return {
      appended: false,
      value: normalizedCurrentValue,
    };
  }

  return {
    appended: true,
    value: `${normalizedCurrentValue}\n\n${normalizedEntryBody}`,
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

  async function getProjectPayload(projectIdentifier) {
    let response;

    try {
      response = await executeRequestWithRetry(
        joinUrl(config.baseUrl, `/api/v3/projects/${projectIdentifier}`),
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

  function normalizeAssignablePrincipal(entry) {
    const href = normalizeStringValue(entry?._links?.self?.href ?? null);
    const login = normalizeStringValue(
      entry?.login ??
        entry?.identifier ??
        entry?.title ??
        entry?.name ??
        entry?._links?.self?.title ??
        null,
    );
    const name = normalizeStringValue(
      entry?.name ??
        entry?.title ??
        entry?.login ??
        entry?.identifier ??
        null,
    );
    const type = normalizeStringValue(entry?._type ?? entry?.type ?? null);
    const id =
      typeof entry?.id === "number" ? entry.id : parsePrincipalIdFromHref(href);

    return {
      href,
      id,
      login,
      name,
      type,
    };
  }

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
    let attempts = 0;

    while (true) {
      let effectivePayload = payload;
      if (typeof effectivePayload?.lockVersion !== "number") {
        const currentPayload = await getWorkPackagePayload(recordId);
        if (typeof currentPayload?.lockVersion !== "number") {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package response did not include lockVersion.",
            502,
            "missing_lock_version",
          );
        }

        effectivePayload = {
          ...payload,
          lockVersion: currentPayload.lockVersion,
        };
      }

      let response;

      try {
        response = await executeRequest(
          joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}`),
          {
            body: JSON.stringify(effectivePayload),
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

      if (response.ok) {
        return responsePayload;
      }

      const mappedError = mapOpenProjectError(response.status, responsePayload);
      if (mappedError.errorClass === "update_conflict" && attempts < 1) {
        const currentPayload = await getWorkPackagePayload(recordId);
        if (typeof currentPayload?.lockVersion !== "number") {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package response did not include lockVersion.",
            502,
            "missing_lock_version",
          );
        }

        attempts += 1;
        payload = {
          ...payload,
          lockVersion: currentPayload.lockVersion,
        };
        continue;
      }

      throw mappedError;
    }
  }

  async function getWorkPackageFormPayload(recordId, lockVersion) {
    let effectiveLockVersion = lockVersion;
    if (typeof effectiveLockVersion !== "number") {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (typeof currentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      effectiveLockVersion = currentPayload.lockVersion;
    }

    let response;

    try {
      response = await executeRequestWithRetry(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}/form`),
        {
          body: JSON.stringify({ lockVersion: effectiveLockVersion }),
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

  async function listProjectWorkPackages(
    projectIdentifier,
    { includeAllStatuses = false, pageSize = 100 } = {},
  ) {
    const items = [];
    let offset = 1;

    while (true) {
      const params = new URLSearchParams({
        offset: String(offset),
        pageSize: String(pageSize),
      });
      if (includeAllStatuses) {
        // OpenProject applies an implicit open-only status filter unless an
        // explicit filters parameter is supplied.
        params.set("filters", "[]");
      }

      let response;
      try {
        response = await executeRequestWithRetry(
          joinUrl(
            config.baseUrl,
            `/api/v3/projects/${projectIdentifier}/work_packages?${params.toString()}`,
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

      offset += 1;
    }

    return items;
  }

  function buildDeliveryBlockerFieldEntryMap(formPayload) {
    const customFieldMap = buildCustomFieldSchemaMap(formPayload);
    const blockerFields = new Map();

    for (const spec of DELIVERY_BLOCKER_FIELD_SPECS) {
      const entry = customFieldMap.get(spec.fieldName);
      if (!entry) {
        throw new OpenProjectError(
          "backend_contract_drift",
          `OpenProject work package form is missing the ${spec.fieldName} field.`,
          502,
          "missing_blocker_field",
        );
      }
      blockerFields.set(spec.fieldName, entry);
    }

    return blockerFields;
  }

  function buildDeliveryParkingFieldEntryMap(formPayload) {
    const customFieldMap = buildCustomFieldSchemaMap(formPayload);
    const parkingFields = new Map();

    for (const spec of DELIVERY_PARKING_FIELD_SPECS) {
      const entry = customFieldMap.get(spec.fieldName);
      if (!entry) {
        throw new OpenProjectError(
          "backend_contract_drift",
          `OpenProject work package form is missing the ${spec.fieldName} field.`,
          502,
          "missing_parking_field",
        );
      }
      parkingFields.set(spec.fieldName, entry);
    }

    return parkingFields;
  }

  function readDeliveryBlockerValues(payload, blockerFieldEntries) {
    const result = {};

    for (const spec of DELIVERY_BLOCKER_FIELD_SPECS) {
      result[spec.responseKey] = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(
          payload,
          blockerFieldEntries.get(spec.fieldName),
        ),
      );
    }

    return result;
  }

  function readDeliveryParkingValues(payload, parkingFieldEntries) {
    const result = {};

    for (const spec of DELIVERY_PARKING_FIELD_SPECS) {
      result[spec.responseKey] = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(
          payload,
          parkingFieldEntries.get(spec.fieldName),
        ),
      );
    }

    return result;
  }

  async function setDeliveryBlockerFieldValue({
    formPayload,
    inputValue,
    patchPayload,
    spec,
    blockerFieldEntries,
  }) {
    const entry = blockerFieldEntries.get(spec.fieldName);

    if (entry.location === "_links") {
      setCustomFieldPayloadValue(
        patchPayload,
        entry,
        await resolveCustomOptionLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldId: entry.fieldId,
          formPayload,
          requestHeaders,
          value: inputValue,
        }),
      );
      return;
    }

    setCustomFieldPayloadValue(patchPayload, entry, inputValue);
  }

  async function setDeliveryParkingFieldValue({
    formPayload,
    inputValue,
    parkingFieldEntries,
    patchPayload,
    spec,
  }) {
    const entry = parkingFieldEntries.get(spec.fieldName);

    if (entry.location === "_links") {
      if (inputValue === null || inputValue === undefined || inputValue === "") {
        setCustomFieldPayloadValue(
          patchPayload,
          entry,
          {
            href: null,
            title: null,
          },
        );
        return;
      }

      setCustomFieldPayloadValue(
        patchPayload,
        entry,
        await resolveCustomOptionLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldId: entry.fieldId,
          formPayload,
          requestHeaders,
          value: inputValue,
        }),
      );
      return;
    }

    setCustomFieldPayloadValue(patchPayload, entry, inputValue);
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

      offset += 1;
    }

    return items;
  }

  async function createWorkPackageRelation({ description, fromRecordId, lag, toRecordId }) {
    let response;
    const payload = {
      type: "follows",
      _links: {
        to: {
          href: `/api/v3/work_packages/${toRecordId}`,
        },
      },
    };

    if (lag !== null && lag !== undefined) {
      payload.lag = lag;
    }
    if (description !== null && description !== undefined) {
      payload.description = description;
    }

    try {
      response = await executeRequest(
        joinUrl(
          config.baseUrl,
          `/api/v3/work_packages/${fromRecordId}/relations`,
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

  async function patchRelationPayload(relationId, payload) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/relations/${relationId}`),
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

  async function deleteRelationPayload(relationId) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/relations/${relationId}`),
        {
          headers: requestHeaders(),
          method: "DELETE",
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

    if (response.status === 204) {
      return null;
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

  async function buildDeliveryReadFieldMap({ initiativeRecordId }) {
    if (!initiativeRecordId) {
      return new Map();
    }

    const merged = new Map();
    const mergeMap = (fieldMap) => {
      for (const [fieldName, entry] of fieldMap.entries()) {
        if (!merged.has(fieldName)) {
          merged.set(fieldName, entry);
        }
      }
    };

    mergeMap(buildCustomFieldSchemaMap(await getWorkPackageFormPayload(initiativeRecordId)));

    const parentHref = `/api/v3/work_packages/${initiativeRecordId}`;
    const baseCreateForm = await getProjectWorkPackageFormPayload(
      config.deliveryProjectIdentifier,
      {
        _links: {
          parent: {
            href: parentHref,
          },
        },
      },
    );

    for (const typeName of [
      "Feature",
      "Milestone",
      "PI Objective",
      "Risk",
      "User story",
      "Defect",
      "Task",
    ]) {
      try {
        const resolvedType = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldLabel: "type",
          fieldNames: ["type"],
          formPayload: baseCreateForm,
          requestHeaders,
          value: typeName,
        });
        const formPayload = await getProjectWorkPackageFormPayload(
          config.deliveryProjectIdentifier,
          {
            _links: {
              parent: {
                href: parentHref,
              },
              type: resolvedType,
            },
          },
        );
        mergeMap(buildCustomFieldSchemaMap(formPayload));
      } catch (error) {
        if (
          error instanceof OpenProjectError &&
          error.errorClass === "backend_contract_drift" &&
          error.details === "missing_allowed_value_link"
        ) {
          continue;
        }
        throw error;
      }
    }

    return merged;
  }

function readDeliveryFieldValue(payload, fieldMap, fieldName) {
  return readCustomFieldValueFromSchemaEntry(payload, fieldMap.get(fieldName));
}

  function buildReadyContractState({ fieldMap, payload, typeName }) {
    const requiredFieldNames = DELIVERY_READY_REQUIRED_FIELD_NAMES_BY_TYPE[typeName] ?? [];
    const missingFieldNames = requiredFieldNames.filter((fieldName) => {
      const value = readDeliveryFieldValue(payload, fieldMap, fieldName);
      if (Array.isArray(value)) {
        return value.length === 0;
      }

      return value === null || value === undefined || `${value}`.trim() === "";
    });

    if (!workPackageAssigneeLogin(payload)) {
      missingFieldNames.push("Assignee");
    }

    if (!workPackageResponsibleLogin(payload)) {
      missingFieldNames.push("Responsible");
    }

    const rawDescription = payload?.description?.raw ?? "";
    if (!descriptionStartsWithHeading(rawDescription)) {
      missingFieldNames.push("Description heading start");
    }

    const duplicatedStructuredHeadings = forbiddenStructuredDescriptionHeadings(rawDescription);
    if (duplicatedStructuredHeadings.length > 0) {
      missingFieldNames.push(
        `Forbidden structured headings: ${duplicatedStructuredHeadings.join(", ")}`,
      );
    }

    const missingNarrative = missingRequiredNarrativeHeadings(
      rawDescription,
      typeName,
      readDeliveryExecutionClassification(payload, fieldMap),
    );
    if (missingNarrative.length > 0) {
      missingFieldNames.push(`Narrative headings: ${missingNarrative.join(", ")}`);
    }

    return {
      applicable: requiredFieldNames.length > 0,
      missingFields: missingFieldNames,
      satisfied: missingFieldNames.length === 0,
    };
  }

  function mapWorkPackageToDeliveryPortfolioNode({ fieldMap, payload }) {
    const description = payload?.description?.raw ?? "";
    const typeName = workPackageTypeName(payload);
    const status = workPackageStatusName(payload);
    const normalizedStatus = status.trim().toLowerCase();
    const blockerFields = Object.fromEntries(
      DELIVERY_BLOCKER_FIELD_SPECS.map((spec) => [
        spec.fieldName,
        readDeliveryFieldValue(payload, fieldMap, spec.fieldName),
      ]),
    );
    const blockerActive = Object.values(blockerFields).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return value !== null && value !== undefined && `${value}`.trim() !== "";
    });
    const inactiveFields = Object.fromEntries(
      DELIVERY_PARKING_FIELD_SPECS.map((spec) => [
        spec.fieldName,
        readDeliveryFieldValue(payload, fieldMap, spec.fieldName),
      ]),
    );
    const inactiveFieldsPresent = Object.values(inactiveFields).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return value !== null && value !== undefined && `${value}`.trim() !== "";
    });
    const readyState = buildReadyContractState({
      fieldMap,
      payload,
      typeName,
    });
    const completionState = completionEvidenceState(description);
    const doneNarrativeState = normalizedStatus === "done"
      ? buildDoneNarrativeContractState({
          fieldMap,
          payload,
          typeName,
        })
      : {
          formattingValid: true,
          issues: [],
          present: description.trim().length > 0,
        };
    const attachmentEntries = readAttachmentEntries(payload);

    return {
      actual_business_value: readDeliveryFieldValue(payload, fieldMap, "Actual Business Value"),
      assignee_login: workPackageAssigneeLogin(payload),
      attachment_count: attachmentEntries.length,
      attachment_filenames: attachmentEntries.map((entry) => entry.filename),
      blocked: blockerActive || normalizedStatus === "blocked",
      blocker_fields: blockerActive ? blockerFields : null,
      business_objective: readDeliveryFieldValue(payload, fieldMap, "Business Objective"),
      business_objective_present: Boolean(
        normalizeStringValue(readDeliveryFieldValue(payload, fieldMap, "Business Objective")),
      ),
      children: [],
      completion_evidence_formatting_valid: completionState.formattingValid,
      completion_evidence_issues: completionState.issues,
      completion_evidence_present: completionState.present,
      completion_evidence_sections: completionState.sections,
      dependency_blocked: false,
      depends_on_work_package_ids: [],
      delivery_team: readDeliveryFieldValue(payload, fieldMap, "Delivery Team"),
      description_headings: descriptionHeadings(description),
      description_present: description.trim().length > 0,
      description_starts_with_heading: descriptionStartsWithHeading(description),
      done_narrative_contract_applicable: normalizedStatus === "done",
      done_narrative_contract_issues: doneNarrativeState.issues,
      done_narrative_contract_satisfied: doneNarrativeState.formattingValid,
      due_date: normalizeStringValue(payload?.dueDate ?? null),
      estimated_work: parseDurationToHours(payload?.estimatedTime ?? null),
      execution_classification: readDeliveryExecutionClassification(payload, fieldMap),
      id: payload.id,
      inactive_scope_fields:
        inactiveFieldsPresent || DELIVERY_INACTIVE_STATUSES.has(normalizedStatus)
          ? inactiveFields
          : null,
      inspect_and_adapt_actions: readDeliveryFieldValue(payload, fieldMap, "Inspect & Adapt Actions"),
      inspect_and_adapt_actions_present: Boolean(
        normalizeStringValue(
          readDeliveryFieldValue(payload, fieldMap, "Inspect & Adapt Actions"),
        ),
      ),
      iteration: readDeliveryFieldValue(payload, fieldMap, "Iteration"),
      nfr_category: readDeliveryFieldValue(payload, fieldMap, "NFR Category"),
      owner_repo: readDeliveryFieldValue(payload, fieldMap, "Owner Repo"),
      parent_id: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
      parked: normalizedStatus === "parked",
      percent_complete:
        typeof payload?.percentageDone === "number" ? payload.percentageDone : null,
      pi_objective_review_outcome: readDeliveryFieldValue(
        payload,
        fieldMap,
        "PI Objective Review Outcome",
      ),
      pi_objective_type: readDeliveryFieldValue(payload, fieldMap, "PI Objective Type"),
      planned_business_value: readDeliveryFieldValue(payload, fieldMap, "Planned Business Value"),
      pm2_phase: readDeliveryFieldValue(payload, fieldMap, "PM² Phase"),
      ready_contract_applicable: readyState.applicable,
      ready_contract_missing_fields: readyState.missingFields,
      ready_contract_satisfied: readyState.satisfied,
      record_ref: `openproject://work_packages/${payload.id}`,
      remaining_work: parseDurationToHours(payload?.remainingTime ?? null),
      required_by_work_package_ids: [],
      responsible_login: workPackageResponsibleLogin(payload),
      retired: normalizedStatus === "retired",
      risk_disposition: readDeliveryFieldValue(payload, fieldMap, "Risk Disposition"),
      risk_owner: readDeliveryFieldValue(payload, fieldMap, "Risk Owner"),
      risk_review_date: readDeliveryFieldValue(payload, fieldMap, "Risk Review Date"),
      roam_state: readDeliveryFieldValue(payload, fieldMap, "ROAM State"),
      sponsor: readDeliveryFieldValue(payload, fieldMap, "Sponsor"),
      start_date: normalizeStringValue(payload?.startDate ?? null),
      status,
      subject: payload?.subject ?? "",
      success_criteria: readDeliveryFieldValue(payload, fieldMap, "Success Criteria"),
      success_criteria_present: Boolean(
        normalizeStringValue(readDeliveryFieldValue(payload, fieldMap, "Success Criteria")),
      ),
      system_demo_evidence: readDeliveryFieldValue(payload, fieldMap, "System Demo Evidence"),
      system_demo_evidence_present: Boolean(
        normalizeStringValue(readDeliveryFieldValue(payload, fieldMap, "System Demo Evidence")),
      ),
      target_pi: readDeliveryFieldValue(payload, fieldMap, "Target PI"),
      type: typeName,
      type_position:
        typeof payload?._embedded?.type?.position === "number"
          ? payload._embedded.type.position
          : 0,
      unresolved_dependency_work_package_ids: [],
      updated_at: payload?.updatedAt ?? null,
      version_name: normalizeStringValue(
        payload?._links?.version?.title ?? payload?._embedded?.version?.name ?? null,
      ),
      wsjf_score: readDeliveryFieldValue(payload, fieldMap, "WSJF Score"),
    };
  }

  function countNodesBy(items, key) {
    return Object.fromEntries(
      [...items.reduce((result, item) => {
        const rawValue = item[key];
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
  }

  async function buildDeliveryProjectState({ initiativeRecordId = null } = {}) {
    const workPackages = await listProjectWorkPackages(
      config.deliveryProjectIdentifier,
      {
        includeAllStatuses: true,
      },
    );
    const workPackagesById = buildWorkPackageMap(workPackages);
    const topLevelEpics = workPackages
      .filter(
        (payload) =>
          !parseWorkPackageIdFromHref(payload?._links?.parent?.href) &&
          workPackageTypeName(payload) === "Epic",
      )
      .sort((left, right) => left.id - right.id);

    const seedInitiativeId = initiativeRecordId ?? topLevelEpics[0]?.id ?? null;
    const fieldMap = await buildDeliveryReadFieldMap({
      initiativeRecordId: seedInitiativeId,
    });

    const nodesById = new Map(
      workPackages.map((payload) => [
        payload.id,
        mapWorkPackageToDeliveryPortfolioNode({
          fieldMap,
          payload,
        }),
      ]),
    );

    const childrenByParentId = new Map();
    for (const payload of workPackages) {
      const parentId = parseWorkPackageIdFromHref(payload?._links?.parent?.href);
      if (!parentId) {
        continue;
      }

      const siblingIds = childrenByParentId.get(parentId) ?? [];
      siblingIds.push(payload.id);
      childrenByParentId.set(parentId, siblingIds);
    }

    const topLevelEpicIdCache = new Map();
    const topLevelEpicIdFor = (recordId) => {
      if (topLevelEpicIdCache.has(recordId)) {
        return topLevelEpicIdCache.get(recordId);
      }

      let currentId = recordId;
      const visited = new Set();
      while (currentId) {
        if (visited.has(currentId)) {
          break;
        }

        visited.add(currentId);
        const payload = workPackagesById.get(currentId);
        if (!payload) {
          currentId = null;
          break;
        }

        const parentId = parseWorkPackageIdFromHref(payload?._links?.parent?.href);
        if (!parentId) {
          currentId = workPackageTypeName(payload) === "Epic" ? payload.id : null;
          break;
        }

        currentId = parentId;
      }

      topLevelEpicIdCache.set(recordId, currentId ?? null);
      return currentId ?? null;
    };

    const relationMap = new Map();
    for (const payload of workPackages) {
      const relations = await listWorkPackageRelations(payload.id);
      for (const relation of relations) {
        if (relation?.id !== undefined && relation?.id !== null) {
          relationMap.set(relation.id, relation);
        }
      }
    }

    const dependencyRelations = [];
    const unresolvedDependencyRelations = [];
    for (const relationPayload of relationMap.values()) {
      const relation = mapRelationPayload(relationPayload);
      if (
        relation.relationType !== "follows" ||
        !relation.fromId ||
        !relation.toId
      ) {
        continue;
      }

      const predecessor = nodesById.get(relation.fromId);
      const target = nodesById.get(relation.toId);
      if (!predecessor || !target) {
        continue;
      }

      predecessor.required_by_work_package_ids.push(target.id);
      target.depends_on_work_package_ids.push(predecessor.id);

      const relationSummary = {
        depends_on: {
          id: predecessor.id,
          record_ref: predecessor.record_ref,
          status: predecessor.status,
          subject: predecessor.subject,
          top_level_epic_id: topLevelEpicIdFor(predecessor.id),
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
          top_level_epic_id: topLevelEpicIdFor(target.id),
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
      node.depends_on_work_package_ids.sort((left, right) => left - right);
      node.required_by_work_package_ids.sort((left, right) => left - right);
      node.unresolved_dependency_work_package_ids.sort((left, right) => left - right);
      node.dependency_blocked = node.unresolved_dependency_work_package_ids.length > 0;
    }

    const buildTree = (recordId) => {
      const node = structuredClone(nodesById.get(recordId));
      const childIds = [...(childrenByParentId.get(recordId) ?? [])].sort((leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        return (
          (left?.type_position ?? 0) - (right?.type_position ?? 0) ||
          leftId - rightId
        );
      });
      node.children = childIds.map((childId) => buildTree(childId));
      delete node.type_position;
      return node;
    };

    return {
      buildTree,
      dependencyRelations,
      fieldMap,
      nodesById,
      topLevelEpics: topLevelEpics.map((payload) => nodesById.get(payload.id)),
      topLevelEpicIdFor,
      unresolvedDependencyRelations,
      workPackagesById,
    };
  }

  function filterDeliveryTree(node, { includeDone = true, includeInactive = false, rootId }) {
    if (node.id !== rootId && !includeDone && node.status.trim().toLowerCase() === "done") {
      return null;
    }

    if (
      node.id !== rootId &&
      !includeInactive &&
      node.status.trim().toLowerCase() === "retired"
    ) {
      return null;
    }

    return {
      ...node,
      children: node.children
        .map((child) =>
          filterDeliveryTree(child, {
            includeDone,
            includeInactive,
            rootId,
          }))
        .filter(Boolean),
    };
  }

  function flattenDeliveryTree(node) {
    return [node, ...node.children.flatMap((child) => flattenDeliveryTree(child))];
  }

  function buildDeliveryInitiativeSummary({
    includeDone = true,
    includeInactive = false,
    initiativeId,
    state,
  }) {
    const epic = state.nodesById.get(initiativeId);
    if (!epic || epic.type !== "Epic") {
      throw new OpenProjectError(
        "not_found",
        `Delivery initiative ${initiativeId} was not found in ${config.deliveryProjectIdentifier}.`,
        404,
        "delivery_not_found",
      );
    }

    const fullTree = state.buildTree(initiativeId);
    const filteredTree = filterDeliveryTree(fullTree, {
      includeDone,
      includeInactive,
      rootId: initiativeId,
    });
    const allNodes = flattenDeliveryTree(fullTree);
    const descendantNodes = allNodes.filter((node) => node.id !== initiativeId);
    const scopedIds = new Set(allNodes.map((node) => node.id));
    const piObjectives = descendantNodes.filter((node) => node.type === "PI Objective");
    const risks = descendantNodes.filter((node) => node.type === "Risk");
    const parkedItems = descendantNodes.filter((node) => node.status === "parked");
    const retiredItems = descendantNodes.filter((node) => node.status === "retired");
    const inactiveItems = descendantNodes.filter((node) => DELIVERY_INACTIVE_STATUSES.has(node.status.toLowerCase()));
    const blockedItems = descendantNodes.filter((node) => node.blocked);
    const readyWithoutContract = descendantNodes.filter(
      (node) =>
        node.status === "ready" &&
        node.ready_contract_applicable &&
        !node.ready_contract_satisfied,
    );
    const completedWithoutEvidence = descendantNodes.filter(
      (node) => node.status === "done" && !node.completion_evidence_present,
    );
    const completedWithWeakEvidence = descendantNodes.filter(
      (node) =>
        node.status === "done" &&
        node.completion_evidence_present &&
        !node.completion_evidence_formatting_valid,
    );
    const completedWithWeakDoneNarrative = descendantNodes.filter(
      (node) =>
        node.status === "done" &&
        node.done_narrative_contract_applicable &&
        !node.done_narrative_contract_satisfied,
    );
    const completedWithoutOwner = descendantNodes.filter(
      (node) =>
        node.status === "done" &&
        (!node.assignee_login || !node.responsible_login || !node.owner_repo),
    );
    const openDescendants = descendantNodes.filter(
      (node) => !DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(node.status.toLowerCase()),
    );
    const dependencyRelations = state.dependencyRelations.filter(
      (relation) =>
        scopedIds.has(relation.depends_on.id) || scopedIds.has(relation.target.id),
    );
    const internalDependencyRelations = dependencyRelations.filter(
      (relation) =>
        scopedIds.has(relation.depends_on.id) && scopedIds.has(relation.target.id),
    );
    const externalDependencyRelations = dependencyRelations.filter(
      (relation) =>
        !scopedIds.has(relation.depends_on.id) || !scopedIds.has(relation.target.id),
    );
    const unresolvedDependencyRelations = dependencyRelations.filter(
      (relation) => relation.unresolved,
    );

    const initiativeReview = evaluateDeliveryInitiativeReviewState({
      epic: {
        inspect_and_adapt_actions_present: epic.inspect_and_adapt_actions_present,
        pm2_phase: epic.pm2_phase,
        status: epic.status,
        system_demo_evidence_present: epic.system_demo_evidence_present,
      },
      summary: {
        blocked_count: blockedItems.length,
        completed_with_weak_evidence_count: completedWithWeakEvidence.length,
        completed_with_weak_done_narrative_count:
          completedWithWeakDoneNarrative.length,
        completed_without_evidence_count: completedWithoutEvidence.length,
        completed_without_owner_count: completedWithoutOwner.length,
        open_descendant_count: openDescendants.length,
        unresolved_dependency_count: unresolvedDependencyRelations.length,
      },
    });

    return {
      blocked_items: blockedItems.map((node) => ({ ...node, children: [] })),
      closeout_ready: initiativeReview.completion_transition_ready,
      closeout_reasons: initiativeReview.completion_transition_reasons,
      closing_ready: initiativeReview.closing_transition_ready,
      closing_reasons: initiativeReview.closing_transition_reasons,
      completed_with_weak_evidence: completedWithWeakEvidence.map((node) => ({
        ...node,
        children: [],
      })),
      completed_with_weak_done_narrative: completedWithWeakDoneNarrative.map(
        (node) => ({
          ...node,
          children: [],
        }),
      ),
      completed_without_evidence: completedWithoutEvidence.map((node) => ({
        ...node,
        children: [],
      })),
      completed_without_owner: completedWithoutOwner.map((node) => ({
        ...node,
        children: [],
      })),
      dependency_relations: dependencyRelations,
      dependency_summary: {
        cross_initiative_relations: externalDependencyRelations.length,
        internal_relations: internalDependencyRelations.length,
        unresolved_relations: unresolvedDependencyRelations.length,
      },
      epic: {
        ...epic,
        children: [],
      },
      execution_tree: filteredTree,
      inactive_items: inactiveItems.map((node) => ({ ...node, children: [] })),
      initiative_review: initiativeReview,
      open_descendants: openDescendants.map((node) => ({ ...node, children: [] })),
      parked_items: parkedItems.map((node) => ({ ...node, children: [] })),
      pi_objectives: piObjectives.map((node) => ({ ...node, children: [] })),
      ready_without_contract: readyWithoutContract.map((node) => ({
        ...node,
        children: [],
      })),
      retirement_ready: initiativeReview.retirement_transition_ready,
      retirement_reasons: initiativeReview.retirement_transition_reasons,
      retired_items: retiredItems.map((node) => ({ ...node, children: [] })),
      risks: risks.map((node) => ({ ...node, children: [] })),
      summary: {
        blocked_count: blockedItems.length,
        by_assignee: countNodesBy(descendantNodes, "assignee_login"),
        by_delivery_team: countNodesBy(descendantNodes, "delivery_team"),
        by_iteration: countNodesBy(descendantNodes, "iteration"),
        by_owner_repo: countNodesBy(descendantNodes, "owner_repo"),
        by_responsible: countNodesBy(descendantNodes, "responsible_login"),
        by_roam_state: countNodesBy(risks, "roam_state"),
        by_status: countNodesBy(descendantNodes, "status"),
        by_target_pi: countNodesBy(descendantNodes, "target_pi"),
        by_type: countNodesBy(descendantNodes, "type"),
        completed_with_weak_evidence_count: completedWithWeakEvidence.length,
        completed_with_weak_done_narrative_count:
          completedWithWeakDoneNarrative.length,
        completed_without_evidence_count: completedWithoutEvidence.length,
        completed_without_owner_count: completedWithoutOwner.length,
        cross_initiative_dependency_count: externalDependencyRelations.length,
        dependency_blocked_count: descendantNodes.filter(
          (node) => node.dependency_blocked,
        ).length,
        dependency_count: dependencyRelations.length,
        estimated_work_total: descendantNodes
          .reduce(
            (total, node) => total + Number.parseFloat(node.estimated_work ?? 0),
            0,
          )
          .toFixed(2)
          .replace(/\.00$/, ""),
        include_done: includeDone,
        include_inactive: includeInactive,
        inactive_count: inactiveItems.length,
        open_descendant_count: openDescendants.length,
        parked_count: parkedItems.length,
        pi_objective_count: piObjectives.length,
        pi_objectives_by_review_outcome: countNodesBy(
          piObjectives,
          "pi_objective_review_outcome",
        ),
        pi_objectives_by_type: countNodesBy(piObjectives, "pi_objective_type"),
        planned_business_value_total: piObjectives.reduce(
          (total, node) => total + Number.parseInt(node.planned_business_value ?? 0, 10),
          0,
        ),
        actual_business_value_total: piObjectives.reduce(
          (total, node) => total + Number.parseInt(node.actual_business_value ?? 0, 10),
          0,
        ),
        ready_without_contract_count: readyWithoutContract.length,
        remaining_work_total: descendantNodes
          .reduce(
            (total, node) => total + Number.parseFloat(node.remaining_work ?? 0),
            0,
          )
          .toFixed(2)
          .replace(/\.00$/, ""),
        retired_count: retiredItems.length,
        risk_count: risks.length,
        total_items: descendantNodes.length,
        unresolved_dependency_count: unresolvedDependencyRelations.length,
      },
      unresolved_dependency_relations: unresolvedDependencyRelations,
    };
  }

  function buildPlanningSummary({ initiativeSummary }) {
    const planningItems = flattenDeliveryTree(initiativeSummary.execution_tree)
      .filter((node) => node.id !== initiativeSummary.epic.id);

    const roundAverage = (items, key) => {
      const values = items
        .map((item) => item[key])
        .filter((value) => value !== null && value !== undefined)
        .map((value) => Number.parseFloat(value));
      if (values.length === 0) {
        return null;
      }

      return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
    };

    const sumMetric = (items, key) =>
      Math.round(
        items.reduce((total, item) => total + Number.parseFloat(item[key] ?? 0), 0) * 100,
      ) / 100;

    const compactPlanningItems = planningItems.map((item) => ({
      assignee_login: item.assignee_login,
      estimated_work: item.estimated_work,
      id: item.id,
      owner_repo: item.owner_repo,
      percent_complete: item.percent_complete,
      record_ref: item.record_ref,
      remaining_work: item.remaining_work,
      responsible_login: item.responsible_login,
      status: item.status,
      subject: item.subject,
      target_pi: item.target_pi,
      type: item.type,
    }));

    const groupSummary = (items) => ({
      average_percent_complete: roundAverage(items, "percent_complete"),
      by_owner_repo: countNodesBy(items, "owner_repo"),
      by_status: countNodesBy(items, "status"),
      by_target_pi: countNodesBy(items, "target_pi"),
      by_type: countNodesBy(items, "type"),
      count: items.length,
      estimated_work_total: sumMetric(items, "estimated_work"),
      items: items.map((item) => ({
        assignee_login: item.assignee_login,
        estimated_work: item.estimated_work,
        id: item.id,
        owner_repo: item.owner_repo,
        percent_complete: item.percent_complete,
        record_ref: item.record_ref,
        remaining_work: item.remaining_work,
        responsible_login: item.responsible_login,
        status: item.status,
        subject: item.subject,
        target_pi: item.target_pi,
        type: item.type,
      })),
      ready_without_contract_count: items.filter(
        (item) =>
          item.status === "ready" &&
          item.ready_contract_applicable &&
          !item.ready_contract_satisfied,
      ).length,
      remaining_work_total: sumMetric(items, "remaining_work"),
    });

    const byDeliveryTeam = Object.fromEntries(
      [...planningItems.reduce((result, item) => {
        const key = item.delivery_team || "_none_";
        const items = result.get(key) ?? [];
        items.push(item);
        result.set(key, items);
        return result;
      }, new Map()).entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([key, items]) => [key, groupSummary(items)]),
    );

    const byIteration = Object.fromEntries(
      [...planningItems.reduce((result, item) => {
        const key = item.iteration || "_none_";
        const items = result.get(key) ?? [];
        items.push(item);
        result.set(key, items);
        return result;
      }, new Map()).entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([key, items]) => [key, groupSummary(items)]),
    );

    const teamIterationMatrix = [...planningItems.reduce((result, item) => {
      const key = `${item.delivery_team || "_none_"}::${item.iteration || "_none_"}`;
      const items = result.get(key) ?? [];
      items.push(item);
      result.set(key, items);
      return result;
    }, new Map()).entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, items]) => {
        const [deliveryTeam, iteration] = key.split("::");
        return {
          delivery_team: deliveryTeam,
          iteration,
          ...groupSummary(items),
        };
      });

    return {
      by_delivery_team: byDeliveryTeam,
      by_iteration: byIteration,
      epic: {
        id: initiativeSummary.epic.id,
        record_ref: initiativeSummary.epic.record_ref,
        status: initiativeSummary.epic.status,
        subject: initiativeSummary.epic.subject,
        target_pi: initiativeSummary.epic.target_pi,
      },
      summary: {
        average_percent_complete: roundAverage(planningItems, "percent_complete"),
        by_assignee: countNodesBy(planningItems, "assignee_login"),
        by_status: countNodesBy(planningItems, "status"),
        by_target_pi: countNodesBy(planningItems, "target_pi"),
        by_type: countNodesBy(planningItems, "type"),
        estimated_work_total: sumMetric(planningItems, "estimated_work"),
        include_done: initiativeSummary.summary.include_done,
        include_inactive: initiativeSummary.summary.include_inactive,
        ready_without_contract_count: initiativeSummary.summary.ready_without_contract_count,
        remaining_work_total: sumMetric(planningItems, "remaining_work"),
        total_items: planningItems.length,
      },
      team_iteration_matrix: teamIterationMatrix,
      work_items: compactPlanningItems,
    };
  }

  function buildStaleOpenCandidates({ executionTree, initiativeId }) {
    const candidates = [];

    const visit = (node) => {
      for (const child of node.children ?? []) {
        visit(child);
      }

      if (node.id === initiativeId) {
        return;
      }

      const childNodes = node.children ?? [];
      if (childNodes.length === 0) {
        return;
      }

      if (DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(node.status.toLowerCase())) {
        return;
      }

      const openChildren = childNodes.filter(
        (child) => !DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(child.status.toLowerCase()),
      );
      if (openChildren.length > 0) {
        return;
      }

      const completedChildren = childNodes.filter(
        (child) => child.status.toLowerCase() === "done",
      );
      const retiredChildren = childNodes.filter(
        (child) => child.status.toLowerCase() === "retired",
      );

      candidates.push({
        child_status_summary: countNodesBy(childNodes, "status"),
        completed_child_count: completedChildren.length,
        item: compactContinuationNode(node),
        reason: "children_terminal_but_parent_open",
        retired_child_count: retiredChildren.length,
      });
    };

    visit(executionTree);
    return candidates;
  }

  function compactQualityPackNode(node) {
    const compact = {
      ...node,
      children: [],
    };
    delete compact.type_position;
    return compact;
  }

  function buildDeliveryProjectQualityPack({ state }) {
    const workPackages = [...state.nodesById.values()]
      .map((node) => compactQualityPackNode(node))
      .sort((left, right) => left.id - right.id);
    const topLevelEpics = workPackages.filter(
      (node) => node.parent_id === null && node.type === "Epic",
    );
    const roadmapProjectionDrift = [];
    const pm2ProjectionDrift = [];

    for (const node of workPackages) {
      if (node.target_pi && node.version_name !== node.target_pi) {
        roadmapProjectionDrift.push({
          detail: `Target PI ${node.target_pi} must project to matching roadmap version.`,
          issue_type: "target_pi_version_drift",
          item: compactContinuationNode(node),
          target_pi: node.target_pi,
          version_name: node.version_name ?? null,
        });
      } else if (
        !node.target_pi &&
        node.version_name !== DELIVERY_ROADMAP_UNASSIGNED_VERSION_NAME
      ) {
        roadmapProjectionDrift.push({
          detail:
            "Work without canonical Target PI must stay in the derived unassigned roadmap bucket.",
          issue_type: node.version_name
            ? "version_without_target_pi"
            : "roadmap_unassigned_bucket_missing",
          item: compactContinuationNode(node),
          target_pi: null,
          version_name: node.version_name ?? null,
        });
      }

      if (node.type !== "Epic") {
        continue;
      }

      if (
        !node.pm2_phase &&
        !["new", "parked", DELIVERY_RETIRED_STATUS].includes(
          node.status.toLowerCase(),
        )
      ) {
        pm2ProjectionDrift.push({
          detail: "Active initiative is missing PM² Phase.",
          issue_type: "initiative_missing_pm2_phase",
          item: compactContinuationNode(node),
        });
      }

      if (
        node.status.toLowerCase() === "done" &&
        node.pm2_phase !== DELIVERY_PM2_CLOSING_PHASE
      ) {
        pm2ProjectionDrift.push({
          detail: "Done initiative must remain in PM² Closing.",
          issue_type: "done_initiative_not_in_closing_phase",
          item: compactContinuationNode(node),
        });
      }

      if (
        node.status.toLowerCase() === DELIVERY_RETIRED_STATUS &&
        node.pm2_phase
      ) {
        pm2ProjectionDrift.push({
          detail: "Retired initiative must not retain a PM² Phase value.",
          issue_type: "retired_initiative_retains_pm2_phase",
          item: compactContinuationNode(node),
        });
      }
    }

    return {
      compatible_views: {
        pm2_phase_board: {
          phase_field: "PM² Phase",
          retired_status: DELIVERY_RETIRED_STATUS,
          truthful: pm2ProjectionDrift.length === 0,
        },
        roadmap: {
          canonical_field: "Target PI",
          projected_field: "version",
          truthful: roadmapProjectionDrift.length === 0,
          unassigned_bucket: DELIVERY_ROADMAP_UNASSIGNED_VERSION_NAME,
        },
      },
      project: {
        identifier: config.deliveryProjectIdentifier,
      },
      projection_health: {
        pm2_phase: {
          drift: pm2ProjectionDrift,
          healthy: pm2ProjectionDrift.length === 0,
        },
        roadmap: {
          drift: roadmapProjectionDrift,
          healthy: roadmapProjectionDrift.length === 0,
          unassigned_bucket: DELIVERY_ROADMAP_UNASSIGNED_VERSION_NAME,
        },
      },
      summary: {
        by_pm2_phase: countNodesBy(topLevelEpics, "pm2_phase"),
        by_status: countNodesBy(workPackages, "status"),
        by_target_pi: countNodesBy(workPackages, "target_pi"),
        by_type: countNodesBy(workPackages, "type"),
        by_version_name: countNodesBy(workPackages, "version_name"),
        pm2_projection_drift_count: pm2ProjectionDrift.length,
        roadmap_projection_drift_count: roadmapProjectionDrift.length,
        top_level_epic_count: topLevelEpics.length,
        work_package_count: workPackages.length,
      },
      work_packages: workPackages,
    };
  }

  function compactContinuationNode(node) {
    return {
      assignee_login: node.assignee_login,
      blocked: node.blocked,
      dependency_blocked: node.dependency_blocked,
      delivery_team: node.delivery_team,
      id: node.id,
      iteration: node.iteration,
      owner_repo: node.owner_repo,
      parent_id: node.parent_id ?? null,
      percent_complete: node.percent_complete,
      record_ref: node.record_ref,
      responsible_login: node.responsible_login,
      status: node.status,
      subject: node.subject,
      target_pi: node.target_pi,
      type: node.type,
      updated_at: node.updated_at,
    };
  }

  function buildContinuationLinkSet({ ids, nodesById }) {
    return ids
      .map((id) => nodesById.get(id))
      .filter(Boolean)
      .map((node) => compactContinuationNode(node));
  }

  function buildDeliveryContinuationContext({
    initiativeSummary,
    recordId,
    state,
  }) {
    const fullTree = state.buildTree(initiativeSummary.epic.id);
    const nodesById = new Map(
      flattenDeliveryTree(fullTree).map((node) => [node.id, node]),
    );
    const targetNode = nodesById.get(recordId);
    if (!targetNode) {
      throw new OpenProjectError(
        "not_found",
        `Delivery work item ${recordId} was not found in initiative ${initiativeSummary.epic.id}.`,
        404,
        "delivery_work_item_not_found",
      );
    }

    const parentChain = [];
    let currentParentId = targetNode.parent_id;
    while (currentParentId) {
      const parentNode = nodesById.get(currentParentId);
      if (!parentNode) {
        break;
      }
      parentChain.unshift(compactContinuationNode(parentNode));
      currentParentId = parentNode.parent_id;
    }

    const parentNode = targetNode.parent_id
      ? nodesById.get(targetNode.parent_id) ?? null
      : null;
    const siblingNodes = parentNode
      ? parentNode.children.filter((child) => child.id !== targetNode.id)
      : [];
    const openSiblingNodes = siblingNodes.filter(
      (node) => !DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(node.status.toLowerCase()),
    );
    const completedSiblingNodes = siblingNodes.filter(
      (node) => node.status.toLowerCase() === "done",
    );
    const openChildNodes = targetNode.children.filter(
      (node) => !DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(node.status.toLowerCase()),
    );
    const completedChildNodes = targetNode.children.filter(
      (node) => node.status.toLowerCase() === "done",
    );

    const previouslyCompletedRelatedItems = [
      ...completedSiblingNodes.map((node) => ({
        item: compactContinuationNode(node),
        relation: "completed_sibling",
      })),
      ...completedChildNodes.map((node) => ({
        item: compactContinuationNode(node),
        relation: "completed_child",
      })),
    ];

    return {
      delivery_epic: compactContinuationNode(initiativeSummary.epic),
      dependency_context: {
        depends_on: buildContinuationLinkSet({
          ids: targetNode.depends_on_work_package_ids,
          nodesById,
        }),
        required_by: buildContinuationLinkSet({
          ids: targetNode.required_by_work_package_ids,
          nodesById,
        }),
        unresolved_dependencies: buildContinuationLinkSet({
          ids: targetNode.unresolved_dependency_work_package_ids,
          nodesById,
        }),
      },
      initiative_active_items: initiativeSummary.open_descendants
        .filter((node) => node.status.toLowerCase() === "in-progress")
        .map((node) => compactContinuationNode(node)),
      initiative_next_ready_items: initiativeSummary.open_descendants
        .filter((node) => node.status.toLowerCase() === "ready")
        .map((node) => compactContinuationNode(node)),
      open_child_items: openChildNodes.map((node) => compactContinuationNode(node)),
      open_siblings: openSiblingNodes.map((node) => compactContinuationNode(node)),
      parent_chain: parentChain,
      previously_completed_related_items: previouslyCompletedRelatedItems,
      summary: {
        active_item_count: initiativeSummary.open_descendants.filter(
          (node) => node.status.toLowerCase() === "in-progress",
        ).length,
        completed_related_count: previouslyCompletedRelatedItems.length,
        open_child_count: openChildNodes.length,
        open_sibling_count: openSiblingNodes.length,
        ready_next_count: initiativeSummary.open_descendants.filter(
          (node) => node.status.toLowerCase() === "ready",
        ).length,
      },
      target_item: compactContinuationNode(targetNode),
    };
  }

  function buildMultipartFormData({ fields, fileField }) {
    const boundary = `----oos-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    const buffers = [];

    const appendTextField = (name, value) => {
      buffers.push(Buffer.from(`--${boundary}\r\n`));
      buffers.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        ),
      );
    };

    const appendFileField = ({ contentType, content, filename, name }) => {
      buffers.push(Buffer.from(`--${boundary}\r\n`));
      buffers.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`,
        ),
      );
      buffers.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
      buffers.push(content);
      buffers.push(Buffer.from("\r\n"));
    };

    for (const [name, value] of Object.entries(fields)) {
      appendTextField(name, value);
    }

    appendFileField(fileField);
    buffers.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      body: Buffer.concat(buffers),
      boundary,
    };
  }

  async function deleteAttachment(attachmentId) {
    let response;

    try {
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/attachments/${attachmentId}`),
        {
          headers: requestHeaders(),
          method: "DELETE",
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

    if (!response.ok && response.status !== 204) {
      throw mapOpenProjectError(response.status, await readJson(response));
    }
  }

  async function createWorkPackageAttachment({
    attachmentContentBase64,
    attachmentContentType,
    attachmentDescription,
    attachmentFileName,
    recordId,
  }) {
    const fileBuffer = Buffer.from(attachmentContentBase64, "base64");
    const metadata = {
      description: attachmentDescription
        ? {
            format: "markdown",
            raw: attachmentDescription,
          }
        : null,
      fileName: attachmentFileName,
    };
    const multipart = buildMultipartFormData({
      fields: {
        metadata: JSON.stringify(metadata),
      },
      fileField: {
        content: fileBuffer,
        contentType: attachmentContentType || "application/octet-stream",
        filename: attachmentFileName,
        name: "file",
      },
    });
    let response;

    try {
      response = await executeRequest(
        joinUrl(config.baseUrl, `/api/v3/work_packages/${recordId}/attachments`),
        {
          body: multipart.body,
          headers: {
            ...requestHeaders(),
            "Content-Type": `multipart/form-data; boundary=${multipart.boundary}`,
          },
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
      contentType:
        normalizeStringValue(
          responsePayload?.contentType ??
            responsePayload?.content_type ??
            null,
        ) ?? attachmentContentType ?? "application/octet-stream",
      description:
        normalizeStringValue(
          responsePayload?.description?.raw ??
            responsePayload?.description ??
            null,
        ) ?? attachmentDescription ?? null,
      filename:
        normalizeStringValue(
          responsePayload?.fileName ??
            responsePayload?.file_name ??
            responsePayload?.name ??
            null,
        ) ?? attachmentFileName,
      filesize:
        typeof responsePayload?.fileSize === "number"
          ? responsePayload.fileSize
          : fileBuffer.length,
      id: responsePayload?.id ?? null,
    };
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
            await resolveCustomOptionLink({
              baseUrl: config.baseUrl,
              executeRequest: executeRequestWithRetry,
              fieldId: config.customFieldTrustBoundaryAreasId,
              formPayload: currentForm,
              requestHeaders,
              multiValue: true,
              value: mergedEvaluation.trustBoundaryAreas,
            }),
          [`customField${config.customFieldTriageConfidenceId}`]:
            await resolveCustomOptionLink({
              baseUrl: config.baseUrl,
              executeRequest: executeRequestWithRetry,
              fieldId: config.customFieldTriageConfidenceId,
              formPayload: currentForm,
              requestHeaders,
              value: mergedEvaluation.confidence,
            }),
          [`customField${config.customFieldAiAssistLaneId}`]:
            await resolveCustomOptionLink({
              baseUrl: config.baseUrl,
              executeRequest: executeRequestWithRetry,
              fieldId: config.customFieldAiAssistLaneId,
              formPayload: currentForm,
              requestHeaders,
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

    async createDeliveryRecordFromIdea({
      currentRecord,
      ownerRepo = null,
      targetPi = null,
    }) {
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

      const fieldMap = buildDeliveryInitiativeFieldEntryMap(createForm);

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
            await resolveCustomOptionLink({
              baseUrl: config.baseUrl,
              executeRequest: executeRequestWithRetry,
              fieldId: config.deliveryCustomFieldPm2PhaseId,
              formPayload: createForm,
              requestHeaders,
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

      if (typeof ownerRepo === "string" && ownerRepo.trim()) {
        const ownerRepoEntry = fieldMap.get("Owner Repo");
        if (!ownerRepoEntry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package form is missing custom field Owner Repo.",
            502,
            "missing_initiative_field",
          );
        }
        if (!ownerRepoEntry.writable) {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package form marks Owner Repo as non-writable.",
            502,
            "non_writable_custom_field",
          );
        }
        setCustomFieldPayloadValue(
          payload,
          ownerRepoEntry,
          normalizePlanCustomValue({
            field: ownerRepoEntry,
            kind: "string",
            rawValue: ownerRepo.trim(),
          }),
        );
      }

      const responsePayload = await createProjectWorkPackagePayload(
        config.deliveryProjectIdentifier,
        payload,
      );

      return mapWorkPackageToDeliveryRecord(config, responsePayload);
    },

    async consumeAcceptedIdea({
      currentRecord,
      recordId,
      ownerRepo = null,
      targetPi = null,
    }) {
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
          ownerRepo,
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

    async updateDeliveryInitiative({
      assigneeLogin,
      businessObjective,
      description,
      inspectAndAdaptActions,
      nfrCategory,
      ownerRepo,
      pm2Phase,
      recordId,
      responsibleLogin,
      sponsor,
      status,
      successCriteria,
      systemDemoEvidence,
      targetPi,
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

      if (workPackageTypeName(currentPayload) !== "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Delivery initiative governance updates must target the top-level delivery Epic.",
          422,
          "update_initiative_required",
        );
      }

      const formPayload = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const fieldMap = buildDeliveryInitiativeFieldEntryMap(formPayload);
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};
      const currentDescription = currentPayload?.description?.raw ?? "";
      const currentAssigneeLogin = workPackageAssigneeLogin(currentPayload);
      const currentResponsibleLogin = workPackageResponsibleLogin(currentPayload);
      const currentStatus = workPackageStatusName(currentPayload);
      const currentPm2Phase = normalizeStringValue(
        readDeliveryFieldValue(currentPayload, fieldMap, "PM² Phase"),
      );
      const currentSystemDemoEvidence = normalizeStringValue(
        readDeliveryFieldValue(currentPayload, fieldMap, "System Demo Evidence"),
      );
      const currentInspectAndAdaptActions = normalizeStringValue(
        readDeliveryFieldValue(currentPayload, fieldMap, "Inspect & Adapt Actions"),
      );

      if (typeof status === "string" && status.trim()) {
        const resolvedStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
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

      if (description !== undefined) {
        const desiredDescription = description === null ? "" : normalizeStringValue(description);
        if (desiredDescription !== currentDescription) {
          patchPayload.description = {
            format: "markdown",
            raw: desiredDescription,
          };
          changesApplied.description = {
            from_present: currentDescription.trim().length > 0,
            to_present: desiredDescription.trim().length > 0,
          };
        }
      }

      if (assigneeLogin !== undefined) {
        const desiredAssigneeLogin =
          assigneeLogin === null ? null : normalizeStringValue(assigneeLogin);
        if (currentAssigneeLogin !== desiredAssigneeLogin) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.assignee = desiredAssigneeLogin
            ? await resolveAllowedValueLink({
                baseUrl: config.baseUrl,
                executeRequest: executeRequestWithRetry,
                fieldNames: ["assignee", "assignedTo"],
                fieldLabel: "assignee",
                formPayload,
                requestHeaders,
                value: desiredAssigneeLogin,
              })
            : { href: null, title: null };
          changesApplied.assignee_login = {
            from: currentAssigneeLogin,
            to: desiredAssigneeLogin,
          };
        }
      }

      if (responsibleLogin !== undefined) {
        const desiredResponsibleLogin =
          responsibleLogin === null ? null : normalizeStringValue(responsibleLogin);
        if (currentResponsibleLogin !== desiredResponsibleLogin) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.responsible = desiredResponsibleLogin
            ? await resolveAllowedValueLink({
                baseUrl: config.baseUrl,
                executeRequest: executeRequestWithRetry,
                fieldNames: ["responsible"],
                fieldLabel: "responsible",
                formPayload,
                requestHeaders,
                value: desiredResponsibleLogin,
              })
            : { href: null, title: null };
          changesApplied.responsible_login = {
            from: currentResponsibleLogin,
            to: desiredResponsibleLogin,
          };
        }
      }

      if (targetPi !== undefined) {
        const desiredTargetPi =
          targetPi === null ? null : normalizeStringValue(targetPi);
        const currentTargetPi = normalizeStringValue(
          readCustomField(currentPayload, config.deliveryCustomFieldTargetPiId),
        );
        if (currentTargetPi !== desiredTargetPi) {
          patchPayload[`customField${config.deliveryCustomFieldTargetPiId}`] =
            desiredTargetPi;
          changesApplied.target_pi = {
            from: currentTargetPi,
            to: desiredTargetPi,
          };
        }
      }

      const applyField = async (spec, rawValue) => {
        if (rawValue === undefined) {
          return;
        }

        const entry = fieldMap.get(spec.fieldName);
        if (!entry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject work package form is missing custom field ${spec.fieldName}.`,
            502,
            "missing_initiative_field",
          );
        }
        if (!entry.writable) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject work package form marks ${spec.fieldName} as non-writable.`,
            502,
            "non_writable_custom_field",
          );
        }

        if (spec.kind === "list") {
          const desiredValue = normalizeStringValue(rawValue);
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(currentPayload, entry),
          );
          if (currentValue === desiredValue) {
            return;
          }

          setCustomFieldPayloadValue(
            patchPayload,
            entry,
            desiredValue
              ? await resolveCustomOptionLink({
                  baseUrl: config.baseUrl,
                  executeRequest: executeRequestWithRetry,
                  fieldId: entry.fieldId,
                  formPayload,
                  requestHeaders,
                  value: desiredValue,
                })
              : entry.location === "_links"
                ? { href: null, title: null }
                : null,
          );
          changesApplied[spec.inputName] = {
            from: currentValue,
            to: desiredValue,
          };
          return;
        }

        const desiredValue = normalizePlanCustomValue({
          field: entry,
          kind: spec.kind,
          rawValue,
        });
        const currentValue = readCustomFieldValueFromSchemaEntry(currentPayload, entry);
        const normalizedCurrentValue =
          currentValue === null || currentValue === undefined
            ? null
            : typeof currentValue === "string"
              ? currentValue
              : JSON.stringify(currentValue);
        const normalizedDesiredValue =
          desiredValue === null || desiredValue === undefined
            ? null
            : typeof desiredValue === "string"
              ? desiredValue
              : JSON.stringify(desiredValue);

        if (normalizedCurrentValue === normalizedDesiredValue) {
          return;
        }

        setCustomFieldPayloadValue(patchPayload, entry, desiredValue);
        changesApplied[spec.inputName] = {
          from: currentValue,
          to: desiredValue,
        };
      };

      const desiredStatus = normalizeStringValue(status) ?? currentStatus;
      const desiredStatusNormalized = desiredStatus?.toLowerCase?.() ?? null;
      const requestedPm2Phase =
        pm2Phase === undefined ? undefined : normalizeStringValue(pm2Phase);
      if (
        desiredStatusNormalized === DELIVERY_RETIRED_STATUS &&
        requestedPm2Phase !== undefined &&
        requestedPm2Phase !== null
      ) {
        throw new OpenProjectError(
          "validation_failure",
          "pm2_phase must be omitted or null when initiative status moves to retired.",
          422,
          "initiative_retired_phase_must_clear",
        );
      }

      const effectivePm2PhaseInput =
        desiredStatusNormalized === DELIVERY_RETIRED_STATUS ? null : pm2Phase;

      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[0], effectivePm2PhaseInput);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[1], sponsor);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[2], businessObjective);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[3], successCriteria);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[4], systemDemoEvidence);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[5], inspectAndAdaptActions);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[6], nfrCategory);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[7], ownerRepo);

      const desiredPm2Phase =
        desiredStatusNormalized === DELIVERY_RETIRED_STATUS
          ? null
          : effectivePm2PhaseInput === undefined
            ? currentPm2Phase
            : normalizeStringValue(effectivePm2PhaseInput);
      const desiredSystemDemoEvidence =
        systemDemoEvidence === undefined
          ? currentSystemDemoEvidence
          : normalizeStringValue(systemDemoEvidence);
      const desiredInspectAndAdaptActions =
        inspectAndAdaptActions === undefined
          ? currentInspectAndAdaptActions
          : normalizeStringValue(inspectAndAdaptActions);

      if (
        desiredStatusNormalized === "done" ||
        desiredStatusNormalized === DELIVERY_RETIRED_STATUS ||
        desiredPm2Phase === DELIVERY_PM2_CLOSING_PHASE
      ) {
        const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
        const initiativeSummary = buildDeliveryInitiativeSummary({
          includeDone: true,
          includeInactive: true,
          initiativeId: recordId,
          state,
        });
        const effectiveInitiativeReview = evaluateDeliveryInitiativeReviewState({
          epic: {
            inspect_and_adapt_actions_present: Boolean(desiredInspectAndAdaptActions),
            pm2_phase:
              desiredStatusNormalized === DELIVERY_RETIRED_STATUS
                ? null
                : desiredPm2Phase ?? initiativeSummary.epic.pm2_phase,
            status: desiredStatusNormalized ?? initiativeSummary.epic.status,
            system_demo_evidence_present: Boolean(desiredSystemDemoEvidence),
          },
          summary: initiativeSummary.summary,
        });

        if (desiredStatusNormalized === "done") {
          if (!effectiveInitiativeReview.completion_transition_ready) {
            throw new OpenProjectError(
              "validation_failure",
              `Initiative cannot move to done until PM² closing review is complete: ${describeDeliveryInitiativeReviewReasons(effectiveInitiativeReview.completion_transition_reasons).join("; ")}`,
              422,
              "initiative_done_transition_blocked",
            );
          }
        } else if (desiredStatusNormalized === DELIVERY_RETIRED_STATUS) {
          if (!effectiveInitiativeReview.retirement_transition_ready) {
            throw new OpenProjectError(
              "validation_failure",
              `Initiative cannot move to retired until all descendants are already done or retired: ${describeDeliveryInitiativeReviewReasons(effectiveInitiativeReview.retirement_transition_reasons).join("; ")}`,
              422,
              "initiative_retired_transition_blocked",
            );
          }
        } else if (desiredPm2Phase === DELIVERY_PM2_CLOSING_PHASE) {
          if (!effectiveInitiativeReview.closing_transition_ready) {
            throw new OpenProjectError(
              "validation_failure",
              `Initiative cannot enter PM² Closing until initiative review entry conditions are met: ${describeDeliveryInitiativeReviewReasons(effectiveInitiativeReview.closing_transition_reasons).join("; ")}`,
              422,
              "initiative_closing_transition_blocked",
            );
          }
        }
      }

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        changesApplied,
        deliveryInitiative: mapWorkPackageToDeliveryInitiative(
          config,
          updatedPayload,
          fieldMap,
        ),
        deliveryRecordId: updatedPayload.id,
        deliveryRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async applyDeliveryPlan({
      plan,
      recordId,
      reconcileDecision = "retire",
      reconcileMissing = "ignore",
      reconcileReason = "Removed by delivery plan reconciliation",
      reconcileRetirementReason = "superseded",
      reconcileReviewDate = null,
    }) {
      const rootPayload = await getWorkPackagePayload(recordId);
      if (typeof rootPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion.",
          502,
          "missing_lock_version",
        );
      }

      if (workPackageTypeName(rootPayload) !== "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Delivery plan application must target the top-level delivery Epic.",
          422,
          "plan_apply_requires_initiative",
        );
      }

      if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
        throw new OpenProjectError(
          "validation_failure",
          "plan must be an object with schema_version=1 and an items array.",
          422,
          "invalid_delivery_plan",
        );
      }

      if (plan.schema_version !== 1 || !Array.isArray(plan.items)) {
        throw new OpenProjectError(
          "validation_failure",
          "plan must be an object with schema_version=1 and an items array.",
          422,
          "invalid_delivery_plan",
        );
      }

      if (
        plan.epic_updates !== undefined &&
        (!plan.epic_updates || typeof plan.epic_updates !== "object" || Array.isArray(plan.epic_updates))
      ) {
        throw new OpenProjectError(
          "validation_failure",
          "plan.epic_updates must be an object when provided.",
          422,
          "invalid_delivery_plan",
        );
      }

      if (!["ignore", "park"].includes(reconcileMissing)) {
        throw new OpenProjectError(
          "validation_failure",
          "reconcile_missing must be ignore or park.",
          422,
          "invalid_reconcile_missing",
        );
      }

      if (!["retire", "defer"].includes(reconcileDecision)) {
        throw new OpenProjectError(
          "validation_failure",
          "reconcile_decision must be retire or defer.",
          422,
          "invalid_reconcile_decision",
        );
      }

      const normalizedReconcileReason =
        normalizeStringValue(reconcileReason) ??
        "Removed by delivery plan reconciliation";
      const normalizedRetirementReason = normalizeStringValue(reconcileRetirementReason);
      const normalizedReviewDate = parseIsoDateString(
        reconcileReviewDate,
        "reconcile_review_date",
      );

      if (reconcileMissing === "park" && reconcileDecision === "defer" && !normalizedReviewDate) {
        throw new OpenProjectError(
          "validation_failure",
          "reconcile_review_date is required when reconcile_decision=defer.",
          422,
          "missing_reconcile_review_date",
        );
      }

      if (reconcileMissing === "park" && reconcileDecision === "retire" && normalizedReviewDate) {
        throw new OpenProjectError(
          "validation_failure",
          "reconcile_review_date must not be provided when reconcile_decision=retire.",
          422,
          "unexpected_reconcile_review_date",
        );
      }

      if (reconcileMissing === "park" && reconcileDecision === "retire" && !normalizedRetirementReason) {
        throw new OpenProjectError(
          "validation_failure",
          "reconcile_retirement_reason is required when reconcile_decision=retire.",
          422,
          "missing_reconcile_retirement_reason",
        );
      }

      const validateItemShape = (item, path) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new OpenProjectError(
            "validation_failure",
            `${path} must be an object.`,
            422,
            "invalid_plan_item",
          );
        }

        const supportedKeys = new Set([
          "type",
          "subject",
          "status",
          "description",
          "target_pi",
          "start_date",
          "due_date",
          "estimated_work",
          "remaining_work",
          "percent_complete",
          "children",
          ...DELIVERY_CREATE_CUSTOM_FIELD_SPECS.map((spec) => spec.inputName),
        ]);
        const unknownKeys = Object.keys(item).filter((key) => !supportedKeys.has(key));
        if (unknownKeys.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `${path} contains unsupported keys: ${unknownKeys.join(", ")}.`,
            422,
            "invalid_plan_item",
          );
        }

        if (typeof item.type !== "string" || !item.type.trim()) {
          throw new OpenProjectError(
            "validation_failure",
            `${path}.type must be a non-empty string.`,
            422,
            "invalid_plan_item",
          );
        }

        if (typeof item.subject !== "string" || !item.subject.trim()) {
          throw new OpenProjectError(
            "validation_failure",
            `${path}.subject must be a non-empty string.`,
            422,
            "invalid_plan_item",
          );
        }
      };

      const countPlanItems = (items) =>
        items.reduce((count, item) => count + 1 + countPlanItems(Array.isArray(item.children) ? item.children : []), 0);

      const planItems = Array.isArray(plan.items) ? plan.items : [];
      planItems.forEach((item, index) => validateItemShape(item, `items[${index}]`));

      const currentProjectWorkPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
        { includeAllStatuses: true },
      );
      const projectWorkPackagesById = new Map(
        currentProjectWorkPackages.map((payload) => [payload.id, payload]),
      );
      const upsertProjectWorkPackage = (payload) => {
        const index = currentProjectWorkPackages.findIndex(
          (entry) => entry.id === payload.id,
        );
        if (index === -1) {
          currentProjectWorkPackages.push(payload);
        } else {
          currentProjectWorkPackages.splice(index, 1, payload);
        }
        projectWorkPackagesById.set(payload.id, payload);
      };
      const created = [];
      const updated = [];
      const reused = [];
      const deferred = [];
      const retired = [];

      const recordSummary = (payload) => ({
        id: payload.id,
        parent_id: parseWorkPackageIdFromHref(payload?._links?.parent?.href),
        record_ref: `openproject://work_packages/${payload.id}`,
        status: workPackageStatusName(payload),
        subject: payload.subject,
        target_pi: normalizeStringValue(
          readCustomField(payload, config.deliveryCustomFieldTargetPiId),
        ),
        type: workPackageTypeName(payload),
      });

      const updateWorkItemFromPlan = async (
        payload,
        item,
        path,
        parentPayload,
        resolvedItemTaxonomy,
      ) => {
        if (workPackageTypeName(payload) === "Epic") {
          throw new OpenProjectError(
            "validation_failure",
            "Top-level delivery initiatives must be updated through the initiative workflow surface.",
            422,
            "update_initiative_required",
          );
        }

        if (typeof payload?.lockVersion !== "number") {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package response did not include lockVersion.",
            502,
            "missing_lock_version",
          );
        }

        const formPayload = await getWorkPackageFormPayload(payload.id, payload.lockVersion);
        const fieldMap = buildCustomFieldSchemaMap(formPayload);
        const patchPayload = { lockVersion: payload.lockVersion };
        const changesApplied = {};
        const currentDescription = payload?.description?.raw ?? "";
        const parentTypeName = parentPayload ? workPackageTypeName(parentPayload) : null;

        if (Object.prototype.hasOwnProperty.call(item, "status") && typeof item.status === "string" && item.status.trim()) {
          if (item.status.trim().toLowerCase() === "done") {
            throw new OpenProjectError(
              "validation_failure",
              "status cannot be done in a delivery plan; use the supported completion workflow after the item exists.",
              422,
              "completion_requires_evidence",
            );
          }

          const resolvedStatus = await resolveAllowedValueLink({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            fieldNames: ["status"],
            fieldLabel: "status",
            formPayload,
            requestHeaders,
            value: item.status,
          });
          const currentStatus = workPackageStatusName(payload);
          if (currentStatus.toLowerCase() !== resolvedStatus.title.toLowerCase()) {
            patchPayload._links = patchPayload._links ?? {};
            patchPayload._links.status = resolvedStatus;
            changesApplied.status = {
              from: currentStatus,
              to: resolvedStatus.title,
            };
          }
        }

        if (normalizeStringValue(payload.subject) !== resolvedItemTaxonomy.subject) {
          patchPayload.subject = resolvedItemTaxonomy.subject;
          changesApplied.subject = {
            from: normalizeStringValue(payload.subject),
            to: resolvedItemTaxonomy.subject,
          };
        }

        if (Object.prototype.hasOwnProperty.call(item, "description")) {
          const desiredDescription = item.description === null ? "" : normalizeStringValue(item.description);
          if (desiredDescription !== currentDescription) {
            patchPayload.description = {
              format: "markdown",
              raw: desiredDescription,
            };
            changesApplied.description = {
              from_present: currentDescription.trim().length > 0,
              to_present: desiredDescription.trim().length > 0,
            };
          }
        }

        if (Object.prototype.hasOwnProperty.call(item, "target_pi")) {
          const desiredTargetPi = normalizeStringValue(item.target_pi);
          const currentTargetPi = normalizeStringValue(
            readCustomField(payload, config.deliveryCustomFieldTargetPiId),
          );
          if (currentTargetPi !== desiredTargetPi) {
            patchPayload[`customField${config.deliveryCustomFieldTargetPiId}`] = desiredTargetPi;
            changesApplied.target_pi = {
              from: currentTargetPi,
              to: desiredTargetPi,
            };
          }
        }

        for (const fieldSpec of [
          { key: "start_date", parser: parseCreateDateValue },
          { key: "due_date", parser: parseCreateDateValue },
        ]) {
          if (!Object.prototype.hasOwnProperty.call(item, fieldSpec.key)) {
            continue;
          }

          const desiredValue =
            item[fieldSpec.key] === null
              ? null
              : fieldSpec.parser(item[fieldSpec.key], `${path}.${fieldSpec.key}`);
          const patchKey = fieldSpec.key === "start_date" ? "startDate" : "dueDate";
          const currentValue = normalizeStringValue(payload[patchKey] ?? null);
          if (currentValue !== desiredValue) {
            patchPayload[patchKey] = desiredValue;
            changesApplied[fieldSpec.key] = {
              from: currentValue,
              to: desiredValue,
            };
          }
        }

        for (const fieldSpec of [
          { key: "estimated_work", patchKey: "estimatedTime", parser: parseCreateHoursValue },
          { key: "remaining_work", patchKey: "remainingTime", parser: parseCreateHoursValue },
        ]) {
          if (!Object.prototype.hasOwnProperty.call(item, fieldSpec.key)) {
            continue;
          }

          const desiredValue =
            item[fieldSpec.key] === null
              ? null
              : fieldSpec.parser(item[fieldSpec.key], `${path}.${fieldSpec.key}`);
          const currentValue =
            payload[fieldSpec.patchKey] === undefined || payload[fieldSpec.patchKey] === null
              ? null
              : parseDurationToHours(payload[fieldSpec.patchKey]);
          if (currentValue !== desiredValue) {
            patchPayload[fieldSpec.patchKey] = serializeDurationHours(desiredValue);
            changesApplied[fieldSpec.key] = {
              from: currentValue,
              to: desiredValue,
            };
          }
        }

        if (Object.prototype.hasOwnProperty.call(item, "percent_complete")) {
          const desiredValue = parseCreatePercentComplete(item.percent_complete);
          const currentValue =
            typeof payload?.percentageDone === "number" ? payload.percentageDone : null;
          if (currentValue !== desiredValue) {
            patchPayload.percentageDone = desiredValue;
            changesApplied.percent_complete = {
              from: currentValue,
              to: desiredValue,
            };
          }
        }

        const customFieldInput = {
          ...item,
          executionClassification: resolvedItemTaxonomy.classification ?? undefined,
        };

        for (const spec of DELIVERY_CREATE_CUSTOM_FIELD_SPECS) {
          if (!Object.prototype.hasOwnProperty.call(customFieldInput, spec.inputName)) {
            continue;
          }

          const entry = fieldMap.get(spec.fieldName);
          if (!entry) {
            throw new OpenProjectError(
              "backend_contract_drift",
              `OpenProject work package form is missing custom field ${spec.fieldName}.`,
              502,
              "missing_custom_field_schema",
            );
          }

          if (spec.kind === "list") {
            const desiredValue = normalizeStringValue(customFieldInput[spec.inputName]);
            const currentValue = normalizeStringValue(
              readCustomFieldValueFromSchemaEntry(payload, entry),
            );
            if (currentValue === desiredValue) {
              continue;
            }

            setCustomFieldPayloadValue(
              patchPayload,
              entry,
              desiredValue
                ? await resolveCustomOptionLink({
                    baseUrl: config.baseUrl,
                    executeRequest: executeRequestWithRetry,
                    fieldId: entry.fieldId,
                    formPayload,
                    requestHeaders,
                    value: desiredValue,
                  })
                : entry.location === "_links"
                  ? { href: null, title: null }
                  : null,
            );
            changesApplied[spec.inputName] = {
              from: currentValue,
              to: desiredValue,
            };
            continue;
          }

          const desiredValue = normalizePlanCustomValue({
            field: entry,
            kind: spec.kind,
            rawValue: customFieldInput[spec.inputName],
          });
          const currentValue = readCustomFieldValueFromSchemaEntry(payload, entry);
          const currentComparable =
            currentValue === null || currentValue === undefined
              ? null
              : typeof currentValue === "string"
                ? currentValue
                : JSON.stringify(currentValue);
          const desiredComparable =
            desiredValue === null || desiredValue === undefined
              ? null
              : typeof desiredValue === "string"
                ? desiredValue
                : JSON.stringify(desiredValue);
          if (currentComparable === desiredComparable) {
            continue;
          }

          setCustomFieldPayloadValue(patchPayload, entry, desiredValue);
          changesApplied[spec.inputName] = {
            from: currentValue,
            to: desiredValue,
          };
        }

        const nextPayload = Object.keys(changesApplied).length > 0
          ? await patchWorkPackagePayload(payload.id, patchPayload)
          : payload;

        const nextStatus = workPackageStatusName(nextPayload).trim().toLowerCase();
        if (nextStatus === "ready") {
          validateReadyDeliveryFields({
            fieldMap,
            payload: nextPayload,
            typeName: workPackageTypeName(nextPayload),
          });
          validateDeliveryExecutionContract({
            customFieldMap: fieldMap,
            parentTypeName,
            payload: nextPayload,
            typeName: workPackageTypeName(nextPayload),
          });
        }

        const summary = {
          ...recordSummary(nextPayload),
          changes: changesApplied,
        };
        return {
          changesApplied,
          payload: nextPayload,
          summary,
        };
      };

      const createWorkItemFromPlan = async (
        item,
        parentPayload,
        path,
        resolvedItemTaxonomy,
      ) => {
        const parentHref = `/api/v3/work_packages/${parentPayload.id}`;
        const createForm = await getProjectWorkPackageFormPayload(
          config.deliveryProjectIdentifier,
          {
            _links: {
              parent: {
                href: parentHref,
              },
            },
          },
        );
        const resolvedType = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["type"],
          fieldLabel: "type",
          formPayload: createForm,
          requestHeaders,
          value: item.type,
        });
        const typeName = resolvedItemTaxonomy.typeName;
        if (typeName.toLowerCase() === "epic") {
          throw new OpenProjectError(
            "validation_failure",
            "Top-level delivery initiatives must be created through the proposal consume workflow, not the child work-item create surface.",
            422,
            "create_initiative_required",
          );
        }

        const payload = {
          scheduleManually: true,
          subject: resolvedItemTaxonomy.subject,
          _links: {
            parent: {
              href: parentHref,
            },
            type: resolvedType,
          },
        };

        if (parentPayload?._links?.priority?.href) {
          payload._links.priority = {
            href: parentPayload._links.priority.href,
            title: parentPayload?._links?.priority?.title ?? null,
          };
        }

        if (Object.prototype.hasOwnProperty.call(item, "status") && item.status !== undefined) {
          if (typeof item.status === "string" && item.status.trim().toLowerCase() === "done") {
            throw new OpenProjectError(
              "validation_failure",
              "Create the work item first, then use the completion workflow to mark it done with evidence.",
              422,
              "completion_requires_evidence",
            );
          }

          payload._links.status = await resolveAllowedValueLink({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            fieldNames: ["status"],
            fieldLabel: "status",
            formPayload: createForm,
            requestHeaders,
            value: item.status,
          });
        }

        if (Object.prototype.hasOwnProperty.call(item, "description")) {
          payload.description = {
            format: "markdown",
            raw: item.description === null ? "" : normalizeStringValue(item.description),
          };
        }

        if (Object.prototype.hasOwnProperty.call(item, "start_date")) {
          payload.startDate =
            item.start_date === null
              ? null
              : parseCreateDateValue(item.start_date, `${path}.start_date`);
        } else if (parentPayload?.startDate) {
          payload.startDate = normalizeStringValue(parentPayload.startDate);
        }

        if (Object.prototype.hasOwnProperty.call(item, "due_date")) {
          payload.dueDate =
            item.due_date === null
              ? null
              : parseCreateDateValue(item.due_date, `${path}.due_date`);
        }

        if (Object.prototype.hasOwnProperty.call(item, "estimated_work")) {
          payload.estimatedTime = serializeDurationHours(
            item.estimated_work === null
              ? null
              : parseCreateHoursValue(item.estimated_work, `${path}.estimated_work`),
          );
        }

        if (Object.prototype.hasOwnProperty.call(item, "remaining_work")) {
          payload.remainingTime = serializeDurationHours(
            item.remaining_work === null
              ? null
              : parseCreateHoursValue(item.remaining_work, `${path}.remaining_work`),
          );
        }

        if (Object.prototype.hasOwnProperty.call(item, "percent_complete")) {
          payload.percentageDone = parseCreatePercentComplete(item.percent_complete);
        }

        const customFieldMap = buildCustomFieldSchemaMap(createForm);
        const customFieldInput = {
          ...item,
          executionClassification: resolvedItemTaxonomy.classification ?? undefined,
        };

        for (const spec of DELIVERY_CREATE_CUSTOM_FIELD_SPECS) {
          if (!Object.prototype.hasOwnProperty.call(customFieldInput, spec.inputName)) {
            continue;
          }

          const entry = customFieldMap.get(spec.fieldName);
          if (!entry) {
            throw new OpenProjectError(
              "backend_contract_drift",
              `OpenProject create form is missing custom field ${spec.fieldName}.`,
              502,
              "missing_custom_field_schema",
            );
          }

          if (spec.kind === "list") {
            const desiredValue = normalizeStringValue(customFieldInput[spec.inputName]);
            setCustomFieldPayloadValue(
              payload,
              entry,
              desiredValue
                ? await resolveCustomOptionLink({
                    baseUrl: config.baseUrl,
                    executeRequest: executeRequestWithRetry,
                    fieldId: entry.fieldId,
                    formPayload: createForm,
                    requestHeaders,
                    value: desiredValue,
                  })
                : entry.location === "_links"
                  ? { href: null, title: null }
                  : null,
            );
            continue;
          }

          const parsedValue = await parseCreateCustomFieldValue({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            entry,
            formPayload: createForm,
            requestHeaders,
            kind: spec.kind,
            rawValue: customFieldInput[spec.inputName],
          });
          setCustomFieldPayloadValue(payload, entry, parsedValue);
        }

        const effectiveStatus =
          normalizeStringValue(payload?._links?.status?.title) ??
          normalizeStringValue(createForm?._embedded?.payload?._links?.status?.title) ??
          "new";
        if (effectiveStatus.toLowerCase() === "ready") {
          validateReadyDeliveryFields({
            fieldMap: customFieldMap,
            payload,
            typeName,
          });
          validateDeliveryExecutionContract({
            customFieldMap,
            parentTypeName: workPackageTypeName(parentPayload),
            payload,
            typeName,
          });
        }

        const createdPayload = await createProjectWorkPackagePayload(
          config.deliveryProjectIdentifier,
          {
            ...payload,
            _links: {
              ...payload._links,
              parent: undefined,
            },
          },
        );
        const currentCreatedPayload = await getWorkPackagePayload(createdPayload.id);
        const patchedPayload = await patchWorkPackagePayload(createdPayload.id, {
          lockVersion: currentCreatedPayload.lockVersion,
          _links: {
            parent: {
              href: parentHref,
            },
          },
        });

        return patchedPayload;
      };

      const applyPlanItems = async (items, parentPayload, path) => {
        const plannedChildren = [];

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const itemPath = `${path}[${index}]`;
          validateItemShape(item, itemPath);
          let resolvedItemTaxonomy;
          try {
            resolvedItemTaxonomy = resolveDeliveryTaxonomy({
              classification: item.executionClassification,
              enforceParentType: true,
              parentTypeName: workPackageTypeName(parentPayload),
              subject: item.subject,
              typeName: item.type,
            });
          } catch (error) {
            throw new OpenProjectError(
              "validation_failure",
              `${itemPath} is not a valid delivery taxonomy entry: ${error.message}`,
              422,
              "invalid_plan_item",
            );
          }

          const parentId = parentPayload.id;
          const existing = currentProjectWorkPackages.find((candidate) => {
            const candidateParentId = parseWorkPackageIdFromHref(candidate?._links?.parent?.href);
            return (
              candidateParentId === parentId &&
              workPackageTypeName(candidate)?.toLowerCase() === resolvedItemTaxonomy.typeName.toLowerCase() &&
              normalizeStringValue(candidate?.subject)?.toLowerCase() ===
                resolvedItemTaxonomy.subject.toLowerCase()
            );
          });
          plannedChildren.push({
            parentId,
            subject: resolvedItemTaxonomy.subject.toLowerCase(),
            type: resolvedItemTaxonomy.typeName.toLowerCase(),
          });

          let nextPayload;
          if (existing) {
            const result = await updateWorkItemFromPlan(
              existing,
              item,
              itemPath,
              parentPayload,
              resolvedItemTaxonomy,
            );
            nextPayload = result.payload;
            if (Object.keys(result.changesApplied).length > 0) {
              updated.push(recordSummary(nextPayload));
            } else {
              reused.push(recordSummary(nextPayload));
            }
          } else {
            nextPayload = await createWorkItemFromPlan(
              item,
              parentPayload,
              itemPath,
              resolvedItemTaxonomy,
            );
            created.push(recordSummary(nextPayload));
          }

          projectWorkPackagesById.set(nextPayload.id, nextPayload);
          const latestIndex = currentProjectWorkPackages.findIndex((candidate) => candidate.id === nextPayload.id);
          if (latestIndex >= 0) {
            currentProjectWorkPackages[latestIndex] = nextPayload;
          } else {
            currentProjectWorkPackages.push(nextPayload);
          }

          if (Array.isArray(item.children) && item.children.length > 0) {
            await applyPlanItems(item.children, nextPayload, `${itemPath}.children`);
          }
        }

        if (reconcileMissing !== "park") {
          return;
        }

        const directChildren = currentProjectWorkPackages.filter((candidate) => {
          const candidateParentId = parseWorkPackageIdFromHref(candidate?._links?.parent?.href);
          return candidateParentId === parentPayload.id;
        });

        for (const child of directChildren) {
          const childKey = {
            parentId: parentPayload.id,
            subject: normalizeStringValue(child.subject)?.toLowerCase(),
            type: workPackageTypeName(child)?.toLowerCase(),
          };
          if (
            plannedChildren.some(
              (planned) =>
                planned.parentId === childKey.parentId &&
                planned.subject === childKey.subject &&
                planned.type === childKey.type,
            )
          ) {
            continue;
          }

          const parked = await this.manageDeliveryParking({
            action: "park",
            parkDecision: reconcileDecision,
            parkReason: normalizedReconcileReason,
            parkReviewDate: reconcileDecision === "defer" ? normalizedReviewDate : null,
            recordId: child.id,
            retirementReason:
              reconcileDecision === "retire" ? normalizedRetirementReason : null,
            workNote: null,
            workNoteAuthor: "delivery-plan-reconcile",
          });

          if (parked?.workItem?.status === "retired") {
            retired.push(recordSummary(parked.workItem));
          } else {
            deferred.push(recordSummary(parked.workItem));
          }
        }
      };

      let epicChanges = {};
      if (plan.epic_updates) {
        const epicResult = await this.updateDeliveryInitiative({
          businessObjective: plan.epic_updates.business_objective,
          description: plan.epic_updates.description,
          inspectAndAdaptActions: plan.epic_updates.inspect_and_adapt_actions,
          nfrCategory: plan.epic_updates.nfr_category,
          pm2Phase: plan.epic_updates.pm2_phase,
          recordId,
          sponsor: plan.epic_updates.sponsor,
          status: plan.epic_updates.status,
          successCriteria: plan.epic_updates.success_criteria,
          systemDemoEvidence: plan.epic_updates.system_demo_evidence,
          targetPi: plan.epic_updates.target_pi,
        });
        epicChanges = epicResult.changesApplied ?? {};
      }

      await applyPlanItems(planItems, rootPayload, "items");

      const finalRootPayload = await getWorkPackagePayload(recordId);
      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: `openproject://work_packages/${recordId}`,
        planResult: {
          created,
          deferred,
          epic: {
            changes: epicChanges,
            id: finalRootPayload.id,
            record_ref: `openproject://work_packages/${finalRootPayload.id}`,
            subject: finalRootPayload.subject,
            target_pi: normalizeStringValue(
              readCustomField(finalRootPayload, config.deliveryCustomFieldTargetPiId),
            ),
            updated: Object.keys(epicChanges).length > 0,
          },
          retired,
          reused,
          summary: {
            created_count: created.length,
            deferred_count: deferred.length,
            reused_count: reused.length,
            retired_count: retired.length,
            total_requested: countPlanItems(planItems),
            updated_count: updated.length,
          },
          updated,
        },
      };
    },

    async listDeliveryProjectAssignablePrincipals() {
      const projectPayload = await getProjectPayload(config.deliveryProjectIdentifier);
      const projectId =
        typeof projectPayload?.id === "number" ? projectPayload.id : null;
      if (!projectId) {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject project response did not include a numeric id.",
          502,
          "missing_project_id",
        );
      }

      let response;
      try {
        response = await executeRequestWithRetry(
          joinUrl(config.baseUrl, `/api/v3/workspaces/${projectId}/available_assignees`),
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

      const principals = Array.isArray(responsePayload?._embedded?.elements)
        ? responsePayload._embedded.elements.map((entry) => normalizeAssignablePrincipal(entry))
        : [];

      return {
        principals,
        project: {
          id: projectId,
          identifier: normalizeStringValue(projectPayload?.identifier ?? null),
          name: normalizeStringValue(projectPayload?.name ?? null),
          recordRef: `openproject://projects/${config.deliveryProjectIdentifier}`,
        },
      };
    },

    async createDeliveryWorkItem({
      acceptanceCriteria,
      actualBusinessValue,
      assigneeLogin,
      executionClassification,
      definitionOfDone,
      definitionOfReady,
      deliveryTeam,
      description,
      dueDate,
      estimatedWork,
      iteration,
      nfrCategory,
      ownerRepo,
      parentRecordId,
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
      subject,
      targetPi,
      type,
      wsjfJobSize,
      wsjfRiskReductionOpportunityEnablement,
      wsjfTimeCriticality,
      wsjfUserBusinessValue,
    }) {
      const normalizedSubject = normalizeStringValue(subject);
      if (!normalizedSubject) {
        throw new OpenProjectError(
          "validation_failure",
          "subject is required.",
          422,
          "missing_subject",
        );
      }

      const parentPayload = await getWorkPackagePayload(parentRecordId);
      const parentHref = `/api/v3/work_packages/${parentRecordId}`;
      const baseCreateForm = await getProjectWorkPackageFormPayload(
        config.deliveryProjectIdentifier,
        {
          _links: {
            parent: {
              href: parentHref,
            },
          },
        },
      );
      const resolvedType = await resolveAllowedValueLink({
        baseUrl: config.baseUrl,
        executeRequest: executeRequestWithRetry,
        fieldNames: ["type"],
        fieldLabel: "type",
        formPayload: baseCreateForm,
        requestHeaders,
        value: type,
      });
      const parentTypeName = workPackageTypeName(parentPayload);
      let resolvedTaxonomy;
      try {
        resolvedTaxonomy = resolveDeliveryTaxonomy({
          classification: executionClassification,
          enforceParentType: true,
          parentTypeName,
          subject: normalizedSubject,
          typeName: resolvedType.title,
        });
      } catch (error) {
        throw new OpenProjectError(
          "validation_failure",
          error.message,
          422,
          "delivery_taxonomy_invalid",
        );
      }
      const typeName = resolvedTaxonomy.typeName;

      if (typeName.toLowerCase() === "epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Top-level delivery initiatives must be created through the proposal consume workflow, not the child work-item create surface.",
          422,
          "create_initiative_required",
        );
      }

      if (normalizeStringValue(status)?.toLowerCase() === "done") {
        throw new OpenProjectError(
          "validation_failure",
          "Create the work item first, then use the completion workflow to mark it done with evidence.",
          422,
          "completion_requires_evidence",
        );
      }

      const createForm = await getProjectWorkPackageFormPayload(
        config.deliveryProjectIdentifier,
        {
          _links: {
            parent: {
              href: parentHref,
            },
            type: resolvedType,
          },
        },
      );
      const customFieldMap = buildCustomFieldSchemaMap(createForm);

      const siblings = await listProjectWorkPackages(config.deliveryProjectIdentifier);
      const duplicateSibling = siblings.find((candidate) => {
        const candidateParentId = parseWorkPackageIdFromHref(candidate?._links?.parent?.href);
        return (
          candidateParentId === parentRecordId &&
          workPackageTypeName(candidate)?.toLowerCase() === typeName.toLowerCase() &&
          normalizeStringValue(candidate?.subject)?.toLowerCase() ===
            resolvedTaxonomy.subject.toLowerCase()
        );
      });
      if (duplicateSibling) {
        throw new OpenProjectError(
          "validation_failure",
          `A sibling work item already exists with parent ${parentRecordId}, type ${typeName}, and subject ${normalizedSubject}.`,
          422,
          "duplicate_delivery_work_item",
        );
      }

      const payload = {
        scheduleManually: true,
        subject: resolvedTaxonomy.subject,
        _links: {
          parent: {
            href: parentHref,
          },
          type: resolvedType,
        },
      };
      const creationApplied = {
        execution_classification: resolvedTaxonomy.classification,
        subject: resolvedTaxonomy.subject,
        type: typeName,
      };

      if (parentPayload?._links?.priority?.href) {
        payload._links.priority = {
          href: parentPayload._links.priority.href,
          title: parentPayload?._links?.priority?.title ?? null,
        };
        creationApplied.priority = {
          inherited_from_parent: true,
          title: parentPayload?._links?.priority?.title ?? null,
        };
      }

      const resolvedStatus = normalizeStringValue(status)
        ? await resolveAllowedValueLink({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            fieldNames: ["status"],
            fieldLabel: "status",
            formPayload: createForm,
            requestHeaders,
            value: status,
          })
        : null;
      if (resolvedStatus) {
        payload._links.status = resolvedStatus;
        creationApplied.status = resolvedStatus.title;
      }

      const resolvedAssignee = normalizeStringValue(assigneeLogin)
        ? await resolveAllowedValueLink({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            fieldNames: ["assignee", "assignedTo"],
            fieldLabel: "assignee",
            formPayload: createForm,
            requestHeaders,
            value: assigneeLogin,
          })
        : null;
      if (resolvedAssignee) {
        payload._links.assignee = resolvedAssignee;
        creationApplied.assignee_login = resolvedAssignee.title;
      }

      const resolvedResponsible = normalizeStringValue(responsibleLogin)
        ? await resolveAllowedValueLink({
            baseUrl: config.baseUrl,
            executeRequest: executeRequestWithRetry,
            fieldNames: ["responsible"],
            fieldLabel: "responsible",
            formPayload: createForm,
            requestHeaders,
            value: responsibleLogin,
          })
        : null;
      if (resolvedResponsible) {
        payload._links.responsible = resolvedResponsible;
        creationApplied.responsible_login = resolvedResponsible.title;
      }

      if (normalizeStringValue(description)) {
        payload.description = {
          format: "markdown",
          raw: description.trim(),
        };
        creationApplied.description = {
          present: true,
        };
      }

      if (startDate !== undefined) {
        payload.startDate = parseCreateDateValue(startDate, "start_date");
        creationApplied.start_date = payload.startDate;
      }
      if (dueDate !== undefined) {
        payload.dueDate = parseCreateDateValue(dueDate, "due_date");
        creationApplied.due_date = payload.dueDate;
      }
      if (estimatedWork !== undefined) {
        const parsed = parseCreateHoursValue(estimatedWork, "estimated_work");
        payload.estimatedTime = serializeDurationHours(parsed);
        creationApplied.estimated_work = parsed;
      }
      if (remainingWork !== undefined) {
        const parsed = parseCreateHoursValue(remainingWork, "remaining_work");
        payload.remainingTime = serializeDurationHours(parsed);
        creationApplied.remaining_work = parsed;
      }
      if (percentComplete !== undefined) {
        payload.percentageDone = parseCreatePercentComplete(percentComplete);
        creationApplied.percent_complete = payload.percentageDone;
      }

      const desiredTargetPi =
        normalizeStringValue(targetPi) ??
        normalizeStringValue(
          readCustomField(parentPayload, config.deliveryCustomFieldTargetPiId),
        );
      const parentTargetPi = normalizeStringValue(
        readCustomField(parentPayload, config.deliveryCustomFieldTargetPiId),
      );

      if (
        (typeName === "User story" || typeName === "Task") &&
        !parentTargetPi
      ) {
        throw new OpenProjectError(
          "validation_failure",
          `${typeName} creation requires a PI-committed parent ${parentTypeName}.`,
          422,
          "parent_feature_missing_target_pi",
        );
      }

      const desiredStatus = resolvedStatus?.title ?? "new";

      try {
        validateDeliveryPlanningState({
          iteration,
          status: desiredStatus,
          targetPi: desiredTargetPi,
          typeName,
        });
      } catch (error) {
        throw new OpenProjectError(
          "validation_failure",
          error.message,
          422,
          "delivery_planning_state_invalid",
        );
      }

      if (desiredTargetPi) {
        const targetPiField = customFieldMap.get("Target PI");
        if (!targetPiField) {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject create form is missing the Target PI field.",
            502,
            "missing_target_pi_field",
          );
        }

        setCustomFieldPayloadValue(payload, targetPiField, desiredTargetPi);
        creationApplied.target_pi = desiredTargetPi;
      }

      const customFieldInput = {
        acceptanceCriteria,
        actualBusinessValue,
        definitionOfDone,
        definitionOfReady,
        deliveryTeam,
        executionClassification: resolvedTaxonomy.classification ?? undefined,
        iteration,
        nfrCategory,
        ownerRepo,
        piObjectiveType,
        piObjectiveReviewOutcome,
        plannedBusinessValue,
        riskDisposition,
        riskOwner,
        riskReviewDate,
        roamState,
        wsjfJobSize,
        wsjfRiskReductionOpportunityEnablement,
        wsjfTimeCriticality,
        wsjfUserBusinessValue,
      };
      const customFieldsApplied = {};

      for (const spec of DELIVERY_CREATE_CUSTOM_FIELD_SPECS) {
        if (customFieldInput[spec.inputName] === undefined) {
          continue;
        }

        const entry = customFieldMap.get(spec.fieldName);
        if (!entry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject create form is missing custom field ${spec.fieldName}.`,
            502,
            "missing_custom_field_schema",
          );
        }

        if (!entry.writable) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject create form marks ${spec.fieldName} as non-writable.`,
            502,
            "non_writable_custom_field",
          );
        }

        const parsedValue = await parseCreateCustomFieldValue({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          entry,
          formPayload: createForm,
          requestHeaders,
          kind: spec.kind,
          rawValue: customFieldInput[spec.inputName],
        });
        setCustomFieldPayloadValue(payload, entry, parsedValue);
        customFieldsApplied[spec.fieldName] =
          entry.location === "_links" ? parsedValue.title : parsedValue;
      }

      const wsjfInputPresent = DELIVERY_WSJF_COMPONENT_FIELD_NAMES.some(
        (fieldName) => Object.prototype.hasOwnProperty.call(customFieldsApplied, fieldName),
      );
      if (wsjfInputPresent) {
        const missingComponents = DELIVERY_WSJF_COMPONENT_FIELD_NAMES.filter(
          (fieldName) => !Object.prototype.hasOwnProperty.call(customFieldsApplied, fieldName),
        );
        if (missingComponents.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `WSJF component fields must all be provided together: ${missingComponents.join(", ")}.`,
            422,
            "missing_wsjf_components",
          );
        }

        const jobSize = Number.parseInt(customFieldsApplied["WSJF Job Size"], 10);
        if (!Number.isInteger(jobSize) || jobSize <= 0) {
          throw new OpenProjectError(
            "validation_failure",
            "WSJF Job Size must be greater than zero.",
            422,
            "invalid_wsjf_job_size",
          );
        }

        const wsjfScoreEntry = customFieldMap.get(DELIVERY_WSJF_SCORE_FIELD);
        if (!wsjfScoreEntry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject create form is missing custom field ${DELIVERY_WSJF_SCORE_FIELD}.`,
            502,
            "missing_wsjf_score_field",
          );
        }

        const wsjfScore =
          (
            Number.parseInt(customFieldsApplied["WSJF User-Business Value"], 10) +
            Number.parseInt(customFieldsApplied["WSJF Time Criticality"], 10) +
            Number.parseInt(
              customFieldsApplied["WSJF Risk Reduction / Opportunity Enablement"],
              10,
            )
          ) / jobSize;

        setCustomFieldPayloadValue(
          payload,
          wsjfScoreEntry,
          wsjfScore.toFixed(2).replace(/\.00$/, ""),
        );
        customFieldsApplied[DELIVERY_WSJF_SCORE_FIELD] = wsjfScore
          .toFixed(2)
          .replace(/\.00$/, "");
      }

      if (Object.keys(customFieldsApplied).length > 0) {
        creationApplied.custom_fields = customFieldsApplied;
      }

      const effectiveStatus =
        normalizeStringValue(resolvedStatus?.title) ??
        normalizeStringValue(createForm?._embedded?.payload?._links?.status?.title) ??
        "new";
      if (DELIVERY_ACTIVE_EXECUTION_CONTRACT_STATUSES.has(effectiveStatus.toLowerCase())) {
        validateDeliveryExecutionContract({
          customFieldMap,
          parentTypeName,
          payload,
          typeName,
        });
      }

      const createPayload = {
        ...payload,
        _links: {
          ...payload._links,
        },
      };
      delete createPayload._links.parent;

      const createdPayload = await createProjectWorkPackagePayload(
        config.deliveryProjectIdentifier,
        createPayload,
      );
      const createdCurrentPayload = await getWorkPackagePayload(createdPayload.id);
      if (typeof createdCurrentPayload?.lockVersion !== "number") {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package response did not include lockVersion after create.",
          502,
          "missing_lock_version_after_create",
        );
      }

      const responsePayload = await patchWorkPackagePayload(createdPayload.id, {
        lockVersion: createdCurrentPayload.lockVersion,
        _links: {
          parent: {
            href: parentHref,
          },
        },
      });

      return {
        creationApplied,
        parentWorkItemRecordId: parentRecordId,
        workItem: {
          ...mapWorkPackageToDeliveryWorkItem(config, responsePayload, customFieldMap),
          customFields: buildCustomFieldValuesByName({
            payload: responsePayload,
            customFieldMap,
          }),
        },
        workItemRecordId: responsePayload.id,
        workItemRecordRef: `openproject://work_packages/${responsePayload.id}`,
      };
    },

    async updateDeliveryWorkItem({
      acceptanceCriteria,
      actualBusinessValue,
      assigneeLogin,
      clearAssignee = false,
      clearDescription = false,
      clearDueDate = false,
      clearEstimatedWork = false,
      clearRemainingWork = false,
      clearResponsible = false,
      clearStartDate = false,
      clearTargetPi = false,
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
      recordId,
      remainingWork,
      responsibleLogin,
      riskDisposition,
      riskOwner,
      riskReviewDate,
      roamState,
      startDate,
      status,
      subject,
      targetPi,
      workNote,
      workNoteAuthor,
      wsjfJobSize,
      wsjfRiskReductionOpportunityEnablement,
      wsjfTimeCriticality,
      wsjfUserBusinessValue,
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
      const currentResponsibleLogin = workPackageResponsibleLogin(currentPayload);
      const currentStatus = workPackageStatusName(currentPayload);
      const currentTargetPi = normalizeStringValue(
        readCustomField(currentPayload, config.deliveryCustomFieldTargetPiId),
      );
      const formPayload = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const customFieldMap = buildCustomFieldSchemaMap(formPayload);
      const currentOwnerRepo = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(currentPayload, customFieldMap.get("Owner Repo")),
      );
      const currentDeliveryTeam = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(currentPayload, customFieldMap.get("Delivery Team")),
      );
      const currentIteration = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(currentPayload, customFieldMap.get("Iteration")),
      );
      const currentTypeName = workPackageTypeName(currentPayload);
      const currentParentId = parseWorkPackageIdFromHref(currentPayload?._links?.parent?.href);
      const parentPayload = currentParentId
        ? await getWorkPackagePayload(currentParentId)
        : null;
      const parentTypeName = parentPayload ? workPackageTypeName(parentPayload) : null;
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};
      let descriptionRaw = currentDescription;
      let subjectValue =
        normalizeStringValue(subject) ?? normalizeStringValue(currentPayload.subject);

      let resolvedTaxonomy;
      try {
        resolvedTaxonomy = resolveDeliveryTaxonomy({
          classification:
            executionClassification === undefined
              ? readDeliveryExecutionClassification(currentPayload, customFieldMap)
              : executionClassification,
          enforceParentType: false,
          parentTypeName,
          subject: subjectValue,
          typeName: currentTypeName,
        });
      } catch (error) {
        throw new OpenProjectError(
          "validation_failure",
          error.message,
          422,
          "delivery_taxonomy_invalid",
        );
      }
      subjectValue = resolvedTaxonomy.subject;

      if (typeof status === "string" && status.trim()) {
        if (status.trim().toLowerCase() === "done") {
          throw new OpenProjectError(
            "validation_failure",
            "Use the completion workflow to mark delivery work done with evidence.",
            422,
            "completion_requires_evidence",
          );
        }

        const resolvedStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
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
            : await resolveAllowedValueLink({
                baseUrl: config.baseUrl,
                executeRequest: executeRequestWithRetry,
                fieldNames: ["assignee", "assignedTo"],
                fieldLabel: "assignee",
                formPayload,
                requestHeaders,
                value: desiredAssigneeLogin,
              });
          changesApplied.assignee_login = {
            from: currentAssigneeLogin,
            to: desiredAssigneeLogin,
          };
        }
      }

      if (clearResponsible || responsibleLogin !== undefined) {
        const desiredResponsibleLogin = clearResponsible
          ? null
          : normalizeStringValue(responsibleLogin);
        if (currentResponsibleLogin !== desiredResponsibleLogin) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.responsible = clearResponsible
            ? { href: null, title: null }
            : await resolveAllowedValueLink({
                baseUrl: config.baseUrl,
                executeRequest: executeRequestWithRetry,
                fieldNames: ["responsible"],
                fieldLabel: "responsible",
                formPayload,
                requestHeaders,
                value: desiredResponsibleLogin,
              });
          changesApplied.responsible_login = {
            from: currentResponsibleLogin,
            to: desiredResponsibleLogin,
          };
        }
      }

      if (normalizeStringValue(currentPayload.subject) !== subjectValue) {
        patchPayload.subject = subjectValue;
        changesApplied.subject = {
          from: normalizeStringValue(currentPayload.subject),
          to: subjectValue,
        };
      }

      if (clearDescription) {
        descriptionRaw = "";
      } else if (description !== undefined) {
        descriptionRaw = description.trim();
      }

      if (typeof workNote === "string" && workNote.trim()) {
        const duplicateWorkNote = operatorWorkNoteAlreadyPresent(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        changesApplied.work_note = {
          applied: !duplicateWorkNote,
        };
      }

      const currentStartDate = normalizeStringValue(currentPayload?.startDate ?? null);
      if (clearStartDate || startDate !== undefined) {
        const desiredStartDate = clearStartDate
          ? null
          : parseCreateDateValue(startDate, "start_date");
        if (currentStartDate !== desiredStartDate) {
          patchPayload.scheduleManually = true;
          patchPayload.startDate = desiredStartDate;
          changesApplied.start_date = {
            from: currentStartDate,
            to: desiredStartDate,
          };
        }
      }

      const currentDueDate = normalizeStringValue(currentPayload?.dueDate ?? null);
      if (clearDueDate || dueDate !== undefined) {
        const desiredDueDate = clearDueDate
          ? null
          : parseCreateDateValue(dueDate, "due_date");
        if (currentDueDate !== desiredDueDate) {
          patchPayload.scheduleManually = true;
          patchPayload.dueDate = desiredDueDate;
          changesApplied.due_date = {
            from: currentDueDate,
            to: desiredDueDate,
          };
        }
      }

      const currentEstimatedWork = parseDurationToHours(currentPayload?.estimatedTime ?? null);
      if (clearEstimatedWork || estimatedWork !== undefined) {
        const desiredEstimatedWork = clearEstimatedWork
          ? null
          : parseCreateHoursValue(estimatedWork, "estimated_work");
        if (customFieldValueComparable(currentEstimatedWork) !== customFieldValueComparable(desiredEstimatedWork)) {
          patchPayload.scheduleManually = true;
          patchPayload.estimatedTime = serializeDurationHours(desiredEstimatedWork);
          changesApplied.estimated_work = {
            from: currentEstimatedWork,
            to: desiredEstimatedWork,
          };
        }
      }

      const currentRemainingWork = parseDurationToHours(currentPayload?.remainingTime ?? null);
      if (clearRemainingWork || remainingWork !== undefined) {
        const desiredRemainingWork = clearRemainingWork
          ? null
          : parseCreateHoursValue(remainingWork, "remaining_work");
        if (customFieldValueComparable(currentRemainingWork) !== customFieldValueComparable(desiredRemainingWork)) {
          patchPayload.scheduleManually = true;
          patchPayload.remainingTime = serializeDurationHours(desiredRemainingWork);
          changesApplied.remaining_work = {
            from: currentRemainingWork,
            to: desiredRemainingWork,
          };
        }
      }

      if (percentComplete !== undefined) {
        const desiredPercentComplete = parseCreatePercentComplete(percentComplete);
        const currentPercentComplete =
          currentPayload?.percentageDone === null || currentPayload?.percentageDone === undefined
            ? null
            : Number.parseInt(String(currentPayload.percentageDone), 10);
        if (currentPercentComplete !== desiredPercentComplete) {
          patchPayload.percentageDone = desiredPercentComplete;
          changesApplied.percent_complete = {
            from: currentPercentComplete,
            to: desiredPercentComplete,
          };
        }
      }

      const customFieldInput = {
        ownerRepo,
        deliveryTeam,
        iteration,
        executionClassification:
          executionClassification === undefined
            ? resolvedTaxonomy.classification ?? undefined
            : resolvedTaxonomy.classification,
        acceptanceCriteria,
        definitionOfReady,
        definitionOfDone,
        nfrCategory,
        piObjectiveType,
        piObjectiveReviewOutcome,
        plannedBusinessValue,
        actualBusinessValue,
        roamState,
        riskOwner,
        riskReviewDate,
        riskDisposition,
        wsjfUserBusinessValue,
        wsjfTimeCriticality,
        wsjfRiskReductionOpportunityEnablement,
        wsjfJobSize,
      };
      const effectiveCustomFieldValues = new Map();

      for (const spec of DELIVERY_UPDATE_CUSTOM_FIELD_SPECS) {
        if (customFieldInput[spec.inputName] === undefined) {
          continue;
        }

        const entry = customFieldMap.get(spec.fieldName);
        if (!entry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject work package form is missing custom field ${spec.fieldName}.`,
            502,
            "missing_custom_field_schema",
          );
        }

        if (!entry.writable) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject work package form marks ${spec.fieldName} as non-writable.`,
            502,
            "non_writable_custom_field",
          );
        }

        if (spec.kind === "list") {
          const desiredValue = normalizeStringValue(customFieldInput[spec.inputName]);
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(currentPayload, entry),
          );
          if (currentValue === desiredValue) {
            effectiveCustomFieldValues.set(spec.fieldName, currentValue);
            continue;
          }

          setCustomFieldPayloadValue(
            patchPayload,
            entry,
            desiredValue
              ? await resolveCustomOptionLink({
                  baseUrl: config.baseUrl,
                  executeRequest: executeRequestWithRetry,
                  fieldId: entry.fieldId,
                  formPayload,
                  requestHeaders,
                  value: desiredValue,
                })
              : entry.location === "_links"
                ? { href: null, title: null }
                : null,
          );
          changesApplied[spec.inputName] = {
            from: currentValue,
            to: desiredValue,
          };
          effectiveCustomFieldValues.set(spec.fieldName, desiredValue);
          continue;
        }

        const desiredValue = normalizePlanCustomValue({
          field: entry,
          kind: spec.kind,
          rawValue: customFieldInput[spec.inputName],
        });
        const currentValue = readCustomFieldValueFromSchemaEntry(currentPayload, entry);
        if (customFieldValueComparable(currentValue) === customFieldValueComparable(desiredValue)) {
          effectiveCustomFieldValues.set(spec.fieldName, currentValue);
          continue;
        }

        setCustomFieldPayloadValue(patchPayload, entry, desiredValue);
        changesApplied[spec.inputName] = {
          from: currentValue,
          to: desiredValue,
        };
        effectiveCustomFieldValues.set(spec.fieldName, desiredValue);
      }

      const previewOwnerRepo = normalizeStringValue(
        effectiveCustomFieldValues.has("Owner Repo")
          ? effectiveCustomFieldValues.get("Owner Repo")
          : currentOwnerRepo,
      );
      const previewDeliveryTeam = normalizeStringValue(
        effectiveCustomFieldValues.has("Delivery Team")
          ? effectiveCustomFieldValues.get("Delivery Team")
          : currentDeliveryTeam,
      );
      const previewIteration = normalizeStringValue(
        effectiveCustomFieldValues.has("Iteration")
          ? effectiveCustomFieldValues.get("Iteration")
          : currentIteration,
      );
      if (!clearDescription) {
        descriptionRaw = syncExecutionContextSection(descriptionRaw, {
          deliveryTeam: previewDeliveryTeam,
          iteration: previewIteration,
          ownerRepo: previewOwnerRepo,
          parentId: currentParentId,
          parentSubject: normalizeStringValue(parentPayload?.subject ?? null),
        });
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

      const wsjfInputPresent = DELIVERY_WSJF_COMPONENT_FIELD_NAMES.some((fieldName) =>
        effectiveCustomFieldValues.has(fieldName),
      );
      if (wsjfInputPresent) {
        const wsjfValues = DELIVERY_WSJF_COMPONENT_FIELD_NAMES.map((fieldName) => {
          if (effectiveCustomFieldValues.has(fieldName)) {
            return effectiveCustomFieldValues.get(fieldName);
          }
          const entry = customFieldMap.get(fieldName);
          return readCustomFieldValueFromSchemaEntry(currentPayload, entry);
        });

        const missingComponents = DELIVERY_WSJF_COMPONENT_FIELD_NAMES.filter((fieldName, index) => {
          const value = wsjfValues[index];
          return value === null || value === undefined || `${value}`.trim() === "";
        });
        if (missingComponents.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `WSJF component fields must all be provided together: ${missingComponents.join(", ")}.`,
            422,
            "missing_wsjf_components",
          );
        }

        const jobSize = Number.parseInt(String(wsjfValues[3]), 10);
        if (!Number.isInteger(jobSize) || jobSize <= 0) {
          throw new OpenProjectError(
            "validation_failure",
            "WSJF Job Size must be greater than zero.",
            422,
            "invalid_wsjf_job_size",
          );
        }

        const wsjfScoreEntry = customFieldMap.get(DELIVERY_WSJF_SCORE_FIELD);
        if (!wsjfScoreEntry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            `OpenProject work package form is missing custom field ${DELIVERY_WSJF_SCORE_FIELD}.`,
            502,
            "missing_wsjf_score_field",
          );
        }

        const wsjfScore =
          (
            Number.parseInt(String(wsjfValues[0]), 10) +
            Number.parseInt(String(wsjfValues[1]), 10) +
            Number.parseInt(String(wsjfValues[2]), 10)
          ) / jobSize;
        const renderedScore = wsjfScore.toFixed(2).replace(/\.00$/, "");
        const currentScore = readCustomFieldValueFromSchemaEntry(currentPayload, wsjfScoreEntry);
        if (customFieldValueComparable(currentScore) !== customFieldValueComparable(renderedScore)) {
          setCustomFieldPayloadValue(patchPayload, wsjfScoreEntry, renderedScore);
          changesApplied.wsjf_score = {
            from: currentScore,
            to: renderedScore,
          };
        }
      }

      const hasChanges = Object.keys(changesApplied).length > 0;
      if (hasChanges) {
        const previewPayload = buildPatchedWorkPackagePreview(currentPayload, patchPayload);
        const previewStatus = workPackageStatusName(previewPayload).toLowerCase();
        const previewTargetPi = normalizeStringValue(
          readCustomField(previewPayload, config.deliveryCustomFieldTargetPiId),
        );
        const previewIteration = normalizeStringValue(
          readCustomFieldValueFromSchemaEntry(
            previewPayload,
            customFieldMap.get("Iteration"),
          ),
        );
        try {
          validateDeliveryPlanningState({
            iteration: previewIteration ?? currentIteration ?? null,
            status: previewStatus,
            targetPi: previewTargetPi,
            typeName: workPackageTypeName(previewPayload),
          });
        } catch (error) {
          throw new OpenProjectError(
            "validation_failure",
            error.message,
            422,
            "delivery_planning_state_invalid",
          );
        }
        if (DELIVERY_ACTIVE_EXECUTION_CONTRACT_STATUSES.has(previewStatus)) {
          validateDeliveryExecutionContract({
            customFieldMap,
            parentTypeName,
            payload: previewPayload,
            typeName: workPackageTypeName(previewPayload),
          });
        } else if (previewStatus === "done") {
          assertCompletionEvidenceValid(previewPayload?.description?.raw ?? "");
          const doneNarrativeState = buildDoneNarrativeContractState({
            fieldMap: customFieldMap,
            payload: previewPayload,
            typeName: workPackageTypeName(previewPayload),
          });
          if (doneNarrativeState.issues.length > 0) {
            throw new OpenProjectError(
              "validation_failure",
              `Done-state narrative does not meet the ART closeout standard: ${doneNarrativeState.issues.join("; ")}`,
              422,
              "done_narrative_invalid",
            );
          }
        }
      }

      const updatedPayload = hasChanges
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        changesApplied,
        workItem: mapWorkPackageToDeliveryWorkItem(config, updatedPayload, customFieldMap),
        workItemRecordId: updatedPayload.id,
        workItemRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async moveDeliveryWorkItem({
      newParentRecordId,
      recordId,
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
          "Top-level delivery initiatives must not move through the work-item move surface.",
          422,
          "move_initiative_not_allowed",
        );
      }

      if (recordId === newParentRecordId) {
        throw new OpenProjectError(
          "validation_failure",
          "A delivery work item cannot become its own parent.",
          422,
          "self_parent_not_allowed",
        );
      }

      const newParentPayload = await getWorkPackagePayload(newParentRecordId);
      const projectWorkPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
      );
      const projectWorkPackagesById = buildWorkPackageMap(projectWorkPackages);

      if (!projectWorkPackagesById.has(recordId)) {
        throw new OpenProjectError(
          "validation_failure",
          `Delivery work item ${recordId} is not in ${config.deliveryProjectIdentifier}.`,
          422,
          "work_item_outside_delivery_project",
        );
      }

      if (!projectWorkPackagesById.has(newParentRecordId)) {
        throw new OpenProjectError(
          "validation_failure",
          `New parent work item ${newParentRecordId} is not in ${config.deliveryProjectIdentifier}.`,
          422,
          "new_parent_outside_delivery_project",
        );
      }

      const currentType = workPackageTypeName(currentPayload);
      const newParentType = workPackageTypeName(newParentPayload);
      const currentTargetPi = normalizeStringValue(
        readCustomField(currentPayload, config.deliveryCustomFieldTargetPiId),
      );
      const newParentTargetPi = normalizeStringValue(
        readCustomField(newParentPayload, config.deliveryCustomFieldTargetPiId),
      );
      assertMoveAllowedParentType({
        childType: currentType,
        parentType: newParentType,
      });

      if ((currentType === "User story" || currentType === "Task") && !newParentTargetPi) {
        throw new OpenProjectError(
          "validation_failure",
          `${currentType} moves require a PI-committed parent ${newParentType}.`,
          422,
          "new_parent_missing_target_pi",
        );
      }

      const currentInitiativeRootId = findInitiativeRootId(
        projectWorkPackagesById,
        recordId,
      );
      const newParentInitiativeRootId = findInitiativeRootId(
        projectWorkPackagesById,
        newParentRecordId,
      );

      if (!currentInitiativeRootId || !newParentInitiativeRootId) {
        throw new OpenProjectError(
          "backend_contract_drift",
          "Unable to resolve delivery initiative root for move validation.",
          502,
          "missing_initiative_root",
        );
      }

      if (currentInitiativeRootId !== newParentInitiativeRootId) {
        throw new OpenProjectError(
          "validation_failure",
          "Delivery work-item moves must stay within the same delivery initiative.",
          422,
          "cross_initiative_move_not_allowed",
        );
      }

      let ancestorId = newParentRecordId;
      while (ancestorId) {
        if (ancestorId === recordId) {
          throw new OpenProjectError(
            "validation_failure",
            `Cannot move work item ${recordId} under one of its descendants.`,
            422,
            "descendant_parent_not_allowed",
          );
        }

        ancestorId = parseWorkPackageIdFromHref(
          projectWorkPackagesById.get(ancestorId)?._links?.parent?.href,
        );
      }

      const duplicateSibling = projectWorkPackages.find((candidate) => {
        const candidateParentId = parseWorkPackageIdFromHref(candidate?._links?.parent?.href);
        return (
          candidate.id !== recordId &&
          candidateParentId === newParentRecordId &&
          workPackageTypeName(candidate)?.toLowerCase() === currentType?.toLowerCase() &&
          normalizeStringValue(candidate?.subject)?.toLowerCase() ===
            normalizeStringValue(currentPayload?.subject)?.toLowerCase()
        );
      });
      if (duplicateSibling) {
        throw new OpenProjectError(
          "validation_failure",
          `A sibling work item already exists with parent ${newParentRecordId}, type ${currentType}, and subject ${normalizeStringValue(currentPayload?.subject)}.`,
          422,
          "duplicate_delivery_work_item",
        );
      }

      const currentParentId = parseWorkPackageIdFromHref(
        currentPayload?._links?.parent?.href,
      );
      const currentDescription = currentPayload?.description?.raw ?? "";
      let descriptionRaw = currentDescription;
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};
      let noteApplied = null;

      if (currentParentId !== newParentRecordId) {
        patchPayload._links = patchPayload._links ?? {};
        patchPayload._links.parent = {
          href: `/api/v3/work_packages/${newParentRecordId}`,
        };
        changesApplied.parent = {
          from: currentParentId,
          to: newParentRecordId,
        };
      }

      if (typeof workNote === "string" && workNote.trim()) {
        const duplicateWorkNote = operatorWorkNoteAlreadyPresent(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        changesApplied.work_note = {
          applied: !duplicateWorkNote,
        };
        if (descriptionRaw !== currentDescription) {
          patchPayload.description = {
            format: "markdown",
            raw: descriptionRaw,
          };
          noteApplied = "description_section";
          changesApplied.description = {
            from_present: currentDescription.trim().length > 0,
            to_present: descriptionRaw.trim().length > 0,
          };
        }
      }

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        changesApplied,
        noteApplied,
        previousParentWorkItemRecordId: currentParentId,
        workItem: mapWorkPackageToDeliveryWorkItem(config, updatedPayload),
        workItemRecordId: updatedPayload.id,
        workItemRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async manageDeliveryBlocker({
      action,
      blockerDecisionPath,
      blockerDiscoveredOn,
      blockerFollowUpOwner,
      blockerImpact,
      blockerJustification,
      blockerOwner,
      blockerReviewDate,
      blockerStatement,
      recordId,
      resumeStatus,
    }) {
      const normalizedAction = normalizeStringValue(action)?.toLowerCase();
      if (!["set", "clear"].includes(normalizedAction)) {
        throw new OpenProjectError(
          "validation_failure",
          "action must be set or clear.",
          422,
          "invalid_blocker_action",
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

      const currentStatus = workPackageStatusName(currentPayload);
      const formPayload = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const blockerFieldEntries = buildDeliveryBlockerFieldEntryMap(formPayload);
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};

      if (normalizedAction === "set") {
        const requiredFields = {
          blockerDecisionPath: normalizeStringValue(blockerDecisionPath),
          blockerDiscoveredOn: normalizeStringValue(blockerDiscoveredOn),
          blockerImpact: normalizeStringValue(blockerImpact),
          blockerJustification: normalizeStringValue(blockerJustification),
          blockerOwner: normalizeStringValue(blockerOwner),
          blockerStatement: normalizeStringValue(blockerStatement),
        };
        const missingFields = Object.entries(requiredFields)
          .filter(([, value]) => !value)
          .map(([fieldName]) => fieldName);
        if (missingFields.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `Missing blocker fields for action=set: ${missingFields.join(", ")}.`,
            422,
            "missing_blocker_fields",
          );
        }

        const normalizedDecisionPath = requiredFields.blockerDecisionPath;
        const normalizedDiscoveredOn = parseIsoDateString(
          requiredFields.blockerDiscoveredOn,
          "blocker_discovered_on",
        );
        const normalizedReviewDate = parseIsoDateString(
          blockerReviewDate,
          "blocker_review_date",
        );
        const normalizedFollowUpOwner = normalizeStringValue(blockerFollowUpOwner);

        if (normalizedDecisionPath !== "remove") {
          const missingFollowUp = [];
          if (!normalizedFollowUpOwner) {
            missingFollowUp.push("blocker_follow_up_owner");
          }
          if (!normalizedReviewDate) {
            missingFollowUp.push("blocker_review_date");
          }
          if (missingFollowUp.length > 0) {
            throw new OpenProjectError(
              "validation_failure",
              `Missing blocker follow-up fields: ${missingFollowUp.join(", ")}.`,
              422,
              "missing_blocker_follow_up_fields",
            );
          }
        }

        const resolvedBlockedStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
          value: "blocked",
        });

        if (currentStatus.toLowerCase() !== resolvedBlockedStatus.title.toLowerCase()) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.status = resolvedBlockedStatus;
          changesApplied.status = {
            from: currentStatus,
            to: resolvedBlockedStatus.title,
          };
        }

        const setInputs = {
          blockerDecisionPath: normalizedDecisionPath,
          blockerDiscoveredOn: normalizedDiscoveredOn,
          blockerFollowUpOwner: normalizedFollowUpOwner,
          blockerImpact: requiredFields.blockerImpact,
          blockerJustification: requiredFields.blockerJustification,
          blockerOwner: requiredFields.blockerOwner,
          blockerReviewDate: normalizedReviewDate,
          blockerStatement: requiredFields.blockerStatement,
        };

        for (const spec of DELIVERY_BLOCKER_FIELD_SPECS) {
          const nextValue = setInputs[spec.inputName] ?? null;
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(
              currentPayload,
              blockerFieldEntries.get(spec.fieldName),
            ),
          );
          if (currentValue === nextValue) {
            continue;
          }

          await setDeliveryBlockerFieldValue({
            blockerFieldEntries,
            formPayload,
            inputValue: nextValue,
            patchPayload,
            spec,
          });
          changesApplied[spec.responseKey] = {
            from: currentValue,
            to: nextValue,
          };
        }
      } else {
        const normalizedResumeStatus = normalizeStringValue(resumeStatus);
        if (!normalizedResumeStatus) {
          throw new OpenProjectError(
            "validation_failure",
            "resume_status is required for action=clear.",
            422,
            "missing_resume_status",
          );
        }
        if (normalizedResumeStatus.toLowerCase() === "blocked") {
          throw new OpenProjectError(
            "validation_failure",
            "resume_status must not be blocked for action=clear.",
            422,
            "invalid_resume_status",
          );
        }

        const resolvedResumeStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
          value: normalizedResumeStatus,
        });

        if (currentStatus.toLowerCase() !== resolvedResumeStatus.title.toLowerCase()) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.status = resolvedResumeStatus;
          changesApplied.status = {
            from: currentStatus,
            to: resolvedResumeStatus.title,
          };
        }

        for (const spec of DELIVERY_BLOCKER_FIELD_SPECS) {
          const entry = blockerFieldEntries.get(spec.fieldName);
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(currentPayload, entry),
          );
          if (!currentValue) {
            continue;
          }

          if (entry.location === "_links") {
            setCustomFieldPayloadValue(
              patchPayload,
              entry,
              {
                href: null,
                title: null,
              },
            );
          } else {
            setCustomFieldPayloadValue(patchPayload, entry, null);
          }
          changesApplied[spec.responseKey] = {
            from: currentValue,
            to: null,
          };
        }
      }

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        actionApplied: normalizedAction,
        blocker: readDeliveryBlockerValues(updatedPayload, blockerFieldEntries),
        changesApplied,
        workItem: mapWorkPackageToDeliveryWorkItem(config, updatedPayload),
        workItemRecordId: updatedPayload.id,
        workItemRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async manageDeliveryDependency({
      action,
      clearDescription = false,
      clearLag = false,
      dependsOnRecordId,
      description,
      lag,
      recordId,
    }) {
      const normalizedAction = normalizeStringValue(action)?.toLowerCase();
      if (!["set", "clear"].includes(normalizedAction)) {
        throw new OpenProjectError(
          "validation_failure",
          "action must be set or clear.",
          422,
          "invalid_dependency_action",
        );
      }

      if (recordId === dependsOnRecordId) {
        throw new OpenProjectError(
          "validation_failure",
          "A work item cannot depend on itself.",
          422,
          "self_dependency_not_allowed",
        );
      }

      if (lag !== undefined && clearLag) {
        throw new OpenProjectError(
          "validation_failure",
          "lag and clear_lag=true cannot be used together.",
          422,
          "dependency_lag_conflict",
        );
      }

      if (description !== undefined && clearDescription) {
        throw new OpenProjectError(
          "validation_failure",
          "description and clear_description=true cannot be used together.",
          422,
          "dependency_description_conflict",
        );
      }

      const targetPayload = await getWorkPackagePayload(recordId);
      const dependsOnPayload = await getWorkPackagePayload(dependsOnRecordId);
      const projectWorkPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
        {
          includeAllStatuses: true,
        },
      );
      const projectWorkPackagesById = buildWorkPackageMap(projectWorkPackages);

      if (!projectWorkPackagesById.has(recordId)) {
        throw new OpenProjectError(
          "validation_failure",
          `Delivery work item ${recordId} is not in ${config.deliveryProjectIdentifier}.`,
          422,
          "target_outside_delivery_project",
        );
      }

      if (!projectWorkPackagesById.has(dependsOnRecordId)) {
        throw new OpenProjectError(
          "validation_failure",
          `Dependency work item ${dependsOnRecordId} is not in ${config.deliveryProjectIdentifier}.`,
          422,
          "dependency_outside_delivery_project",
        );
      }

      const relationSummary = (relationPayload) => ({
        id: relationPayload?.id ?? null,
        relation_type: "follows",
        lag:
          typeof relationPayload?.lag === "number"
            ? relationPayload.lag
            : null,
        description:
          normalizeStringValue(relationPayload?.description?.raw) ??
          normalizeStringValue(relationPayload?.description) ??
          null,
        depends_on: {
          id: dependsOnRecordId,
          record_ref: `openproject://work_packages/${dependsOnRecordId}`,
          subject: dependsOnPayload.subject,
          status: workPackageStatusName(dependsOnPayload),
        },
        target: {
          id: recordId,
          record_ref: `openproject://work_packages/${recordId}`,
          subject: targetPayload.subject,
          status: workPackageStatusName(targetPayload),
        },
      });

      const matchingRelations = (await listWorkPackageRelations(recordId))
        .filter((payload) => {
          const relation = mapRelationPayload(payload);
          return (
            relation.relationType === "follows" &&
            relation.fromId === dependsOnRecordId &&
            relation.toId === recordId
          );
        })
        .sort((left, right) => left.id - right.id);

      if (normalizedAction === "clear") {
        const removedRelationIds = matchingRelations
          .map((relation) => relation.id)
          .filter((relationId) => relationId !== null && relationId !== undefined);
        for (const relationId of removedRelationIds) {
          await deleteRelationPayload(relationId);
        }

        return {
          actionApplied: normalizedAction,
          changesApplied: {},
          dependsOnWorkItemRecordId: dependsOnRecordId,
          relation: {
            relation_type: "follows",
            depends_on: {
              id: dependsOnRecordId,
              record_ref: `openproject://work_packages/${dependsOnRecordId}`,
              subject: dependsOnPayload.subject,
              status: workPackageStatusName(dependsOnPayload),
            },
            target: {
              id: recordId,
              record_ref: `openproject://work_packages/${recordId}`,
              subject: targetPayload.subject,
              status: workPackageStatusName(targetPayload),
            },
          },
          removedCount: removedRelationIds.length,
          removedRelationIds,
          targetWorkItemRecordId: recordId,
          updated: false,
        };
      }

      const parsedLag = parseOptionalInteger(lag, "lag");
      const desiredLag = clearLag ? null : parsedLag;
      const desiredDescription = clearDescription
        ? null
        : normalizeStringValue(description);

      let created = false;
      let updated = false;
      const removedDuplicateRelationIds = [];
      const changesApplied = {};
      let relationPayload = matchingRelations[0] ?? null;

      if (!relationPayload) {
        relationPayload = await createWorkPackageRelation({
          description: desiredDescription,
          fromRecordId: dependsOnRecordId,
          lag: desiredLag,
          toRecordId: recordId,
        });
        created = true;
      } else {
        const currentLag =
          typeof relationPayload?.lag === "number" ? relationPayload.lag : null;
        const currentDescription =
          normalizeStringValue(relationPayload?.description?.raw) ??
          normalizeStringValue(relationPayload?.description);
        const patchPayload = {};

        if (lag !== undefined || clearLag) {
          if (currentLag !== desiredLag) {
            patchPayload.lag = desiredLag;
            changesApplied.lag = {
              from: currentLag,
              to: desiredLag,
            };
          }
        }

        if (description !== undefined || clearDescription) {
          if (currentDescription !== desiredDescription) {
            patchPayload.description = desiredDescription;
            changesApplied.description = {
              from: currentDescription,
              to: desiredDescription,
            };
          }
        }

        if (Object.keys(patchPayload).length > 0) {
          relationPayload = await patchRelationPayload(relationPayload.id, patchPayload);
          updated = true;
        }
      }

      for (const duplicateRelation of matchingRelations.slice(1)) {
        if (duplicateRelation.id === null || duplicateRelation.id === undefined) {
          continue;
        }
        await deleteRelationPayload(duplicateRelation.id);
        removedDuplicateRelationIds.push(duplicateRelation.id);
      }

      return {
        actionApplied: normalizedAction,
        changesApplied,
        created,
        dependsOnWorkItemRecordId: dependsOnRecordId,
        relation: relationSummary(relationPayload),
        removedDuplicateRelationIds,
        targetWorkItemRecordId: recordId,
        updated,
      };
    },

    async manageDeliveryParking({
      action,
      parkDecision,
      parkReason,
      parkReviewDate,
      recordId,
      resumeStatus,
      retirementReason,
      workNote,
      workNoteAuthor,
    }) {
      const normalizedAction = normalizeStringValue(action)?.toLowerCase();
      if (!["park", "resume"].includes(normalizedAction)) {
        throw new OpenProjectError(
          "validation_failure",
          "action must be park or resume.",
          422,
          "invalid_parking_action",
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

      const currentStatus = workPackageStatusName(currentPayload);
      const formPayload = await getWorkPackageFormPayload(
        recordId,
        currentPayload.lockVersion,
      );
      const parkingFieldEntries = buildDeliveryParkingFieldEntryMap(formPayload);
      const blockerFieldEntries = buildDeliveryBlockerFieldEntryMap(formPayload);
      const currentDescription = currentPayload?.description?.raw ?? "";
      let descriptionRaw = currentDescription;
      const patchPayload = {
        lockVersion: currentPayload.lockVersion,
      };
      const changesApplied = {};
      let noteApplied = null;

      if (normalizedAction === "park") {
        const normalizedParkDecision = normalizeStringValue(parkDecision);
        const normalizedParkReason = normalizeStringValue(parkReason);

        const missingFields = [];
        if (!normalizedParkDecision) {
          missingFields.push("park_decision");
        }
        if (!normalizedParkReason) {
          missingFields.push("park_reason");
        }
        if (missingFields.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `Missing parking fields for action=park: ${missingFields.join(", ")}.`,
            422,
            "missing_parking_fields",
          );
        }

        if (!["defer", "retire"].includes(normalizedParkDecision)) {
          throw new OpenProjectError(
            "validation_failure",
            "park_decision must be defer or retire.",
            422,
            "invalid_park_decision",
          );
        }

        const normalizedReviewDate = parseIsoDateString(
          parkReviewDate,
          "park_review_date",
        );
        const normalizedRetirementReason = normalizeStringValue(retirementReason);

        if (normalizedParkDecision === "defer") {
          if (!normalizedReviewDate) {
            throw new OpenProjectError(
              "validation_failure",
              "park_review_date is required when park_decision=defer.",
              422,
              "missing_park_review_date",
            );
          }
          if (normalizedRetirementReason) {
            throw new OpenProjectError(
              "validation_failure",
              "retirement_reason must not be provided when park_decision=defer.",
              422,
              "unexpected_retirement_reason",
            );
          }
        }

        if (normalizedParkDecision === "retire") {
          if (!normalizedRetirementReason) {
            throw new OpenProjectError(
              "validation_failure",
              "retirement_reason is required when park_decision=retire.",
              422,
              "missing_retirement_reason",
            );
          }
          if (normalizedReviewDate) {
            throw new OpenProjectError(
              "validation_failure",
              "park_review_date must not be provided when park_decision=retire.",
              422,
              "unexpected_park_review_date",
            );
          }
        }

        const targetStatusValue = normalizedParkDecision === "retire"
          ? "retired"
          : "parked";
        const resolvedTargetStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
          value: targetStatusValue,
        });

        if (currentStatus.toLowerCase() !== resolvedTargetStatus.title.toLowerCase()) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.status = resolvedTargetStatus;
          changesApplied.status = {
            from: currentStatus,
            to: resolvedTargetStatus.title,
          };
        }

        const setInputs = {
          parkDecision: normalizedParkDecision,
          parkReason: normalizedParkReason,
          parkReviewDate: normalizedParkDecision === "defer" ? normalizedReviewDate : null,
          retirementReason:
            normalizedParkDecision === "retire" ? normalizedRetirementReason : null,
        };

        for (const spec of DELIVERY_PARKING_FIELD_SPECS) {
          const nextValue = setInputs[spec.inputName] ?? null;
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(
              currentPayload,
              parkingFieldEntries.get(spec.fieldName),
            ),
          );
          if (currentValue === nextValue) {
            continue;
          }

          await setDeliveryParkingFieldValue({
            formPayload,
            inputValue: nextValue,
            parkingFieldEntries,
            patchPayload,
            spec,
          });
          changesApplied[spec.responseKey] = {
            from: currentValue,
            to: nextValue,
          };
        }

        const clearedBlockerFields = [];
        for (const spec of DELIVERY_BLOCKER_FIELD_SPECS) {
          const entry = blockerFieldEntries.get(spec.fieldName);
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(currentPayload, entry),
          );
          if (!currentValue) {
            continue;
          }

          if (entry.location === "_links") {
            setCustomFieldPayloadValue(
              patchPayload,
              entry,
              {
                href: null,
                title: null,
              },
            );
          } else {
            setCustomFieldPayloadValue(patchPayload, entry, null);
          }
          clearedBlockerFields.push(spec.responseKey);
        }
        if (clearedBlockerFields.length > 0) {
          changesApplied.blocker_fields_cleared = clearedBlockerFields;
        }
      } else {
        const normalizedResumeStatus = normalizeStringValue(resumeStatus);
        if (!normalizedResumeStatus) {
          throw new OpenProjectError(
            "validation_failure",
            "resume_status is required for action=resume.",
            422,
            "missing_resume_status",
          );
        }
        if (DELIVERY_INACTIVE_STATUSES.has(normalizedResumeStatus.toLowerCase())) {
          throw new OpenProjectError(
            "validation_failure",
            "resume_status must not be parked or retired.",
            422,
            "invalid_resume_status",
          );
        }

        const resolvedResumeStatus = await resolveAllowedValueLink({
          baseUrl: config.baseUrl,
          executeRequest: executeRequestWithRetry,
          fieldNames: ["status"],
          fieldLabel: "status",
          formPayload,
          requestHeaders,
          value: normalizedResumeStatus,
        });

        if (currentStatus.toLowerCase() !== resolvedResumeStatus.title.toLowerCase()) {
          patchPayload._links = patchPayload._links ?? {};
          patchPayload._links.status = resolvedResumeStatus;
          changesApplied.status = {
            from: currentStatus,
            to: resolvedResumeStatus.title,
          };
        }

        for (const spec of DELIVERY_PARKING_FIELD_SPECS) {
          const entry = parkingFieldEntries.get(spec.fieldName);
          const currentValue = normalizeStringValue(
            readCustomFieldValueFromSchemaEntry(currentPayload, entry),
          );
          if (!currentValue) {
            continue;
          }

          await setDeliveryParkingFieldValue({
            formPayload,
            inputValue: null,
            parkingFieldEntries,
            patchPayload,
            spec,
          });
          changesApplied[spec.responseKey] = {
            from: currentValue,
            to: null,
          };
        }
      }

      if (typeof workNote === "string" && workNote.trim()) {
        const duplicateWorkNote = operatorWorkNoteAlreadyPresent(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        changesApplied.work_note = {
          applied: !duplicateWorkNote,
        };
        if (descriptionRaw !== currentDescription) {
          patchPayload.description = {
            format: "markdown",
            raw: descriptionRaw,
          };
          noteApplied = "description_section";
          changesApplied.description = {
            from_present: currentDescription.trim().length > 0,
            to_present: descriptionRaw.trim().length > 0,
          };
        }
      }

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        actionApplied: normalizedAction,
        changesApplied,
        noteApplied,
        parking: readDeliveryParkingValues(updatedPayload, parkingFieldEntries),
        workItem: mapWorkPackageToDeliveryWorkItem(config, updatedPayload),
        workItemRecordId: updatedPayload.id,
        workItemRecordRef: `openproject://work_packages/${updatedPayload.id}`,
      };
    },

    async getDeliveryExecutionSummary({
      recordId,
      includeDone = true,
      includeParked = true,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone,
        includeInactive: includeParked,
        initiativeId: recordId,
        state,
      });

      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
        executionSummary: {
          ...initiativeSummary,
          summary: {
            ...initiativeSummary.summary,
            include_parked: includeParked,
          },
        },
      };
    },

    async listDeliveryInitiatives({
      includeDone = true,
      includeInactive = false,
    }) {
      const state = await buildDeliveryProjectState();
      const initiatives = state.topLevelEpics
        .map((epic) =>
          buildDeliveryInitiativeSummary({
            includeDone,
            includeInactive,
            initiativeId: epic.id,
            state,
          }))
        .filter((initiative) => {
          if (!includeDone && initiative.epic.status === "done") {
            return false;
          }

          if (!includeInactive && initiative.epic.status === "retired") {
            return false;
          }

          return true;
        });

      const portfolioNodes = initiatives.flatMap((initiative) =>
        flattenDeliveryTree(initiative.execution_tree).filter(
          (node) => node.id !== initiative.epic.id,
        ));
      const portfolioPiObjectives = portfolioNodes.filter(
        (node) => node.type === "PI Objective",
      );
      const portfolioRisks = portfolioNodes.filter((node) => node.type === "Risk");

      return {
        initiatives,
        project: {
          identifier: config.deliveryProjectIdentifier,
        },
        summary: {
          active_initiatives: initiatives.filter(
            (initiative) =>
              !["done", "parked", "retired"].includes(initiative.epic.status.toLowerCase()),
          ).length,
          blocked_initiatives: initiatives.filter(
            (initiative) => initiative.summary.blocked_count > 0,
          ).length,
          by_delivery_team: countNodesBy(portfolioNodes, "delivery_team"),
          by_iteration: countNodesBy(portfolioNodes, "iteration"),
          by_pm2_phase: countNodesBy(initiatives.map((initiative) => initiative.epic), "pm2_phase"),
          by_status: countNodesBy(initiatives.map((initiative) => initiative.epic), "status"),
          by_target_pi: countNodesBy(initiatives.map((initiative) => initiative.epic), "target_pi"),
          closeout_ready_count: initiatives.filter(
            (initiative) => initiative.closeout_ready,
          ).length,
          cross_initiative_dependency_count: state.dependencyRelations.filter(
            (relation) =>
              relation.depends_on.top_level_epic_id !== relation.target.top_level_epic_id,
          ).length,
          dependency_count: state.dependencyRelations.length,
          include_done: includeDone,
          include_inactive: includeInactive,
          inspect_and_adapt_recorded_count: initiatives.filter(
            (initiative) => initiative.epic.inspect_and_adapt_actions_present,
          ).length,
          pi_objective_total: portfolioPiObjectives.length,
          pi_objectives_by_review_outcome: countNodesBy(
            portfolioPiObjectives,
            "pi_objective_review_outcome",
          ),
          pi_objectives_by_type: countNodesBy(portfolioPiObjectives, "pi_objective_type"),
          planned_business_value_total: portfolioPiObjectives.reduce(
            (total, objective) =>
              total + Number.parseInt(objective.planned_business_value ?? 0, 10),
            0,
          ),
          actual_business_value_total: portfolioPiObjectives.reduce(
            (total, objective) =>
              total + Number.parseInt(objective.actual_business_value ?? 0, 10),
            0,
          ),
          ready_without_contract_total: initiatives.reduce(
            (total, initiative) => total + initiative.summary.ready_without_contract_count,
            0,
          ),
          retired_descendant_total: initiatives.reduce(
            (total, initiative) => total + initiative.summary.retired_count,
            0,
          ),
          retired_initiatives: initiatives.filter(
            (initiative) => initiative.epic.status.toLowerCase() === "retired",
          ).length,
          risk_total: portfolioRisks.length,
          system_demo_recorded_count: initiatives.filter(
            (initiative) => initiative.epic.system_demo_evidence_present,
          ).length,
          total_initiatives: initiatives.length,
          unresolved_dependency_count: state.unresolvedDependencyRelations.length,
        },
      };
    },

    async getDeliveryProjectQualityPack() {
      const state = await buildDeliveryProjectState();
      const qualityPack = buildDeliveryProjectQualityPack({ state });
      return {
        project: qualityPack.project,
        qualityPack,
      };
    },

    async getDeliveryWorkflowHealth() {
      const state = await buildDeliveryProjectState();
      const initiatives = state.topLevelEpics.map((epic) =>
        buildDeliveryInitiativeSummary({
          includeDone: true,
          includeInactive: true,
          initiativeId: epic.id,
          state,
        }),
      );
      const qualityPack = buildDeliveryProjectQualityPack({ state });

      return {
        project: qualityPack.project,
        portfolio_summary: {
          active_initiatives: initiatives.filter(
            (initiative) =>
              !["done", "parked", "retired"].includes(
                initiative.epic.status.toLowerCase(),
              ),
          ).length,
          by_pm2_phase: countNodesBy(
            initiatives.map((initiative) => initiative.epic),
            "pm2_phase",
          ),
          by_status: countNodesBy(
            initiatives.map((initiative) => initiative.epic),
            "status",
          ),
          by_target_pi: countNodesBy(
            initiatives.map((initiative) => initiative.epic),
            "target_pi",
          ),
          closeout_ready_count: initiatives.filter(
            (initiative) => initiative.closeout_ready,
          ).length,
          inspect_and_adapt_recorded_count: initiatives.filter(
            (initiative) => initiative.epic.inspect_and_adapt_actions_present,
          ).length,
          ready_for_closing_count: initiatives.filter(
            (initiative) => initiative.closing_ready,
          ).length,
          ready_for_retirement_count: initiatives.filter(
            (initiative) => initiative.retirement_ready,
          ).length,
          system_demo_recorded_count: initiatives.filter(
            (initiative) => initiative.epic.system_demo_evidence_present,
          ).length,
          total_initiatives: initiatives.length,
        },
        workflow_health: {
          compatible_views: qualityPack.compatible_views,
          pm2_phase: qualityPack.projection_health.pm2_phase,
          roadmap: qualityPack.projection_health.roadmap,
          summary: {
            healthy:
              qualityPack.summary.pm2_projection_drift_count === 0 &&
              qualityPack.summary.roadmap_projection_drift_count === 0,
            pm2_projection_drift_count:
              qualityPack.summary.pm2_projection_drift_count,
            ready_for_closing_count: initiatives.filter(
              (initiative) => initiative.closing_ready,
            ).length,
            ready_for_closeout_count: initiatives.filter(
              (initiative) => initiative.closeout_ready,
            ).length,
            ready_for_retirement_count: initiatives.filter(
              (initiative) => initiative.retirement_ready,
            ).length,
            roadmap_projection_drift_count:
              qualityPack.summary.roadmap_projection_drift_count,
          },
        },
      };
    },

    async getDeliveryPlanningSummary({
      includeDone = false,
      includeInactive = false,
      recordId,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone,
        includeInactive,
        initiativeId: recordId,
        state,
      });

      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
        planningSummary: buildPlanningSummary({ initiativeSummary }),
      };
    },

    async getDeliveryPiObjectives({
      recordId,
      targetPi = null,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone: true,
        includeInactive: true,
        initiativeId: recordId,
        state,
      });
      let objectives = initiativeSummary.pi_objectives;
      if (targetPi) {
        objectives = objectives.filter((objective) => objective.target_pi === targetPi);
      }

      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
        piObjectives: {
          epic: {
            id: initiativeSummary.epic.id,
            record_ref: initiativeSummary.epic.record_ref,
            status: initiativeSummary.epic.status,
            subject: initiativeSummary.epic.subject,
          },
          objectives,
          summary: {
            actual_business_value_total: objectives.reduce(
              (total, objective) =>
                total + Number.parseInt(objective.actual_business_value ?? 0, 10),
              0,
            ),
            by_delivery_team: countNodesBy(objectives, "delivery_team"),
            by_iteration: countNodesBy(objectives, "iteration"),
            by_pi_objective_type: countNodesBy(objectives, "pi_objective_type"),
            by_review_outcome: countNodesBy(objectives, "pi_objective_review_outcome"),
            by_status: countNodesBy(objectives, "status"),
            by_target_pi: countNodesBy(objectives, "target_pi"),
            committed_count: objectives.filter(
              (objective) => objective.pi_objective_type === "Committed",
            ).length,
            missing_acceptance_criteria_count: objectives.filter(
              (objective) =>
                objective.ready_contract_missing_fields.includes("Acceptance Criteria"),
            ).length,
            missing_ready_contract_count: objectives.filter(
              (objective) => !objective.ready_contract_satisfied,
            ).length,
            objective_count: objectives.length,
            planned_business_value_total: objectives.reduce(
              (total, objective) =>
                total + Number.parseInt(objective.planned_business_value ?? 0, 10),
              0,
            ),
            review_missing_count: objectives.filter(
              (objective) => !objective.pi_objective_review_outcome,
            ).length,
            review_recorded_count: objectives.filter(
              (objective) => Boolean(objective.pi_objective_review_outcome),
            ).length,
            stretch_count: objectives.filter(
              (objective) => objective.pi_objective_type === "Stretch",
            ).length,
            target_pi: targetPi,
          },
        },
      };
    },

    async getDeliveryCloseoutReadiness({
      recordId,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone: true,
        includeInactive: true,
        initiativeId: recordId,
        state,
      });

      return {
        closeoutReadiness: {
          blocked_items: initiativeSummary.blocked_items,
          closing_reasons: initiativeSummary.closing_reasons,
          completed_with_weak_evidence: initiativeSummary.completed_with_weak_evidence,
          completed_with_weak_done_narrative:
            initiativeSummary.completed_with_weak_done_narrative,
          completed_without_evidence: initiativeSummary.completed_without_evidence,
          completed_without_owner: initiativeSummary.completed_without_owner,
          epic: initiativeSummary.epic,
          initiative_review: initiativeSummary.initiative_review,
          open_descendants: initiativeSummary.open_descendants,
          parked_items: initiativeSummary.parked_items,
          ready_for_closing: initiativeSummary.closing_ready,
          ready_for_closeout: initiativeSummary.closeout_ready,
          ready_for_retirement: initiativeSummary.retirement_ready,
          reasons: initiativeSummary.closeout_reasons,
          retirement_reasons: initiativeSummary.retirement_reasons,
          retired_items: initiativeSummary.retired_items,
          summary: {
            blocked_count: initiativeSummary.summary.blocked_count,
            by_assignee: initiativeSummary.summary.by_assignee,
            by_owner_repo: initiativeSummary.summary.by_owner_repo,
            by_responsible: initiativeSummary.summary.by_responsible,
            by_status: initiativeSummary.summary.by_status,
            by_target_pi: initiativeSummary.summary.by_target_pi,
            by_type: initiativeSummary.summary.by_type,
            completed_with_weak_evidence_count:
              initiativeSummary.summary.completed_with_weak_evidence_count,
            completed_with_weak_done_narrative_count:
              initiativeSummary.summary.completed_with_weak_done_narrative_count,
            completed_without_evidence_count:
              initiativeSummary.summary.completed_without_evidence_count,
            completed_without_owner_count:
              initiativeSummary.summary.completed_without_owner_count,
            open_descendant_count: initiativeSummary.summary.open_descendant_count,
            parked_count: initiativeSummary.summary.parked_count,
            retired_count: initiativeSummary.summary.retired_count,
            total_descendants: initiativeSummary.summary.total_items,
          },
        },
        deliveryRecordId: recordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
      };
    },

    async getDeliveryInitiativeReviewPack({
      recordId,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone: true,
        includeInactive: true,
        initiativeId: recordId,
        state,
      });
      const staleOpenCandidates = buildStaleOpenCandidates({
        executionTree: initiativeSummary.execution_tree,
        initiativeId: recordId,
      });

      return {
        deliveryRecordId: recordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
        reviewPack: {
          blocked_items: initiativeSummary.blocked_items,
          epic: initiativeSummary.epic,
          initiative_review: initiativeSummary.initiative_review,
          quality_drift: {
            completed_with_weak_evidence:
              initiativeSummary.completed_with_weak_evidence,
            completed_with_weak_done_narrative:
              initiativeSummary.completed_with_weak_done_narrative,
            completed_without_evidence: initiativeSummary.completed_without_evidence,
            completed_without_owner: initiativeSummary.completed_without_owner,
            ready_without_contract: initiativeSummary.ready_without_contract,
          },
          stale_open_candidates: staleOpenCandidates,
          summary: {
            blocked_count: initiativeSummary.summary.blocked_count,
            completed_with_weak_evidence_count:
              initiativeSummary.summary.completed_with_weak_evidence_count,
            completed_with_weak_done_narrative_count:
              initiativeSummary.summary.completed_with_weak_done_narrative_count,
            completed_without_evidence_count:
              initiativeSummary.summary.completed_without_evidence_count,
            completed_without_owner_count:
              initiativeSummary.summary.completed_without_owner_count,
            open_descendant_count: initiativeSummary.summary.open_descendant_count,
            ready_for_closing: initiativeSummary.closing_ready,
            ready_for_closeout: initiativeSummary.closeout_ready,
            ready_for_retirement: initiativeSummary.retirement_ready,
            ready_without_contract_count:
              initiativeSummary.summary.ready_without_contract_count,
            stale_open_candidate_count: staleOpenCandidates.length,
          },
        },
      };
    },

    async getDeliveryWorkItemContinuationContext({
      recordId,
    }) {
      const state = await buildDeliveryProjectState();
      const targetNode = state.nodesById.get(recordId);
      if (!targetNode) {
        throw new OpenProjectError(
          "not_found",
          `Delivery work item ${recordId} was not found in ${config.deliveryProjectIdentifier}.`,
          404,
          "delivery_work_item_not_found",
        );
      }

      const initiativeRecordId = state.topLevelEpicIdFor(recordId);
      if (!initiativeRecordId) {
        throw new OpenProjectError(
          "not_found",
          `Delivery work item ${recordId} is not attached to a delivery initiative epic.`,
          404,
          "delivery_work_item_not_in_initiative",
        );
      }

      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone: true,
        includeInactive: true,
        initiativeId: initiativeRecordId,
        state,
      });

      return {
        continuationContext: buildDeliveryContinuationContext({
          initiativeSummary,
          recordId,
          state,
        }),
        deliveryRecordId: initiativeRecordId,
        deliveryRecordRef: initiativeSummary.epic.record_ref,
        workItemRecordId: recordId,
        workItemRecordRef: targetNode.record_ref,
      };
    },

    async recordDeliverySystemDemo({
      demoDate,
      demoEvidence,
      demoFollowUp,
      demoOutcome,
      demoSummary,
      recordId,
    }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (workPackageTypeName(currentPayload) !== "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "System demo records apply only to Epic initiatives.",
          422,
          "system_demo_requires_epic",
        );
      }

      const formPayload = await getWorkPackageFormPayload(recordId);
      const fieldMap = buildCustomFieldSchemaMap(formPayload);
      const entry = fieldMap.get("System Demo Evidence");
      if (!entry) {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package form is missing custom field System Demo Evidence.",
          502,
          "missing_system_demo_field",
        );
      }

      const currentValue = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(currentPayload, entry),
      );
      const entryBody = [
        `### ${demoDate}`,
        `- Outcome: ${demoOutcome}`,
        `- Summary: ${demoSummary}`,
        `- Evidence: ${demoEvidence}`,
        demoFollowUp ? `- Follow-up: ${demoFollowUp}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const { value: updatedValue, appended } = appendFormattableEntryIfMissing(
        currentValue,
        entryBody,
      );
      const updatedPayload = appended
        ? await patchWorkPackagePayload(
            recordId,
            (() => {
              const patchPayload = {};
              setCustomFieldPayloadValue(
                patchPayload,
                entry,
                normalizePlanCustomValue({
                  field: entry,
                  kind: "text",
                  rawValue: updatedValue,
                }),
              );
              return patchPayload;
            })(),
          )
        : currentPayload;

      return {
        epic: {
          id: updatedPayload.id,
          recordRef: `openproject://work_packages/${updatedPayload.id}`,
          subject: updatedPayload.subject ?? "",
        },
        fieldLength: updatedValue.length,
        recordedEntry: {
          date: demoDate,
          evidence: demoEvidence,
          followUp: demoFollowUp ?? null,
          outcome: demoOutcome,
          summary: demoSummary,
        },
      };
    },

    async recordDeliveryInspectAndAdapt({
      actionItems,
      inspectDate,
      inspectFollowUp,
      inspectSummary,
      recordId,
    }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      if (workPackageTypeName(currentPayload) !== "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Inspect-and-adapt records apply only to Epic initiatives.",
          422,
          "inspect_and_adapt_requires_epic",
        );
      }

      const formPayload = await getWorkPackageFormPayload(recordId);
      const fieldMap = buildCustomFieldSchemaMap(formPayload);
      const entry = fieldMap.get("Inspect & Adapt Actions");
      if (!entry) {
        throw new OpenProjectError(
          "backend_contract_drift",
          "OpenProject work package form is missing custom field Inspect & Adapt Actions.",
          502,
          "missing_inspect_and_adapt_field",
        );
      }

      const currentValue = normalizeStringValue(
        readCustomFieldValueFromSchemaEntry(currentPayload, entry),
      );
      const entryBody = [
        `### ${inspectDate}`,
        `- Summary: ${inspectSummary}`,
        "- Action Items:",
        actionItems,
        inspectFollowUp ? `- Follow-up: ${inspectFollowUp}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const { value: updatedValue, appended } = appendFormattableEntryIfMissing(
        currentValue,
        entryBody,
      );
      const updatedPayload = appended
        ? await patchWorkPackagePayload(
            recordId,
            (() => {
              const patchPayload = {};
              setCustomFieldPayloadValue(
                patchPayload,
                entry,
                normalizePlanCustomValue({
                  field: entry,
                  kind: "text",
                  rawValue: updatedValue,
                }),
              );
              return patchPayload;
            })(),
          )
        : currentPayload;

      return {
        epic: {
          id: updatedPayload.id,
          recordRef: `openproject://work_packages/${updatedPayload.id}`,
          subject: updatedPayload.subject ?? "",
        },
        fieldLength: updatedValue.length,
        recordedEntry: {
          actionItems,
          date: inspectDate,
          followUp: inspectFollowUp ?? null,
          summary: inspectSummary,
        },
      };
    },

    async recordDeliveryPiReview({
      piReviewDate,
      recordId,
      reviews,
      targetPi = null,
    }) {
      const state = await buildDeliveryProjectState({ initiativeRecordId: recordId });
      const initiativeSummary = buildDeliveryInitiativeSummary({
        includeDone: true,
        includeInactive: true,
        initiativeId: recordId,
        state,
      });
      const allowedObjectiveIds = new Set(
        initiativeSummary.pi_objectives.map((objective) => objective.id),
      );
      const updated = [];

      for (const review of reviews) {
        if (!allowedObjectiveIds.has(review.targetWorkPackageId)) {
          throw new OpenProjectError(
            "validation_failure",
            `Work package ${review.targetWorkPackageId} is not a descendant PI Objective of epic ${recordId}.`,
            422,
            "pi_review_target_invalid",
          );
        }

        const currentPayload = await getWorkPackagePayload(review.targetWorkPackageId);
        if (workPackageTypeName(currentPayload) !== "PI Objective") {
          throw new OpenProjectError(
            "validation_failure",
            `Work package ${review.targetWorkPackageId} is not a PI Objective.`,
            422,
            "pi_review_target_type_invalid",
          );
        }

        if (targetPi) {
          const currentTargetPi = normalizeStringValue(
            readDeliveryFieldValue(currentPayload, state.fieldMap, "Target PI"),
          );
          if (currentTargetPi !== targetPi) {
            throw new OpenProjectError(
              "validation_failure",
              `Work package ${review.targetWorkPackageId} does not belong to target PI ${targetPi}.`,
              422,
              "pi_review_target_pi_mismatch",
            );
          }
        }

        const formPayload = await getWorkPackageFormPayload(review.targetWorkPackageId);
        const fieldMap = buildCustomFieldSchemaMap(formPayload);
        const actualValueEntry = fieldMap.get("Actual Business Value");
        const reviewOutcomeEntry = fieldMap.get("PI Objective Review Outcome");
        if (!actualValueEntry || !reviewOutcomeEntry) {
          throw new OpenProjectError(
            "backend_contract_drift",
            "OpenProject work package form is missing PI review custom fields.",
            502,
            "missing_pi_review_fields",
          );
        }

        const patchPayload = {};
        const changes = {};
        const renderedActualValue = String(review.actualBusinessValue);
        const currentActualValue = normalizeStringValue(
          readCustomFieldValueFromSchemaEntry(currentPayload, actualValueEntry),
        );
        if (currentActualValue !== renderedActualValue) {
          setCustomFieldPayloadValue(patchPayload, actualValueEntry, renderedActualValue);
          changes.actual_business_value = {
            from: currentActualValue,
            to: renderedActualValue,
          };
        }

        const currentReviewOutcome = normalizeStringValue(
          readCustomFieldValueFromSchemaEntry(currentPayload, reviewOutcomeEntry),
        );
        if (currentReviewOutcome !== review.reviewOutcome) {
          setCustomFieldPayloadValue(
            patchPayload,
            reviewOutcomeEntry,
            await resolveCustomOptionLink({
              baseUrl: config.baseUrl,
              executeRequest: executeRequestWithRetry,
              fieldId: reviewOutcomeEntry.fieldId,
              formPayload,
              requestHeaders,
              value: review.reviewOutcome,
            }),
          );
          changes.review_outcome = {
            from: currentReviewOutcome,
            to: review.reviewOutcome,
          };
        }

        if (review.reviewNote) {
          const currentDescription = currentPayload?.description?.raw ?? "";
          const currentSection = normalizeStringValue(
            readMarkdownSections(currentDescription).get("PI Review Notes"),
          );
          const reviewEntry = [
            `### ${piReviewDate}`,
            `- Outcome: ${review.reviewOutcome}`,
            `- Actual Business Value: ${renderedActualValue}`,
            `- Note: ${review.reviewNote}`,
          ].join("\n");
          patchPayload.description = {
            format: "markdown",
            raw: replaceOrAppendMarkdownSection(
              currentDescription,
              "PI Review Notes",
              [currentSection, reviewEntry].filter(Boolean).join("\n"),
            ),
          };
        }

        const updatedPayload = Object.keys(patchPayload).length > 0
          ? await patchWorkPackagePayload(review.targetWorkPackageId, patchPayload)
          : currentPayload;
        const finalPayload = Object.keys(patchPayload).length > 0
          ? await getWorkPackagePayload(review.targetWorkPackageId)
          : updatedPayload;
        updated.push({
          changes,
          review_note_recorded: Boolean(review.reviewNote),
          work_package: {
            actual_business_value: readDeliveryFieldValue(
              finalPayload,
              state.fieldMap,
              "Actual Business Value",
            ),
            id: finalPayload.id,
            record_ref: `openproject://work_packages/${finalPayload.id}`,
            review_outcome: normalizeStringValue(
              readDeliveryFieldValue(finalPayload, state.fieldMap, "PI Objective Review Outcome"),
            ),
            status: workPackageStatusName(finalPayload),
            subject: finalPayload.subject ?? "",
            target_pi: normalizeStringValue(
              readDeliveryFieldValue(finalPayload, state.fieldMap, "Target PI"),
            ),
          },
        });
      }

      return {
        epic: {
          id: initiativeSummary.epic.id,
          recordRef: initiativeSummary.epic.record_ref,
          subject: initiativeSummary.epic.subject,
        },
        summary: {
          actualBusinessValueTotal: updated.reduce(
            (total, entry) =>
              total + Number.parseInt(entry.work_package.actual_business_value ?? 0, 10),
            0,
          ),
          byReviewOutcome: countNodesBy(
            updated.map((entry) => ({
              review_outcome: entry.work_package.review_outcome,
            })),
            "review_outcome",
          ),
          reviewDate: piReviewDate,
          targetPi,
          updatedCount: updated.length,
        },
        updated,
      };
    },

    async closeDeliveryInitiative({
      actionItems,
      changedSurfaces,
      completionNote,
      completionSummary,
      demoDate,
      demoEvidence,
      demoFollowUp,
      demoOutcome,
      demoSummary,
      inspectDate,
      inspectFollowUp,
      inspectSummary,
      recordId,
      residualFollowUp,
      testResultEvidence,
      validationEvidence,
    }) {
      const systemDemoResult = await this.recordDeliverySystemDemo({
        demoDate,
        demoEvidence,
        demoFollowUp,
        demoOutcome,
        demoSummary,
        recordId,
      });

      await this.updateDeliveryInitiative({
        pm2Phase: DELIVERY_PM2_CLOSING_PHASE,
        recordId,
      });

      const inspectAndAdaptResult = await this.recordDeliveryInspectAndAdapt({
        actionItems,
        inspectDate,
        inspectFollowUp,
        inspectSummary,
        recordId,
      });

      const currentPayload = await getWorkPackagePayload(recordId);
      if (workPackageTypeName(currentPayload) !== "Epic") {
        throw new OpenProjectError(
          "validation_failure",
          "Guided initiative closeout applies only to Epic initiatives.",
          422,
          "initiative_close_requires_epic",
        );
      }

      const currentDescription = currentPayload?.description?.raw ?? "";
      const completionSections = buildCompletionSections({
        changedSurfaces,
        completionSummary,
        residualFollowUp,
        testResultArtifact: null,
        testResultEvidence,
        validationEvidence,
      });
      const completionSectionState = validateCompletionSections(completionSections);
      if (completionSectionState.issues.length > 0) {
        throw new OpenProjectError(
          "validation_failure",
          `Completion evidence does not meet the ART closeout standard: ${completionSectionState.issues.join("; ")}`,
          422,
          "completion_evidence_invalid",
        );
      }

      let descriptionRaw = currentDescription;
      for (const heading of [
        "Completed Output",
        "Completed Scope",
        "Acceptance Evidence",
        "Verification",
        "Result",
        ...DELIVERY_FORBIDDEN_STRUCTURED_DESCRIPTION_HEADINGS,
      ]) {
        descriptionRaw = removeMarkdownSection(descriptionRaw, heading);
      }

      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Completion Summary",
        completionSummary,
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Changed Surfaces",
        changedSurfaces,
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Test Result Evidence",
        completionSections["Test Result Evidence"],
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Validation Evidence",
        validationEvidence,
      );
      if (residualFollowUp) {
        descriptionRaw = replaceOrAppendMarkdownSection(
          descriptionRaw,
          "Residual Follow-Up",
          residualFollowUp,
        );
      } else {
        descriptionRaw = removeMarkdownSection(descriptionRaw, "Residual Follow-Up");
      }

      if (completionNote) {
        descriptionRaw = appendOperatorWorkNote(descriptionRaw, completionNote, "broker");
      }

      const finalCompletionState = assertCompletionEvidenceValid(descriptionRaw);
      const completionResult = await this.updateDeliveryInitiative({
        description: descriptionRaw,
        recordId,
        status: "done",
      });
      const finalPayload = await getWorkPackagePayload(recordId);
      const finalFormPayload = await getWorkPackageFormPayload(
        recordId,
        finalPayload.lockVersion,
      );
      const fieldMap = buildDeliveryInitiativeFieldEntryMap(finalFormPayload);

      return {
        actionApplied: "close_initiative",
        completionEvidenceState: finalCompletionState,
        deliveryInitiative: mapWorkPackageToDeliveryInitiative(
          config,
          finalPayload,
          fieldMap,
        ),
        deliveryRecordId: finalPayload.id,
        deliveryRecordRef: `openproject://work_packages/${finalPayload.id}`,
        inspectAndAdaptEntry: inspectAndAdaptResult.recordedEntry,
        stepsApplied: {
          inspect_and_adapt_recorded: true,
          initiative_completed: completionResult.changesApplied.status?.to === "done",
          pm2_closing_entered: true,
          system_demo_recorded: true,
        },
        systemDemoEntry: systemDemoResult.recordedEntry,
      };
    },

    async completeDeliveryWorkItem({
      changedSurfaces,
      completionNote,
      completionSummary,
      recordId,
      residualFollowUp,
      testResultArtifact,
      testResultEvidence,
      validationEvidence,
    }) {
      const currentPayload = await getWorkPackagePayload(recordId);
      const typeName = workPackageTypeName(currentPayload);
      const currentDescription = currentPayload?.description?.raw ?? "";
      const formPayload = await getWorkPackageFormPayload(recordId);
      const fieldMap = buildCustomFieldSchemaMap(formPayload);
      const readyState = buildReadyContractState({
        fieldMap,
        payload: currentPayload,
        typeName,
      });
      const blockerActive = DELIVERY_BLOCKER_FIELD_SPECS.some((spec) => {
        const value = readDeliveryFieldValue(currentPayload, fieldMap, spec.fieldName);
        if (Array.isArray(value)) {
          return value.length > 0;
        }

        return value !== null && value !== undefined && `${value}`.trim() !== "";
      });

      if (workPackageStatusName(currentPayload).toLowerCase() === "blocked" || blockerActive) {
        throw new OpenProjectError(
          "validation_failure",
          `Work package ${recordId} still has active blocker state; clear it before completion.`,
          422,
          "completion_blocked",
        );
      }

      if (readyState.missingFields.length > 0) {
        throw new OpenProjectError(
          "validation_failure",
          `Work package ${recordId} cannot complete while required execution fields are missing: ${readyState.missingFields.join(", ")}.`,
          422,
          "completion_fields_missing",
        );
      }

      const projectWorkPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
        {
          includeAllStatuses: true,
        },
      );
      const projectWorkPackagesById = buildWorkPackageMap(projectWorkPackages);
      const childrenByParentId = new Map();
      for (const payload of projectWorkPackages) {
        const parentId = parseWorkPackageIdFromHref(payload?._links?.parent?.href);
        if (!parentId) {
          continue;
        }

        const siblingIds = childrenByParentId.get(parentId) ?? [];
        siblingIds.push(payload.id);
        childrenByParentId.set(parentId, siblingIds);
      }

      const openDescendants = [];
      const descendantQueue = [...(childrenByParentId.get(recordId) ?? [])];
      while (descendantQueue.length > 0) {
        const descendantId = descendantQueue.shift();
        if (!Number.isInteger(descendantId)) {
          continue;
        }

        descendantQueue.push(...(childrenByParentId.get(descendantId) ?? []));
        const descendantPayload = projectWorkPackagesById.get(descendantId);
        if (!descendantPayload) {
          continue;
        }

        const descendantStatus = workPackageStatusName(descendantPayload)
          .trim()
          .toLowerCase();
        if (!DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(descendantStatus)) {
          openDescendants.push({
            id: descendantPayload.id,
            status: workPackageStatusName(descendantPayload),
            subject: descendantPayload.subject ?? "",
          });
        }
      }

      if (openDescendants.length > 0) {
        const renderedDescendants = openDescendants
          .slice(0, 5)
          .map((node) => `#${node.id} (${node.status})`)
          .join(", ");
        const overflowNote =
          openDescendants.length > 5
            ? ` and ${openDescendants.length - 5} more`
            : "";
        throw new OpenProjectError(
          "validation_failure",
          `Work package ${recordId} cannot complete while descendants remain open: ${renderedDescendants}${overflowNote}.`,
          422,
          "completion_open_descendants",
        );
      }

      const completionSections = buildCompletionSections({
        changedSurfaces,
        completionSummary,
        residualFollowUp,
        testResultArtifact,
        testResultEvidence,
        validationEvidence,
      });
      const completionSectionState = validateCompletionSections(completionSections);
      if (completionSectionState.issues.length > 0) {
        throw new OpenProjectError(
          "validation_failure",
          `Completion evidence does not meet the ART closeout standard: ${completionSectionState.issues.join("; ")}`,
          422,
          "completion_evidence_invalid",
        );
      }

      let descriptionRaw = currentDescription;
      for (const heading of [
        "Completed Output",
        "Completed Scope",
        "Acceptance Evidence",
        "Verification",
        "Result",
        ...DELIVERY_FORBIDDEN_STRUCTURED_DESCRIPTION_HEADINGS,
      ]) {
        descriptionRaw = removeMarkdownSection(descriptionRaw, heading);
      }

      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Completion Summary",
        completionSummary,
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Changed Surfaces",
        changedSurfaces,
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Test Result Evidence",
        completionSections["Test Result Evidence"],
      );
      descriptionRaw = replaceOrAppendMarkdownSection(
        descriptionRaw,
        "Validation Evidence",
        validationEvidence,
      );
      if (residualFollowUp) {
        descriptionRaw = replaceOrAppendMarkdownSection(
          descriptionRaw,
          "Residual Follow-Up",
          residualFollowUp,
        );
      } else {
        descriptionRaw = removeMarkdownSection(descriptionRaw, "Residual Follow-Up");
      }

      let completionNoteApplied = false;
      if (completionNote) {
        const duplicateCompletionNote = operatorWorkNoteAlreadyPresent(
          descriptionRaw,
          completionNote,
          "broker",
        );
        descriptionRaw = appendOperatorWorkNote(descriptionRaw, completionNote, "broker");
        completionNoteApplied = !duplicateCompletionNote;
      }

      assertCompletionEvidenceValid(descriptionRaw);

      const patchPayload = {
        description: {
          format: "markdown",
          raw: descriptionRaw,
        },
        percentageDone: 100,
      };
      const currentEstimatedWork = parseDurationToHours(currentPayload?.estimatedTime ?? null);
      const desiredRemainingWork = currentEstimatedWork === null ? null : 0;
      patchPayload.remainingTime = serializeDurationHours(desiredRemainingWork);
      const changes = {};
      const currentPercentComplete =
        currentPayload?.percentageDone === null || currentPayload?.percentageDone === undefined
          ? null
          : Number.parseInt(String(currentPayload.percentageDone), 10);
      if (currentPercentComplete !== 100) {
        changes.percent_complete = {
          from: currentPercentComplete,
          to: 100,
        };
      }

      const currentRemainingWork = parseDurationToHours(currentPayload?.remainingTime ?? null);
      if (currentRemainingWork !== desiredRemainingWork) {
        changes.remaining_work = {
          from: currentRemainingWork,
          to: desiredRemainingWork,
        };
      }

      const resolvedDoneStatus = await resolveAllowedValueLink({
        baseUrl: config.baseUrl,
        executeRequest: executeRequestWithRetry,
        fieldLabel: "status",
        fieldNames: ["status"],
        formPayload,
        requestHeaders,
        value: "done",
      });
      patchPayload._links = {
        status: resolvedDoneStatus,
      };
      if (workPackageStatusName(currentPayload).toLowerCase() !== "done") {
        changes.status = {
          from: workPackageStatusName(currentPayload),
          to: "done",
        };
      }

      if (descriptionRaw.trim() !== currentDescription.trim()) {
        changes.description = {
          from_present: currentDescription.trim().length > 0,
          to_present: descriptionRaw.trim().length > 0,
        };
      }

      const previewPayload = buildPatchedWorkPackagePreview(currentPayload, patchPayload);
      const doneNarrativeState = buildDoneNarrativeContractState({
        fieldMap,
        payload: previewPayload,
        typeName: workPackageTypeName(previewPayload),
      });
      if (doneNarrativeState.issues.length > 0) {
        throw new OpenProjectError(
          "validation_failure",
          `Done-state narrative does not meet the ART closeout standard: ${doneNarrativeState.issues.join("; ")}`,
          422,
          "done_narrative_invalid",
        );
      }

      const updatedPayload = await patchWorkPackagePayload(recordId, patchPayload);
      const replacedAttachments = [];
      const addedAttachments = [];

      if (testResultArtifact) {
        for (const attachment of readAttachmentEntries(updatedPayload).filter(
          (entry) => entry.filename === testResultArtifact.fileName,
        )) {
          replacedAttachments.push({
            filename: attachment.filename,
            id: attachment.id,
          });
          await deleteAttachment(attachment.id);
        }

        addedAttachments.push(
          await createWorkPackageAttachment({
            attachmentContentBase64: testResultArtifact.contentBase64,
            attachmentContentType: testResultArtifact.contentType,
            attachmentDescription: testResultArtifact.description,
            attachmentFileName: testResultArtifact.fileName,
            recordId,
          }),
        );
      }

      const finalPayload = testResultArtifact
        ? await getWorkPackagePayload(recordId)
        : updatedPayload;
      const finalDescription = finalPayload?.description?.raw ?? "";
      const finalCompletionState = completionEvidenceState(finalDescription);

      return {
        attachmentsAdded: addedAttachments,
        attachmentsReplaced: replacedAttachments,
        changes,
        completionEvidenceState: finalCompletionState,
        noteApplied: completionNoteApplied ? "description_section" : null,
        workPackage: {
          attachment_count: readAttachmentEntries(finalPayload).length,
          attachment_filenames: readAttachmentEntries(finalPayload).map(
            (entry) => entry.filename,
          ),
          completion_evidence_sections: finalCompletionState.sections,
          id: finalPayload.id,
          percent_complete:
            typeof finalPayload?.percentageDone === "number"
              ? finalPayload.percentageDone
              : null,
          recordRef: `openproject://work_packages/${finalPayload.id}`,
          remaining_work: parseDurationToHours(finalPayload?.remainingTime ?? null),
          status: workPackageStatusName(finalPayload),
          subject: finalPayload.subject ?? "",
          type: workPackageTypeName(finalPayload),
        },
      };
    },

    async closeStaleOpenDeliveryWorkItem({
      changedSurfaces,
      completionNote,
      completionSummary,
      recordId,
      residualFollowUp,
      staleOpenJustification,
      testResultArtifact,
      testResultEvidence,
      validationEvidence,
    }) {
      const justification = normalizeStringValue(staleOpenJustification);
      if (!justification) {
        throw new OpenProjectError(
          "validation_failure",
          "Stale-open closeout requires a non-empty justification.",
          422,
          "stale_open_justification_missing",
        );
      }

      const state = await buildDeliveryProjectState();
      const targetNode = state.nodesById.get(recordId);
      if (!targetNode) {
        throw new OpenProjectError(
          "not_found",
          `Delivery work item ${recordId} was not found in ${config.deliveryProjectIdentifier}.`,
          404,
          "delivery_work_item_not_found",
        );
      }

      if (DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(targetNode.status.toLowerCase())) {
        throw new OpenProjectError(
          "validation_failure",
          `Work item ${recordId} is already terminal and cannot use the stale-open closeout workflow.`,
          422,
          "stale_open_terminal_item",
        );
      }

      const targetTree = state.buildTree(recordId);
      const childNodes = targetTree.children ?? [];
      if (childNodes.length === 0) {
        throw new OpenProjectError(
          "validation_failure",
          `Work item ${recordId} has no children and is not a stale-open candidate.`,
          422,
          "stale_open_children_missing",
        );
      }

      const openChildren = childNodes.filter(
        (child) => !DELIVERY_CLOSEOUT_TERMINAL_STATUSES.has(child.status.toLowerCase()),
      );
      if (openChildren.length > 0) {
        const renderedChildren = openChildren
          .slice(0, 5)
          .map((child) => `#${child.id} (${child.status})`)
          .join(", ");
        const overflowNote =
          openChildren.length > 5 ? ` and ${openChildren.length - 5} more` : "";
        throw new OpenProjectError(
          "validation_failure",
          `Work item ${recordId} still has open child work and is not stale-open: ${renderedChildren}${overflowNote}.`,
          422,
          "stale_open_children_present",
        );
      }

      const staleOpenNote = [
        completionNote ? completionNote.trim() : null,
        `stale-open closeout justification: ${justification}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const completionResult = await this.completeDeliveryWorkItem({
        changedSurfaces,
        completionNote: staleOpenNote,
        completionSummary,
        recordId,
        residualFollowUp,
        testResultArtifact,
        testResultEvidence,
        validationEvidence,
      });

      return {
        ...completionResult,
        actionApplied: "close_stale_open",
        staleOpenCloseout: {
          childStatusSummary: countNodesBy(childNodes, "status"),
          completedChildCount: childNodes.filter(
            (child) => child.status.toLowerCase() === "done",
          ).length,
          justification,
          retiredChildCount: childNodes.filter(
            (child) => child.status.toLowerCase() === "retired",
          ).length,
        },
      };
    },
  };
}
