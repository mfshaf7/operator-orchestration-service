import { HttpError } from "../errors.js";
import { assertPlatformOperationSecurityDecision } from "./contracts.js";
import { createPlatformOperationProviderClient } from "./provider-client.js";
import { createPlatformOperationService } from "./service.js";
import { createPlatformOperationStore } from "./store.js";
import { createSourceCredentialAuthority } from "./source-credential-authority.js";
import { createDevIntegrationProfileService } from "./dev-integration-service.js";
import path from "node:path";
import { platformOperationStateRoot } from "./store.js";

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
  const providerClient = createPlatformOperationProviderClient({
    allowHttp: config.providerAllowHttp, baseUrl: config.providerBaseUrl,
    callerId: config.providerCallerId, callerSecret: config.providerCallerSecret, fetchImpl,
  });
  const service = createPlatformOperationService({
    audit,
    operatorBindings: config.operatorBindings,
    providerClient,
    securityDecision,
    sourceCredentialAuthority: createSourceCredentialAuthority({
      providerCallerId: config.providerCallerId, resolvers: sourceCredentialResolvers, store,
    }),
    store,
  });
  service.profileIntegration = config.profilesEnabled === true
    ? createDevIntegrationProfileService({ root: path.join(config.stateRoot ?? platformOperationStateRoot(), "dev-integration"),
      providerClient, operatorBindings: config.operatorBindings, audit }) : null;
  service.governedProducts = config.productsEnabled === true ? async ({query}) => providerClient.getGovernedProducts(query) : null;
  return service;
}
