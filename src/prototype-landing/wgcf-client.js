import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertPrototypeLandingArtifact,
  prototypeLandingDigest,
  prototypeLandingError,
  prototypeLandingReference,
  prototypeLandingStringify,
} from "./contracts.js";

export function createWgcfPrototypeLandingClient({ baseUrl, callerId, callerSecret, implementationRef, serviceIdentityRef, clock = () => new Date(), fetchImpl }) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    fetchImpl,
    configNames: {
      baseUrl: "WGCF_PROTOTYPE_LANDING_BASE_URL",
      callerId: "WGCF_PROTOTYPE_LANDING_CALLER_ID",
      callerSecret: "WGCF_PROTOTYPE_LANDING_CALLER_SECRET",
    },
    errorPrefix: "prototype_landing_readiness",
    label: "WGCF Prototype Landing",
    maxResponseBytes: 262144,
    statusDetailKey: "readiness_status",
  });

  function validate(body, evaluation) {
    const readiness = assertPrototypeLandingArtifact(body?.readiness);
    const token = readiness.readiness_digest.slice(7);
    if (prototypeLandingDigest(readiness.request_ref) !== prototypeLandingDigest(prototypeLandingReference(evaluation.request)) ||
        prototypeLandingDigest(readiness.plan_ref) !== prototypeLandingDigest(prototypeLandingReference(evaluation.plan)) ||
        body.ledger?.ref?.uri !== `wgcf://readiness/prototype-landing/${token}` ||
        body.ledger?.ref?.digest !== readiness.readiness_digest ||
        body.ledger?.authority_revision !== evaluation.authority_revision ||
        body.ledger?.implementation_ref !== implementationRef ||
        body.ledger?.service_identity_ref !== serviceIdentityRef ||
        !["durable", "expired"].includes(body.ledger?.state)) {
      throw prototypeLandingError("readiness_mismatch", "Readiness does not bind the configured issuer and exact Landing evaluation.", 502);
    }
    if (body.ledger.state === "expired" || Date.parse(body.ledger.expires_at) <= clock().getTime()) {
      throw prototypeLandingError("readiness_expired", "Prototype Landing readiness expired before source preparation.", 409);
    }
    return body;
  }

  return {
    async evaluate(evaluation) {
      const issued = validate(await transport.request("/v1/readiness/prototype-landing", {
        method: "POST",
        body: prototypeLandingStringify(evaluation),
      }), evaluation);
      const token = issued.readiness.readiness_digest.slice(7);
      const read = validate(await transport.request(`/v1/readiness/prototype-landing/${token}`, { method: "GET" }), evaluation);
      if (!["created", "reused"].includes(issued.ledger.resolution) || read.ledger.resolution !== "read" ||
          issued.readiness.readiness_digest !== read.readiness.readiness_digest) {
        throw prototypeLandingError("readiness_changed", "Readiness issue and durable readback disagree.", 502);
      }
      return read;
    },
  };
}
