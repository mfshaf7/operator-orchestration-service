import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { sourceControlEvidenceProfile } from "../delivery-art/application-verification.js";
import { repositoryCustodyIntakeAuthority } from "../repository-custody/intake-source.js";
import { assertProposedSourceOwnerAuthority, inspectExistingSourceOwnerControls, planSourceOwnerBootstrap, sourceOwnerBootstrapPaths, assertOwnerSetupAuthority, planSourceOwnerVerification } from "./scaffold.js";

const fail = (message, status = 409) => { throw new HttpError(status, "repository_owner_bootstrap_preparation_invalid", message); };
const fields = ["owner_repo", "custody_request_id", "evidence_profile", "application_markers", "with_ci", "decision_ref"];
const selected = authority => ({
  ...(authority.inventory_entry_ref ? { inventory_entry_ref: authority.inventory_entry_ref, verification_setup_eligible: authority.verification_setup_eligible } : {}), owner_repo: authority.owner_repo, intake_entry_ref: authority.intake_entry_ref,
  provider_repository: authority.provider_repository, classification: authority.classification,
  inventory_posture: authority.inventory_posture, custody_receipt_digest: authority.custody_receipt_digest,
  source_bootstrap_eligible: authority.source_bootstrap_eligible, ordinary_source_eligible: authority.ordinary_source_eligible,
  model_writes_allowed: authority.model_writes_allowed, canonical_mutation: authority.canonical_mutation,
  runtime_activation: authority.runtime_activation });

