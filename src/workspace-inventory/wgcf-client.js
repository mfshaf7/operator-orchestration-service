import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import {
  assertInventory,
  inventoryDigest,
  inventoryError,
  inventoryReference,
  inventoryStringify,
} from "./contracts.js";

export function createWgcfWorkspaceInventoryClient({ baseUrl, callerId, callerSecret, fetchImpl }) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    fetchImpl,
    configNames: {
      baseUrl: "WGCF_WORKSPACE_INVENTORY_BASE_URL",
      callerId: "WGCF_WORKSPACE_INVENTORY_CALLER_ID",
      callerSecret: "WGCF_WORKSPACE_INVENTORY_CALLER_SECRET",
    },
    errorPrefix: "workspace_inventory_readiness",
    label: "WGCF Workspace Inventory",
    maxResponseBytes: 131072,
    statusDetailKey: "readiness_status",
  });

  function validate(body, evaluation) {
    const readiness = assertInventory("readiness", body?.readiness);
    const token = readiness.readiness_digest.slice(7);
    if (
      inventoryDigest(readiness.request_ref) !== inventoryDigest(inventoryReference(evaluation.request, "request")) ||
      inventoryDigest(readiness.target) !== inventoryDigest(evaluation.request.target) ||
      inventoryDigest(readiness.observed_state) !== inventoryDigest(evaluation.request.expected_state) ||
      readiness.policy_ref.id !== `workspace-active-inventory@${evaluation.authority_revision}` ||
      body.ledger?.state !== "durable" ||
      body.ledger.ref?.digest !== readiness.readiness_digest ||
      body.ledger.ref?.uri !== `wgcf://readiness/workspace-inventory/${token}`
    ) {
      throw inventoryError("readiness_mismatch", "Readiness did not bind the exact promotion and canonical source state.", 502);
    }
    return body;
  }

  return {
    async evaluate(evaluation) {
      const issued = validate(await transport.request("/v1/readiness/workspace-inventory", {
        method: "POST",
        body: inventoryStringify(evaluation),
      }), evaluation);
      const token = issued.readiness.readiness_digest.slice(7);
      const read = validate(await transport.request(`/v1/readiness/workspace-inventory/${token}`, { method: "GET" }), evaluation);
      if (!["created", "reused"].includes(issued.ledger.resolution) || read.ledger.resolution !== "read" ||
          read.readiness.readiness_digest !== issued.readiness.readiness_digest) {
        throw inventoryError("readiness_changed", "Readiness issue and durable readback disagree.", 502);
      }
      return read;
    },
  };
}

export function createWgcfWorkspaceInventoryLifecycleClient({ baseUrl, callerId, callerSecret, fetchImpl }) {
  const transport = createWgcfAuthenticatedJsonTransport({
    baseUrl,
    callerId,
    callerSecret,
    fetchImpl,
    configNames: {
      baseUrl: "WGCF_WORKSPACE_INVENTORY_BASE_URL",
      callerId: "WGCF_WORKSPACE_INVENTORY_CALLER_ID",
      callerSecret: "WGCF_WORKSPACE_INVENTORY_CALLER_SECRET",
    },
    errorPrefix: "workspace_inventory_lifecycle_readiness",
    label: "WGCF Workspace Inventory lifecycle",
    maxResponseBytes: 131072,
    statusDetailKey: "readiness_status",
  });

  function validate(body, evaluation) {
    const readiness = assertInventory("lifecycle-readiness", body?.readiness);
    const token = readiness.readiness_digest.slice(7);
    if (
      inventoryDigest(readiness.request_ref) !== inventoryDigest(inventoryReference(evaluation.request, "request")) ||
      inventoryDigest(readiness.target) !== inventoryDigest(evaluation.request.target) ||
      readiness.action !== evaluation.request.action ||
      inventoryDigest(readiness.observed_state) !== inventoryDigest(evaluation.request.expected_state) ||
      readiness.policy_ref.id !== `workspace-inventory-lifecycle@${evaluation.authority_revision}` ||
      body.ledger?.state !== "durable" ||
      body.ledger.ref?.digest !== readiness.readiness_digest ||
      body.ledger.ref?.uri !== `wgcf://readiness/workspace-inventory-lifecycle/${token}`
    ) {
      throw inventoryError("lifecycle_readiness_mismatch", "Readiness did not bind the exact lifecycle request and canonical source state.", 502);
    }
    return body;
  }

  return {
    async evaluate(evaluation) {
      const route = "/v1/readiness/workspace-inventory-lifecycle";
      const issued = validate(await transport.request(route, {
        method: "POST",
        body: inventoryStringify(evaluation),
      }), evaluation);
      const token = issued.readiness.readiness_digest.slice(7);
      const read = validate(await transport.request(`${route}/${token}`, { method: "GET" }), evaluation);
      if (!["created", "reused"].includes(issued.ledger.resolution) || read.ledger.resolution !== "read" ||
          read.readiness.readiness_digest !== issued.readiness.readiness_digest) {
        throw inventoryError("lifecycle_readiness_changed", "Lifecycle readiness issue and durable readback disagree.", 502);
      }
      return read;
    },
  };
}
