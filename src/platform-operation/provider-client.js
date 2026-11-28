import { assertGovernedProductProjection } from "./governed-product-contracts.js";
import { isIP } from "node:net";
import { HttpError } from "../errors.js";
import { githubReadThrottled } from "../github-read.js";
import { assertDevIntegrationProfileProjection } from "./dev-integration-contracts.js";
import {
  assertPlatformOperationCatalog,
  assertPlatformOperationProjection,
} from "./contracts.js";

const MAX_RESPONSE_BYTES = 524_288;

export function createPlatformOperationProviderClient({
  allowHttp = false,
  allowPrivateHttp = false,
  baseUrl,
  callerId,
  callerSecret,
  fetchImpl = globalThis.fetch,
}) {
  const target = admittedTarget(baseUrl, allowHttp, allowPrivateHttp);
  if (
    !target ||
    typeof fetchImpl !== "function" ||
    typeof callerId !== "string" ||
    !callerId.trim() ||
    typeof callerSecret !== "string" ||
    callerSecret.length < 32
  ) {
    throw new HttpError(
      503,
      "platform_operation_provider_not_configured",
      "Platform operation provider requires an admitted destination and server-held caller credential.",
    );
  }

  const request = async (path, { body, method = "GET", timeoutMs = 15000 } = {}) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, target), {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-platform-caller-id": callerId,
          "x-platform-caller-secret": callerSecret,
        },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpError(
        503,
        "platform_operation_provider_unavailable",
        "Platform operation provider could not be reached.",
      );
    }
    const payload = await boundedJson(response);
    if (!response.ok) {
      if (response.status === 429 && payload?.code === "github_read_throttled") {
        const retryAt = Date.parse(payload.retry_at);
        if (Number.isFinite(retryAt)) throw githubReadThrottled(retryAt);
      }
      if (response.status === 403 && payload?.code === "github_source_connection_required") {
        throw new HttpError(403, "github_source_connection_required",
          "Check that the GitHub Source App has access to this repository, then retry the same request.");
      }
      const providerFailure = response.status === 401 || response.status === 403
        ? {
            code: "platform_operation_provider_forbidden",
            message: "Platform operation provider denied the authenticated OOS caller.",
            status: 403,
          }
        : response.status === 409
          ? {
              code: "platform_operation_provider_conflict",
              message: "Platform operation provider reported a state conflict.",
              status: 409,
            }
          : response.status >= 500
            ? {
                code: "platform_operation_provider_unavailable",
                message: "Platform operation provider is unavailable.",
                status: 503,
              }
            : {
                code: "platform_operation_provider_rejected",
                message: "Platform operation provider rejected the bounded request.",
                status: 502,
              };
      throw new HttpError(
        providerFailure.status,
        providerFailure.code,
        providerFailure.message,
      );
    }
    return payload;
  };

  return {
    readProjectRuntimeSetup: binding => request("/v1/console-operations/project-runtime/setup/read", { body: binding, method: "POST" }),
    submitProjectRuntime: binding => request("/v1/console-operations/project-runtime/run", { body: binding, method: "POST" }),
    readProjectRuntime: ({ scope, command_id, operation_id }) => request("/v1/console-operations/project-runtime/read", {
      body: { scope, command_id, operation_id }, method: "POST",
    }),
    controlProjectRuntime: command => request("/v1/console-operations/project-runtime/control", { body: command, method: "POST" }),
    prepareModelProfile: input => request('/v1/console-operations/model-profiles/prepare',{body:input,method:'POST'}),
    inspectModelProfile: input => request('/v1/console-operations/model-profiles/inspect',{body:input,method:'POST'}),
    controlModelProfile: input => request('/v1/console-operations/model-profiles/control',{body:input,method:'POST',timeoutMs:30000}),
    async sourceCheckout(input) {
      return request("/v1/console-operations/source-checkout", { body: input, method: "POST", timeoutMs: 180000 });
    },
    async inspectSourceAuthority(input) {
      return request("/v1/console-operations/source-authority/inspect", { body: input, method: "POST", timeoutMs: 45000 });
    },
    async inspectOwnerControls(input) {
      // A bounded private read, not a command or an operation journal payload.
      return request("/v1/console-operations/source-controls/inspect", { body: input, method: "POST", timeoutMs: 90000 });
    },
    async inspectPrototypeImport(input) {
      return request("/v1/console-operations/prototype-import/inspect", { body: input, method: "POST", timeoutMs: 90_000 });
    },
    async getGovernedProducts(query = {}) {
      return assertGovernedProductProjection(await request(`/v1/console-operations/governed-products?${new URLSearchParams(query)}`));
    },
    async getDevIntegrationProfiles(query = {}) {
      const allowed = new Set(["limit", "offset", "q", "owner", "lifecycle", "lane", "profile_id"]);
      if (Object.keys(query).some(key => !allowed.has(key)))
        throw new HttpError(400, "dev_integration_query_invalid", "Unsupported profile filter.");
      return assertDevIntegrationProfileProjection(await request(
        `/v1/console-operations/dev-integration/profiles?${new URLSearchParams(query)}`));
    },
    async readPrototypeClosureDisposition(lookup) {
      return request("/v1/console-operations/prototype-closure-dispositions", {
        body: lookup, method: "POST",
      });
    },
    async getCatalog() {
      return assertPlatformOperationCatalog(
        await request("/v1/console-operations/catalog"),
      );
    },
    async submit(command) {
      return assertPlatformOperationProjection(
        await request("/v1/console-operations/commands", {
          body: { command },
          method: "POST",
        }),
        command,
      );
    },
    async readByCommand(command) {
      return assertPlatformOperationProjection(
        await request(
          `/v1/console-operations/by-command/${encodeURIComponent(command.command_id)}`,
        ),
        command,
      );
    },
    async control(command, providerOperationId, control) {
      return assertPlatformOperationProjection(
        await request(
          `/v1/console-operations/${encodeURIComponent(providerOperationId)}/controls`,
          { body: { control }, method: "POST" },
        ),
        command,
      );
    },
  };
}

function admittedTarget(value, allowHttp, allowPrivateHttp) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.username || target.password || target.search || target.hash) return null;
  if (target.protocol === "https:") return target;
  const hostname = target.hostname.toLowerCase();
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
  const clusterLocal = hostname.endsWith(".svc.cluster.local");
  const parts = hostname.split(".").map(Number);
  const privateHost = allowPrivateHttp === true && isIP(hostname) === 4 &&
    (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  if (allowHttp === true && target.protocol === "http:" && (local || clusterLocal || privateHost)) {
    return target;
  }
  return null;
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      502,
      "platform_operation_provider_response_too_large",
      "Platform operation provider response exceeded the allowed size.",
    );
  }
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new HttpError(
      503,
      "platform_operation_provider_unavailable",
      "Platform operation provider response could not be read.",
    );
  }
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new HttpError(
      502,
      "platform_operation_provider_response_too_large",
      "Platform operation provider response exceeded the allowed size.",
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(
      502,
      "platform_operation_provider_response_invalid",
      "Platform operation provider returned invalid JSON.",
    );
  }
}
