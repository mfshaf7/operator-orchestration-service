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

function providerHeaders(installationToken, { json = false } = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${installationToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
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

function assertSupportedRequest(request) {
  if (request.target.provider !== "github" || request.target.provider_host !== "github.com") {
    throw new HttpError(
      409,
      "repository_provider_not_supported",
      "The configured provider adapter does not support the requested provider.",
    );
  }
}

function providerFailure(response, { create = false } = {}) {
  if (create && response.status === 422) {
    return new HttpError(
      409,
      "repository_provider_name_conflict",
      "The organization already has a repository with the requested name or rejected its settings.",
    );
  }
  return new HttpError(
    response.status === 404
      ? 404
      : response.status === 429 || response.status >= 500
        ? 503
        : 502,
    response.status === 404
      ? "repository_provider_not_found"
      : "repository_provider_unavailable",
    "The repository provider could not complete the requested operation.",
  );
}

function appliedProvisioning(body) {
  return {
    owner_scope: "organization",
    initialization_state: "initialized",
    settings: {
      description: body.description ?? null,
      visibility: body.visibility ?? (body.private ? "private" : "public"),
      initialize_with_readme: true,
      features: {
        issues: body.has_issues === true,
        projects: body.has_projects === true,
        wiki: body.has_wiki === true,
        discussions: body.has_discussions === true,
      },
      merge_policy: {
        allow_squash_merge: body.allow_squash_merge === true,
        allow_merge_commit: body.allow_merge_commit === true,
        allow_rebase_merge: body.allow_rebase_merge === true,
        delete_branch_on_merge: body.delete_branch_on_merge === true,
      },
    },
  };
}

export function createGitHubRepositoryProviderClient({
  apiBaseUrl = "https://api.github.com",
  clock = () => new Date(),
  fetchImpl = globalThis.fetch,
  installationToken,
}) {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");

  function assertConfigured(request) {
    if (!configured(installationToken) || typeof fetchImpl !== "function") {
      throw new HttpError(
        503,
        "repository_provider_not_configured",
        "The repository provider identity is not active.",
      );
    }
    assertSupportedRequest(request);
  }

  async function providerRequest(url, options = {}) {
    try {
      return await fetchImpl(url, options);
    } catch {
      throw new HttpError(
        503,
        "repository_provider_unavailable",
        "The repository provider could not be reached.",
      );
    }
  }

  async function readRepository(request, response, expectedRepositoryId = null) {
    if (!response.ok) throw providerFailure(response);
    const body = await readBoundedJson(response);
    const providerRepositoryId = String(body?.id ?? "");
    if (
      !/^[1-9][0-9]*$/.test(providerRepositoryId) ||
      (expectedRepositoryId !== null && providerRepositoryId !== expectedRepositoryId) ||
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
    if (request.action === "provision-new") {
      const readme = await providerRequest(
        `${baseUrl}/repos/${encodeURIComponent(body.owner.login)}/${encodeURIComponent(body.name)}/readme`,
        { headers: providerHeaders(installationToken) },
      );
      if (!readme.ok) {
        throw new HttpError(
          readme.status === 404 ? 409 : 503,
          readme.status === 404
            ? "repository_provider_initialization_missing"
            : "repository_provider_unavailable",
          "Provider readback did not prove the required initialized README state.",
        );
      }
    }
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
      action: request.action,
      repository_identity: {
        provider: request.target.provider,
        provider_repository_id: providerRepositoryId,
      },
      canonical_owner: body.owner.login,
      canonical_name: body.name,
      canonical_url: body.html_url,
      default_branch: body.default_branch,
      visibility: body.visibility ?? (body.private ? "private" : "public"),
      provider_lifecycle_state: body.archived ? "archived" : "active",
      provider_version: String(version ?? "").trim(),
      credential_binding_ref: request.authority.credential_binding_ref,
      applied_provisioning: request.action === "provision-new"
        ? appliedProvisioning(body)
        : null,
    });
    return assertRepositoryProviderReadback(readback);
  }

  return {
    async create(request, approvedProvisioning) {
      assertConfigured(request);
      const settings = approvedProvisioning.settings;
      const response = await providerRequest(
        `${baseUrl}/orgs/${encodeURIComponent(approvedProvisioning.owner)}/repos`,
        {
          method: "POST",
          headers: providerHeaders(installationToken, { json: true }),
          body: JSON.stringify({
            name: approvedProvisioning.name,
            description: settings.description,
            visibility: settings.visibility,
            auto_init: settings.initialize_with_readme,
            has_issues: settings.features.issues,
            has_projects: settings.features.projects,
            has_wiki: settings.features.wiki,
            has_discussions: settings.features.discussions,
            allow_squash_merge: settings.merge_policy.allow_squash_merge,
            allow_merge_commit: settings.merge_policy.allow_merge_commit,
            allow_rebase_merge: settings.merge_policy.allow_rebase_merge,
            delete_branch_on_merge: settings.merge_policy.delete_branch_on_merge,
          }),
        },
      );
      if (!response.ok) throw providerFailure(response, { create: true });
      const body = await readBoundedJson(response);
      const providerRepositoryId = String(body?.id ?? "");
      if (
        !/^[1-9][0-9]*$/.test(providerRepositoryId) ||
        body?.owner?.login?.toLowerCase() !== approvedProvisioning.owner.toLowerCase() ||
        body?.name?.toLowerCase() !== approvedProvisioning.name.toLowerCase()
      ) {
        throw new HttpError(
          409,
          "repository_provider_create_acknowledgement_mismatch",
          "Provider creation did not acknowledge the approved repository coordinates.",
        );
      }
      return { providerRepositoryId };
    },

    async find(request) {
      assertConfigured(request);
      const response = await providerRequest(
        `${baseUrl}/repos/${encodeURIComponent(request.target.owner)}/${encodeURIComponent(request.target.name)}`,
        { headers: providerHeaders(installationToken) },
      );
      if (response.status === 404) return null;
      return readRepository(request, response);
    },

    async read(request, { providerRepositoryId = request.target.provider_repository_id } = {}) {
      assertConfigured(request);
      if (!/^[1-9][0-9]*$/.test(String(providerRepositoryId ?? ""))) {
        throw new HttpError(
          409,
          "repository_provider_identity_missing",
          "Provider readback requires the positive decimal repository id.",
        );
      }
      const response = await providerRequest(
        `${baseUrl}/repositories/${encodeURIComponent(providerRepositoryId)}`,
        { headers: providerHeaders(installationToken) },
      );
      return readRepository(request, response, String(providerRepositoryId));
    },
  };
}
