import { closureError, closureManifest } from "./contracts.js";
import { createPrototypeClosureAuthorityResolver } from "./authority-resolver.js";
import { createPrototypeClosureOwnerEvidenceReader } from "./owner-evidence.js";
import { createPrototypeClosureGitHubClient } from "./provider-client.js";
import { createPrototypeClosureService } from "./service.js";
import { createPrototypeClosureSourceClient } from "./source-client.js";
import { createPrototypeClosureStore } from "./store.js";
import { createWgcfPrototypeClosureClient } from "./wgcf-client.js";

export function createPrototypeClosureComposition({ audit, config, fetchImpl, ownerReaders, platformClient }) {
  if (config?.profile !== "dev-integration") {
    throw closureError("profile_invalid", "Closure is limited to the admitted dev-integration profile.", 503);
  }
  for (const name of [
    "stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId",
    "wgcfBaseUrl", "wgcfCallerSecret", "wgcfImplementationRef", "wgcfServiceIdentityRef",
  ]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw closureError("configuration_missing", `Closure requires ${name}.`, 503);
    }
  }
  if (typeof platformClient?.readDisposition !== "function") {
    throw closureError("platform_reader_missing", "Closure requires a Platform disposition reader.", 503);
  }
  const readEvidence = createPrototypeClosureOwnerEvidenceReader(ownerReaders);
  const provider = createPrototypeClosureGitHubClient({
    owner: config.owner,
    repositoryId: config.repositoryId,
    tokenFile: config.tokenFile,
    fetchImpl,
  });
  return createPrototypeClosureService({
    audit,
    store: createPrototypeClosureStore({ root: config.stateRoot }),
    readinessClient: createWgcfPrototypeClosureClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef,
      serviceIdentityRef: config.wgcfServiceIdentityRef,
      fetchImpl,
    }),
    authorityResolver: createPrototypeClosureAuthorityResolver({ readEvidence }),
    sourceClient: createPrototypeClosureSourceClient({
      authorityRoot: config.authorityRoot,
      python: config.python,
      provider,
    }),
    platformClient,
  });
}

export function createPrototypeClosureRuntime({ audit, config, fetchImpl, ownerReaders, platformClient }) {
  if (!config?.enabled) return null;
  if (closureManifest.runtime_activation !== true || config.profile !== "dev-integration") {
    throw closureError(
      "activation_required",
      "Prototype Closure awaits Platform commissioning of the approved dev-integration composition.",
      503,
    );
  }
  return createPrototypeClosureComposition({ audit, config, fetchImpl, ownerReaders, platformClient });
}
