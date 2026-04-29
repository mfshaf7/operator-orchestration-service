import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toDeliveryId, toWorkItemId } from "./delivery-model.js";
import { runArtScaffoldCommand } from "./art-scaffold.js";
import {
  archiveLegacyScratchArtifacts,
  createReviewPacketDraft,
  inspectScratchArtifacts,
  listMutationOperations,
  readArtifactFile,
  validateMutationDraft,
  writeArtifactFile,
} from "./art-workflow-artifacts.js";

export const DEFAULT_ART_NAMESPACE = "devint-accepted-idea-delivery-mfshaf7";
export const DEFAULT_ART_BROKER_DEPLOYMENT = "operator-orchestration-service";
export const DEFAULT_BROKER_BASE_URL = "http://127.0.0.1:8080";
export const DEFAULT_ART_OUTPUT_DIR = ".art/outputs";
export const DEFAULT_COMPACT_OUTPUT_THRESHOLD_BYTES = 2500;

const USAGE = `usage:
  npm run art -- bootstrap [--json]
  npm run art -- workflow-health [--json]
  npm run art -- assignees [--json]
  npm run art -- initiative review-pack <delivery-id> [--json]
  npm run art -- initiative execution-summary <delivery-id> [--json]
  npm run art -- initiative planning <delivery-id> [--json]
  npm run art -- initiative governance <delivery-id> <payload.json>
  npm run art -- initiative planning-repair <delivery-id> <payload.json>
  npm run art -- initiative closeout-readiness <delivery-id> [--json]
  npm run art -- initiative close <delivery-id> <payload.json>
  npm run art -- item continuation <work-item-id> [--json]
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
  npm run art -- review-packet draft <delivery-id> <output.json> <work-item-id...>
  npm run art -- review-packet validate <packet.json> [--json]
  npm run art -- review-packet finalize <packet.json> [--json]
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

function withOutputReference(summary, body, { env, request }) {
  const artifact = fullOutputArtifact(body, { env, request });
  return {
    ...summary,
    full_output_hint: "Use --json to print the full broker response.",
    ...(artifact ? { full_output: artifact } : {}),
  };
}

function compactReviewPacketOutput(body, { action, env, packet, packetPath, request }) {
  const outputPacket = body?.review_packet || packet || {};
  const landingUnit = outputPacket.landing_unit || {};
  const evidence = outputPacket.evidence || {};
  const repos = Array.isArray(landingUnit.repos) ? landingUnit.repos : [];
  const changedSurfaces = Array.isArray(evidence.changed_surfaces)
    ? evidence.changed_surfaces
    : [];
  const validations = Array.isArray(evidence.validations) ? evidence.validations : [];
  const testResults = Array.isArray(evidence.test_results) ? evidence.test_results : [];
  const validation = body?.validation || {};
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];

  return withOutputReference(
    {
      command: `review-packet ${action}`,
      covered_work_item_ids: outputPacket.covered_work_item_ids || [],
      delivery_id: outputPacket.delivery_id || null,
      landing_unit: {
        change_records: repos.flatMap((repo) =>
          Array.isArray(repo.change_records)
            ? repo.change_records.map((entry) => `${repo.repo_name}/${entry}`)
            : [],
        ),
        changed_surface_count: changedSurfaces.length,
        evidence_kind: landingUnit.evidence_kind || "unknown",
        merge_commit: landingUnit.merge_commit || null,
        pr_url: landingUnit.pr_url || null,
        repo_names: repos.map((repo) => repo.repo_name).filter(Boolean),
        test_result_count: testResults.length,
        validation_count: validations.length,
      },
      packet_id: outputPacket.packet_id || null,
      packet_path: packetPath,
      status: outputPacket.status || null,
      validation: {
        error_count: errors.length,
        errors,
        final: Boolean(validation.final),
        next_action: validation.next_action || null,
        packet_digest: validation.packet_digest || outputPacket.packet_digest || null,
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
const [method, path, bodyBase64, baseUrl, projectAssignablesOnly] = process.argv.slice(1);
const callerId = process.env.CALLER_ALLOWED_IDS.split(",")[0];
const callerSecret = process.env.CALLER_AUTH_SHARED_SECRET;
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
      `deploy/${deployment}`,
      "--",
      "node",
      "--input-type=module",
      "-e",
      podScript,
      request.method,
      request.path,
      request.bodyBase64 ?? "-",
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
          bodyBase64: buildPayloadBase64(args[3]),
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
      case "blocker":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
          description: `Record blocker state for ${workItemId}`,
          method: "POST",
          path: `/v1/delivery-work-items/${workItemId}/blocker`,
        };
      case "complete":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
          description: `Complete ${workItemId}`,
          method: "POST",
          path: `/v1/delivery-work-items/${workItemId}/complete`,
        };
      case "stale-open-close":
        return {
          bodyBase64: buildPayloadBase64(args[3]),
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

    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64(draft.payload),
        description: `Submit mutation draft ${draft.draft_id}`,
        method: draft.route.method,
        path: draft.route.path,
      },
      spawnImpl,
      stderr,
    });

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
    const coveredWorkItemIds = argv.slice(4);
    if (!deliveryId || !outputPath || coveredWorkItemIds.length === 0) {
      throw new Error(
        "review-packet draft requires <delivery-id> <output.json> <work-item-id...>",
      );
    }
    const packet = createReviewPacketDraft({
      coveredWorkItemIds,
      deliveryId,
      execFileSyncImpl,
      repoRoots: [process.cwd()],
    });
    writeArtifactFile(outputPath, packet);
    writeJson(stdout, {
      covered_work_item_ids: packet.covered_work_item_ids,
      generated_review_packet: outputPath,
      workflow_id: "delivery-art-review-packet-draft-local",
    });
    return 0;
  }

  if (action === "validate") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet validate requires <packet.json>");
    }
    const packet = readArtifactFile(packetPath);
    const { envelope } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64({
          review_packet: packet,
        }),
        description: "Validate review packet",
        method: "POST",
        path: "/v1/delivery-art/review-packets/validate",
      },
      spawnImpl,
      stderr,
    });
    const request = {
      description: "Validate review packet",
      path: "/v1/delivery-art/review-packets/validate",
    };
    writeJson(
      stdout,
      shouldPrintFullJson(argv)
        ? envelope.body
        : compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
    );
    return envelope.body?.validation?.valid ? 0 : 1;
  }

  if (action === "finalize") {
    const packetPath = argv[2];
    if (!packetPath) {
      throw new Error("review-packet finalize requires <packet.json>");
    }
    const packet = readArtifactFile(packetPath);
    const { envelope, exitCode } = await invokeBrokerRequest({
      env,
      request: {
        bodyBase64: payloadToBase64({
          review_packet: packet,
        }),
        description: "Finalize review packet",
        method: "POST",
        path: "/v1/delivery-art/review-packets/finalize",
      },
      spawnImpl,
      stderr,
    });
    const request = {
      description: "Finalize review packet",
      path: "/v1/delivery-art/review-packets/finalize",
    };
    if (envelope.ok && envelope.body.review_packet) {
      writeArtifactFile(packetPath, envelope.body.review_packet);
    }
    writeJson(
      stdout,
      shouldPrintFullJson(argv)
        ? envelope.body
        : compactReviewPacketOutput(envelope.body, {
            action,
            env,
            packet,
            packetPath,
            request,
          }),
    );
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

  const request = buildArtCliRequest(argv);
  const { envelope, exitCode } = await invokeBrokerRequest({
    env,
    request,
    spawnImpl,
    stderr,
  });

  writeJson(
    stdout,
    shouldPrintFullJson(argv)
      ? envelope.body
      : compactBrokerOutput(envelope.body, {
          env,
          request,
        }),
  );
  return exitCode;
}

export function artCliUsage() {
  return USAGE;
}
