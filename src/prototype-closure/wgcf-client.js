import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertClosureReadiness, closureCanonicalJson, closureError } from "./contracts.js";

export function createWgcfPrototypeClosureClient({
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
      baseUrl: "WGCF_PROTOTYPE_CLOSURE_BASE_URL",
      callerId: "WGCF_PROTOTYPE_CLOSURE_CALLER_ID",
      callerSecret: "WGCF_PROTOTYPE_CLOSURE_CALLER_SECRET",
    },
    errorPrefix: "prototype_closure_readiness",
    label: "WGCF Prototype Closure",
    maxResponseBytes: 262144,
    statusDetailKey: "readiness_status",
  });

  return {
    async evaluate(evaluation) {
      const issued = assertClosureReadiness(
        await transport.request("/v1/readiness/prototype-closure", {
          method: "POST",
          body: closureCanonicalJson(evaluation),
        }),
        evaluation,
        { implementationRef, serviceIdentityRef, now: clock() },
      );
      const token = issued.readiness.readiness_digest.slice(7);
      const read = assertClosureReadiness(
        await transport.request(`/v1/readiness/prototype-closure/${token}`, { method: "GET" }),
        evaluation,
        { implementationRef, serviceIdentityRef, now: clock() },
      );
      if (
        !["created", "reused"].includes(issued.ledger.resolution) ||
        read.ledger.resolution !== "read" ||
        read.readiness.readiness_digest !== issued.readiness.readiness_digest
      ) {
        throw closureError("readiness_changed", "Closure readiness issue and durable readback disagree.", 502);
      }
      return read;
    },
  };
}
