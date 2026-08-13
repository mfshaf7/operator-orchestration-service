import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCanonicalJson } from "./delivery-art/canonical-json.js";
import { validateDeliveryArtArtifact } from "./delivery-art/contracts.js";
import { createDeliveryArtLifecycleController } from "./delivery-art/lifecycle-controller.js";
import { bindFinalizedReviewPacketReference } from "./delivery-art/lifecycle.js";
import {
  compactDeliveryArtLifecycleResult,
  createDeliveryArtLifecycleCliAdapters,
} from "./delivery-art/lifecycle-cli-adapters.js";
import { toDeliveryId, toWorkItemId } from "./delivery-model.js";
import { runArtScaffoldCommand } from "./art-scaffold.js";
import {
  buildCompletionSections,
  validateCompletionSections,
} from "./completion-evidence.js";
import {
  archiveLegacyScratchArtifacts,
  createReviewPacketDraft,
  inspectScratchArtifacts,
  listMutationOperations,
  readArtifactFile,
  validateMutationDraft,
  validateReviewPacket,
  validateReviewPacketSourceBinding,
  writeArtifactFile,
} from "./art-workflow-artifacts.js";
import { createWgcfMutationDraft } from "./wgcf-art-handshake.js";

export const DEFAULT_ART_NAMESPACE = "devint-accepted-idea-delivery-mfshaf7";
export const DEFAULT_ART_BROKER_DEPLOYMENT = "operator-orchestration-service";
export const DEFAULT_BROKER_BASE_URL = "http://127.0.0.1:8080";
export const DEFAULT_ART_OUTPUT_DIR = ".art/outputs";
export const DEFAULT_COMPACT_OUTPUT_THRESHOLD_BYTES = 2500;
export const DEFAULT_PROJECTION_STATE_FILE = ".art/projection-state.json";
export const DEFAULT_DEVINT_OPENPROJECT_DEPLOYMENT =
  "devint-accepted-idea-delivery-openproject-web";
export const DEFAULT_WORKSPACE_ROOT = path.resolve(process.cwd(), "..");

const USAGE = `usage:
  npm run art -- bootstrap [--json]
  npm run art -- workflow-health [--json]
  npm run art -- assignees [--json]
  npm run art -- initiative active-session <delivery-id> [--json]
  npm run art -- initiative evidence-packet <delivery-id> [--json]
  npm run art -- initiative review-pack <delivery-id> [--json]
  npm run art -- initiative execution-summary <delivery-id> [--json]
  npm run art -- initiative planning <delivery-id> [--json]
  npm run art -- initiative governance <delivery-id> <payload.json>
  npm run art -- initiative planning-repair <delivery-id> <payload.json>
  npm run art -- initiative closeout-readiness <delivery-id> [--json]
  npm run art -- initiative close <delivery-id> <payload.json>
  npm run art -- item continuation <work-item-id> [--json]
  npm run art -- item evidence-packet <work-item-id> [--json]
  npm run art -- item blocker <work-item-id> <payload.json>
  npm run art -- item complete <work-item-id> <payload.json>
  npm run art -- item stale-open-close <work-item-id> <payload.json>
  npm run art -- scaffold item-complete <work-item-id> <output.json> [repo-root...]
  npm run art -- scaffold initiative-close <delivery-id> <output.json> [repo-root...]
  npm run art -- draft operations
  npm run art -- draft create <operation> <target-id-or-dash> <output.json>
  npm run art -- draft show <draft.json>
  npm run art -- draft validate <draft.json>
  npm run art -- draft submit <draft.json>
  npm run art -- draft discard <draft.json> [reason]
  npm run art -- draft export <draft.json> <output.json>
  npm run art -- draft import <input.json> <output.json>
  npm run art -- wgcf draft <handshake.json> <output.json>
  npm run art -- artifact validate <artifact.json> [--json]
  npm run art -- artifact resolve <artifact.json> [--json]
  npm run art -- architecture persist <artifact.json> [--json]
  npm run art -- work-start evaluate <artifact.json> [--json]
  npm run art -- review-packet draft <delivery-id> <output.json> <work-item-id...> [--repo-root <path>...]
  npm run art -- review-packet readiness <packet.json> [--json]
  npm run art -- review-packet prepare-finalization <packet.json> [--json]
  npm run art -- review-packet operating-readiness <packet.json> <receipt.json> [--json]
  npm run art -- review-packet evidence-packet <packet.json> [--json]
  npm run art -- review-packet validate <packet.json> [--json]
  npm run art -- review-packet finalize <packet.json> [--readiness-receipt <receipt.json>] [--json]
  npm run art -- landing-unit status <packet.json> [--json]
  npm run art -- landing-unit dry-run <packet.json> [--json]
  npm run art -- landing-unit submit <packet.json> [--json]
  npm run art -- lifecycle status <plan.json> [--json]
  npm run art -- lifecycle reconcile <plan.json> [--json]
  npm run art -- projection status [--json]
  npm run art -- projection sync [--pi-names <names>] [--target-epic-id <id>] [--quality] [--force] [--dry-run]
  npm run art -- projection clear [reason]
  npm run art -- scratch status
  npm run art -- scratch cleanup [--archive-legacy] [--dry-run]
`;

function normalizeDeliveryId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("delivery id is required");
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return toDeliveryId(Number.parseInt(trimmed, 10));
  }

  if (!/^delivery-\d+$/.test(trimmed)) {
    throw new Error("delivery id must look like `delivery-304` or `304`");
  }

  return trimmed;
}

function normalizeWorkItemId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("work item id is required");
  }

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return toWorkItemId(Number.parseInt(trimmed, 10));
  }

  if (!/^work-item-\d+$/.test(trimmed)) {
    throw new Error("work item id must look like `work-item-310` or `310`");
  }

  return trimmed;
}

function buildPayloadBase64(payloadPath) {
  if (typeof payloadPath !== "string" || !payloadPath.trim()) {
    throw new Error("payload path is required for this command");
  }

  const payload = readFileSync(payloadPath, "utf8");
  return Buffer.from(payload, "utf8").toString("base64");
}

function readCanonicalArtifactFile(artifactPath) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) {
    throw new Error("artifact path is required");
  }
  return parseCanonicalJson(readFileSync(artifactPath, "utf8"));
}

function writeCanonicalArtifactFile(artifactPath, artifact) {
  const resolvedPath = path.resolve(artifactPath);
  const temporaryPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, resolvedPath);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
}

function buildInputEnvelopePayloadBase64(payloadPath) {
  if (typeof payloadPath !== "string" || !payloadPath.trim()) {
    throw new Error("payload path is required for this command");
  }

  const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  if (!isObject(payload)) {
    throw new Error("payload must be a JSON object");
  }

  if (isObject(payload.input)) {
    return payloadToBase64(payload);
  }

  return payloadToBase64({ input: payload });
}

function parseEnvelopeFromStdout(stdoutBuffer) {
  if (typeof stdoutBuffer !== "string" || !stdoutBuffer.trim()) {
    return null;
  }

  const trimmed = stdoutBuffer.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function summarizeBuffer(value) {
  if (typeof value !== "string" || !value) {
    return "(empty)";
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(whitespace only)";
  }

  if (compact.length <= 400) {
    return compact;
  }

  return `${compact.slice(0, 200)} ... ${compact.slice(-200)}`;
}

function payloadToBase64(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function writeJson(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asObjectOutput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { result: value };
}

function readJsonFileIfPresent(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function shouldPrintFullJson(argv) {
  return argv.includes("--json") || argv.includes("--full-json");
}

function truncateValue(value, maxLength = 140) {
  if (typeof value !== "string") {
    return value;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

function compactItem(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  return {
    execution_classification: item.execution_classification ?? null,
    id: item.id ?? null,
    owner_repo: item.owner_repo ?? null,
    status: item.status ?? null,
    subject: truncateValue(item.subject ?? ""),
    target_pi: item.target_pi ?? null,
    type: item.type ?? null,
  };
}

function compactItemList(items, limit = 5) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, limit).map(compactItem);
}

function compactMappedItems(items, itemKey, limit = 5) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, limit).map((entry) => ({
    item: compactItem(entry?.[itemKey] ?? entry?.item ?? entry),
    reason: entry?.reason ?? null,
    relation: entry?.relation ?? null,
  }));
}

function safeCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function flattenObjectCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      Array.isArray(entry) ? entry.length : entry,
    ]),
  );
}

function artifactLabelFromRequest(request) {
  return String(request.path || request.description || "art-output")
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "art-output";
}

function projectionStateFile(env) {
  return env.ART_PROJECTION_STATE_FILE || DEFAULT_PROJECTION_STATE_FILE;
}

