import { proposalTargetError, proposalTargetManifest } from "./contracts.js";
import { createProposalTargetGitHubClient } from "./provider-client.js";
import { createProposalTargetService } from "./service.js";
import { createProposalTargetSourceClient } from "./source-client.js";
import { createProposalTargetStore } from "./store.js";

export function createProposalTargetRuntime({ audit, config, fetchImpl, proposalWorkflowService }) {
  if (!config?.enabled) return null;
  if (proposalTargetManifest.runtime_activation !== true || config.profile !== "dev-integration") {
    throw proposalTargetError("activation_required", "Proposal target application awaits the reviewed Security and Platform activation chain.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) throw proposalTargetError("configuration_missing", `Proposal target application requires ${name}.`, 503);
  }
  if (!proposalWorkflowService) throw proposalTargetError("configuration_missing", "Proposal target application requires the Proposal workflow authority.", 503);
  const provider = createProposalTargetGitHubClient({ owner: config.owner, repositoryId: config.repositoryId, tokenFile: config.tokenFile, fetchImpl });
  return createProposalTargetService({
    audit,
    proposalWorkflowService,
    store: createProposalTargetStore({ root: config.stateRoot }),
    sourceClient: createProposalTargetSourceClient({ authorityRoot: config.authorityRoot, provider, python: config.python }),
  });
}
