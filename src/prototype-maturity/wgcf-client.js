import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertPrototypeMaturityArtifact,
  prototypeMaturityDigest,
  prototypeMaturityError,
  prototypeMaturityReference,
  prototypeMaturityStringify,
} from "./contracts.js";

export function createWgcfPrototypeMaturityClient({
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
      baseUrl: "WGCF_PROTOTYPE_MATURITY_BASE_URL",
      callerId: "WGCF_PROTOTYPE_MATURITY_CALLER_ID",
      callerSecret: "WGCF_PROTOTYPE_MATURITY_CALLER_SECRET",
    },
    errorPrefix: "prototype_maturity_readiness",
    label: "WGCF Prototype Maturity",
    maxResponseBytes: 262144,
    statusDetailKey: "readiness_status",
  });

  function validate(body, evaluation) {
    const readiness = assertPrototypeMaturityArtifact(body?.readiness);
    const token = readiness.readiness_digest.slice(7);
    if (
      prototypeMaturityDigest(readiness.request_ref) !==
        prototypeMaturityDigest(prototypeMaturityReference(evaluation.request)) ||
      prototypeMaturityDigest(readiness.packet_ref) !==
        prototypeMaturityDigest(prototypeMaturityReference(evaluation.packet)) ||
      readiness.prototype_id !== evaluation.request.prototype_id ||
      readiness.transition !== evaluation.request.transition ||
      prototypeMaturityDigest(readiness.observed_state) !==
        prototypeMaturityDigest(evaluation.request.expected_state) ||
      body.ledger?.ref?.uri !== `wgcf://readiness/prototype-maturity/${token}` ||
      body.ledger?.ref?.digest !== readiness.readiness_digest ||
      body.ledger?.authority_revision !== evaluation.authority_revision ||
      body.ledger?.implementation_ref !== implementationRef ||
      body.ledger?.service_identity_ref !== serviceIdentityRef ||
      !["durable", "expired"].includes(body.ledger?.state)
    ) {
      throw prototypeMaturityError(
        "readiness_mismatch",
        "Readiness does not bind the configured issuer and exact maturity evaluation.",
        502,
      );
    }
    if (
      body.ledger.state === "expired" ||
      Date.parse(body.ledger.expires_at) <= clock().getTime()
    ) {
      throw prototypeMaturityError(
        "readiness_expired",
        "Prototype Maturity readiness expired before operator decision.",
      );
    }
    return body;
  }

  return {
    async evaluate(evaluation) {
      const issued = validate(
        await transport.request("/v1/readiness/prototype-maturity", {
          method: "POST",
          body: prototypeMaturityStringify(evaluation),
        }),
        evaluation,
      );
      const token = issued.readiness.readiness_digest.slice(7);
      const read = validate(
        await transport.request(`/v1/readiness/prototype-maturity/${token}`, {
          method: "GET",
        }),
        evaluation,
      );
      if (
        !["created", "reused"].includes(issued.ledger.resolution) ||
        read.ledger.resolution !== "read" ||
        issued.readiness.readiness_digest !== read.readiness.readiness_digest
      ) {
        throw prototypeMaturityError(
          "readiness_changed",
          "Readiness issue and durable readback disagree.",
          502,
        );
      }
      return read;
    },
  };
}
