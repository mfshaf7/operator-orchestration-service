import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { canonicalDigest } from "./canonical-json.js";

const CONTRACT_ROOT = fileURLToPath(
  new URL("../../contracts/delivery-art/", import.meta.url),
);
const manifestSchema = JSON.parse(
  readFileSync(
    path.join(CONTRACT_ROOT, "delivery-art-work-session-resource-manifest.schema.json"),
    "utf8",
  ),
);
const receiptSchema = JSON.parse(
  readFileSync(
    path.join(CONTRACT_ROOT, "delivery-art-work-session-cleanup-receipt.schema.json"),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifestSchema = ajv.compile(manifestSchema);
const validateReceiptSchema = ajv.compile(receiptSchema);

function schemaErrors(validator, value) {
  const valid = validator(value);
  return valid
    ? []
    : (validator.errors ?? []).map((error) =>
        `${error.instancePath || "/"} ${error.message}`);
}

function relativePathIssue(value) {
  if (typeof value !== "string" || !value) {
    return "must be a non-empty relative path";
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return "must not be absolute";
  }
  if (value.includes("\\")) {
    return "must use POSIX separators";
  }
  if (value.split("/").includes("..")) {
    return "must not contain parent traversal";
  }
  return null;
}

function semanticManifestErrors(value) {
  const errors = [];
  const expectedSessionId =
    `work-session:${value?.delivery_id}:${value?.landing_unit_id}`;
  if (value?.session_id !== expectedSessionId) {
    errors.push("session_id must bind delivery_id and landing_unit_id");
  }
  const cleanup = value?.cleanup;
  if (cleanup?.state !== "not-required" && cleanup?.close_intent !== true) {
    errors.push("cleanup beyond not-required requires explicit close intent");
  }
  const resourceIds = new Set();
  const outcomes = [];
  for (const [index, resource] of (value?.resources ?? []).entries()) {
    const label = `resources[${index}]`;
    if (resourceIds.has(resource.resource_id)) {
      errors.push(`${label}.resource_id must be unique`);
    }
    resourceIds.add(resource.resource_id);
    if (resource.locator?.ownership_marker !== value.session_id) {
      errors.push(`${label}.locator ownership_marker must match session_id`);
    }
    for (const field of ["workspace_relative_path", "relative_path"]) {
      if (Object.hasOwn(resource.locator ?? {}, field)) {
        const issue = relativePathIssue(resource.locator[field]);
        if (issue) {
          errors.push(`${label}.locator.${field} ${issue}`);
        }
      }
    }
    outcomes.push(resource.outcome);
    if (resource.ownership_provenance !== "session-created") {
      if (resource.retention_class === "retire-on-terminal-close") {
        errors.push(`${label} unowned resources cannot be marked for retirement`);
      }
      if (["eligible", "removed"].includes(resource.outcome)) {
        errors.push(`${label} unowned resources cannot be eligible or removed`);
      }
    }
    if (resource.outcome === "blocked" && !resource.last_error) {
      errors.push(`${label} blocked outcome requires last_error`);
    }
    if (resource.outcome !== "blocked" && resource.last_error !== null) {
      errors.push(`${label} last_error is only valid for a blocked outcome`);
    }
  }
  if (cleanup?.state === "blocked" && !outcomes.includes("blocked")) {
    errors.push("blocked cleanup state requires at least one blocked resource");
  }
  if (
    cleanup?.state === "complete" &&
    outcomes.some((outcome) => !["removed", "retained"].includes(outcome))
  ) {
    errors.push("complete cleanup state requires terminal resource outcomes");
  }
  return errors;
}

function semanticReceiptErrors(value) {
  const errors = [];
  const expectedSessionId =
    `work-session:${value?.delivery_id}:${value?.landing_unit_id}`;
  if (value?.session_id !== expectedSessionId) {
    errors.push("session_id must bind delivery_id and landing_unit_id");
  }
  if (value?.receipt_id !== `cleanup-receipt:${value?.session_id}`) {
    errors.push("receipt_id must derive from session_id");
  }
  const resourceIds = new Set();
  let retained = 0;
  for (const [index, resource] of (value?.resources ?? []).entries()) {
    if (resourceIds.has(resource.resource_id)) {
      errors.push(`resources[${index}].resource_id must be unique`);
    }
    resourceIds.add(resource.resource_id);
    if (resource.outcome === "retained") {
      retained += 1;
    }
    if (
      resource.ownership_provenance !== "session-created" &&
      resource.outcome === "removed"
    ) {
      errors.push(`resources[${index}] cannot remove an unowned resource`);
    }
    if (
      resource.retention_class === "retire-on-terminal-close" &&
      resource.outcome === "retained"
    ) {
      errors.push(`resources[${index}] retirement-required resource cannot be retained`);
    }
  }
  if (value?.outcome === "complete" && retained > 0) {
    errors.push("complete receipt cannot contain retained resources");
  }
  if (value?.outcome === "complete-with-retained-resources" && retained === 0) {
    errors.push("complete-with-retained-resources requires a retained resource");
  }
  return errors;
}

function validation(errors) {
  return { errors, valid: errors.length === 0 };
}

function requireValid(result, label) {
  if (!result.valid) {
    throw new Error(`${label} is invalid: ${result.errors.join("; ")}`);
  }
}

function nextGeneration(manifest, clock, changes) {
  const candidate = {
    ...structuredClone(manifest),
    ...changes,
    generation: manifest.generation + 1,
    updated_at: clock().toISOString(),
  };
  requireValid(
    validateDeliveryArtWorkSessionResourceManifest(candidate),
    "Delivery ART work-session resource manifest",
  );
  return candidate;
}

export function validateDeliveryArtWorkSessionResourceManifest(value) {
  return validation([
    ...schemaErrors(validateManifestSchema, value),
    ...semanticManifestErrors(value),
  ]);
}

export function validateDeliveryArtWorkSessionCleanupReceipt(value) {
  return validation([
    ...schemaErrors(validateReceiptSchema, value),
    ...semanticReceiptErrors(value),
  ]);
}

export function createDeliveryArtWorkSessionResourceManifest({
  clock = () => new Date(),
  resources,
  session,
}) {
  const manifest = {
    schema_version: 1,
    artifact_type: "delivery_art_work_session_resource_manifest",
    session_id: session.session_id,
    delivery_id: session.delivery_id,
    landing_unit_id: session.landing_unit_id,
    generation: 1,
    updated_at: clock().toISOString(),
    cleanup: {
      state: "not-required",
      close_intent: false,
      attempt: 0,
      last_error: null,
    },
    resources: structuredClone(resources),
  };
  requireValid(
    validateDeliveryArtWorkSessionResourceManifest(manifest),
    "Delivery ART work-session resource manifest",
  );
  return manifest;
}

export function prepareDeliveryArtWorkSessionCleanup({
  clock = () => new Date(),
  manifest,
  resources,
}) {
  const blocked = resources.filter((resource) => resource.outcome === "blocked");
  return nextGeneration(manifest, clock, {
    cleanup: {
      state: blocked.length > 0 ? "blocked" : "ready",
      close_intent: true,
      attempt: manifest.cleanup.attempt + 1,
      last_error: blocked.length > 0
        ? blocked.map((resource) => resource.last_error).join("; ")
        : null,
    },
    resources: structuredClone(resources),
  });
}

export function startDeliveryArtWorkSessionCleanup(
  manifest,
  { clock = () => new Date() } = {},
) {
  return nextGeneration(manifest, clock, {
    cleanup: { ...manifest.cleanup, state: "running", last_error: null },
  });
}

export function recordDeliveryArtWorkSessionResourceOutcome({
  clock = () => new Date(),
  error = null,
  manifest,
  outcome,
  resourceId,
}) {
  const resources = manifest.resources.map((resource) =>
    resource.resource_id === resourceId
      ? { ...resource, outcome, last_error: error }
      : resource);
  if (!resources.some((resource) => resource.resource_id === resourceId)) {
    throw new Error(`Unknown cleanup resource: ${resourceId}`);
  }
  return nextGeneration(manifest, clock, {
    cleanup: outcome === "blocked"
      ? { ...manifest.cleanup, state: "blocked", last_error: error }
      : manifest.cleanup,
    resources,
  });
}

export function completeDeliveryArtWorkSessionCleanup(
  manifest,
  { clock = () => new Date() } = {},
) {
  return nextGeneration(manifest, clock, {
    cleanup: { ...manifest.cleanup, state: "complete", last_error: null },
  });
}

export function recordDeliveryArtWorkSessionCleanupFailure({
  clock = () => new Date(),
  error,
  manifest,
}) {
  return nextGeneration(manifest, clock, {
    cleanup: { ...manifest.cleanup, state: "running", last_error: error },
  });
}

export function createDeliveryArtWorkSessionCleanupReceipt({
  clock = () => new Date(),
  closedBy,
  manifest,
  protectedEvidenceRefs,
}) {
  const retained = manifest.resources.some(
    (resource) => resource.outcome === "retained",
  );
  const receipt = {
    schema_version: 1,
    artifact_type: "delivery_art_work_session_cleanup_receipt",
    receipt_id: `cleanup-receipt:${manifest.session_id}`,
    session_id: manifest.session_id,
    delivery_id: manifest.delivery_id,
    landing_unit_id: manifest.landing_unit_id,
    closed_by: closedBy,
    manifest: {
      generation: manifest.generation,
      content_digest: canonicalDigest(manifest),
    },
    outcome: retained ? "complete-with-retained-resources" : "complete",
    resources: manifest.resources.map((resource) => ({
      resource_id: resource.resource_id,
      resource_type: resource.resource_type,
      ownership_provenance: resource.ownership_provenance,
      retention_class: resource.retention_class,
      outcome: resource.outcome,
      reason: resource.outcome === "retained"
        ? resource.last_error ?? "resource retained by policy"
        : null,
    })),
    protected_evidence_refs: [...new Set(protectedEvidenceRefs)].sort(),
    finalized_at: clock().toISOString(),
  };
  requireValid(
    validateDeliveryArtWorkSessionCleanupReceipt(receipt),
    "Delivery ART work-session cleanup receipt",
  );
  return receipt;
}
