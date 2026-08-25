import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertRepositoryReadinessReference } from "./contracts.js";

const RECEIPT_URI_PATTERN =
  /^wgcf:\/\/receipts\/repository-readiness\/repository-readiness-receipt-([0-9a-f]{24})-([0-9a-f]{64})\.json$/;
const MAX_RESPONSE_BYTES = 393_216;

function invalidResponse(message) {
  return new HttpError(502, "repository_readiness_blocked", message);
}

function receiptToken(reference) {
  const match = String(reference?.receipt?.uri ?? "").match(RECEIPT_URI_PATTERN);
  if (!match || reference.receipt.digest !== `sha256:${match[2]}`) {
    throw new HttpError(
      400,
      "repository_readiness_stale",
      "Repository readiness reference is not content-addressed.",
    );
  }
  return match[1];
}

function assertLedgerEnvelope(body, expectedReference) {
  const receipt = body?.receipt;
  const ledger = body?.ledger;
  const reference = body?.repository_readiness_reference;
  if (
    !receipt || !ledger || !reference ||
    receipt.artifact_type !== "repository_readiness_receipt" ||
    receipt.decision?.outcome !== "ready" ||
    receipt.decision?.linking_allowed !== true ||
    receipt.decision?.mutation_authority !== "none" ||
    receipt.custody?.state !== "durable" ||
    ledger.state !== "durable" ||
    ledger.ref?.uri !== receipt.custody?.uri ||
    ledger.ref?.digest !== receipt.integrity?.content_digest
  ) {
    throw invalidResponse("WGCF returned an incomplete repository-readiness decision.");
  }
  try {
    assertRepositoryReadinessReference(reference);
  } catch {
    throw invalidResponse("WGCF returned an invalid repository-readiness reference.");
  }
  if (
    reference.repo_name !== expectedReference.repo_name ||
    reference.repo_ref !== expectedReference.repo_ref ||
    reference.catalog_value_key !== expectedReference.catalog_value_key ||
    reference.receipt.uri !== expectedReference.receipt.uri ||
    reference.receipt.digest !== expectedReference.receipt.digest ||
    receipt.subject?.owner_repo !== expectedReference.repo_name ||
    receipt.authority?.record_digest === undefined
  ) {
    throw new HttpError(
      409,
      "repository_readiness_stale",
      "WGCF repository-readiness evidence does not match the requested repository.",
    );
  }
  return { receipt, reference };
}

export function createWgcfRepositoryReadinessClient({
  baseUrl,
  callerId = "operator-orchestration-service",
  callerSecret,
  fetchImpl = globalThis.fetch,
}) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    configNames: {
      baseUrl: "WGCF_REPOSITORY_READINESS_BASE_URL",
      callerId: "WGCF_REPOSITORY_READINESS_CALLER_ID",
      callerSecret: "WGCF_REPOSITORY_READINESS_CALLER_SECRET",
    },
    errorPrefix: "repository_readiness",
    fetchImpl,
    label: "WGCF repository readiness",
    maxResponseBytes: MAX_RESPONSE_BYTES,
    statusDetailKey: "repository_readiness_status",
  });

  return {
    async verifyCurrent(input) {
      const expectedReference = assertRepositoryReadinessReference(input);
      const current = assertLedgerEnvelope(
        await transport.request(`/v1/readiness/repositories/${receiptToken(expectedReference)}`, {
          method: "GET",
        }),
        expectedReference,
      );
      const refreshed = assertLedgerEnvelope(
        await transport.request("/v1/readiness/repositories", {
          body: canonicalStringify({
            schema_version: 1,
            profile_id: "dev-integration",
            policy_scope: "delivery-catalog-owner-repo",
            repo_name: current.receipt.subject.repo_name,
            repo_ref: current.receipt.subject.repo_ref,
            expected_owner_repo: current.receipt.subject.owner_repo,
            catalog_value_key: current.receipt.subject.catalog_value_key,
            expected_authority_digest: current.receipt.authority.record_digest,
          }),
          method: "POST",
        }),
        expectedReference,
      );
      return refreshed.reference;
    },
  };
}
