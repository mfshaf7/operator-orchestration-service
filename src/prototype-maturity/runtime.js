import { prototypeMaturityError, prototypeMaturityManifest } from "./contracts.js";
import { createPrototypeMaturityGitHubClient } from "./provider-client.js";
import { createPrototypeMaturityService } from "./service.js";
import { createPrototypeMaturitySourceClient } from "./source-client.js";
import { createPrototypeMaturityStore } from "./store.js";
import { createWgcfPrototypeMaturityClient } from "./wgcf-client.js";

export function createPrototypeMaturityRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (
    prototypeMaturityManifest.runtime_activation !== true ||
    config.profile !== "dev-integration"
  ) {
    throw prototypeMaturityError(
      "activation_required",
      "Prototype Maturity awaits the reviewed Platform activation and conformance gates.",
      503,
    );
  }
  for (const name of [
    "stateRoot",
    "authorityRoot",
    "tokenFile",
    "owner",
    "repositoryId",
    "wgcfBaseUrl",
    "wgcfCallerSecret",
    "wgcfImplementationRef",
    "wgcfServiceIdentityRef",
  ]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw prototypeMaturityError(
        "configuration_missing",
        `Prototype Maturity requires ${name}.`,
        503,
      );
    }
  }
  const provider = createPrototypeMaturityGitHubClient({
    owner: config.owner,
    repositoryId: config.repositoryId,
    tokenFile: config.tokenFile,
    fetchImpl,
  });
  return createPrototypeMaturityService({
    audit,
    store: createPrototypeMaturityStore({ root: config.stateRoot }),
    sourceClient: createPrototypeMaturitySourceClient({
      authorityRoot: config.authorityRoot,
      python: config.python,
      provider,
    }),
    readinessClient: createWgcfPrototypeMaturityClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef,
      serviceIdentityRef: config.wgcfServiceIdentityRef,
      fetchImpl,
    }),
  });
}
