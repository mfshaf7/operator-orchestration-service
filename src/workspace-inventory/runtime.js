import path from "node:path";
import { inventoryError, inventoryManifest } from "./contracts.js";
import { createWorkspaceInventoryLifecycleService } from "./lifecycle-service.js";
import { createWorkspaceInventoryGitHubClient } from "./provider-client.js";
import { createWorkspaceInventorySourceClient } from "./source-client.js";
import { createWorkspaceInventoryStore } from "./store.js";
import { createWorkspaceInventoryService } from "./service.js";
import {
  createWgcfWorkspaceInventoryClient,
  createWgcfWorkspaceInventoryLifecycleClient,
} from "./wgcf-client.js";

export function createWorkspaceInventoryRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (inventoryManifest.runtime_activation !== true) {
    throw inventoryError("activation_required", "Workspace Inventory workflows await composed operating evidence.", 503);
  }
  if (config.profile !== "dev-integration") {
    throw inventoryError("activation_required", "Workspace Inventory workflows are admitted only in dev-integration.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw inventoryError("configuration_missing", `Workspace Inventory requires ${name}.`, 503);
    }
  }
  const provider = createWorkspaceInventoryGitHubClient({
    owner: config.owner,
    repositoryId: config.repositoryId,
    tokenFile: config.tokenFile,
    fetchImpl,
  });
  const sourceClient = createWorkspaceInventorySourceClient({
    authorityRoot: config.authorityRoot,
    python: config.python,
    provider,
  });
  const service = createWorkspaceInventoryService({
    audit,
    store: createWorkspaceInventoryStore({ root: config.stateRoot }),
    sourceClient,
    readinessClient: createWgcfWorkspaceInventoryClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
  });
  const lifecycle = createWorkspaceInventoryLifecycleService({
    audit,
    store: createWorkspaceInventoryStore({ root: path.join(config.stateRoot, "lifecycle") }),
    sourceClient,
    readinessClient: createWgcfWorkspaceInventoryLifecycleClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
  });
  return { ...service, lifecycle };
}
