import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { HttpError } from "../errors.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { hostSourceConnection } from "./host-source-reader.js";
import { nativeSourceAuthorityRef } from "../repository-owner-bootstrap/private-source-reader.js";
import { instanceSourceLocation } from "./source-location.js";

const helper = fileURLToPath(new URL("../../scripts/read_instance_source_authority.mjs", import.meta.url));
export function createHostSourceGitReader({ workspaceRoot, env = process.env, execute = execFileSync }) {
  const connection = hostSourceConnection(env);
  return ({ authority, operation = "ordinary-source", action, branch = "main", expectedBase = null }) => {
    try {
      const reference = nativeSourceAuthorityRef(authority);
      const selector = { schema_version: 1, owner_repo: authority.owner_repo, operation, action, branch, expected_base: expectedBase, authority_ref: reference };
      const value = JSON.parse(execute(process.execPath, [helper], { input: JSON.stringify({ kind: "checkout", connection, selector }),
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 185000,
        maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"] }));
      const expectedKeys = ["schema_version", "read_scope", "owner_repo", "operation", "authority_ref", "provider_repository", "action", "branch", "remote_commit", "workspace_relative_path", "read_credential_issued", "read_credential_revoked"].sort();
      if (!value || Object.keys(value).sort().join(",") !== expectedKeys.join(",") || value.schema_version !== 1 || value.read_scope !== "repository-checkout" ||
          value.owner_repo !== authority.owner_repo || value.operation !== operation || value.action !== action || value.branch !== branch ||
          value.read_credential_issued !== true || value.read_credential_revoked !== true ||
          canonicalDigest(value.authority_ref) !== canonicalDigest(reference) || canonicalDigest(value.provider_repository) !== canonicalDigest(authority.provider_repository) ||
          value.workspace_relative_path !== path.relative(workspaceRoot, instanceSourceLocation(workspaceRoot, authority).root).split(path.sep).join("/") ||
          !(value.remote_commit === null && action === "ref") && !/^[0-9a-f]{40}$/.test(value.remote_commit ?? "") ||
          expectedBase !== null && value.remote_commit !== expectedBase) throw new Error();
      return value;
    } catch {
      throw new HttpError(503, "instance_records_source_git_unavailable", "The exact authenticated source read is unconfirmed; preserve its checkout and retry the original operation.");
    }
  };
}
