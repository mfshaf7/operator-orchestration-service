import { HttpError } from "../errors.js";
import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertRepositoryCustodyDecision,
  assertRepositoryCustodyRequest,
  repositoryCustodyAuthority,
} from "./contracts.js";

const DECISION_ID = /^repository-custody-decision:([0-9a-f]{24})$/;

function blocked(message, statusCode = 502) {
  return new HttpError(statusCode, "repository_custody_readiness_invalid", message);
}

function assertEnvelope(body, request) {
  const decision = assertRepositoryCustodyDecision(body?.decision);
  const ledger = body?.ledger;
  const match = decision.decision_id.match(DECISION_ID);
  const authority = repositoryCustodyAuthority();
  if (
    !match ||
    !ledger ||
    ledger.state !== "durable" ||
    ledger.ref?.digest !== decision.integrity.content_digest ||
    decision.request_ref.digest !== request.request_digest ||
    decision.policy_version !== authority.version
  ) {
    throw blocked("WGCF returned an incomplete or mismatched custody decision.");
  }
  return {
    decision,
    decisionRef: { uri: ledger.ref.uri, digest: ledger.ref.digest },
    resolution: ledger.resolution,
    token: match[1],
  };
}

export function createWgcfRepositoryCustodyClient({
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
      baseUrl: "WGCF_REPOSITORY_CUSTODY_BASE_URL",
      callerId: "WGCF_REPOSITORY_CUSTODY_CALLER_ID",
      callerSecret: "WGCF_REPOSITORY_CUSTODY_CALLER_SECRET",
    },
    errorPrefix: "repository_custody_readiness",
    fetchImpl,
    label: "WGCF repository custody readiness",
    maxResponseBytes: 262_144,
    statusDetailKey: "repository_custody_readiness_status",
  });

  return {
    async evaluate(input) {
      const request = assertRepositoryCustodyRequest(input);
      const issued = assertEnvelope(
        await transport.request("/v1/readiness/repository-custody", {
          body: canonicalStringify(request),
          method: "POST",
        }),
        request,
      );
      const current = assertEnvelope(
        await transport.request(
          `/v1/readiness/repository-custody/${issued.token}`,
          { method: "GET" },
        ),
        request,
      );
      if (
        !["created", "reused"].includes(issued.resolution) ||
        current.resolution !== "read" ||
        current.decision.integrity.content_digest !== issued.decision.integrity.content_digest ||
        current.decisionRef.uri !== issued.decisionRef.uri
      ) {
        throw blocked("WGCF custody decision changed between issue and readback.", 409);
      }
      return current;
    },
  };
}
