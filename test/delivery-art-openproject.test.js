import assert from "node:assert/strict";
import test from "node:test";

import { createOpenProjectClient } from "../src/openproject-client.js";

const config = {
  apiToken: "test-token",
  baseUrl: "http://openproject.test",
  deliveryCustomFieldTargetPiId: 14,
  deliveryProjectIdentifier: "workspace-delivery-art",
  hostHeader: "openproject.test",
  projectIdentifier: "workspace-proposals",
};
const ARTIFACT_DIGEST = `sha256:${"c".repeat(64)}`;
const RECEIPT_DIGEST = `sha256:${"d".repeat(64)}`;
const ARTIFACT_URI = `wgcf://artifacts/delivery-art/sha256/${"c".repeat(64)}`;
const RECEIPT_URI = `wgcf://receipts/artifact-custody/receipt-${"d".repeat(64)}.json`;

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function workPackage({
  description,
  id,
  parentId = null,
  status = "in-progress",
  subject,
  type,
}) {
  return {
    _links: {
      assignee: { title: "Operator Orchestration-Service" },
      parent: { href: parentId ? `/api/v3/work_packages/${parentId}` : null },
      responsible: { title: "Operator Orchestration-Service" },
      status: { title: status },
      type: { title: type },
    },
    customField14: "PI-2026-03",
    customField29: "Enabler",
    customField30: "operator-orchestration-service",
    customField31: "Workflow Integration",
    customField32: "PI-2026-03 / Iteration 1",
    description: { format: "markdown", raw: description },
    id,
    lockVersion: 1,
    subject,
  };
}

