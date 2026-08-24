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

const validators = new Map(
  ["application-envelope.schema.json", "target-application-result.schema.json"]
    .map((filename) => {
      const schema = readSchema(filename);
      return [filename, ajv.compile(schema)];
    }),
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