export function resolveWorkspaceRoot({
  cwd = process.cwd(),
  env = process.env,
  execFileSyncImpl = execFileSync,
} = {}) {
  const configuredRoot = env.ART_WORKSPACE_ROOT || env.WORKSPACE_ROOT;
  if (configuredRoot) {
    return configuredRoot;
  }

  try {
    const commonGitDir = execFileSyncImpl(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    if (commonGitDir) {
      return path.resolve(path.dirname(commonGitDir), "..");
    }
  } catch {
    // Non-Git callers retain the existing sibling-repo fallback.
  }

  return path.resolve(cwd, "..");
}

function workspaceRoot(env) {
  return resolveWorkspaceRoot({ env });
}

function wgcfRepoRoot(env) {
  return (
    env.ART_WGCF_REPO_ROOT ||
    env.WGCF_REPO_ROOT ||
    path.join(workspaceRoot(env), "workspace-governance-control-fabric")
  );
}

function wgcfPythonPath(repoRoot, env) {
  const entries = [
    path.join(repoRoot, "packages/control_fabric_core/src"),
    path.join(repoRoot, "apps/api/src"),
    path.join(repoRoot, "apps/cli/src"),
  ];
  if (env.PYTHONPATH) {
    entries.push(env.PYTHONPATH);
  }
  return entries.join(path.delimiter);
}

function wgcfPythonCommand(repoRoot, env) {
  if (env.ART_WGCF_PYTHON) {
    return env.ART_WGCF_PYTHON;
  }
  const venvPython = path.join(repoRoot, ".venv/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function cggPackMode(env) {
  const rawMode = env.ART_CGG_PACKETING ?? env.CGG_ART_PACKETING;
  if (rawMode === undefined || rawMode === null || String(rawMode).trim() === "") {
    return "enabled";
  }
  const mode = String(rawMode).trim().toLowerCase();
  if (mode === "0" || mode === "false" || mode === "disabled" || mode === "off") {
    return "off";
  }
  if (mode === "1" || mode === "true" || mode === "enabled" || mode === "on") {
    return "enabled";
  }
  if (mode === "required") {
    return "required";
  }
  return "enabled";
}

function cggRepoRoot(env) {
  return (
    env.ART_CGG_REPO_ROOT ||
    env.CGG_REPO_ROOT ||
    path.join(workspaceRoot(env), "context-governance-gateway")
  );
}

function cggPythonPath(repoRoot, env) {
  const entries = [
    path.join(repoRoot, "packages/context_core/src"),
    path.join(repoRoot, "packages/context_policy/src"),
    path.join(repoRoot, "apps/cli/src"),
  ];
  if (env.PYTHONPATH) {
    entries.push(env.PYTHONPATH);
  }
  return entries.join(path.delimiter);
}

function cggPythonCommand(repoRoot, env) {
  if (env.ART_CGG_PYTHON || env.CGG_PYTHON) {
    return env.ART_CGG_PYTHON || env.CGG_PYTHON;
  }
  const venvPython = path.join(repoRoot, ".venv/bin/python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function emptyProjectionState() {
  return {
    affected_delivery_ids: [],
    affected_work_item_ids: [],
    dirty: false,
    dirty_events: [],
    schema_version: 1,
    updated_at: null,
    workflow_id: "delivery-art-projection-state",
  };
}

function normalizeProjectionState(value) {
  if (!value || typeof value !== "object") {
    return emptyProjectionState();
  }

  const dirtyEvents = Array.isArray(value.dirty_events)
    ? value.dirty_events.filter((event) => event && typeof event === "object")
    : [];
  const affectedDeliveryIds = Array.isArray(value.affected_delivery_ids)
    ? value.affected_delivery_ids.filter(Boolean)
    : [];
  const affectedWorkItemIds = Array.isArray(value.affected_work_item_ids)
    ? value.affected_work_item_ids.filter(Boolean)
    : [];

  return {
    affected_delivery_ids: [...new Set(affectedDeliveryIds)],
    affected_work_item_ids: [...new Set(affectedWorkItemIds)],
    dirty: Boolean(value.dirty || dirtyEvents.length > 0),
    dirty_events: dirtyEvents,
    schema_version: 1,
    updated_at: value.updated_at || null,
    workflow_id: "delivery-art-projection-state",
  };
}

function readProjectionState(env) {
  return normalizeProjectionState(readJsonFileIfPresent(projectionStateFile(env)));
}

function writeProjectionState(env, state) {
  const outputPath = projectionStateFile(env);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(normalizeProjectionState(state), null, 2)}\n`, "utf8");
}

function clearProjectionState(env) {
  const outputPath = projectionStateFile(env);
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }
}

function collectProjectionReports(value, reports = []) {
  if (!value || typeof value !== "object") {
    return reports;
  }

  if (
    Object.prototype.hasOwnProperty.call(value, "roadmap_version_projection") &&
    value.roadmap_version_projection &&
    typeof value.roadmap_version_projection === "object"
  ) {
    reports.push(value.roadmap_version_projection);
  }

  for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") {
      collectProjectionReports(entry, reports);
    }
  }

  return reports;
}

function projectionReportsRequireExternalReconciler(body) {
  return collectProjectionReports(body).filter(
    (report) => report.status === "external_reconciler_required",
  );
}

function brokerWorkItemIdFromValue(value) {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^work-item-\d+$/.test(normalized)) {
      return normalized;
    }
    const recordRefMatch = normalized.match(/^openproject:\/\/work_packages\/(\d+)$/);
    if (recordRefMatch) {
      return `work-item-${recordRefMatch[1]}`;
    }
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return `work-item-${value}`;
  }

  return null;
}

function localWorkItemIdFromProjectionContainer(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return (
    brokerWorkItemIdFromValue(value.work_item_id) ||
    brokerWorkItemIdFromValue(value.record_ref) ||
    (Object.prototype.hasOwnProperty.call(value, "id") &&
    (Object.prototype.hasOwnProperty.call(value, "type") ||
      Object.prototype.hasOwnProperty.call(value, "subject") ||
      Object.prototype.hasOwnProperty.call(value, "status") ||
      Object.prototype.hasOwnProperty.call(value, "parent_id"))
      ? brokerWorkItemIdFromValue(value.id)
      : null)
  );
}

function collectAffectedWorkItemIdsFromProjectionReports(
  value,
  nearestWorkItemId = null,
  workItemIds = [],
) {
  if (!value || typeof value !== "object") {
    return workItemIds;
  }

  const currentWorkItemId =
    localWorkItemIdFromProjectionContainer(value) || nearestWorkItemId;
  if (
    value.roadmap_version_projection &&
    typeof value.roadmap_version_projection === "object" &&
    value.roadmap_version_projection.status === "external_reconciler_required" &&
    currentWorkItemId
  ) {
    workItemIds.push(currentWorkItemId);
  }

  for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") {
      collectAffectedWorkItemIdsFromProjectionReports(
        entry,
        currentWorkItemId,
        workItemIds,
      );
    }
  }

  return workItemIds;
}

function inferProjectionDirtyIds({ body, request }) {
  const workItemIds = [];
  const deliveryIds = [];

  const requestWorkItemMatch = request.path.match(/\/delivery-work-items\/(work-item-\d+)/);
  if (requestWorkItemMatch) {
    workItemIds.push(requestWorkItemMatch[1]);
  }

  const requestDeliveryMatch = request.path.match(/\/delivery-initiatives\/(delivery-\d+)/);
  if (requestDeliveryMatch) {
    deliveryIds.push(requestDeliveryMatch[1]);
  }

  if (body?.work_item_id) {
    workItemIds.push(body.work_item_id);
  }
  if (body?.parent_work_item_id && /^work-item-\d+$/.test(body.parent_work_item_id)) {
    workItemIds.push(body.parent_work_item_id);
  }
  if (body?.delivery_id) {
    deliveryIds.push(body.delivery_id);
  }
  workItemIds.push(...collectAffectedWorkItemIdsFromProjectionReports(body));

  return {
    deliveryIds: [...new Set(deliveryIds)],
    workItemIds: [...new Set(workItemIds)],
  };
}

function markProjectionDirtyIfRequired({ body, env, request }) {
  const projectionReports = projectionReportsRequireExternalReconciler(body);
  if (projectionReports.length === 0) {
    return null;
  }

  const currentState = readProjectionState(env);
  const now = new Date().toISOString();
  const { deliveryIds, workItemIds } = inferProjectionDirtyIds({ body, request });
  const event = {
    affected_delivery_ids: deliveryIds,
    affected_work_item_ids: workItemIds,
    marked_at: now,
    projection_reports: projectionReports.map((report) => ({
      from: report.from ?? null,
      reason: report.reason ?? null,
      status: report.status,
      target_pi: report.target_pi ?? null,
      to: report.to ?? null,
    })),
    route: `${request.method} ${request.path}`,
    source: request.description,
  };
  const nextState = normalizeProjectionState({
    ...currentState,
    affected_delivery_ids: [
      ...currentState.affected_delivery_ids,
      ...deliveryIds,
    ],
    affected_work_item_ids: [
      ...currentState.affected_work_item_ids,
      ...workItemIds,
    ],
    dirty: true,
    dirty_events: [...currentState.dirty_events, event],
    updated_at: now,
  });
  writeProjectionState(env, nextState);
  return nextState;
}

function projectionStatusOutput(env) {
  const state = readProjectionState(env);
  return {
    ...state,
    next_action: state.dirty
      ? "Run `npm run art -- projection sync --pi-names <known-pis> --target-epic-id <epic-id> --quality` at the next projection checkpoint."
      : "No projection checkpoint is pending.",
    state_file: projectionStateFile(env),
  };
}

function parseOptionValue(argv, optionName) {
  const index = argv.indexOf(optionName);
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function defaultPlatformEngineeringRoot(env) {
  return (
    env.PLATFORM_ENGINEERING_ROOT ||
    env.ART_PLATFORM_ENGINEERING_ROOT ||
    path.resolve(process.cwd(), "../platform-engineering")
  );
}

function activeOpenProjectNamespace(env) {
  return env.OPENPROJECT_NAMESPACE || env.ART_NAMESPACE || DEFAULT_ART_NAMESPACE;
}

function activeOpenProjectDeployment(env) {
  return (
    env.OPENPROJECT_DEPLOYMENT ||
    env.ART_OPENPROJECT_DEPLOYMENT ||
    DEFAULT_DEVINT_OPENPROJECT_DEPLOYMENT
  );
}

async function runProcess({
  args,
  command,
  cwd,
  env,
  label,
  spawnImpl,
}) {
  const child = spawnImpl(command, args, {
    cwd,
    env,
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout?.on("data", (chunk) => {
    stdoutChunks.push(Buffer.from(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk));
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  const stdoutBuffer = Buffer.concat(stdoutChunks);
  const stderrBuffer = Buffer.concat(stderrChunks);
  const capturedOutput = await createProcessOutputArtifact({
    args,
    command,
    cwd,
    env,
    exitCode,
    label,
    spawnImpl,
    stderrBuffer,
    stdoutBuffer,
  });
  return {
    exitCode,
    output: capturedOutput,
  };
}

function projectionSyncPlan({ argv, env, state }) {
  const platformRoot = defaultPlatformEngineeringRoot(env);
  const syncScript = path.join(
    platformRoot,
    "products/openproject/scripts/openproject_sync_delivery_art_views.sh",
  );
  const piNames =
    parseOptionValue(argv, "--pi-names") ||
    env.OPENPROJECT_DELIVERY_PI_NAMES ||
    env.PI_NAMES ||
    "";
  const targetEpicId =
    parseOptionValue(argv, "--target-epic-id") ||
    env.TARGET_EPIC_ID ||
    (state.affected_delivery_ids[0] || "").replace(/^delivery-/, "") ||
    "";
  const namespace = activeOpenProjectNamespace(env);
  const deployment = activeOpenProjectDeployment(env);

  return {
    deployment,
    namespace,
    pi_names: piNames,
    platform_root: platformRoot,
    quality: argv.includes("--quality"),
    sync_script: syncScript,
    target_epic_id: targetEpicId,
  };
}

function outputThresholdBytes(env) {
  const rawValue = Number.parseInt(env.ART_COMPACT_OUTPUT_THRESHOLD_BYTES || "", 10);
  return Number.isFinite(rawValue) && rawValue > 0
    ? rawValue
    : DEFAULT_COMPACT_OUTPUT_THRESHOLD_BYTES;
}

function fullOutputArtifact(body, { env, request }) {
  const rendered = `${JSON.stringify(body, null, 2)}\n`;
  if (Buffer.byteLength(rendered, "utf8") <= outputThresholdBytes(env)) {
    return null;
  }
  const outputDir = env.ART_OUTPUT_DIR || DEFAULT_ART_OUTPUT_DIR;
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = `${outputDir}/${stamp}-${artifactLabelFromRequest(request)}.json`;
  writeFileSync(outputPath, rendered, "utf8");
  return {
    full_output_bytes: Buffer.byteLength(rendered, "utf8"),
    full_output_path: outputPath,
  };
}

function writeRawOutputArtifact(body, { env, label }) {
  const rendered = `${JSON.stringify(body, null, 2)}\n`;
  const outputDir = env.ART_OUTPUT_DIR || DEFAULT_ART_OUTPUT_DIR;
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = `${outputDir}/${stamp}-${artifactLabelFromRequest({ description: label })}.json`;
  writeFileSync(outputPath, rendered, "utf8");
  return {
    full_output_bytes: Buffer.byteLength(rendered, "utf8"),
    full_output_path: outputPath,
  };
}

async function createProcessOutputArtifact({
  args,
  command,
  cwd,
  env,
  exitCode,
  label,
  spawnImpl,
  stderrBuffer,
  stdoutBuffer,
}) {
  const stdoutBytes = stdoutBuffer.byteLength;
  const stderrBytes = stderrBuffer.byteLength;
  if (stdoutBytes === 0 && stderrBytes === 0) {
    return {
      raw_output_suppressed: true,
      stderr_bytes: 0,
      stdout_bytes: 0,
    };
  }

  const artifact = writeRawOutputArtifact(
    {
      args,
      captured_at: new Date().toISOString(),
      command,
      cwd,
      exit_code: exitCode,
      raw_output_suppressed: true,
      stderr: stderrBuffer.toString("utf8"),
      stderr_bytes: stderrBytes,
      stdout: stdoutBuffer.toString("utf8"),
      stdout_bytes: stdoutBytes,
      workflow_id: "delivery-art-subprocess-output",
    },
    {
      env,
      label: `${label || command}-subprocess-output`,
    },
  );
  const packetRef = await createCggPacketForOutput({
    env,
    outputPath: artifact.full_output_path,
    spawnImpl,
  });
  return {
    ...artifact,
    cgg_packet_ref: packetRef,
    raw_output_suppressed: true,
    stderr_bytes: stderrBytes,
    stdout_bytes: stdoutBytes,
  };
}

function withOutputReference(summary, body, { env, request }) {
  const artifact = fullOutputArtifact(body, { env, request });
  return {
    ...summary,
    full_output_hint: "Use --json to print the full broker response.",
    ...(artifact ? { full_output: artifact } : {}),
  };
}

function compactCggPacketRef(result) {
  if (!isObject(result)) {
    return null;
  }
  return {
    admission_decision: result.admission_decision ?? null,
    artifact_digest: result.artifact_digest ?? null,
    artifact_id: result.artifact_id ?? null,
    manifest_path: result.manifest_path ?? null,
    packet_path: result.packet_path ?? null,
    receipt_path: result.receipt_path ?? null,
    redaction_findings: result.redaction_findings ?? null,
  };
}

async function createCggPacketForOutput({
  env,
  outputPath,
  spawnImpl,
}) {
  const mode = cggPackMode(env);
  if (mode === "off" || !outputPath) {
    return null;
  }

  const repoRoot = cggRepoRoot(env);
  if (!existsSync(path.join(repoRoot, "apps/cli/src/cgg_cli/cli.py"))) {
    const message = `CGG repo not found at ${repoRoot}`;
    if (mode === "required") {
      throw new Error(message);
    }
    return {
      error: message,
      status: "unavailable",
    };
  }

  const child = spawnImpl(
    cggPythonCommand(repoRoot, env),
    [
      "-m",
      "cgg_cli",
      "pack",
      "--path",
      outputPath,
      "--profile",
      env.ART_CGG_PROFILE || env.CGG_PROFILE || "developer",
      "--budget",
      env.ART_CGG_BUDGET || env.CGG_BUDGET || "3000",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...env,
        PYTHONPATH: cggPythonPath(repoRoot, env),
      },
    },
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const result = parseEnvelopeFromStdout(stdoutBuffer);
  if (exitCode !== 0 || !result) {
    const message = `CGG packet projection failed for ${outputPath}. stdout=${summarizeBuffer(stdoutBuffer)} stderr=${summarizeBuffer(stderrBuffer)}`;
    if (mode === "required") {
      throw new Error(message);
    }
    return {
      error: message,
      status: "failed",
    };
  }

  const packetRef = compactCggPacketRef(result);
  if (!packetRef.packet_path || !packetRef.receipt_path || !packetRef.artifact_digest) {
    const message = `CGG packet projection returned an incomplete packet reference for ${outputPath}. stdout=${summarizeBuffer(stdoutBuffer)} stderr=${summarizeBuffer(stderrBuffer)}`;
    if (mode === "required") {
      throw new Error(message);
    }
    return {
      error: message,
      status: "failed",
    };
  }

  return {
    ...packetRef,
    status: "projected",
  };
}

async function attachCggPacketReference(output, { env, spawnImpl }) {
  if (!isObject(output) || !output.full_output?.full_output_path) {
    return output;
  }

  const packetRef = await createCggPacketForOutput({
    env,
    outputPath: output.full_output.full_output_path,
    spawnImpl,
  });
  if (!packetRef) {
    return output;
  }

  return {
    ...output,
    cgg_packet_ref: packetRef,
  };
}

async function protectFullJsonOutput(body, { env, request, spawnImpl }) {
  if (cggPackMode(env) === "off") {
    return body;
  }

  const artifact = fullOutputArtifact(body, { env, request });
  if (!artifact) {
    return body;
  }

  const packetRef = await createCggPacketForOutput({
    env,
    outputPath: artifact.full_output_path,
    spawnImpl,
  });

  return {
    cgg_packet_ref: packetRef,
    full_output: artifact,
    full_output_hint:
      "Raw --json output exceeded the context-admission threshold and was written to full_output_path instead of being printed.",
    raw_json_override:
      "For local debugging only, rerun with ART_CGG_PACKETING=off to print raw JSON.",
    raw_json_suppressed: true,
    top_level_keys: body && typeof body === "object" ? Object.keys(body) : [],
    workflow_id: body?.workflow_id ?? null,
  };
}

function compactReviewPacketOutput(body, { action, env, packet, packetPath, request }) {
  const outputPacket =
    body?.artifact || body?.finalization_candidate || body?.review_packet || packet || {};
  const landingUnit = outputPacket.landing_unit || {};
  const evidence = outputPacket.evidence || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const changedSurfaces = Array.isArray(evidence.changed_surfaces)
    ? evidence.changed_surfaces
    : [];
  const validations = Array.isArray(evidence.validations) ? evidence.validations : [];
  const testResults = Array.isArray(evidence.tests)
    ? evidence.tests
    : Array.isArray(evidence.test_results)
      ? evidence.test_results
      : [];
  const validation = body?.validation || {};
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];

  return withOutputReference(
    {
      command: `review-packet ${action}`,
      covered_work_item_ids: outputPacket.covered_work_item_ids || [],
      delivery_id: outputPacket.delivery_id || null,
      landing_unit: {
        change_records: repos.flatMap((repo) => {
          const records = Array.isArray(repo.change_record_refs)
            ? repo.change_record_refs
            : Array.isArray(repo.change_records)
              ? repo.change_records
              : [];
          return records.map((entry) => `${repo.repo_name}/${entry}`);
        }),
        changed_surface_count: changedSurfaces.length,
        evidence_kind: landingUnit.evidence_kind || "unknown",
        merge_commit: landingUnit.merge_commit || null,
        merge_commits: repos.map((repo) => repo.merge_commit).filter(Boolean),
        pr_url: landingUnit.pr_url || null,
        pr_urls: repos.map((repo) => repo.pr_url).filter(Boolean),
        repo_names: repos.map((repo) => repo.repo_name).filter(Boolean),
        test_result_count: testResults.length,
        validation_count: validations.length,
      },
      packet_id: outputPacket.packet_id || null,
      packet_path: packetPath,
      operating_readiness: body?.readiness_receipt
        ? {
            evaluated_at: body.readiness_receipt.readiness?.evaluated_at ?? null,
            finding_count: Array.isArray(body.readiness_receipt.findings)
              ? body.readiness_receipt.findings.length
              : 0,
            mutation_allowed:
              body.readiness_receipt.readiness?.mutation_allowed === true,
            outcome: body.readiness_receipt.readiness?.outcome ?? null,
            receipt_ref: body.readiness_receipt_ref ?? null,
          }
        : undefined,
      status: outputPacket.status || null,
      validation: {
        error_count: errors.length,
        errors,
        final: Boolean(validation.final),
        next_action: validation.next_action || null,
        packet_digest:
          validation.packet_digest ||
          outputPacket.integrity?.content_digest ||
          outputPacket.packet_digest ||
          null,
        ready:
          typeof validation.ready === "boolean" ? validation.ready : undefined,
        valid: Boolean(validation.valid),
        warning_count: warnings.length,
        warnings,
      },
      workflow_id: body?.workflow_id || validation.workflow_id || null,
    },
    body,
    { env, request },
  );
}

function compactDeliveryArtArtifactOutput(
  body,
  { action, artifactPath, env, request, sourceArtifact },
) {
  const artifact = body?.artifact || sourceArtifact || {};
  const receipt = body?.owner_receipt || null;
  return withOutputReference(
    {
      action,
      artifact_id: artifact.artifact_id || artifact.packet_id || null,
      artifact_path: artifactPath,
      artifact_type: artifact.artifact_type || null,
      content_digest: artifact.integrity?.content_digest || null,
      covered_work_item_ids: artifact.covered_work_item_ids || [],
      custody_state: artifact.custody?.state || null,
      custody_uri: artifact.custody?.uri || null,
      delivery_id: artifact.delivery_id || null,
      owner_receipt: receipt
        ? {
            content_digest: receipt.content_digest || null,
            custody_uri: receipt.custody_uri || null,
            projected: Boolean(receipt.projected),
            projection_replayed: Boolean(receipt.projection_replayed),
            replayed: Boolean(receipt.replayed),
          }
        : null,
      readiness_level: artifact.readiness?.level || null,
      validation: body?.validation || null,
      workflow_id: body?.workflow_id || null,
    },
    body,
    { env, request },
  );
}

function compactBrokerOutput(body, { env, request }) {
  const workflowId = body?.workflow_id;

  if (request.projectAssignablesOnly) {
    const principals = Array.isArray(body?.principals) ? body.principals : [];
    return withOutputReference(
      {
        assignable_count: body?.summary?.assignable_count ?? principals.length,
        principals: principals.slice(0, 20).map((principal) => ({
          id: principal.id ?? null,
          login: principal.login ?? null,
          name: principal.name ?? null,
          type: principal.type ?? null,
        })),
        workflow_id: "delivery-session-assignables",
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-session-bootstrap") {
    const initiatives = body?.active_fronts?.initiatives || [];
    return withOutputReference(
      {
        active_fronts: {
          initiatives: initiatives.slice(0, 5).map((entry) => ({
            delivery_id: entry.delivery_id ?? null,
            epic: compactItem(entry.epic),
            next_ready_count: entry.summary?.next_ready_count ?? safeCount(entry.next_ready_items),
            open_active_count: entry.summary?.active_item_count ?? safeCount(entry.open_active_items),
          })),
          summary: body?.active_fronts?.summary ?? null,
        },
        assignable_count: body?.assignables?.summary?.assignable_count ?? safeCount(body?.assignables?.principals),
        review_backlog_summary: body?.review_backlog?.summary ?? null,
        runtime: {
          broker_git_commit: body?.runtime?.broker_service?.git_commit ?? null,
          broker_version: body?.runtime?.broker_service?.version ?? null,
          delivery_project_identifier: body?.runtime?.delivery_project_identifier ?? null,
          namespace: body?.runtime?.openproject_runtime?.namespace ?? null,
        },
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-session-workflow-health") {
    return withOutputReference(
      {
        portfolio_summary: body?.portfolio_summary ?? null,
        project: body?.project ?? null,
        workflow_health: {
          compatible_views: body?.workflow_health?.compatible_views ?? null,
          pm2_phase: {
            drift_count: safeCount(body?.workflow_health?.pm2_phase?.drift),
            healthy: body?.workflow_health?.pm2_phase?.healthy ?? null,
          },
          roadmap: {
            drift: compactMappedItems(body?.workflow_health?.roadmap?.drift, "item"),
            drift_count: safeCount(body?.workflow_health?.roadmap?.drift),
            healthy: body?.workflow_health?.roadmap?.healthy ?? null,
          },
          summary: body?.workflow_health?.summary ?? null,
        },
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-execution-summary") {
    const summary = body?.execution_summary || {};
    return withOutputReference(
      {
        delivery_id: body?.delivery_id ?? null,
        epic: compactItem(summary.epic),
        execution_summary: {
          root_child_count: safeCount(summary.execution_tree?.children),
          summary: summary.summary ?? null,
        },
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-planning-summary") {
    const planning = body?.planning_summary || {};
    return withOutputReference(
      {
        delivery_id: body?.delivery_id ?? null,
        epic: compactItem(planning.epic),
        planning_summary: {
          active_items: compactItemList(planning.active_items || planning.open_active_items),
          next_ready_items: compactItemList(planning.next_ready_items),
          summary: planning.summary ?? null,
        },
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-initiative-review-pack") {
    const reviewPack = body?.review_pack || {};
    return withOutputReference(
      {
        delivery_id: body?.delivery_id ?? null,
        epic: compactItem(reviewPack.epic),
        initiative_review: reviewPack.initiative_review ?? null,
        quality_drift_counts: flattenObjectCounts(reviewPack.quality_drift),
        stale_open_candidates: compactMappedItems(
          reviewPack.stale_open_candidates,
          "item",
        ),
        summary: reviewPack.summary ?? null,
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-initiative-active-session-packet") {
    const packet = body?.active_session_packet || {};
    return withOutputReference(
      {
        active_fronts: packet.active_fronts?.summary ?? null,
        delivery_id: body?.delivery_id ?? null,
        initiative: compactItem(packet.initiative),
        quality_drift_counts: packet.quality_drift_counts ?? null,
        stale_open_candidate_count: safeCount(packet.stale_open_candidates),
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-initiative-evidence-packet") {
    const packet = body?.evidence_packet || {};
    const driftSamples = packet.quality_drift_samples || {};
    return withOutputReference(
      {
        closeout_readiness: packet.closeout_readiness ?? null,
        delivery_id: body?.delivery_id ?? null,
        evidence_state: packet.evidence_state ?? null,
        initiative: compactItem(packet.initiative),
        quality_drift_sample_counts: flattenObjectCounts(driftSamples),
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-closeout-readiness") {
    const readiness = body?.closeout_readiness || {};
    return withOutputReference(
      {
        delivery_id: body?.delivery_id ?? null,
        epic: compactItem(readiness.epic),
        readiness: {
          ready_for_closeout: readiness.ready_for_closeout ?? null,
          ready_for_closing: readiness.ready_for_closing ?? null,
          ready_for_retirement: readiness.ready_for_retirement ?? null,
          reasons: readiness.reasons ?? [],
          retirement_reasons: readiness.retirement_reasons ?? [],
          summary: readiness.summary ?? null,
        },
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-work-item-continuation-context") {
    const context = body?.continuation_context || {};
    return withOutputReference(
      {
        delivery_id: body?.delivery_id ?? null,
        delivery_epic: compactItem(context.delivery_epic),
        parent_chain: compactItemList(context.parent_chain, 8),
        related_counts: context.summary ?? null,
        target_item: compactItem(context.target_item),
        work_item_id: body?.work_item_id ?? null,
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  if (workflowId === "delivery-work-item-evidence-packet") {
    const packet = body?.evidence_packet || {};
    return withOutputReference(
      {
        child_status_summary: packet.child_status_summary ?? null,
        continuation_summary: packet.continuation_summary ?? null,
        delivery_id: body?.delivery_id ?? null,
        evidence_state: packet.evidence_state ?? null,
        target_item: compactItem(packet.target_item),
        work_item_id: body?.work_item_id ?? null,
        workflow_id: workflowId,
      },
      body,
      { env, request },
    );
  }

  const artifact = fullOutputArtifact(body, { env, request });
  if (!artifact) {
    return body;
  }
  return {
    full_output: artifact,
    full_output_hint: "Use --json to print the full broker response.",
    top_level_keys: body && typeof body === "object" ? Object.keys(body) : [],
    workflow_id: workflowId ?? null,
  };
}

async function invokeBrokerRequest({
  env,
  request,
  spawnImpl,
  stderr = process.stderr,
}) {
  const namespace = env.ART_NAMESPACE || DEFAULT_ART_NAMESPACE;
  const deployment = env.ART_BROKER_DEPLOYMENT || DEFAULT_ART_BROKER_DEPLOYMENT;
  const baseUrl = env.ART_BROKER_BASE_URL || DEFAULT_BROKER_BASE_URL;
  const podScript = `
const [method, path, baseUrl, projectAssignablesOnly] = process.argv.slice(1);
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const stdinText = Buffer.concat(chunks).toString("utf8").trim();
let requestEnvelope = {};
if (stdinText) {
  requestEnvelope = JSON.parse(stdinText);
}
const bodyBase64 = requestEnvelope.bodyBase64;
let callerSecrets = {};
try {
  callerSecrets = JSON.parse(process.env.CALLER_AUTH_SECRETS_JSON || "{}");
} catch {
  callerSecrets = {};
}
const requestedCallerId = requestEnvelope.callerId;
const callerId = requestedCallerId || process.env.CALLER_ALLOWED_IDS.split(",")[0];
const callerSecret = requestedCallerId
  ? callerSecrets[callerId]
  : callerSecrets[callerId] || process.env.CALLER_AUTH_SHARED_SECRET;
if (!callerId || !callerSecret) {
  throw new Error("The requested broker caller does not have an admitted credential.");
}
const headers = {
  "x-oos-caller-id": callerId,
  "x-oos-caller-secret": callerSecret,
  Accept: "application/json",
};
const options = { method, headers };
if (bodyBase64 && bodyBase64 !== "-") {
  headers["content-type"] = "application/json";
  options.body = Buffer.from(bodyBase64, "base64").toString("utf8");
}
const response = await fetch(\`\${baseUrl}\${path}\`, options);
const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}
if (projectAssignablesOnly === "true") {
  body = body.assignables ?? body;
}
process.stdout.write(JSON.stringify({ ok: response.ok, status: response.status, body }));
process.exitCode = response.ok ? 0 : 1;
`.trim();

  const child = spawnImpl(
    "k3s",
    [
      "kubectl",
      "-n",
      namespace,
      "exec",
      "-i",
      `deploy/${deployment}`,
      "--",
      "node",
      "--input-type=module",
      "-e",
      podScript,
      request.method,
      request.path,
      baseUrl,
      request.projectAssignablesOnly ? "true" : "false",
    ],
    {
      env,
    },
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
  });
  child.stdin?.end(
    JSON.stringify({
      bodyBase64: request.bodyBase64 ?? null,
      callerId: request.callerId ?? null,
    }),
  );

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  const envelope = parseEnvelopeFromStdout(stdoutBuffer);

  if (stderrBuffer.trim()) {
    stderr.write(stderrBuffer);
  }

  if (!envelope) {
    throw new Error(
      `art CLI did not receive a JSON response envelope for ${request.description}. stdout=${summarizeBuffer(stdoutBuffer)} stderr=${summarizeBuffer(stderrBuffer)}`,
    );
  }

  return {
    envelope,
    exitCode: exitCode ?? 1,
  };
}

function wgcfReadinessPlanForRequest(request) {
  if (!request || request.method !== "POST") {
    return null;
  }

  const workItemMatch = request.path.match(
    /^\/v1\/delivery-work-items\/(work-item-\d+)\/(complete|stale-open-close)$/,
  );
  if (!workItemMatch) {
    return null;
  }

  return {
    contextRequest: {
      description: `Read continuation context for ${workItemMatch[1]}`,
      method: "GET",
      path: `/v1/delivery-work-items/${workItemMatch[1]}/continuation-context`,
    },
    enforcement: "required",
    operation: workItemMatch[2],
    targetItemId: workItemMatch[1],
  };
}

function wgcfAdvisoryPlanForRequest(request) {
  if (!request || request.method !== "GET") {
    return null;
  }

  const continuationMatch = request.path.match(
    /^\/v1\/delivery-work-items\/(work-item-\d+)\/continuation-context$/,
  );
  const evidencePacketMatch = request.path.match(
    /^\/v1\/delivery-work-items\/(work-item-\d+)\/evidence-packet$/,
  );
  const match = continuationMatch || evidencePacketMatch;
  if (!match) {
    return null;
  }

  return {
    enforcement: "advisory",
    operation: "continue",
    targetItemId: match[1],
  };
}

function compactWgcfReadiness(readiness) {
  if (!isObject(readiness)) {
    return null;
  }
  const findings = Array.isArray(readiness.findings) ? readiness.findings : [];
  const recommendations = Array.isArray(readiness.recommendations)
    ? readiness.recommendations
    : [];
  return {
    finding_count: findings.length,
    findings: findings.slice(0, 5).map((finding) => ({
      code: finding.code ?? null,
      recommended_route: finding.recommended_route ?? null,
      severity: finding.severity ?? null,
      target: finding.target ?? null,
    })),
    mutation_allowed: readiness.mutation_allowed ?? null,
    operation: readiness.operation ?? null,
    outcome: readiness.outcome ?? null,
    receipt_id: readiness.receipt_id ?? null,
    recommendation_count: recommendations.length,
    recommendations: recommendations.slice(0, 5).map((recommendation) => ({
      action: recommendation.action ?? null,
      decision_path: recommendation.decision_path ?? null,
      route: recommendation.route ?? null,
      target: recommendation.target ?? null,
    })),
    raw_context_embedded: readiness.raw_context_embedded ?? null,
    target_item_id: readiness.target_item_id ?? null,
  };
}

async function runWgcfArtReadiness({
  brokerContext,
  env,
  operation,
  spawnImpl,
  targetItemId,
}) {
  const repoRoot = wgcfRepoRoot(env);
  const tempRoot = mkdtempSync(path.join(tmpdir(), "oos-wgcf-art-"));
  const contextPath = path.join(tempRoot, "broker-context.json");
  try {
    writeFileSync(contextPath, `${JSON.stringify(brokerContext, null, 2)}\n`, "utf8");

    const child = spawnImpl(
      wgcfPythonCommand(repoRoot, env),
      [
        "-m",
        "wgcf_cli",
        "art",
        "readiness",
        "--context",
        contextPath,
        "--operation",
        operation,
        "--target-item-id",
        targetItemId,
        "--json",
      ],
      {
        cwd: repoRoot,
        env: {
          ...env,
          PYTHONPATH: wgcfPythonPath(repoRoot, env),
        },
      },
    );

    let stdoutBuffer = "";
    let stderrBuffer = "";
    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    const readiness = parseEnvelopeFromStdout(stdoutBuffer);
    if (!readiness) {
      throw new Error(
        `WGCF ART readiness did not return JSON. stdout=${summarizeBuffer(stdoutBuffer)} stderr=${summarizeBuffer(stderrBuffer)}`,
      );
    }

    return {
      exitCode: exitCode ?? 1,
      readiness,
      stderr: stderrBuffer,
    };
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

async function runRequiredWgcfReadiness({
  env,
  request,
  spawnImpl,
  stderr,
}) {
  const plan = wgcfReadinessPlanForRequest(request);
  if (!plan) {
    return null;
  }

  const { envelope, exitCode } = await invokeBrokerRequest({
    env,
    request: plan.contextRequest,
    spawnImpl,
    stderr,
  });
  if (!envelope.ok) {
    return {
      allowed: false,
      response: {
        blocked_route: `${request.method} ${request.path}`,
        broker_context_status: envelope.status,
        broker_context_workflow: envelope.body?.workflow_id ?? null,
        reason: "WGCF ART readiness requires broker continuation context before this mutation.",
        workflow_id: "delivery-art-wgcf-readiness-required",
      },
      status: exitCode || 1,
    };
  }

  const result = await runWgcfArtReadiness({
    brokerContext: envelope.body,
    env,
    operation: plan.operation,
    spawnImpl,
    targetItemId: plan.targetItemId,
  });
  if (result.stderr.trim()) {
    stderr.write(result.stderr);
  }

  if (result.exitCode !== 0 || result.readiness.mutation_allowed !== true) {
    return {
      allowed: false,
      response: {
        blocked_route: `${request.method} ${request.path}`,
        reason: "WGCF ART readiness blocked this mutation.",
        wgcf_art_readiness: result.readiness,
        workflow_id: "delivery-art-wgcf-readiness-required",
      },
      status: result.exitCode || 1,
    };
  }

  return {
    allowed: true,
    readiness: result.readiness,
  };
}

async function runAdvisoryWgcfReadiness({
  brokerContext,
  env,
  request,
  spawnImpl,
  stderr,
}) {
  const plan = wgcfAdvisoryPlanForRequest(request);
  if (!plan || !brokerContext) {
    return null;
  }

  const result = await runWgcfArtReadiness({
    brokerContext,
    env,
    operation: plan.operation,
    spawnImpl,
    targetItemId: plan.targetItemId,
  });
  if (result.stderr.trim()) {
    stderr.write(result.stderr);
  }

  return result.readiness;
}

export function buildArtCliRequest(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length === 0) {
    throw new Error(USAGE.trim());
  }

  if (args[0] === "bootstrap") {
    return {
      description: "Read the ART bootstrap pack",
      method: "GET",
      path: "/v1/delivery-session/bootstrap",
    };
  }

  if (args[0] === "workflow-health") {
    return {
      description: "Read delivery workflow health",
      method: "GET",
      path: "/v1/delivery-session/workflow-health",
    };
  }

  if (args[0] === "assignees") {
    return {
      description: "Read the live assignable principal list",
      method: "GET",
      path: "/v1/delivery-session/bootstrap",
      projectAssignablesOnly: true,
    };
  }

  if (args[0] === "initiative") {
    const action = args[1];
    const deliveryId = normalizeDeliveryId(args[2]);

    switch (action) {
      case "active-session":
        return {
          description: `Read active session packet for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/active-session-packet`,
        };
      case "evidence-packet":
        return {
          description: `Read initiative evidence packet for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/evidence-packet`,
        };
      case "review-pack":
        return {
          description: `Read initiative review pack for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/review-pack`,
        };
      case "execution-summary":
        return {
          description: `Read execution summary for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/execution-summary`,
        };
      case "planning":
        return {
          description: `Read planning summary for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/planning`,
        };
      case "governance":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
          description: `Update initiative governance for ${deliveryId}`,
          method: "POST",
          path: `/v1/delivery-initiatives/${deliveryId}/governance`,
        };
      case "planning-repair":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
          description: `Apply planning repair for ${deliveryId}`,
          method: "POST",
          path: `/v1/delivery-initiatives/${deliveryId}/plan/repair`,
        };
      case "closeout-readiness":
        return {
          description: `Read closeout readiness for ${deliveryId}`,
          method: "GET",
          path: `/v1/delivery-initiatives/${deliveryId}/closeout-readiness`,
        };
      case "close":
        return {
          bodyBase64: buildInputEnvelopePayloadBase64(args[3]),
          description: `Close initiative ${deliveryId}`,
          method: "POST",
          path: `/v1/delivery-initiatives/${deliveryId}/close`,
        };
      default:
        throw new Error(`unsupported initiative command: ${action}\n\n${USAGE}`);
    }
  }

  if (args[0] === "item") {
    const action = args[1];
    const workItemId = normalizeWorkItemId(args[2]);

    switch (action) {
      case "continuation":
        return {
          description: `Read continuation context for ${workItemId}`,
          method: "GET",
          path: `/v1/delivery-work-items/${workItemId}/continuation-context`,
        };
      case "evidence-packet":
        return {
          description: `Read evidence packet for ${workItemId}`,
          method: "GET",
          path: `/v1/delivery-work-items/${workItemId}/evidence-packet`,
        };
      case "blocker":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
          description: `Record blocker state for ${workItemId}`,
          method: "POST",
          path: `/v1/delivery-work-items/${workItemId}/blocker`,
        };
      case "complete":
        return {
          bodyBase64: buildInputEnvelopePayloadBase64(args[3]),
          description: `Complete ${workItemId}`,
          method: "POST",
          path: `/v1/delivery-work-items/${workItemId}/complete`,
        };
      case "stale-open-close":
        return {
          bodyBase64: buildInputEnvelopePayloadBase64(args[3]),
          description: `Close stale-open ${workItemId}`,
          method: "POST",
          path: `/v1/delivery-work-items/${workItemId}/stale-open-close`,
        };
      default:
        throw new Error(`unsupported item command: ${action}\n\n${USAGE}`);
    }
  }

  throw new Error(`unsupported command: ${args[0]}\n\n${USAGE}`);
}

