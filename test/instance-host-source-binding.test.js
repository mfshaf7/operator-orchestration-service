import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyHostSourceBinding } from "../src/instance-records/host-source-binding.js";
import { createConfiguredHostInstanceSourceReader } from "../src/instance-records/host-source-reader.js";
import { createPlatformOperationProviderClient } from "../src/platform-operation/provider-client.js";

test("host connection retains installation identity, reads only private fixed state, and cannot silently revert after disable", t => {
  const root = mkdtempSync(path.join(os.tmpdir(), "instance-host-binding-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const authorityRoot = path.join(root, "record-authority/workspace-governance"), privateRoot = path.join(root, "private");
  mkdirSync(authorityRoot, { recursive: true }); mkdirSync(privateRoot, { mode: 0o700 });
  const env = { OOS_INSTANCE_RECORDS_ENABLED: "true", OOS_WORKSPACE_INVENTORY_AUTHORITY_ROOT: authorityRoot };
  assert.throws(() => applyHostSourceBinding(env), /binding is missing/);
  const file = path.join(privateRoot, "instance-source-host.json");
  const value = { schema_version: 1, instance_id: "synthetic-installation", connection: { baseUrl: "http://10.42.0.1:38491",
    callerId: "operator-orchestration-service", callerSecret: "s".repeat(32), allowHttp: true, allowPrivateHttp: true } };
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  const actual = applyHostSourceBinding(env);
  assert.equal(actual.OOS_INSTANCE_ID, "synthetic-installation");
  assert.equal(actual.OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL, "http://10.42.0.1:38491");
  assert.throws(() => applyHostSourceBinding({ ...env, OOS_INSTANCE_ID: "foreign-installation" }), /identity changed/);
  const disabled = applyHostSourceBinding({ ...env, OOS_INSTANCE_RECORDS_ENABLED: "false" });
  assert.throws(() => createConfiguredHostInstanceSourceReader({ env: disabled })({}), { code: "instance_records_disabled" });
  chmodSync(file, 0o644);
  assert.throws(() => applyHostSourceBinding(env), /not regular installation-private state/);
});

test("only the explicitly commissioned host connection admits RFC1918 HTTP; public and link-local URLs stay denied", () => {
  const options = { allowHttp: true, callerId: "operator-orchestration-service", callerSecret: "s".repeat(32) };
  assert.throws(() => createPlatformOperationProviderClient({ ...options, baseUrl: "http://10.42.0.1:38491" }), /admitted destination/);
  assert.ok(createPlatformOperationProviderClient({ ...options, allowPrivateHttp: true, baseUrl: "http://10.42.0.1:38491" }));
  for (const baseUrl of ["http://8.8.8.8:38491", "http://169.254.1.2:38491", "http://172.32.0.1:38491", "http://user:secret@10.42.0.1:38491"]) {
    assert.throws(() => createPlatformOperationProviderClient({ ...options, allowPrivateHttp: true, baseUrl }), /admitted destination/);
  }
});
