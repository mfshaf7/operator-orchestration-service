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
  { inputName: "deliveryTeam", fieldName: "Delivery Team", kind: "string" },
  { inputName: "iteration", fieldName: "Iteration", kind: "string" },
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
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  Enabler: [
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  "User story": [
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  Task: [
    "Delivery Team",
    "Iteration",
    "Acceptance Criteria",
    "Definition of Ready",
    "Definition of Done",
  ],
  "PI Objective": [
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
    "Delivery Team",
    "Iteration",
    "ROAM State",
    "Risk Owner",
    "Risk Review Date",
    "Risk Disposition",
  ],
};

const DELIVERY_MOVE_ALLOWED_PARENT_TYPES_BY_TYPE = {
  Feature: ["Epic"],
  Enabler: ["Epic"],
  Milestone: ["Epic"],
  "PI Objective": ["Epic"],
  Risk: ["Epic"],
  "User story": ["Epic", "Feature", "Enabler"],
  Task: ["Epic", "Feature", "Enabler", "User story"],
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

function parseCreateCustomFieldValue({
  entry,
  formPayload,
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
        fieldId: entry.fieldId,
        formPayload,
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

function mapWorkPackageToDeliveryInitiative(config, payload) {
  const description = payload?.description?.raw ?? "";

  return {
    description,
    descriptionPresent: description.trim().length > 0,
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
    subject: payload?.subject ?? "",
    targetPi: normalizeStringValue(
      readCustomField(payload, config.deliveryCustomFieldTargetPiId),
    ),
    type: workPackageTypeName(payload),
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
    type: workPackageTypeName(payload),
    updatedAt: payload?.updatedAt ?? null,
  };
}

function mapWorkPackageToDeliveryExecutionNode(config, payload) {
  const status = workPackageStatusName(payload);
  const normalizedStatus = status.trim().toLowerCase();

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
    type: workPackageTypeName(payload),
    unresolved_dependency_work_package_ids: [],
  };
}

function buildDeliveryInitiativeFieldEntryMap(formPayload) {
  const customFieldMap = buildCustomFieldSchemaMap(formPayload);
  const initiativeFields = new Map();

  for (const spec of DELIVERY_EPIC_UPDATE_FIELD_SPECS) {
    const entry = customFieldMap.get(spec.fieldName);
    if (!entry) {
      throw new OpenProjectError(
        "backend_contract_drift",
        `OpenProject work package form is missing the ${spec.fieldName} field.`,
        502,
        "missing_initiative_field",
      );
    }
    initiativeFields.set(spec.fieldName, entry);
  }

  return initiativeFields;
}

function buildDeliveryItemFieldMap(formPayload) {
  return buildCustomFieldSchemaMap(formPayload);
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

      offset += count;
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
        resolveCustomOptionLink({
          fieldId: entry.fieldId,
          formPayload,
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
        resolveCustomOptionLink({
          fieldId: entry.fieldId,
          formPayload,
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

      offset += count;
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

    async updateDeliveryInitiative({
      businessObjective,
      description,
      inspectAndAdaptActions,
      nfrCategory,
      pm2Phase,
      recordId,
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
        const currentStatus = workPackageStatusName(currentPayload);
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
              ? resolveCustomOptionLink({
                  fieldId: entry.fieldId,
                  formPayload,
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

      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[0], pm2Phase);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[1], sponsor);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[2], businessObjective);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[3], successCriteria);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[4], systemDemoEvidence);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[5], inspectAndAdaptActions);
      await applyField(DELIVERY_EPIC_UPDATE_FIELD_SPECS[6], nfrCategory);

      const updatedPayload = Object.keys(changesApplied).length > 0
        ? await patchWorkPackagePayload(recordId, patchPayload)
        : currentPayload;

      return {
        changesApplied,
        deliveryInitiative: mapWorkPackageToDeliveryInitiative(config, updatedPayload),
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

      const updateWorkItemFromPlan = async (payload, item, path) => {
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

        for (const spec of DELIVERY_CREATE_CUSTOM_FIELD_SPECS) {
          if (!Object.prototype.hasOwnProperty.call(item, spec.inputName)) {
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
            const desiredValue = normalizeStringValue(item[spec.inputName]);
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
                ? resolveCustomOptionLink({
                    fieldId: entry.fieldId,
                    formPayload,
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
            rawValue: item[spec.inputName],
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

      const createWorkItemFromPlan = async (item, parentPayload, path) => {
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
        const typeName = resolvedType.title;
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
          subject: item.subject.trim(),
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
        for (const spec of DELIVERY_CREATE_CUSTOM_FIELD_SPECS) {
          if (!Object.prototype.hasOwnProperty.call(item, spec.inputName)) {
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
            const desiredValue = normalizeStringValue(item[spec.inputName]);
            setCustomFieldPayloadValue(
              payload,
              entry,
              desiredValue
                ? resolveCustomOptionLink({
                    fieldId: entry.fieldId,
                    formPayload: createForm,
                    value: desiredValue,
                  })
                : entry.location === "_links"
                  ? { href: null, title: null }
                  : null,
            );
            continue;
          }

          const parsedValue = parseCreateCustomFieldValue({
            entry,
            formPayload: createForm,
            kind: spec.kind,
            rawValue: item[spec.inputName],
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

          const parentId = parentPayload.id;
          const existing = currentProjectWorkPackages.find((candidate) => {
            const candidateParentId = parseWorkPackageIdFromHref(candidate?._links?.parent?.href);
            return (
              candidateParentId === parentId &&
              workPackageTypeName(candidate)?.toLowerCase() === item.type.trim().toLowerCase() &&
              normalizeStringValue(candidate?.subject)?.toLowerCase() ===
                item.subject.trim().toLowerCase()
            );
          });
          plannedChildren.push({
            parentId,
            subject: item.subject.trim().toLowerCase(),
            type: item.type.trim().toLowerCase(),
          });

          let nextPayload;
          if (existing) {
            const result = await updateWorkItemFromPlan(existing, item, itemPath);
            nextPayload = result.payload;
            if (Object.keys(result.changesApplied).length > 0) {
              updated.push(recordSummary(nextPayload));
            } else {
              reused.push(recordSummary(nextPayload));
            }
          } else {
            nextPayload = await createWorkItemFromPlan(item, parentPayload, itemPath);
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

    async createDeliveryWorkItem({
      acceptanceCriteria,
      actualBusinessValue,
      assigneeLogin,
      definitionOfDone,
      definitionOfReady,
      deliveryTeam,
      description,
      dueDate,
      estimatedWork,
      iteration,
      nfrCategory,
      parentRecordId,
      percentComplete,
      piObjectiveType,
      plannedBusinessValue,
      remainingWork,
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
      const typeName = resolvedType.title;

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
            normalizedSubject.toLowerCase()
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
        subject: normalizedSubject,
        _links: {
          parent: {
            href: parentHref,
          },
          type: resolvedType,
        },
      };
      const creationApplied = {
        subject: normalizedSubject,
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
        iteration,
        nfrCategory,
        piObjectiveType,
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

        const parsedValue = parseCreateCustomFieldValue({
          entry,
          formPayload: createForm,
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
      if (effectiveStatus.toLowerCase() === "ready") {
        const requiredFieldNames =
          DELIVERY_READY_REQUIRED_FIELD_NAMES_BY_TYPE[typeName] ?? [];
        const missingFieldNames = requiredFieldNames.filter((fieldName) => {
          const entry = customFieldMap.get(fieldName);
          const value = readCustomFieldValueFromSchemaEntry(payload, entry);
          if (Array.isArray(value)) {
            return value.length === 0;
          }
          return value === null || value === undefined || `${value}`.trim() === "";
        });

        if (missingFieldNames.length > 0) {
          throw new OpenProjectError(
            "validation_failure",
            `Work item cannot be created in ready while required fields are missing: ${missingFieldNames.join(", ")}.`,
            422,
            "ready_fields_missing",
          );
        }
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
          ...mapWorkPackageToDeliveryWorkItem(config, responsePayload),
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
      assertMoveAllowedParentType({
        childType: currentType,
        parentType: newParentType,
      });

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
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        patchPayload.description = {
          format: "markdown",
          raw: descriptionRaw,
        };
        noteApplied = "description_section";
        changesApplied.work_note = {
          applied: true,
        };
        if (descriptionRaw !== currentDescription) {
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
        descriptionRaw = appendOperatorWorkNote(
          descriptionRaw,
          workNote,
          workNoteAuthor,
        );
        patchPayload.description = {
          format: "markdown",
          raw: descriptionRaw,
        };
        noteApplied = "description_section";
        changesApplied.work_note = {
          applied: true,
        };
        if (descriptionRaw !== currentDescription) {
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
      includeParked = false,
    }) {
      const workPackages = await listProjectWorkPackages(
        config.deliveryProjectIdentifier,
        {
          includeAllStatuses: true,
        },
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

        if (
          node.id !== recordId &&
          !includeParked &&
          DELIVERY_INACTIVE_STATUSES.has(node.status.trim().toLowerCase())
        ) {
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
      const retiredItems = descendantNodes.filter((node) => node.retired);

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
          retired_items: retiredItems.map((node) => ({
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
            retired_count: retiredItems.length,
            total_items: descendantNodes.length,
            unresolved_dependency_count: unresolvedDependencyRelations.length,
          },
          unresolved_dependency_relations: unresolvedDependencyRelations,
        },
      };
    },
  };
}
