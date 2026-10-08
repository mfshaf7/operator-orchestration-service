import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/model-profile-request/", import.meta.url);
const names = [
  "request.schema.json",
  "command.schema.json",
  "fulfillment.schema.json",
  "receipt.schema.json",
  "projection.schema.json",
];
const schemas = Object.fromEntries(
  names.map((name) => [name, JSON.parse(readFileSync(new URL(name, root), "utf8"))]),
);
export const modelProfileRequestManifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
for (const name of names) {
  const bytes = readFileSync(new URL(name, root));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (modelProfileRequestManifest.files?.[name] !== digest) {
    throw new Error(`Model-profile request contract bundle integrity failed: ${name}`);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const schema of Object.values(schemas)) ajv.addSchema(schema);
const validators = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, ajv.getSchema(schema.$id)]),
);

export function modelProfileRequestError(code, message, status = 409, details = null) {
  return new HttpError(status, `model_profile_request_${code}`, message, details);
}

function compareKeys(a, b) {
  return Buffer.from(a).compare(Buffer.from(b));
}

export function modelProfileCanonicalJson(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) {
      throw modelProfileRequestError("invalid_json", "Model-profile JSON contains invalid Unicode.", 400);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(modelProfileCanonicalJson).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) =>
      `${modelProfileCanonicalJson(key)}:${modelProfileCanonicalJson(value[key])}`).join(",")}}`;
  }
  throw modelProfileRequestError(
    "invalid_json",
    "Model-profile JSON requires lossless integral values and plain objects.",
    400,
  );
}

export function modelProfileDigest(value, omittedField = null) {
  const projection = structuredClone(value);
  if (omittedField) delete projection[omittedField];
  return `sha256:${createHash("sha256").update(modelProfileCanonicalJson(projection)).digest("hex")}`;
}

export function assertModelProfileContract(name, value) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown model-profile contract: ${name}`);
  if (!validate(value)) {
    throw modelProfileRequestError(
      "contract_invalid",
      `Invalid model-profile ${name.replace(".schema.json", "")} contract.`,
      400,
      validate.errors,
    );
  }
  return value;
}

export function createModelProfileReceipt({
  actor,
  deliveryRef,
  fulfillmentState,
  intent,
  priorReceipt,
  profileId,
  recordedAt,
  requestId,
  requestRevision,
  reviewState,
  sourceRef,
}) {
  const base = {
    schema_version: 1,
    receipt_id: "model-profile-receipt:000000000000000000000000",
    request_id: requestId,
    request_revision: requestRevision,
    intent,
    review_state: reviewState,
    fulfillment_state: fulfillmentState,
    profile_id: profileId,
    actor: structuredClone(actor),
    routed_owners: {
      workflow_owner: "operator-orchestration-service",
      fulfillment_owner: "platform-engineering",
      security_owner: "security-architecture",
    },
    delivery_ref: deliveryRef,
    source_ref: sourceRef,
    prior_receipt_ref: priorReceipt
      ? {
          uri: `oos://model-profile-receipts/${priorReceipt.receipt_id}`,
          digest: priorReceipt.digest,
        }
      : null,
    recorded_at: recordedAt,
    digest: "sha256:" + "0".repeat(64),
  };
  const identityDigest = modelProfileDigest({ ...base, receipt_id: null, digest: null });
  const receipt = {
    ...base,
    receipt_id: `model-profile-receipt:${identityDigest.slice(7, 31)}`,
  };
  receipt.digest = modelProfileDigest(receipt, "digest");
  return assertModelProfileContract("receipt.schema.json", receipt);
}
