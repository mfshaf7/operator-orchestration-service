import { HttpError } from "../errors.js";
import { SOURCE_OWNER_BOOTSTRAP_PATHS } from "./scaffold.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const APPROVAL = /^[A-Za-z0-9][A-Za-z0-9:/._#-]{2,255}$/;
const fail = message => { throw new HttpError(400, "platform_source_bootstrap_contract_invalid", message); };

// Separate repository subject. Ordinary Delivery/Prototype normalizers do not
// accept it; only the explicit Platform credential-operation dispatcher does.
export function assertBootstrapCredentialSubject(subject) {
  const fields = ["kind", "owner_repo", "intake_entry_ref", "custody_receipt_digest", "template_digest", "plan_digest",
    "decision_ref", "workflow_write", "workflow_approval_ref", "allowed_paths"];
  if (!subject || Array.isArray(subject) || Object.keys(subject).length !== fields.length || fields.some(field => !Object.hasOwn(subject, field)) ||
      subject.kind !== "repository-bootstrap" || !/^[a-z0-9][a-z0-9._-]*$/.test(subject.owner_repo ?? "")) fail("Bootstrap requires its exact repository subject, not an ordinary source alias.");
  const entry = subject.intake_entry_ref;
  if (!entry || Object.keys(entry).sort().join(",") !== "digest,id,version" || entry.id !== `repo:${subject.owner_repo}` ||
      !Number.isSafeInteger(entry.version) || entry.version < 1 || !DIGEST.test(entry.digest ?? "")) fail("Bootstrap requires the exact proposed Intake entry reference.");
  for (const field of ["custody_receipt_digest", "template_digest", "plan_digest"]) if (!DIGEST.test(subject[field] ?? "")) fail("Bootstrap provenance and source-plan digests are required.");
  if (!APPROVAL.test(subject.decision_ref ?? "")) fail("Bootstrap requires its explicit accountable operator decision.");
  const paths = subject.allowed_paths;
  if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length ||
      paths.some(value => !SOURCE_OWNER_BOOTSTRAP_PATHS.includes(value)) || paths.join("\0") !== [...paths].sort().join("\0")) fail("Bootstrap permits only a sorted unique subset of trusted owner-control files.");
  if (typeof subject.workflow_write !== "boolean" || subject.workflow_write !== paths.includes(".github/workflows/validate.yaml") ||
      (subject.workflow_write ? !APPROVAL.test(subject.workflow_approval_ref ?? "") : subject.workflow_approval_ref !== null)) fail("Bootstrap workflow writes require their separate explicit grant and exact changed path.");
  return structuredClone(subject);
}

export function bootstrapCredentialProjection(subject) {
  assertBootstrapCredentialSubject(subject);
  return { purpose: "trusted-owner-bootstrap", approval_ref: subject.decision_ref,
    bootstrap_plan_digest: subject.plan_digest, bootstrap_template_digest: subject.template_digest,
    workflow_write: subject.workflow_write };
}
