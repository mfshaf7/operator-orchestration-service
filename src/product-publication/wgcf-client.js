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
    const lifecycle = readiness.inventory_lifecycle_binding;
    const lifecycleSemanticsMismatch =
      (evaluation.request.action === "archive" &&
        (lifecycle?.action !== "retire" || lifecycle?.after?.posture !== "retired")) ||
      (evaluation.request.action === "restore" &&
        (lifecycle?.action !== "restore" || lifecycle?.after?.posture !== "active"));
    const lifecycleMismatch = evaluation.schema_version === 2 && (
      readiness.schema_version !== 2 ||
      readiness.action !== evaluation.request.action ||
      readiness.current_publication_posture !== evaluation.request.current_publication_posture ||
      !same(readiness.previous_receipt, evaluation.request.previous_receipt) ||
      !readiness.authority_binding.history_digest ||
      !readiness.inventory_lifecycle_binding ||
      lifecycleSemanticsMismatch
    );
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
      lifecycleMismatch ||
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
    async prepare(productId) {
      const body = await transport.request(`/v1/product-publication/preparations/${encodeURIComponent(productId)}`, { method: "GET" });
      const locator = body?.manifest_source;
      const validLocator = locator && /^[a-z0-9][a-z0-9-]*$/.test(locator.repo)
        && typeof locator.path === "string" && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/.test(locator.path)
        && /^[a-f0-9]{40}$/.test(locator.source_revision) && /^[a-f0-9]{40}$/.test(locator.manifest_revision)
        && /^sha256:[a-f0-9]{64}$/.test(locator.manifest_digest);
      if (body?.schema_version !== 1 || body.product_id !== productId
        || !["prepared", "blocked"].includes(body.status)
        || !/^[a-f0-9]{40}$/.test(body.authority_revision)
        || body.issuer?.implementation_ref !== implementationRef || body.issuer?.service_identity_ref !== serviceIdentityRef
        || body.publication_authority_granted !== false
        || !Array.isArray(body.owner_repos) || body.owner_repos.length > 8
        || body.owner_repos.some(owner => typeof owner !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(owner))
        || !Array.isArray(body.issues) || body.issues.length > 8
        || body.issues.some(issue => typeof issue?.code !== "string" || typeof issue?.message !== "string" || issue.message.length > 1024)
        || !Number.isFinite(Date.parse(body.prepared_at)) || !Number.isFinite(Date.parse(body.expires_at))
        || Date.parse(body.prepared_at) > clock().getTime() + 30_000
        || Date.parse(body.expires_at) <= clock().getTime()
        || Date.parse(body.expires_at) <= Date.parse(body.prepared_at)
        || Date.parse(body.expires_at) - Date.parse(body.prepared_at) > 120_000
        || (body.status === "prepared" && (!validLocator || ![1, 2].includes(body.manifest_schema_version) || body.issues.length || !body.owner_repos.includes(locator.repo)
          || !["unlisted", "internal", "client", "public", "archived"].includes(body.manifest_publication_posture)))
        || (body.status === "blocked" && (locator !== null || body.manifest_schema_version !== null || !body.issues.length))) {
        throw productPublicationError("preparation_invalid", "Publication information could not be verified. Load it again.", 502);
      }
      return { schema_version: 1, product_id: body.product_id, status: body.status,
        authority_revision: body.authority_revision, manifest_source: locator ? {
          repo: locator.repo, path: locator.path, source_revision: locator.source_revision,
          manifest_revision: locator.manifest_revision, manifest_digest: locator.manifest_digest,
        } : null, manifest_schema_version: body.manifest_schema_version,
        manifest_publication_posture: body.manifest_publication_posture ?? null,
        owner_repos: body.owner_repos, issues: body.issues.map(issue => ({ code: issue.code, message: issue.message })),
        prepared_at: body.prepared_at, expires_at: body.expires_at,
        issuer: { implementation_ref: implementationRef, service_identity_ref: serviceIdentityRef },
        publication_authority_granted: false };
    },
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
