import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createPrototypeMaturityEvaluation } from "../src/prototype-maturity/contracts.js";
import { createPrototypeMaturityGitHubClient } from "../src/prototype-maturity/provider-client.js";
import { createWgcfPrototypeMaturityClient } from "../src/prototype-maturity/wgcf-client.js";
import {
  at,
  caller,
  commandFixture,
  readinessFixture,
} from "../test-fixtures/prototype-maturity/fixture.js";

test("WGCF maturity issue and readback bind one durable readiness", async () => {
  const evaluation = createPrototypeMaturityEvaluation(commandFixture(), caller);
  const calls = [];
  const client = createWgcfPrototypeMaturityClient({
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    implementationRef: "4".repeat(40),
    serviceIdentityRef: "spiffe://test/wgcf/prototype-maturity",
    clock: () => new Date(at),
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      const result = readinessFixture(evaluation);
      result.ledger.resolution = request.method === "POST" ? "created" : "read";
      return Response.json(result);
    },
  });
  const result = await client.evaluate(evaluation);
  assert.equal(result.readiness.outcome, "ready");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/v1\/readiness\/prototype-maturity\//);
});

test("WGCF maturity rejects stale and issuer-mismatched readiness", async () => {
  const evaluation = createPrototypeMaturityEvaluation(commandFixture(), caller);
  const options = {
    baseUrl: "http://127.0.0.1:18080",
    callerId: "operator-orchestration-service",
    callerSecret: "s".repeat(32),
    implementationRef: "4".repeat(40),
    serviceIdentityRef: "spiffe://test/wgcf/prototype-maturity",
  };
  await assert.rejects(
    createWgcfPrototypeMaturityClient({
      ...options,
      clock: () => new Date("2026-09-10T02:16:00.000Z"),
      fetchImpl: async () => Response.json(readinessFixture(evaluation)),
    }).evaluate(evaluation),
    /expired/,
  );
  await assert.rejects(
    createWgcfPrototypeMaturityClient({
      ...options,
      clock: () => new Date(at),
      fetchImpl: async () => {
        const result = readinessFixture(evaluation);
        result.ledger.implementation_ref = "7".repeat(40);
        return Response.json(result);
      },
    }).evaluate(evaluation),
    /configured issuer/,
  );
});

test("maturity provider rejects broad credentials, PATs and alternate destinations", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "prototype-maturity-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tokenFile = path.join(root, "token");
  await writeFile(tokenFile, "ghs_test", { mode: 0o600 });
  const options = { owner: "example", repositoryId: "123", tokenFile };
  assert.throws(
    () => createPrototypeMaturityGitHubClient({ ...options, apiBaseUrl: "https://other.invalid" }),
    /not admitted/,
  );
  let broad = true;
  const client = createPrototypeMaturityGitHubClient({
    ...options,
    fetchImpl: async (url, request) => {
      assert.equal(request.redirect, "error");
      assert.equal(request.headers.Authorization, "Bearer ghs_test");
      if (url.includes("/installation/repositories")) {
        return Response.json({
          total_count: broad ? 2 : 1,
          repositories: [{ id: 123, full_name: "example/workspace-prototype-studio" }],
        });
      }
      return Response.json({ object: { sha: "1".repeat(40) } });
    },
  });
  await assert.rejects(client.mainRevision(), /restricted/);
  broad = false;
  assert.equal(await client.mainRevision(), "1".repeat(40));
  await writeFile(tokenFile, "ghp_personal");
  await assert.rejects(client.mainRevision(), /installation token/);
});
