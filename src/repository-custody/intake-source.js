import {
  assertRepositoryCustodyWorkflowResult, assertRepositoryCustodyRequest,
  assertRepositoryCustodyReceipt, assertRepositoryProviderReadback,
} from "./contracts.js";
import { bindWorkspaceIntakeSourceCandidate } from "../workspace-intake/source-candidate.js";
import { intakeDigest, intakeError } from "../workspace-intake/contracts.js";

const PREFIX = "oos://repository-custody/requests/";

export function custodyRequestFromIntakeSource(source) {
  if (source?.class !== "repository-custody" || !source.ref?.startsWith(PREFIX)) return null;
  const match = /^([^/]+)\/intake\/([0-9a-f]{64})$/.exec(source.ref.slice(PREFIX.length));
  if (!match) throw intakeError("custody_source_invalid", "Repository custody source reference is invalid.", 400);
  try {
    const requestId = decodeURIComponent(match[1]);
    if (!requestId || encodeURIComponent(requestId) !== match[1]) throw new Error();
    return requestId;
  } catch {
    throw intakeError("custody_source_invalid", "Repository custody request identity is invalid.", 400);
  }
}

export function repositoryCustodyIntakeCandidate({ result, target, requestedRecord }) {
  assertRepositoryCustodyWorkflowResult(result);
  assertRepositoryCustodyRequest(result.request);
  if (result.receipt) assertRepositoryCustodyReceipt(result.receipt);
  if (result.provider_readback) assertRepositoryProviderReadback(result.provider_readback);
  const readback = result.provider_readback;
  if (result.status !== "succeeded" || result.receipt?.outcome !== "succeeded" || !readback ||
      result.receipt_ref?.digest !== result.receipt.integrity.content_digest ||
      result.provider_readback_ref?.digest !== readback.integrity.content_digest ||
      result.receipt.provider_readback_ref?.digest !== readback.integrity.content_digest ||
      result.receipt.request_ref?.digest !== result.request.request_digest ||
      readback.request_ref?.digest !== result.request.request_digest ||
      intakeDigest(result.receipt.repository_identity) !== intakeDigest(readback.repository_identity) ||
      readback.provider_lifecycle_state !== "active") {
    throw intakeError("custody_source_unavailable", "A successful canonical custody receipt and active provider readback are required.");
  }
  if (target.kind !== "repo" || target.record_id !== result.request.requested_custody.workspace_owner_ref ||
      target.record_id !== `repo:${target.name}` || requestedRecord?.kind !== "repo") {
    throw intakeError("custody_source_mismatch", "Intake target must match the custody request's selected workspace owner.");
  }
  const binding = { ...readback.repository_identity,
    full_name: `${readback.canonical_owner}/${readback.canonical_name}` };
  if (requestedRecord.provider_repository !== undefined &&
      intakeDigest(requestedRecord.provider_repository) !== intakeDigest(binding)) {
    throw intakeError("custody_source_mismatch", "Provider coordinates are derived from custody, not selected by the caller.");
  }
  const record = { ...structuredClone(requestedRecord), provider_repository: binding };
  const selector = intakeDigest({ target, requested_record: record }).slice(7);
  return bindWorkspaceIntakeSourceCandidate({
    schema_version: 1, artifact_type: "workspace-intake-source-candidate",
    source: { class: "repository-custody", digest: result.receipt.integrity.content_digest,
      ref: `${PREFIX}${encodeURIComponent(result.request.request_id)}/intake/${selector}` },
    target, requested_record: record,
    evidence_refs: [result.receipt_ref.uri, result.provider_readback_ref.uri],
  });
}
