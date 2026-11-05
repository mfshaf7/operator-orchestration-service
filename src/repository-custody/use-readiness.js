import {HttpError} from "../errors.js";

// Compose existing Inventory/WGCF readiness with the already approved Studio
// publication boundary. This stores no second onboarding state.
export function createRepositoryUseReadiness({catalogService, inventoryService, custodyService}) {
  return async ({callerId, correlationId, repoName, target}) => {
    const result = await catalogService.prepareRepositoryReadiness({callerId, correlationId, request: {schema_version: 1, repo_name: repoName}});
    if (target !== "prototype" || typeof inventoryService?.repositorySourceAuthority !== "function") return result;
    const proof = await inventoryService.repositorySourceAuthority({repoName});
    // Existing Git-backed publication keeps its original reviewed boundary.
    if (proof === null) return result;
    const binding = proof?.provider_repository;
    const coordinates = /^([^/]+)\/([^/]+)$/.exec(binding?.full_name ?? "");
    if (!coordinates || typeof custodyService?.lookup !== "function") throw new HttpError(503, "proposal_repository_route_unavailable", "Source visibility could not be verified for Prototype Studio. No project metadata was published.");
    const current = await custodyService.lookup({owner: coordinates[1], name: coordinates[2]});
    if (current.provider_repository_id !== binding.provider_repository_id || current.owner !== coordinates[1] || current.name !== coordinates[2] || current.visibility !== "public" || current.provider_lifecycle_state !== "active") {
      throw new HttpError(409, "proposal_repository_route_unavailable", "This Prototype Studio route requires verified public source. Use the private-capable Delivery route for private work; onboarding does not authorize public Studio publication.");
    }
    return result;
  };
}