async function runDraftCommand({
  argv,
  env,
  spawnImpl,
  stdout,
  stderr,
}) {
  if (argv[0] !== "draft") {
    return null;
  }

  const action = argv[1];
  if (action === "operations") {
    writeJson(stdout, {
      operations: listMutationOperations(),
      workflow_id: "delivery-art-mutation-draft-operations",
    });
    return 0;
  }

  if (action === "create") {
    const operation = argv[2];
    const targetId = argv[3];
    const outputPath = argv[4];
    if (!operation || !targetId || !outputPath) {
      throw new Error("draft create requires <operation> <target-id-or-dash> <output.json>");
    }

    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64({
          input: {
            operation,
            target_id: targetId === "-" ? null : targetId,
          },
        }),
        description: "Create mutation draft",
        method: "POST",
        path: "/v1/delivery-art/mutation-drafts",
      },
      spawnImpl,
      stderr,
    });

    if (!envelope.ok) {
      writeJson(stdout, envelope.body);
      return exitCode;
    }

    writeArtifactFile(outputPath, envelope.body.mutation_draft);
    writeJson(stdout, {
      generated_draft: outputPath,
      operation: envelope.body.mutation_draft.operation,
      route: envelope.body.mutation_draft.route,
      workflow_id: "delivery-art-mutation-draft-create-local",
    });
    return 0;
  }

  if (action === "show") {
    const draftPath = argv[2];
    if (!draftPath) {
      throw new Error("draft show requires <draft.json>");
    }
    writeJson(stdout, readArtifactFile(draftPath));
    return 0;
  }

  if (action === "validate") {
    const draftPath = argv[2];
    if (!draftPath) {
      throw new Error("draft validate requires <draft.json>");
    }
    const draft = readArtifactFile(draftPath);
    const { envelope } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64({
          mutation_draft: draft,
        }),
        description: "Validate mutation draft",
        method: "POST",
        path: "/v1/delivery-art/mutation-drafts/validate",
      },
      spawnImpl,
      stderr,
    });
    writeJson(stdout, envelope.body);
    return envelope.body?.validation?.valid ? 0 : 1;
  }

  if (action === "submit") {
    const draftPath = argv[2];
    if (!draftPath) {
      throw new Error("draft submit requires <draft.json>");
    }
    const draft = readArtifactFile(draftPath);
    const validation = validateMutationDraft(draft);
    if (!validation.valid) {
      writeJson(stdout, {
        validation,
        workflow_id: "delivery-art-mutation-draft-submit",
      });
      return 1;
    }

    const request = {
      bodyBase64: payloadToBase64(draft.payload),
      description: `Submit mutation draft ${draft.draft_id}`,
      method: draft.route.method,
      path: draft.route.path,
    };
    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    const projectionState = envelope.ok
      ? markProjectionDirtyIfRequired({ body: envelope.body, env, request })
      : null;

    const submittedDraft = {
      ...draft,
      status: envelope.ok ? "submitted" : "submission_failed",
      submission: {
        result: envelope.body,
        status: envelope.status,
        submitted_at: new Date().toISOString(),
      },
      validation: {
        last_validated_at: validation.validated_at,
        result: validation.valid ? "valid" : "invalid",
        warnings: validation.warnings,
      },
    };
    writeArtifactFile(draftPath, submittedDraft);
    writeJson(stdout, {
      broker_response: envelope.body,
      draft_path: draftPath,
      ...(projectionState
        ? {
            projection_checkpoint: {
              dirty: true,
              dirty_event_count: projectionState.dirty_events.length,
              next_action:
                "Run `npm run art -- projection sync --pi-names <known-pis> --target-epic-id <epic-id> --quality` at the next projection checkpoint.",
              state_file: projectionStateFile(env),
            },
          }
        : {}),
      status: submittedDraft.status,
      workflow_id: "delivery-art-mutation-draft-submit",
    });
    return exitCode;
  }

  if (action === "discard") {
    const draftPath = argv[2];
    if (!draftPath) {
      throw new Error("draft discard requires <draft.json> [reason]");
    }
    const draft = readArtifactFile(draftPath);
    const discardedDraft = {
      ...draft,
      discarded_at: new Date().toISOString(),
      discard_reason: argv.slice(3).join(" ").trim() || null,
      status: "discarded",
    };
    writeArtifactFile(draftPath, discardedDraft);
    writeJson(stdout, {
      discarded_draft: draftPath,
      workflow_id: "delivery-art-mutation-draft-discard",
    });
    return 0;
  }

  if (action === "export") {
    const draftPath = argv[2];
    const outputPath = argv[3];
    if (!draftPath || !outputPath) {
      throw new Error("draft export requires <draft.json> <output.json>");
    }
    copyFileSync(draftPath, outputPath);
    writeJson(stdout, {
      exported_draft: outputPath,
      source_draft: draftPath,
      workflow_id: "delivery-art-mutation-draft-export",
    });
    return 0;
  }

  if (action === "import") {
    const inputPath = argv[2];
    const outputPath = argv[3];
    if (!inputPath || !outputPath) {
      throw new Error("draft import requires <input.json> <output.json>");
    }
    const draft = readArtifactFile(inputPath);
    const validation = validateMutationDraft(draft);
    if (!validation.valid) {
      writeJson(stdout, {
        validation,
        workflow_id: "delivery-art-mutation-draft-import",
      });
      return 1;
    }
    writeArtifactFile(outputPath, draft);
    writeJson(stdout, {
      imported_draft: outputPath,
      source_draft: inputPath,
      validation,
      workflow_id: "delivery-art-mutation-draft-import",
    });
    return 0;
  }

  throw new Error(`unsupported draft command: ${action}\n\n${USAGE}`);
}

