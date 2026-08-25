import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/work-design",
);

const schemaFilenames = [
  "apply-request.schema.json",
  "apply-result.schema.json",
  "assist-request.schema.json",
  "assist-result.schema.json",
  "error.schema.json",
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map(
  schemaFilenames.map((filename) => {
    const schema = JSON.parse(
      readFileSync(path.join(contractRoot, filename), "utf8"),
    );
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

export function assertWorkDesignContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate) {
    throw new Error(`Unknown Work Design contract: ${filename}`);
  }
  if (!validate(value)) {
    throw new HttpError(
      400,
      "work_design_contract_invalid",
      `${label} does not satisfy the Work Design contract.`,
      validationDetails(validate),
    );
  }
  return value;
}

export function assertWorkDesignAssistRequest(value) {
  return assertWorkDesignContract(
    "assist-request.schema.json",
    value,
    "Work Design assist request",
  );
}

export function assertWorkDesignAssistResult(value) {
  return assertWorkDesignContract(
    "assist-result.schema.json",
    value,
    "Work Design assist result",
  );
}

export function assertWorkDesignApplyRequest(value) {
  const request = assertWorkDesignContract(
    "apply-request.schema.json",
    value,
    "Work Design apply request",
  );
  if (request.acceptance.accepted_by !== request.operator.id) {
    throw new HttpError(
      400,
      "work_design_operator_acceptance_mismatch",
      "Work Design apply acceptance must be recorded by the requesting operator.",
    );
  }
  return request;
}

export function assertWorkDesignApplyResult(value) {
  return assertWorkDesignContract(
    "apply-result.schema.json",
    value,
    "Work Design apply result",
  );
}

export function assertWorkDesignError(value) {
  return assertWorkDesignContract(
    "error.schema.json",
    value,
    "Work Design error",
  );
}
