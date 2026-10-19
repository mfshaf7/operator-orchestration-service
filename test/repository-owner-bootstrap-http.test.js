import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DeliveryArtSourceExecutorError } from "../src/delivery-art/source-executor.js";
import { createRepositoryOwnerBootstrapFacade, createRepositoryOwnerBootstrapRuntime } from "../src/repository-owner-bootstrap/runtime.js";
import { ownerBootstrapSchemas, ownerBootstrapExamples } from "../scripts/sync_repository_owner_bootstrap_openapi.mjs";

const caller = "governance-operations-console", operator = "operator:fixture";
const config = shared => loadConfig({ CALLER_ALLOWED_IDS: caller,
  ...(shared ? { CALLER_AUTH_SHARED_SECRET: "test-secret" } : { CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [caller]: "test-secret" }) }) });
async function invoke(app, { url = "/v1/repository-owner-bootstrap/preparations", method = "POST", body = "{}", secret = "test-secret", accept = "application/json" } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { method, url, headers: { "x-oos-caller-id": caller, "x-oos-caller-secret": secret, accept } });
  let code, headers, output = "";
  await app(request, { writeHead(value, values) { code = value; headers = values; }, end(value) { output += value ?? ""; } });
  return { code, headers, body: JSON.parse(output) };
}

test("bootstrap APIs preserve real caller/operator and encoded original request ids across every named source control", async () => {
  const calls = [];
  const service = Object.fromEntries(["create", "read", "draft", "start", "materializeExisting", "cancelUnapplied", "accept", "recover", "publish", "review", "merge", "close"].map(method => [method, async input => {
    calls.push({ method, ...input }); return structuredClone(ownerBootstrapExamples.projection);
  }]));
  service.list = async input => { calls.push({ method: "list", ...input }); return { schema_version: 1, workflow_id: "repository-owner-bootstrap-list", owner_repo: "example-owner-source", pending_request: null, records: [] }; };
  const facade = createRepositoryOwnerBootstrapFacade({ service, operatorBindings: { [caller]: operator },
    preparations: { prepare: async input => { calls.push({ method: "prepare", ...input }); return ownerBootstrapExamples.preparation; } } });
  const app = createApp({ config: config(), repositoryOwnerBootstrapService: facade });
  assert.equal((await invoke(app)).code, 200);
  assert.equal((await invoke(app, { url: "/v1/repository-owner-bootstrap/requests" })).code, 201);
  assert.equal((await invoke(app, { method: "GET", body: "", url: "/v1/repository-owner-bootstrap/requests?owner_repo=example-owner-source" })).code, 200);
  const root = "/v1/repository-owner-bootstrap/requests/request%3Atest";
  assert.equal((await invoke(app, { method: "GET", body: "", url: root })).code, 200);
  assert.equal((await invoke(app, { method: "GET", body: "", url: `${root}/draft` })).code, 200);
  for (const action of ["session", "existing-checkout", "cancel-unapplied", "accept", "recover", "publish", "review", "merge", "close"]) {
    assert.equal((await invoke(app, { url: `${root}/${action}` })).code, 200);
  }
  assert.ok(calls.every(call => call.callerId === caller && call.operatorId === operator));
  assert.ok(calls.filter(call => !["create", "prepare", "list"].includes(call.method)).every(call => call.requestId === "request:test"));
  assert.equal(calls.length, 14);
});

test("inactive source, wrong credentials, shared fallback, duplicate fields, oversize input and unknown query options fail closed", async () => {
  assert.equal((await invoke(createApp({ config: config() }))).code, 503);
  assert.equal((await invoke(createApp({ config: config() }), { secret: "wrong" })).code, 401);
  assert.equal((await invoke(createApp({ config: config(true) }))).code, 403);
  const noWrite = new Proxy({}, { get() { throw new Error("Invalid transport input must not reach the service"); } });
  const app = createApp({ config: config(), repositoryOwnerBootstrapService: noWrite });
  assert.equal((await invoke(app, { body: '{"a":1,"a":2}' })).code, 400);
  assert.equal((await invoke(app, { body: JSON.stringify({ text: "x".repeat(65536) }) })).code, 413);
  assert.equal((await invoke(app, { method: "GET", body: "", url: "/v1/repository-owner-bootstrap/requests?owner_repo=one&owner_repo=two" })).code, 400);
  assert.equal((await invoke(app, { method: "GET", body: "", url: "/v1/repository-owner-bootstrap/requests?owner_repo=one&force=true" })).code, 400);
  assert.equal(createRepositoryOwnerBootstrapRuntime({ sourceConfig: { sourceRealization: { enabled: false } } }), null);
});

test("source executor failure is projected as a bounded owner code, not raw provider diagnostics", async () => {
  const app = createApp({ config: config(), repositoryOwnerBootstrapService: { async create() {
    throw new DeliveryArtSourceExecutorError("bootstrap_source_owner_unavailable", "Do not project raw private owner diagnostic material", { statusCode: 503 });
  } } });
  const response = await invoke(app, { url: "/v1/repository-owner-bootstrap/requests" });
  assert.equal(response.code, 503);
  assert.equal(response.body.details.owner_code, "bootstrap_source_owner_unavailable");
  assert.equal(JSON.stringify(response.body).includes("raw private"), false);
});

test("bootstrap OpenAPI DTOs retain strict inputs and separate source-only preparation from application acceptance", () => {
  const compile = name => {
    const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
    return ajv.compile({ $ref: `#/components/schemas/${name}`, components: { schemas: ownerBootstrapSchemas } });
  };
  for (const [name, example] of [["OwnerBootstrapPreparationInput", ownerBootstrapExamples.input], ["OwnerBootstrapPreparation", ownerBootstrapExamples.preparation],
    ["OwnerBootstrapRequest", ownerBootstrapExamples.request], ["OwnerBootstrapProjection", ownerBootstrapExamples.projection]]) {
    const validator = compile(name);
    assert.equal(validator(example), true, JSON.stringify(validator.errors));
  }
  const input = compile("OwnerBootstrapPreparationInput");
  assert.equal(input({ ...ownerBootstrapExamples.input, provider_repository: { full_name: "untrusted/substitution" } }), false);
  assert.equal(input({ ...ownerBootstrapExamples.input, token: "not-accepted" }), false);
  const projection = compile("OwnerBootstrapProjection");
  assert.equal(projection({ ...ownerBootstrapExamples.projection, app_acceptance: true }), false);
  assert.equal(projection({ ...ownerBootstrapExamples.projection, inventory_admission: true }), false);
});