// Stateless preparation, not an accepted source request or permission to mint.
// Actual source effects will consume a separately approved, retained immutable
// plan through the existing source executor/credential authority. No model,
// target checkout, credential, journal write or admission occurs here.
export function createRepositoryOwnerBootstrapPreparation({ callerOperatorBindings, custodySourceReader, intakeSourceClient, sourceReader }) {
  if (typeof custodySourceReader !== "function" || typeof intakeSourceClient?.proposedSourceOwner !== "function" ||
      typeof sourceReader?.inspect !== "function") throw new TypeError("Bootstrap requires canonical custody, proposed Intake and exact provider source readers.");
  function identity(callerId, operatorId) {
    if (!callerId || !operatorId || callerOperatorBindings?.[callerId] !== operatorId) fail("The caller is not bound to this accountable operator.", 403);
  }
  async function authorityFor(callerId, ownerRepo, custodyRequestId, operation = "bootstrap") {
    const target = { kind: "repo", name: ownerRepo, record_id: `repo:${ownerRepo}` };
    const custodyResult = await custodySourceReader(custodyRequestId, { callerId });
    if (custodyResult?.request?.request_id !== custodyRequestId) fail("Custody returned a different retained request.");
    const custody = repositoryCustodyIntakeAuthority({ result: custodyResult, target });
    const read = operation === "configure-verification" ? intakeSourceClient.verificationSourceOwner : intakeSourceClient.proposedSourceOwner;
    if (typeof read !== "function") fail("The active owner verification reader is unavailable.", 503);
    const proposed = assertOwnerSetupAuthority(await read({ target, custodyResult }), operation);
    if (proposed.owner_repo !== ownerRepo || proposed.custody_receipt_digest !== custody.digest ||
        canonicalDigest(proposed.provider_repository) !== canonicalDigest(custody.binding)) fail("Proposed Intake does not bind this exact custody result.");
    return proposed;
  }
  return {
    async verify({ callerId, operatorId, preparation }) {
      identity(callerId, operatorId);
      const { preparation_digest: digest, ...body } = preparation ?? {};
      if (preparation?.workflow_id !== "repository-owner-bootstrap-preparation" || preparation.caller_id !== callerId ||
          preparation.operator_id !== operatorId || canonicalDigest(body) !== digest || !preparation.owner_authority) {
        fail("Verify only the exact retained caller-owned bootstrap preparation.");
      }
      const authority = await authorityFor(callerId, preparation.owner_authority.owner_repo, preparation.custody_request_id, preparation.operation ?? "bootstrap");
      if (canonicalDigest(selected(authority)) !== canonicalDigest(preparation.owner_authority)) fail("The selected proposed owner or custody changed after preparation.");
      return authority;
    },
    async prepare({ callerId, operatorId, input }) {
      identity(callerId, operatorId);
      const operation = input?.operation ?? "bootstrap";
      const inputFields = Object.hasOwn(input ?? {}, "operation") ? [...fields, "operation"] : fields;
      if (!["bootstrap", "configure-verification"].includes(operation) || !input || Array.isArray(input) || Object.keys(input).length !== inputFields.length || inputFields.some(field => !Object.hasOwn(input, field)) ||
          Buffer.byteLength(JSON.stringify(input)) > 65_536 || !/^[a-z0-9][a-z0-9._-]*$/.test(input.owner_repo ?? "") ||
          typeof input.custody_request_id !== "string" || !input.custody_request_id.trim() || input.custody_request_id.length > 256 ||
          !/^[A-Za-z0-9][A-Za-z0-9:/._#-]{2,255}$/.test(input.decision_ref ?? "")) fail("Select only the exact owner, custody request and bounded operator preparation intent.", 400);
      input = structuredClone(input);
      const authority = () => authorityFor(callerId, input.owner_repo, input.custody_request_id, operation);
      // Fail before touching target source when proposed/custody authority is
      // missing, mismatched, active/retired, out of scope or privileged.
      const before = assertOwnerSetupAuthority(await authority(), operation);
      if (before.owner_repo !== input.owner_repo || !/^sha256:[0-9a-f]{64}$/.test(before.custody_receipt_digest ?? "")) fail("The proposed authority does not bind this exact selected custody owner.");
      const source = await sourceReader.inspect({ providerRepository: before.provider_repository, paths: sourceOwnerBootstrapPaths(input.with_ci) });
      if (source.visibility !== "public" || source.default_branch !== "main") fail("This adapter qualifies only public synthetic source on main; private/client operation is not qualified.");
      const existing = inspectExistingSourceOwnerControls({ ownerRepo: input.owner_repo, fetchedBase: source.fetched_base, observedFiles: source.observed_files });
      if (operation === "configure-verification" && (!existing || existing.source_change_required || input.with_ci !== false)) fail("Active verification requires existing reviewed owner controls and cannot request CI changes.");
      const selectedProfile = input.evidence_profile ?? existing?.evidence_profile ?? sourceControlEvidenceProfile(input.owner_repo);
      if (operation === "bootstrap" && existing && canonicalDigest(existing.evidence_profile) !== canonicalDigest(selectedProfile)) {
        fail("Existing owner controls are retained; select their actual validation profile rather than replacing it during bootstrap.");
      }
      const plan = operation === "configure-verification" ? (input.evidence_profile === null ? null : planSourceOwnerVerification({ authority: before, fetchedBase: source.fetched_base, profile: selectedProfile, applicationMarkers: input.application_markers, withCi: input.with_ci, observedFiles: source.observed_files }))
        : existing && !existing.source_change_required && (!input.with_ci || existing.ci_present) ? null : planSourceOwnerBootstrap({ authority: before, fetchedBase: source.fetched_base,
        profile: selectedProfile, applicationMarkers: input.application_markers,
        withCi: input.with_ci, observedFiles: source.observed_files });
      const after = assertOwnerSetupAuthority(await authority(), operation);
      if (canonicalDigest(selected(before)) !== canonicalDigest(selected(after))) fail("The selected proposed owner or custody changed during preparation.");
      const body = { schema_version: 1, workflow_id: "repository-owner-bootstrap-preparation",
        caller_id: callerId, operator_id: operatorId, decision_ref: input.decision_ref,
        ...(operation === "configure-verification" ? { operation } : {}),
        custody_request_id: input.custody_request_id, custody_receipt_digest: before.custody_receipt_digest,
        owner_authority: selected(before),
        plan, ...(existing && !plan ? { existing_owner_controls: existing,
          next_action: operation === "configure-verification" ? "configure-application-verification" : "admit-existing-owner-controls-no-bootstrap-review" } : {}),
        authorization: "preparation-only", credential_issued: false, checkout_created: false,
        canonical_mutation: false, runtime_activation: false };
      return { ...body, preparation_digest: canonicalDigest(body) };
    },
  };
}
