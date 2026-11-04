import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

// Read only the fixed Platform binding beside the already commissioned record
// cache. Never source runtime shell text, select a browser path or print values.
export function applyHostSourceBinding(env = process.env) {
  const authorityRoot = env.OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT;
  if (!authorityRoot || !path.isAbsolute(authorityRoot)) {
    if (env.OOS_INSTANCE_RECORDS_ENABLED === "true") throw new Error("Native source requires its current commissioned record cache.");
    return env;
  }
  const privateRoot = path.join(path.dirname(path.dirname(authorityRoot)), "private");
  const file = path.join(privateRoot, "instance-source-host.json");
  if (!existsSync(file)) {
    if (env.OOS_INSTANCE_RECORDS_ENABLED === "true") throw new Error("The installation source binding is missing; restore its accepted preparation.");
    return env;
  }
  const directory = lstatSync(privateRoot), info = lstatSync(file);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid() || directory.mode & 0o077 ||
      !info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o077 || info.size > 16384 || realpathSync(privateRoot) !== privateRoot) {
    throw new Error("The protected source binding is not regular installation-private state.");
  }
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!value || Object.keys(value).sort().join(",") !== "connection,instance_id,schema_version" || value.schema_version !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.instance_id ?? "") ||
      !value.connection || Object.keys(value.connection).sort().join(",") !== "allowHttp,allowPrivateHttp,baseUrl,callerId,callerSecret" ||
      value.connection.callerId !== "operator-orchestration-service" || typeof value.connection.callerSecret !== "string" || value.connection.callerSecret.length < 32 ||
      value.connection.allowHttp !== true || value.connection.allowPrivateHttp !== true) throw new Error("The protected source binding is invalid.");
  if (env.OOS_INSTANCE_ID && env.OOS_INSTANCE_ID !== value.instance_id) throw new Error("The source installation identity changed; recover its original binding.");
  return { ...env, OOS_INSTANCE_ID: value.instance_id,
    OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL: value.connection.baseUrl,
    OOS_PLATFORM_OPERATION_PROVIDER_CALLER_ID: value.connection.callerId,
    OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET: value.connection.callerSecret,
    OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP: "true", OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_PRIVATE_HTTP: "true" };
}
