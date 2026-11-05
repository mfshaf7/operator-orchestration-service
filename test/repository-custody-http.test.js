import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { custodyRequest, provisionRequest } from "../test-fixtures/repository-custody.js";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SECRETS_JSON: JSON.stringify({
      "governance-operations-console": "console-secret",
    }),
  });
}

async function execute(app, { body = null, method = "POST", url, callerId = "governance-operations-console", callerSecret = "console-secret" }) {
  const request = body === null
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = {
    "x-oos-caller-id": callerId,
    "x-oos-caller-secret": callerSecret,
  };
  let statusCode = 200;
  let responseBody = "";
  const response = {
    end(chunk = "") { responseBody += chunk; },
    writeHead(code) { statusCode = code; },
  };
  await app(request, response);
  return { body: JSON.parse(responseBody), statusCode };
}

test("connection metadata is Console-only, authenticated and query-free", async () => {
  let reads = 0;
  const app = createApp({config:config(), deliveryService:{}, ideaService:{}, openProjectClient:{},
    repositoryCustodyService:{connections(){reads++;return {schema_version:1,default_connection_id:null,connections:[]};}}});
  const url="/v1/repository-custody/connections";
  assert.equal((await execute(app,{method:"GET",url,callerSecret:"wrong"})).statusCode,401);
  assert.equal(reads,0);
  assert.equal((await execute(app,{method:"GET",url:url+"?token=forbidden"})).statusCode,400);
  assert.equal(reads,0);
  assert.deepEqual((await execute(app,{method:"GET",url})).body,{schema_version:1,default_connection_id:null,connections:[]});
  assert.equal(reads,1);
});

test("repository custody API preserves caller and request identity", async () => {
  const calls = [];
  const request = custodyRequest();
  const app = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryCustodyService: {
      async execute(input) {
        calls.push({ operation: "execute", ...input });
        return { request: input.input, status: "succeeded" };
      },
      async project(requestId) {
        calls.push({ operation: "project", requestId });
        return { request_id: requestId, status: "succeeded" };
      },
    },
  });
  const linked = await execute(app, {
    body: request,
    url: "/v1/repository-custody/requests",
  });
  const projected = await execute(app, {
    method: "GET",
    url: `/v1/repository-custody/requests/${encodeURIComponent(request.request_id)}`,
  });
  assert.equal(linked.statusCode, 200);
  assert.equal(projected.statusCode, 200);
  assert.equal(calls[0].callerId, "governance-operations-console");
  assert.equal(calls[1].requestId, request.request_id);
});

test("custody list API authenticates reads and preserves bounded page coordinates", async () => {
  const calls = [];
  const service = {
    async list(input) {
      calls.push(input);
      return { schema_version: 1, records: [], next_cursor: null };
    },
  };
  const options = { deliveryService: {}, ideaService: {}, openProjectClient: {}, repositoryCustodyService: service };
  const app = createApp({ ...options, config: config() });
  const cursor = "a".repeat(64);
  const result = await execute(app, { method: "GET", url: `/v1/repository-custody/requests?cursor=${cursor}&limit=2` });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, [{ callerId: "governance-operations-console", cursor, limit: 2 }]);
  assert.equal((await execute(app, { method: "GET", url: "/v1/repository-custody/requests?unknown=true" })).statusCode, 400);
  const unbound = createApp({ ...options, config: loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console", CALLER_AUTH_SHARED_SECRET: "console-secret",
  }) });
  assert.equal((await execute(unbound, { method: "GET", url: "/v1/repository-custody/requests" })).statusCode, 403);
  assert.equal(calls.length, 1);
});

test("repository custody API accepts the canonical provisioning command", async () => {
  const calls = [];
  const request = provisionRequest();
  const app = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryCustodyService: {
      async execute(input) {
        calls.push(input);
        return {
          request: input.input,
          status: "applying",
          provider_operation: { state: "command-issued" },
        };
      },
      async project() { throw new Error("must not project"); },
    },
  });

  const response = await execute(app, {
    body: request,
    url: "/v1/repository-custody/requests",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.request.action, "provision-new");
  assert.equal(response.body.provider_operation.state, "command-issued");
  assert.equal(calls[0].callerId, "governance-operations-console");
});

test("repository custody API fails closed without runtime or caller-bound credential", async () => {
  const unavailable = createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
  });
  assert.equal((await execute(unavailable, {
    body: custodyRequest(),
    url: "/v1/repository-custody/requests",
  })).statusCode, 503);

  const sharedConfig = loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console",
    CALLER_AUTH_SHARED_SECRET: "console-secret",
  });
  const unbound = createApp({
    config: sharedConfig,
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    repositoryCustodyService: { async execute() { throw new Error("must not run"); } },
  });
  assert.equal((await execute(unbound, {
    body: custodyRequest(),
    url: "/v1/repository-custody/requests",
  })).statusCode, 403);
});

test("provider lookup is authenticated, bounded and read-only",async()=>{
 const calls=[];const service={async lookup(input){calls.push(input);return {schema_version:1,provider:"github"};}};
 const app=createApp({config:config(),deliveryService:{},ideaService:{},openProjectClient:{},repositoryCustodyService:service});
 const response=await execute(app,{method:"GET",url:"/v1/repository-custody/provider-repository?owner=example-org&name=manual-source"});
 assert.equal(response.statusCode,200);assert.deepEqual(calls,[{owner:"example-org",name:"manual-source"}]);
 for(const query of ["owner=org&name=repo&host=other.test","owner=org&owner=other&name=repo","owner=org"])
  assert.equal((await execute(app,{method:"GET",url:`/v1/repository-custody/provider-repository?${query}`})).statusCode,400);
 const unbound=createApp({config:loadConfig({CALLER_ALLOWED_IDS:"governance-operations-console",CALLER_AUTH_SECRET:"console-secret"}),deliveryService:{},ideaService:{},openProjectClient:{},repositoryCustodyService:service});
 assert.equal((await execute(unbound,{method:"GET",url:"/v1/repository-custody/provider-repository?owner=org&name=repo"})).statusCode,403);
 const other=createApp({config:loadConfig({CALLER_ALLOWED_IDS:"other-operator",CALLER_AUTH_SECRETS_JSON:JSON.stringify({"other-operator":"other-secret"})}),deliveryService:{},ideaService:{},openProjectClient:{},repositoryCustodyService:service});
 assert.equal((await execute(other,{method:"GET",url:"/v1/repository-custody/provider-repository?owner=org&name=repo",callerId:"other-operator",callerSecret:"other-secret"})).statusCode,403);
 assert.equal(calls.length,1);
});
