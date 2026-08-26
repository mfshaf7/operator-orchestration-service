import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";

const REQUEST_PATH = "/v1/source-actions";
const MAX_BODY_BYTES = 1024 * 1024;
const ACTIONS = Object.freeze({
  "lifecycle.inspect-pull-request": ({ lifecycleSource }, input) =>
    lifecycleSource.pullRequest(input.landing_unit, input.binding ?? null),
  "lifecycle.inspect-source": ({ lifecycleSource }, input) =>
    lifecycleSource.inspect(input.landing_unit),
  "work.ensure-owned-worktree": ({ workSource }, input) =>
    workSource.ensureOwnedWorktree(input.session),
  "work.ensure-worktree": ({ workSource }, input) =>
    workSource.ensureWorktree(input.session),
  "work.inspect-pull-request": ({ workSource }, input) =>
    workSource.inspectPullRequest(input.session),
  "work.inspect-resource-ownership": ({ workSource }, input) =>
    workSource.inspectResourceOwnership(input.session),
  "work.plan-resource-retirement": ({ workSource }, input) =>
    workSource.planResourceRetirement(input),
  "work.prepare-resource-retirement": ({ workSource }, input) =>
    workSource.prepareResourceRetirementExecution(input.session),
  "work.read-artifact": ({ workSource }, input) =>
    workSource.readArtifact(input.location),
  "work.resolve-base": ({ workSource }, input) => workSource.resolveBase(input),
  "work.resolve-worktree": ({ workSource }, input) =>
    workSource.resolveWorktree(input.session),
  "work.retire-resource": ({ workSource }, input) =>
    workSource.retireResource(input),
});

export class DeliveryArtSourceExecutorError extends Error {
  constructor(code, message, { details = null, statusCode = 502 } = {}) {
    super(message);
    this.name = "DeliveryArtSourceExecutorError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

function equalSecret(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function jsonResponse(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new DeliveryArtSourceExecutorError(
        "delivery_art_source_executor_request_too_large",
        "Source executor requests are limited to one MiB.",
        { statusCode: 413 },
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DeliveryArtSourceExecutorError(
      "delivery_art_source_executor_request_invalid",
      "Source executor request body must be valid JSON.",
      { statusCode: 400 },
    );
  }
}

function assertContext(context) {
  const required = ["caller_id", "operator_id", "work_item_id"];
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    required.some((field) => typeof context[field] !== "string" || !context[field])
  ) {
    throw new DeliveryArtSourceExecutorError(
      "delivery_art_source_executor_context_invalid",
      "Source actions require caller, operator, and work-item bindings.",
      { statusCode: 400 },
    );
  }
}

function boundedError(error) {
  if (error instanceof DeliveryArtSourceExecutorError) return error;
  return new DeliveryArtSourceExecutorError(
    typeof error?.code === "string"
      ? error.code
      : "delivery_art_source_executor_action_failed",
    error instanceof Error ? error.message : String(error),
    { details: error?.details ?? null, statusCode: 409 },
  );
}

export function createDeliveryArtSourceExecutorServer({
  adapters,
  audit = () => {},
  executorId,
  secret,
} = {}) {
  if (!adapters?.lifecycleSource || !adapters?.workSource) {
    throw new Error("lifecycleSource and workSource adapters are required");
  }
  if (typeof executorId !== "string" || !executorId) {
    throw new Error("executorId is required");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("source executor secret must contain at least 32 characters");
  }

  return createServer(async (request, response) => {
    const healthRequest = request.method === "GET" && request.url === "/healthz";
    const actionRequest = request.method === "POST" && request.url === REQUEST_PATH;
    if (!healthRequest && !actionRequest) {
      jsonResponse(response, 404, { error: "not_found" });
      return;
    }
    if (
      request.headers["x-oos-source-executor-id"] !== executorId ||
      !equalSecret(request.headers["x-oos-source-executor-secret"], secret)
    ) {
      jsonResponse(response, 401, {
        error: "delivery_art_source_executor_unauthorized",
        message: "Source executor authentication failed.",
      });
      return;
    }
    if (healthRequest) {
      jsonResponse(response, 200, {
        executor_id: executorId,
        ok: true,
        state: "ready",
      });
      return;
    }

    let envelope = null;
    try {
      envelope = await readJson(request);
      if (
        envelope?.schema_version !== 1 ||
        typeof envelope.action !== "string" ||
        !envelope.input ||
        typeof envelope.input !== "object" ||
        Array.isArray(envelope.input)
      ) {
        throw new DeliveryArtSourceExecutorError(
          "delivery_art_source_executor_request_invalid",
          "Source executor request envelope is invalid.",
          { statusCode: 400 },
        );
      }
      assertContext(envelope.context);
      const action = ACTIONS[envelope.action];
      if (!action) {
        throw new DeliveryArtSourceExecutorError(
          "delivery_art_source_executor_action_unsupported",
          `Unsupported source action: ${envelope.action}.`,
          { statusCode: 400 },
        );
      }
      const result = await action(adapters, envelope.input);
      audit({
        action: envelope.action,
        caller_id: envelope.context.caller_id,
        command_id: envelope.context.command_id ?? null,
        executor_id: executorId,
        operator_id: envelope.context.operator_id,
        outcome: "completed",
        session_id: envelope.context.session_id ?? null,
        work_item_id: envelope.context.work_item_id,
      });
      jsonResponse(response, 200, { ok: true, result });
    } catch (error) {
      const bounded = boundedError(error);
      audit({
        action: envelope?.action ?? null,
        caller_id: envelope?.context?.caller_id ?? null,
        command_id: envelope?.context?.command_id ?? null,
        error_code: bounded.code,
        executor_id: executorId,
        operator_id: envelope?.context?.operator_id ?? null,
        outcome: "failed",
        session_id: envelope?.context?.session_id ?? null,
        work_item_id: envelope?.context?.work_item_id ?? null,
      });
      jsonResponse(response, bounded.statusCode, {
        error: bounded.code,
        message: bounded.message,
        details: bounded.details,
      });
    }
  });
}

function socketRequest({ body = null, executorId, method = "POST", path, secret, socketPath }) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const request = httpRequest({
      headers: {
        ...(payload === null
          ? {}
          : {
              "content-length": Buffer.byteLength(payload),
              "content-type": "application/json",
            }),
        "x-oos-source-executor-id": executorId,
        "x-oos-source-executor-secret": secret,
      },
      method,
      path,
      socketPath,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(new DeliveryArtSourceExecutorError(
            "delivery_art_source_executor_response_invalid",
            "Source executor returned an invalid response.",
          ));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || parsed.ok === false) {
          reject(new DeliveryArtSourceExecutorError(
            parsed.error ?? "delivery_art_source_executor_request_failed",
            parsed.message ?? "Source executor request failed.",
            { details: parsed.details ?? null, statusCode: response.statusCode ?? 502 },
          ));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", (error) => reject(new DeliveryArtSourceExecutorError(
      "delivery_art_work_session_executor_unavailable",
      "The admitted Delivery source executor is unavailable.",
      { details: { cause: error.code ?? error.message }, statusCode: 503 },
    )));
    if (payload !== null) request.write(payload);
    request.end();
  });
}

