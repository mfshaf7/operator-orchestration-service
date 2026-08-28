import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/delivery-change",
);
const schemaFilenames = [
  "projection.schema.json",
  "command.schema.json",
  "event.schema.json",
  "result.schema.json",
  "error.schema.json",
];
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schemas = new Map(schemaFilenames.map((filename) => [
  filename,
  JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8")),
]));
for (const filename of [
  "repository-readiness-reference.schema.json",
  "mutation-request.schema.json",
]) {
  ajv.addSchema(JSON.parse(readFileSync(path.resolve(
    contractRoot,
    "../catalog",
    filename,
  ), "utf8")));
}
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
      "delivery_change_contract_invalid",
      `${label} does not satisfy the Delivery change contract.`,
      details(validate),
    );
  }
  return value;
}

function assertPayload(operation) {
  const payload = operation.payload;
  if (
    operation.type === "link_repository" &&
    (
      payload.catalog_item_id !== payload.catalog_request?.catalog_item_id ||
      payload.catalog_request?.draft?.value_key !== payload.owner_repo ||
      payload.catalog_request?.draft?.repository_binding?.catalog_value_key !==
        payload.owner_repo
    )
  ) {
    throw new HttpError(
      400,
      "delivery_change_repository_identity_mismatch",
      "Delivery owner repository must match the accepted Catalog repository identity.",
    );
  }
}

export function assertDeliveryChangeCommand(value) {
  const command = assertContract("command.schema.json", value, "Delivery change command");
  if (command.operator.id !== command.acceptance.accepted_by) {
    throw new HttpError(
      400,
      "delivery_change_operator_acceptance_mismatch",
      "Delivery change acceptance must be recorded by the accountable operator.",
    );
  }
  assertPayload(command.operation);
  return command;
}

export function assertDeliveryChangeProjection(value) {
  return assertContract("projection.schema.json", value, "Delivery change projection");
}

export function assertDeliveryChangeEvent(value) {
  return assertContract("event.schema.json", value, "Delivery change event");
}

export function assertDeliveryChangeResult(value) {
  return assertContract("result.schema.json", value, "Delivery change result");
}

export function assertDeliveryChangeError(value) {
  return assertContract("error.schema.json", value, "Delivery change error");
}
