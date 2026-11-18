import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitHubRepositoryProviderClient } from "../src/repository-custody/provider-client.js";
import { createGitHubRepositoryLifecycleClient } from "../src/repository-lifecycle/provider-client.js";
import { loadConfig } from "../src/config.js";

function files(t) {
  const root = mkdtempSync(join(tmpdir(), "repository-rotation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "credential");
  return { path, put: value => writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)) };
}
const expiry = () => new Date(Date.now() + 3600_000).toISOString();
const body = { id: 12, owner: { login: "company", id: 34, type: "Organization" }, name: "todo",
  html_url: "https://github.com/company/todo", visibility: "private", archived: false, updated_at: "v1" };
const response = () => new Response(JSON.stringify(body), { headers: { etag: '"v1"' } });

test("reader rotates without reconstructing the client and never uses stale env after revocation", async t => {
  const f = files(t), headers = [];
  const client = createGitHubRepositoryProviderClient({ readerCredentialPath: f.path,
    readInstallationToken: "stale-env", readAccount: "bad env value",
    fetchImpl: async (_, options) => { headers.push(options.headers.Authorization); return response(); } });
  f.put({ schema_version: 1, account: "company", token: "ghs_first", expires_at: expiry() });
  await client.lookup({ owner: "company", name: "todo" });
  f.put({ schema_version: 1, account: "company", token: "ghs_second", expires_at: expiry() });
  await client.lookup({ owner: "company", name: "todo" });
  assert.deepEqual(headers, ["Bearer ghs_first", "Bearer ghs_second"]);
  f.put({ schema_version: 1, account: "other", token: "ghs_wrong", expires_at: expiry() });
  await assert.rejects(client.lookup({ owner: "company", name: "todo" }), { code: "repository_provider_owner_not_admitted" });
  unlinkSync(f.path);
  assert.throws(() => client.lookup({ owner: "company", name: "todo" }), { code: "repository_credential_unavailable" });
  assert.equal(headers.length, 2);
});

test("projected connections retain account and purpose bindings across renewal", async t => {
  const f = files(t), headers = [];
  const binding = { uri: "github://company/metadata", digest: "sha256:" + "a".repeat(64) };
  const value = token => ({ schema_version: 1, default_connection_id: "github:company", connections: [{
    id: "github:company", account: "company", account_id: "34", account_type: "organization", grants: {
      metadata: { token, installation_id: "56", credential_binding_ref: binding, expires_at: expiry() }
    } }] });
  const client = createGitHubRepositoryProviderClient({ connectionsFile: f.path,
    readInstallationToken: "stale", readerCredentialPath: "/missing-unrelated-reader",
    fetchImpl: async (_, options) => { headers.push(options.headers.Authorization); return response(); } });
  f.put(value("ghs_first"));
  assert.equal(client.connections().connections[0].account, "company");
  await client.lookup({ owner: "company", name: "todo" });
  f.put(value("ghs_second"));
  await client.lookup({ owner: "company", name: "todo" });
  await assert.rejects(client.lookup({ owner: "other", name: "todo" }), { code: "repository_connection_account_denied" });
  assert.deepEqual(headers, ["Bearer ghs_first", "Bearer ghs_second"]);
  assert.ok(!JSON.stringify(client.connections()).includes("ghs_"));
  f.put(" ");
  assert.throws(() => client.connections(), { code: "repository_connections_invalid" });
});

test("one lifecycle mutation holds one generation while the next operation reads renewal", async t => {
  const f = files(t), tokens = [];
  f.put("ghs_first");
  const client = createGitHubRepositoryLifecycleClient({ installationTokenFile: f.path, installationToken: "stale",
    fetchImpl: async (_, options) => { tokens.push(options.headers.Authorization); f.put("ghs_second"); return response(); } });
  const request = { request_id: "lifecycle:test", repository_identity: { provider: "github", provider_host: "github.com", provider_repository_id: "12" } };
  await client.setArchived(request, true);
  assert.deepEqual(tokens, ["Bearer ghs_first", "Bearer ghs_first", "Bearer ghs_first"]);
  await client.read(request);
  assert.equal(tokens.at(-1), "Bearer ghs_second");
});

test("invalid or oversized credential files fail locally and do not activate workflows", t => {
  const f = files(t);
  const client = createGitHubRepositoryProviderClient({ readerCredentialPath: f.path });
  assert.equal(client.connections().connections.length, 0);
  for (const value of ["not json", "x".repeat(16385), { schema_version: 1, account: "company", token: "ghs_expired", expires_at: "2000-01-01" }]) {
    f.put(value);
    assert.throws(() => client.lookup({ owner: "company", name: "todo" }), error => error.statusCode === 503 && !error.message.includes(f.path));
  }
  const config = loadConfig({ OOS_REPOSITORY_PROVIDER_CREDENTIAL_FILE: f.path, OOS_REPOSITORY_CONNECTIONS_FILE: f.path,
    OOS_REPOSITORY_PROVISIONING_TOKEN_FILE: f.path, OOS_REPOSITORY_LIFECYCLE_TOKEN_FILE: f.path });
  assert.equal(config.repositoryCustody.providerReaderCredentialFile, f.path);
  assert.equal(config.repositoryLifecycle.providerInstallationTokenFile, f.path);
  assert.equal(config.repositoryCustody.enabled, false);
});
