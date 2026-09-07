import path from "node:path";
import { prototypeLandingError, prototypeLandingManifest } from "./contracts.js";
import { createPrototypeLandingGitHubClient } from "./provider-client.js";
import { createPrototypeLandingService } from "./service.js";
import { createPrototypeLandingSourceClient } from "./source-client.js";
import { createPrototypeLandingStore } from "./store.js";
import { createWgcfPrototypeLandingClient } from "./wgcf-client.js";

function createImportResolver(root) {
  if (!root) return async () => null;
  const resolvedRoot = path.resolve(root);
  return async (sourcePlan) => {
    const prefix = "import://staged/";
    if (!sourcePlan.source_ref.startsWith(prefix)) throw prototypeLandingError("import_source_ref_invalid", "Imported source must use an admitted staged reference.", 409);
    const relative = sourcePlan.source_ref.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9._/-]*$/.test(relative) || relative.split("/").includes("..")) throw prototypeLandingError("import_source_ref_invalid", "Imported source reference is invalid.", 409);
    const candidate = path.resolve(resolvedRoot, relative);
    if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) throw prototypeLandingError("import_source_ref_invalid", "Imported source escapes its admitted root.", 409);
    return candidate;
  };
}

export function createPrototypeLandingRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (prototypeLandingManifest.runtime_activation !== true || config.profile !== "dev-integration") {
    throw prototypeLandingError("activation_required", "Prototype Landing awaits the reviewed Platform activation and conformance gates.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId", "wgcfBaseUrl", "wgcfCallerSecret", "wgcfImplementationRef", "wgcfServiceIdentityRef"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) throw prototypeLandingError("configuration_missing", `Prototype Landing requires ${name}.`, 503);
  }
  const provider = createPrototypeLandingGitHubClient({ owner: config.owner, repositoryId: config.repositoryId, tokenFile: config.tokenFile, fetchImpl });
  return createPrototypeLandingService({
    audit,
    store: createPrototypeLandingStore({ root: config.stateRoot }),
    sourceClient: createPrototypeLandingSourceClient({
      authorityRoot: config.authorityRoot,
      python: config.python,
      provider,
      resolveImportRoot: createImportResolver(config.importedContentRoot),
    }),
    readinessClient: createWgcfPrototypeLandingClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef,
      serviceIdentityRef: config.wgcfServiceIdentityRef,
      fetchImpl,
    }),
  });
}
