import { HttpError } from "../errors.js";
import { assertPlatformOperationSecurityDecision } from "./contracts.js";
import { createPlatformOperationProviderClient } from "./provider-client.js";
import { createPlatformOperationService } from "./service.js";
import { createPlatformOperationStore } from "./store.js";
import { createSourceCredentialAuthority } from "./source-credential-authority.js";

export function createPlatformOperationRuntime({ audit, config, fetchImpl, sourceCredentialResolvers } = {}) {
  if (!config?.enabled) return null;
  if (config.profile !== "dev-integration") {
    throw new HttpError(
      503,
      "platform_operation_profile_not_admitted",
      "Platform operation runtime is admitted only in the dev-integration profile.",
    );
  }
  if (!config.operatorBindings || Object.keys(config.operatorBindings).length === 0) {
    throw new HttpError(
      503,
      "platform_operation_operator_binding_missing",
      "Platform operation runtime requires an explicit caller-to-operator binding.",
    );
  }
  const securityDecision = assertPlatformOperationSecurityDecision(config);
  const store = createPlatformOperationStore({ root: config.stateRoot });
  return createPlatformOperationService({
    audit,
    operatorBindings: config.operatorBindings,
    providerClient: createPlatformOperationProviderClient({
      allowHttp: config.providerAllowHttp,
      baseUrl: config.providerBaseUrl,
      callerId: config.providerCallerId,
      callerSecret: config.providerCallerSecret,
      fetchImpl,
    }),
    securityDecision,
    sourceCredentialAuthority: createSourceCredentialAuthority({
      providerCallerId: config.providerCallerId, resolvers: sourceCredentialResolvers, store,
    }),
    store,
  });
}
