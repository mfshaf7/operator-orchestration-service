import {
  loadOpenApiSpec,
  pickExample,
  resolveRefObject,
  resolveOperation,
  schemaName,
} from "./api_contract_tools.mjs";

function usage() {
  console.error(
    "usage: node scripts/show_api_contract.mjs <METHOD> <PATH>\n" +
      "example: node scripts/show_api_contract.mjs GET /v1/delivery-work-items/work-item-188/continuation-context",
  );
  process.exit(1);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function pretty(value) {
  if (value === undefined) {
    return null;
  }

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

const args = process.argv.slice(2);
if (args.length < 2) {
  usage();
}

const method = args[0].trim().toUpperCase();
const pathInput = args.slice(1).join(" ").trim();
if (!method || !pathInput.startsWith("/")) {
  usage();
}

let spec;
try {
  spec = loadOpenApiSpec();
} catch (error) {
  fail(`could not read OpenAPI spec: ${error.message}`);
}

const resolved = resolveOperation(spec, method, pathInput);
if (!resolved) {
  fail(`route ${method} ${pathInput} is not documented in docs/api/openapi.json`);
}

const { normalizedPath, operation } = resolved;
const requestJson = operation.requestBody?.content?.["application/json"] ?? null;
const okResponse = resolveRefObject(spec, operation.responses?.["200"]);
const responseJson = okResponse?.content?.["application/json"] ?? null;

console.log(`${method} ${normalizedPath}`);
if (normalizedPath !== pathInput) {
  console.log(`matched_from: ${pathInput}`);
}

printSection("Title", operation.summary ?? null);
printSection("Tags", operation.tags?.join(", ") ?? null);
printSection("Description", operation.description ?? null);
printSection("Surface", operation["x-oos-surface"] ?? null);
printSection("Primary Caller", operation["x-oos-primary-caller"] ?? null);
printSection("Owner", operation["x-oos-owner"] ?? null);
printSection("Workflow Family", operation["x-oos-workflow-family"] ?? null);
printSection(
  "Security",
  Array.isArray(operation.security) && operation.security.length > 0
    ? "caller auth required"
    : "none",
);

if (requestJson) {
  printSection("Request Schema", schemaName(requestJson.schema));
  printSection("Request Body Description", operation.requestBody?.description ?? null);
  printSection("Request Example", pickExample(spec, requestJson));
}

if (responseJson) {
  printSection("Response Schema", schemaName(responseJson.schema));
  printSection("Response Example", pickExample(spec, responseJson));
}
