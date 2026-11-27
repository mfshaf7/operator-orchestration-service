// Source-owner metadata must not cross a public record-publication boundary
// merely because its canonical custody or registration request is valid.
export async function assertRepositoryRecordPublication({ sourceRepository, readAuthority, readMetadata, error }) {
  // Legacy non-provider entrant classification retains its existing route.
  if (sourceRepository == null) return;
  if (sourceRepository.provider !== "github" || !/^[1-9][0-9]*$/.test(sourceRepository.provider_repository_id ?? "") ||
      !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceRepository.full_name ?? "")) {
    throw error("publication_visibility_unproven", "Repository publication requires its exact canonical provider identity.");
  }
  const destination = await readAuthority();
  if (destination?.private === true && ["private", "internal"].includes(destination.visibility)) return;
  if (destination?.private !== false || destination.visibility !== "public") {
    throw error("publication_visibility_unproven", "The records authority visibility could not be verified; no source publication is allowed.");
  }
  let observed;
  if (typeof readMetadata !== "function") {
    throw error("publication_connection_required", "Connect the GitHub account that owns this repository before publishing its record.", 503);
  }
  try { observed = await readMetadata(sourceRepository); }
  catch (caught) {
    if (caught?.code === "github_read_throttled") throw caught;
    if (["repository_connection_not_ready", "repository_connection_account_denied",
      "repository_provider_owner_not_admitted", "repository_provider_not_configured"].includes(caught?.code)) {
      throw error("publication_connection_required", "Connect the GitHub account that owns this repository before publishing its record.", 503);
    }
    if (caught?.statusCode >= 500) {
      throw error("publication_visibility_unavailable", "Repository visibility is temporarily unavailable. Retain the original request and retry its visibility check before publication.", 503);
    }
    throw error("publication_visibility_unproven", "Verify repository access through the connected GitHub account before publishing its record.");
  }
  if (!observed || typeof observed !== "object" || Array.isArray(observed) ||
      observed.provider_repository_id !== sourceRepository.provider_repository_id ||
      `${observed.owner}/${observed.name}` !== sourceRepository.full_name ||
      !["public", "private", "internal"].includes(observed.visibility)) {
    throw error("publication_visibility_unproven", "GitHub did not verify visibility for the exact registered repository.");
  }
  if (observed.visibility !== "public") {
    throw error("private_records_authority_required", "Repository metadata cannot be published to a public records authority. Keep its registration private.");
  }
}
