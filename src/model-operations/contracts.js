import { HttpError } from "../errors.js";
import { modelProfileDigest } from "../model-profile-request/contracts.js";

export const digest = modelProfileDigest;
export const ACTIONS = ["backend.register", "backend.remove", "model.register", "model.remove", "routing.save", "routing.rollback", "account.login.start", "account.login.cancel"];
export const TERMINAL = new Set(["completed", "rejected", "cancelled"]);
const SHA = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,180}$/;

export function fail(code, message, status = 409, details = null) {
  return new HttpError(status, `model_operations_${code}`, message, details);
}
export function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function closed(value, fields, label) {
  if (!object(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw fail("invalid_input", `${label} has invalid fields.`, 400);
  }
}
export function identifier(value, label = "Request identity") {
  if (typeof value !== "string" || !ID.test(value)) throw fail("invalid_input", `${label} is invalid.`, 400);
  return value;
}
function text(value, limit = 200) { return typeof value === "string" && value.length > 0 && value.length <= limit; }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function effort(value) { return value === null || typeof value === "boolean" || text(value); }
function selection(value) {
  closed(value, ["model_id", "effort"], "Model selection");
  if (!SHA.test(value.model_id) || !effort(value.effort)) throw fail("invalid_input", "Model and native effort must use the advertised values.", 400);
}
function route(value) {
  if (value === null) return;
  closed(value, ["primary", "fallbacks", "on_exhausted"], "Task route");
  if (!Array.isArray(value.fallbacks) || value.fallbacks.length > 4 || value.on_exhausted !== "fail-closed") {
    throw fail("invalid_input", "Use at most four explicit fallbacks and fail closed when exhausted.", 400);
  }
  selection(value.primary); value.fallbacks.forEach(selection);
}
export function assertAction(action, input) {
  if (!ACTIONS.includes(action)) throw fail("invalid_input", "This model-management action is not supported.", 400);
  switch (action) {
    case "backend.register": case "backend.remove": case "account.login.start":
      closed(input, ["backend_id"], action);
      if (!text(input.backend_id)) throw fail("invalid_input", "Select an admitted backend.", 400);
      break;
    case "model.register":
      closed(input, ["backend_id", "model"], action);
      if (!text(input.backend_id) || !text(input.model)) throw fail("invalid_input", "Select an advertised backend and model.", 400);
      break;
    case "model.remove":
      closed(input, ["model_id"], action);
      if (!SHA.test(input.model_id)) throw fail("invalid_input", "Select a registered model.", 400);
      break;
    case "routing.save":
      closed(input, ["default", "overrides"], action); route(input.default);
      if (!object(input.overrides) || Object.keys(input.overrides).length > 100) throw fail("invalid_input", "Task overrides must be a bounded mapping.", 400);
      Object.values(input.overrides).forEach(route);
      break;
    case "routing.rollback":
      closed(input, ["revision"], action);
      if (!integer(input.revision)) throw fail("invalid_input", "Select a retained configuration revision.", 400);
      break;
    case "account.login.cancel":
      closed(input, ["login_command_id"], action); identifier(input.login_command_id, "Original login command");
      break;
  }
}
export function assertRequest(value) {
  closed(value, ["schema_version", "request_id", "idempotency_key", "expected_configuration_revision", "action", "input"], "Model operation request");
  if (value.schema_version !== 1 || !integer(value.expected_configuration_revision)) throw fail("invalid_input", "A current configuration revision is required.", 400);
  identifier(value.request_id); identifier(value.idempotency_key, "Idempotency identity");
  assertAction(value.action, value.input);
  return value;
}
export function assertControl(value) {
  closed(value, ["control_id", "expected_revision", "action"], "Model operation control");
  identifier(value.control_id, "Control identity");
  if (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1 || !["retry", "reconcile", "cancel"].includes(value.action)) {
    throw fail("invalid_input", "Select the current request revision and a supported control.", 400);
  }
  return value;
}
function invalidOwner() { throw fail("owner_response_invalid", "Platform returned incomplete or incorrectly bound model-management evidence.", 502); }
export function assertConfiguration(value, expectedRevision = null) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "configuration,current_revision,digest,history,revision") invalidOwner();
  if (!object(value) || !integer(value.revision) || !integer(value.current_revision) || value.current_revision < value.revision ||
      expectedRevision !== null && value.revision !== expectedRevision || !object(value.configuration) ||
      value.digest !== digest(value.configuration) || !Array.isArray(value.history)) invalidOwner();
  const config = value.configuration;
  if (Object.keys(config).sort().join(",") !== "backends,default,models,overrides") invalidOwner();
  if (!object(config.backends) || !object(config.models) || !object(config.overrides) || !Object.hasOwn(config, "default")) invalidOwner();
  for (const [key, backend] of Object.entries(config.backends)) {
    if (!object(backend) || Object.keys(backend).join(",") !== "backend_id" || backend.backend_id !== key) invalidOwner();
  }
  for (const [key, model] of Object.entries(config.models)) {
    if (!object(model) || !text(model.backend_id) || !text(model.model) || !Array.isArray(model.supported_efforts) ||
        !model.supported_efforts.length || !model.supported_efforts.every(effort) || !SHA.test(model.verification_ref) ||
        !(model.model_digest === null || text(model.model_digest)) || !(model.runtime_version === null || text(model.runtime_version, 2048))) invalidOwner();
    if (Object.keys(model).sort().join(",") !== "backend_id,model,model_digest,runtime_version,supported_efforts,verification_ref") invalidOwner();
    if (!Object.hasOwn(config.backends, model.backend_id) || key !== digest({ backend_id: model.backend_id, model: model.model })) invalidOwner();
  }
  for (const item of value.history) if (!object(item) || Object.keys(item).sort().join(",") !== "digest,revision" || !integer(item.revision) || !SHA.test(item.digest) || item.revision > value.current_revision) invalidOwner();
  try { route(config.default); Object.values(config.overrides).forEach(route); } catch { invalidOwner(); }
  return value;
}
export function assertBackends(value) {
  if (!object(value) || !["backends,tasks", "backends,health,tasks"].includes(Object.keys(value).sort().join(",")) || !Array.isArray(value.tasks) || !value.tasks.every(x => text(x, 300)) || !Array.isArray(value.backends)) invalidOwner();
  for (const backend of value.backends) {
    const api = ["claude-api", "deepseek-api", "glm-api"].includes(backend?.provider);
    const keys = ["account_login_supported", "allowed_tasks", "availability", "backend_id", "provider", "registered",
      ...(api ? ["experimental", "qualification", "catalogue_supported", "verification_max_tokens"] : [])];
    if (!object(backend) || Object.keys(backend).sort().join(",") !== keys.sort().join(",") ||
        !text(backend.backend_id) || !text(backend.provider) || !Array.isArray(backend.allowed_tasks) ||
        !backend.allowed_tasks.every(task => value.tasks.includes(task)) || typeof backend.registered !== "boolean" ||
        typeof backend.account_login_supported !== "boolean" || backend.availability !== "not-probed") invalidOwner();
    if (api && (backend.experimental !== true || backend.qualification !== "real-account-verification-pending" ||
        backend.catalogue_supported !== (backend.provider !== "glm-api") || backend.verification_max_tokens !== 4096)) invalidOwner();
  }
  return value;
}
const HEALTH_STATES = ["available", "unavailable", "verification-needed", "unknown"];
const HEALTH_CODES = ["connection-not-probed", "check-budget-exhausted", "metadata-available", "account-sign-in-required",
  "account-present-connection-unprobed", "provider-metadata-invalid", "provider-unavailable", "provider-busy",
  "model-not-advertised", "registration-changed", "metadata-matched", "connection-verified",
  "last-request-failed", "recent-model-success", "model-verification-required", "connection-disconnected", "credential-reconcile-required", "api-key-required"];
