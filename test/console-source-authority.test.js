import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ConsoleSourceAuthorityError,
  canonicalSourceProjectionRequested,
  createConsoleSourceProjection,
  createConsoleSourceReceiptBinding,
  sourceFreshnessState,
  sourceRevisionDigest,
} from "../src/console-source-authority.js";

const observedAt = "2026-09-27T00:00:00.000Z";

test("case:trusted-console-1183-positive creates exact ordered source and receipt evidence", () => {
  const projection = createConsoleSourceProjection({
    observedAt,
    projection: { state: "ready" },
    recordRef: "openproject://work_packages/1183",
    sourceOwner: "workspace-delivery-art",
    sourceRef: "oos://delivery-art/work-items/1183",
    sourceRevision: "version-42",
  });
  const receipt = createConsoleSourceReceiptBinding({
    projection,
    receiptRef: "oos-receipt://delivery-art/1183/42",
    recordedAt: "2026-09-27T00:00:01.000Z",
  });

  assert.deepEqual(projection.binding, {
    authority: "operator-orchestration-service",
    record_ref: "openproject://work_packages/1183",
    source_owner: "workspace-delivery-art",
    source_ref: "oos://delivery-art/work-items/1183",
  });
  assert.equal(projection.revision.event_sequence, 42);
  assert.match(projection.revision.event_cursor, /^oos-source-event:[0-9a-f]{64}$/);
  assert.equal(projection.revision.source_revision, "version-42");
  assert.deepEqual(receipt.binding, projection.binding);
  assert.deepEqual(receipt.revision, projection.revision);
  assert.equal(projection.freshness.state, "current");
  assert.equal(projection.freshness.valid_until, "2026-09-27T00:05:00.000Z");
});

test("case:trusted-console-1183-negative rejects incomplete ordering, invalid freshness, and mismatched receipt time", () => {
  assert.throws(
    () => createConsoleSourceProjection({
      observedAt,
      projection: {},
      recordRef: "openproject://work_packages/1183",
      sourceOwner: "workspace-delivery-art",
      sourceRef: "oos://delivery-art/work-items/1183",
      sourceRevision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    (error) =>
      error instanceof ConsoleSourceAuthorityError &&
      error.code === "source_authority_invalid",
  );

  assert.throws(
    () => createConsoleSourceProjection({
      eventSequence: 1,
      freshnessState: "healthy",
      observedAt,
      projection: {},
      recordRef: "record:1",
      sourceOwner: "owner",
      sourceRef: "source:1",
      sourceRevision: "revision:1",
    }),
    ConsoleSourceAuthorityError,
  );

  const projection = createConsoleSourceProjection({
    eventSequence: 1,
    observedAt,
    projection: {},
    recordRef: "record:1",
    sourceOwner: "owner",
    sourceRef: "source:1",
    sourceRevision: "revision:1",
  });
  assert.throws(
    () => createConsoleSourceReceiptBinding({
      projection,
      receiptRef: "receipt:1",
      recordedAt: "2026-09-26T23:59:59.000Z",
    }),
    ConsoleSourceAuthorityError,
  );
});

test("canonical media negotiation and domain freshness mapping are explicit", () => {
  assert.equal(
    canonicalSourceProjectionRequested({
      headers: {
        accept: "application/json, application/vnd.mfshaf7.console-source-projection+json; version=1",
      },
    }),
    true,
  );
  assert.equal(
    canonicalSourceProjectionRequested({ headers: { accept: "application/json" } }),
    false,
  );
  assert.equal(
    canonicalSourceProjectionRequested({
      headers: {
        accept: "application/json, application/vnd.mfshaf7.console-source-projection+json; version=2",
      },
    }),
    false,
  );
  assert.throws(
    () => canonicalSourceProjectionRequested({
      headers: {
        accept: "application/vnd.mfshaf7.console-source-projection+json; version=2",
      },
    }),
    (error) =>
      error instanceof ConsoleSourceAuthorityError &&
      error.code === "source_projection_version_not_acceptable" &&
      error.statusCode === 406,
  );
  assert.equal(sourceFreshnessState({ projection_state: "offline" }), "unavailable");
  assert.equal(sourceFreshnessState({ projection_status: "stale" }), "stale");
  assert.equal(sourceFreshnessState({ projection_status: "partial" }), "unknown");
  assert.equal(
    sourceRevisionDigest({ b: 2, a: 1 }),
    sourceRevisionDigest({ a: 1, b: 2 }),
  );
});

test("machine schemas and documented projection routes publish the negotiated contract", () => {
  const projectionSchema = json(
    "../contracts/console-source-authority/console-source-projection.schema.json",
  );
  const receiptSchema = json(
    "../contracts/console-source-authority/console-source-receipt-binding.schema.json",
  );
  const manifest = json("../contracts/console-source-authority/manifest.json");
  const openApi = json("../docs/api/openapi.json");
  const mediaType = "application/vnd.mfshaf7.console-source-projection+json";

  assert.equal(projectionSchema.properties.artifact_type.const, "console-source-projection");
  assert.equal(receiptSchema.properties.artifact_type.const, "console-source-receipt-binding");
  assert.equal(manifest.compatibility.selection_header, "Accept");
  const documentedRoutes = [];
  for (const { method, path } of manifest.projection_routes) {
    assert.deepEqual(
      openApi.paths[path][method].responses["200"].content[mediaType].schema,
      { $ref: "#/components/schemas/ConsoleSourceProjectionV1" },
    );
    assert.equal(
      openApi.paths[path][method].responses["406"].content["application/json"]
        .schema.properties.error.const,
      "source_projection_version_not_acceptable",
    );
    documentedRoutes.push(`${method.toUpperCase()} ${path}`);
  }
  const projectedRoutes = Object.entries(openApi.paths).flatMap(
    ([path, pathItem]) => Object.entries(pathItem).flatMap(([method, operation]) =>
      operation?.responses?.["200"]?.content?.[mediaType]
        ? [`${method.toUpperCase()} ${path}`]
        : [],
    ),
  );
  assert.deepEqual(projectedRoutes.sort(), documentedRoutes.sort());
  assert.equal(
    openApi.components.schemas.ConsoleSourceProjectionV1["x-oos-canonical-schema"],
    "contracts/console-source-authority/console-source-projection.schema.json",
  );
  assert.equal(
    openApi.components.schemas.ConsoleSourceProjectionV1.properties.binding.$ref,
    "#/components/schemas/ConsoleSourceProjectionV1/$defs/binding",
  );
});

function json(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}
