import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createWorkspaceIntakeGitHubClient } from "../src/workspace-intake/provider-client.js";
import { createWorkspaceIntakeSourceClient } from "../src/workspace-intake/source-client.js";
import { createWorkspaceInventoryGitHubClient } from "../src/workspace-inventory/provider-client.js";
import { createWorkspaceInventorySourceClient } from "../src/workspace-inventory/source-client.js";

const sourceRepository = { provider: "github", provider_repository_id: "456", full_name: "example/project" };
async function harness(t, { destination = "public", project = "public", fault = null, factory = createWorkspaceIntakeGitHubClient } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "intake-privacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tokenFile = path.join(directory, "token");
  await writeFile(tokenFile, "ghs_synthetic-authority-only", { mode: 0o600 });
  const calls = [];
  const client = factory({ owner: "example", repositoryId: "123", tokenFile,
    fetchImpl: async (url, input) => {
      calls.push({ url, ...input });
      assert.equal(input.method, "GET", "Privacy verification must precede every provider write");
      assert.equal(input.redirect, "error");
      if (url.endsWith("/installation/repositories?per_page=2")) {
        assert.equal(input.headers.Authorization, "Bearer ghs_synthetic-authority-only");
        const authority = { id: 123, full_name: "example/workspace-governance", private: destination !== "public", visibility: destination };
        if (destination === "unknown") { delete authority.private; delete authority.visibility; }
        return Response.json({ total_count: 1, repositories: [authority] });
      }
      assert.equal(url, "https://api.github.com/repositories/456");
      assert.equal(input.headers.Authorization, undefined, "Never send the authority credential to the project visibility read");
      if (fault === "unavailable") return Response.json({}, { status: 404 });
      if (fault === "temporary") return Response.json({}, { status: 503 });
      if (fault === "null") return Response.json(null);
      const record = { id: fault === "wrong-id" ? 789 : 456, full_name: "example/project", private: project !== "public", visibility: project, disabled: false };
      if (fault === "unknown") { delete record.private; delete record.visibility; }
      return Response.json(record);
    } });
  return { client, calls };
}

for (const project of ["private", "internal"]) test(`A ${project} project's metadata cannot enter a public Intake source review`, async t => {
  const h = await harness(t, { project });
  await assert.rejects(h.client.prepareReview({ branch: `intake/${"a".repeat(64)}`, base_commit: "b".repeat(40), register_text: "synthetic-private-record" },
    { requestId: "request:synthetic", binding: "c".repeat(64), sourceRepository }),
  error => error.code === "workspace_intake_private_records_authority_required");
  assert.equal(h.calls.some(call => call.method !== "GET"), false);
});

for (const fault of ["unavailable", "wrong-id", "unknown", "null"]) test(`Unverified project metadata fails closed before publication (${fault})`, async t => {
  const h = await harness(t, { fault });
  await assert.rejects(h.client.assertRecordPublication(sourceRepository), /public|private/i);
  assert.equal(h.calls.some(call => call.method !== "GET"), false);
});

for (const method of ["prepareReview", "prepareLifecycleReview"]) test(`Inventory ${method} also rejects private metadata before source publication`, async t => {
  const h = await harness(t, { factory: createWorkspaceInventoryGitHubClient, project: "private" });
  await assert.rejects(h.client[method]({ branch: `inventory/${"a".repeat(64)}`, base_commit: "b".repeat(40) },
    { requestId: "request:synthetic", binding: "c".repeat(64), target: { kind: "repo", name: "project" }, action: "update", sourceRepository }),
  error => error.code === "workspace_inventory_private_records_authority_required");
  assert.equal(h.calls.some(call => call.method !== "GET"), false);
});

test("Inventory promotion and update pass the selected canonical provider binding to the same guard", async () => {
  const contexts = [];
  const client = createWorkspaceInventorySourceClient({ authorityRoot: "/synthetic-authority", provider: {
    prepareReview: async (_preparation, context) => contexts.push(context),
    prepareLifecycleReview: async (_preparation, context) => contexts.push(context),
  } });
  const request = { request_id: "request:synthetic", target: { kind: "repo" }, active_record: { value: { provider_repository: sourceRepository } } };
  await client.openReview({ request, preparation: {}, binding_digest: "binding:synthetic" }, () => {});
  await client.openLifecycleReview({ request: { ...request, action: "update", requested_value: { provider_repository: sourceRepository } }, preparation: {}, binding_digest: "binding:synthetic" }, () => {});
  assert.equal(contexts.length, 2);
  for (const context of contexts) assert.deepEqual(context.sourceRepository, sourceRepository);
});

test("Known public project metadata passes the guard without granting another provider operation", async t => {
  const h = await harness(t);
  await h.client.assertRecordPublication(sourceRepository);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].headers.Authorization, undefined);
});

test("Unknown records-authority visibility fails closed before any project read or publication", async t => {
  const h = await harness(t, { destination: "unknown" });
  await assert.rejects(h.client.assertRecordPublication(sourceRepository), error => error.code === "workspace_intake_publication_visibility_unproven");
  assert.equal(h.calls.length, 1);
});

test("A temporary public-metadata failure remains retryable without being called private-source authority", async t => {
  const h = await harness(t, { fault: "temporary" });
  await assert.rejects(h.client.assertRecordPublication(sourceRepository), error => error.statusCode === 503 && error.code === "workspace_intake_publication_visibility_unavailable");
  assert.equal(h.calls.some(call => call.method !== "GET"), false);
});

test("A verified private records destination preserves privacy without probing project metadata anonymously", async t => {
  const h = await harness(t, { destination: "private", project: "private" });
  await h.client.assertRecordPublication(sourceRepository);
  assert.equal(h.calls.length, 1);
});

test("An invalid provider identity cannot select an arbitrary destination", async t => {
  const h = await harness(t);
  await assert.rejects(h.client.assertRecordPublication({ ...sourceRepository, provider_repository_id: "../other" }), /canonical provider identity/);
  assert.equal(h.calls.length, 0);
});

test("The normal Intake source adapter passes the canonical project binding into the publication guard", async () => {
  let selected;
  const client = createWorkspaceIntakeSourceClient({ authorityRoot: "/synthetic-authority", provider: {
    prepareReview: async (_preparation, context) => { selected = context; return "review-not-published"; },
  } });
  const request = { request_id: "request:synthetic", target: { kind: "repo" }, requested_record: { provider_repository: sourceRepository } };
  assert.equal(await client.openReview({ request, preparation: {}, binding_digest: "binding:synthetic" }, () => {}), "review-not-published");
  assert.deepEqual(selected.sourceRepository, sourceRepository);
});
