import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertRepositoryReadinessReference } from "./contracts.js";

const RECEIPT_URI_PATTERN =
  /^wgcf:\/\/receipts\/repository-readiness\/repository-readiness-receipt-([0-9a-f]{24})-([0-9a-f]{64})\.json$/;
const MAX_RESPONSE_BYTES = 393_216;
const REPO_NAME = /^[a-z0-9][a-z0-9-]*$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

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

function assertAuthorityRequest(value) {
  if (
    !value ||
    !REPO_NAME.test(value.repo_name) ||
    value.repo_ref !== `repo://${value.repo_name}` ||
    value.expected_owner_repo !== value.repo_name ||
    value.catalog_value_key !== value.repo_name ||
    !DIGEST.test(value.expected_authority_digest)
  ) {
    throw invalidResponse("Workspace Inventory returned an invalid repository authority binding.");
  }
  return value;
}

function assertLedgerEnvelope(body, expectedIdentity) {
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
    ledger.ref?.digest !== receipt.integrity?.content_digest ||
    reference?.receipt?.receipt_id !== receipt.receipt_id ||
    reference?.receipt?.uri !== receipt.custody?.uri ||
    reference?.receipt?.digest !== receipt.integrity?.content_digest ||
    reference?.receipt?.generation !== receipt.generation ||
    reference?.receipt?.evaluated_at !== receipt.decision?.evaluated_at
  ) {
    throw invalidResponse("WGCF returned an incomplete repository-readiness decision.");
  }
  try {
    assertRepositoryReadinessReference(reference);
  } catch {
    throw invalidResponse("WGCF returned an invalid repository-readiness reference.");
  }
  if (
    reference.repo_name !== expectedIdentity.repo_name ||
    reference.repo_ref !== expectedIdentity.repo_ref ||
    reference.catalog_value_key !== expectedIdentity.catalog_value_key ||
    receipt.subject?.repo_name !== expectedIdentity.repo_name ||
    receipt.subject?.repo_ref !== expectedIdentity.repo_ref ||
    receipt.subject?.owner_repo !==
      (expectedIdentity.expected_owner_repo ?? expectedIdentity.repo_name) ||
    receipt.subject?.catalog_value_key !== expectedIdentity.catalog_value_key ||
    receipt.subject?.target_scope !== `repo:${expectedIdentity.repo_name}` ||
    (expectedIdentity.expected_authority_digest &&
      receipt.authority?.record_digest !== expectedIdentity.expected_authority_digest) ||
    (expectedIdentity.receipt &&
      (reference.receipt.uri !== expectedIdentity.receipt.uri ||
        reference.receipt.digest !== expectedIdentity.receipt.digest))
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
    async issueCurrent(input) {
      const authority = assertAuthorityRequest(input);
      const issued = assertLedgerEnvelope(
        await transport.request("/v1/readiness/repositories", {
          body: canonicalStringify({
            schema_version: 1,
            profile_id: "dev-integration",
            policy_scope: "delivery-catalog-owner-repo",
            repo_name: authority.repo_name,
            repo_ref: authority.repo_ref,
            expected_owner_repo: authority.expected_owner_repo,
            catalog_value_key: authority.catalog_value_key,
            expected_authority_digest: authority.expected_authority_digest,
          }),
          method: "POST",
        }),
        authority,
      );
      return issued.reference;
    },

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
        {
          ...expectedReference,
          expected_authority_digest: current.receipt.authority.record_digest,
        },
      );
      return refreshed.reference;
    },
  };
}
