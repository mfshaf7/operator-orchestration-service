import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/proposal-workflow",
);

function readSchema(filename) {
  return JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemaFilenames = [
  "command.schema.json",
  "command-result.schema.json",
  "event.schema.json",
  "handoff-application.schema.json",
  "handoff-application-result.schema.json",
  "history.schema.json",
  "projection.schema.json",
  "storage-state.schema.json",
];
const schemas = new Map(
  schemaFilenames.map((filename) => [filename, readSchema(filename)]),
);
for (const schema of schemas.values()) {
  ajv.addSchema(schema);
}
const validators = new Map(
  [...schemas].map(([filename, schema]) => [filename, ajv.getSchema(schema.$id)]),
);

function validationDetails(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

export function assertProposalContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate) {
    throw new Error(`Unknown Proposal contract: ${filename}`);
  }
  if (!validate(value)) {
    throw new HttpError(
      400,
      "proposal_contract_invalid",
      `${label} does not satisfy the Proposal workflow contract.`,
      validationDetails(validate),
    );
  }
  return value;
}

export function assertProposalCommand(value) {
  return assertProposalContract(
    "command.schema.json",
    value,
    "Proposal command",
  );
}

export function assertProposalCommandResult(value) {
  return assertProposalContract(
    "command-result.schema.json",
    value,
    "Proposal command result",
  );
}

export function assertProposalEvent(value) {
  return assertProposalContract(
    "event.schema.json",
    value,
    "Proposal event",
  );
}

export function assertProposalHandoffApplication(value) {
  return assertProposalContract(
    "handoff-application.schema.json",
    value,
    "Proposal handoff application",
  );
}

export function assertProposalHandoffApplicationResult(value) {
  return assertProposalContract(
    "handoff-application-result.schema.json",
    value,
    "Proposal handoff application result",
  );
}

export function assertProposalHistory(value) {
  return assertProposalContract(
    "history.schema.json",
    value,
    "Proposal history",
  );
}

export function assertProposalProjection(value) {
  return assertProposalContract(
    "projection.schema.json",
    value,
    "Proposal projection",
  );
}

export function assertProposalStorageState(value) {
  return assertProposalContract(
    "storage-state.schema.json",
    value,
    "Proposal workflow state",
  );
}
