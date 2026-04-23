import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  loadOpenApiSpec,
  pickExample,
  resolveOperation,
  schemaName,
  validateValueAgainstSchema,
} from "./api_contract_tools.mjs";

const DEFAULT_NAMESPACE =
  process.env.OOS_PROBE_NAMESPACE ?? "devint-accepted-idea-delivery-mfshaf7";

function usage() {
  console.error(
    "usage: node scripts/probe_api_contract.mjs <METHOD> <PATH> [--namespace <ns>] [--pod <name>] [--body-file <json>] [--show-body]\n" +
      "example: node scripts/probe_api_contract.mjs GET /v1/delivery-work-items/work-item-188/continuation-context",
  );
  process.exit(1);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length < 2) {
    usage();
  }

  const options = {
    bodyFile: null,
    namespace: DEFAULT_NAMESPACE,
    pod: null,
    showBody: false,
  };

  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    switch (token) {
      case "--namespace":
        options.namespace = argv[index + 1];
        index += 1;
        break;
      case "--pod":
        options.pod = argv[index + 1];
        index += 1;
        break;
      case "--body-file":
        options.bodyFile = argv[index + 1];
        index += 1;
        break;
      case "--show-body":
        options.showBody = true;
        break;
      default:
        fail(`unknown option: ${token}`);
    }
  }

  if (positionals.length < 2) {
    usage();
  }

  const method = positionals[0].trim().toUpperCase();
  const routePath = positionals.slice(1).join(" ").trim();
  if (!method || !routePath.startsWith("/")) {
    usage();
  }

  return {
    method,
    options,
    routePath,
  };
}

function runKubectl(args) {
  return execFileSync("k3s", ["kubectl", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function findBrokerPod(namespace) {
  const raw = runKubectl(["-n", namespace, "get", "pods", "-o", "json"]);
  const data = JSON.parse(raw);
  const items = Array.isArray(data.items) ? data.items : [];
  const candidate = items.find((item) => {
    const name = item.metadata?.name ?? "";
    const phase = item.status?.phase;
    return name.startsWith("operator-orchestration-service-") && phase === "Running";
  });

  if (!candidate?.metadata?.name) {
    fail(`no running operator-orchestration-service pod found in namespace ${namespace}`);
  }

  return candidate.metadata.name;
}

function loadRequestBody(bodyFile) {
  if (!bodyFile) {
    return null;
  }

  return JSON.parse(readFileSync(bodyFile, "utf8"));
}

function pretty(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function printSection(title, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  console.log(`\n${title}`);
  console.log(pretty(value));
}

function probeFromPod({ body, method, namespace, operation, pod, routePath }) {
  const inlineScript = `
const preferredCaller = ${JSON.stringify(operation["x-oos-primary-caller"] ?? null)};
const allowed = (process.env.CALLER_ALLOWED_IDS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const caller = preferredCaller && allowed.includes(preferredCaller)
  ? preferredCaller
  : allowed[0];
if (!caller) {
  console.error("No allowed caller id available in pod environment.");
  process.exit(1);
}
const secret = process.env.CALLER_AUTH_SHARED_SECRET;
if (!secret) {
  console.error("CALLER_AUTH_SHARED_SECRET is missing in pod environment.");
  process.exit(1);
}
const requestInit = {
  method: ${JSON.stringify(method)},
  headers: {
    "x-oos-caller-id": caller,
    "x-oos-caller-secret": secret
  }
};
const requestBody = ${JSON.stringify(body)};
if (requestBody !== null) {
  requestInit.headers["content-type"] = "application/json";
  requestInit.body = JSON.stringify(requestBody);
}
fetch("http://127.0.0.1:8080${routePath}", requestInit)
  .then(async (res) => {
    const text = await res.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (error) {
      parsed = text;
    }
    console.log(JSON.stringify({ caller, status: res.status, body: parsed }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

  const raw = runKubectl([
    "-n",
    namespace,
    "exec",
    pod,
    "--",
    "node",
    "-e",
    inlineScript,
  ]);

  return JSON.parse(raw);
}

const { method, options, routePath } = parseArgs(process.argv.slice(2));
const spec = loadOpenApiSpec();
const resolved = resolveOperation(spec, method, routePath);
if (!resolved) {
  fail(`route ${method} ${routePath} is not documented in docs/api/openapi.json`);
}

const { normalizedPath, operation } = resolved;
const requestBody = loadRequestBody(options.bodyFile);

if (requestBody !== null) {
  const requestMediaType = operation.requestBody?.content?.["application/json"];
  if (!requestMediaType) {
    fail(`${method} ${normalizedPath} does not document an application/json request body`);
  }

  const requestErrors = validateValueAgainstSchema(
    spec,
    requestMediaType.schema,
    requestBody,
    "$request",
  );
  if (requestErrors.length > 0) {
    fail(`request body does not match the documented contract:\n- ${requestErrors.join("\n- ")}`);
  }
}

const pod = options.pod ?? findBrokerPod(options.namespace);
const probe = probeFromPod({
  body: requestBody,
  method,
  namespace: options.namespace,
  operation,
  pod,
  routePath,
});

const response = operation.responses?.[String(probe.status)];
if (!response) {
  fail(`response status ${probe.status} is not documented for ${method} ${normalizedPath}`);
}

const responseMediaType = response.content?.["application/json"];
if (!responseMediaType) {
  fail(`response status ${probe.status} for ${method} ${normalizedPath} does not document application/json`);
}

const responseErrors = validateValueAgainstSchema(
  spec,
  responseMediaType.schema,
  probe.body,
  "$response",
);

console.log(`${method} ${normalizedPath}`);
if (normalizedPath !== routePath) {
  console.log(`matched_from: ${routePath}`);
}
printSection("Surface", operation["x-oos-surface"] ?? null);
printSection("Primary Caller", operation["x-oos-primary-caller"] ?? null);
printSection("Owner", operation["x-oos-owner"] ?? null);
printSection("Workflow Family", operation["x-oos-workflow-family"] ?? null);
printSection("Probe Namespace", options.namespace);
printSection("Probe Pod", pod);
printSection("Caller Used", probe.caller);
printSection("Expected Response Schema", schemaName(responseMediaType.schema));
printSection("Documented Response Example", pickExample(spec, responseMediaType));

if (responseErrors.length > 0) {
  printSection("Contract Result", "FAIL");
  printSection("Validation Errors", responseErrors);
  printSection("Live Response Body", probe.body);
  process.exit(1);
}

printSection("Contract Result", "PASS");
if (options.showBody) {
  printSection("Live Response Body", probe.body);
}
