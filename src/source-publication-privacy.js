// Source-owner metadata must not cross a public record-publication boundary
// merely because its canonical custody or registration request is valid.
export async function assertRepositoryRecordPublication({ sourceRepository, readAuthority, readPublicMetadata, error }) {
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
  try { observed = await readPublicMetadata(sourceRepository.provider_repository_id); }
  catch (caught) {
    if (caught?.statusCode >= 500) {
      throw error("publication_visibility_unavailable", "Repository visibility is temporarily unavailable. Retain the original request and retry its visibility check before publication.", 503);
    }
    throw error("private_records_authority_required", "Repository metadata cannot be confirmed public. Private registration needs a private records authority; no source was published.");
  }
  if (!observed || typeof observed !== "object" || Array.isArray(observed) ||
      String(observed.id) !== sourceRepository.provider_repository_id || observed.full_name !== sourceRepository.full_name ||
      observed.private !== false || observed.visibility !== "public") {
    throw error("private_records_authority_required", "Repository metadata cannot be published to a public records authority. Keep its registration private.");
  }
}
