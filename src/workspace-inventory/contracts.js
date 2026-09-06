import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";

const root = new URL("../../contracts/workspace-inventory/", import.meta.url);
export const inventoryManifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validators = new Map();
for (const [name, entry] of Object.entries(inventoryManifest.files)) {
  const bytes = readFileSync(new URL(name, root));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error(`Workspace Inventory bundle integrity failed: ${name}`);
  }
  if (name.endsWith(".json")) validators.set(name.split(".")[0], ajv.compile(JSON.parse(bytes)));
}

const DIGEST_FIELDS = {
  evaluation: "evaluation_digest",
  mutation: "mutation_digest",
  readback: "readback_digest",
  readiness: "readiness_digest",
  receipt: "receipt_digest",
  request: "request_digest",
};

export function inventoryError(code, message, status = 409) {
  return new HttpError(status, `workspace_inventory_${code}`, message);
}

function compareKeys(a, b) {
  const left = Array.from(a, (character) => character.codePointAt(0));
  const right = Array.from(b, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

export function inventoryStringify(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw inventoryError("invalid_json", "Invalid Unicode string.", 400);
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(inventoryStringify).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map((key) => `${inventoryStringify(key)}:${inventoryStringify(value[key])}`).join(",")}}`;
  }
  throw inventoryError("invalid_json", "Workspace Inventory JSON requires lossless integral values and plain objects.", 400);
}

export function inventoryDigest(value, field = null) {
  const projection = structuredClone(value);
  if (field) delete projection[field];
  return `sha256:${createHash("sha256").update(inventoryStringify(projection)).digest("hex")}`;
}

export function bindInventory(value, field) {
  return { ...structuredClone(value), [field]: inventoryDigest(value, field) };
}

export function assertInventory(kind, value) {
  const validate = validators.get(kind);
  if (!validate?.(value)) throw inventoryError("contract_invalid", `Invalid Workspace Inventory ${kind}.`, 400);
  const field = DIGEST_FIELDS[kind];
  if (!field || value[field] !== inventoryDigest(value, field)) {
    throw inventoryError("digest_invalid", `Invalid Workspace Inventory ${kind} digest.`, 400);
  }
  return value;
}

export function inventoryReference(value, kind) {
  return { id: value[`${kind}_id`], digest: value[`${kind}_digest`] };
}

export function createInventoryEvaluation(input, callerId) {
  if (!input || Object.keys(input).sort().join(",") !== "authority_revision,execution_ref,request,session_ref") {
    throw inventoryError("command_invalid", "Supply request, authority revision, session and execution references.", 400);
  }
  const request = assertInventory("request", input.request);
  if (request.operator_ref !== callerId) {
    throw inventoryError("operator_mismatch", "The promotion request must belong to the authenticated operator.", 403);
  }
  const identity = inventoryDigest({ ...input, caller_id: callerId }).slice(7);
  return assertInventory("evaluation", bindInventory({
    schema_version: 1,
    artifact_type: "wgcf-workspace-inventory-readiness-evaluation",
    evaluation_id: `workspace-inventory:${identity}`,
    ...structuredClone(input),
  }, "evaluation_digest"));
}

export const inventoryContractRoot = fileURLToPath(root);
