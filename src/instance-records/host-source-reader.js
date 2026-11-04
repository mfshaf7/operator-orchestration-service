import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HttpError } from "../errors.js";
import { assertInstanceSourceProof } from "./source-proof.js";

const helper = fileURLToPath(new URL("../../scripts/read_instance_source_authority.mjs", import.meta.url));
const truth = value => ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());

export function hostSourceConnection(env) {
  return { baseUrl: env.OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL?.trim(),
    callerId: env.OOS_PLATFORM_OPERATION_PROVIDER_CALLER_ID?.trim() || "operator-orchestration-service",
    callerSecret: env.OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET ?? "",
    allowHttp: truth(env.OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP),
    allowPrivateHttp: truth(env.OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_PRIVATE_HTTP) };
}

// Reuse the accepted OOS -> Platform connection. The Platform source reader
// owns WGCF access and current policy. No WGCF/source token reaches the host.
export function createConfiguredHostInstanceSourceReader({ env = process.env, execute = execFileSync } = {}) {
  if (!truth(env.OOS_INSTANCE_RECORDS_ENABLED)) {
    // A retained installation cannot silently revert to public Git on disable.
    if (!env.OOS_INSTANCE_ID?.trim()) return null;
    return () => { throw new HttpError(503, "instance_records_disabled", "Internal source admission is disabled; restore the accepted connection."); };
  }
  const instanceId = env.OOS_INSTANCE_ID?.trim();
  const connection = hostSourceConnection(env);
  return ({ ownerRepo, operation, policyRef }) => {
    try {
      const value = JSON.parse(execute(process.execPath, [helper], {
        input: JSON.stringify({ kind: "authority", connection, selector: { schema_version: 1, owner_repo: ownerRepo, operation } }),
        env: { PATH: process.env.PATH, NODE_NO_WARNINGS: "1" }, encoding: "utf8", timeout: 50000,
        maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"],
      }));
      const proof = assertInstanceSourceProof(value, { instanceId, ownerRepo, operation, policyRef });
      return proof;
    } catch {
      throw new HttpError(503, "instance_records_source_authority_unavailable", "Current internal source admission is unavailable; no alternate registration was selected.");
    }
  };
}
