import { fail } from "./contracts.js";
import { createModelOperationsPlatformClient } from "./platform-client.js";
import { createModelOperationsService } from "./service.js";
import { createModelProfileRequestStore } from "../model-profile-request/store.js";

export function createModelOperationsRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (config.profile !== "dev-integration") throw fail("activation_required", "Model operations require the separately commissioned dev-integration boundary.", 503);
  for (const key of ["stateRoot", "platformBaseUrl", "managementTokenFile"]) {
    if (typeof config[key] !== "string" || !config[key].trim()) throw fail("configuration_missing", `Model operations require ${key}.`, 503);
  }
  if (!Object.keys(config.operatorBindings ?? {}).length) throw fail("configuration_missing", "Explicit caller/operator bindings are required.", 503);
  return createModelOperationsService({
    audit, operatorBindings: config.operatorBindings,
    store: createModelProfileRequestStore({ root: config.stateRoot }),
    platform: createModelOperationsPlatformClient({ baseUrl: config.platformBaseUrl, tokenFile: config.managementTokenFile, fetchImpl }),
  });
}
