import { createHash } from "node:crypto";
import path from "node:path";

// Native projects use the existing managed-source area, never the public root
// owner index. The installation namespace is derived, not a caller path.
export function instanceSourceLocation(workspaceRoot, authority) {
  const owner = authority?.owner_repo, native = authority?.canonical_authority;
  if (!path.isAbsolute(workspaceRoot ?? "") || native?.kind !== "internal-instance-record" ||
      native.record_id !== `repo:${owner}` ||
      !/^[a-z0-9][a-z0-9._-]{0,185}$/.test(owner ?? "")) throw new Error("A current installation-bound source owner is required.");
  const relative = instanceSourceRelativeRoot(native.instance_id);
  return { root: path.join(workspaceRoot, relative, "repositories", owner),
    worktreePrefix: `${relative}/worktrees` };
}

function instanceSourceRelativeRoot(instanceId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(instanceId ?? "")) {
    throw new Error("A valid installation identity is required for managed source.");
  }
  const namespace = createHash("sha256").update(instanceId, "utf8").digest("hex").slice(0, 32);
  return `.worktrees/instance-sources/${namespace}`;
}

export function instanceSourceWorktreePrefix(instanceId) {
  return `${instanceSourceRelativeRoot(instanceId)}/worktrees`;
}

export function sourceWorktreeRelativePath(original, location) {
  if (!location) return original;
  if (typeof original !== "string" || !original.startsWith(".worktrees/") ||
      original.split("/").some(part => ["", ".", ".."].includes(part))) throw new Error("Source worktrees must retain the existing managed layout.");
  return `${location.worktreePrefix}/${original.slice(".worktrees/".length)}`;
}
