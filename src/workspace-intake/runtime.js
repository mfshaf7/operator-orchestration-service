import { intakeError, intakeManifest } from "./contracts.js";
import { createWorkspaceIntakeGitHubClient } from "./provider-client.js";
import { createWorkspaceIntakeSourceClient } from "./source-client.js";
import { createWorkspaceIntakeStore } from "./store.js";
import { createWorkspaceIntakeService } from "./service.js";
import { createWgcfWorkspaceIntakeClient } from "./wgcf-client.js";

export function createWorkspaceIntakeRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (!intakeManifest.runtime_activation || config.profile !== "dev-integration") {
    throw intakeError("activation_required", "Workspace Intake activation requires the reviewed Security and Platform gates.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId", "wgcfImplementationRef", "wgcfServiceIdentityRef"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) throw intakeError("configuration_missing", `Workspace Intake requires ${name}.`, 503);
  }
  return createWorkspaceIntakeService({
    audit,
    store: createWorkspaceIntakeStore({ root: config.stateRoot }),
    sourceClient: createWorkspaceIntakeSourceClient({ authorityRoot: config.authorityRoot, python: config.python,
      provider: createWorkspaceIntakeGitHubClient({ owner: config.owner, repositoryId: config.repositoryId, tokenFile: config.tokenFile, fetchImpl }),
    }),
    readinessClient: createWgcfWorkspaceIntakeClient({ baseUrl: config.wgcfBaseUrl, callerId: config.wgcfCallerId, callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef, serviceIdentityRef: config.wgcfServiceIdentityRef, fetchImpl,
    }),
  });
}
