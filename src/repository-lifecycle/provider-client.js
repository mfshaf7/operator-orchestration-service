import { HttpError } from "../errors.js";
import { withRepositoryLifecycleIntegrity } from "./contracts.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_RESPONSE_BYTES = 262_144;

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function headers(token, { json = false } = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new HttpError(502, "repository_provider_response_too_large", "Provider response exceeded the allowed size.");
  }
  let bytes;
  try { bytes = new Uint8Array(await response.arrayBuffer()); } catch {
    throw new HttpError(503, "repository_provider_unavailable", "Provider response could not be read.");
  }
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new HttpError(502, "repository_provider_response_too_large", "Provider response exceeded the allowed size.");
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch {
    throw new HttpError(502, "repository_provider_response_invalid", "Provider returned invalid JSON.");
  }
}

function providerError(response) {
  return new HttpError(
    response.status === 404 ? 404 : response.status === 429 || response.status >= 500 ? 503 : 502,
    response.status === 404 ? "repository_provider_not_found" : "repository_provider_unavailable",
    "Repository provider could not complete the lifecycle operation.",
  );
}

export function createGitHubRepositoryLifecycleClient({
  apiBaseUrl = GITHUB_API_BASE_URL,
  clock = () => new Date(),
  fetchImpl = globalThis.fetch,
  installationToken,
  sandbox = false,
}) {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(baseUrl); } catch {
    throw new HttpError(503, "repository_provider_destination_not_admitted", "Provider destination is not admitted.");
  }
  const loopback = sandbox === true && parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (baseUrl !== GITHUB_API_BASE_URL && !loopback) {
    throw new HttpError(503, "repository_provider_destination_not_admitted", "Provider destination is not admitted.");
  }

  function assertReady(request) {
    if (
      request.repository_identity.provider !== "github" ||
      !configured(installationToken) ||
      typeof fetchImpl !== "function"
    ) {
      throw new HttpError(503, "repository_provider_not_configured", "Governed lifecycle provider identity is not active.");
    }
  }

  async function providerRequest(url, options = {}) {
    try { return await fetchImpl(url, { ...options, redirect: "error" }); } catch {
      throw new HttpError(503, "repository_provider_unavailable", "Repository provider could not be reached.");
    }
  }

  async function read(request) {
    assertReady(request);
    const id = request.repository_identity.provider_repository_id;
    const response = await providerRequest(`${baseUrl}/repositories/${encodeURIComponent(id)}`, {
      headers: headers(installationToken),
    });
    if (!response.ok) throw providerError(response);
    const body = await boundedJson(response);
    if (String(body?.id ?? "") !== id || !body?.owner?.login || !body?.name) {
      throw new HttpError(409, "repository_provider_identity_mismatch", "Provider readback does not match immutable repository identity.");
    }
    const version = String(response.headers?.get?.("etag") ?? body.updated_at ?? "").trim();
    if (!version) {
      throw new HttpError(409, "repository_provider_version_missing", "Provider readback did not include a version.");
    }
    return withRepositoryLifecycleIntegrity({
      readback_id: `repository-lifecycle-provider-readback:${request.request_id.split(":").at(-1)}`,
      observed_at: clock().toISOString(),
      repository_identity: structuredClone(request.repository_identity),
      provider_lifecycle_state: body.archived === true ? "archived" : "active",
      provider_version: version,
      coordinates: { owner: body.owner.login, name: body.name },
    });
  }

  return {
    read,
    async setArchived(request, archived) {
      const before = await read(request);
      const response = await providerRequest(
        `${baseUrl}/repos/${encodeURIComponent(before.coordinates.owner)}/${encodeURIComponent(before.coordinates.name)}`,
        {
          method: "PATCH",
          headers: headers(installationToken, { json: true }),
          body: JSON.stringify({ archived }),
        },
      );
      if (!response.ok) throw providerError(response);
      const acknowledged = await boundedJson(response);
      if (String(acknowledged?.id ?? "") !== request.repository_identity.provider_repository_id) {
        throw new HttpError(409, "repository_provider_identity_mismatch", "Provider acknowledgement changed repository identity.");
      }
      return read(request);
    },
  };
}
