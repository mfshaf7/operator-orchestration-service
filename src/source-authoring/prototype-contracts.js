import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { assertSourceCredentialTimestamp } from "../platform-operation/source-credentials.js";
import { normalizePrototypeOwnerPreparation } from "./prototype-owner-preparation.js";

export const PROTOTYPE_ID = /^prototype:[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROTOTYPE_SOURCE_REQUEST_ID = /^prototype-source-request:[A-Za-z0-9][A-Za-z0-9._:-]{0,230}$/;
const REVISION = /^[0-9a-f]{40}$/;
const REQUEST_FIELDS = ["schema_version", "request_id", "prototype_id", "expected_registry_revision", "expected_source_revision", "objective", "requested_at"];

export function prototypeAuthoringError(code, message, status = 409, details = null) {
  return new HttpError(status, `prototype_source_authoring_${code}`, message, details);
}

export function normalizePrototypeSourceRequest(input) {
  const ownerPreparation = input && Object.hasOwn(input, "owner_preparation");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== REQUEST_FIELDS.length + (ownerPreparation ? 1 : 0) ||
      REQUEST_FIELDS.some(field => !Object.hasOwn(input, field)) || input.schema_version !== 1 ||
      typeof input.request_id !== "string" || !PROTOTYPE_SOURCE_REQUEST_ID.test(input.request_id) || input.request_id.length > 256 ||
      typeof input.prototype_id !== "string" || !PROTOTYPE_ID.test(input.prototype_id) || input.prototype_id.length > 256 ||
      typeof input.expected_registry_revision !== "string" || !REVISION.test(input.expected_registry_revision) ||
      typeof input.expected_source_revision !== "string" || !REVISION.test(input.expected_source_revision) ||
      typeof input.objective !== "string" || input.objective.trim().length < 8 || Buffer.byteLength(input.objective, "utf8") > 16_384) {
    throw prototypeAuthoringError("request_invalid", "A bounded Prototype objective requires its actual identity, stable request id and exact registry/source revisions; browser-selected source coordinates are not admitted.", 400);
  }
  try { assertSourceCredentialTimestamp(input.requested_at, "requested_at"); }
  catch { throw prototypeAuthoringError("request_invalid", "Prototype request time must be a valid timezone-qualified timestamp.", 400); }
  if (ownerPreparation) normalizePrototypeOwnerPreparation(input.owner_preparation);
  return structuredClone(input);
}

export function prototypeRequestDigest({ callerId, operatorId, request }) {
  return canonicalDigest({ caller_id: callerId, operator_id: operatorId, request: normalizePrototypeSourceRequest(request) });
}
