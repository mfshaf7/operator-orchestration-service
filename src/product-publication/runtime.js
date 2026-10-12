import { productPublicationError, productPublicationManifest } from "./contracts.js";
import { createProductPublicationService } from "./service.js";
import { createProductPublicationStore } from "./store.js";
import { createWgcfProductPublicationClient } from "./wgcf-client.js";

export function createProductPublicationRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (
    productPublicationManifest.runtime_activation !== true ||
    config.profile !== "dev-integration"
  ) {
    throw productPublicationError(
      "activation_required",
      "Product Publication awaits Security review and Platform activation.",
      503,
    );
  }
  for (const name of [
    "stateRoot",
    "wgcfBaseUrl",
    "wgcfCallerId",
    "wgcfCallerSecret",
    "wgcfImplementationRef",
    "wgcfServiceIdentityRef",
  ]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw productPublicationError(
        "configuration_missing",
        `Product Publication requires ${name}.`,
        503,
      );
    }
  }
  if (!Object.keys(config.operatorBindings ?? {}).length) {
    throw productPublicationError(
      "configuration_missing",
      "Product Publication requires explicit caller/operator bindings.",
      503,
    );
  }
  return createProductPublicationService({
    audit,
    operatorBindings: config.operatorBindings,
    readinessClient: createWgcfProductPublicationClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef,
      serviceIdentityRef: config.wgcfServiceIdentityRef,
      fetchImpl,
    }),
    store: createProductPublicationStore({ root: config.stateRoot }),
  });
}
