import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/refinement",
);

const schemaFilenames = [
  "packet.schema.json",
  "assist-request.schema.json",
  "assist-result.schema.json",
  "apply-request.schema.json",
  "apply-receipt.schema.json",
  "run-projection.schema.json",
  "projection-result.schema.json",
  "error.schema.json",
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemas = new Map(
  schemaFilenames.map((filename) => [
    filename,
    JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8")),
  ]),
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

export function assertRefinementContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate) {
    throw new Error(`Unknown Refinement contract: ${filename}`);
  }
  if (!validate(value)) {
    throw new HttpError(
      400,
      "refinement_contract_invalid",
      `${label} does not satisfy the Refinement contract.`,
      validationDetails(validate),
    );
  }
  return value;
}

export function assertRefinementPacket(value) {
  const packet = assertRefinementContract(
    "packet.schema.json",
    value,
    "Refinement packet",
  );
  assertApplyPlanRoutes(packet.apply_plan);
  return packet;
}

export function assertRefinementAssistRequest(value) {
  return assertRefinementContract(
    "assist-request.schema.json",
    value,
    "Refinement assist request",
  );
}

export function assertRefinementAssistResult(value) {
  return assertRefinementContract(
    "assist-result.schema.json",
    value,
    "Refinement assist result",
  );
}

export function assertRefinementApplyRequest(value) {
  const request = assertRefinementContract(
    "apply-request.schema.json",
    value,
    "Refinement apply request",
  );
  if (request.acceptance.accepted_by !== request.operator.id) {
    throw new HttpError(
      400,
      "refinement_operator_acceptance_mismatch",
      "Refinement apply acceptance must be recorded by the requesting operator.",
    );
  }
  const valueKeys = Object.keys(request.accepted_draft.metadata_values).sort();
  const resolutionKeys = Object.keys(
    request.accepted_draft.metadata_resolutions,
  ).sort();
  if (JSON.stringify(valueKeys) !== JSON.stringify(resolutionKeys)) {
    throw new HttpError(
      400,
      "refinement_metadata_resolution_mismatch",
      "Every accepted Refinement metadata value must have exactly one resolution.",
    );
  }
  assertApplyPlanRoutes(request.accepted_draft.apply_plan);
  return request;
}

export function assertRefinementApplyReceipt(value) {
  return assertRefinementContract(
    "apply-receipt.schema.json",
    value,
    "Refinement apply receipt",
  );
}

export function assertRefinementRunProjection(value) {
  const projection = assertRefinementContract(
    "run-projection.schema.json",
    value,
    "Refinement run projection",
  );
  const sequences = projection.events.map((event) => event.sequence);
  if (
    new Set(sequences).size !== sequences.length ||
    sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1])
  ) {
    throw new HttpError(
      400,
      "refinement_event_sequence_invalid",
      "Refinement run events must have unique strictly increasing sequence values.",
    );
  }
  return projection;
}

export function assertRefinementProjectionResult(value) {
  return assertRefinementContract(
    "projection-result.schema.json",
    value,
    "Refinement projection result",
  );
}

export function assertRefinementError(value) {
  return assertRefinementContract(
    "error.schema.json",
    value,
    "Refinement error",
  );
}

function assertApplyPlanRoutes(applyPlan) {
  const expectedRoutes = new Set(applyPlan.expected_routes);
  const missing = applyPlan.operations
    .map((operation) => operation.oos_route)
    .filter((route) => !expectedRoutes.has(route));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "refinement_apply_plan_route_mismatch",
      "Every Refinement apply operation route must be declared by the packet apply plan.",
    );
  }
}
