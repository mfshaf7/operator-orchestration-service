export const DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES = [
  "Completion Summary",
  "Changed Surfaces",
  "Test Result Evidence",
  "Validation Evidence",
];

export const DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES = ["Residual Follow-Up"];

export const DELIVERY_COMPLETION_SECTION_PREFIX_RULES = {
  "Changed Surfaces": [/^- /],
  "Test Result Evidence": [/^- (PASS|FAIL|NOT APPLICABLE): /, /^- Attached artifact: /],
  "Validation Evidence": [
    /^- (PASS|FAIL|CHECK|NOT APPLICABLE): /,
    /^- Attached artifact: /,
  ],
  "Residual Follow-Up": [/^- /],
};

export const DELIVERY_COMPLETION_SECTION_RULE_GUIDANCE = {
  "Completion Summary": "Use a short paragraph, not a bullet list.",
  "Changed Surfaces": "Use flat bullets like `- path/or/surface`.",
  "Test Result Evidence":
    "Each line must start with `- PASS:`, `- FAIL:`, `- NOT APPLICABLE:`, or `- Attached artifact:`.",
  "Validation Evidence":
    "Each line must start with `- PASS:`, `- FAIL:`, `- CHECK:`, `- NOT APPLICABLE:`, or `- Attached artifact:`.",
  "Residual Follow-Up": "Use flat bullets like `- follow-up item`.",
};

function completionArtifactFileName(testResultArtifact) {
  if (!testResultArtifact || typeof testResultArtifact !== "object") {
    return null;
  }

  if (typeof testResultArtifact.fileName === "string" && testResultArtifact.fileName.trim()) {
    return testResultArtifact.fileName.trim();
  }

  if (typeof testResultArtifact.file_name === "string" && testResultArtifact.file_name.trim()) {
    return testResultArtifact.file_name.trim();
  }

  return null;
}

export function buildCompletionSections({
  changedSurfaces,
  completionSummary,
  residualFollowUp,
  testResultArtifact,
  testResultEvidence,
  validationEvidence,
}) {
  const artifactFileName = completionArtifactFileName(testResultArtifact);
  const testResultSectionBody = artifactFileName
    ? `${testResultEvidence}\n- Attached artifact: \`${artifactFileName}\``
    : testResultEvidence;
  const sections = {
    "Completion Summary": completionSummary,
    "Changed Surfaces": changedSurfaces,
    "Test Result Evidence": testResultSectionBody,
    "Validation Evidence": validationEvidence,
  };

  if (residualFollowUp) {
    sections["Residual Follow-Up"] = residualFollowUp;
  }

  return sections;
}

export function validateCompletionSection(heading, body) {
  const renderedBody = String(body || "").trim();
  const formattingIssues = [];

  if (!renderedBody) {
    formattingIssues.push("section body is empty");
    return {
      formattingIssues,
      present: false,
    };
  }

  if (heading === "Completion Summary") {
    if (/^- /.test(renderedBody)) {
      formattingIssues.push("completion summary must be a short paragraph, not a bullet list");
    }

    return {
      formattingIssues,
      present: true,
    };
  }

  const rules = DELIVERY_COMPLETION_SECTION_PREFIX_RULES[heading] ?? [];
  const lines = renderedBody
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    formattingIssues.push("section body is empty");
  } else {
    for (const line of lines) {
      if (!rules.some((pattern) => pattern.test(line))) {
        formattingIssues.push(`line does not match the required bullet format: ${line}`);
      }
    }
  }

  return {
    formattingIssues,
    present: true,
  };
}

export function validateCompletionSections(sectionBodies) {
  const issues = [];
  const sections = Object.fromEntries(
    [...DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES, ...DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES]
      .map((heading) => [heading, Object.prototype.hasOwnProperty.call(sectionBodies, heading)]),
  );

  for (const heading of DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES) {
    if (!sections[heading]) {
      issues.push(`${heading}: section missing`);
      continue;
    }

    const state = validateCompletionSection(heading, sectionBodies[heading]);
    for (const issue of state.formattingIssues) {
      issues.push(`${heading}: ${issue}`);
    }
  }

  for (const heading of DELIVERY_COMPLETION_OPTIONAL_SECTION_NAMES) {
    if (!sections[heading]) {
      continue;
    }

    const state = validateCompletionSection(heading, sectionBodies[heading]);
    for (const issue of state.formattingIssues) {
      issues.push(`${heading}: ${issue}`);
    }
  }

  return {
    formattingValid: issues.length === 0 &&
      DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES.every((heading) => sections[heading]),
    issues,
    present: DELIVERY_COMPLETION_REQUIRED_SECTION_NAMES.every((heading) => sections[heading]),
    sections,
  };
}
