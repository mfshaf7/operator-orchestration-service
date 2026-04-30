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

const DELIVERY_PLAN_ITEM_TO_CREATE_INPUT_KEYS = {
  acceptanceCriteria: "acceptance_criteria",
  actualBusinessValue: "actual_business_value",
  assigneeLogin: "assignee_login",
  definitionOfDone: "definition_of_done",
  definitionOfReady: "definition_of_ready",
  deliveryTeam: "delivery_team",
  executionClassification: "execution_classification",
  nfrCategory: "nfr_category",
  ownerRepo: "owner_repo",
  piObjectiveReviewOutcome: "pi_objective_review_outcome",
  piObjectiveType: "pi_objective_type",
  plannedBusinessValue: "planned_business_value",
  responsibleLogin: "responsible_login",
  riskDisposition: "risk_disposition",
  riskOwner: "risk_owner",
  riskReviewDate: "risk_review_date",
  roamState: "roam_state",
  wsjfJobSize: "wsjf_job_size",
  wsjfRiskReductionOpportunityEnablement: "wsjf_rr_oe",
  wsjfTimeCriticality: "wsjf_time_criticality",
  wsjfUserBusinessValue: "wsjf_user_business_value",
};

const DELIVERY_PLAN_ITEM_SUPPORTED_KEYS = new Set([
  "type",
  "subject",
  "status",
  "description",
  "target_pi",
  "iteration",
  "start_date",
  "due_date",
  "estimated_work",
  "remaining_work",
  "percent_complete",
  "assigneeLogin",
  "responsibleLogin",
  "children",
  ...Object.keys(DELIVERY_PLAN_ITEM_TO_CREATE_INPUT_KEYS),
]);

const DELIVERY_PLAN_READY_LEAF_TYPES = new Set([
  "Defect",
  "User story",
]);

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

function planItemToCreateInput(item) {
  const input = {
    parent_work_item_id: "work-item-0",
    type: item.type,
    subject: item.subject,
  };

  for (const key of [
    "description",
    "due_date",
    "estimated_work",
    "iteration",
    "percent_complete",
    "remaining_work",
    "start_date",
    "status",
    "target_pi",
  ]) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      input[key] = item[key];
    }
  }

  for (const [planKey, createKey] of Object.entries(DELIVERY_PLAN_ITEM_TO_CREATE_INPUT_KEYS)) {
    if (Object.prototype.hasOwnProperty.call(item, planKey)) {
      input[createKey] = item[planKey];
    }
  }

  return input;
}

function validatePlanItemSupportedKeys(item, itemPath, issues) {
  const unknownKeys = Object.keys(item).filter(
    (key) => !DELIVERY_PLAN_ITEM_SUPPORTED_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    issues.push(`${itemPath} contains unsupported keys: ${unknownKeys.join(", ")}.`);
  }
}

function validateReadyPlanLeafItem(item, itemPath, issues) {
  const input = planItemToCreateInput(item);
  input.assignee_login ||= "__existing_or_plan_actor__";
  input.responsible_login ||= "__existing_or_plan_actor__";

  const result = validateWorkItemCreateInput(input);
  for (const issue of result.issues) {
    issues.push(`${itemPath}: ${issue}`);
  }
}

function validatePlanItems(items, path, issues) {
  if (!Array.isArray(items)) {
    issues.push(`${path} must be an array`);
    return;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPath = `${path}[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`${itemPath} must be an object`);
      continue;
    }

    validatePlanItemSupportedKeys(item, itemPath, issues);

    const typeName = String(item.type || "").trim();
    const status = String(item.status || "new").trim().toLowerCase();
    if (typeName === "PI Objective" && ACTIVE_CREATE_STATUSES.has(status)) {
      const result = validateWorkItemCreateInput(planItemToCreateInput(item));
      for (const issue of result.issues) {
        issues.push(`${itemPath}: ${issue}`);
      }
    }

    if (DELIVERY_PLAN_READY_LEAF_TYPES.has(typeName) && status === "ready") {
      validateReadyPlanLeafItem(item, itemPath, issues);
    }

    if (Object.prototype.hasOwnProperty.call(item, "children")) {
      validatePlanItems(item.children, `${itemPath}.children`, issues);
    }
  }
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

export function validatePlanApplyInput(envelopeOrInput) {
  const input = normalizeInput(envelopeOrInput);
  const issues = [];
  const plan = input?.plan;

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return {
      issues: ["plan must be an object"],
      valid: false,
    };
  }

  if (plan.schema_version !== 1) {
    issues.push("plan.schema_version must equal 1");
  }

  validatePlanItems(plan.items, "plan.items", issues);

  return {
    issues,
    valid: issues.length === 0,
  };
}
