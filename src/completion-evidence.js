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
  "Changed Surfaces":
    "Use flat bullets that explain each surface, for example `- path/or/surface: changed behavior.`.",
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

function countWords(value) {
  return String(value || "").match(/[A-Za-z0-9][A-Za-z0-9_-]*/g)?.length ?? 0;
}

function stripMarkdownLinks(value) {
  return String(value || "").replace(/\[[^\]]+\]\([^)]+\)/g, "");
}

function stripCodeSpans(value) {
  return String(value || "").replace(/`[^`]+`/g, "");
}

const UNDECORATED_PATH_ROOTS = new Set([
  ".art",
  ".tmp",
  "contracts",
  "dev-integration",
  "docs",
  "operator-orchestration-service",
  "openclaw-host-bridge",
  "openclaw-runtime-distribution",
  "openclaw-telegram-enhanced",
  "platform-engineering",
  "scripts",
  "security-architecture",
  "src",
  "test",
  "tests",
  "workspace-governance",
]);

function normalizePathLikeToken(token) {
  return String(token || "")
    .replace(/^[([{<]+/, "")
    .replace(/[)\]},.;:!?]+$/, "")
    .trim();
}

function isUndecoratedPathLikeToken(token) {
  const candidate = normalizePathLikeToken(token);
  if (!candidate.includes("/")) {
    return false;
  }

  if (/^(?:\.{1,2}\/|~\/)/.test(candidate)) {
    return true;
  }

  const segments = candidate.split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const firstSegment = segments[0];
  const lastSegment = segments.at(-1) ?? "";
  if (UNDECORATED_PATH_ROOTS.has(firstSegment)) {
    return true;
  }

  if (segments.length >= 3) {
    return true;
  }

  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}

function containsUndecoratedPathLikeReference(value) {
  return String(value || "")
    .split(/\s+/)
    .some((token) => isUndecoratedPathLikeToken(token));
}

function isBareChangedSurfaceReference(body) {
  const rendered = String(body || "").trim();
  if (!rendered) {
    return true;
  }

  const withoutDecorators = rendered
    .replace(/^`([^`]+)`$/, "$1")
    .replace(/^\[([^\]]+)\]\([^)]+\)$/, "$1")
    .trim();

  return (
    /^[#]?\d+$/.test(withoutDecorators) ||
    /^(?:PR|pull request)\s+#?\d+$/i.test(withoutDecorators) ||
    /^https?:\/\/\S+$/i.test(withoutDecorators) ||
    /^(?:\.{0,2}\/|~\/|[\w.-]+\/)[\w./~@-]+$/.test(withoutDecorators) ||
    /^[\w.-]+\.(?:js|mjs|cjs|json|md|yml|yaml|sh|rb|py|ts|tsx|jsx|css|html|txt)$/.test(
      withoutDecorators,
    )
  );
}

function validateChangedSurfaceLine(line) {
  const issues = [];
  const body = String(line || "").replace(/^- /, "").trim();
  const bodyWithoutLinks = stripMarkdownLinks(body);
  const bodyWithoutCodeOrLinks = stripCodeSpans(bodyWithoutLinks).replace(
    /https?:\/\/\S+/gi,
    "",
  );

  if (/\b(?:CHECK|TODO):/i.test(body)) {
    issues.push("changed surface bullet still contains a placeholder");
  }

  if (isBareChangedSurfaceReference(body)) {
    issues.push(
      "changed surface bullet must explain what changed, not just list a path or reference",
    );
  }

  if (/\b(?:PR|pull request)\s+#\d+\b/i.test(bodyWithoutLinks)) {
    issues.push("changed surface PR references must use a markdown link or URL");
  }

  if (containsUndecoratedPathLikeReference(bodyWithoutCodeOrLinks)) {
    issues.push("changed surface paths must be code-formatted or markdown-linked");
  }

  if (
    /\b[\w.-]+\.(?:js|mjs|cjs|json|md|yml|yaml|sh|rb|py|ts|tsx|jsx|css|html|txt)\b/.test(
      bodyWithoutCodeOrLinks,
    )
  ) {
    issues.push("changed surface file references must be code-formatted or markdown-linked");
  }

  const hasExplanationSeparator = /:\s+\S/.test(body) || /\s+-\s+\S/.test(body);
  const hasExplanationVerb =
    /\b(adds?|added|archives?|archived|binds?|clears?|documents?|documented|exposes?|exposed|fixes?|fixed|guards?|guarded|implements?|implemented|keeps?|records?|recorded|rejects?|rejected|retains?|sets?|stores?|surfaces?|updates?|updated|validates?|validated|was|were|now)\b/i.test(
      body,
    );
  if (!hasExplanationSeparator && !hasExplanationVerb) {
    issues.push("changed surface bullet must describe the actual change");
  }

  if (countWords(body) < 5) {
    issues.push("changed surface bullet is too terse to be operator-readable");
  }

  return issues;
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

    if (/\b(?:CHECK|TODO):/i.test(renderedBody)) {
      formattingIssues.push("completion summary still contains a placeholder");
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
        continue;
      }

      if (heading === "Changed Surfaces") {
        for (const issue of validateChangedSurfaceLine(line)) {
          formattingIssues.push(`${issue}: ${line}`);
        }
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