test("captureDeliveryArtScope uses bounded reads and stable material ART fields", async () => {
  const calls = [];
  let dependencyDescription = "The contract must land before implementation.";
  let dependencyLag = 1;
  let transitiveDependencyLag = 0;
  const records = new Map([
    [698, workPackage({
      description: "## What This Initiative Achieves\n\nDurable ART controls.",
      id: 698,
      subject: "Durable governance runtime",
      type: "Epic",
    })],
    [790, workPackage({
      description: "## What This Enables\n\nFeature-level dependency proof.",
      id: 790,
      parentId: 698,
      subject: "Prepare dependency evidence",
      type: "User story",
    })],
    [799, workPackage({
      description: "## What This Enables\n\nTransitive dependency proof.",
      id: 799,
      parentId: 800,
      subject: "Prepare transitive prerequisite",
      type: "User story",
    })],
    [800, workPackage({
      description: "## What This Enables\n\nEvidence hardening.",
      id: 800,
      parentId: 698,
      subject: "Harden ART work-start",
      type: "Feature",
    })],
    [801, workPackage({
      description: "## What This Enables\n\nThe schema contract.",
      id: 801,
      parentId: 800,
      status: "done",
      subject: "Define contract",
      type: "User story",
    })],
    [802, workPackage({
      description: [
        "## Observed Failure",
        "",
        "Full graph reads and weak packet custody.",
        "",
        "## Operator work notes",
        "",
        "This note must not invalidate work-start readiness.",
      ].join("\n"),
      id: 802,
      parentId: 800,
      subject: "Implement scoped controls",
      type: "Defect",
    })],
  ]);
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      calls.push({ method: options.method, url });
      const parsed = new URL(url);
      if (
        options.method === "GET" &&
        parsed.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        const filters = JSON.parse(parsed.searchParams.get("filters"));
        const ids = filters[0].id.values.map(Number);
        const elements = ids.map((id) => records.get(id)).filter(Boolean);
        return jsonResponse({ _embedded: { elements }, count: elements.length, total: elements.length });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/relations") {
        const filters = JSON.parse(parsed.searchParams.get("filters"));
        const involvedIds = new Set(filters[0].involved.values.map(Number));
        const relations = [
          {
            description: { raw: dependencyDescription },
            id: 41,
            lag: dependencyLag,
            relationType: "follows",
            _links: {
              from: { href: "/api/v3/work_packages/801" },
              to: { href: "/api/v3/work_packages/802" },
            },
          },
          {
            description: { raw: "The transitive prerequisite must finish first." },
            id: 42,
            lag: transitiveDependencyLag,
            relationType: "follows",
            _links: {
              from: { href: "/api/v3/work_packages/799" },
              to: { href: "/api/v3/work_packages/801" },
            },
          },
          {
            description: { raw: "The Feature depends on its evidence preparation." },
            id: 43,
            lag: 0,
            relationType: "follows",
            _links: {
              from: { href: "/api/v3/work_packages/790" },
              to: { href: "/api/v3/work_packages/800" },
            },
          },
          {
            description: { raw: "A non-dependency relation is outside snapshot closure." },
            id: 44,
            lag: null,
            relationType: "relates",
            _links: {
              from: { href: "/api/v3/work_packages/777" },
              to: { href: "/api/v3/work_packages/802" },
            },
          },
          {
            description: { raw: "A downstream dependent is outside upstream closure." },
            id: 45,
            lag: 0,
            relationType: "follows",
            _links: {
              from: { href: "/api/v3/work_packages/802" },
              to: { href: "/api/v3/work_packages/780" },
            },
          },
        ].filter((relation) => {
          const fromId = Number(relation._links.from.href.split("/").at(-1));
          const toId = Number(relation._links.to.href.split("/").at(-1));
          return involvedIds.has(fromId) || involvedIds.has(toId);
        });
        return jsonResponse({
          _embedded: { elements: relations },
          count: relations.length,
          total: relations.length,
        });
      }
      if (options.method === "POST" && parsed.pathname === "/api/v3/work_packages/802/form") {
        return jsonResponse({
          _embedded: {
            schema: {
              customField29: { location: "payload", name: "Execution Classification" },
              customField30: { location: "payload", name: "Owner Repo" },
              customField31: { location: "payload", name: "Delivery Team" },
              customField32: { location: "payload", name: "Iteration" },
            },
          },
        });
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const snapshot = await client.captureDeliveryArtScope({
    deliveryRecordId: 698,
    workItemRecordIds: [802],
  });

  assert.match(snapshot.artDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(snapshot.coveredRecordCount, 1);
  assert.equal(snapshot.dependencyRecordCount, 3);
  assert.equal(snapshot.relationCount, 3);
  assert.deepEqual(snapshot.projection.relations, [
    {
      description: "The Feature depends on its evidence preparation.",
      from_work_item_id: "work-item-790",
      lag: 0,
      relation_type: "follows",
      to_work_item_id: "work-item-800",
    },
    {
      description: "The transitive prerequisite must finish first.",
      from_work_item_id: "work-item-799",
      lag: 0,
      relation_type: "follows",
      to_work_item_id: "work-item-801",
    },
    {
      description: "The contract must land before implementation.",
      from_work_item_id: "work-item-801",
      lag: 1,
      relation_type: "follows",
      to_work_item_id: "work-item-802",
    },
  ]);
  assert.deepEqual(snapshot.projection.records.map((record) => record.id), [698, 790, 799, 800, 801, 802]);
  assert.equal(snapshot.projection.schema_version, 2);
  assert.equal(
    Object.hasOwn(
      snapshot.projection.records.find((record) => record.id === 802).description_sections,
      "Operator work notes",
    ),
    false,
  );
  assert.equal(
    calls.filter((call) => new URL(call.url).pathname === "/api/v3/relations").length,
    3,
  );
  assert.equal(
    calls.some((call) => {
      const parsed = new URL(call.url);
      return parsed.pathname === "/api/v3/projects/workspace-delivery-art/work_packages" &&
        parsed.searchParams.get("filters") === "[]";
    }),
    false,
  );

  records.get(800)._links.status.title = "blocked";
  const changedLineageSnapshot = await client.captureDeliveryArtScope({
    deliveryRecordId: 698,
    workItemRecordIds: [802],
  });
  assert.notEqual(changedLineageSnapshot.artDigest, snapshot.artDigest);

  records.get(800)._links.status.title = "in-progress";
  dependencyLag = 2;
  const changedLagSnapshot = await client.captureDeliveryArtScope({
    deliveryRecordId: 698,
    workItemRecordIds: [802],
  });
  assert.notEqual(changedLagSnapshot.artDigest, snapshot.artDigest);

  dependencyLag = 1;
  dependencyDescription = "Implementation now requires the reviewed contract.";
  const changedDescriptionSnapshot = await client.captureDeliveryArtScope({
    deliveryRecordId: 698,
    workItemRecordIds: [802],
  });
  assert.notEqual(changedDescriptionSnapshot.artDigest, snapshot.artDigest);

  dependencyDescription = "The contract must land before implementation.";
  transitiveDependencyLag = 2;
  const changedTransitiveLagSnapshot = await client.captureDeliveryArtScope({
    deliveryRecordId: 698,
    workItemRecordIds: [802],
  });
  assert.notEqual(changedTransitiveLagSnapshot.artDigest, snapshot.artDigest);
});

test("projectDeliveryArtReference writes only safe refs and replays idempotently", async () => {
  const calls = [];
  let description = "## Observed Failure\n\nWeak custody projection.";
  let lockVersion = 3;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      calls.push({ body: options.body, method: options.method, path: parsed.pathname });
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/802") {
        return jsonResponse({
          description: { format: "markdown", raw: description },
          id: 802,
          lockVersion,
        });
      }
      if (options.method === "POST" && parsed.pathname === "/api/v3/work_packages/802/form") {
        return jsonResponse({
          _embedded: {
            schema: {
              description: { writable: true },
            },
          },
        });
      }
      if (options.method === "PATCH" && parsed.pathname === "/api/v3/work_packages/802") {
        const payload = JSON.parse(options.body);
        description = payload.description.raw;
        lockVersion += 1;
        return jsonResponse({
          description: payload.description,
          id: 802,
          lockVersion,
        });
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });
  const input = {
    artifact: { digest: ARTIFACT_DIGEST, uri: ARTIFACT_URI },
    artifactId: "work-start:delivery-698-oos",
    artifactStatus: "implementation-ready",
    artifactType: "delivery_art_work_start_record",
    custodyReceipt: { digest: RECEIPT_DIGEST, uri: RECEIPT_URI },
    recordId: 802,
  };

  const projected = await client.projectDeliveryArtReference(input);
  const replayed = await client.projectDeliveryArtReference(input);

  assert.equal(projected.projected, true);
  assert.equal(projected.replayed, false);
  assert.equal(replayed.projected, false);
  assert.equal(replayed.replayed, true);
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  assert.match(description, /Delivery ART evidence reference/);
  assert.match(description, new RegExp(ARTIFACT_DIGEST));
  assert.match(description, new RegExp(RECEIPT_DIGEST));
  assert.match(description, /wgcf:\/\/artifacts\/delivery-art/);
  assert.doesNotMatch(description, /artifact_content|source_snapshot|storage/);
});

