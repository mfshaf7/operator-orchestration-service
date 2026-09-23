import { closureError, closureManifest } from "./contracts.js";
import { createPrototypeMaturityStore } from "../prototype-maturity/store.js";
import { createPrototypeClosureAuthorityResolver } from "./authority-resolver.js";
import { createPrototypeClosureBaselineOwnerReader } from "./baseline-owner-reader.js";
import { createPrototypeClosureDeliveryOwnerReader } from "./delivery-owner-reader.js";
import { createPrototypeClosureOwnerEvidenceReader } from "./owner-evidence.js";
import { createPrototypeClosureOwnerReadbackService } from "./owner-readback-service.js";
import { createPrototypeClosurePlatformEvidenceReader } from "./platform-evidence-reader.js";
import { createPrototypeClosureGitHubClient } from "./provider-client.js";
import { createPrototypeClosureService } from "./service.js";
import { createPrototypeClosureSourceClient } from "./source-client.js";
import { createPrototypeClosureStore } from "./store.js";
import { createWgcfPrototypeClosureClient } from "./wgcf-client.js";

export function createPrototypeClosureComposition({ audit, config, fetchImpl, ownerReaders, platformClient,
  maturityStateRoot = null, deliveryApplicationService = null }) {
  if (config?.profile !== "dev-integration") {
    throw closureError("profile_invalid", "Closure is limited to the admitted dev-integration profile.", 503);
  }
  for (const name of [
    "stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId",
    "platformEvidenceFile", "wgcfBaseUrl", "wgcfCallerSecret",
    "wgcfImplementationRef", "wgcfServiceIdentityRef",
  ]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw closureError("configuration_missing", `Closure requires ${name}.`, 503);
    }
  }
  const resolvedPlatformReader = platformClient ?? createPrototypeClosurePlatformEvidenceReader({
    evidenceFile: config.platformEvidenceFile,
  });
  const provider = createPrototypeClosureGitHubClient({
    owner: config.owner,
    repositoryId: config.repositoryId,
    tokenFile: config.tokenFile,
    fetchImpl,
  });
  const sourceClient = createPrototypeClosureSourceClient({
    authorityRoot: config.authorityRoot,
    python: config.python,
    provider,
  });
  const store = createPrototypeClosureStore({ root: config.stateRoot });
  const ownerReadback = maturityStateRoot && deliveryApplicationService
    ? createPrototypeClosureOwnerReadbackService({
      baselineReader: createPrototypeClosureBaselineOwnerReader({
        maturityStore: createPrototypeMaturityStore({ root: maturityStateRoot }),
        studioSourceClient: sourceClient,
      }),
      deliveryReader: createPrototypeClosureDeliveryOwnerReader({ deliveryApplicationService }),
      platformReader: resolvedPlatformReader,
      retirementStore: store,
    })
    : null;
  const localReaders = ownerReadback ? {
    "workspace-prototype-studio": { read: (lookup) => sourceClient.ownerReadback(lookup) },
    "workspace-delivery-art": { read: ({ owner_ref: _owner, ...lookup }) => ownerReadback.read(lookup) },
    "operator-orchestration-service": { read: ({ owner_ref: _owner, ...lookup }) => ownerReadback.read(lookup) },
    "platform-engineering": { read: (lookup) => resolvedPlatformReader.read(lookup) },
  } : {};
  const readEvidence = createPrototypeClosureOwnerEvidenceReader({ ...ownerReaders, ...localReaders });
  const service = createPrototypeClosureService({
    audit,
    store,
    readinessClient: createWgcfPrototypeClosureClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef,
      serviceIdentityRef: config.wgcfServiceIdentityRef,
      fetchImpl,
    }),
    authorityResolver: createPrototypeClosureAuthorityResolver({ readEvidence }),
    sourceClient,
    platformClient: resolvedPlatformReader,
  });
  if (ownerReadback) service.ownerReadback = ownerReadback;
  return service;
}

export function createPrototypeClosureRuntime({ audit, config, fetchImpl, ownerReaders, platformClient,
  maturityStateRoot, deliveryApplicationService }) {
  if (!config?.enabled) return null;
  if (closureManifest.runtime_activation !== true || config.profile !== "dev-integration") {
    throw closureError(
      "activation_required",
      "Prototype Closure awaits Platform commissioning of the approved dev-integration composition.",
      503,
    );
  }
  if (!maturityStateRoot || !deliveryApplicationService) {
    throw closureError("owner_readback_unavailable", "Closure requires maturity and Delivery owner readback.", 503);
  }
  return createPrototypeClosureComposition({ audit, config, fetchImpl, ownerReaders, platformClient,
    maturityStateRoot, deliveryApplicationService });
}