async function runWgcfCommand({
  argv,
  env,
  spawnImpl,
  stdout,
  stderr,
}) {
  if (argv[0] !== "wgcf") {
    return null;
  }

  const action = argv[1];
  if (action === "draft") {
    const handshakePath = argv[2];
    const outputPath = argv[3];
    if (!handshakePath || !outputPath) {
      throw new Error("wgcf draft requires <handshake.json> <output.json>");
    }

    const handshake = readArtifactFile(handshakePath);
    const localPreflight = createWgcfMutationDraft({
      input: handshake.input ?? handshake,
      operator: {
        caller_id: "local-preflight",
      },
    });
    const localValidation = validateMutationDraft(localPreflight.mutation_draft);
    if (!localValidation.valid) {
      writeJson(stdout, {
        validation: localValidation,
        workflow_id: "delivery-art-wgcf-mutation-draft-local-preflight",
      });
      return 1;
    }

    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64({
          input: handshake.input ?? handshake,
        }),
        description: "Create WGCF mutation draft",
        method: "POST",
        path: "/v1/delivery-art/wgcf/mutation-drafts",
      },
      spawnImpl,
      stderr,
    });

    if (!envelope.ok) {
      writeJson(stdout, envelope.body);
      return exitCode;
    }

    writeArtifactFile(outputPath, envelope.body.mutation_draft);
    writeJson(stdout, {
      authority: envelope.body.authority,
      generated_draft: outputPath,
      operation: envelope.body.mutation_draft.operation,
      receipt_refs: envelope.body.receipt_refs,
      route: envelope.body.mutation_draft.route,
      workflow_id: "delivery-art-wgcf-mutation-draft-create-local",
    });
    return 0;
  }

  throw new Error(`unsupported wgcf command: ${action}\n\n${USAGE}`);
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function summarizeReviewPacketEvidence(packet, packetPath) {
  const landingUnit = packet.landing_unit || {};
  const evidence = packet.evidence || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const changedSurfaces = Array.isArray(evidence.changed_surfaces)
    ? evidence.changed_surfaces
    : [];
  const validations = Array.isArray(evidence.validations) ? evidence.validations : [];
  const testResults = Array.isArray(evidence.tests)
    ? evidence.tests
    : Array.isArray(evidence.test_results)
      ? evidence.test_results
      : [];
  const prUrls = repos.map((repo) => repo.pr_url).filter(Boolean);
  const mergeCommits = repos.map((repo) => repo.merge_commit).filter(Boolean);

  return {
    delivery_id: packet.delivery_id ?? null,
    review_packet_evidence_packet: {
      covered_work_item_ids: packet.covered_work_item_ids || [],
      evidence_state: {
        changed_surface_count: changedSurfaces.length,
        test_result_count: testResults.length,
        validation_count: validations.length,
      },
      generated_at: new Date().toISOString(),
      landing_unit: {
        evidence_kind: landingUnit.evidence_kind || "unknown",
        merge_commit: landingUnit.merge_commit || mergeCommits[0] || null,
        pr_url: landingUnit.pr_url || prUrls[0] || null,
        repo_names: repos.map((repo) => repo.repo_name).filter(Boolean),
        rollback_boundary: landingUnit.rollback_boundary || null,
      },
      packet_digest: packet.packet_digest || `sha256:${sha256Json(packet)}`,
      packet_id: packet.packet_id || null,
      packet_path: packetPath,
      packet_semantics: {
        raw_source_artifacts_embedded: false,
        source_of_truth: "local OOS Review Packet artifact",
        use_for:
          "Cite Review Packet evidence without rereading the full packet body.",
      },
      schema_version: 1,
      status: packet.status || null,
    },
    workflow_id: "delivery-art-review-packet-evidence-packet",
  };
}

