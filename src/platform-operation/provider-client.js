import { HttpError } from "../errors.js";
import {
  assertPlatformOperationCatalog,
  assertPlatformOperationProjection,
} from "./contracts.js";

const MAX_RESPONSE_BYTES = 524_288;

export function createPlatformOperationProviderClient({
  allowHttp = false,
  baseUrl,
  callerId,
  callerSecret,
  fetchImpl = globalThis.fetch,
}) {
  const target = admittedTarget(baseUrl, allowHttp);
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

  const request = async (path, { body, method = "GET" } = {}) => {
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
        signal: AbortSignal.timeout(15_000),
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
      throw new HttpError(
        response.status === 401 || response.status === 403
          ? 403
          : response.status === 409
            ? 409
            : response.status >= 500
              ? 503
              : 502,
        response.status === 401 || response.status === 403
          ? "platform_operation_provider_forbidden"
          : response.status === 409
            ? "platform_operation_provider_conflict"
            : "platform_operation_provider_rejected",
        typeof payload?.message === "string"
          ? payload.message
          : "Platform operation provider rejected the request.",
      );
    }
    return payload;
  };

  return {
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

function admittedTarget(value, allowHttp) {
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
  if (allowHttp === true && target.protocol === "http:" && (local || clusterLocal)) {
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
