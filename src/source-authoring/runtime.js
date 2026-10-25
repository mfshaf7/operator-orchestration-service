import path from "node:path";
import { deliveryArtWorkStateRoot } from "../delivery-art/work-session-store.js";
import { createDeliveryArtSourceExecutorClient } from "../delivery-art/source-executor.js";
import { createDeliveryArtLifecycleContextClient } from "../delivery-art/lifecycle-context-client.js";
import { createDeliveryArtSourceRealizationGatewayClient } from "../delivery-art/source-realization.js";
import { prototypeAuthoringError } from "./prototype-contracts.js";
import { createPrototypeAuthoringService } from "./prototype-service.js";
import { createPrototypeAuthoringStore } from "./prototype-store.js";
import { createPrototypeLifecycleContext } from "./prototype-context.js";
import { createPrototypeSourceRealizationService } from "./prototype-realization.js";

export function createPrototypeAuthoringFacade({ authoringService, realizationService, operatorBindings }) {
  const identity = ({ callerId, ...args }) => {
    const operatorId = operatorBindings?.[callerId];
    if (!operatorId) throw prototypeAuthoringError("identity_forbidden", "The authenticated caller has no accountable Prototype authoring operator binding.", 403);
    return { ...args, callerId, operatorId };
  };
  return {
    async create(args) { await authoringService.create(identity(args)); return realizationService.read(identity({ callerId: args.callerId, requestId: args.input.request_id })); },
    list(args) { return authoringService.list(identity(args)); },
    read: args => realizationService.read(identity(args)),
    draft: args => realizationService.draft(identity(args)),
    files: args => realizationService.files(identity(args)),
    saveDraft: args => realizationService.saveDraft(identity(args)),
    startSession: args => realizationService.startSession(identity(args)),
    generate: args => realizationService.generate(identity(args)),
    accept: args => realizationService.continue(identity(args)),
    recover: args => realizationService.recover(identity(args)),
    cancelAttempt: args => realizationService.cancelAttempt(identity(args)),
    publish: args => realizationService.publish(identity(args)),
    review: args => realizationService.review(identity(args)),
    merge: args => realizationService.merge(identity(args)),
    close: args => realizationService.close(identity(args)),
    prepareSourceCredential: args => authoringService.prepareSourceCredential(args),
    verifySourceCredential: args => authoringService.verifySourceCredential(args),
  };
}

export function createPrototypeAuthoringRuntime({ config, profile, recordsReader, platformOperations, fetchImpl, env = process.env }) {
  // Reuse existing composed source-work configuration, custody and acceptance.
  // A new OOS activation manifest/flag would duplicate Platform/Security truth.
  // Optional Prototype dependencies cannot break an otherwise valid Delivery
  // source composition; absent dependencies yield the normal unavailable API.
  if (!config?.sourceRealization?.enabled || typeof recordsReader !== "function" || !config.executorId || !config.executorSecret || !config.executorSocketPath ||
      !Object.keys(config.callerOperatorBindings ?? {}).length || !config.lifecycleContext?.baseUrl || !config.lifecycleContext.callerSecret || !config.sourceRealization.gatewayBaseUrl) return null;
  if (profile !== "dev-integration") throw prototypeAuthoringError("profile_not_admitted", "Prototype source authoring is confined to the existing accepted dev-integration composition.", 503);
  const store = createPrototypeAuthoringStore({ root: path.join(deliveryArtWorkStateRoot(env), "prototype-authoring") });
  const sourceExecutor = createDeliveryArtSourceExecutorClient({ executorId: config.executorId, secret: config.executorSecret,
    socketPath: config.executorSocketPath, requireSourceLease: true });
  const authoringService = createPrototypeAuthoringService({ callerOperatorBindings: config.callerOperatorBindings, recordsReader, sourceExecutor, store });
  const lifecycleContext = createPrototypeLifecycleContext({ store, client: createDeliveryArtLifecycleContextClient({ ...config.lifecycleContext, fetchImpl }) });
  const realizationService = createPrototypeSourceRealizationService({ authoringService, store, sourceExecutor, platformOperations, lifecycleContext,
    gatewayClient: createDeliveryArtSourceRealizationGatewayClient({ baseUrl: config.sourceRealization.gatewayBaseUrl, fetchImpl }), enabled: true });
  return createPrototypeAuthoringFacade({ authoringService, realizationService, operatorBindings: config.callerOperatorBindings });
}
