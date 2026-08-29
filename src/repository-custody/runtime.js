import { HttpError } from "../errors.js";
import { createGitHubRepositoryProviderClient } from "./provider-client.js";
import { repositoryCustodyRuntimeActivation } from "./contracts.js";
import { createRepositoryCustodyService } from "./service.js";
import { createRepositoryCustodyStore } from "./store.js";
import { createWgcfRepositoryCustodyClient } from "./wgcf-client.js";

export function createRepositoryCustodyRuntime({
  audit,
  config,
  fetchImpl,
} = {}) {
  if (!config?.enabled) return null;

  const activation = repositoryCustodyRuntimeActivation();
  if (activation?.enabled !== true) {
    throw new HttpError(
      503,
      "repository_custody_runtime_not_activated",
      "Repository custody runtime activation has not been approved.",
    );
  }

  return createRepositoryCustodyService({
    audit,
    providerClient: createGitHubRepositoryProviderClient({
      apiBaseUrl: config.providerApiBaseUrl,
      fetchImpl,
      installationToken: config.providerInstallationToken,
    }),
    readinessClient: createWgcfRepositoryCustodyClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
    store: createRepositoryCustodyStore({ root: config.stateRoot }),
  });
}
