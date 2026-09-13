import { closureError, closureManifest } from "./contracts.js";

export function createPrototypeClosureRuntime({ config }) {
  if (!config?.enabled) return null;
  if (closureManifest.runtime_activation !== true) {
    throw closureError(
      "activation_required",
      "Prototype Closure awaits owner evidence adapters, dedicated identity, and final Security activation.",
      503,
    );
  }
  throw closureError("configuration_missing", "Prototype Closure runtime composition is not commissioned.", 503);
}
