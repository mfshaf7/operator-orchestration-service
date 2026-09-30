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
import { isWorkspaceOperationRuntimeEnabled } from "../workspace-operation-activation.js";

export function createWorkspaceInventoryRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (!isWorkspaceOperationRuntimeEnabled(inventoryManifest, config.profile)) {
    throw inventoryError("activation_required", "Workspace Inventory routine operation awaits the Console, Security, and Platform activation chain.", 503);
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