export function assertProviderHealth(value, configuration, now = Date.now()) {
  if (value === null || value === undefined) return null;
  const keys = ["configuration_revision", "configuration_digest", "checked_at", "expires_at", "backends", "models"];
  if (!object(value) || Object.keys(value).sort().join(",") !== keys.sort().join(",") ||
      value.configuration_revision !== configuration.revision || value.configuration_digest !== configuration.digest ||
      !text(value.checked_at, 64) || !text(value.expires_at, 64) ||
      !Array.isArray(value.backends) || value.backends.length > 32 || !Array.isArray(value.models) || value.models.length > 256) invalidOwner();
  const start = Date.parse(value.checked_at), end = Date.parse(value.expires_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 120_000 || start > now || end <= now) return null;
  const config = configuration.configuration;
  for (const [rows, field, known] of [[value.backends, "backend_id", config.backends], [value.models, "model_id", config.models]]) {
    const seen = new Set();
    for (const row of rows) {
      const expected = field === "backend_id" ? "backend_id,code,state" :
        (Object.hasOwn(row ?? {}, "last_success") ? "code,last_success,model_id,observed_model_digest,observed_runtime_version,state" : "code,model_id,observed_model_digest,observed_runtime_version,state");
      if (!object(row) || Object.keys(row).sort().join(",") !== expected || !Object.hasOwn(known, row[field]) || seen.has(row[field]) ||
          !HEALTH_STATES.includes(row.state) || !HEALTH_CODES.includes(row.code)) invalidOwner();
      if (field === "model_id" && (!(row.observed_runtime_version === null || text(row.observed_runtime_version, 2048)) ||
          !(row.observed_model_digest === null || text(row.observed_model_digest, 200)))) invalidOwner();
      if (field === "model_id" && row.last_success != null) {
        const success = row.last_success, at = Date.parse(success.at);
        if (!object(success) || Object.keys(success).sort().join(",") !== "at,kind,reference" ||
            !["verification", "request"].includes(success.kind) || !text(success.at, 64) || !Number.isFinite(at) || at < 0 || at > start ||
            !/^(sha256:|ai-routing-selection:)[0-9a-f]{64}$/.test(success.reference)) invalidOwner();
      }
      if ((row.code === "connection-verified" && (field !== "backend_id" || row.state !== "available")) ||
          (row.code === "recent-model-success" && (field !== "model_id" || row.state !== "available" || !row.last_success || start - Date.parse(row.last_success.at) > 900000)) ||
          (["last-request-failed", "model-verification-required"].includes(row.code) && (field !== "model_id" || row.state !== "verification-needed"))) invalidOwner();
      seen.add(row[field]);
    }
  }
  return value;
}
export function assertCatalogue(value, backendId, model = null) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "backend_id,models" || value.backend_id !== backendId || !Array.isArray(value.models)) invalidOwner();
  for (const item of value.models) {
    if (!object(item) || Object.keys(item).sort().join(",") !== "model,model_digest,runtime_version,supported_efforts" ||
        !text(item.model) || model !== null && item.model !== model || !(item.runtime_version === null || text(item.runtime_version, 2048)) ||
        !(item.model_digest === null || text(item.model_digest)) ||
        !(item.supported_efforts === null || Array.isArray(item.supported_efforts) && item.supported_efforts.length && item.supported_efforts.every(effort))) invalidOwner();
  }
  return value;
}
export function assertOwnerReceipt(value, command, actor) {
  const fields = ["command_id", "command_digest", "actor", "action", "previous_revision", "revision", "configuration_digest", "receipt_digest"];
  if (!object(value) || Object.keys(value).sort().join(",") !== fields.sort().join(",") ||
      value.command_id !== command.command_id || value.action !== command.action || value.actor !== actor ||
      value.previous_revision !== command.expected_revision || value.revision !== command.expected_revision + 1 ||
      value.command_digest !== digest({ actor, command }) || !SHA.test(value.configuration_digest) ||
      value.receipt_digest !== digest(value, "receipt_digest")) invalidOwner();
  return value;
}
export function assertLogin(value, commandId, actor, backendId = null) {
  const fields = ["command_id", "request_digest", "backend_id", "actor", "state", "verification_url", "user_code", "failure"];
  if (!object(value) || Object.keys(value).sort().join(",") !== fields.sort().join(",") || value.command_id !== commandId || value.actor !== actor ||
      !SHA.test(value.request_digest) || !text(value.backend_id) || backendId !== null && value.backend_id !== backendId ||
      !["starting", "waiting-for-operator", "cancel-requested", "connected", "cancelled", "failed", "interrupted"].includes(value.state)) invalidOwner();
  if (value.verification_url !== null) {
    let url; try { url = new URL(value.verification_url); } catch { invalidOwner(); }
    if (url.protocol !== "https:" || url.username || url.password || !text(value.verification_url, 2048)) invalidOwner();
  }
  if (!(value.user_code === null || text(value.user_code, 128)) || !(value.failure === null || text(value.failure))) invalidOwner();
  if (value.request_digest !== digest({ command_id: commandId, backend_id: value.backend_id, actor })) invalidOwner();
  return value;
}
