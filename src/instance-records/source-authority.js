import { HttpError } from "../errors.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
import { repositoryCustodyIntakeAuthority } from "../repository-custody/intake-source.js";
import { assertOwnerSetupAuthority } from "../repository-owner-bootstrap/scaffold.js";

// Resolve the recorded authority before selecting a reader. A timeout, unknown
// API or absent internal record is never permission to read public source.
export function createInstanceSourceOwnerClient({ reader, legacy, enabled = true }) {
  async function read({ target, custodyResult }, operation) {
    const custody = repositoryCustodyIntakeAuthority({ result: custodyResult, target });
    const current = await reader.sourceAuthority(target.name, operation);
    if (current.canonical_authority.kind === "legacy-git") {
      const value = await (operation === "bootstrap" ? legacy.proposedSourceOwner : legacy.verificationSourceOwner)({ target, custodyResult });
      if (value.authority_revision !== current.canonical_authority.revision) {
        throw new HttpError(409, "instance_records_legacy_authority_changed", "Source authority changed during the read; inspect the current registration.");
      }
      return value;
    }
    if (!enabled) throw new HttpError(503, "instance_records_disabled", "Internal source operations are not enabled in this composition.");
    const proof = assertOwnerSetupAuthority(current.source_authority, operation);
    if (proof.owner_repo !== target.name || intakeDigest(proof.provider_repository) !== intakeDigest(custody.binding)) {
      throw new HttpError(409, "instance_records_source_identity_changed", "The internal source owner differs from its current repository connection.");
    }
    return { ...proof, custody_receipt_digest: custody.digest, custody_evidence_refs: custody.evidence_refs };
  }
  return { proposedSourceOwner: input => read(input, "bootstrap"), verificationSourceOwner: input => read(input, "configure-verification") };
}
