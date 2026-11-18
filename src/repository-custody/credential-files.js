import { closeSync, openSync, readSync } from "node:fs";
import { HttpError } from "../errors.js";

// Paths are server configuration, never request input. Read the projected Secret
// afresh for each operation; one operation retains one credential generation.
export function credentialFile(path, limit = 131_072) {
  let fd;
  try {
    fd = openSync(path, "r");
    const bytes = Buffer.alloc(limit + 1);
    let size = 0, count;
    while (size <= limit && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    if (size > limit) throw Error("size");
    return bytes.subarray(0, size).toString("utf8").trim();
  } catch {
    throw new HttpError(503, "repository_credential_unavailable", "The selected GitHub connection needs its current credential. Reconnect the affected account.");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readerCredentialFile(path, clock) {
  try {
    const value = JSON.parse(credentialFile(path, 16_384));
    if (value.schema_version !== 1 || typeof value.account !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.account) ||
        typeof value.token !== "string" || !value.token.startsWith("ghs_") ||
        !(Date.parse(value.expires_at) > clock().getTime() + 30_000)) throw Error("binding");
    return value;
  } catch {
    throw new HttpError(503, "repository_credential_unavailable", "The selected GitHub reader needs its current account credential.");
  }
}

export function installationCredentialFile(path) {
  const token = credentialFile(path, 16_384);
  if (!token.startsWith("ghs_")) throw new HttpError(503, "repository_credential_unavailable", "The selected GitHub connection needs its current credential.");
  return token;
}
