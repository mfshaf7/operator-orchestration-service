import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { validateDeliveryArtSourceRealizationChangeSet } from "../delivery-art/source-realization.js";
import { HttpError } from "../errors.js";
import { assertBootstrapCredentialSubject } from "./credentials.js";
import { SOURCE_OWNER_BOOTSTRAP_TEMPLATE } from "./scaffold.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}$/;
const fail = message => { throw new HttpError(409, "repository_owner_bootstrap_session_invalid", message); };

export function assertBootstrapSourceSession(session) {
  assertBootstrapCredentialSubject(session?.subject);
  const digest = session.request_digest;
  const suffix = typeof digest === "string" ? digest.slice(7, 31) : "";
  if (session.schema_version !== 1 || session.artifact_type !== "repository-owner-bootstrap-session" || !DIGEST.test(digest ?? "") ||
      session.session_id !== `repository-bootstrap-session:${digest.slice(7)}` || !ID.test(session.source_request_id ?? "") ||
      !ID.test(session.caller_id ?? "") || !ID.test(session.operator?.id ?? "") || session.owner_repo !== session.subject.owner_repo ||
      !DIGEST.test(session.objective_digest ?? "") || session.landing_unit_id !== `owner-bootstrap-${suffix}` ||
      session.landing_unit?.id !== session.landing_unit_id || session.landing_unit.branch !== `feature/owner-bootstrap-${suffix}` ||
      session.landing_unit.base_ref !== "origin/main" || !/^[0-9a-f]{40}$/.test(session.landing_unit.base_commit ?? "") ||
      !Array.isArray(session.covered_work_item_ids) || session.covered_work_item_ids.length !== 0 ||
      ["prototype_id", "delivery_id", "work_item_id"].some(field => Object.hasOwn(session, field))) {
    fail("Bootstrap requires its real immutable repository request/session, not a Delivery or Prototype identity.");
  }
  return session;
}

export function bootstrapSourceSession({ requestDigest, requestId, callerId, operatorId, preparation, workflowApprovalRef = null }) {
  const { preparation_digest: preparationDigest, ...preparedBody } = preparation ?? {};
  const { plan_digest: planDigest, ...planBody } = preparation?.plan ?? {};
  const plan = preparation?.plan;
  if (!DIGEST.test(requestDigest ?? "") || canonicalDigest(preparedBody) !== preparationDigest || canonicalDigest(planBody) !== planDigest ||
      preparation.authorization !== "preparation-only" || preparation.caller_id !== callerId || preparation.operator_id !== operatorId ||
      plan.template?.digest !== SOURCE_OWNER_BOOTSTRAP_TEMPLATE.digest || plan.source_change_required !== true ||
      plan.model_invoked !== false || plan.app_import !== false || plan.canonical_mutation !== false || plan.runtime_activation !== false) {
    fail("A bootstrap source session requires its exact trusted finite prepared plan and accountable operator.");
  }
  const paths = plan.files.filter(file => file.action === "create").map(file => file.path).sort();
  const subject = assertBootstrapCredentialSubject({ kind: "repository-bootstrap", owner_repo: plan.owner_repo,
    intake_entry_ref: plan.intake_entry_ref, custody_receipt_digest: preparation.custody_receipt_digest,
    template_digest: plan.template.digest, plan_digest: planDigest, decision_ref: preparation.decision_ref,
    allowed_paths: paths, workflow_write: plan.requires_workflow_permission,
    workflow_approval_ref: workflowApprovalRef });
  const suffix = requestDigest.slice(7, 31), landingUnitId = `owner-bootstrap-${suffix}`;
  return assertBootstrapSourceSession({ schema_version: 1, artifact_type: "repository-owner-bootstrap-session",
    session_id: `repository-bootstrap-session:${requestDigest.slice(7)}`, source_request_id: requestId,
    request_digest: requestDigest, caller_id: callerId, operator: { id: operatorId }, owner_repo: plan.owner_repo,
    subject, objective_digest: preparationDigest, covered_work_item_ids: [], landing_unit_id: landingUnitId,
    landing_unit: { id: landingUnitId, branch: `feature/owner-bootstrap-${suffix}`, base_ref: "origin/main", base_commit: plan.fetched_base } });
}

export function bootstrapWorktreeRelativePath(session) {
  assertBootstrapSourceSession(session);
  return `.worktrees/${session.landing_unit_id}/${session.owner_repo}`;
}

export function bootstrapSourceChangeSet(plan, session) {
  assertBootstrapSourceSession(session);
  const { plan_digest: digest, ...body } = plan ?? {};
  if (canonicalDigest(body) !== digest || digest !== session.subject.plan_digest ||
      plan.template?.digest !== SOURCE_OWNER_BOOTSTRAP_TEMPLATE.digest || plan.template.digest !== session.subject.template_digest ||
      plan.owner_repo !== session.owner_repo || plan.fetched_base !== session.landing_unit.base_commit) fail("The source plan no longer matches the exact approved bootstrap session.");
  const changes = plan.files.filter(file => file.action === "create");
  if (canonicalDigest(changes.map(file => file.path).sort()) !== canonicalDigest(session.subject.allowed_paths) ||
      changes.some(file => file.mode !== "100644" || file.expected_digest !== null || typeof file.content !== "string" ||
        !file.content.isWellFormed() || Buffer.byteLength(file.content) > 65_536)) fail("Bootstrap may create only its exact approved finite regular owner-control files.");
  const changeSet = { schema_version: 1, change_set_id: `owner-bootstrap-plan:${digest.slice(7)}`, session_id: session.session_id,
    base_commit: plan.fetched_base, objective_digest: session.objective_digest,
    commit_message: "chore: bootstrap reviewed source owner controls",
    operations: changes.map(file => ({ action: "create", path: file.path, content: file.content, expected_digest: null })) };
  if (!validateDeliveryArtSourceRealizationChangeSet(changeSet).valid) fail("Bootstrap must retain the existing bounded native source change-set wire.");
  return changeSet;
}
