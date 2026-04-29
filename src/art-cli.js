import { copyFileSync } from "node:fs";
import { readFileSync } from "node:fs";
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

const USAGE = `usage:
  npm run art -- bootstrap
  npm run art -- workflow-health
  npm run art -- assignees
  npm run art -- initiative review-pack <delivery-id>
  npm run art -- initiative execution-summary <delivery-id>
  npm run art -- initiative planning <delivery-id>
  npm run art -- initiative governance <delivery-id> <payload.json>
  npm run art -- initiative planning-repair <delivery-id> <payload.json>
  npm run art -- initiative closeout-readiness <delivery-id>
  npm run art -- initiative close <delivery-id> <payload.json>
  npm run art -- item continuation <work-item-id>
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
  npm run art -- review-packet validate <packet.json>
  npm run art -- review-packet finalize <packet.json>
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
    writeJson(stdout, envelope.body);
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
    if (envelope.ok && envelope.body.review_packet) {
      writeArtifactFile(packetPath, envelope.body.review_packet);
    }
    writeJson(stdout, envelope.body);
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

  writeJson(stdout, envelope.body);
  return exitCode;
}

export function artCliUsage() {
  return USAGE;
}
