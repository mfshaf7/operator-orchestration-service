import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors.js";

// Platform owns this non-secret, short-lived checkpoint in its private clone.
// Normal owner checkouts remain compatible outside the commissioned cache lane.
export async function requireRecordAuthorityFreshness({
  authorityRoot, git, ownerRepo, clock = () => new Date(),
  required = process.env.OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED === "true",
}) {
  if (!required) return;
  try {
    const file = path.join(authorityRoot, ".git", "console-record-authority.json");
    const info = await lstat(file);
    if (!info.isFile() || info.size > 2048) throw new Error("invalid checkpoint file");
    const value = JSON.parse(await readFile(file, "utf8"));
    const observed = Date.parse(value.observed_at);
    const expires = Date.parse(value.valid_until);
    const now = clock().getTime();
    if (value.schema_version !== 1 || value.owner_repo !== ownerRepo ||
        value.trusted_ref !== "refs/remotes/origin/main" ||
        !/^[0-9a-f]{40}$/.test(value.reviewed_revision) ||
        !/^[0-9a-f]{40}$/.test(value.record_revision) ||
        !Number.isFinite(observed) || !Number.isFinite(expires) ||
        observed > now + 30000 || expires <= now || expires <= observed || expires - observed > 600000 ||
        await git(authorityRoot, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}") !== value.record_revision) {
      throw new Error("stale or mismatched checkpoint");
    }
    await git(authorityRoot, "merge-base", "--is-ancestor", value.reviewed_revision, value.record_revision);
  } catch {
    throw new HttpError(503, "record_authority_unavailable", "The deployment-owned canonical record snapshot is missing, stale or inconsistent; restore its Platform refresh before continuing.");
  }
}
