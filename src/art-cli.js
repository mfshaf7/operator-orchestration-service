import { readFileSync } from "node:fs";
import { toDeliveryId, toWorkItemId } from "./delivery-model.js";
import { runArtScaffoldCommand } from "./art-scaffold.js";

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
  npm run art -- initiative planning-repair <delivery-id> <payload.json>
  npm run art -- initiative closeout-readiness <delivery-id>
  npm run art -- initiative close <delivery-id> <payload.json>
  npm run art -- item continuation <work-item-id>
  npm run art -- item blocker <work-item-id> <payload.json>
  npm run art -- item complete <work-item-id> <payload.json>
  npm run art -- item stale-open-close <work-item-id> <payload.json>
  npm run art -- scaffold item-complete <work-item-id> <output.json> [repo-root...]
  npm run art -- scaffold initiative-close <delivery-id> <output.json> [repo-root...]
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

  if (typeof spawnImpl !== "function") {
    throw new Error("spawnImpl is required");
  }

  const request = buildArtCliRequest(argv);
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

  stdout.write(`${JSON.stringify(envelope.body, null, 2)}\n`);
  return exitCode ?? 1;
}

export function artCliUsage() {
  return USAGE;
}
