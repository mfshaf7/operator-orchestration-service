import assert from "node:assert/strict";
import test from "node:test";
import { repositoryConnections } from "../src/repository-custody/connections.js";
import { createGitHubRepositoryProviderClient } from "../src/repository-custody/provider-client.js";
import { provisionRequest, provisionDecision } from "../test-fixtures/repository-custody.js";

const now = () => new Date("2026-11-05T00:00:00Z");
const ref = letter => ({uri: `platform-engineering://github-connections/${letter}/provisioning`, digest: `sha256:${letter.repeat(64)}`});
function connection(account, type, id, letter) {
  return {id: `github:${account}`, account, account_type: type, account_id: id, grants: {
    provisioning: {installation_id: id, token: `ghs_${account}_write`, expires_at: "2026-11-05T01:00:00Z", credential_binding_ref: ref(letter)},
    metadata: {installation_id: id, token: `ghs_${account}_read`, expires_at: "2026-11-05T01:00:00Z", credential_binding_ref: ref(letter)},
  }};
}
const settings = () => ({schema_version: 1, default_connection_id: "github:company", connections: [connection("solo", "personal", "11", "a"), connection("company", "organization", "22", "b")]});

test("connected accounts keep their exact identity and grants while public metadata excludes every token", () => {
  const value = repositoryConnections(JSON.stringify(settings()), {clock: now});
  const projection = value.projection();
  assert.equal(projection.connections.length, 2);
  assert.equal(projection.default_connection_id, "github:company");
  assert.doesNotMatch(JSON.stringify(projection), /ghs_|installation_id|expires_at/);
  assert.equal(value.resolve({owner: "SOLO", role: "metadata"}).token, "ghs_solo_read");
  assert.equal(value.resolve({owner: "solo", role: "provisioning", credentialBindingRef: ref("a"), ownerScope: "personal"}).token, "ghs_solo_write");
  for (const input of [{owner:"other", role:"metadata"}, {owner:"solo", role:"provisioning", credentialBindingRef:ref("b")},
    {owner:"solo", role:"provisioning", ownerScope:"organization"}, {owner:"solo", role:"lifecycle"}]) {
    assert.throws(() => value.resolve(input));
  }
});

test("expired, missing, duplicate and invalid account configurations never borrow the default account", () => {
  const expired = settings(); expired.connections[0].grants.provisioning.expires_at = now().toISOString();
  const value = repositoryConnections(JSON.stringify(expired), {clock: now});
  assert.equal(value.projection().connections[0].capabilities.provisioning, false);
  assert.throws(() => value.resolve({owner:"solo", role:"provisioning"}), {code:"repository_connection_not_ready"});
  for (const change of [v => v.connections.push(v.connections[0]), v => v.default_connection_id="github:missing", v => v.connections[0].account_type="company",
    v => v.connections[0].grants.provisioning.token="personal-token", v => v.connections[0].grants.admin={}]) {
    const invalid = settings(); change(invalid);
    assert.throws(() => repositoryConnections(JSON.stringify(invalid)), {code:"repository_connections_invalid"});
  }
});

test("lifecycle remains explicitly repository-scoped rather than gaining account-wide write access", () => {
  const configured = settings();
  configured.connections[0].grants.lifecycle = {...configured.connections[0].grants.provisioning, repository_id: "123"};
  const value = repositoryConnections(JSON.stringify(configured), {clock: now});
  assert.equal(value.resolveBinding("lifecycle", ref("a"), "123").repository_id, "123");
  assert.throws(() => value.resolveBinding("lifecycle", ref("a"), "999"), {code:"repository_connection_repository_denied"});
  delete configured.connections[0].grants.lifecycle.repository_id;
  assert.throws(() => repositoryConnections(JSON.stringify(configured)), {code:"repository_connections_invalid"});
});

test("personal creation uses only the selected installation and /user/repos with explicit private visibility", async () => {
  const calls = [], request = provisionRequest();
  request.target.owner = "solo"; request.target.owner_scope = "personal"; request.authority.credential_binding_ref = ref("a");
  const client = createGitHubRepositoryProviderClient({connections: JSON.stringify(settings()), clock:now,
    provisioningInstallationToken:"legacy-must-not-be-used", readInstallationToken:"other-must-not-be-used",
    fetchImpl: async (url, options) => {calls.push({url, options}); return new Response(JSON.stringify({id:555, owner:{login:"solo"}, name:request.target.name}), {status:201});}});
  await client.create(request, provisionDecision(request).approved_provisioning);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.github.com/user/repos");
  assert.equal(calls[0].options.headers.Authorization, "Bearer ghs_solo_write");
  const body = JSON.parse(calls[0].options.body); assert.equal(body.private, true); assert.equal("visibility" in body, false);
  request.provisioning.visibility="internal";
  await assert.rejects(client.create(request, provisionDecision(request).approved_provisioning), {code:"repository_visibility_not_supported"});
  assert.equal(calls.length, 1);
});

test("same repository name in two accounts routes independently and denies foreign account readback", async () => {
  let owner = "solo", bodyOwner = "solo"; const calls=[];
  const client = createGitHubRepositoryProviderClient({connections:JSON.stringify(settings()), clock:now, fetchImpl:async(url,options)=>{
    calls.push(options.headers.Authorization);
    return new Response(JSON.stringify({id:owner==="solo"?101:102, owner:{id:bodyOwner==="solo"?11:22,login:bodyOwner,type:bodyOwner==="solo"?"User":"Organization"},
      name:"todo",html_url:`https://github.com/${owner}/todo`,visibility:"private",archived:false}),{status:200});
  }});
  assert.equal((await client.lookup({owner,name:"todo"})).provider_repository_id,"101");
  owner="company"; bodyOwner="company";
  assert.equal((await client.lookup({owner,name:"todo"})).provider_repository_id,"102");
  assert.deepEqual(calls,["Bearer ghs_solo_read","Bearer ghs_company_read"]);
  bodyOwner="solo";
  await assert.rejects(client.lookup({owner,name:"todo"}), {code:"repository_provider_identity_mismatch"});
});

test("provider denial never retries with a more privileged or another account token", async () => {
  let calls=0; const request=provisionRequest(); request.target.owner="solo";request.target.owner_scope="personal";request.authority.credential_binding_ref=ref("a");
  const client=createGitHubRepositoryProviderClient({connections:JSON.stringify(settings()),clock:now,provisioningInstallationToken:"fallback",
    fetchImpl:async()=>{calls++;return new Response("{}",{status:403});}});
  await assert.rejects(client.create(request,provisionDecision(request).approved_provisioning),{code:"repository_provider_access_denied"});
  assert.equal(calls,1);
});
