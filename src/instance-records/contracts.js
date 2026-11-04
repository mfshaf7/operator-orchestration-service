import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";
import { assertIntake, intakeDigest } from "../workspace-intake/contracts.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../contracts/instance-records/intake-request.schema.json", import.meta.url), "utf8")));

export function assertInstanceIntakeRequest(request, instanceId) {
  if (!validate(request) || request.instance_id !== instanceId || request.request_digest !== intakeDigest(request, "request_digest")) {
    throw new HttpError(400, "instance_records_request_invalid", "The registration does not bind its installation, current state and reviewed content.");
  }
  return request;
}

export function assertInstanceIntakeDecision(request, decision, operatorId) {
  assertIntake("decision", decision);
  if (decision.operator_acceptance.operator_ref !== operatorId || request.requester_ref !== operatorId ||
      decision.operator_acceptance.state !== "accepted" || decision.outcome.status !== "allowed" ||
      decision.request_ref.id !== request.request_id || decision.request_ref.digest !== request.request_digest ||
      intakeDigest(decision.target) !== intakeDigest(request.target) ||
      decision.outcome.classification !== request.requested_classification || decision.outcome.owner_route !== request.owner_route ||
      intakeDigest(decision.outcome.approved_record) !== intakeDigest(request.requested_record)) {
    throw new HttpError(409, "instance_records_decision_mismatch", "Accept the exact registration shown for this operator and repository.");
  }
  return decision;
}

const validateInventory = ajv.compile(JSON.parse(readFileSync(new URL("../../contracts/instance-records/inventory-request.schema.json", import.meta.url), "utf8")));
export function assertInstanceInventoryRequest(request, instanceId, operatorId) {
  if (!validateInventory(request) || request.instance_id !== instanceId || request.request_digest !== intakeDigest(request, "request_digest") ||
      request.operator_ref !== operatorId || request.operator_acceptance.operator_ref !== operatorId) {
    throw new HttpError(400, "instance_records_inventory_invalid", "The inventory decision must bind its installation, current record and accountable operator.");
  }
  return request;
}
