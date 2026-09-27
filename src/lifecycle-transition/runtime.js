import { lifecycleTransitionError } from "./contracts.js";
import { createLifecycleTransitionService } from "./service.js";
import { createLifecycleTransitionStore } from "./store.js";

export function createLifecycleTransitionRuntime({ audit, config }) {
  if (!config?.enabled) return null;
  if (config.profile !== "dev-integration") {
    throw lifecycleTransitionError(
      "activation_required",
      "Lifecycle Transition journal requires the admitted dev-integration profile.",
      503,
    );
  }
  if (typeof config.stateRoot !== "string" || !config.stateRoot.trim()) {
    throw lifecycleTransitionError(
      "configuration_missing",
      "Lifecycle Transition journal requires stateRoot.",
      503,
    );
  }
  if (
    !config.writerBindings ||
    Object.keys(config.writerBindings).length === 0
  ) {
    throw lifecycleTransitionError(
      "configuration_missing",
      "Lifecycle Transition journal requires explicit writer bindings.",
      503,
    );
  }
  return createLifecycleTransitionService({
    audit,
    store: createLifecycleTransitionStore({ root: config.stateRoot }),
    writerBindings: config.writerBindings,
  });
}
