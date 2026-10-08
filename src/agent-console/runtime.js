import { createWgcfAgentActionClient } from "../agent-action/wgcf-client.js";
import { agentConsoleError, agentConsoleManifest } from "./contracts.js";
import { createAgentConsoleContextClient, createAgentConsoleGatewayClient } from "./clients.js";
import { createAgentConsoleService } from "./service.js";
import { createAgentConsoleStore } from "./store.js";

export function createAgentConsoleRuntime({ actionAdapter = null, audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (
    !agentConsoleManifest.runtime_activation.enabled ||
    config.profile !== agentConsoleManifest.runtime_activation.allowed_runtime_profile
  ) {
    throw agentConsoleError("activation_required", "Agent Console is admitted only in the reviewed dev-integration boundary.", 503);
  }
  if (!config.stateRoot || !config.contextBaseUrl || !config.contextCallerSecret || !config.gatewayBaseUrl) {
    throw agentConsoleError("configuration_missing", "Agent Console state, CGG, and governed-model configuration are required.", 503);
  }
  if (!Object.keys(config.operatorBindings ?? {}).length) {
    throw agentConsoleError("configuration_missing", "Agent Console caller/operator bindings are required.", 503);
  }
  const store = createAgentConsoleStore({ root: config.stateRoot });
  return createAgentConsoleService({
    actionAdapter,
    audit,
    contextCallerId: config.contextCallerId,
    contextClient: createAgentConsoleContextClient({
      baseUrl: config.contextBaseUrl,
      callerId: config.contextCallerId,
      callerSecret: config.contextCallerSecret,
      fetchImpl,
    }),
    evaluatorClient: createWgcfAgentActionClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
    gatewayClient: createAgentConsoleGatewayClient({ baseUrl: config.gatewayBaseUrl, fetchImpl }),
    operatorBindings: config.operatorBindings,
    store,
  });
}
