import { createInstanceRecordReader, createInstanceRecordWriter } from "../instance-records/client.js";
import { intakeDigest } from "../workspace-intake/contracts.js";
import { nativeSourceAuthorityRef } from "../repository-owner-bootstrap/private-source-reader.js";
import { createInstanceIntakeJournal, hasInstanceJournalState } from "../instance-records/intake-journal.js";
import { createInstanceInventoryService } from "../instance-records/inventory-service.js";
import { createInstanceInventoryFacade } from "../instance-records/inventory-facade.js";
import { createInstanceInventoryProjection } from "../instance-records/inventory-projection.js";
import path from "node:path";
import { inventoryError, inventoryManifest } from "./contracts.js";
import { createWorkspaceInventoryLifecycleService } from "./lifecycle-service.js";
import { createWorkspaceInventoryGitHubClient } from "./provider-client.js";
import { createWorkspaceInventorySourceClient } from "./source-client.js";
import { createWorkspaceInventoryStore } from "./store.js";
import { createWorkspaceInventoryService } from "./service.js";
import {
  createWgcfWorkspaceInventoryClient,
  createWgcfWorkspaceInventoryLifecycleClient,
} from "./wgcf-client.js";
import { isWorkspaceOperationRuntimeEnabled } from "../workspace-operation-activation.js";

export function createWorkspaceInventoryRuntime({ audit, config, fetchImpl }) {
  if (!config?.enabled) return null;
  if (!isWorkspaceOperationRuntimeEnabled(inventoryManifest, config.profile)) {
    throw inventoryError("activation_required", "Workspace Inventory routine operation awaits the Console, Security, and Platform activation chain.", 503);
  }
  for (const name of ["stateRoot", "authorityRoot", "tokenFile", "owner", "repositoryId"]) {
    if (typeof config[name] !== "string" || !config[name].trim()) {
      throw inventoryError("configuration_missing", `Workspace Inventory requires ${name}.`, 503);
    }
  }
  const provider = createWorkspaceInventoryGitHubClient({
    owner: config.owner,
    repositoryId: config.repositoryId,
    tokenFile: config.tokenFile,
    fetchImpl,
  });
  const sourceClient = createWorkspaceInventorySourceClient({
    authorityRoot: config.authorityRoot,
    python: config.python,
    provider,
  });
  const store = createWorkspaceInventoryStore({ root: config.stateRoot });
  const lifecycleStore = createWorkspaceInventoryStore({ root: path.join(config.stateRoot, "lifecycle") });
  const service = createWorkspaceInventoryService({
    audit,
    store,
    sourceClient,
    readinessClient: createWgcfWorkspaceInventoryClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
  });
  const lifecycle = createWorkspaceInventoryLifecycleService({
    audit,
    store: lifecycleStore,
    sourceClient,
    readinessClient: createWgcfWorkspaceInventoryLifecycleClient({
      baseUrl: config.wgcfBaseUrl,
      callerId: config.wgcfCallerId,
      callerSecret: config.wgcfCallerSecret,
      fetchImpl,
    }),
  });
  const instance = config.instanceRecords;
  const unconfigured = async () => ({ schema_version: 1, mode: "not-configured", projected_at: new Date().toISOString() });
  if (!instance?.enabled && !instance?.instanceId) {
    if (["promotion", "lifecycle"].some(kind => hasInstanceJournalState(path.join(config.stateRoot, "instance-records", kind)))) {
      throw inventoryError("instance_identity_missing", "Restore the original installation identity before accessing retained internal inventory requests.", 503);
    }
    return { ...service, lifecycle, instanceRegistry: unconfigured, instanceStatus: unconfigured };
  }
  if (!instance?.instanceId || config.profile !== "dev-integration") throw inventoryError("instance_configuration_missing", "Internal inventory requires the configured installation and accepted local composition.", 503);
  const connection = { baseUrl: instance.baseUrl, instanceId: instance.instanceId,
    callerId: config.wgcfCallerId, callerSecret: config.wgcfCallerSecret, fetchImpl };
  const reader = createInstanceRecordReader(connection), writer = createInstanceRecordWriter(connection);
  const workflow = (family, legacy, legacyStore, kind) => {
    const journal = createInstanceIntakeJournal({ root: path.join(config.stateRoot, "instance-records", kind), instanceId: instance.instanceId });
    const native = createInstanceInventoryService({ instanceId: instance.instanceId, journal, reader, writer,
      legacyRequestReader: id => legacyStore.get(id), enabled: instance.enabled, family });
    return createInstanceInventoryFacade({ legacy, legacyStore, native, journal, reader, enabled: instance.enabled, family });
  };
  return { ...service, ...workflow("workspace-inventory-promotion", service, store, "promotion"),
    repositorySourceAuthority: async ({repoName}) => {
      const value = await reader.sourceAuthority(repoName, "ordinary-source");
      return value.canonical_authority.kind === "legacy-git" ? null : value.source_authority;
    },
    repositoryReadinessAuthority: async args => {
      const value = await reader.sourceAuthority(args.repoName, "ordinary-source");
      if (value.canonical_authority.kind === "legacy-git") return service.repositoryReadinessAuthority(args);
      const proof = value.source_authority;
      return { repo_name: args.repoName, repo_ref: `repo://${args.repoName}`, expected_owner_repo: args.repoName,
        catalog_value_key: args.repoName, expected_authority_digest: proof.record_ref.digest,
        expected_instance_record: nativeSourceAuthorityRef(proof) };
    },
    lifecycle: workflow("workspace-inventory-lifecycle", lifecycle, lifecycleStore, "lifecycle"),
    instanceRegistry: createInstanceInventoryProjection({ reader }),
    instanceStatus: async ({ input }) => {
      const value = await reader.lookup(input.names);
      const body = { ...value, mode: "current", projected_at: new Date().toISOString() };
      return { ...body, projection_digest: intakeDigest(body) };
    } };
}
