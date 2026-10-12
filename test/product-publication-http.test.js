import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const callerId = "governance-operations-console";
const operatorId = "operator:mfshaf7";
const config = loadConfig({
  CALLER_ALLOWED_IDS: callerId,
  CALLER_AUTH_SECRETS_JSON: JSON.stringify({ [callerId]: "test-secret" }),
});

async function invoke(app, { method = "POST", url = "/v1/product-publications", body = "{}", operator = operatorId } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, {
    method,
    url,
    headers: {
      "x-oos-caller-id": callerId,
      "x-oos-caller-secret": "test-secret",
      "x-oos-operator-id": operator,
    },
  });
  let code;
  let output = "";
  await app(request, {
    writeHead(value) { code = value; },
    end(value) { output += value ?? ""; },
  });
  return { code, body: JSON.parse(output) };
}

test("Product Publication exposes submit and caller-scoped read routes", async () => {
  const calls = [];
  const projection = {
    revision: 1,
    receipt_digest: `sha256:${"a".repeat(64)}`,
    receipt: { recorded_at: "2026-10-12T05:15:00Z" },
    owner_receipt: { uri: "oos://product-publication/owner-receipts/1" },
  };
  const service = {
    async submit(value) { calls.push(value); return projection; },
    async get(value) { calls.push(value); return projection; },
  };
  const app = createApp({ config, productPublicationService: service });
  const submitted = await invoke(app, { body: '{"schema_version":1}' });
  assert.equal(submitted.code, 201);
  const read = await invoke(app, {
    method: "GET",
    url: "/v1/product-publications/product-publication-request%3Aconsole%3A1",
    body: "",
  });
  assert.equal(read.code, 200);
  assert.equal(calls[0].callerId, callerId);
  assert.equal(calls[0].operatorId, operatorId);
  assert.equal(calls[1].requestId, "product-publication-request:console:1");
});

test("Product Publication routes deny inactive runtime and missing operator attribution", async () => {
  assert.equal((await invoke(createApp({ config }))).code, 503);
  const app = createApp({
    config,
    productPublicationService: { submit() { throw new Error("must not execute"); } },
  });
  assert.equal((await invoke(app, { operator: "" })).code, 400);
});
