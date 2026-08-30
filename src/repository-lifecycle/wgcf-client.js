import { canonicalStringify } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertRepositoryLifecycleDecision,
  assertRepositoryLifecycleRequest,
  repositoryLifecycleAuthority,
} from "./contracts.js";

const DECISION_ID = /^repository-lifecycle-decision:([0-9a-f]{24})$/;

function invalid(message, statusCode = 502) {
  return new HttpError(statusCode, "repository_lifecycle_readiness_invalid", message);
}

function assertEnvelope(body, request) {
  const decision = assertRepositoryLifecycleDecision(body?.decision);
  const ledger = body?.ledger;
  const match = decision.decision_id.match(DECISION_ID);
  if (
    !match ||
    !ledger ||
    ledger.state !== "durable" ||
    ledger.ref?.digest !== decision.integrity.content_digest ||
    decision.request_ref.digest !== request.request_digest ||
    decision.policy_version !== repositoryLifecycleAuthority().version
  ) {
    throw invalid("WGCF returned an incomplete or mismatched lifecycle decision.");
  }
  return {
    decision,
    decisionRef: { uri: ledger.ref.uri, digest: ledger.ref.digest },
    resolution: ledger.resolution,
    token: match[1],
  };
}

export function createWgcfRepositoryLifecycleClient({
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
      baseUrl: "WGCF_REPOSITORY_LIFECYCLE_BASE_URL",
      callerId: "WGCF_REPOSITORY_LIFECYCLE_CALLER_ID",
      callerSecret: "WGCF_REPOSITORY_LIFECYCLE_CALLER_SECRET",
    },
    errorPrefix: "repository_lifecycle_readiness",
    fetchImpl,
    label: "WGCF repository lifecycle readiness",
    maxResponseBytes: 262_144,
    statusDetailKey: "repository_lifecycle_readiness_status",
  });

  return {
    async evaluate(input) {
      const request = assertRepositoryLifecycleRequest(input);
      const issued = assertEnvelope(
        await transport.request("/v1/readiness/repository-lifecycle", {
          body: canonicalStringify(request),
          method: "POST",
        }),
        request,
      );
      const current = assertEnvelope(
        await transport.request(
          `/v1/readiness/repository-lifecycle/${issued.token}`,
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
        throw invalid("WGCF lifecycle decision changed between issue and readback.", 409);
      }
      return current;
    },
  };
}