export function createDeliveryArtSourceExecutorClient({
  executorId,
  secret,
  socketPath,
} = {}) {
  if (!executorId || !secret || !socketPath) {
    throw new Error("executorId, secret, and socketPath are required");
  }
  const contextStorage = new AsyncLocalStorage();

  async function invoke(action, input) {
    const context = contextStorage.getStore();
    assertContext(context);
    const response = await socketRequest({
      body: { action, context, input, schema_version: 1 },
      executorId,
      path: REQUEST_PATH,
      secret,
      socketPath,
    });
    return response.result;
  }

  const lifecycleSource = {
    inspect: (landingUnit) => invoke("lifecycle.inspect-source", {
      landing_unit: landingUnit,
    }),
    pullRequest: (landingUnit, binding = null) =>
      invoke("lifecycle.inspect-pull-request", {
        binding,
        landing_unit: landingUnit,
      }),
  };
  const workSource = {
    ensureOwnedWorktree: (session) => invoke("work.ensure-owned-worktree", { session }),
    ensureWorktree: (session) => invoke("work.ensure-worktree", { session }),
    inspectPullRequest: (session) => invoke("work.inspect-pull-request", { session }),
    inspectResourceOwnership: (session) =>
      invoke("work.inspect-resource-ownership", { session }),
    planResourceRetirement: (input) => invoke("work.plan-resource-retirement", input),
    prepareResourceRetirementExecution: (session) =>
      invoke("work.prepare-resource-retirement", { session }),
    readArtifact: (location) => invoke("work.read-artifact", { location }),
    resolveBase: (input) => invoke("work.resolve-base", input),
    resolveWorktree: (session) => invoke("work.resolve-worktree", { session }),
    retireResource: (input) => invoke("work.retire-resource", input),
  };

  return {
    executor: {
      available: true,
      async assertAvailable() {
        await socketRequest({
          executorId,
          method: "GET",
          path: "/healthz",
          secret,
          socketPath,
        });
      },
      id: executorId,
      run(context, operation) {
        return contextStorage.run(context, operation);
      },
    },
    lifecycleSource,
    workSource,
  };
}
