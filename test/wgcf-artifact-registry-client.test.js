import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import { canonicalDigest, canonicalStringify } from "../src/delivery-art/canonical-json.js";
import { createWgcfArtifactRegistryClient } from "../src/delivery-art/wgcf-client.js";

const CONTENT_DIGEST = `sha256:${"a".repeat(64)}`;
const RECEIPT_DIGEST = `sha256:${"b".repeat(64)}`;
const ARTIFACT_URI = `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`;
const RECEIPT_URI = `wgcf://receipts/artifact-custody/receipt-${"b".repeat(64)}.json`;
const CALLER_SECRET = "s".repeat(32);

function registryResponse({
  artifactUri = ARTIFACT_URI,
  contentDigest = CONTENT_DIGEST,
  receiptDigest = RECEIPT_DIGEST,
  receiptUri = RECEIPT_URI,
  resolution = "created",
} = {}) {
  return {
    artifact: {
      artifact_type: "delivery_art_architecture_packet",
      custody: {
        receipt_ref: {
          digest: receiptDigest,
          uri: receiptUri,
        },
        uri: artifactUri,
      },
      integrity: {
        content_digest: contentDigest,
      },
    },
    custody_receipt: {
      custody: {
        uri: receiptUri,
      },
      integrity: {
        content_digest: receiptDigest,
      },
    },
    registry: {
      artifact_ref: {
        digest: contentDigest,
        uri: artifactUri,
      },
      custody_receipt_ref: {
        digest: receiptDigest,
        uri: receiptUri,
      },
      generation: 1,
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
  return createWgcfArtifactRegistryClient({
    baseUrl: "http://wgcf.local/",
    callerId: "operator-orchestration-service",
    callerSecret: CALLER_SECRET,
    fetchImpl,
  });
}

test("WGCF artifact registry client registers canonical content with method-scoped identity", async () => {
  const calls = [];
  const artifactContent = {
    zeta: "last",
    alpha: "first",
  };
  const contentDigest = canonicalDigest(artifactContent);
  const registry = client(async (url, options) => {
    calls.push({ options, url });
    return jsonResponse(registryResponse({
      artifactUri: `wgcf://artifacts/delivery-art/sha256/${contentDigest.slice("sha256:".length)}`,
      contentDigest,
    }));
  });

  const result = await registry.register({
    artifactContent,
    contentDigest,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://wgcf.local/v1/artifacts/delivery-art");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["x-wgcf-caller-id"], "operator-orchestration-service");
  assert.equal(calls[0].options.headers["x-wgcf-caller-secret"], CALLER_SECRET);
  assert.equal(
    calls[0].options.body,
    canonicalStringify({
      artifact_content: artifactContent,
      content_digest: contentDigest,
    }),
  );
  assert.equal(result.registry.resolution, "created");
});

test("WGCF artifact registry client reads by exact digest path", async () => {
  const calls = [];
  const registry = client(async (url, options) => {
    calls.push({ options, url });
    return jsonResponse(registryResponse({ resolution: "read" }));
  });

  const result = await registry.read({ contentDigest: CONTENT_DIGEST });

  assert.equal(
    calls[0].url,
    `http://wgcf.local/v1/artifacts/delivery-art/${"a".repeat(64)}`,
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(result.registry.resolution, "read");
});

test("WGCF artifact registry client fails closed without exposing transport errors", async () => {
  const registry = client(async () => {
    throw new Error(`connection failed with ${CALLER_SECRET}`);
  });

  await assert.rejects(
    () => registry.read({ contentDigest: CONTENT_DIGEST }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "wgcf_artifact_registry_unavailable");
      assert.doesNotMatch(error.message, new RegExp(CALLER_SECRET));
      return true;
    },
  );
});

for (const [status, code] of [
  [401, "wgcf_artifact_registry_unauthorized"],
  [403, "wgcf_artifact_registry_forbidden"],
  [409, "wgcf_artifact_registry_conflict"],
]) {
  test(`WGCF artifact registry client maps ${status} without returning remote detail`, async () => {
    const registry = client(async () =>
      jsonResponse({ detail: `sensitive ${CALLER_SECRET}` }, { status }));

    await assert.rejects(
      () => registry.read({ contentDigest: CONTENT_DIGEST }),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.statusCode, status);
        assert.equal(error.code, code);
        assert.deepEqual(error.details, { registry_status: status });
        assert.doesNotMatch(JSON.stringify(error), new RegExp(CALLER_SECRET));
        return true;
      },
    );
  });
}

test("WGCF artifact registry client rejects inconsistent response references", async () => {
  const registry = client(async () =>
    jsonResponse(registryResponse({ artifactUri: "wgcf://artifacts/delivery-art/wrong.json" })));

  await assert.rejects(
    () => registry.read({ contentDigest: CONTENT_DIGEST }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      error.code === "wgcf_artifact_registry_invalid_response",
  );
});

test("WGCF artifact registry client rejects oversized artifact content before transport", async () => {
  let called = false;
  const registry = client(async () => {
    called = true;
    return jsonResponse(registryResponse());
  });

  await assert.rejects(
    () => registry.register({
      artifactContent: { body: "x".repeat(1_048_577) },
      contentDigest: CONTENT_DIGEST,
    }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 413 &&
      error.code === "wgcf_artifact_registry_content_oversized",
  );
  assert.equal(called, false);
});

test("WGCF artifact registry client stops reading an oversized streamed response", async () => {
  let chunksRead = 0;
  const registry = client(async () => ({
    body: {
      async *[Symbol.asyncIterator]() {
        chunksRead += 1;
        yield Buffer.alloc(1_200_000, 0x78);
        chunksRead += 1;
        yield Buffer.alloc(1_200_000, 0x78);
        chunksRead += 1;
        yield Buffer.alloc(1_200_000, 0x78);
      },
    },
    ok: true,
    status: 200,
  }));

  await assert.rejects(
    () => registry.read({ contentDigest: CONTENT_DIGEST }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 502 &&
      error.code === "wgcf_artifact_registry_response_oversized",
  );
  assert.equal(chunksRead, 2);
});

test("WGCF artifact registry client rejects invalid caller configuration before transport", async () => {
  const registry = createWgcfArtifactRegistryClient({
    baseUrl: "http://wgcf.local",
    callerSecret: "too-short",
    fetchImpl: async () => jsonResponse(registryResponse()),
  });

  await assert.rejects(
    () => registry.read({ contentDigest: CONTENT_DIGEST }),
    (error) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      error.code === "wgcf_artifact_registry_not_configured",
  );
});
