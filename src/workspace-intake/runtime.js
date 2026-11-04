import { intakeError, intakeManifest } from "./contracts.js";
import { createWorkspaceIntakeGitHubClient } from "./provider-client.js";
import { createWorkspaceIntakeSourceClient } from "./source-client.js";
import { createWorkspaceIntakeStore } from "./store.js";
import { createWorkspaceIntakeService } from "./service.js";
import { createWgcfWorkspaceIntakeClient } from "./wgcf-client.js";
import { isWorkspaceOperationRuntimeEnabled } from "../workspace-operation-activation.js";
import path from "node:path";
import { createInstanceRecordReader, createInstanceRecordWriter } from "../instance-records/client.js";
import { createInstanceIntakeJournal, hasInstanceJournalState } from "../instance-records/intake-journal.js";
import { createInstanceIntakeService } from "../instance-records/intake-service.js";
import { createInstanceIntakeFacade } from "../instance-records/intake-facade.js";

export function createWorkspaceIntakeRuntime({ audit, config, fetchImpl, custodySourceReader, sourceOwnerReadinessReader }) {
  if (!config?.enabled) return null;
  if (!isWorkspaceOperationRuntimeEnabled(intakeManifest, config.profile)) {
    throw intakeError("activation_required", "Workspace Intake routine operation awaits the Console, Security, and Platform activation chain.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId", "wgcfImplementationRef", "wgcfServiceIdentityRef"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) throw intakeError("configuration_missing", `Workspace Intake requires ${name}.`, 503);
  }
  const store = createWorkspaceIntakeStore({ root: config.stateRoot });
  const legacy = createWorkspaceIntakeService({
    audit,
    custodySourceReader,
    sourceOwnerReadinessReader,
    store,
    sourceClient: createWorkspaceIntakeSourceClient({ authorityRoot: config.authorityRoot, python: config.python,
      provider: createWorkspaceIntakeGitHubClient({ owner: config.owner, repositoryId: config.repositoryId, tokenFile: config.tokenFile, fetchImpl }),
    }),
    readinessClient: createWgcfWorkspaceIntakeClient({ baseUrl: config.wgcfBaseUrl, callerId: config.wgcfCallerId, callerSecret: config.wgcfCallerSecret,
      implementationRef: config.wgcfImplementationRef, serviceIdentityRef: config.wgcfServiceIdentityRef, fetchImpl,
    }),
  });
  const instance = config.instanceRecords;
  if (!instance?.enabled && !instance?.instanceId) {
    if (hasInstanceJournalState(path.join(config.stateRoot, "instance-records"))) throw intakeError("instance_identity_missing", "Restore the original installation identity before accessing retained internal registrations.", 503);
    return legacy;
  }
  if (!instance?.instanceId || config.profile !== "dev-integration") throw intakeError("instance_configuration_missing", "Internal records require the configured installation and accepted local composition.", 503);
  const transport = { baseUrl: instance.baseUrl, instanceId: instance.instanceId, callerId: config.wgcfCallerId,
    callerSecret: config.wgcfCallerSecret, fetchImpl };
  const reader = createInstanceRecordReader(transport), writer = createInstanceRecordWriter(transport);
  const journal = createInstanceIntakeJournal({ root: path.join(config.stateRoot, "instance-records"), instanceId: instance.instanceId });
  const native = createInstanceIntakeService({ instanceId: instance.instanceId, journal, reader, writer,
    custodySourceReader, sourceOwnerReadinessReader, enabled: instance.enabled,
    legacyRequestReader: id => store.get(id) });
  return createInstanceIntakeFacade({ legacy, legacyStore: store, native, journal, reader, enabled: instance.enabled });
}
