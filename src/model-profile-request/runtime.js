import { modelProfileRequestError, modelProfileRequestManifest } from "./contracts.js";
import { createModelProfileRequestService } from "./service.js";
import { createModelProfileRequestStore } from "./store.js";

export function createModelProfileRequestRuntime({ audit, config }) {
  if (!config?.enabled) return null;
  if (
    !modelProfileRequestManifest.runtime_activation.enabled ||
    config.profile !== modelProfileRequestManifest.runtime_activation.allowed_runtime_profile
  ) {
    throw modelProfileRequestError(
      "activation_required",
      "Model-profile request runtime is admitted only in the reviewed dev-integration boundary.",
      503,
    );
  }
  if (!config.stateRoot) {
    throw modelProfileRequestError("configuration_missing", "Model-profile request state root is required.", 503);
  }
  if (!Object.keys(config.operatorBindings).length) {
    throw modelProfileRequestError("configuration_missing", "Explicit caller/operator bindings are required.", 503);
  }
  if (!config.fulfillmentCallerIds.length) {
    throw modelProfileRequestError("configuration_missing", "At least one Platform fulfillment caller is required.", 503);
  }
  if (config.fulfillmentCallerIds.some((callerId) => config.operatorBindings[callerId])) {
    throw modelProfileRequestError(
      "configuration_invalid",
      "Platform fulfillment callers must be distinct from operator-bound callers.",
      503,
    );
  }
  return createModelProfileRequestService({
    audit,
    fulfillmentCallerIds: new Set(config.fulfillmentCallerIds),
    operatorBindings: config.operatorBindings,
    store: createModelProfileRequestStore({ root: config.stateRoot }),
  });
}
