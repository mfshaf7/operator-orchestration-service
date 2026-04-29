import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCAFFOLD_EXCLUDED_PREFIXES = [".platform-drills/", ".tmp/"];
const SCAFFOLD_EXCLUDED_PATTERNS = [/^docs\/archive\/session-handoff-[^/]+\.md$/];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function runGit(repoRoot, args, execFileSyncImpl = execFileSync) {
  return execFileSyncImpl("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryRunGit(repoRoot, args, execFileSyncImpl = execFileSync) {
  try {
    return runGit(repoRoot, args, execFileSyncImpl);
  } catch {
    return null;
  }
}

function parseLineSet(rawValue) {
  return new Set(
    String(rawValue || "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function shouldExcludeScaffoldPath(relativePath) {
  const renderedPath = String(relativePath || "").trim();
  if (!renderedPath) {
    return true;
  }

  if (SCAFFOLD_EXCLUDED_PREFIXES.some((prefix) => renderedPath.startsWith(prefix))) {
    return true;
  }

  return SCAFFOLD_EXCLUDED_PATTERNS.some((pattern) => pattern.test(renderedPath));
}

function resolveRepoState(repoInput, execFileSyncImpl = execFileSync) {
  const resolvedInput = path.resolve(repoInput);
  const repoRoot = runGit(
    resolvedInput,
    ["rev-parse", "--show-toplevel"],
    execFileSyncImpl,
  );
  const repoName = path.basename(repoRoot);
  const branch = tryRunGit(
    repoRoot,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    execFileSyncImpl,
  ) ?? "HEAD";
  const headSha = tryRunGit(
    repoRoot,
    ["rev-parse", "--short", "HEAD"],
    execFileSyncImpl,
  ) ?? "unknown";
  const mergeBase = tryRunGit(
    repoRoot,
    ["merge-base", "HEAD", "origin/main"],
    execFileSyncImpl,
  );

  const changedFiles = new Set();
  const addLines = (value) => {
    for (const entry of parseLineSet(value)) {
      changedFiles.add(entry);
    }
  };

  if (mergeBase) {
    addLines(
      tryRunGit(
        repoRoot,
        ["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}..HEAD`],
        execFileSyncImpl,
      ),
    );
  }

  addLines(
    tryRunGit(
      repoRoot,
      ["diff", "--name-only", "--diff-filter=ACMR"],
      execFileSyncImpl,
    ),
  );
  addLines(
    tryRunGit(
      repoRoot,
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      execFileSyncImpl,
    ),
  );
  addLines(
    tryRunGit(
      repoRoot,
      ["ls-files", "--others", "--exclude-standard"],
      execFileSyncImpl,
    ),
  );

  const changedFileList = [...changedFiles]
    .filter((entry) => !shouldExcludeScaffoldPath(entry))
    .sort((left, right) => left.localeCompare(right));
  const changedChangeRecords = changedFileList.filter((entry) =>
    entry.startsWith("docs/records/change-records/"),
  );

  return {
    branch,
    changedChangeRecords,
    changedFiles: changedFileList,
    headSha,
    repoName,
    repoRoot,
  };
}

function renderChangedSurfaces(repoStates) {
  const lines = repoStates.flatMap((repoState) =>
    repoState.changedFiles
      .filter((entry) => !shouldExcludeScaffoldPath(entry))
      .map((entry) => `- \`${repoState.repoName}/${entry}\`: CHECK explain what changed.`),
  );

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return "- `CHECK:path/or/surface`: CHECK explain what changed.";
}

function renderRepoLinkageEvidence(repoStates) {
  const lines = [];
  for (const repoState of repoStates) {
    lines.push(
      `- CHECK: repo \`${repoState.repoName}\` branch \`${repoState.branch}\` at commit \`${repoState.headSha}\``,
    );
    for (const changeRecord of repoState.changedChangeRecords) {
      lines.push(`- CHECK: change record \`${repoState.repoName}/${changeRecord}\``);
    }
  }
  lines.push("- CHECK: add explicit validation commands or live proofs before closeout.");
  return lines.join("\n");
}

function renderCompletionNote(repoStates, generatedAt) {
  const repoSummary = repoStates
    .map((repoState) => `${repoState.repoName}@${repoState.branch}(${repoState.headSha})`)
    .join(", ");
  return `Scaffold generated at ${generatedAt} from local repo state: ${repoSummary}.`;
}

function buildItemCompletionScaffold({ repoStates, targetId, generatedAt }) {
  return {
    input: {
      changed_surfaces: renderChangedSurfaces(repoStates),
      completion_note: renderCompletionNote(repoStates, generatedAt),
      completion_summary: `TODO: summarize the completed change for work item \`${targetId}\`.`,
      test_result_evidence: "- CHECK: add test-result evidence before closeout.",
      validation_evidence: renderRepoLinkageEvidence(repoStates),
    },
  };
}

function buildInitiativeCloseScaffold({ repoStates, targetId, generatedAt }) {
  return {
    input: {
      changed_surfaces: renderChangedSurfaces(repoStates),
      completion_note: renderCompletionNote(repoStates, generatedAt),
      completion_summary: `TODO: summarize the completed initiative outcome for \`${targetId}\`.`,
      demo_date: generatedAt.slice(0, 10),
      demo_evidence: `TODO: record the concrete system demo evidence for \`${targetId}\`.`,
      demo_outcome: "reviewed",
      demo_summary: `TODO: summarize the system demo outcome for \`${targetId}\`.`,
      inspect_action_items: "- TODO: record inspect-and-adapt actions.",
      inspect_date: generatedAt.slice(0, 10),
      inspect_summary: `TODO: summarize the inspect-and-adapt outcome for \`${targetId}\`.`,
      test_result_evidence: "- CHECK: add test-result evidence before closeout.",
      validation_evidence: renderRepoLinkageEvidence(repoStates),
    },
  };
}

export function buildArtScaffoldRequest(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args[0] !== "scaffold") {
    return null;
  }

  const scaffoldType = normalizeString(args[1]);
  const targetId = normalizeString(args[2]);
  const outputPath = normalizeString(args[3]);
  const repoRoots = args.slice(4).map((entry) => path.resolve(entry));

  if (!scaffoldType) {
    throw new Error("scaffold type is required");
  }
  if (!targetId) {
    throw new Error("scaffold target id is required");
  }
  if (!outputPath) {
    throw new Error("scaffold output path is required");
  }

  if (repoRoots.length === 0) {
    repoRoots.push(process.cwd());
  }

  if (!["item-complete", "initiative-close"].includes(scaffoldType)) {
    throw new Error(`unsupported scaffold command: ${scaffoldType}`);
  }

  return {
    outputPath: path.resolve(outputPath),
    repoRoots,
    scaffoldType,
    targetId,
  };
}

export function buildArtScaffoldPayload({
  generatedAt = new Date().toISOString(),
  repoStates,
  scaffoldType,
  targetId,
}) {
  if (!Array.isArray(repoStates) || repoStates.length === 0) {
    throw new Error("at least one repo state is required");
  }

  switch (scaffoldType) {
    case "item-complete":
      return buildItemCompletionScaffold({
        generatedAt,
        repoStates,
        targetId,
      });
    case "initiative-close":
      return buildInitiativeCloseScaffold({
        generatedAt,
        repoStates,
        targetId,
      });
    default:
      throw new Error(`unsupported scaffold type: ${scaffoldType}`);
  }
}

export function runArtScaffoldCommand({
  argv,
  execFileSyncImpl = execFileSync,
  stdout = process.stdout,
}) {
  const request = buildArtScaffoldRequest(argv);
  if (!request) {
    return false;
  }

  const repoStates = request.repoRoots.map((repoRoot) =>
    resolveRepoState(repoRoot, execFileSyncImpl),
  );
  const payload = buildArtScaffoldPayload({
    repoStates,
    scaffoldType: request.scaffoldType,
    targetId: request.targetId,
  });

  mkdirSync(path.dirname(request.outputPath), { recursive: true });
  writeFileSync(request.outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  stdout.write(
    `${JSON.stringify(
      {
        generated_payload: request.outputPath,
        repo_count: repoStates.length,
        repos: repoStates.map((repoState) => ({
          branch: repoState.branch,
          changed_file_count: repoState.changedFiles.length,
          head_sha: repoState.headSha,
          repo_name: repoState.repoName,
        })),
        scaffold_type: request.scaffoldType,
        target_id: request.targetId,
        workflow_id: "delivery-closeout-evidence-scaffold",
      },
      null,
      2,
    )}\n`,
  );
  return true;
}
