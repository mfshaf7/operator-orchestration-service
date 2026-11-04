import { readFileSync } from "node:fs";
import { assertInstanceSourceProof } from "./source-proof.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { HttpError } from "../errors.js";
import { intakeDigest, intakeStringify } from "../workspace-intake/contracts.js";
import { createWgcfAuthenticatedJsonTransport } from "../wgcf-transport.js";
import { assertInstanceIntakeRequest, assertInstanceIntakeDecision, assertInstanceInventoryRequest } from "./contracts.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const receiptSchema = JSON.parse(readFileSync(new URL("../../contracts/instance-records/receipt.schema.json", import.meta.url), "utf8"));
const validateReceipt = ajv.compile(receiptSchema);
const fail = () => { throw new HttpError(502, "instance_records_authority_invalid", "The internal record authority returned an invalid binding."); };
const NAME = /^[a-z0-9][a-z0-9._-]{0,185}$/;
const INSTANCE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const digest = (value, field = null) => {
  try { return intakeDigest(value, field); } catch { return fail(); }
};

function recordResult(value, instanceId, name) {
  if (!exactKeys(value, ["record", "receipt"]) || !value.record || typeof value.record !== "object" || Array.isArray(value.record) ||
      !validateReceipt(value.receipt) || value.receipt.instance_id !== instanceId ||
      value.receipt.record_id !== `repo:${name}` || value.receipt.record_digest !== digest(value.record) ||
      value.receipt.receipt_digest !== digest(value.receipt, "receipt_digest")) fail();
  return structuredClone(value);
}

function intakeResultBinding(value, request, decision, operatorRef, actor = null) {
  const { record, receipt } = value;
  const policyRef = `git://workspace-governance/${request.policy_ref?.revision}/contracts/instance-operational-records.yaml@${request.policy_ref?.contract_digest}`;
  if (actor !== null && receipt.actor !== actor || receipt.action !== `intake.${request.action}` || receipt.operator_ref !== operatorRef ||
      receipt.idempotency_key !== request.idempotency_key || receipt.decision_digest !== decision.decision_digest || receipt.policy_ref !== policyRef ||
      receipt.version !== (request.expected_state.record_version ?? 0) + 1 ||
      receipt.previous.version !== request.expected_state.record_version || receipt.previous.digest !== request.expected_state.record_digest ||
      record.phase !== "intake" || record.status !== request.requested_classification ||
      record.owner_route !== request.owner_route || record.record?.id !== request.target.record_id || record.record?.version !== receipt.version ||
      digest(record.record?.source) !== digest(request.source) || record.record?.last_mutation?.request_digest !== request.request_digest ||
      record.record?.last_mutation?.decision_digest !== decision.decision_digest || record.record?.last_mutation?.idempotency_key !== request.idempotency_key) fail();
  for (const [key, expected] of Object.entries(request.requested_record)) {
    if (key !== "kind" && digest(record[key]) !== digest(expected)) fail();
  }
  return value;
}

function inventoryResultBinding(value, request, operatorRef, actor = null) {
  const { record, receipt } = value;
  const policyRef = `git://workspace-governance/${request.policy_ref.revision}/contracts/instance-operational-records.yaml@${request.policy_ref.contract_digest}`;
  const decision = digest({ request_ref: { id: request.request_id, digest: request.request_digest }, operator_acceptance: request.operator_acceptance });
  const posture = { promote: "active", suspend: "suspended", retire: "retired", restore: "active", update: request.requested_value?.posture }[request.action];
  if (actor !== null && receipt.actor !== actor || receipt.action !== `inventory.${request.action}` || receipt.operator_ref !== operatorRef ||
      receipt.idempotency_key !== request.idempotency_key || receipt.decision_digest !== decision || receipt.policy_ref !== policyRef ||
      receipt.version !== request.expected_state.record_version + 1 || receipt.previous.version !== request.expected_state.record_version ||
      receipt.previous.digest !== request.expected_state.record_digest || record.phase !== "inventory" || record.posture !== posture || record.lifecycle !== posture ||
      record.record?.id !== request.target.record_id || record.record?.version !== receipt.version ||
      record.record?.last_mutation?.request_digest !== request.request_digest || record.record?.last_mutation?.idempotency_key !== request.idempotency_key) fail();
  if (request.requested_value) for (const [key, expected] of Object.entries(request.requested_value)) {
    if (digest(record[key]) !== digest(expected)) fail();
  }
  return value;
}
function operationKind(value) {
  if (!["intake", "inventory"].includes(value)) throw new HttpError(400, "instance_records_operation_invalid", "Select one supported repository record operation.");
  return value;
}
const recordTarget = name => {
  if (typeof name !== "string" || !NAME.test(name)) throw new HttpError(400, "instance_records_target_invalid", "Select one exact repository record.");
  return `/v1/instance-records/repositories/${encodeURIComponent(name)}`;
};

