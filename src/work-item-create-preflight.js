import {
  DELIVERY_ACTIVE_STATUSES,
  DELIVERY_CLASSIFICATION_FIELD_NAME,
  resolveDeliveryTaxonomy,
  validateDeliveryPlanningState,
} from "./delivery-taxonomy.js";
import {
  descriptionStartsWithHeading,
  forbiddenStructuredDescriptionHeadings,
  missingRequiredNarrativeHeadings,
} from "./delivery-narrative.js";

const ACTIVE_CREATE_STATUSES = new Set([
  ...DELIVERY_ACTIVE_STATUSES,
  "parked",
]);

export const DELIVERY_CREATE_ALWAYS_REQUIRED_INPUT_FIELDS = [
  ["parent_work_item_id", "Parent Work Item"],
  ["type", "Type"],
  ["subject", "Subject"],
];

export const DELIVERY_ACTIVE_CREATE_ACTOR_INPUT_FIELDS = [
  ["assignee_login", "Assignee"],
  ["responsible_login", "Responsible"],
];

export const DELIVERY_CREATE_REQUIRED_INPUT_FIELDS_BY_TYPE = {
  Feature: [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["execution_classification", DELIVERY_CLASSIFICATION_FIELD_NAME],
    ["acceptance_criteria", "Acceptance Criteria"],
    ["definition_of_ready", "Definition of Ready"],
    ["definition_of_done", "Definition of Done"],
  ],
  "User story": [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["execution_classification", DELIVERY_CLASSIFICATION_FIELD_NAME],
    ["acceptance_criteria", "Acceptance Criteria"],
    ["definition_of_ready", "Definition of Ready"],
    ["definition_of_done", "Definition of Done"],
  ],
  Defect: [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["acceptance_criteria", "Acceptance Criteria"],
    ["definition_of_ready", "Definition of Ready"],
    ["definition_of_done", "Definition of Done"],
  ],
  Task: [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["acceptance_criteria", "Acceptance Criteria"],
    ["definition_of_ready", "Definition of Ready"],
    ["definition_of_done", "Definition of Done"],
  ],
  "PI Objective": [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["acceptance_criteria", "Acceptance Criteria"],
    ["definition_of_ready", "Definition of Ready"],
    ["definition_of_done", "Definition of Done"],
    ["pi_objective_type", "PI Objective Type"],
    ["planned_business_value", "Planned Business Value"],
    ["actual_business_value", "Actual Business Value"],
  ],
  Risk: [
    ["owner_repo", "Owner Repo"],
    ["delivery_team", "Delivery Team"],
    ["iteration", "Iteration"],
    ["roam_state", "ROAM State"],
    ["risk_owner", "Risk Owner"],
    ["risk_review_date", "Risk Review Date"],
    ["risk_disposition", "Risk Disposition"],
  ],
};

function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function normalizeInput(envelopeOrInput) {
  if (
    envelopeOrInput &&
    typeof envelopeOrInput === "object" &&
    !Array.isArray(envelopeOrInput) &&
    envelopeOrInput.input &&
    typeof envelopeOrInput.input === "object" &&
    !Array.isArray(envelopeOrInput.input)
  ) {
    return envelopeOrInput.input;
  }
  return envelopeOrInput;
}

export function validateWorkItemCreateInput(envelopeOrInput) {
  const input = normalizeInput(envelopeOrInput);
  const issues = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      issues: ["payload must be a JSON object or an { input: ... } envelope"],
      valid: false,
    };
  }

  for (const [key, label] of DELIVERY_CREATE_ALWAYS_REQUIRED_INPUT_FIELDS) {
    if (!hasValue(input[key])) {
      issues.push(`${label}: input.${key} is required`);
    }
  }

  let taxonomy = null;
  if (hasValue(input.type) && hasValue(input.subject)) {
    try {
      taxonomy = resolveDeliveryTaxonomy({
        classification: input.execution_classification,
        enforceParentType: false,
        subject: input.subject,
        typeName: input.type,
      });
    } catch (error) {
      issues.push(`Delivery taxonomy: ${error.message}`);
    }
  }

  const typeName = taxonomy?.typeName ?? String(input.type || "").trim();
  const status = String(input.status || "new").trim().toLowerCase();
  const targetPi = hasValue(input.target_pi) ? String(input.target_pi).trim() : null;
  const iteration = hasValue(input.iteration) ? String(input.iteration).trim() : null;

  if (typeName) {
    try {
      validateDeliveryPlanningState({
        iteration,
        status,
        targetPi,
        typeName,
      });
    } catch (error) {
      issues.push(`Planning state: ${error.message}`);
    }
  }

  if (ACTIVE_CREATE_STATUSES.has(status)) {
    const requiredFields = DELIVERY_CREATE_REQUIRED_INPUT_FIELDS_BY_TYPE[typeName] ?? [];
    for (const [key, label] of requiredFields) {
      if (!hasValue(input[key])) {
        issues.push(`${label}: input.${key} is required for active ${typeName} creation`);
      }
    }

    for (const [key, label] of DELIVERY_ACTIVE_CREATE_ACTOR_INPUT_FIELDS) {
      if (!hasValue(input[key])) {
        issues.push(`${label}: input.${key} is required for active ${typeName} creation`);
      }
    }

    const description = String(input.description || "");
    if (!descriptionStartsWithHeading(description)) {
      issues.push("Description heading start: description must start with a markdown heading");
    }

    const duplicatedStructuredHeadings = forbiddenStructuredDescriptionHeadings(description);
    if (duplicatedStructuredHeadings.length > 0) {
      issues.push(
        `Forbidden structured headings: ${duplicatedStructuredHeadings.join(", ")}`,
      );
    }

    const missingNarrative = missingRequiredNarrativeHeadings(
      description,
      typeName,
      taxonomy?.classification ?? null,
    );
    if (missingNarrative.length > 0) {
      issues.push(`Narrative headings: ${missingNarrative.join(", ")}`);
    }
  }

  return {
    issues,
    valid: issues.length === 0,
  };
}
