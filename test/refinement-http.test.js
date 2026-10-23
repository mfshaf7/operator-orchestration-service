import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RefinementServiceError } from "../src/refinement/service.js";
import { sourceRevisionDigest } from "../src/console-source-authority.js";

function config() {
  return loadConfig({
    CALLER_ALLOWED_IDS: "governance-operations-console,wgcf",
    CALLER_AUTH_SHARED_SECRET: "test-secret",
  });
}

async function executeRequest(app, {
  body = null,
  callerId = "governance-operations-console",
  method = "POST",
  url,
  accept,
}) {
  const request = body === null
    ? Readable.from([])
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = url;
  request.headers = {
    "x-oos-caller-id": callerId,
    "x-oos-caller-secret": "test-secret",
  };
  if (body !== null) request.headers["content-type"] = "application/json";
  if (accept) request.headers.accept = accept;
  let statusCode = 200;
  let responseBody = "";
  const response = {
    end(chunk = "") { responseBody += chunk; },
    writeHead(code) { statusCode = code; },
  };
  await app(request, response);
  return {
    body: responseBody ? JSON.parse(responseBody) : null,
    statusCode,
  };
}

function appWith(refinementService) {
  return createApp({
    config: config(),
    deliveryService: {},
    ideaService: {},
    openProjectClient: {},
    refinementService,
  });
}

for (const family of ["refinement", "work-design"]) {
  test(`${family} canonical aggregate snapshots advance independently of unchanged input record versions`, async () => {
    let sequence=0;
    const base=Date.parse("2026-10-23T01:00:00.000Z");
    const service={async project(){
      const projected_at=new Date(base+sequence++).toISOString();
      return family==="refinement"
        ? {source_revision:"version-5",packet:{source:{source_ref:"openproject://work_packages/909",source_revision:"version-5"}},history:[],projected_at}
        : {source:{ref:"openproject://work_packages/909",revision:"version-5"},history:[],projected_at};
    }};
    const app=createApp({config:config(),deliveryService:{},ideaService:{},openProjectClient:{},refinementService:service,workDesignService:service});
    const url=`/v1/delivery-${family}/delivery-package%3A909/projection?source_ref=openproject%3A%2F%2Fwork_packages%2F909`;
    const read=()=>executeRequest(app,{method:"GET",url,accept:"application/vnd.mfshaf7.console-source-projection+json; version=1"});
    const first=await read(),second=await read();
    assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);
    assert.deepEqual(first.body.binding,second.body.binding);
    assert.equal(first.body.revision.event_sequence,base);
    assert.equal(second.body.revision.event_sequence,base+1);
    for (const {body} of [first,second]) {
      assert.equal(body.revision.source_revision,sourceRevisionDigest(body.projection));
      assert.notEqual(body.revision.source_revision,"version-5");
      assert.equal(family==="refinement"?body.projection.source_revision:body.projection.source.revision,"version-5","optimistic mutation input revision is preserved");
    }
    assert.notEqual(first.body.revision.source_revision,second.body.revision.source_revision);
    assert.notEqual(first.body.revision.event_cursor,second.body.revision.event_cursor);
    const compatible=await executeRequest(app,{method:"GET",url,accept:"application/json"});
    assert.equal(compatible.statusCode,200);
    assert.equal(compatible.body.artifact_type,undefined,"default JSON remains the domain projection");
    assert.equal(family==="refinement"?compatible.body.source_revision:compatible.body.source.revision,"version-5");
  });
}

test("Refinement HTTP routes preserve package, source, run, and caller identity", async () => {
  const calls = [];
  const app = appWith({
    async assist(input) {
      calls.push({ operation: "assist", ...input });
      return { status: "ready" };
    },
    async apply(input) {
      calls.push({ operation: "apply", ...input });
      return { state: "accepted" };
    },
    async getRun(input) {
      calls.push({ operation: "getRun", ...input });
      return { state: "running" };
    },
    async project(input) {
      calls.push({ operation: "project", ...input });
      return { packet: {} };
    },
  });

  const projection = await executeRequest(app, {
    method: "GET",
    url: "/v1/delivery-refinement/delivery-package%3A909/projection?source_ref=openproject%3A%2F%2Fwork_packages%2F909",
  });
  const assist = await executeRequest(app, {
    body: { correlation_id: "correlation-1" },
    url: "/v1/delivery-refinement/delivery-package%3A909/assist",
  });
  const apply = await executeRequest(app, {
    body: { correlation_id: "correlation-2" },
    url: "/v1/delivery-refinement/delivery-package%3A909/apply",
  });
  const run = await executeRequest(app, {
    method: "GET",
    url: "/v1/delivery-refinement/delivery-package%3A909/runs/refinement-run%3A1",
  });

  assert.equal(projection.statusCode, 200);
  assert.equal(assist.statusCode, 200);
  assert.equal(apply.statusCode, 202);
  assert.equal(run.statusCode, 200);
  assert.equal(calls[0].packageId, "delivery-package:909");
  assert.equal(calls[0].sourceRef, "openproject://work_packages/909");
  assert.equal(calls[0].callerId, "governance-operations-console");
  assert.equal(calls[3].runId, "refinement-run:1");
});

test("Refinement projection requires a source reference", async () => {
  const response = await executeRequest(appWith({}), {
    method: "GET",
    url: "/v1/delivery-refinement/package-1/projection",
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "request_invalid");
});

test("Refinement apply preserves existing Delivery mutation authority", async () => {
  const response = await executeRequest(appWith({
    async apply() { throw new Error("must not execute"); },
  }), {
    body: {},
    callerId: "wgcf",
    url: "/v1/delivery-refinement/package-1/apply",
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, "caller_recommendation_only");
});

test("Refinement routes emit the bounded workflow error contract", async () => {
  const response = await executeRequest(appWith({
    async assist({ request }) {
      throw new RefinementServiceError(
        "ai_profile_inactive",
        "The governed Refinement profile is not active.",
        {
          auditRef: "local-ledger:denied-1",
          correlationId: request.correlation_id,
          statusCode: 503,
        },
      );
    },
  }), {
    body: { correlation_id: "correlation-1" },
    url: "/v1/delivery-refinement/package-1/assist",
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.schema_version, 1);
  assert.equal(response.body.code, "ai_profile_inactive");
  assert.equal(response.body.audit_ref, "local-ledger:denied-1");
  assert.equal(Object.hasOwn(response.body, "receipt_ref"), false);
});
