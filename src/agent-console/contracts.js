import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/agent-console/", import.meta.url);
const names = [
  "cgg-projection-request.schema.json",
  "cgg-projection-result.schema.json",
  "model-response.schema.json",
  "session-request.schema.json",
  "invocation-request.schema.json",
  "session-projection.schema.json",
];

export const agentConsoleManifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
const schemas = Object.fromEntries(names.map((name) => [
  name,
  JSON.parse(readFileSync(new URL(name, root), "utf8")),
]));

for (const name of names) {
  const digest = createHash("sha256")
    .update(readFileSync(new URL(name, root)))
    .digest("hex");
  if (agentConsoleManifest.files?.[name] !== digest) {
    throw new Error(`Agent Console contract bundle integrity failed: ${name}`);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const schema of Object.values(schemas)) ajv.addSchema(schema);
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.getSchema(schema.$id)]),
);

export function agentConsoleError(code, message, statusCode = 409, details = null) {
  return new HttpError(statusCode, `agent_console_${code}`, message, details);
}

export function assertAgentConsoleContract(name, value) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown Agent Console contract: ${name}`);
  if (!validate(value)) {
    throw agentConsoleError(
      "contract_invalid",
      `Invalid Agent Console ${name.replace(".schema.json", "")} contract.`,
      400,
      validate.errors,
    );
  }
  return value;
}

export function agentConsoleDigest(value) {
  return canonicalDigest(value);
}

export function agentConsoleReceiptRef({ digest, receiptId }) {
  return {
    uri: `oos://agent-console/receipts/${encodeURIComponent(receiptId)}`,
    digest,
  };
}