function itemIdFromRecord(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (Number.isInteger(item.id) && item.id > 0) {
    return toWorkItemId(item.id);
  }
  if (typeof item.record_ref === "string") {
    const match = item.record_ref.match(/work_packages\/(\d+)$/);
    if (match) {
      return toWorkItemId(Number.parseInt(match[1], 10));
    }
  }
  return null;
}

function isClosedArtStatus(status) {
  return ["closed", "done", "retired"].includes(
    typeof status === "string" ? status.trim().toLowerCase() : "",
  );
}

function normalizeEvidenceBullets(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "- NOT APPLICABLE: no evidence lines were supplied by the Review Packet.";
  }
  return lines
    .map((line) => {
      if (typeof line === "string") {
        return line.trim();
      }
      if (!line || typeof line !== "object") {
        return "";
      }
      const result = line.result === "not_applicable"
        ? "NOT APPLICABLE"
        : String(line.result ?? "CHECK").toUpperCase();
      const label = line.name || line.command || line.id || "Structured evidence";
      const detail = line.summary || line.not_applicable_reason || "Recorded by the Review Packet.";
      return `${result}: ${label}: ${detail}`;
    })
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
}

function normalizeChangedSurfaceBullets(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "- `Review Packet`: no changed surfaces were supplied.";
  }
  return lines
    .map((line) => {
      if (typeof line === "string") {
        return line.trim();
      }
      if (!line || typeof line !== "object") {
        return "";
      }
      const location = [line.repo, line.path].filter(Boolean).join("/");
      return `\`${location || line.id || "Review Packet"}\`: ${line.summary || "covered by finalized Review Packet evidence."}`;
    })
    .filter(Boolean)
    .map((line) => {
      const body = line.replace(/^- /, "").trim();
      if (body.startsWith("`") || body.startsWith("[")) {
        return `- ${body}`;
      }
      const separatorIndex = body.indexOf(":");
      if (separatorIndex === -1) {
        return `- \`${body}\`: covered by finalized Review Packet evidence.`;
      }
      const surface = body.slice(0, separatorIndex).trim();
      const description = body.slice(separatorIndex + 1).trim();
      return `- \`${surface}\`: ${description}`;
    })
    .join("\n");
}

function reviewPacketDigest(packet) {
  return packet.integrity?.content_digest || packet.packet_digest || `sha256:${sha256Json(packet)}`;
}

function completionMappingForWorkItem(packet, workItemId) {
  const mappings = Array.isArray(packet.evidence?.acceptance_mapping)
    ? packet.evidence.acceptance_mapping
    : Array.isArray(packet.completion_mapping)
      ? packet.completion_mapping
      : [];
  const mapping = mappings.find((entry) => entry?.work_item_id === workItemId);
  const summary = mapping?.summary ?? mapping?.evidence_summary;
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }
  return `Finalized Review Packet ${packet.packet_id || "(unknown)"} covers ${workItemId}.`;
}

function landingUnitSourceEvidence(packet) {
  const landingUnit = packet.landing_unit || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const prUrls = repos.map((repo) => repo.pr_url).filter(Boolean);
  const mergeCommits = repos.map((repo) => repo.merge_commit).filter(Boolean);
  return {
    mergeCommit: landingUnit.merge_commit || mergeCommits.join(", ") || "no merge commit recorded",
    mergeCommits,
    prUrl: landingUnit.pr_url || prUrls.join(", ") || "no PR URL recorded",
    prUrls,
    repoNames: repos.map((repo) => repo.repo_name).filter(Boolean),
  };
}

function buildReviewPacketCompletionInput(packet, workItemId) {
  const digest = reviewPacketDigest(packet);
  const source = landingUnitSourceEvidence(packet);
  return {
    changed_surfaces: normalizeChangedSurfaceBullets(packet.evidence?.changed_surfaces),
    completion_note:
      `Finalized Review Packet ${packet.packet_id || "(unknown)"} digest ` +
      `${digest} binds ${source.prUrl} merge ${source.mergeCommit} to ${workItemId}.`,
    completion_summary: completionMappingForWorkItem(packet, workItemId),
    test_result_evidence: normalizeEvidenceBullets(
      packet.evidence?.tests ?? packet.evidence?.test_results,
    ),
    validation_evidence: normalizeEvidenceBullets(packet.evidence?.validations),
  };
}