test("projectDeliveryArtReference rejects non-WGCF references before OpenProject mutation", async () => {
  let called = false;
  const client = createOpenProjectClient({
    config,
    async fetchImpl() {
      called = true;
      return jsonResponse({});
    },
  });

  await assert.rejects(
    () => client.projectDeliveryArtReference({
      artifact: {
        digest: ARTIFACT_DIGEST,
        uri: "https://storage.internal/bucket/artifact.json",
      },
      artifactId: "work-start:delivery-698-oos",
      artifactStatus: "implementation-ready",
      artifactType: "delivery_art_work_start_record",
      custodyReceipt: { digest: RECEIPT_DIGEST, uri: RECEIPT_URI },
      recordId: 802,
    }),
    (error) => error.details === "delivery_art_projection_reference_invalid",
  );
  assert.equal(called, false);
});

test("projectDeliveryArtReference fails closed when the live form marks description read-only", async () => {
  let patchCalled = false;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/802") {
        return jsonResponse({
          description: { format: "markdown", raw: "## Observed Failure\n\nWeak custody." },
          id: 802,
          lockVersion: 7,
        });
      }
      if (options.method === "POST" && parsed.pathname === "/api/v3/work_packages/802/form") {
        return jsonResponse({
          _embedded: {
            schema: {
              description: { writable: false },
            },
          },
        });
      }
      if (options.method === "PATCH") {
        patchCalled = true;
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () => client.projectDeliveryArtReference({
      artifact: { digest: ARTIFACT_DIGEST, uri: ARTIFACT_URI },
      artifactId: "work-start:delivery-698-oos",
      artifactStatus: "implementation-ready",
      artifactType: "delivery_art_work_start_record",
      custodyReceipt: { digest: RECEIPT_DIGEST, uri: RECEIPT_URI },
      recordId: 802,
    }),
    (error) => error.details === "delivery_art_projection_description_read_only",
  );
  assert.equal(patchCalled, false);
});
