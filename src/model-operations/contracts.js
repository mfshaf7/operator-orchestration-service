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
        !(model.model_digest === null || text(model.model_digest)) || !text(model.runtime_version, 2048)) invalidOwner();
    if (Object.keys(model).sort().join(",") !== "backend_id,model,model_digest,runtime_version,supported_efforts,verification_ref") invalidOwner();
    if (!Object.hasOwn(config.backends, model.backend_id) || key !== digest({ backend_id: model.backend_id, model: model.model })) invalidOwner();
  }
  for (const item of value.history) if (!object(item) || Object.keys(item).sort().join(",") !== "digest,revision" || !integer(item.revision) || !SHA.test(item.digest) || item.revision > value.current_revision) invalidOwner();
  try { route(config.default); Object.values(config.overrides).forEach(route); } catch { invalidOwner(); }
  return value;
}
export function assertBackends(value) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "backends,tasks" || !Array.isArray(value.tasks) || !value.tasks.every(x => text(x, 300)) || !Array.isArray(value.backends)) invalidOwner();
  for (const backend of value.backends) {
    if (!object(backend) || Object.keys(backend).sort().join(",") !== "account_login_supported,allowed_tasks,availability,backend_id,provider,registered" ||
        !text(backend.backend_id) || !text(backend.provider) || !Array.isArray(backend.allowed_tasks) ||
        !backend.allowed_tasks.every(task => value.tasks.includes(task)) || typeof backend.registered !== "boolean" ||
        typeof backend.account_login_supported !== "boolean" || backend.availability !== "not-probed") invalidOwner();
  }
  return value;
}
export function assertCatalogue(value, backendId, model = null) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "backend_id,models" || value.backend_id !== backendId || !Array.isArray(value.models)) invalidOwner();
  for (const item of value.models) {
    if (!object(item) || Object.keys(item).sort().join(",") !== "model,model_digest,runtime_version,supported_efforts" ||
        !text(item.model) || model !== null && item.model !== model || !text(item.runtime_version, 2048) ||
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