function buildReviewPacketParentCloseInput(packet, parent, childIds) {
  const digest = reviewPacketDigest(packet);
  const source = landingUnitSourceEvidence(packet);
  const parentId = itemIdFromRecord(parent) || "work-item-unknown";
  const childList = childIds.join(", ");
  return {
    changed_surfaces: normalizeChangedSurfaceBullets(packet.evidence?.changed_surfaces),
    completion_note:
      `Finalized Review Packet ${packet.packet_id || "(unknown)"} digest ` +
      `${digest} binds ${source.prUrl} merge ` +
      `${source.mergeCommit} to parent ${parentId}.`,
    completion_summary:
      `Closed parent ${parentId} after covered child scope completed through the ` +
      `same finalized Review Packet: ${childList}.`,
    stale_open_justification:
      `All open child scope known to the landing unit under ${parentId} is covered ` +
      `by finalized Review Packet ${packet.packet_id || "(unknown)"} digest ${digest}. ` +
      `Covered children: ${childList}.`,
    test_result_evidence: normalizeEvidenceBullets(
      packet.evidence?.tests ?? packet.evidence?.test_results,
    ),
    validation_evidence: normalizeEvidenceBullets(packet.evidence?.validations),
  };
}

function validateGeneratedCompletionInput(input) {
  const sections = buildCompletionSections({
    changedSurfaces: input.changed_surfaces,
    completionSummary: input.completion_summary,
    residualFollowUp: input.residual_follow_up ?? null,
    testResultArtifact: input.test_result_artifact ?? null,
    testResultEvidence: input.test_result_evidence,
    validationEvidence: input.validation_evidence,
  });
  return validateCompletionSections(sections);
}

function generatedPayloadPreflightEntry({ input, target, type }) {
  const result = validateGeneratedCompletionInput(input);
  return {
    issue_count: result.issues.length,
    issues: result.issues,
    target,
    type,
    valid: result.formattingValid,
  };
}

function extractWorkItemEvidence(body) {
  const continuation = body?.continuation_context || {};
  const evidencePacket = body?.evidence_packet || {};
  const targetItem = evidencePacket.target_item || continuation.target_item || null;
  const parentChain = Array.isArray(evidencePacket.parent_chain)
    ? evidencePacket.parent_chain
    : Array.isArray(continuation.parent_chain)
      ? continuation.parent_chain
      : [];
  const openSiblings = Array.isArray(continuation.open_siblings)
    ? continuation.open_siblings
    : [];
  const summary = evidencePacket.continuation_summary || continuation.summary || {};
  const parent = [...parentChain]
    .reverse()
    .find((entry) => entry?.type !== "Epic" && itemIdFromRecord(entry));
  return {
    open_sibling_ids: openSiblings.map(itemIdFromRecord).filter(Boolean),
    parent,
    parent_id: itemIdFromRecord(parent),
    summary,
    target_item: targetItem,
    work_item_id: itemIdFromRecord(targetItem) || body?.work_item_id || null,
  };
}

async function fetchLandingUnitWorkItemEvidence({ env, spawnImpl, stderr, workItemId }) {
  const request = {
    description: `Read landing-unit evidence for ${workItemId}`,
    method: "GET",
    path: `/v1/delivery-work-items/${workItemId}/evidence-packet`,
  };
  const { envelope, exitCode } = await invokeBrokerRequest({
    env,
    request,
    spawnImpl,
    stderr,
  });
  return {
    evidence: extractWorkItemEvidence(envelope.body),
    exitCode,
    ok: envelope.ok,
    request,
    response: envelope.body,
    status: envelope.status,
  };
}

function summarizeLandingUnitItem(entry) {
  const item = entry.evidence.target_item || {};
  const parent = entry.evidence.parent || {};
  return {
    parent_id: entry.evidence.parent_id,
    parent_status: parent.status ?? null,
    parent_subject: truncateValue(parent.subject ?? ""),
    status: item.status ?? null,
    subject: truncateValue(item.subject ?? ""),
    type: item.type ?? null,
    work_item_id: entry.work_item_id,
  };
}

