import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";
import { assertWorkspaceOperationActivation } from "../workspace-operation-activation.js";

const root = new URL("../../contracts/workspace-inventory/", import.meta.url);
export const inventoryManifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
assertWorkspaceOperationActivation(inventoryManifest, {
  domain: "Workspace Inventory",
  readinessContractId: "wgcf.workspace-active-inventory-readiness.v1",
  readinessManifestPath: "contracts/workspace-active-inventory/manifest.json",
});
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
validators.set("registry", ajv.compile(JSON.parse(readFileSync(new URL("registry.schema.json", root), "utf8"))));

const DIGEST_FIELDS = {
  evaluation: "evaluation_digest",
  "lifecycle-evaluation": "evaluation_digest",
  "lifecycle-mutation": "mutation_digest",
  "lifecycle-readback": "readback_digest",
  "lifecycle-readiness": "readiness_digest",
  "lifecycle-receipt": "receipt_digest",
  "lifecycle-request": "request_digest",
  mutation: "mutation_digest",
  readback: "readback_digest",
  readiness: "readiness_digest",
  receipt: "receipt_digest",
  request: "request_digest",
};

export function inventoryError(code, message, status = 409) {
  return new HttpError(status, `workspace_inventory_${code}`, message);
}

export function projectInventoryRequestJournal({ records, callerId, input, workflowId }) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !["target", "cursor"].includes(key)) ||
      !input.target || Array.isArray(input.target) || Object.keys(input.target).sort().join(",") !== "kind,name" ||
      !["repo", "product", "component"].includes(input.target.kind) ||
      typeof input.target.name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(input.target.name) ||
      (input.cursor !== undefined && (typeof input.cursor !== "string" || !/^[0-9a-f]{64}$/.test(input.cursor)))) {
    throw inventoryError("list_invalid", "Request discovery requires one exact target and an optional matching cursor.", 400);
  }
  const target = { ...input.target, record_id: `${input.target.kind}:${input.target.name}` };
  const terminal = new Set(["succeeded", "cancelled", "rejected", "blocked", "stale"]);
  const selected = records.filter(record => record.caller_id === callerId &&
    record.request?.target?.record_id === target.record_id);
  for (const record of selected) {
    if (record.binding_digest !== inventoryDigest({ caller_id: callerId, evaluation: record.evaluation }) ||
        inventoryDigest(record.request) !== inventoryDigest(record.evaluation.request) ||
        record.request.target.kind !== target.kind || record.request.target.name !== target.name ||
        !Array.isArray(record.history) || !record.history.length) {
      throw inventoryError("storage_invalid", "Retained request binding is invalid.", 503);
    }
  }
  selected.sort((a, b) => Date.parse(b.request.requested_at) - Date.parse(a.request.requested_at) ||
    b.request.request_id.localeCompare(a.request.request_id));
  const cursorFor = record => inventoryDigest({ caller_id: callerId, workflow_id: workflowId,
    target, request_id: record.request.request_id }).slice(7);
  let offset = 0;
  if (input.cursor !== undefined) {
    offset = selected.findIndex(record => cursorFor(record) === input.cursor) + 1;
    if (!offset) throw inventoryError("cursor_invalid", "Cursor does not belong to this caller, family and target.", 400);
  }
  const page = selected.slice(offset, offset + 25);
  const rows = page.map(record => ({ request_id: record.request.request_id,
    requested_at: record.request.requested_at, updated_at: record.history.at(-1).at,
    status: record.status, revision: record.history.length,
    ...(workflowId === "workspace-inventory-lifecycle" ? { action: record.request.action } : {}) }));
  while (rows.length && Buffer.byteLength(JSON.stringify(rows), "utf8") > 32768) rows.pop();
  if (page.length && !rows.length) throw inventoryError("list_record_large", "Request locator exceeds its projection bound.", 503);
  return { schema_version: 1, workflow_id: workflowId, target,
    revision: selected.reduce((sum, record) => sum + record.history.length, 0),
    pending_request_count: selected.filter(record => !terminal.has(record.status)).length,
    updated_at: selected.map(record => record.history.at(-1).at).sort().at(-1) ?? null,
    records: rows, next_cursor: offset + rows.length < selected.length ? cursorFor(page[rows.length - 1]) : null,
    canonical_mutation: false };
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

export function registryProjectionDigest(value) {
  const projection = structuredClone(value);
  delete projection.projected_at;
  delete projection.projection_digest;
  delete projection.projection_id;
  return inventoryDigest(projection);
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

export function assertInventoryRegistry(value) {
  const validate = validators.get("registry");
  if (!validate?.(value)) {
    throw inventoryError("registry_contract_invalid", "Invalid Workspace Inventory registry projection.", 503);
  }
  if (value.projection_digest !== registryProjectionDigest(value)) {
    throw inventoryError("registry_digest_invalid", "Invalid Workspace Inventory registry projection digest.", 503);
  }
  if (value.projection_id !== `workspace-inventory-registry:${value.projection_digest.slice(7, 31)}`) {
    throw inventoryError("registry_identity_invalid", "Invalid Workspace Inventory registry projection identity.", 503);
  }
  const recordIds = new Set();
  for (const record of value.records) {
    if (record.id !== `${record.kind}:${record.name}` || recordIds.has(record.id)) {
      throw inventoryError("registry_identity_invalid", "Workspace Inventory registry contains an invalid or duplicate active identity.", 503);
    }
    recordIds.add(record.id);
  }
  const candidateIds = new Set();
  for (const candidate of value.eligible_promotions) {
    const expectedId = `${candidate.target.kind}:${candidate.target.name}`;
    if (candidate.target.record_id !== expectedId || candidate.intake_entry_ref.id !== expectedId ||
        candidate.active_record.kind !== candidate.target.kind || candidate.active_record.id !== expectedId ||
        recordIds.has(expectedId) || candidateIds.has(expectedId) ||
        candidate.candidate_digest !== inventoryDigest(candidate, "candidate_digest")) {
      throw inventoryError("registry_candidate_invalid", "Workspace Inventory registry contains an invalid promotion candidate.", 503);
    }
    candidateIds.add(expectedId);
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

export function createInventoryLifecycleEvaluation(input, callerId) {
  if (!input || Object.keys(input).sort().join(",") !== "authority_revision,execution_ref,request,session_ref") {
    throw inventoryError("lifecycle_command_invalid", "Supply lifecycle request, authority revision, session and execution references.", 400);
  }
  const request = assertInventory("lifecycle-request", input.request);
  if (request.operator_ref !== callerId) {
    throw inventoryError("operator_mismatch", "The lifecycle request must belong to the authenticated operator.", 403);
  }
  const identity = inventoryDigest({ ...input, caller_id: callerId }).slice(7);
  return assertInventory("lifecycle-evaluation", bindInventory({
    schema_version: 1,
    artifact_type: "wgcf-workspace-inventory-lifecycle-evaluation",
    evaluation_id: `workspace-inventory-lifecycle:${identity}`,
    ...structuredClone(input),
  }, "evaluation_digest"));
}

export const inventoryContractRoot = fileURLToPath(root);
