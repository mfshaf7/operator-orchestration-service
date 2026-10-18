import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";

// Reuse the admitted packet's work/custody definitions, not a competing packet
// schema or a hand-built baseline/transfer receipt. Studio remains the emitter.
const packet = JSON.parse(readFileSync(new URL("../../contracts/delivery-ingress/prototype-delivery-packet.schema.json", import.meta.url), "utf8"));
export const prototypeDeliveryPreparationSchema = {
  type: "object", additionalProperties: false, required: ["kind", "work", "custody", "evidence_refs", "rationale", "decision_ref"],
  properties: { kind: { const: "delivery-packet" }, work: { $ref: "#/$defs/work" }, custody: { $ref: "#/$defs/resolved_source_custody" },
    evidence_refs: packet.properties.content.properties.evidence_refs, rationale: { $ref: "#/$defs/text" },
    decision_ref: { type: "string", pattern: "^record://[A-Za-z0-9._:/-]+$", maxLength: 512 } },
  $defs: packet.$defs,
};
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(prototypeDeliveryPreparationSchema);
export function normalizePrototypeDeliveryPreparation(value) {
  let canonical = false;
  try { canonicalDigest(value); canonical = true; } catch {}
  if (!canonical || !validate(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 65_536) {
    throw new HttpError(400, "prototype_source_authoring_owner_preparation_invalid", "Delivery preparation requires exact bounded work, resolved custody, evidence, rationale and operator decision; baseline and Git coordinates are derived by the owner.");
  }
  return structuredClone(value);
}
export function prototypeDeliveryPreparationRequest(session) {
  const value = normalizePrototypeDeliveryPreparation(session.owner_preparation);
  return { schema_version: 1, prototype_id: session.prototype_id.slice("prototype:".length), ...value.work,
    custody: value.custody, evidence_refs: value.evidence_refs, rationale: value.rationale,
    authorization: { decision: "approved", operator_id: session.operator.id, decision_ref: value.decision_ref },
    source_revision: { repository: session.owner_repo, ref: "HEAD", base_commit: session.subject.source_revision, head_commit: session.subject.source_revision } };
}
export function prototypeDeliveryPreparationPathAllowed(value, session) {
  const slug = session.prototype_id.slice("prototype:".length);
  return value === "prototypes.yaml" || new RegExp(`^records/delivery-packets/${slug}-[a-f0-9]{64}\\.json$`).test(value);
}
export function prototypeDeliveryOwnerChangeSet({ session, request, operations }) {
  const planDigest = canonicalDigest({ request, operations });
  return { change_set: { schema_version: 1, change_set_id: `prototype-owner-plan:${planDigest.slice(7)}`,
    session_id: session.session_id, base_commit: session.landing_unit.base_commit, objective_digest: session.objective_digest,
    commit_message: "feat: prepare approved Prototype Delivery packet", operations },
    plan_digest: planDigest, request_digest: canonicalDigest(request), authority: "workspace-prototype-studio", model_invoked: false, runtime_activated: false };
}
