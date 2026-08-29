import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubRepositoryProviderClient } from "../src/repository-custody/provider-client.js";
import { createWgcfRepositoryCustodyClient } from "../src/repository-custody/wgcf-client.js";
import {
  custodyRequest,
  decisionEnvelope,
  provisionDecision,
  provisionRequest,
  TEST_CLOCK,
} from "../test-fixtures/repository-custody.js";

function githubRepositoryBody(request, overrides = {}) {
  return {
    id: 987654321,
    node_id: "R_kgDOProvisioned",
    owner: { login: request.target.owner },
    name: request.target.name,
    html_url: `https://github.com/${request.target.owner}/${request.target.name}`,
    default_branch: "main",
    visibility: request.provisioning.visibility,
    archived: false,
    updated_at: TEST_CLOCK().toISOString(),
    description: request.provisioning.description,
    has_issues: request.provisioning.features.issues,
    has_projects: request.provisioning.features.projects,
    has_wiki: request.provisioning.features.wiki,
    has_discussions: request.provisioning.features.discussions,
    allow_squash_merge: request.provisioning.merge_policy.allow_squash_merge,
    allow_merge_commit: request.provisioning.merge_policy.allow_merge_commit,
    allow_rebase_merge: request.provisioning.merge_policy.allow_rebase_merge,
    delete_branch_on_merge: request.provisioning.merge_policy.delete_branch_on_merge,
    ...overrides,
  };
}

test("WGCF custody client issues and rereads one exact durable decision", async () => {
  const request = custodyRequest();
  const issued = decisionEnvelope(request);
  const current = structuredClone(issued);
  current.ledger.resolution = "read";
  const responses = [issued, current];
  const calls = [];
  const client = createWgcfRepositoryCustodyClient({
    baseUrl: "http://wgcf.local",
    callerSecret: "s".repeat(32),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
  });
  const result = await client.evaluate(request);
  assert.equal(result.decision.outcome, "allowed");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/v1\/readiness\/repository-custody\/0123456789abcdef01234567$/);
  assert.equal(calls[0].options.headers["x-wgcf-caller-id"], "operator-orchestration-service");
});

test("provider client resolves immutable identity with application credential", async () => {
  const request = custodyRequest();
  const calls = [];
  const client = createGitHubRepositoryProviderClient({
    clock: TEST_CLOCK,
    installationToken: "installation-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        id: 123456789,
        node_id: "R_kgDOExample",
        owner: { login: "example-owner" },
        name: "example-repository",
        html_url: "https://github.com/example-owner/example-repository",
        default_branch: "main",
        visibility: "private",
        archived: false,
        updated_at: TEST_CLOCK().toISOString(),
      }), {
        headers: { etag: "etag-1" },
        status: 200,
      });
    },
  });
  const readback = await client.read(request);
  assert.equal(readback.repository_identity.provider_repository_id, "123456789");
  assert.match(calls[0].url, /\/repositories\/123456789$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer installation-token");
});

test("provider client creates with exact approved settings and verifies separate readback", async () => {
  const request = provisionRequest();
  const decision = provisionDecision(request);
  const calls = [];
  const responses = [
    new Response(JSON.stringify(githubRepositoryBody(request)), { status: 201 }),
    new Response(JSON.stringify(githubRepositoryBody(request)), {
      headers: { etag: "etag-provisioned" },
      status: 200,
    }),
    new Response(JSON.stringify({ name: "README.md" }), { status: 200 }),
  ];
  const client = createGitHubRepositoryProviderClient({
    clock: TEST_CLOCK,
    installationToken: "installation-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    },
  });

  const acknowledgement = await client.create(request, decision.approved_provisioning);
  const readback = await client.read(request, {
    providerRepositoryId: acknowledgement.providerRepositoryId,
  });

  assert.deepEqual(acknowledgement, { providerRepositoryId: "987654321" });
  assert.match(calls[0].url, /\/orgs\/example-organization\/repos$/);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    name: request.target.name,
    description: request.provisioning.description,
    visibility: "private",
    auto_init: true,
    has_issues: true,
    has_projects: false,
    has_wiki: false,
    has_discussions: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
  });
  assert.match(calls[1].url, /\/repositories\/987654321$/);
  assert.match(calls[2].url, /\/repos\/example-organization\/example-repository\/readme$/);
  assert.equal(readback.action, "provision-new");
  assert.deepEqual(readback.applied_provisioning.settings, request.provisioning);
  assert.equal("delete" in client, false);
});

test("provider client reports a missing canonical repository without mutation", async () => {
  const request = provisionRequest();
  const calls = [];
  const client = createGitHubRepositoryProviderClient({
    installationToken: "installation-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response("", { status: 404 });
    },
  });

  assert.equal(await client.find(request), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/repos\/example-organization\/example-repository$/);
  assert.equal(calls[0].options.method, undefined);
});

test("provider client rejects a GraphQL node id substituted for the REST repository id", async () => {
  const client = createGitHubRepositoryProviderClient({
    installationToken: "installation-token",
    fetchImpl: async () => new Response(JSON.stringify({
      id: 987654321,
      node_id: "123456789",
      owner: { login: "example-owner" },
      name: "example-repository",
      html_url: "https://github.com/example-owner/example-repository",
      default_branch: "main",
      visibility: "private",
      archived: false,
      updated_at: TEST_CLOCK().toISOString(),
    }), { status: 200 }),
  });
  await assert.rejects(
    client.read(custodyRequest()),
    (error) => error.code === "repository_provider_identity_mismatch",
  );
});

test("provider client fails closed without configured application identity", async () => {
  const client = createGitHubRepositoryProviderClient({ installationToken: "" });
  await assert.rejects(
    client.read(custodyRequest()),
    (error) => error.code === "repository_provider_not_configured",
  );
});

test("provider client rejects unsupported and oversized provider responses", async () => {
  const unsupported = custodyRequest({
    target: {
      provider: "gitlab",
      provider_host: "gitlab.com",
      owner: "example-owner",
      name: "example-repository",
      provider_repository_id: "project-1",
    },
  });
  const client = createGitHubRepositoryProviderClient({
    installationToken: "installation-token",
    fetchImpl: async () => { throw new Error("must not call provider"); },
  });
  await assert.rejects(
    client.read(unsupported),
    (error) => error.code === "repository_provider_not_supported",
  );

  const oversized = createGitHubRepositoryProviderClient({
    installationToken: "installation-token",
    fetchImpl: async () => new Response("{}", {
      headers: { "content-length": "300000" },
      status: 200,
    }),
  });
  await assert.rejects(
    oversized.read(custodyRequest()),
    (error) => error.code === "repository_provider_response_too_large",
  );
});
