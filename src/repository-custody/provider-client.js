import { HttpError } from "../errors.js";
import {
  assertRepositoryProviderReadback,
  withArtifactIntegrity,
} from "./contracts.js";

const MAX_PROVIDER_RESPONSE_BYTES = 262_144;

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readbackId(request) {
  return `repository-provider-readback:${request.request_id.split(":").at(-1)}`;
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new HttpError(
      502,
      "repository_provider_response_too_large",
      "The repository provider response exceeded the allowed size.",
    );
  }
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new HttpError(
      503,
      "repository_provider_unavailable",
      "The repository provider response could not be read.",
    );
  }
  if (bytes.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new HttpError(
      502,
      "repository_provider_response_too_large",
      "The repository provider response exceeded the allowed size.",
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(
      502,
      "repository_provider_response_invalid",
      "The repository provider returned invalid JSON.",
    );
  }
}

export function createGitHubRepositoryProviderClient({
  apiBaseUrl = "https://api.github.com",
  clock = () => new Date(),
  fetchImpl = globalThis.fetch,
  installationToken,
}) {
  return {
    async read(request) {
      if (!configured(installationToken) || typeof fetchImpl !== "function") {
        throw new HttpError(
          503,
          "repository_provider_not_configured",
          "The repository provider identity is not active.",
        );
      }
      if (request.target.provider !== "github" || request.target.provider_host !== "github.com") {
        throw new HttpError(
          409,
          "repository_provider_not_supported",
          "The configured provider adapter does not support the requested provider.",
        );
      }
      let response;
      try {
        response = await fetchImpl(
          `${apiBaseUrl.replace(/\/+$/, "")}/repositories/${encodeURIComponent(request.target.provider_repository_id)}`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${installationToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );
      } catch {
        throw new HttpError(
          503,
          "repository_provider_unavailable",
          "The repository provider could not be reached.",
        );
      }
      if (!response.ok) {
        throw new HttpError(
          response.status === 404
            ? 404
            : response.status === 429 || response.status >= 500
              ? 503
              : 502,
          response.status === 404
            ? "repository_provider_not_found"
            : "repository_provider_unavailable",
          "The repository provider did not return the requested repository.",
        );
      }
      const body = await readBoundedJson(response);
      if (
        String(body?.id ?? "") !== request.target.provider_repository_id ||
        !body?.owner?.login ||
        !body?.name ||
        !body?.html_url ||
        !body?.default_branch
      ) {
        throw new HttpError(
          409,
          "repository_provider_identity_mismatch",
          "Provider readback does not match the approved immutable repository identity.",
        );
      }
      const visibility = body.visibility ?? (body.private ? "private" : "public");
      const version = response.headers?.get?.("etag") ?? body.updated_at;
      const readback = withArtifactIntegrity({
        schema_version: 1,
        artifact_type: "repository_provider_readback",
        readback_id: readbackId(request),
        request_ref: {
          uri: `wgcf://requests/repository-custody/${request.request_digest.slice(7)}.json`,
          digest: request.request_digest,
        },
        observed_at: clock().toISOString(),
        repository_identity: {
          provider: request.target.provider,
          provider_repository_id: String(body.id),
        },
        canonical_owner: body.owner.login,
        canonical_name: body.name,
        canonical_url: body.html_url,
        default_branch: body.default_branch,
        visibility,
        provider_lifecycle_state: body.archived ? "archived" : "active",
        provider_version: String(version ?? "").trim(),
        credential_binding_ref: request.authority.credential_binding_ref,
      });
      return assertRepositoryProviderReadback(readback);
    },
  };
}
