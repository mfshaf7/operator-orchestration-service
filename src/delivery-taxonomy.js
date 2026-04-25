import { readFileSync } from "node:fs";

export const DELIVERY_CLASSIFICATION_FIELD_NAME = "Execution Classification";

export const DELIVERY_CLASSIFICATION_VALUES = ["Business", "Enabler", "Improvement"];

export const DELIVERY_CLASSIFICATION_REQUIRED_TYPES = new Set([
  "Feature",
  "User story",
]);

export const DELIVERY_PLANNING_WORKFLOW = JSON.parse(
  readFileSync(new URL("./delivery-planning-workflow.json", import.meta.url), "utf8"),
);

export const DELIVERY_BACKLOG_ITERATION_LABEL =
  DELIVERY_PLANNING_WORKFLOW.backlog_iteration_label;

export const DELIVERY_TARGET_PI_REQUIRED_TYPES = new Set(
  DELIVERY_PLANNING_WORKFLOW.planning_sets.target_pi_required_types,
);

export const DELIVERY_ITERATION_REQUIRED_TYPES = new Set(
  DELIVERY_PLANNING_WORKFLOW.planning_sets.iteration_required_when_target_pi_types,
);
export const DELIVERY_FEATURE_LEAF_FRONT_CHILD_TYPES = new Set(
  DELIVERY_PLANNING_WORKFLOW.planning_sets.feature_leaf_front_child_types ?? [],
);

export const DELIVERY_ACTIVE_STATUSES = new Set(
  DELIVERY_PLANNING_WORKFLOW.statuses.active,
);

export const DELIVERY_STRUCTURAL_TYPES = [
  "Epic",
  "PI Objective",
  "Feature",
  "User story",
  "Defect",
  "Task",
  "Milestone",
  "Risk",
];

export const DELIVERY_LEGACY_TYPE_NAMES = ["Enabler"];

export const DELIVERY_ALLOWED_PARENT_TYPES_BY_TYPE = {
  Feature: ["Epic"],
  "PI Objective": ["Epic"],
  Milestone: ["Epic"],
  Risk: ["Epic"],
  "User story": ["Feature"],
  Defect: ["Epic", "Feature", "User story"],
  Task: ["User story", "Defect"],
};

export const DELIVERY_DERIVED_SUBJECT_PREFIX_BY_TYPE = {
  Defect: "Defect",
  Risk: "Risk",
};

export const DELIVERY_DERIVED_SUBJECT_PREFIX_BY_CLASSIFICATION = {
  Enabler: "Enabler",
  Improvement: "Improvement",
};

export const DELIVERY_LEGACY_SUBJECT_PREFIXES = [
  "Feature",
  "Task",
  "User story",
  "PI Objective",
  "Milestone",
];

export const DELIVERY_ALL_KNOWN_SUBJECT_PREFIXES = [
  ...new Set([
    ...DELIVERY_LEGACY_SUBJECT_PREFIXES,
    ...Object.values(DELIVERY_DERIVED_SUBJECT_PREFIX_BY_TYPE),
    ...Object.values(DELIVERY_DERIVED_SUBJECT_PREFIX_BY_CLASSIFICATION),
  ]),
];

export const DELIVERY_SEMANTIC_SUBJECT_PREFIXES = new Set([
  ...Object.values(DELIVERY_DERIVED_SUBJECT_PREFIX_BY_TYPE),
  ...Object.values(DELIVERY_DERIVED_SUBJECT_PREFIX_BY_CLASSIFICATION),
]);

export function normalizeDeliveryClassification(value) {
  const rendered = String(value || "").trim();
  return rendered || null;
}

