import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/errors.js";
import { createWgcfArtReadinessClient } from "../src/wgcf-art-readiness-client.js";

test("WGCF ART readiness client posts context and returns readiness", async () => {
  const calls = [];
  const client = createWgcfArtReadinessClient({
    baseUrl: "http://wgcf.local/",
    async fetchImpl(url, options) {
      calls.push({ options, url });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            readiness: {
              mutation_allowed: true,
              outcome: "ready",
              receipt_id: "art-readiness-receipt:client",
            },
          };
        },
      };
    },
  });

  const readiness = await client.evaluate({
    context: { workflow_id: "delivery-work-item-continuation-context" },
    operation: "complete",
    targetItemId: 567,
  });

  assert.equal(calls[0].url, "http://wgcf.local/v1/art/readiness");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    context: { workflow_id: "delivery-work-item-continuation-context" },
    operation: "complete",
    target_item_id: 567,
  });
  assert.equal(readiness.receipt_id, "art-readiness-receipt:client");
});

test("WGCF ART readiness client converts network failure into fail-closed HTTP error", async () => {
  const client = createWgcfArtReadinessClient({
    baseUrl: "http://wgcf.local",
    async fetchImpl() {
      throw new Error("connection refused");
    },
  });

  await assert.rejects(
    () =>
      client.evaluate({
        context: {},
        operation: "complete",
        targetItemId: 567,
      }),
    (error) =>
      error instanceof HttpError &&
      error.code === "wgcf_art_readiness_unavailable" &&
      error.statusCode === 503,
  );
});