function instanceTransport({ baseUrl, instanceId, callerId, callerSecret, fetchImpl = globalThis.fetch }) {
  if (typeof instanceId !== "string" || !INSTANCE.test(instanceId)) {
    throw new HttpError(503, "instance_records_not_configured", "The internal record installation identity is not configured.");
  }
  let base;
  try {
    base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch {
    throw new HttpError(503, "instance_records_not_configured", "The internal record authority address is not configured.");
  }
  return createWgcfAuthenticatedJsonTransport({ baseUrl: base.toString(), callerId, callerSecret,
    configNames: { baseUrl: "WGCF_INSTANCE_RECORDS_BASE_URL", callerId: "WGCF_WORKSPACE_INTAKE_CALLER_ID",
      callerSecret: "WGCF_WORKSPACE_INTAKE_CALLER_SECRET" },
    errorPrefix: "instance_records", label: "Internal operational records", maxResponseBytes: 524288,
    fetchImpl: (url, options) => fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) }),
  });
}

// Internal, read-only consumer. Installation and backend address come from
// accepted composition, never an operator form or a project repository URL.
// This adapter is not activated by importing it and cannot write records.
export function createInstanceRecordReader({ baseUrl, instanceId, callerId, callerSecret, fetchImpl = globalThis.fetch }) {
  const transport = instanceTransport({ baseUrl, instanceId, callerId, callerSecret, fetchImpl });
  const target = recordTarget;
  function authority(body) {
    if (body?.schema_version !== 1 || !exactKeys(body.authority, ["kind", "instance_id"]) ||
        body.authority.kind !== "internal-instance-record" || body.authority.instance_id !== instanceId) fail();
  }
  function result(value, name) {
    return recordResult(value, instanceId, name);
  }
  return {
    async lookup(names) {
      if (!Array.isArray(names) || names.length < 1 || names.length > 25 || names.some(name => typeof name !== "string" || !NAME.test(name)) ||
          [...new Set(names)].sort().join("\0") !== names.join("\0")) throw new HttpError(400, "instance_records_targets_invalid", "Select at most 25 exact ordered repository names.");
      const query = new URLSearchParams(names.map(name => ["name", name]));
      const body = await transport.request(`/v1/instance-records/repository-status?${query}`, { method: "GET" });
      authority(body);
      if (!exactKeys(body, ["schema_version", "authority", "record_ids", "records"]) || !Array.isArray(body.records) || body.records.length > names.length ||
          digest(body.record_ids) !== digest(names.map(name => `repo:${name}`))) fail();
      let previous = "";
      for (const row of body.records) {
        if (!exactKeys(row, ["record_id", "version", "record_digest", "phase", "status", "provider_repository"]) || !body.record_ids.includes(row.record_id) || row.record_id <= previous ||
            !Number.isSafeInteger(row.version) || row.version < 1 || !DIGEST.test(row.record_digest) ||
            !(row.phase === "intake" ? ["out-of-scope", "proposed", "admitted"] : row.phase === "inventory" ? ["active", "suspended", "retired"] : []).includes(row.status) ||
            !exactKeys(row.provider_repository, ["provider", "provider_repository_id", "full_name"]) || row.provider_repository.provider !== "github" ||
            !/^[1-9][0-9]*$/.test(row.provider_repository.provider_repository_id ?? "") || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(row.provider_repository.full_name ?? "")) fail();
        previous = row.record_id;
      }
      return structuredClone(body);
    },
    async resolve(name, original, { operation = "intake" } = {}) {
      operationKind(operation);
      if (operation === "inventory") assertInstanceInventoryRequest(original?.request, instanceId, original?.operator_ref);
      else { assertInstanceIntakeRequest(original?.request, instanceId); assertInstanceIntakeDecision(original.request, original.decision, original.operator_ref); }
      const body = await transport.request(`${target(name)}/${operation}/readback`, {
        method: "POST", body: intakeStringify({ schema_version: 1, ...original }),
      });
      authority(body);
      if (!exactKeys(body, ["schema_version", "authority", "found", "record", "receipt"])) fail();
      if (body.found === false && body.record === null && body.receipt === null) return null;
      if (body.found !== true) fail();
      const current = result({ record: body.record, receipt: body.receipt }, name);
      return operation === "inventory" ? inventoryResultBinding(current, original.request, original.operator_ref)
        : intakeResultBinding(current, original.request, original.decision, original.operator_ref);
    },
    async sourceAuthority(name, operation) {
      if (!["bootstrap", "configure-verification", "ordinary-source"].includes(operation)) {
        throw new HttpError(400, "instance_records_operation_invalid", "Select one supported repository source operation.");
      }
      const body = await transport.request(`${target(name)}/source-authority?${new URLSearchParams({ operation })}`, { method: "GET" });
      try { assertInstanceSourceProof(body, { instanceId, ownerRepo: name, operation }); } catch { fail(); }
      return structuredClone(body);
    },
    async prepare(name, { operation = "intake" } = {}) {
      operationKind(operation);
      const body = await transport.request(`${target(name)}/${operation}/preparation`, { method: "GET" });
      if (body?.schema_version !== 1) fail();
      const owner = body.canonical_authority;
      if (owner?.kind === "legacy-git") {
        if (!exactKeys(body, ["schema_version", "canonical_authority", "record_id"]) ||
            !exactKeys(owner, ["kind", "repo", "revision"]) || owner.repo !== "workspace-governance" ||
            !/^[0-9a-f]{40}$/.test(owner.revision) || body.record_id !== `repo:${name}`) fail();
      } else {
        const policy = body.policy_ref, expected = body.expected_state;
        if (!exactKeys(body, ["schema_version", "canonical_authority", "policy_ref", "expected_state", "current"]) ||
            !exactKeys(owner, ["kind", "instance_id", "record_id"]) || owner.kind !== "internal-instance-record" ||
            owner.instance_id !== instanceId || owner.record_id !== `repo:${name}` ||
            !exactKeys(policy, ["repo", "revision", "contract_digest"]) || policy.repo !== "workspace-governance" ||
            !/^[0-9a-f]{40}$/.test(policy.revision) || !DIGEST.test(policy.contract_digest) ||
            !exactKeys(expected, ["record_version", "record_digest"])) fail();
        const current = body.current === null ? null : result(body.current, name);
        if (expected.record_version !== (current?.receipt.version ?? null) || expected.record_digest !== (current?.receipt.record_digest ?? null)) fail();
      }
      return structuredClone(body);
    },
    async read(name) {
      const body = await transport.request(target(name), { method: "GET" });
      authority(body);
      if (!exactKeys(body, ["schema_version", "authority", "found", "record", "receipt"])) fail();
      if (body.found === false && body.record === null && body.receipt === null) return null;
      if (body.found !== true) fail();
      return result({ record: body.record, receipt: body.receipt }, name);
    },
    async history(name, { beforeVersion = null, limit = 25 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
          beforeVersion !== null && (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1)) {
        throw new HttpError(400, "instance_records_page_invalid", "Select a bounded record history page.");
      }
      const query = new URLSearchParams({ limit: String(limit), ...(beforeVersion === null ? {} : { before_version: String(beforeVersion) }) });
      const body = await transport.request(`${target(name)}/history?${query}`, { method: "GET" });
      authority(body);
      if (!exactKeys(body, ["schema_version", "authority", "records", "next_before_version"]) ||
          !Array.isArray(body.records) || body.records.length > limit) fail();
      const records = body.records.map(value => result(value, name));
      for (let index = 0; index < records.length; index++) {
        const current = records[index].receipt;
        if (beforeVersion !== null && current.version >= beforeVersion) fail();
        if (index) {
          const previous = records[index - 1].receipt;
          if (previous.version !== current.version + 1 || previous.previous.version !== current.version || previous.previous.digest !== current.record_digest) fail();
        }
      }
      const next = body.next_before_version;
      if (next !== null && (!Number.isSafeInteger(next) || next < 2 || !records.length || next !== records.at(-1).receipt.version)) fail();
      return { records, next_before_version: next };
    },
    async catalog({ after = null, limit = 25, query: search = "", scope = "all" } = {}) {
      if (typeof search !== "string" || search.length > 128 || !["all", "inventory", "eligible"].includes(scope) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
          after !== null && (typeof after !== "string" || !after.startsWith("repo:") || !NAME.test(after.slice(5)))) {
        throw new HttpError(400, "instance_records_page_invalid", "Select one bounded repository catalog page.");
      }
      const query = new URLSearchParams({ limit: String(limit), query: search.trim().toLowerCase(), scope, ...(after === null ? {} : { after }) });
      const body = await transport.request(`/v1/instance-records/repository-catalog?${query}`, { method: "GET" });
      authority(body);
      const counts = body?.counts;
      if (!exactKeys(body, ["schema_version", "authority", "records", "counts", "selection", "next_after"]) ||
          !exactKeys(body.selection, ["query", "scope"]) || body.selection.query !== search.trim().toLowerCase() || body.selection.scope !== scope ||
          !exactKeys(counts, ["intake", "inventory"]) || !exactKeys(counts.intake, ["out-of-scope", "proposed", "admitted"]) ||
          !exactKeys(counts.inventory, ["active", "suspended", "retired"]) ||
          [...Object.values(counts.intake), ...Object.values(counts.inventory)].some(value => !Number.isSafeInteger(value) || value < 0) ||
          !Array.isArray(body.records) || body.records.length > limit) fail();
      let previous = after;
      const visible = { intake: {}, inventory: {} };
      const records = body.records.map(item => {
        const id = item?.receipt?.record_id;
        if (typeof id !== "string" || !id.startsWith("repo:") || !NAME.test(id.slice(5)) || previous !== null && previous >= id) fail();
        previous = id;
        const current = result(item, id.slice(5)), value = current.record;
        const status = value.phase === "inventory" ? value.posture : value.status;
        if (scope === "inventory" && value.phase !== "inventory" || scope === "eligible" && (value.phase !== "intake" || status !== "admitted") ||
            !id.includes(search.trim().toLowerCase())) fail();
        if (!Object.hasOwn(counts, value.phase) || !Object.hasOwn(counts[value.phase], status)) fail();
        visible[value.phase][status] = (visible[value.phase][status] ?? 0) + 1;
        if (visible[value.phase][status] > counts[value.phase][status]) fail();
        return current;
      });
      if (body.next_after !== null && (!records.length || body.next_after !== previous)) fail();
      return { authority: structuredClone(body.authority), records, counts: structuredClone(counts), selection: structuredClone(body.selection), next_after: body.next_after };
    },
    async list({ after = null, limit = 25 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
          after !== null && (typeof after !== "string" || !after.startsWith("repo:") || !NAME.test(after.slice(5)))) {
        throw new HttpError(400, "instance_records_page_invalid", "Select a bounded repository page.");
      }
      const query = new URLSearchParams({ limit: String(limit), ...(after === null ? {} : { after }) });
      const body = await transport.request(`/v1/instance-records/repositories?${query}`, { method: "GET" });
      authority(body);
      if (!exactKeys(body, ["schema_version", "authority", "records", "next_after"]) ||
          !Array.isArray(body.records) || body.records.length > limit) fail();
      let previous = after;
      for (const record of body.records) {
        const name = typeof record?.record_id === "string" ? record.record_id.slice(5) : null;
        const provider = record?.provider_repository;
        if (!exactKeys(record, ["record_id", "version", "record_digest", "phase", "status", "provider_repository"]) ||
            typeof record.record_id !== "string" || !record.record_id.startsWith("repo:") || typeof name !== "string" || !NAME.test(name) ||
            previous !== null && previous >= record.record_id || !Number.isSafeInteger(record.version) || record.version < 1 || !DIGEST.test(record.record_digest) ||
            !(record.phase === "intake" ? ["out-of-scope", "proposed", "admitted"] : record.phase === "inventory" ? ["active", "suspended", "retired"] : []).includes(record.status) ||
            provider !== null && (!exactKeys(provider, ["provider", "provider_repository_id", "full_name"]) || provider.provider !== "github" ||
              !/^[1-9][0-9]{0,31}$/.test(provider.provider_repository_id) || typeof provider.full_name !== "string" || provider.full_name.length > 256 ||
              !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(provider.full_name))) fail();
        previous = record.record_id;
      }
      if (body.next_after !== null && (!body.records.length || body.next_after !== previous)) fail();
      return { records: structuredClone(body.records), next_after: body.next_after };
    },
  };
}

