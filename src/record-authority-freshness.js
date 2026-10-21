import { lstat, readFile } from "node:fs/promises";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { HttpError } from "./errors.js";

function assertCheckpoint(value, ownerRepo, now) {
  const observed = Date.parse(value.observed_at);
  const expires = Date.parse(value.valid_until);
  if (value.schema_version !== 1 || value.owner_repo !== ownerRepo ||
      value.trusted_ref !== "refs/remotes/origin/main" ||
      !/^[0-9a-f]{40}$/.test(value.reviewed_revision) ||
      !/^[0-9a-f]{40}$/.test(value.record_revision) ||
      !Number.isFinite(observed) || !Number.isFinite(expires) ||
      observed > now + 30000 || expires <= now || expires <= observed || expires - observed > 600000) {
    throw new Error("stale or mismatched checkpoint");
  }
}

function unavailable() {
  return new HttpError(503, "record_authority_unavailable", "The deployment-owned canonical record snapshot is missing, stale or inconsistent; restore its Platform refresh before continuing.");
}

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
    assertCheckpoint(value, ownerRepo, clock().getTime());
    if (await git(authorityRoot, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}") !== value.record_revision) {
      throw new Error("stale or mismatched checkpoint");
    }
    await git(authorityRoot, "merge-base", "--is-ancestor", value.reviewed_revision, value.record_revision);
  } catch {
    throw unavailable();
  }
}

// The host source executor has synchronous Git admission/review interfaces.
// Reuse the same checkpoint predicate, not another freshness contract or lane.
// The caller's bundled revision is the required contract baseline. Platform
// independently owns the checkpoint's current accepted implementation baseline.
// A legitimate reviewed baseline advance must not require repinning old bundles.
export function requireRecordAuthorityFreshnessSync({ authorityRoot, git, ownerRepo,
  reviewedRevision: requiredRevision, clock = () => new Date() }) {
  try {
    if (!/^[0-9a-f]{40}$/.test(requiredRevision ?? "")) throw new Error("required contract source missing");
    const file = path.join(authorityRoot, ".git", "console-record-authority.json");
    const info = lstatSync(file);
    if (!info.isFile() || info.size > 2048) throw new Error("invalid checkpoint file");
    const value = JSON.parse(readFileSync(file, "utf8"));
    assertCheckpoint(value, ownerRepo, clock().getTime());
    if (git(authorityRoot, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}") !== value.record_revision ||
        git(authorityRoot, "rev-parse", "HEAD") !== value.record_revision ||
        git(authorityRoot, "status", "--porcelain", "--untracked-files=normal")) throw new Error("unproven record source");
    git(authorityRoot, "merge-base", "--is-ancestor", requiredRevision, value.reviewed_revision);
    git(authorityRoot, "merge-base", "--is-ancestor", value.reviewed_revision, value.record_revision);
    return value;
  } catch {
    throw unavailable();
  }
}
