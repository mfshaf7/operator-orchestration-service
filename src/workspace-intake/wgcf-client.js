import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertIntake, intakeDigest, intakeError, intakeReference, intakeStringify } from "./contracts.js";

export function createWgcfWorkspaceIntakeClient({ baseUrl, callerId, callerSecret, implementationRef, serviceIdentityRef, fetchImpl }) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl, callerId, callerSecret, fetchImpl,
    configNames: { baseUrl: "WGCF_WORKSPACE_INTAKE_BASE_URL", callerId: "WGCF_WORKSPACE_INTAKE_CALLER_ID", callerSecret: "WGCF_WORKSPACE_INTAKE_CALLER_SECRET" },
    errorPrefix: "workspace_intake_readiness", label: "WGCF Workspace Intake", maxResponseBytes: 131072, statusDetailKey: "readiness_status",
  });
  function validate(body, evaluation) {
    const receipt = assertIntake("readiness", body?.receipt);
    const token = receipt.receipt_digest.slice(7);
    if (receipt.evaluation_id !== evaluation.evaluation_id || receipt.evaluation_digest !== evaluation.evaluation_digest ||
        receipt.session_ref !== evaluation.session_ref || receipt.execution_ref !== evaluation.execution_ref ||
        receipt.authority.revision !== evaluation.authority_revision ||
        intakeDigest(receipt.request_ref) !== intakeDigest(intakeReference(evaluation.request, "request")) ||
        intakeDigest(receipt.decision_ref) !== intakeDigest(intakeReference(evaluation.decision, "decision")) ||
        receipt.issuer.caller_id !== callerId || receipt.issuer.implementation_ref !== implementationRef || receipt.issuer.service_identity_ref !== serviceIdentityRef ||
        body.ledger?.state !== "durable" || body.ledger.ref?.digest !== receipt.receipt_digest ||
        body.ledger.ref?.uri !== `wgcf://readiness/workspace-intake/${token}`) {
      throw intakeError("readiness_mismatch", "Readiness did not bind the configured issuer and exact evaluation.", 502);
    }
    return body;
  }
  return {
    async evaluate(evaluation) {
      const issued = validate(await transport.request("/v1/readiness/workspace-intake", { method: "POST", body: intakeStringify(evaluation) }), evaluation);
      const read = validate(await transport.request(`/v1/readiness/workspace-intake/${issued.receipt.receipt_digest.slice(7)}`, { method: "GET" }), evaluation);
      if (!["created", "reused"].includes(issued.ledger.resolution) || read.ledger.resolution !== "read" || read.receipt.receipt_digest !== issued.receipt.receipt_digest) {
        throw intakeError("readiness_changed", "Readiness issue and durable readback disagree.", 502);
      }
      return read;
    },
  };
}
