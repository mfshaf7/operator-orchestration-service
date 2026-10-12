import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/product-publication/", import.meta.url);
export const productPublicationManifest = JSON.parse(
  readFileSync(new URL("manifest.json", root), "utf8"),
);
const schemaNames = [
  "command.schema.json",
  "evaluation.schema.json",
  "readiness.schema.json",
  "packet.schema.json",
  "receipt.schema.json",
];
const schemas = new Map();

for (const name of schemaNames) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== productPublicationManifest.files[name]?.sha256) {
    throw new Error(`Product Publication contract bundle integrity failed: ${name}`);
  }
  schemas.set(name, JSON.parse(bytes));
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map(
  [...schemas].map(([name, schema]) => [name, ajv.compile(schema)]),
);

export function productPublicationError(code, message, status = 409, details = null) {
  return new HttpError(status, `product_publication_${code}`, message, details);
}

function compareKeys(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function productPublicationStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) {
      throw productPublicationError("invalid_json", "Product Publication JSON contains invalid Unicode.", 400);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(productPublicationStringify).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) =>
      `${productPublicationStringify(key)}:${productPublicationStringify(value[key])}`).join(",")}}`;
  }
  throw productPublicationError(
    "invalid_json",
    "Product Publication JSON requires lossless integral values and plain objects.",
    400,
  );
}

export function productPublicationDigest(value, omittedField = null) {
  const projection = structuredClone(value);
  if (omittedField) delete projection[omittedField];
  return `sha256:${createHash("sha256").update(productPublicationStringify(projection)).digest("hex")}`;
}

export function assertProductPublicationContract(name, value) {
  const validate = validators.get(name);
  if (!validate) throw new Error(`Unknown Product Publication contract: ${name}`);
  if (!validate(value)) {
    throw productPublicationError(
      "contract_invalid",
      `Invalid Product Publication ${name.replace(".schema.json", "")} contract.`,
      400,
      validate.errors,
    );
  }
  return value;
}

export function createProductPublicationEvaluation(command) {
  const accepted = assertProductPublicationContract("command.schema.json", structuredClone(command));
  const request = {
    request_id: accepted.request_id,
    idempotency_key: accepted.idempotency_key,
    action: accepted.action,
    expected_publication_version: accepted.expected_publication_version,
    current_publication_posture: accepted.current_publication_posture,
    target_publication: structuredClone(accepted.target_publication),
    previous_receipt: structuredClone(accepted.previous_receipt),
    requested_at: accepted.requested_at,
  };
  request.request_digest = productPublicationDigest(request, "request_digest");
  const suffix = accepted.request_id.slice("product-publication-request:".length);
  const evaluation = {
    schema_version: 1,
    artifact_type: "wgcf-product-publication-evaluation",
    evaluation_id: `product-publication-evaluation:${suffix}`,
    session_ref: accepted.session_ref,
    execution_ref: accepted.execution_ref,
    authority_revision: accepted.authority_revision,
    manifest_source: structuredClone(accepted.manifest_source),
    request,
  };
  evaluation.evaluation_digest = productPublicationDigest(evaluation, "evaluation_digest");
  return assertProductPublicationContract("evaluation.schema.json", evaluation);
}

export function createProductPublicationPacket({ command, evaluation, readiness, readinessRef }) {
  const suffix = command.request_id.slice("product-publication-request:".length);
  const decisionDigest = productPublicationDigest({
    caller: command.operator_id,
    request_id: command.request_id,
    decision: command.operator_decision,
  });
  const packet = {
    schema_version: 1,
    artifact_type: "product-publication-packet",
    packet_id: `product-publication-packet:${suffix}`,
    request_id: command.request_id,
    idempotency_key: command.idempotency_key,
    request_digest: evaluation.request.request_digest,
    expected_publication_version: command.expected_publication_version,
    action: command.action,
    product_id: readiness.product_id,
    manifest_binding: {
      manifest_id: readiness.manifest_binding.manifest_id,
      manifest_digest: readiness.manifest_binding.manifest_digest,
      owner_repo: readiness.manifest_binding.owner_repo,
      owner_revision: readiness.manifest_binding.owner_revision,
    },
    current_publication_posture: command.current_publication_posture,
    target_publication: structuredClone(command.target_publication),
    authority_refs: {
      operator_decision_ref: `oos://product-publication/operator-decisions/${decisionDigest.slice(7)}`,
      readiness_receipt_ref: readinessRef.uri,
      security_decision_ref: command.security_decision.uri,
    },
    previous_receipt: structuredClone(command.previous_receipt),
    grants: {
      source_authority: false,
      runtime_authority: false,
      release_authority: false,
      security_acceptance: false,
      lifecycle_mutation: false,
    },
    requested_at: command.requested_at,
  };
  return assertProductPublicationContract("packet.schema.json", packet);
}

export function createProductPublicationReceipt({ command, packet, readiness, recordedAt }) {
  const applied = readiness.outcome === "ready";
  const suffix = command.request_id.slice("product-publication-request:".length);
  const receipt = {
    schema_version: 1,
    artifact_type: "product-publication-receipt",
    receipt_id: `product-publication-receipt:${suffix}`,
    packet_id: packet.packet_id,
    request_id: command.request_id,
    request_digest: packet.request_digest,
    manifest_digest: packet.manifest_binding.manifest_digest,
    product_id: packet.product_id,
    outcome: applied ? "applied" : "rejected",
    publication_version: applied ? command.expected_publication_version + 1 : null,
    publication_posture: applied ? command.target_publication.posture : null,
    owner_receipt_ref: `oos://product-publication/owner-receipts/product-publication-receipt:${suffix}`,
    recorded_at: recordedAt,
    secret_values_embedded: false,
  };
  return assertProductPublicationContract("receipt.schema.json", receipt);
}

export function productPublicationReceiptReference(receipt) {
  return {
    receipt_id: receipt.receipt_id,
    receipt_digest: productPublicationDigest(receipt),
    publication_version: receipt.publication_version,
  };
}