// This service caller is distinct from the read-only governance reader. OOS
// builds custody and owner-readiness attestations from its native authorities;
// it must never forward browser-supplied proof flags through this client.
export function createInstanceRecordWriter({ baseUrl, instanceId, callerId, callerSecret, fetchImpl = globalThis.fetch }) {
  const transport = instanceTransport({ baseUrl, instanceId, callerId, callerSecret, fetchImpl });
  const actor = typeof callerId === "string" ? callerId.trim() : "operator-orchestration-service";
  return {
    async accept(name, input, { operation = "intake" } = {}) {
      operationKind(operation);
      const request = input?.request, decision = input?.decision;
      if (operation === "inventory") assertInstanceInventoryRequest(request, instanceId, input.operator_ref);
      else { assertInstanceIntakeRequest(request, instanceId); assertInstanceIntakeDecision(request, decision, input.operator_ref); }
      if (request?.instance_id !== instanceId || request?.target?.name !== name || request.target.record_id !== `repo:${name}` ||
          (operation === "intake" && (!decision || input.operator_ref !== decision.operator_acceptance?.operator_ref))) {
        throw new HttpError(400, "instance_records_command_invalid", "The accepted registration does not bind this installation and repository.");
      }
      const value = recordResult(await transport.request(`${recordTarget(name)}/${operation}`, { method: "POST", body: intakeStringify(input) }), instanceId, name);
      return operation === "inventory" ? inventoryResultBinding(value, request, input.operator_ref, actor)
        : intakeResultBinding(value, request, decision, input.operator_ref, actor);
    },
  };
}
