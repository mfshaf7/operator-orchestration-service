export const DELIVERY_REQUIRED_NARRATIVE_HEADINGS_BY_TYPE = {
  Feature: [
    "What This Achieves",
    "Benefit Hypothesis",
    "Scope Boundaries",
    "Execution Context",
  ],
  Enabler: [
    "What This Enables",
    "Benefit Hypothesis",
    "Scope Boundaries",
    "Execution Context",
  ],
  "User story": [
    "What This Achieves",
    "Why This Matters Now",
    "Evidence Expectation",
    "Execution Context",
  ],
  Task: [
    "What This Achieves",
    "Why This Matters Now",
    "Evidence Expectation",
    "Execution Context",
  ],
  "PI Objective": [
    "Outcome",
    "Why This PI",
    "Success Signal",
    "Execution Context",
  ],
  Risk: [
    "Risk Event",
    "Impact",
    "Current Handling",
    "Execution Context",
  ],
  Milestone: [
    "Exit Condition",
    "Execution Context",
  ],
};

export const DELIVERY_FORBIDDEN_STRUCTURED_DESCRIPTION_HEADINGS = [
  "Acceptance Criteria",
  "Definition of Ready",
  "Definition of Done",
];

function normalizeComparisonValue(value) {
  return String(value || "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderContextLabel(label) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function parseExecutionContextSection(body) {
  const renderedBody = String(body || "").trim();
  if (!renderedBody) {
    return {
      issues: ["Execution Context: section body is empty"],
      valuesByLabel: new Map(),
    };
  }

  const valuesByLabel = new Map();
  const issues = [];
  const lines = renderedBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith("- ")) {
      issues.push(`Execution Context: line must be a flat bullet: ${line}`);
      continue;
    }

    const bodyWithoutBullet = line.slice(2).trim();
    const separatorIndex = bodyWithoutBullet.indexOf(":");
    if (separatorIndex <= 0) {
      issues.push(`Execution Context: bullet must use \`- Label: value\`: ${line}`);
      continue;
    }

    const label = bodyWithoutBullet.slice(0, separatorIndex).trim().toLowerCase();
    const value = bodyWithoutBullet.slice(separatorIndex + 1).trim();
    if (!value) {
      issues.push(
        `Execution Context: bullet value is empty for \`${renderContextLabel(label)}:\``,
      );
      continue;
    }

    valuesByLabel.set(label, value);
  }

  return {
    issues,
    valuesByLabel,
  };
}

export function descriptionHeadings(rawDescription) {
  return String(rawDescription || "")
    .match(/^## ([^\n]+)$/gm)
    ?.map((entry) => entry.replace(/^## /, "").trim()) ?? [];
}

export function descriptionStartsWithHeading(rawDescription) {
  return /^## [^\n]+/.test(String(rawDescription || "").trimStart());
}

export function readMarkdownSections(rawDescription) {
  const rendered = String(rawDescription || "").replace(/\r\n/g, "\n");
  const lines = rendered.split("\n");
  const sections = new Map();
  let currentHeading = null;
  let currentLines = [];

  for (const line of lines) {
    const match = line.match(/^## ([^\n]+)$/);
    if (match) {
      if (currentHeading) {
        sections.set(currentHeading, currentLines.join("\n").trim());
      }

      currentHeading = match[1].trim();
      currentLines = [];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    sections.set(currentHeading, currentLines.join("\n").trim());
  }

  return sections;
}

export function forbiddenStructuredDescriptionHeadings(rawDescription) {
  const headings = new Set(descriptionHeadings(rawDescription));
  return DELIVERY_FORBIDDEN_STRUCTURED_DESCRIPTION_HEADINGS.filter((heading) =>
    headings.has(heading),
  );
}

export function missingRequiredNarrativeHeadings(rawDescription, typeName) {
  const requiredHeadings = DELIVERY_REQUIRED_NARRATIVE_HEADINGS_BY_TYPE[typeName] ?? [];
  const headings = new Set(descriptionHeadings(rawDescription));
  return requiredHeadings.filter((heading) => !headings.has(heading));
}

export function validateDoneNarrativeState({
  deliveryTeam,
  iteration,
  ownerRepo,
  parentId,
  rawDescription,
  typeName,
}) {
  const issues = [];
  const renderedDescription = String(rawDescription || "");

  if (!descriptionStartsWithHeading(renderedDescription)) {
    issues.push("Description heading start: description must start with a markdown heading");
  }

  const duplicatedStructuredHeadings = forbiddenStructuredDescriptionHeadings(renderedDescription);
  if (duplicatedStructuredHeadings.length > 0) {
    issues.push(
      `Forbidden structured headings: ${duplicatedStructuredHeadings.join(", ")}`,
    );
  }

  const missingNarrative = missingRequiredNarrativeHeadings(renderedDescription, typeName);
  if (missingNarrative.length > 0) {
    issues.push(`Narrative headings: ${missingNarrative.join(", ")}`);
  }

  const sections = readMarkdownSections(renderedDescription);
  const requiredHeadings = DELIVERY_REQUIRED_NARRATIVE_HEADINGS_BY_TYPE[typeName] ?? [];
  for (const heading of requiredHeadings) {
    const body = sections.get(heading);
    if (body === undefined) {
      continue;
    }

    if (!String(body || "").trim()) {
      issues.push(`${heading}: section body is empty`);
    }
  }

  const executionContext = parseExecutionContextSection(sections.get("Execution Context"));
  issues.push(...executionContext.issues);

  const requiredExecutionContextEntries = [
    ownerRepo
      ? { label: "owner repo", expectedValue: ownerRepo }
      : { label: "owner repo", missingFieldIssue: "Execution Context: Owner Repo field is missing from the work item" },
    Number.isInteger(parentId)
      ? { label: "parent item", expectedValue: `#${parentId}` }
      : null,
    deliveryTeam
      ? { label: "delivery team", expectedValue: deliveryTeam }
      : null,
    iteration
      ? { label: "iteration", expectedValue: iteration }
      : null,
  ].filter(Boolean);

  for (const requirement of requiredExecutionContextEntries) {
    if (requirement.missingFieldIssue) {
      issues.push(requirement.missingFieldIssue);
      continue;
    }

    const actualValue = executionContext.valuesByLabel.get(requirement.label);
    if (!actualValue) {
      issues.push(
        `Execution Context: missing bullet \`${renderContextLabel(requirement.label)}:\``,
      );
      continue;
    }

    if (
      normalizeComparisonValue(actualValue) !==
      normalizeComparisonValue(requirement.expectedValue)
    ) {
      issues.push(
        `Execution Context: ${renderContextLabel(requirement.label)} must match \`${requirement.expectedValue}\``,
      );
    }
  }

  return {
    formattingValid: issues.length === 0,
    issues,
    present: renderedDescription.trim().length > 0,
  };
}
