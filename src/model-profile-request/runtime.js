import { modelProfileRequestError, modelProfileRequestManifest } from "./contracts.js";
import {createModelOperationsPlatformClient} from "../model-operations/platform-client.js";
import {createModelProfilePreparation} from "./preparation.js";
import {createModelProfileLifecycle} from './lifecycle.js';
import {createPlatformOperationProviderClient} from '../platform-operation/provider-client.js';
import { createModelProfileRequestService } from "./service.js";
import { createModelProfileRequestStore } from "./store.js";

export function createModelProfileRequestRuntime({ audit, config, modelOperationsConfig, platformOperationConfig, fetchImpl }) {
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
  const service=createModelProfileRequestService({
    audit,
    fulfillmentCallerIds: new Set(config.fulfillmentCallerIds),
    operatorBindings: config.operatorBindings,
    securityOperatorIds:new Set(config.securityOperatorIds??[]),
    store: createModelProfileRequestStore({ root: config.stateRoot }),
  });
  let preparation=null;
  let lifecycleProvider=null;
  if(config.lifecycleEnabled){
    const c=platformOperationConfig;
    if(!c?.enabled)throw modelProfileRequestError('lifecycle_configuration_missing','Lifecycle needs accepted Platform operation connections.',503);
    lifecycleProvider=createPlatformOperationProviderClient({allowHttp:c.providerAllowHttp,baseUrl:c.providerBaseUrl,callerId:c.providerCallerId,callerSecret:c.providerCallerSecret,fetchImpl});
  }
  if(config.preparationEnabled){
    if(!config.contextBaseUrl||!modelOperationsConfig?.enabled||!modelOperationsConfig.platformBaseUrl||!modelOperationsConfig.managementTokenFile)throw modelProfileRequestError("preparation_configuration_missing","Profile request preparation needs its accepted Platform and context services.",503);
    preparation=createModelProfilePreparation({service,lifecycleProvider,operatorBindings:config.operatorBindings,contextBaseUrl:config.contextBaseUrl,fetchImpl,platform:createModelOperationsPlatformClient({baseUrl:modelOperationsConfig.platformBaseUrl,tokenFile:modelOperationsConfig.managementTokenFile,fetchImpl,timeoutMs:5000})});
  }
  const ready=()=>{if(!preparation)throw modelProfileRequestError("preparation_not_configured","Automatic workflow setup is not connected. Your request has not been submitted.",503);return preparation;};
  let lifecycle=null;
  if(config.lifecycleEnabled){
    if(!preparation||!platformOperationConfig?.enabled)throw modelProfileRequestError('lifecycle_configuration_missing','Lifecycle needs accepted preparation and Platform operation connections.',503);
    lifecycle=createModelProfileLifecycle({service,preparation,operatorBindings:config.operatorBindings,provider:lifecycleProvider});
  }
  const flow=()=>{if(!lifecycle)throw modelProfileRequestError('lifecycle_not_configured','Profile lifecycle is not commissioned. Your current policy is unchanged.',503);return lifecycle;};
  return {...service,options:auth=>ready().options(auth),submitPrepared:input=>ready().submit(input),prepareLifecycle:input=>flow().prepare(input),submitLifecycle:input=>flow().submit(input),reviseLifecycle:input=>flow().revise(input),profileOperation:input=>flow().operation(input)};
}
