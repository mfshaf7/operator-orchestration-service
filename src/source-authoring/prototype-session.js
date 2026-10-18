import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertSourceCredentialSubject } from "../platform-operation/source-credentials.js";
import { PROTOTYPE_SOURCE_REQUEST_ID, prototypeAuthoringError } from "./prototype-contracts.js";
import { normalizePrototypeOwnerPreparation } from "./prototype-owner-preparation.js";

export function prototypeSourceSession(record) {
  const session = { schema_version: 1, artifact_type: "prototype-source-session", session_id: `prototype-source-session:${record.request_digest.slice(7)}`,
    prototype_id: record.request.prototype_id, source_request_id: record.request.request_id, request_digest: record.request_digest,
    caller_id: record.caller_id, operator: { id: record.operator_id }, subject: structuredClone(record.binding.subject),
    model_source_scope: structuredClone(record.binding.model_source_scope), objective_digest: canonicalDigest(record.request.objective),
    ...(record.request.owner_preparation ? { owner_preparation: structuredClone(record.request.owner_preparation) } : {}),
    owner_repo: "workspace-prototype-studio", landing_unit_id: record.binding.source_start.landing_unit_id,
    landing_unit: { branch: record.binding.source_start.branch, base_ref: "origin/main", base_commit: record.binding.source_start.fetched_base } };
  return assertPrototypeSourceSession(session, record.request.prototype_id);
}

export function assertPrototypeSourceSession(session, prototypeId) {
  if (session && Object.hasOwn(session, "owner_preparation")) normalizePrototypeOwnerPreparation(session.owner_preparation);
  const digest = session?.request_digest;
  const suffix = typeof digest === "string" ? digest.slice(7, 31) : "";
  const slug = typeof prototypeId === "string" ? prototypeId.slice("prototype:".length) : "";
  let validSubject = false;
  try { validSubject = assertSourceCredentialSubject(session?.subject).kind === "prototype"; } catch {}
  if (!validSubject || session?.schema_version !== 1 || session.artifact_type !== "prototype-source-session" ||
      session.prototype_id !== prototypeId || session.subject.prototype_id !== prototypeId ||
      session.subject.source_ref !== `repo://workspace-prototype-studio/prototypes/${slug}` ||
      session.model_source_scope?.source_root !== `prototypes/${slug}` || session.model_source_scope?.design_profile !== `docs/prototypes/${slug}/design-profile.md` ||
      !/^sha256:[0-9a-f]{64}$/.test(digest ?? "") || session.session_id !== `prototype-source-session:${digest.slice(7)}` ||
      !PROTOTYPE_SOURCE_REQUEST_ID.test(session.source_request_id ?? "") || !session.caller_id || !session.operator?.id ||
      !/^sha256:[0-9a-f]{64}$/.test(session.objective_digest ?? "") || session.owner_repo !== "workspace-prototype-studio" ||
      session.landing_unit_id !== `prototype-authoring-${suffix}` || session.landing_unit?.branch !== `feature/prototype-${suffix}` ||
      session.landing_unit.base_ref !== "origin/main" || session.landing_unit.base_commit !== session.subject.source_revision ||
      Object.hasOwn(session, "delivery_id") || Object.hasOwn(session, "work_item_id")) {
    throw prototypeAuthoringError("source_session_invalid", "Prototype source effects require the immutable canonical request-derived owner, scope, branch, base and actual session.", 400);
  }
  return session;
}

export function prototypeWorktreeRelativePath(session) {
  assertPrototypeSourceSession(session, session.prototype_id);
  return `.worktrees/${session.landing_unit_id}/${session.owner_repo}`;
}
