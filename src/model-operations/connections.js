import { closed, digest, fail, identifier, object } from "./contracts.js";

export const API_PRESETS = {
  "claude-api": { label: "Claude API", origin: "https://api.anthropic.com" },
  "deepseek-api": { label: "DeepSeek API", origin: "https://api.deepseek.com" },
  "glm-api": { label: "GLM · Z.AI Standard API", origin: "https://api.z.ai" },
};
export const CONNECTION_ACTIONS = ["connection.create", "connection.disconnect", "connection.reconnect", "connection.remove"];
const qualification = "real-account-verification-pending";
const hash = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const connectionId = value => typeof value === "string" && /^api-[a-f0-9]{32}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const name = value => typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
function owner(condition) { if (!condition) throw fail("owner_response_invalid", "The provider-connection owner returned incomplete or incorrectly bound evidence.", 502); }
function ownerClosed(value, fields) { owner(object(value) && Object.keys(value).sort().join() === [...fields].sort().join()); }
function ownerId(value) { try { identifier(value); } catch { owner(false); } }
function maturity(value) { owner(value.experimental === true && value.qualification === qualification); }

export function assertConnections(value) {
  ownerClosed(value, ["revision", "presets", "connections"]);
  owner(integer(value.revision) && Array.isArray(value.presets) && value.presets.length === 3 &&
    Array.isArray(value.connections) && value.connections.length <= 16);
  const seen = new Set();
  for (const item of value.presets) {
    ownerClosed(item, ["provider", "label", "endpoint_origin", "experimental", "qualification", "catalogue_supported"]);
    const preset = API_PRESETS[item.provider];
    owner(preset && !seen.has(item.provider) && item.label === preset.label && item.endpoint_origin === preset.origin &&
      item.catalogue_supported === (item.provider !== "glm-api"));
    maturity(item); seen.add(item.provider);
  }
  seen.clear();
  for (const item of value.connections) {
    ownerClosed(item, ["connection_id", "provider", "name", "state", "credential_generation", "pending_operation", "updated_at", "experimental", "qualification", "credential_present"]);
    owner(connectionId(item.connection_id) && !seen.has(item.connection_id) && Object.hasOwn(API_PRESETS, item.provider) && name(item.name) &&
      ["active", "disconnected", "removing"].includes(item.state) &&
      (item.credential_generation === null || hash(item.credential_generation)) &&
      item.credential_present === (item.credential_generation !== null) &&
      typeof item.updated_at === "string" && item.updated_at.length <= 64 && Number.isFinite(Date.parse(item.updated_at)));
    if (item.pending_operation !== null) ownerId(item.pending_operation);
    maturity(item); seen.add(item.connection_id);
  }
  return value;
}

export function assertConnectionCommand(input) {
  closed(input, ["command_id", "expected_revision", "action", "input"], "Connection command");
  identifier(input.command_id);
  if (!integer(input.expected_revision) || !CONNECTION_ACTIONS.includes(input.action)) throw fail("invalid_input", "Select a supported connection action and its current revision.", 400);
  if (input.action === "connection.create") {
    closed(input.input, ["provider", "name"], "Connection creation");
    if (!Object.hasOwn(API_PRESETS, input.input.provider) || !name(input.input.name)) throw fail("invalid_input", "Choose a supported provider and a short connection name.", 400);
  } else {
    closed(input.input, ["connection_id"], "Connection selection");
    if (!connectionId(input.input.connection_id)) throw fail("invalid_input", "Select an existing named API connection.", 400);
  }
  return input;
}

export function credentialCommand(input) {
  closed(input, ["command_id", "expected_revision", "connection_id", "api_key"], "Protected credential ingress");
  identifier(input.command_id);
  if (!integer(input.expected_revision) || !connectionId(input.connection_id) || typeof input.api_key !== "string" ||
      input.api_key.length < 8 || input.api_key.length > 8192 || /[^\x21-\x7e]/.test(input.api_key)) {
    throw fail("invalid_input", "Enter one bounded API key and the current connection revision.", 400);
  }
  // Safe identity only. Never pass the raw ingress to the generic request store.
  return { command_id: input.command_id, expected_revision: input.expected_revision,
    action: "connection.credentials", input: { connection_id: input.connection_id } };
}

export function assertConnectionReceipt(value, command, actor) {
  ownerClosed(value, ["command_id", "command_digest", "actor", "action", "connection_id", "previous_revision", "revision", "state_digest", "receipt_digest"]);
  owner(value.actor === actor && connectionId(value.connection_id) && integer(value.previous_revision) && integer(value.revision) &&
    value.revision === value.previous_revision + 1 && hash(value.command_digest) && hash(value.state_digest) &&
    value.receipt_digest === digest(value, "receipt_digest"));
  if (command) {
    owner(value.command_id === command.command_id && value.action === command.action &&
      value.command_digest === digest({ actor, command }) && value.previous_revision >= command.expected_revision &&
      value.connection_id === (command.action === "connection.create" ? "api-" + digest({ actor, command: command.command_id }).slice(7, 39) : command.input.connection_id));
  }
  return value;
}

export function assertConnectionOperation(value, commandId, actor) {
  ownerClosed(value, ["command_id", "command_digest", "actor", "action", "connection_id", "state", "receipt"]);
  owner(value.command_id === commandId && value.actor === actor && hash(value.command_digest) &&
    [...CONNECTION_ACTIONS, "connection.credentials"].includes(value.action) && connectionId(value.connection_id) &&
    ["pending", "finished", "cancelled"].includes(value.state));
  if (value.state === "finished") {
    const receipt = assertConnectionReceipt(value.receipt, null, actor);
    owner(receipt.command_id === commandId && receipt.command_digest === value.command_digest &&
      receipt.action === value.action && receipt.connection_id === value.connection_id);
  } else owner(value.receipt === null);
  return value;
}

export function createConnectionOperations({ platform, bind, audit }) {
  const observed = (operatorId, command, outcome) => audit?.emit({ event_type: "model.connection.operation", actor: operatorId,
    command_id: command.command_id, action: command.action, outcome });
  return {
    async connections({ callerId, operatorId }) {
      bind(callerId, operatorId);
      return assertConnections(await platform.connections({ operatorId }));
    },
    async connectionCommand({ callerId, operatorId, input }) {
      bind(callerId, operatorId);
      const command = assertConnectionCommand(input);
      const receipt = assertConnectionReceipt(await platform.connectionCommand({ operatorId, command }), command, operatorId);
      observed(operatorId, command, "owner-confirmed");
      return receipt;
    },
    async connectionCredentials({ callerId, operatorId, input }) {
      bind(callerId, operatorId);
      const command = credentialCommand(input);
      // This call is intentionally direct and never scheduled, retried or
      // journaled by OOS. Unknown acknowledgement requires original owner read.
      const receipt = assertConnectionReceipt(await platform.connectionCredentials({ operatorId, credentials: input }), command, operatorId);
      observed(operatorId, command, "owner-confirmed");
      return receipt;
    },
    async connectionOperation({ callerId, operatorId, requestId }) {
      bind(callerId, operatorId); identifier(requestId);
      return assertConnectionOperation(await platform.connectionOperation({ operatorId, commandId: requestId }), requestId, operatorId);
    },
    async reconcileConnection({ callerId, operatorId, input }) {
      bind(callerId, operatorId); closed(input, ["command_id"], "Original connection reconciliation"); identifier(input.command_id);
      return assertConnectionOperation(await platform.reconcileConnection({ operatorId, commandId: input.command_id }), input.command_id, operatorId);
    },
  };
}
