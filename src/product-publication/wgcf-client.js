import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertProductPublicationContract,
  productPublicationDigest,
  productPublicationError,
  productPublicationStringify,
} from "./contracts.js";

function same(left, right) {
  return productPublicationDigest(left) === productPublicationDigest(right);
}

export function createWgcfProductPublicationClient({
  baseUrl,
  callerId,
  callerSecret,
  implementationRef,
  serviceIdentityRef,
  clock = () => new Date(),
  fetchImpl,
}) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    fetchImpl,
    configNames: {
      baseUrl: "WGCF_PRODUCT_PUBLICATION_BASE_URL",
      callerId: "WGCF_PRODUCT_PUBLICATION_CALLER_ID",
      callerSecret: "WGCF_PRODUCT_PUBLICATION_CALLER_SECRET",
    },
    errorPrefix: "product_publication_readiness",
    label: "WGCF Product Publication",
    maxResponseBytes: 262144,
    statusDetailKey: "readiness_status",
  });

  function validate(body, evaluation) {
    const readiness = assertProductPublicationContract(
      "readiness.schema.json",
      body?.readiness,
    );
    if (readiness.readiness_digest !== productPublicationDigest(readiness, "readiness_digest")) {
      throw productPublicationError("readiness_digest_invalid", "WGCF readiness digest is invalid.", 502);
    }
    const expectedUri = `wgcf://product-publication/readiness-receipts/${readiness.readiness_digest.slice(7)}`;
    if (
      readiness.request_ref.id !== evaluation.request.request_id ||
      readiness.request_ref.digest !== evaluation.request.request_digest ||
      readiness.request_ref.idempotency_key !== evaluation.request.idempotency_key ||
      readiness.authority_binding.revision !== evaluation.authority_revision ||
      readiness.manifest_binding.manifest_digest !== evaluation.manifest_source.manifest_digest ||
      readiness.manifest_binding.owner_repo !== evaluation.manifest_source.repo ||
      readiness.manifest_binding.owner_revision !== evaluation.manifest_source.source_revision ||
      readiness.manifest_binding.manifest_revision !== evaluation.manifest_source.manifest_revision ||
      readiness.manifest_binding.path !== evaluation.manifest_source.path ||
      !same(readiness.target_publication, evaluation.request.target_publication) ||
      body.ledger?.ref?.uri !== expectedUri ||
      body.ledger?.ref?.digest !== readiness.readiness_digest ||
      body.ledger?.authority_revision !== evaluation.authority_revision ||
      body.ledger?.contract_digest !== readiness.authority_binding.contract_digest ||
      body.ledger?.implementation_ref !== implementationRef ||
      body.ledger?.service_identity_ref !== serviceIdentityRef ||
      body.ledger?.expires_at !== readiness.expires_at ||
      !["durable", "expired"].includes(body.ledger?.state)
    ) {
      throw productPublicationError(
        "readiness_mismatch",
        "WGCF readiness does not bind the exact configured issuer, manifest, and request.",
        502,
      );
    }
    if (body.ledger.state === "expired" || Date.parse(body.ledger.expires_at) <= clock().getTime()) {
      throw productPublicationError("readiness_expired", "Product Publication readiness expired before journaling.");
    }
    return body;
  }

  return {
    async evaluate(evaluation) {
      const issued = validate(
        await transport.request("/v1/readiness/product-publication", {
          method: "POST",
          body: productPublicationStringify(evaluation),
        }),
        evaluation,
      );
      const token = issued.readiness.readiness_digest.slice(7);
      const read = validate(
        await transport.request(`/v1/readiness/product-publication/${token}`, { method: "GET" }),
        evaluation,
      );
      if (
        !["created", "reused", "replayed"].includes(issued.ledger.resolution) ||
        read.ledger.resolution !== "read" ||
        issued.readiness.readiness_digest !== read.readiness.readiness_digest
      ) {
        throw productPublicationError(
          "readiness_changed",
          "WGCF readiness issue and durable readback disagree.",
          502,
        );
      }
      return read;
    },
  };
}
