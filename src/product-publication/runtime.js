import {
  productPublicationDigest,
  productPublicationError,
  productPublicationManifest,
  productPublicationSecurityAuthority,
} from "./contracts.js";
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
      "Product Publication requires the reviewed source gate and dev-integration profile.",
      503,
    );
  }
  for (const name of [
    "stateRoot",
    "securityDecisionUri",
    "securityDecisionDigest",
    "securityDecisionRevision",
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
  const configuredSecurityDecision = {
    uri: config.securityDecisionUri,
    digest: config.securityDecisionDigest,
    revision: config.securityDecisionRevision,
  };
  const sourceSecurityDecision = {
    uri: productPublicationSecurityAuthority.uri,
    digest: productPublicationSecurityAuthority.digest,
    revision: productPublicationSecurityAuthority.revision,
  };
  if (
    productPublicationDigest(configuredSecurityDecision) !==
    productPublicationDigest(sourceSecurityDecision)
  ) {
    throw productPublicationError(
      "security_decision_mismatch",
      "Product Publication runtime configuration does not bind the source-reviewed Security decision.",
      503,
    );
  }
  if (
    !Array.isArray(productPublicationManifest.allowed_target_postures) ||
    productPublicationManifest.allowed_target_postures.length === 0
  ) {
    throw productPublicationError(
      "configuration_missing",
      "Product Publication requires an explicit source-owned target posture scope.",
      503,
    );
  }
  return createProductPublicationService({
    allowedTargetPostures: productPublicationManifest.allowed_target_postures,
    audit,
    operatorBindings: config.operatorBindings,
    securityDecision: configuredSecurityDecision,
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
