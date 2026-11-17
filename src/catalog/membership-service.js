import { HttpError } from "../errors.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { CatalogUpstreamError } from "./http-client.js";

const keys = ["request_id", "operation", "principal_id", "membership_id", "role_ids", "expected_version"].sort().join();
export function assertMembershipCommand(value) {
  const invalid = () => { throw new HttpError(400, "membership_request_invalid", "Review a user or group and its current project roles before submitting."); };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys ||
      typeof value.request_id !== "string" || !/^[A-Za-z0-9_.:@-]{1,160}$/.test(value.request_id) ||
      !["add", "change", "remove"].includes(value.operation) || !Number.isSafeInteger(value.principal_id) || value.principal_id <= 0 ||
      !Array.isArray(value.role_ids) || value.role_ids.length > 20 || new Set(value.role_ids).size !== value.role_ids.length ||
      value.role_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) invalid();
  if (value.operation === "add" ? value.membership_id !== null || value.expected_version !== null :
      !Number.isSafeInteger(value.membership_id) || value.membership_id <= 0 || !/^sha256:[a-f0-9]{64}$/.test(value.expected_version ?? "")) invalid();
  if (value.operation === "remove" ? value.role_ids.length !== 0 : value.role_ids.length === 0) invalid();
  return value;
}
function assertOutcome(result, context, accepted = null) {
  const { receipt, replayed: _replayed, ...body } = result ?? {};
  if (result?.schema_version !== 1 || result.project_identifier !== "workspace-delivery-art" || result.status !== "applied" || result.caller_id !== context.caller_id ||
      result.operator_id !== context.operator_id || !Number.isSafeInteger(result.project_id) || result.project_id <= 0 ||
      !result.principal || !Array.isArray(result.after?.role_ids ?? []) || typeof result.applied_at !== "string" || !Number.isFinite(Date.parse(result.applied_at)) ||
      !/^openproject:\/\/delivery-memberships\/receipts\/[a-f0-9]{64}$/.test(receipt?.ref ?? "") ||
      receipt.digest !== canonicalDigest({ ...body, replayed: false }) ||
      accepted && (result.request_digest !== canonicalDigest(accepted) || result.request_id !== accepted.request_id ||
        result.operation !== accepted.operation || result.principal.id !== accepted.principal_id ||
        (accepted.operation === "remove" ? result.after !== null : JSON.stringify([...result.after.role_ids].sort((a,b)=>a-b)) !== JSON.stringify([...accepted.role_ids].sort((a,b)=>a-b))))) {
    throw new HttpError(502, "membership_readback_invalid", "The membership outcome could not be verified. Retry the same decision to recover its receipt.");
  }
  return result;
}
export function createMembershipService({ backendClient, audit }) {
  async function upstream(operation) {
    try { return await operation(); } catch (error) {
      if (error instanceof CatalogUpstreamError) throw new HttpError(error.statusCode, error.code, error.message);
      throw error;
    }
  }
  return {
    async project({ callerId, operatorId, query = {} }) {
      const context = { caller_id: callerId, operator_id: operatorId };
      if (Object.keys(query).some(key => !["page", "page_size", "search", "candidate_search"].includes(key)) ||
          Object.values(query).some(value => typeof value !== "string" || value.length > 200)) throw new HttpError(400, "membership_query_invalid", "Use the supported member search and pagination controls.");
      const result = await upstream(() => backendClient.projectMemberships(context, query));
      if (result?.schema_version !== 1 || result.project_identifier !== "workspace-delivery-art" || !Number.isSafeInteger(result.project_id) || !Array.isArray(result.members) ||
          !Array.isArray(result.candidates) || !Array.isArray(result.roles) || !Array.isArray(result.recent_outcomes) ||
          result.members.length > 100 || result.candidates.length > 100 || ![25,50,100].includes(result.page_size) ||
          !Number.isSafeInteger(result.total) || result.total < 0) throw new HttpError(502, "membership_projection_invalid", "Current project members could not be read safely.");
      result.recent_outcomes.forEach(outcome => assertOutcome(outcome, context));
      return result;
    },
    async mutate({ callerId, operatorId, command }) {
      const accepted = { ...assertMembershipCommand(command), caller_id: callerId, operator_id: operatorId };
      const result = assertOutcome(await upstream(() => backendClient.mutateMembership(accepted)), accepted, accepted);
      audit?.emit({ event_type: result.replayed ? "delivery.membership.replayed" : "delivery.membership.applied",
        actor: callerId, operator_id: operatorId, correlation_id: accepted.request_id, operation: accepted.operation,
        project_id: result.project_id, principal_id: result.principal.id, receipt_ref: result.receipt.ref });
      return result;
    },
  };
}
