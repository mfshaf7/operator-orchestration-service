import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/delivery-ingress",
);

function readSchema(filename) {
  return JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaFiles = [
  "prototype-delivery-packet.schema.json",
  "prototype-ingress-readiness-receipt.schema.json",
  "application-envelope.schema.json",
  "prototype-application-request.schema.json",
  "prototype-application-result.schema.json",
  "prototype-application-event.schema.json",
  "target-application-result.schema.json",
];
const schemas = new Map(
  schemaFiles.map((filename) => [filename, readSchema(filename)]),
);
for (const schema of schemas.values()) {
  ajv.addSchema(schema);
}
const validators = new Map(
  [...schemas.entries()].map(([filename, schema]) => [
    filename,
    ajv.getSchema(schema.$id),
  ]),
);

function validationDetails(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

export function assertDeliveryIngressContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate) {
    throw new Error(`Unknown Delivery ingress contract: ${filename}`);
  }
  if (!validate(value)) {
    throw new HttpError(
      400,
      "delivery_ingress_contract_invalid",
      `${label} does not satisfy the Delivery ingress contract.`,
      validationDetails(validate),
    );
  }
  return value;
}

export function assertDeliveryIngressApplicationEnvelope(value) {
  return assertDeliveryIngressContract(
    "application-envelope.schema.json",
    value,
    "Delivery ingress application envelope",
  );
}

export function assertDeliveryIngressTargetApplicationResult(value) {
  return assertDeliveryIngressContract(
    "target-application-result.schema.json",
    value,
    "Delivery ingress target application result",
  );
}

export function assertPrototypeDeliveryApplicationRequest(value) {
  return assertDeliveryIngressContract(
    "prototype-application-request.schema.json",
    value,
    "Prototype Delivery application request",
  );
}

export function assertPrototypeDeliveryApplicationResult(value) {
  return assertDeliveryIngressContract(
    "prototype-application-result.schema.json",
    value,
    "Prototype Delivery application result",
  );
}

export function assertPrototypeDeliveryApplicationEvent(value) {
  return assertDeliveryIngressContract(
    "prototype-application-event.schema.json",
    value,
    "Prototype Delivery application event",
  );
}

export function assertPrototypeIngressReadinessReceipt(value) {
  return assertDeliveryIngressContract(
    "prototype-ingress-readiness-receipt.schema.json",
    value,
    "Prototype ingress readiness receipt",
  );
}