function buildLandingUnitPlan({ evidenceEntries, packet, packetPath }) {
  const coveredIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids.map(normalizeWorkItemId)
    : [];
  const coveredSet = new Set(coveredIds);
  const parentByWorkItemId = new Map(
    evidenceEntries.map((entry) => [
      entry.work_item_id,
      entry.evidence.parent_id,
    ]),
  );
  const coveredParentIds = new Set(
    evidenceEntries
      .map((entry) => entry.evidence.parent_id)
      .filter((parentId) => parentId && coveredSet.has(parentId)),
  );
  const validation = packet.schema_version === 2
    ? { ...validateDeliveryArtArtifact(packet), warnings: [] }
    : validateReviewPacket(packet, { final: true });
  const errors = [...validation.errors];
  if (packet.status !== "finalized") {
    errors.push("review packet must be finalized before landing-unit submit");
  }

  const completionTargets = [];
  const skippedWorkItems = [];
  const parentGroups = new Map();

  for (const entry of evidenceEntries) {
    const targetItem = entry.evidence.target_item || {};
    const targetStatus = targetItem.status ?? null;
    if (isClosedArtStatus(targetStatus)) {
      skippedWorkItems.push({
        reason: "already_closed",
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    } else if (coveredParentIds.has(entry.work_item_id)) {
      skippedWorkItems.push({
        reason: "parent_closeout_after_children",
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    } else {
      completionTargets.push({
        status: targetStatus,
        work_item_id: entry.work_item_id,
      });
    }

    if (entry.evidence.parent_id) {
      const existing = parentGroups.get(entry.evidence.parent_id) || {
        child_ids: [],
        parent: entry.evidence.parent,
        uncovered_open_sibling_ids: new Set(),
      };
      existing.child_ids.push(entry.work_item_id);
      for (const siblingId of entry.evidence.open_sibling_ids) {
        if (!coveredSet.has(siblingId)) {
          existing.uncovered_open_sibling_ids.add(siblingId);
        }
      }
      parentGroups.set(entry.evidence.parent_id, existing);
    }
  }

  const parentCloseoutCandidates = [...parentGroups.entries()]
    .map(([parentId, group]) => {
      const uncovered = [...group.uncovered_open_sibling_ids].sort();
      const parentStatus = group.parent?.status ?? null;
      const eligible =
        !isClosedArtStatus(parentStatus) &&
        group.child_ids.length > 0 &&
        uncovered.length === 0;
      return {
        action: eligible ? "stale-open-close-after-children" : "not-ready",
        child_ids: group.child_ids.sort(),
        eligible_after_child_completion: eligible,
        parent_id: parentId,
        parent_status: parentStatus,
        parent_subject: truncateValue(group.parent?.subject ?? ""),
        uncovered_open_sibling_ids: uncovered,
      };
    })
    .sort((left, right) => {
      const hierarchyDepth = (workItemId) => {
        let current = workItemId;
        let depth = 0;
        const seen = new Set();
        while (parentByWorkItemId.get(current) && !seen.has(current)) {
          seen.add(current);
          current = parentByWorkItemId.get(current);
          depth += 1;
        }
        return depth;
      };
      return (
        hierarchyDepth(right.parent_id) - hierarchyDepth(left.parent_id) ||
        left.parent_id.localeCompare(right.parent_id)
      );
    });
  const generatedPayloadPreflight = [];
  for (const target of completionTargets) {
    generatedPayloadPreflight.push(
      generatedPayloadPreflightEntry({
        input: buildReviewPacketCompletionInput(packet, target.work_item_id),
        target: target.work_item_id,
        type: "work-item.complete",
      }),
    );
  }
  for (const candidate of parentCloseoutCandidates.filter(
    (entry) => entry.eligible_after_child_completion,
  )) {
    const group = parentGroups.get(candidate.parent_id);
    generatedPayloadPreflight.push(
      generatedPayloadPreflightEntry({
        input: buildReviewPacketParentCloseInput(packet, group?.parent, candidate.child_ids),
        target: candidate.parent_id,
        type: "work-item.stale-open-close",
      }),
    );
  }
  const generatedPayloadIssues = generatedPayloadPreflight.flatMap((entry) =>
    entry.issues.map((issue) => `${entry.type} ${entry.target}: ${issue}`),
  );
  errors.push(...generatedPayloadIssues);

  const source = landingUnitSourceEvidence(packet);
  return {
    coverage: evidenceEntries.map(summarizeLandingUnitItem),
    delivery_id: packet.delivery_id ?? null,
    errors,
    landing_unit: {
      evidence_kind: packet.landing_unit?.evidence_kind ?? null,
      merge_commit: source.mergeCommits[0] ?? packet.landing_unit?.merge_commit ?? null,
      merge_commits: source.mergeCommits,
      pr_url: source.prUrls[0] ?? packet.landing_unit?.pr_url ?? null,
      pr_urls: source.prUrls,
      repo_names: source.repoNames,
      rollback_boundary: packet.landing_unit?.rollback_boundary ?? null,
    },
    packet_digest: reviewPacketDigest(packet),
    packet_id: packet.packet_id ?? null,
    packet_path: packetPath,
    parent_closeout_candidates: parentCloseoutCandidates,
    planned_completion_count: completionTargets.length,
    planned_completions: completionTargets,
    ready_to_submit: errors.length === 0,
    generated_payload_preflight: {
      checked_count: generatedPayloadPreflight.length,
      invalid_count: generatedPayloadPreflight.filter((entry) => !entry.valid).length,
      results: generatedPayloadPreflight,
      valid: generatedPayloadIssues.length === 0,
    },
    skipped_work_items: skippedWorkItems,
    validation: {
      error_count: validation.errors.length,
      errors: validation.errors,
      valid: validation.valid,
      warning_count: validation.warnings.length,
      warnings: validation.warnings,
    },
  };
}

async function analyzeLandingUnitPacket({ env, packet, packetPath, spawnImpl, stderr }) {
  const coveredWorkItemIds = Array.isArray(packet.covered_work_item_ids)
    ? packet.covered_work_item_ids
    : [];
  const evidenceEntries = [];
  for (const workItemId of coveredWorkItemIds) {
    const normalizedWorkItemId = normalizeWorkItemId(workItemId);
    const result = await fetchLandingUnitWorkItemEvidence({
      env,
      spawnImpl,
      stderr,
      workItemId: normalizedWorkItemId,
    });
    evidenceEntries.push({
      ...result,
      work_item_id: normalizedWorkItemId,
    });
  }
  return buildLandingUnitPlan({ evidenceEntries, packet, packetPath });
}

async function submitLandingUnitPacket({
  env,
  packet,
  packetPath,
  plan,
  spawnImpl,
  stderr,
}) {
  const completed = [];
  const failed = [];
  let projectionState = null;

  for (const target of plan.planned_completions) {
    const request = {
      bodyBase64: payloadToBase64({
        input: buildReviewPacketCompletionInput(packet, target.work_item_id),
      }),
      description: `Landing-unit complete ${target.work_item_id}`,
      method: "POST",
      path: `/v1/delivery-work-items/${target.work_item_id}/complete`,
    };
    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    if (!envelope.ok) {
      failed.push({
        exit_code: exitCode,
        response: envelope.body,
        status: envelope.status,
        work_item_id: target.work_item_id,
      });
      break;
    }
    projectionState =
      markProjectionDirtyIfRequired({ body: envelope.body, env, request }) ||
      projectionState;
    completed.push({
      status: envelope.body?.work_item?.status ?? null,
      wgcf_receipt_id: envelope.body?.wgcf_art_readiness?.receipt_id ?? null,
      work_item_id: target.work_item_id,
    });
  }

  const parentCloseouts = [];
  if (failed.length === 0) {
    for (const candidate of plan.parent_closeout_candidates.filter(
      (entry) => entry.eligible_after_child_completion,
    )) {
      const refreshed = await fetchLandingUnitWorkItemEvidence({
        env,
        spawnImpl,
        stderr,
        workItemId: candidate.parent_id,
      });
      const parentItem = refreshed.evidence.target_item || {};
      if (isClosedArtStatus(parentItem.status)) {
        parentCloseouts.push({
          action: "skipped",
          parent_id: candidate.parent_id,
          reason: "already_closed",
          status: parentItem.status ?? null,
        });
        continue;
      }
      const refreshedSummary = refreshed.evidence.summary || {};
      if (refreshedSummary.open_child_count !== 0) {
        parentCloseouts.push({
          action: "skipped",
          open_child_count: refreshedSummary.open_child_count ?? null,
          parent_id: candidate.parent_id,
          reason: "open_children_remain",
        });
        continue;
      }

      const request = {
        bodyBase64: payloadToBase64({
          input: buildReviewPacketParentCloseInput(
            packet,
            parentItem,
            candidate.child_ids,
          ),
        }),
        description: `Landing-unit stale-open-close ${candidate.parent_id}`,
        method: "POST",
        path: `/v1/delivery-work-items/${candidate.parent_id}/stale-open-close`,
      };
      const { envelope, exitCode } = await invokeBrokerRequest({
        env,
        request,
        spawnImpl,
        stderr,
      });
      if (!envelope.ok) {
        failed.push({
          exit_code: exitCode,
          parent_id: candidate.parent_id,
          response: envelope.body,
          status: envelope.status,
        });
        break;
      }
      projectionState =
        markProjectionDirtyIfRequired({ body: envelope.body, env, request }) ||
        projectionState;
      parentCloseouts.push({
        action: "stale-open-closed",
        parent_id: candidate.parent_id,
        status: envelope.body?.work_item?.status ?? null,
        wgcf_receipt_id: envelope.body?.wgcf_art_readiness?.receipt_id ?? null,
      });
    }
  }

  return {
    completed,
    failed,
    packet_digest: plan.packet_digest,
    packet_id: plan.packet_id,
    packet_path: packetPath,
    parent_closeouts: parentCloseouts,
    skipped_work_items: plan.skipped_work_items,
    projection_checkpoint: projectionState
      ? {
          dirty: true,
          dirty_event_count: projectionState.dirty_events.length,
          next_action:
            "Run `npm run art -- projection sync --pi-names <known-pis> --target-epic-id <epic-id> --quality` at the next projection checkpoint.",
          state_file: projectionStateFile(env),
        }
      : {
          dirty: false,
          next_action: "No projection checkpoint is pending.",
          state_file: projectionStateFile(env),
        },
    status: failed.length === 0 ? "submitted" : "submission_failed",
    workflow_id: "delivery-art-landing-unit-submit",
  };
}

async function runLandingUnitCommand({
  argv,
  env,
  spawnImpl,
  stdout,
  stderr,
}) {
  if (argv[0] !== "landing-unit") {
    return null;
  }

  const action = argv[1];
  const packetPath = argv[2];
  if (!["status", "dry-run", "submit"].includes(action)) {
    throw new Error(`unsupported landing-unit command: ${action}\n\n${USAGE}`);
  }
  if (!packetPath) {
    throw new Error(`landing-unit ${action} requires <packet.json>`);
  }

  const packet = readArtifactFile(packetPath);
  const plan = await analyzeLandingUnitPacket({
    env,
    packet,
    packetPath,
    spawnImpl,
    stderr,
  });

  if (action === "status" || action === "dry-run") {
    writeJson(stdout, {
      ...plan,
      dry_run: action === "dry-run",
      workflow_id:
        action === "dry-run"
          ? "delivery-art-landing-unit-dry-run"
          : "delivery-art-landing-unit-status",
    });
    return plan.ready_to_submit ? 0 : 1;
  }

  if (!plan.ready_to_submit) {
    writeJson(stdout, {
      ...plan,
      status: "blocked",
      workflow_id: "delivery-art-landing-unit-submit",
    });
    return 1;
  }

  const result = await submitLandingUnitPacket({
    env,
    packet,
    packetPath,
    plan,
    spawnImpl,
    stderr,
  });
  writeJson(stdout, result);
  return result.failed.length === 0 ? 0 : 1;
}

async function runDeliveryArtLifecycleCommand({
  argv,
  env,
  execFileSyncImpl,
  spawnImpl,
  stderr,
  stdout,
}) {
  if (argv[0] !== "lifecycle") {
    return null;
  }
  const action = argv[1];
  const planPath = argv[2];
  if (!["status", "reconcile"].includes(action)) {
    throw new Error(`unsupported lifecycle command: ${action}\n\n${USAGE}`);
  }
  if (!planPath) {
    throw new Error(`lifecycle ${action} requires <plan.json>`);
  }
  const plan = readCanonicalArtifactFile(planPath);
  const brokerRequest = async ({ body, callerId, method, path: requestPath }) => {
    const { envelope } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: body === null ? null : payloadToBase64(body),
        callerId,
        description: `Delivery ART lifecycle ${method} ${requestPath}`,
        method,
        path: requestPath,
      },
      spawnImpl,
      stderr,
    });
    return envelope;
  };
  const controller = createDeliveryArtLifecycleController(
    createDeliveryArtLifecycleCliAdapters({
      brokerRequest,
      ...(execFileSyncImpl ? { execFileSyncImpl } : {}),
    }),
  );
  const result = action === "status"
    ? await controller.inspect(plan)
    : await controller.reconcile(plan);
  if (action === "reconcile") {
    const updatedPlan = bindFinalizedReviewPacketReference(
      plan,
      result.artifacts.review_packet,
    );
    if (JSON.stringify(updatedPlan) !== JSON.stringify(plan)) {
      writeCanonicalArtifactFile(planPath, updatedPlan);
    }
  }
  writeJson(
    stdout,
    shouldPrintFullJson(argv)
      ? { ...result, workflow_id: "delivery-art-lifecycle" }
      : compactDeliveryArtLifecycleResult(result),
  );
  return 0;
}

async function runDeliveryArtArtifactCommand({
  argv,
  env,
  spawnImpl,
  stdout,
  stderr,
}) {
  const family = argv[0];
  const action = argv[1];
  const artifactPath = argv[2];
  const specs = {
    "architecture:persist": {
      description: "Persist Delivery ART architecture packet",
      callerBound: true,
      path: "/v1/delivery-art/architecture-packets/persist",
      writeBack: true,
    },
    "artifact:resolve": {
      description: "Resolve durable Delivery ART artifact",
      path: "/v1/delivery-art/artifacts/resolve",
      resolve: true,
      writeBack: false,
    },
    "artifact:validate": {
      description: "Validate Delivery ART artifact",
      path: "/v1/delivery-art/artifacts/validate",
      writeBack: false,
    },
    "work-start:evaluate": {
      description: "Evaluate Delivery ART work-start",
      callerBound: true,
      path: "/v1/delivery-art/work-start/evaluate",
      writeBack: true,
    },
  };
  const supportedFamilies = new Set(["architecture", "artifact", "work-start"]);
  if (!supportedFamilies.has(family)) {
    return null;
  }

  const spec = specs[`${family}:${action}`];
  if (!spec) {
    throw new Error(`unsupported ${family} command: ${action}\n\n${USAGE}`);
  }
  if (!artifactPath) {
    throw new Error(`${family} ${action} requires <artifact.json>`);
  }

  const artifact = readCanonicalArtifactFile(artifactPath);
  const requestBody = spec.resolve
    ? {
        reference: {
          digest: artifact.integrity?.content_digest,
          uri: artifact.custody?.uri,
        },
      }
    : { artifact };
  const request = {
    bodyBase64: payloadToBase64(requestBody),
    callerId: spec.callerBound ? artifact.operator?.id ?? null : null,
    description: spec.description,
    method: "POST",
    path: spec.path,
  };
  const { envelope, exitCode } = await invokeBrokerRequest({
    env,
    request,
    spawnImpl,
    stderr,
  });
  if (envelope.ok && spec.writeBack && envelope.body?.artifact) {
    writeCanonicalArtifactFile(artifactPath, envelope.body.artifact);
  }
  const output = shouldPrintFullJson(argv)
    ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
    : await attachCggPacketReference(
        compactDeliveryArtArtifactOutput(envelope.body, {
          action: `${family} ${action}`,
          artifactPath,
          env,
          request,
          sourceArtifact: artifact,
        }),
        { env, spawnImpl },
      );
  writeJson(stdout, output);
  return exitCode;
}

function readinessReceiptReference(receiptPath) {
  const receipt = readCanonicalArtifactFile(receiptPath);
  const reference = receipt.custody?.uri && receipt.integrity?.content_digest
    ? {
        digest: receipt.integrity.content_digest,
        uri: receipt.custody.uri,
      }
    : {
        digest: receipt.digest,
        uri: receipt.uri,
      };
  if (typeof reference.uri !== "string" || typeof reference.digest !== "string") {
    throw new Error(
      "--readiness-receipt must contain a durable readiness receipt or its {uri,digest} reference",
    );
  }
  return reference;
}

async function runReviewPacketCommand({
  argv,
  env,
  execFileSyncImpl,
  spawnImpl,
  stdout,
  stderr,
}) {
  if (argv[0] !== "review-packet") {
    return null;
  }

  const action = argv[1];
  if (action === "draft") {
    const deliveryId = argv[2];
    const outputPath = argv[3];
    const coveredWorkItemIds = [];
    const repoRoots = [];
    const draftArgs = argv.slice(4);
    for (let index = 0; index < draftArgs.length; index += 1) {
      const entry = draftArgs[index];
      if (entry === "--repo-root") {
        const repoRoot = draftArgs[index + 1];
        if (!repoRoot) {
          throw new Error("review-packet draft --repo-root requires <path>");
        }
        repoRoots.push(path.resolve(repoRoot));
        index += 1;
        continue;
      }
      coveredWorkItemIds.push(entry);
    }
    if (!deliveryId || !outputPath || coveredWorkItemIds.length === 0) {
      throw new Error(
        "review-packet draft requires <delivery-id> <output.json> <work-item-id...> [--repo-root <path>...]",
      );
    }
    const packet = createReviewPacketDraft({
      coveredWorkItemIds,
      deliveryId,
      execFileSyncImpl,
      repoRoots: repoRoots.length > 0 ? repoRoots : [process.cwd()],
    });
    writeArtifactFile(outputPath, packet);
    writeJson(stdout, {
      covered_work_item_ids: packet.covered_work_item_ids,
      generated_review_packet: outputPath,
      repo_count: packet.landing_unit.repos.length,
      repos: packet.landing_unit.repos.map((repo) => ({
        changed_file_count: repo.changed_files.length,
        repo_name: repo.repo_name,
        repo_root: repo.repo_root,
      })),
      workflow_id: "delivery-art-review-packet-draft-local",
    });
    return 0;
  }

  if (action === "evidence-packet") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet evidence-packet requires <packet.json>");
    }
    const packet = readArtifactFile(packetPath);
    writeJson(stdout, summarizeReviewPacketEvidence(packet, packetPath));
    return 0;
  }

  if (action === "validate") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet validate requires <packet.json>");
    }
    const parsedPacket = readArtifactFile(packetPath);
    const packet = parsedPacket.schema_version === 2
      ? readCanonicalArtifactFile(packetPath)
      : parsedPacket;
    const request = {
      bodyBase64: payloadToBase64({
        review_packet: packet,
      }),
      callerId: packet.schema_version === 2 ? packet.operator?.id ?? null : null,
      description: "Validate review packet",
      method: "POST",
      path: "/v1/delivery-art/review-packets/validate",
    };
    const { envelope } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    const output = shouldPrintFullJson(argv)
      ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
      : await attachCggPacketReference(
          compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
          { env, spawnImpl },
        );
    writeJson(stdout, output);
    return envelope.body?.validation?.valid ? 0 : 1;
  }

  if (action === "readiness") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet readiness requires <packet.json>");
    }
    const parsedPacket = readArtifactFile(packetPath);
    const packet = parsedPacket.schema_version === 2
      ? readCanonicalArtifactFile(packetPath)
      : parsedPacket;
    const request = {
      bodyBase64: payloadToBase64({
        review_packet: packet,
      }),
      callerId: packet.schema_version === 2 ? packet.operator?.id ?? null : null,
      description: "Check Review Packet landing readiness",
      method: "POST",
      path: "/v1/delivery-art/review-packets/readiness",
    };
    const { envelope, exitCode: brokerExitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    let exitCode = brokerExitCode;
    if (packet.schema_version === 2) {
      if (envelope.ok && envelope.body?.artifact) {
        writeCanonicalArtifactFile(packetPath, envelope.body.artifact);
      }
    } else if (envelope.body?.validation?.ready) {
      const sourceBinding = validateReviewPacketSourceBinding(packet, {
        execFileSyncImpl,
      });
      if (!sourceBinding.valid) {
        envelope.body.validation = {
          ...envelope.body.validation,
          errors: [
            ...(envelope.body.validation.errors || []),
            ...sourceBinding.errors,
          ],
          next_action: sourceBinding.next_action,
          ready: false,
          source_binding: sourceBinding,
          valid: false,
        };
        exitCode = 1;
      } else {
        envelope.body.validation.source_binding = sourceBinding;
      }
    }
    const output = shouldPrintFullJson(argv)
      ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
      : await attachCggPacketReference(
          compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
          { env, spawnImpl },
        );
    writeJson(stdout, output);
    return exitCode;
  }

  if (action === "prepare-finalization") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet prepare-finalization requires <packet.json>");
    }
    const packet = readCanonicalArtifactFile(packetPath);
    if (packet.schema_version !== 2) {
      throw new Error("review-packet prepare-finalization requires a schema-v2 packet");
    }
    const request = {
      bodyBase64: payloadToBase64({ review_packet: packet }),
      callerId: packet.operator?.id ?? null,
      description: "Prepare Review Packet finalization",
      method: "POST",
      path: "/v1/delivery-art/review-packets/prepare-finalization",
    };
    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    if (envelope.ok && envelope.body?.finalization_candidate) {
      writeCanonicalArtifactFile(packetPath, envelope.body.finalization_candidate);
    }
    const output = shouldPrintFullJson(argv)
      ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
      : await attachCggPacketReference(
          compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
          { env, spawnImpl },
        );
    writeJson(stdout, output);
    return exitCode;
  }

  if (action === "operating-readiness") {
    const packetPath = argv[2];
    const receiptPath = argv[3];
    if (!packetPath || !receiptPath) {
      throw new Error(
        "review-packet operating-readiness requires <packet.json> <receipt.json>",
      );
    }
    const packet = readCanonicalArtifactFile(packetPath);
    if (packet.schema_version !== 2) {
      throw new Error("review-packet operating-readiness requires a schema-v2 packet");
    }
    const request = {
      bodyBase64: payloadToBase64({ review_packet: packet }),
      callerId: packet.operator?.id ?? null,
      description: "Issue Review Packet operating readiness",
      method: "POST",
      path: "/v1/delivery-art/review-packets/operating-readiness",
    };
    const { envelope, exitCode: brokerExitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    if (envelope.ok && envelope.body?.finalization_candidate) {
      writeCanonicalArtifactFile(packetPath, envelope.body.finalization_candidate);
    }
    if (envelope.ok && envelope.body?.readiness_receipt) {
      writeCanonicalArtifactFile(receiptPath, envelope.body.readiness_receipt);
    }
    const output = shouldPrintFullJson(argv)
      ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
      : await attachCggPacketReference(
          compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
          { env, spawnImpl },
        );
    writeJson(stdout, output);
    return brokerExitCode || (
      envelope.body?.readiness_receipt?.readiness?.mutation_allowed === true
        ? 0
        : 1
    );
  }

  if (action === "finalize") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet finalize requires <packet.json>");
    }
    const parsedPacket = readArtifactFile(packetPath);
    const packet = parsedPacket.schema_version === 2
      ? readCanonicalArtifactFile(packetPath)
      : parsedPacket;
    const readinessReceiptPath = packet.schema_version === 2
      ? parseOptionValue(argv, "--readiness-receipt")
      : null;
    if (packet.schema_version === 2 && !readinessReceiptPath) {
      throw new Error(
        "review-packet finalize requires --readiness-receipt <receipt.json> for schema-v2 packets",
      );
    }
    const requestBody = {
      review_packet: packet,
      ...(readinessReceiptPath
        ? { readiness_receipt_ref: readinessReceiptReference(readinessReceiptPath) }
        : {}),
    };
    const request = {
      bodyBase64: payloadToBase64(requestBody),
      callerId: packet.schema_version === 2 ? packet.operator?.id ?? null : null,
      description: "Finalize review packet",
      method: "POST",
      path: "/v1/delivery-art/review-packets/finalize",
    };
    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request,
      spawnImpl,
      stderr,
    });
    const finalizedPacket = envelope.body?.artifact || envelope.body?.review_packet;
    if (envelope.ok && finalizedPacket) {
      if (packet.schema_version === 2) {
        writeCanonicalArtifactFile(packetPath, finalizedPacket);
      } else {
        writeArtifactFile(packetPath, finalizedPacket);
      }
    }
    const output = shouldPrintFullJson(argv)
      ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
      : await attachCggPacketReference(
          compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
          { env, spawnImpl },
        );
    writeJson(stdout, output);
    return exitCode;
  }

  throw new Error(`unsupported review-packet command: ${action}\n\n${USAGE}`);
}

