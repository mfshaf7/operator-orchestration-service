import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalStringify } from "../src/delivery-art/canonical-json.js";
import {
  createWgcfDeliveryArtReadinessClient,
} from "../src/delivery-art/wgcf-readiness-client.js";
import { HttpError } from "../src/errors.js";

const FIXTURE_DIR = fileURLToPath(
  new URL("../contracts/delivery-art/fixtures/", import.meta.url),
);
const CALLER_SECRET = "s".repeat(32);

function fixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

function readinessRequest(receipt = fixture("readiness-receipt.valid.json")) {
  return {
    artifact_id: receipt.subject.artifact_id,
    artifact_type: receipt.subject.artifact_type,
    covered_work_item_ids: receipt.covered_work_item_ids,
    delivery_id: receipt.delivery_id,
    digest: receipt.subject.digest,
    digest_kind: receipt.subject.digest_kind,
    readiness_level: receipt.readiness.level,
  };
}

function readinessResponse(receipt = fixture("readiness-receipt.valid.json"), resolution = "created") {
  return {
    artifact: receipt,
    receipt: {
      generation: 1,
      ref: {
        digest: receipt.integrity.content_digest,
        uri: receipt.custody.uri,
      },
      resolution,
      state: "durable",
    },
  };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function client(fetchImpl) {
  return createWgcfDeliveryArtReadinessClient({
    baseUrl: "http://wgcf.local/",
    callerId: "operator-orchestration-service",
    callerSecret: CALLER_SECRET,
    fetchImpl,
  });
}

test("WGCF Delivery ART readiness client issues an exact operating-readiness request", async () => {
  const calls = [];
  const request = readinessRequest();
  const candidate = fixture("review-packet-finalized.valid.json");
  const readiness = client(async (url, options) => {
    calls.push({ options, url });
    return jsonResponse(readinessResponse());
  });

  const result = await readiness.issue({
    finalizationCandidate: candidate,
    readinessRequest: request,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://wgcf.local/v1/readiness/delivery-art");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[0].options.headers["x-wgcf-caller-id"],
    "operator-orchestration-service",
  );
  assert.equal(calls[0].options.headers["x-wgcf-caller-secret"], CALLER_SECRET);
  assert.equal(
    calls[0].options.body,
    canonicalStringify({
      finalization_candidate: candidate,
      profile_id: "dev-integration",
      readiness_request: request,
      schema_version: 1,
    }),
  );
  assert.equal(result.artifact.readiness.mutation_allowed, true);
});

test("WGCF Delivery ART readiness client reads the exact content-addressed receipt", async () => {
  const calls = [];
  const receipt = fixture("readiness-receipt.valid.json");
  const readiness = client(async (url, options) => {
    calls.push({ options, url });
    return jsonResponse(readinessResponse(receipt, "read"));
  });

  const result = await readiness.read({
    reference: {
      digest: receipt.integrity.content_digest,
      uri: receipt.custody.uri,
    },
  });

  assert.equal(
    calls[0].url,
    "http://wgcf.local/v1/readiness/delivery-art/0123456789abcdef01234567",
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(result.receipt.resolution, "read");
});

test("WGCF Delivery ART readiness client rejects a mismatched returned receipt", async () => {
  const receipt = fixture("readiness-receipt.valid.json");
  const response = readinessResponse();
  response.artifact.custody.uri = response.artifact.custody.uri.replace(
    "0123456789abcdef01234567",
    "abcdef0123456789abcdef01",
  );
  const readiness = client(async () => jsonResponse(response));

  await assert.rejects(
    () => readiness.read({
      reference: {
        digest: receipt.integrity.content_digest,
        uri: receipt.custody.uri,
      },
    }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      error.code === "wgcf_delivery_art_readiness_invalid_response",
  );
});

test("WGCF Delivery ART readiness client fails closed without exposing transport errors", async () => {
  const readiness = client(async () => {
    throw new Error(`connection failed with ${CALLER_SECRET}`);
  });

  await assert.rejects(
    () => readiness.issue({
      finalizationCandidate: {},
      readinessRequest: readinessRequest(),
    }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "wgcf_delivery_art_readiness_unavailable");
      assert.doesNotMatch(error.message, new RegExp(CALLER_SECRET));
      return true;
    },
  );
});

test("WGCF Delivery ART readiness client rejects invalid configuration before transport", async () => {
  const readiness = createWgcfDeliveryArtReadinessClient({
    baseUrl: "http://wgcf.local",
    callerSecret: "too-short",
    fetchImpl: async () => jsonResponse(readinessResponse()),
  });

  await assert.rejects(
    () => readiness.issue({
      finalizationCandidate: {},
      readinessRequest: readinessRequest(),
    }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.code === "wgcf_delivery_art_readiness_not_configured",
  );
});
