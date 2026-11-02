import { createHash } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { HttpError } from "../errors.js";
import { createPrivateFileTransactions } from "../persistence/private-file-transactions.js";
import { assertDevIntegrationProfileProjection, devIntegrationRequestIntent, normalizeDevIntegrationRequest } from "./dev-integration-contracts.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (status, code, message) => { throw new HttpError(status, `dev_integration_${code}`, message); };

export function createDevIntegrationProfileService({ root, providerClient, operatorBindings, audit, clock = () => new Date() }) {
  const records = path.join(root, "profile-requests");
  const bindings = path.join(records, "bindings");
  mkdirSync(bindings, { recursive: true, mode: 0o700 });
  const tx = createPrivateFileTransactions({ root: records,
    failure: (code, message) => new HttpError(503, `dev_integration_${code}`, message) });
  const bindingFile = id => path.join(bindings, hash(id) + ".json");
  const directory = callerId => path.join(records, "by-caller", hash(callerId));
  function operator(callerId) {
    const actor = operatorBindings?.[callerId];
    if (!actor) fail(403, "caller_forbidden", "This caller has no admitted profile workflow binding.");
    return actor;
  }
  function owned(value, callerId, actor) {
    if (!value || value.caller_id !== callerId || value.operator_id !== actor)
      fail(404, "request_not_found", "The original caller-bound profile request was not found.");
  }
  function readBinding(id) {
    return tx.read(bindingFile(id), "Profile request identity", { maxBytes: 2048 });
  }
  function recordFile(binding) {
    if (!/^[0-9TZ-]+-[a-f0-9]{64}\.json$/.test(binding.filename) || typeof binding.caller_id !== "string")
      fail(503, "state_invalid", "The original request identity is invalid.");
    return path.join(directory(binding.caller_id), binding.filename);
  }
  function readRecord(binding) {
    return tx.read(recordFile(binding), "Original profile request", { maxBytes: 65536 });
  }
  function project(record, admission = null) {
    const {digest, ...claims} = record.receipt ?? {};
    if (canonicalDigest(claims) !== digest || claims.intent_digest !== canonicalDigest(devIntegrationRequestIntent(record.input)) ||
        claims.intent_digest !== record.intent_digest || claims.request_ref !== record.request_ref ||
        claims.request_id !== record.request_id || record.input.request_id !== record.request_id ||
        record.request_ref !== `oos://dev-integration/requests/${record.request_id}` ||
        claims.operator_id !== record.operator_id || claims.recorded_at !== record.created_at || claims.outcome !== "request-recorded")
      fail(503, "state_invalid", "The original request receipt could not be verified.");
    return { schema_version: 1, workflow_id: "dev-integration-profile-request", request_id: record.request_id,
      request: record.input.request, expected_source_version: record.input.expected_source_version,
      intent_digest: record.intent_digest, operator_id: record.operator_id, state: "recorded",
      created_at: record.created_at, updated_at: record.created_at, request_ref: record.request_ref,
      receipt: record.receipt, readback: "current",
      admission: admission ?? { state: "not-checked", lifecycle: null, source_version: null, observed_at: null, profile_ref: null },
      next_action: { code: "review-profile-request", owner: record.input.request.ownerRepo,
        reason: "Request recorded for owner review in Dev Integration. Workspace Governance admission, implementation and runtime launch remain separate." } };
  }
  async function profiles({ callerId, query = {} }) {
    operator(callerId);
    return assertDevIntegrationProfileProjection(await providerClient.getDevIntegrationProfiles(query));
  }
  async function validateCurrent(input, callerId) {
    const current = await profiles({ callerId, query: { profile_id: input.request.profileId } });
    if (current.source_version !== input.expected_source_version ||
        Math.abs(clock().getTime() - Date.parse(current.observed_at)) > 60000)
      fail(409, "source_stale", "Profile registry source changed. Refresh and review the request again.");
    const r = input.request;
    if (current.profiles.length) fail(409, "profile_exists", "This profile is already registered.");
    const options = current.request_options;
    if (!options.owner_repos.includes(r.ownerRepo) || r.participatingRepos.some(repo => !options.owner_repos.includes(repo)) ||
        !options.lane_classes.includes(r.laneClass) || !options.runtime_platforms.includes(r.runtimePlatform) ||
        !options.state_models.includes(r.runtimeStateModel))
      fail(409, "choice_unavailable", "A selected owner or runtime choice is no longer admitted for requests.");
    for (const id of [r.replacesProfileId, r.persistence?.disposableCompanionProfileId].filter(Boolean)) {
      const other = await profiles({ callerId, query: { profile_id: id } });
      if (other.source_version !== current.source_version || other.profiles.length !== 1 ||
          (id === r.persistence?.disposableCompanionProfileId && other.profiles[0].runtime.state_model !== "disposable"))
        fail(409, "related_profile_unavailable", "The replacement or disposable companion profile is unavailable.");
    }
  }
  async function submit({ callerId, input: raw }) {
    const actor = operator(callerId);
    const input = normalizeDevIntegrationRequest(raw);
    const digest = canonicalDigest(devIntegrationRequestIntent(input));
    if (digest !== input.approval.intent_digest) fail(400, "approval_mismatch", "Approval must bind this exact profile request.");
    return tx.withLock(input.request_id, async () => {
      let binding = readBinding(input.request_id);
      if (binding) {
        owned(binding, callerId, actor);
        if (binding.intent_digest !== digest) fail(409, "request_conflict", "The original request ID already binds different intent.");
        const current = readRecord(binding);
        if (current) return project(current);
      }
      await validateCurrent(input, callerId);
      if (!binding) {
        binding = { request_id: input.request_id, caller_id: callerId, operator_id: actor, intent_digest: digest,
          created_at: clock().toISOString() };
        binding.filename = `${binding.created_at.replace(/[:.]/g, "-")}-${hash(input.request_id)}.json`;
        tx.write(bindingFile(input.request_id), binding);
      }
      mkdirSync(directory(callerId), { recursive: true, mode: 0o700 });
      const requestRef = `oos://dev-integration/requests/${input.request_id}`;
      const claims = { request_ref: requestRef, request_id: input.request_id, intent_digest: digest,
        operator_id: actor, recorded_at: binding.created_at, outcome: "request-recorded" };
      const record = { schema_version: 1, ...binding, input, request_ref: requestRef,
        receipt: { ...claims, digest: canonicalDigest(claims) } };
      // This single atomic, fsynced file is the canonical request and history row.
      // A crash before it exists has recorded no request; after it exists, cold
      // list/get/replay all find the same intent and receipt. There is no external create.
      tx.write(recordFile(binding), record);
      audit?.emit?.({ event_type: "dev-integration.request.recorded", correlation_id: input.request_id,
        caller: { id: callerId }, operator: { id: actor }, outcome: "recorded", request_ref: requestRef, intent_digest: digest });
      return project(record);
    });
  }
  async function get({ callerId, requestId }) {
    const actor = operator(callerId);
    if (typeof requestId !== "string" || !/^devint-request:[A-Za-z0-9._:-]{1,113}$/.test(requestId))
      fail(400, "request_id_invalid", "An exact original profile request ID is required.");
    return tx.withLock(requestId, async () => {
      const binding = readBinding(requestId); owned(binding, callerId, actor);
      const record = readRecord(binding); owned(record, callerId, actor);
      let admission = { state: "unavailable", lifecycle: null, source_version: null, observed_at: null, profile_ref: null };
      try {
        const current = await profiles({ callerId, query: { profile_id: record.input.request.profileId } });
        const profile = current.profiles[0];
        const matches = profile?.profile_id === record.input.request.profileId && profile.request_record_ref === record.request_ref;
        admission = { state: !profile ? "not-registered" : matches ? "registered" : "different-request",
          lifecycle: matches ? profile.lifecycle : null, source_version: current.source_version,
          observed_at: current.observed_at, profile_ref: matches ? `profile:${profile.profile_id}` : null };
      } catch { /* Canonical request remains readable when the registry is offline. */ }
      return project(record, admission);
    });
  }
  async function listRequests({ callerId, offset = 0, limit = 20 }) {
    const actor = operator(callerId);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 25)
      fail(400, "pagination_invalid", "Request history requires bounded pagination.");
    let names;
    try { names = readdirSync(directory(callerId)).filter(name => /^[0-9TZ-]+-[a-f0-9]{64}\.json$/.test(name)).sort().reverse(); }
    catch (error) { if (error.code === "ENOENT") names = []; else throw error; }
    const requests = names.slice(offset, offset + limit).map(name => {
      const record = tx.read(path.join(directory(callerId), name), "Original profile request", { maxBytes: 65536 });
      owned(record, callerId, actor); return project(record);
    });
    return { schema_version: 1, requests, page: { offset, limit, total: names.length,
      next_offset: offset + limit < names.length ? offset + limit : null } };
  }
  return { profiles, submit, get, listRequests };
}
