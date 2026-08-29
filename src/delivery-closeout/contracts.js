import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/delivery-closeout",
);
const schemaFilenames = [
  "command.schema.json",
  "event.schema.json",
  "projection.schema.json",
  "result.schema.json",
  "error.schema.json",
];
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemas = new Map(schemaFilenames.map((filename) => [
  filename,
  JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8")),
]));
for (const schema of schemas.values()) ajv.addSchema(schema);
const validators = new Map([...schemas].map(([filename, schema]) => [
  filename,
  ajv.getSchema(schema.$id),
]));

function details(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

function assertContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate(value)) {
    throw new HttpError(
      400,
      "delivery_closeout_contract_invalid",
      `${label} does not satisfy the Delivery closeout contract.`,
      details(validate),
    );
  }
  return value;
}

function assertImpact(command) {
  const impact = command.operation.payload.impact;
  if (
    impact.kind === "workspace_entrant" &&
    impact.candidate.correlation_ref !== command.command_id
  ) {
    throw new HttpError(
      400,
      "delivery_closeout_entrant_correlation_mismatch",
      "Workspace entrant impact must be correlated to the accepted closeout command.",
    );
  }
  if (
    impact.kind === "existing_product_change" &&
    impact.active_product.registry_ref !==
      `workspace-governance://products/${impact.active_product.product_id}`
  ) {
    throw new HttpError(
      400,
      "delivery_closeout_product_identity_mismatch",
      "Existing-product impact must reference its canonical active product identity.",
    );
  }
}

export function assertDeliveryCloseoutCommand(value) {
  const command = assertContract(
    "command.schema.json",
    value,
    "Delivery closeout command",
  );
  if (command.operator.id !== command.acceptance.accepted_by) {
    throw new HttpError(
      400,
      "delivery_closeout_operator_acceptance_mismatch",
      "Delivery closeout acceptance must be recorded by the accountable operator.",
    );
  }
  assertImpact(command);
  return command;
}

export function assertDeliveryCloseoutEvent(value) {
  return assertContract("event.schema.json", value, "Delivery closeout event");
}

export function assertDeliveryCloseoutProjection(value) {
  return assertContract(
    "projection.schema.json",
    value,
    "Delivery closeout projection",
  );
}

export function assertDeliveryCloseoutResult(value) {
  return assertContract("result.schema.json", value, "Delivery closeout result");
}

export function assertDeliveryCloseoutError(value) {
  return assertContract("error.schema.json", value, "Delivery closeout error");
}
