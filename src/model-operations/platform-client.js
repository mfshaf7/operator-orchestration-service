import { readFile } from "node:fs/promises";
import { fail } from "./contracts.js";

export class ModelOwnerError extends Error {
  constructor(code, { status = 503, responseKnown = false } = {}) {
    super("The Platform model-management owner is unavailable or rejected the exact request.");
    this.code = code; this.status = status; this.responseKnown = responseKnown;
  }
}

export function createModelOperationsPlatformClient({ baseUrl, tokenFile, callerId = "operator-orchestration-service", fetchImpl = globalThis.fetch, timeoutMs = 90_000 }) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw fail("configuration_invalid", "Select the accepted Platform model-management endpoint.", 503);
  async function request(path, { operatorId, body, signal } = {}) {
    let token;
    try { token = (await readFile(tokenFile, "utf8")).trim(); } catch { throw new ModelOwnerError("management-credential-unavailable"); }
    if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new ModelOwnerError("management-credential-unavailable");
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`,
          "X-Platform-Caller": callerId, "X-Platform-Operator": operatorId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal].filter(Boolean)),
      });
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > 1_048_576) throw new ModelOwnerError("owner-response-oversized", { status: 502 });
        chunks.push(chunk);
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ModelOwnerError("owner-response-invalid", { status: 502 }); }
      if (!response.ok) {
        const code = typeof value?.error === "string" && /^[a-z0-9_-]{1,100}$/.test(value.error) ? value.error : "owner-rejected";
        throw new ModelOwnerError(code, { status: response.status, responseKnown: true });
      }
      return value;
    } catch (error) {
      if (error instanceof ModelOwnerError) throw error;
      throw new ModelOwnerError("owner-transport-unknown");
    }
  }
  return {
    backends: options => request("/v1/model-management/backends", options),
    configuration: ({ revision = null, ...options }) => request(`/v1/model-management/configuration${revision === null ? "" : `?revision=${revision}`}`, options),
    catalogue: ({ backendId, model = null, ...options }) => {
      const query = new URLSearchParams({ backend_id: backendId }); if (model !== null) query.set("model", model);
      return request(`/v1/model-management/catalogue?${query}`, options);
    },
    command: ({ command, ...options }) => request("/v1/model-management/commands", { ...options, body: command }),
    login: ({ commandId, ...options }) => request(`/v1/model-management/account-login?${new URLSearchParams({ command_id: commandId })}`, options),
  };
}
