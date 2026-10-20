import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { validateDeliveryArtSourceRealizationChangeSet } from "../delivery-art/source-realization.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";
import { normalizePrototypeDeliveryPreparation, prototypeDeliveryPreparationPathAllowed } from "./prototype-delivery-preparation.js";

// A finite, immutable owner intent, never model-selected paths or a shell.
// The commissioned Studio control must render and recheck its actual bytes.
export function normalizePrototypeOwnerPreparation(value) {
  if (value?.kind === "delivery-packet") return normalizePrototypeDeliveryPreparation(value);
  const fields = ["kind", "port", "support_profile", "runtime_activation", "ttl_seconds", "decision_ref"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length ||
      fields.some(field => !Object.hasOwn(value, field)) || value.kind !== "preview-profile" ||
      !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
      !["interactive", "unattended"].includes(value.support_profile) || typeof value.runtime_activation !== "boolean" ||
      !Number.isInteger(value.ttl_seconds) || value.ttl_seconds < 300 || value.ttl_seconds > 86400 ||
      typeof value.decision_ref !== "string" || value.decision_ref.length > 512 || !/^record:\/\/[A-Za-z0-9._:/-]+$/.test(value.decision_ref)) {
    throw prototypeAuthoringError("owner_preparation_invalid", "Preview preparation requires only its exact reviewed port, support mode, activation intent, TTL and decision reference.", 400);
  }
  return structuredClone(value);
}

export function prototypeOwnerPreparationPath(session) {
  normalizePrototypeOwnerPreparation(session.owner_preparation);
  return `records/prototype-preview-profiles/${session.prototype_id.slice("prototype:".length)}.yaml`;
}

export function assertPrototypeOwnerChangeSet(value, session) {
  if (!validateDeliveryArtSourceRealizationChangeSet(value).valid) {
    throw prototypeAuthoringError("owner_change_set_invalid", "Owner preparation must use the exact bounded native change-set contract.", 400);
  }
  const preparation = normalizePrototypeOwnerPreparation(session.owner_preparation);
  const validOperations = preparation.kind === "delivery-packet"
    ? value?.operations?.length === 2 && value.operations.some(operation => operation.path === "prototypes.yaml" && operation.action === "replace") &&
      value.operations.every(operation => prototypeDeliveryPreparationPathAllowed(operation.path, session) &&
        (operation.path === "prototypes.yaml" || operation.action === "create"))
    : value?.operations?.length === 1 && value.operations[0].path === prototypeOwnerPreparationPath(session) && ["create", "replace"].includes(value.operations[0].action);
  if (value.session_id !== session.session_id ||
      value.base_commit !== session.landing_unit.base_commit || value.objective_digest !== session.objective_digest ||
      !validOperations || new Set(value.operations.map(operation => operation.path)).size !== value.operations.length ||
      value.operations.some(operation => typeof operation.content !== "string" || !operation.content.isWellFormed() || Buffer.byteLength(operation.content) > 65_536)) {
    throw prototypeAuthoringError("owner_change_set_invalid", "Trusted preparation may change only its exact owner profile or native-emitted Delivery packet/registry through a bounded change set.", 400);
  }
  return value;
}

export function prototypeOwnerChangeSet(plan, session) {
  const { plan_digest: digest, ...body } = plan ?? {};
  const intent = normalizePrototypeOwnerPreparation(session.owner_preparation);
  const request = { schema_version: 1, prototype_id: session.prototype_id, source_revision: session.subject.source_revision,
    operator: { id: session.operator.id, decision_ref: intent.decision_ref }, port: intent.port,
    support_profile: intent.support_profile, runtime_activation: intent.runtime_activation, ttl_seconds: intent.ttl_seconds };
  const change = plan?.changes?.[0];
  if (digest !== canonicalDigest(body) || plan?.schema_version !== 1 || plan.status !== "preparation-only" ||
      canonicalDigest(plan.subject) !== canonicalDigest(session.subject) || plan.request_digest !== canonicalDigest(request) ||
      canonicalDigest(plan.operator) !== canonicalDigest(request.operator) || !Array.isArray(plan.changes) || plan.changes.length !== 1 ||
      change.operation !== "write" || change.path !== prototypeOwnerPreparationPath(session) ||
      !["may_apply_source", "may_invoke_model", "may_approve_baseline", "may_activate_runtime"].every(field => plan.authority?.[field] === false)) {
    throw prototypeAuthoringError("owner_plan_invalid", "The commissioned Studio plan did not retain its exact immutable source, operator and read-only preparation binding.", 502);
  }
  return assertPrototypeOwnerChangeSet({ schema_version: 1, change_set_id: `prototype-owner-plan:${digest.slice(7)}`,
    session_id: session.session_id, base_commit: session.landing_unit.base_commit, objective_digest: session.objective_digest,
    commit_message: "feat: prepare reviewed Prototype Preview profile", operations: [{ action: change.expected_content_digest === null ? "create" : "replace",
      path: change.path, expected_digest: change.expected_content_digest, content: change.content }] }, session);
}
