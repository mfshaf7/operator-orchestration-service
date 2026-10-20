import path from "node:path";
import { deliveryArtWorkStateRoot } from "../delivery-art/work-session-store.js";
import { createDeliveryArtSourceExecutorClient } from "../delivery-art/source-executor.js";
import { createWorkspaceIntakeSourceClient } from "../workspace-intake/source-client.js";
import { createWorkspaceIntakeGitHubClient } from "../workspace-intake/provider-client.js";
import { intakeManifest } from "../workspace-intake/contracts.js";
import { isWorkspaceOperationRuntimeEnabled } from "../workspace-operation-activation.js";
import { HttpError } from "../errors.js";
import { createPublicBootstrapSourceReader } from "./source-reader.js";
import { createRepositoryOwnerBootstrapPreparation } from "./preparation.js";
import { createRepositoryOwnerBootstrapStore } from "./store.js";
import { createRepositoryOwnerBootstrapService } from "./service.js";

export function createRepositoryOwnerBootstrapFacade({ service, preparations, operatorBindings }) {
  const identified = ({ callerId, ...args }) => {
    const operatorId = operatorBindings?.[callerId];
    if (!operatorId) throw new HttpError(403, "repository_owner_bootstrap_identity_forbidden", "The caller has no accountable bootstrap operator binding.");
    return { ...args, callerId, operatorId };
  };
  return {
    prepare: args => preparations.prepare(identified(args)),
    ...Object.fromEntries(["create", "list", "read", "draft", "start", "materializeExisting", "cancelUnapplied", "accept", "recover", "publish", "review", "merge", "close"]
      .map(method => [method, args => service[method](identified(args))])),
    prepareSourceCredential: args => service.prepareSourceCredential(args),
    verifySourceCredential: args => service.verifySourceCredential(args),
    ownerReadiness: args => service.ownerReadiness(identified(args)),
  };
}

// Reuse the existing source-work/Intake composition and exact Security/Platform
// tree gate. A second bootstrap enable flag or model profile is not authority.
export function createRepositoryOwnerBootstrapRuntime({ sourceConfig, intakeConfig, custodySourceReader, platformOperations, fetchImpl, env = process.env }) {
  if (!sourceConfig?.sourceRealization?.enabled || !sourceConfig.executorId || !sourceConfig.executorSecret || !sourceConfig.executorSocketPath ||
      !Object.keys(sourceConfig.callerOperatorBindings ?? {}).length || !intakeConfig?.enabled || typeof custodySourceReader !== "function" ||
      !isWorkspaceOperationRuntimeEnabled(intakeManifest, intakeConfig.profile)) return null;
  if (intakeConfig.profile !== "dev-integration") throw new HttpError(503, "repository_owner_bootstrap_profile_not_admitted", "Bootstrap is confined to the reviewed local dev-integration composition.");
  const sourceClient = createWorkspaceIntakeSourceClient({ authorityRoot: intakeConfig.authorityRoot, python: intakeConfig.python,
    provider: createWorkspaceIntakeGitHubClient({ owner: intakeConfig.owner, repositoryId: intakeConfig.repositoryId, tokenFile: intakeConfig.tokenFile, fetchImpl }) });
  const preparations = createRepositoryOwnerBootstrapPreparation({ callerOperatorBindings: sourceConfig.callerOperatorBindings,
    custodySourceReader, intakeSourceClient: sourceClient, sourceReader: createPublicBootstrapSourceReader({ fetchImpl }) });
  const service = createRepositoryOwnerBootstrapService({ callerOperatorBindings: sourceConfig.callerOperatorBindings, preparationService: preparations,
    sourceReader: createPublicBootstrapSourceReader({ fetchImpl }),
    sourceExecutor: createDeliveryArtSourceExecutorClient({ executorId: sourceConfig.executorId, secret: sourceConfig.executorSecret,
      socketPath: sourceConfig.executorSocketPath, requireSourceLease: true }), platformOperations, enabled: true,
    store: createRepositoryOwnerBootstrapStore({ root: path.join(deliveryArtWorkStateRoot(env), "repository-owner-bootstrap") }) });
  return createRepositoryOwnerBootstrapFacade({ service, preparations, operatorBindings: sourceConfig.callerOperatorBindings });
}
