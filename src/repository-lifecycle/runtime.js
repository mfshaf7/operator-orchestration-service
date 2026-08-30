import { HttpError } from "../errors.js";
import { repositoryLifecycleRuntimeActivation } from "./contracts.js";
import { createGitHubRepositoryLifecycleClient } from "./provider-client.js";
import { createRepositoryLifecycleService } from "./service.js";
import { createRepositoryLifecycleStore } from "./store.js";
import { createWgcfRepositoryLifecycleClient } from "./wgcf-client.js";

export function createRepositoryLifecycleRuntime({ audit, config, fetchImpl } = {}) {
  if (!config?.enabled) return null;
  if (repositoryLifecycleRuntimeActivation().enabled !== true) {
    throw new HttpError(
      503,
      "repository_lifecycle_runtime_not_activated",
      "Repository lifecycle runtime activation has not been approved.",
    );
  }
  return createRepositoryLifecycleService({
    audit,
    providerClient: createGitHubRepositoryLifecycleClient({
      apiBaseUrl: config.providerApiBaseUrl,
      fetchImpl,
      installationToken: config.providerInstallationToken,
      sandbox: config.providerSandbox,
    }),
    readinessClient: createWgcfRepositoryLifecycleClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
    store: createRepositoryLifecycleStore({ root: config.stateRoot }),
  });
}