function escapeDeliveryPrefix(prefix) {
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectDeliverySubjectPrefix(subject) {
  const rendered = String(subject || "");
  return (
    DELIVERY_ALL_KNOWN_SUBJECT_PREFIXES.find((prefix) =>
      new RegExp(`^${escapeDeliveryPrefix(prefix)}:\\s*`, "i").test(
        rendered,
      ),
    ) ?? null
  );
}

export function stripDeliverySubjectPrefix(subject) {
  const prefixPattern = DELIVERY_ALL_KNOWN_SUBJECT_PREFIXES.map((entry) =>
    escapeDeliveryPrefix(entry),
  ).join("|");
  return String(subject || "").replace(
    new RegExp(`^(?:${prefixPattern}):\\s*`, "i"),
    "",
  ).trim();
}

export function derivedDeliverySubjectPrefix({ typeName, classification = null }) {
  if (typeName && DELIVERY_DERIVED_SUBJECT_PREFIX_BY_TYPE[typeName]) {
    return DELIVERY_DERIVED_SUBJECT_PREFIX_BY_TYPE[typeName];
  }
  if (
    classification &&
    DELIVERY_DERIVED_SUBJECT_PREFIX_BY_CLASSIFICATION[classification]
  ) {
    return DELIVERY_DERIVED_SUBJECT_PREFIX_BY_CLASSIFICATION[classification];
  }
  return null;
}

export function renderDeliverySubject({ subject, typeName, classification = null }) {
  const cleaned = stripDeliverySubjectPrefix(subject);
  const prefix = derivedDeliverySubjectPrefix({ typeName, classification });
  return prefix ? `${prefix}: ${cleaned}` : cleaned;
}

export function supportsDeliveryClassification(typeName) {
  return DELIVERY_CLASSIFICATION_REQUIRED_TYPES.has(String(typeName || "").trim());
}

export function inferredDeliveryClassificationFromSubject(subject) {
  const prefix = detectDeliverySubjectPrefix(subject);
  if (prefix === "Enabler" || prefix === "Improvement") {
    return prefix;
  }
  return null;
}

export function resolveDeliveryClassification({
  typeName,
  classification = null,
  subject = "",
}) {
  const normalizedTypeName = String(typeName || "").trim();
  const normalizedClassification = normalizeDeliveryClassification(classification);
  const inferredClassification = inferredDeliveryClassificationFromSubject(subject);

  if (DELIVERY_LEGACY_TYPE_NAMES.includes(normalizedTypeName)) {
    throw new Error(
      `Legacy delivery type ${normalizedTypeName} is no longer allowed; use Feature or User story with Execution Classification instead.`,
    );
  }

  if (supportsDeliveryClassification(normalizedTypeName)) {
    if (
      normalizedClassification &&
      !DELIVERY_CLASSIFICATION_VALUES.includes(normalizedClassification)
    ) {
      throw new Error(
        `Execution Classification ${normalizedClassification} is not allowed for ${normalizedTypeName}.`,
      );
    }

    if (
      normalizedClassification &&
      inferredClassification &&
      normalizedClassification !== inferredClassification
    ) {
      throw new Error(
        `Subject prefix ${inferredClassification} does not match Execution Classification ${normalizedClassification}.`,
      );
    }

    return normalizedClassification ?? inferredClassification ?? "Business";
  }

  if (normalizedClassification) {
    throw new Error(
      `Execution Classification is not allowed for structural type ${normalizedTypeName}.`,
    );
  }

  if (inferredClassification) {
    throw new Error(
      `Subject prefix ${inferredClassification} is only allowed for Feature or User story.`,
    );
  }

  return null;
}

export function validateDeliveryParentType({
  typeName,
  parentTypeName,
}) {
  const normalizedTypeName = String(typeName || "").trim();
  const allowedParentTypes = DELIVERY_ALLOWED_PARENT_TYPES_BY_TYPE[normalizedTypeName] ?? [];
  if (allowedParentTypes.length === 0) {
    return;
  }

  const normalizedParentTypeName = String(parentTypeName || "").trim();
  if (!normalizedParentTypeName || !allowedParentTypes.includes(normalizedParentTypeName)) {
    throw new Error(
      `${normalizedTypeName} must have parent type ${allowedParentTypes.join(", ")}.`,
    );
  }
}

export function resolveDeliveryTaxonomy({
  typeName,
  classification = null,
  parentTypeName = null,
  enforceParentType = false,
  subject,
}) {
  const normalizedTypeName = String(typeName || "").trim();
  const normalizedSubject = String(subject || "").trim();
  if (!normalizedTypeName) {
    throw new Error("Delivery work item type is required.");
  }
  if (!DELIVERY_STRUCTURAL_TYPES.includes(normalizedTypeName)) {
    throw new Error(`Unsupported delivery work item type ${normalizedTypeName}.`);
  }
  if (!normalizedSubject) {
    throw new Error("Delivery work item subject is required.");
  }

  if (enforceParentType) {
    validateDeliveryParentType({
      typeName: normalizedTypeName,
      parentTypeName,
    });
  }
  const resolvedClassification = resolveDeliveryClassification({
    typeName: normalizedTypeName,
    classification,
    subject: normalizedSubject,
  });
  const detectedPrefix = detectDeliverySubjectPrefix(normalizedSubject);
  const expectedPrefix = derivedDeliverySubjectPrefix({
    typeName: normalizedTypeName,
    classification: resolvedClassification,
  });

  if (
    detectedPrefix &&
    DELIVERY_SEMANTIC_SUBJECT_PREFIXES.has(detectedPrefix) &&
    detectedPrefix !== expectedPrefix
  ) {
    throw new Error(
      `Subject prefix ${detectedPrefix} does not match ${normalizedTypeName}${expectedPrefix ? ` (${expectedPrefix})` : ""}.`,
    );
  }

  return {
    classification: resolvedClassification,
    subject: renderDeliverySubject({
      subject: normalizedSubject,
      typeName: normalizedTypeName,
      classification: resolvedClassification,
    }),
    typeName: normalizedTypeName,
  };
}

export function validateDeliveryPlanningState({
  typeName,
  status = "new",
  targetPi = null,
  iteration = null,
}) {
  const normalizedTypeName = String(typeName || "").trim();
  const normalizedStatus = String(status || "new").trim().toLowerCase();
  const normalizedTargetPi = String(targetPi || "").trim();
  const normalizedIteration = String(iteration || "").trim();
  const hasTargetPi = normalizedTargetPi.length > 0;
  const hasIteration = normalizedIteration.length > 0;

  if (!normalizedTypeName || normalizedTypeName === "Epic") {
    return;
  }

  if (DELIVERY_TARGET_PI_REQUIRED_TYPES.has(normalizedTypeName) && !hasTargetPi) {
    throw new Error(
      `${normalizedTypeName} must carry Target PI before it can exist in ART.`,
    );
  }

  if (
    normalizedTypeName === "Defect" &&
    !hasTargetPi &&
    normalizedStatus !== "new"
  ) {
    throw new Error(
      "Defect without Target PI must stay in new backlog posture until committed.",
    );
  }

  if (DELIVERY_ACTIVE_STATUSES.has(normalizedStatus) && !hasTargetPi) {
    throw new Error(
      "Non-Epic work in ready, in-progress, or blocked must carry Target PI.",
    );
  }

  if (
    DELIVERY_ITERATION_REQUIRED_TYPES.has(normalizedTypeName) &&
    hasTargetPi &&
    !hasIteration
  ) {
    throw new Error(
      `${normalizedTypeName} with Target PI must also carry Iteration.`,
    );
  }

  if (hasTargetPi && normalizedIteration === DELIVERY_BACKLOG_ITERATION_LABEL) {
    throw new Error(
      `${normalizedTypeName} with Target PI cannot use the backlog iteration label.`,
    );
  }

  if (
    !hasTargetPi &&
    hasIteration &&
    normalizedIteration !== DELIVERY_BACKLOG_ITERATION_LABEL
  ) {
    throw new Error(
      `${normalizedTypeName} without Target PI cannot use non-backlog Iteration ${normalizedIteration}.`,
    );
  }
}

export function requiredDeliveryNarrativeHeadings({ typeName, classification = null }) {
  switch (typeName) {
    case "Feature":
      return classification === "Enabler"
        ? [
            "What This Enables",
            "Benefit Hypothesis",
            "Scope Boundaries",
            "Execution Context",
          ]
        : [
            "What This Achieves",
            "Benefit Hypothesis",
            "Scope Boundaries",
            "Execution Context",
          ];
    case "User story":
      return classification === "Enabler"
        ? [
            "What This Enables",
            "Why This Matters Now",
            "Evidence Expectation",
            "Execution Context",
          ]
        : [
            "What This Achieves",
            "Why This Matters Now",
            "Evidence Expectation",
            "Execution Context",
          ];
    case "Defect":
      return [
        "What This Corrects",
        "Why This Matters Now",
        "Evidence Expectation",
        "Execution Context",
      ];
    case "Task":
      return [
        "What This Achieves",
        "Why This Matters Now",
        "Evidence Expectation",
        "Execution Context",
      ];
    case "PI Objective":
      return ["Outcome", "Why This PI", "Success Signal", "Execution Context"];
    case "Risk":
      return ["Risk Event", "Impact", "Current Handling", "Execution Context"];
    case "Milestone":
      return ["Exit Condition", "Execution Context"];
    case "Epic":
      return [
        "What This Initiative Achieves",
        "Current PI Focus",
        "Scope Boundaries",
        "Execution Context",
      ];
    default:
      return [];
  }
}