function runScratchCommand({ argv, stdout }) {
  if (argv[0] !== "scratch") {
    return null;
  }

  const action = argv[1];
  if (action === "status") {
    writeJson(stdout, inspectScratchArtifacts());
    return 0;
  }

  if (action === "cleanup") {
    const archiveLegacy = argv.includes("--archive-legacy");
    const dryRun = argv.includes("--dry-run") || !archiveLegacy;
    writeJson(stdout, archiveLegacyScratchArtifacts({ dryRun }));
    return 0;
  }

  throw new Error(`unsupported scratch command: ${action}\n\n${USAGE}`);
}

async function runProjectionCommand({
  argv,
  env,
  spawnImpl,
  stdout,
  stderr,
}) {
  if (argv[0] !== "projection") {
    return null;
  }

  const action = argv[1];
  if (action === "status") {
    writeJson(stdout, projectionStatusOutput(env));
    return 0;
  }

  if (action === "clear") {
    const reason = argv.slice(2).join(" ").trim() || "operator cleared projection checkpoint";
    clearProjectionState(env);
    writeJson(stdout, {
      cleared: true,
      reason,
      state_file: projectionStateFile(env),
      workflow_id: "delivery-art-projection-clear",
    });
    return 0;
  }

  if (action === "sync") {
    const state = readProjectionState(env);
    const force = argv.includes("--force");
    const dryRun = argv.includes("--dry-run");
    const plan = projectionSyncPlan({ argv, env, state });

    if (!state.dirty && !force) {
      writeJson(stdout, {
        dirty: false,
        next_action: "No projection checkpoint is pending. Use --force to run sync anyway.",
        plan,
        state_file: projectionStateFile(env),
        workflow_id: "delivery-art-projection-sync",
      });
      return 0;
    }

    if (dryRun) {
      writeJson(stdout, {
        dirty: state.dirty,
        dry_run: true,
        plan,
        state,
        workflow_id: "delivery-art-projection-sync",
      });
      return 0;
    }

    if (plan.quality && !plan.target_epic_id) {
      writeJson(stdout, {
        plan,
        result: "quality_not_run",
        reason: "--quality requires --target-epic-id or a dirty delivery id.",
        workflow_id: "delivery-art-projection-sync",
      });
      return 1;
    }

    if (typeof spawnImpl !== "function") {
      throw new Error("spawnImpl is required for projection sync");
    }

    const syncProcess = await runProcess({
      args: [plan.sync_script],
      command: "bash",
      cwd: plan.platform_root,
      env: {
        ...env,
        OPENPROJECT_DEPLOYMENT: plan.deployment,
        OPENPROJECT_DELIVERY_PI_NAMES: plan.pi_names,
        OPENPROJECT_NAMESPACE: plan.namespace,
      },
      label: "projection-sync",
      spawnImpl,
    });
    const syncExitCode = syncProcess.exitCode;
    if (syncExitCode !== 0) {
      writeJson(stdout, {
        dirty: state.dirty,
        plan,
        result: "sync_failed",
        state_file: projectionStateFile(env),
        sync_output: syncProcess.output,
        sync_exit_code: syncExitCode,
        workflow_id: "delivery-art-projection-sync",
      });
      return syncExitCode;
    }

    clearProjectionState(env);

    let qualityExitCode = null;
    let qualityProcess = null;
    if (plan.quality) {
      qualityProcess = await runProcess({
        args: [
          "openproject-check-delivery-art-quality",
          `OPENPROJECT_NAMESPACE=${plan.namespace}`,
          `OPENPROJECT_DEPLOYMENT=${plan.deployment}`,
          `TARGET_EPIC_ID=${plan.target_epic_id}`,
          `BROKER_NAMESPACE=${env.ART_NAMESPACE || DEFAULT_ART_NAMESPACE}`,
          `BROKER_DEPLOYMENT=${env.ART_BROKER_DEPLOYMENT || DEFAULT_ART_BROKER_DEPLOYMENT}`,
        ],
        command: "make",
        cwd: plan.platform_root,
        env,
        label: "projection-sync-quality",
        spawnImpl,
      });
      qualityExitCode = qualityProcess.exitCode;
    }

    writeJson(stdout, {
      dirty: false,
      plan,
      quality_exit_code: qualityExitCode,
      ...(qualityProcess ? { quality_output: qualityProcess.output } : {}),
      result: qualityExitCode && qualityExitCode !== 0 ? "sync_passed_quality_failed" : "synced",
      state_file: projectionStateFile(env),
      sync_output: syncProcess.output,
      sync_exit_code: syncExitCode,
      workflow_id: "delivery-art-projection-sync",
    });
    return qualityExitCode && qualityExitCode !== 0 ? qualityExitCode : 0;
  }

  throw new Error(`unsupported projection command: ${action}\n\n${USAGE}`);
}

export async function runArtCliCommand({
  argv,
  env = process.env,
  execFileSyncImpl,
  spawnImpl,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (
    runArtScaffoldCommand({
      argv,
      execFileSyncImpl,
      stdout,
    })
  ) {
    return 0;
  }

  const scratchExitCode = runScratchCommand({ argv, stdout });
  if (scratchExitCode !== null) {
    return scratchExitCode;
  }

  const projectionExitCode = await runProjectionCommand({
    argv,
    env,
    spawnImpl,
    stderr,
    stdout,
  });
  if (projectionExitCode !== null) {
    return projectionExitCode;
  }

  if (typeof spawnImpl !== "function") {
    throw new Error("spawnImpl is required");
  }

  const draftExitCode = await runDraftCommand({
    argv,
    env,
    spawnImpl,
    stderr,
    stdout,
  });
  if (draftExitCode !== null) {
    return draftExitCode;
  }

  const wgcfExitCode = await runWgcfCommand({
    argv,
    env,
    spawnImpl,
    stderr,
    stdout,
  });
  if (wgcfExitCode !== null) {
    return wgcfExitCode;
  }

  const deliveryArtArtifactExitCode = await runDeliveryArtArtifactCommand({
    argv,
    env,
    spawnImpl,
    stderr,
    stdout,
  });
  if (deliveryArtArtifactExitCode !== null) {
    return deliveryArtArtifactExitCode;
  }

  const lifecycleExitCode = await runDeliveryArtLifecycleCommand({
    argv,
    env,
    execFileSyncImpl,
    spawnImpl,
    stderr,
    stdout,
  });
  if (lifecycleExitCode !== null) {
    return lifecycleExitCode;
  }

  const reviewPacketExitCode = await runReviewPacketCommand({
    argv,
    env,
    execFileSyncImpl,
    spawnImpl,
    stderr,
    stdout,
  });
  if (reviewPacketExitCode !== null) {
    return reviewPacketExitCode;
  }

  const landingUnitExitCode = await runLandingUnitCommand({
    argv,
    env,
    spawnImpl,
    stderr,
    stdout,
  });
  if (landingUnitExitCode !== null) {
    return landingUnitExitCode;
  }

  const request = buildArtCliRequest(argv);

  const requiredWgcfReadiness = await runRequiredWgcfReadiness({
    env,
    request,
    spawnImpl,
    stderr,
  });
  if (requiredWgcfReadiness && !requiredWgcfReadiness.allowed) {
    writeJson(stdout, requiredWgcfReadiness.response);
    return requiredWgcfReadiness.status;
  }

  const { envelope, exitCode } = await invokeBrokerRequest({
    env,
    request,
    spawnImpl,
    stderr,
  });

  const advisoryWgcfReadiness = envelope.ok
    ? await runAdvisoryWgcfReadiness({
        brokerContext: envelope.body,
        env,
        request,
        spawnImpl,
        stderr,
      })
    : null;

  const projectionState = envelope.ok
    ? markProjectionDirtyIfRequired({ body: envelope.body, env, request })
    : null;

  const brokerOutput = shouldPrintFullJson(argv)
    ? await protectFullJsonOutput(envelope.body, { env, request, spawnImpl })
    : await attachCggPacketReference(
        compactBrokerOutput(envelope.body, {
          env,
          request,
        }),
        { env, spawnImpl },
      );
  const output =
    requiredWgcfReadiness?.readiness || advisoryWgcfReadiness
      ? {
          ...asObjectOutput(brokerOutput),
          wgcf_art_readiness: compactWgcfReadiness(
            requiredWgcfReadiness?.readiness || advisoryWgcfReadiness,
          ),
        }
      : brokerOutput;
  writeJson(
    stdout,
    projectionState && !shouldPrintFullJson(argv)
      ? {
          ...asObjectOutput(output),
          projection_checkpoint: {
            dirty: true,
            dirty_event_count: projectionState.dirty_events.length,
            next_action:
              "Run `npm run art -- projection sync --pi-names <known-pis> --target-epic-id <epic-id> --quality` at the next projection checkpoint.",
            state_file: projectionStateFile(env),
          },
        }
      : output,
  );
  return exitCode;
}

export function artCliUsage() {
  return USAGE;
}
