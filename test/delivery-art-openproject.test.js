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

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => payload,
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
    [
      698,
      workPackage({
        description: "## What This Initiative Achieves\n\nDurable ART controls.",
        id: 698,
        subject: "Durable governance runtime",
        type: "Epic",
      }),
    ],
    [
      790,
      workPackage({
        description: "## What This Enables\n\nFeature-level dependency proof.",
        id: 790,
        parentId: 698,
        subject: "Prepare dependency evidence",
        type: "User story",
      }),
    ],
    [
      799,
      workPackage({
        description: "## What This Enables\n\nTransitive dependency proof.",
        id: 799,
        parentId: 800,
        subject: "Prepare transitive prerequisite",
        type: "User story",
      }),
    ],
    [
      800,
      workPackage({
        description: "## What This Enables\n\nEvidence hardening.",
        id: 800,
        parentId: 698,
        subject: "Harden ART work-start",
        type: "Feature",
      }),
    ],
    [
      801,
      workPackage({
        description: "## What This Enables\n\nThe schema contract.",
        id: 801,
        parentId: 800,
        status: "done",
        subject: "Define contract",
        type: "User story",
      }),
    ],
    [
      802,
      workPackage({
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
      }),
    ],
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
  assert.deepEqual(
    snapshot.projection.records.map((record) => record.id),
    [698, 790, 799, 800, 801, 802],
  );
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

test("persistDeliveryArtAttachment is append-only and idempotent", async () => {
  const content = '{"artifact_type":"delivery_art_work_start_record"}';
  const filename = "work-start-delivery-698-test.json";
  let attachment = null;
  let createCount = 0;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: { elements: attachment ? [attachment] : [] },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/91/content") {
        return textResponse(content);
      }
      if (options.method === "POST" && parsed.pathname === "/api/v3/work_packages/698/attachments") {
        createCount += 1;
        attachment = {
          createdAt: "2026-08-08T03:16:00.000Z",
          fileName: filename,
          id: 91,
          _links: { downloadLocation: { href: "/api/v3/attachments/91/content" } },
        };
        return jsonResponse(attachment, { status: 201 });
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const created = await client.persistDeliveryArtAttachment({
    content,
    deliveryRecordId: 698,
    description: "Delivery ART artifact",
    filename,
  });
  const replayed = await client.persistDeliveryArtAttachment({
    content,
    deliveryRecordId: 698,
    description: "Delivery ART artifact",
    filename,
  });

  assert.equal(created.replayed, false);
  assert.equal(created.attachment.createdAt, "2026-08-08T03:16:00.000Z");
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.attachment.createdAt, "2026-08-08T03:16:00.000Z");
  assert.equal(createCount, 1);
  await assert.rejects(
    () => client.persistDeliveryArtAttachment({
      content: '{"artifact_type":"different"}',
      deliveryRecordId: 698,
      description: "Delivery ART artifact",
      filename,
    }),
    (error) => error.details === "delivery_art_artifact_collision",
  );
});

test("persistDeliveryArtAttachment recovers a committed write after response failure", async () => {
  const content = '{"artifact_type":"art_review_packet"}';
  const filename = "review-packet-delivery-698-test.json";
  let attachment = null;
  let failedAfterCommit = false;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: { elements: attachment ? [attachment] : [] },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/92/content") {
        return textResponse(content);
      }
      if (options.method === "POST" && parsed.pathname === "/api/v3/work_packages/698/attachments") {
        attachment = {
          createdAt: "2026-08-08T03:16:00.000Z",
          fileName: filename,
          id: 92,
          _links: { downloadLocation: { href: "/api/v3/attachments/92/content" } },
        };
        failedAfterCommit = true;
        throw new Error("socket closed after commit");
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const result = await client.persistDeliveryArtAttachment({
    content,
    deliveryRecordId: 698,
    description: "Delivery ART artifact",
    filename,
  });

  assert.equal(failedAfterCommit, true);
  assert.equal(result.recovered, true);
  assert.equal(result.replayed, true);
  assert.equal(result.attachment.createdAt, "2026-08-08T03:16:00.000Z");
});

test("discardDeliveryArtAttachment compensates a rejected custody write idempotently", async () => {
  const filename = "review-packet-delivery-698-rejected.json";
  let attachment = {
    createdAt: "2026-08-08T04:01:00.000Z",
    fileName: filename,
    id: 93,
  };
  let deleteCount = 0;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: { elements: attachment ? [attachment] : [] },
            },
          },
          id: 698,
        });
      }
      if (options.method === "DELETE" && parsed.pathname === "/api/v3/attachments/93") {
        deleteCount += 1;
        attachment = null;
        return jsonResponse({}, { status: 204 });
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const discarded = await client.discardDeliveryArtAttachment({
    attachmentId: 93,
    deliveryRecordId: 698,
    filename,
  });
  const replayed = await client.discardDeliveryArtAttachment({
    attachmentId: 93,
    deliveryRecordId: 698,
    filename,
  });

  assert.equal(discarded.discarded, true);
  assert.equal(discarded.replayed, false);
  assert.equal(replayed.discarded, false);
  assert.equal(replayed.replayed, true);
  assert.equal(deleteCount, 1);
});

test("readDeliveryArtOperationAttachment resolves one durable operation marker", async () => {
  const operationKey =
    "delivery.artifact.work_start.evaluate:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const content = '{"artifact_type":"delivery_art_work_start_record"}';
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    description: { raw: "Unrelated artifact" },
                    fileName: "unrelated.json",
                    id: 93,
                  },
                  {
                    description: {
                      raw: `Delivery ART operation: ${operationKey}\n` +
                        "delivery_art_work_start_record work-start:delivery-698-test sha256:test",
                    },
                    fileName: "work-start.json",
                    id: 94,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/94/content" },
                    },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/94/content") {
        return textResponse(content);
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const result = await client.readDeliveryArtOperationAttachment({
    deliveryRecordId: 698,
    operationKey,
  });

  assert.equal(result.attachment.filename, "work-start.json");
  assert.equal(result.content, content);
});

test("readDeliveryArtOperationAttachment resolves equivalent duplicate operation markers", async () => {
  const operationKey =
    "delivery.artifact.review_packet.finalize:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const firstContent = JSON.stringify({
    artifact_id: "work-start:test",
    artifact_type: "delivery_art_work_start_record",
    custody: { persisted_at: "2026-08-08T03:16:00.000Z" },
  });
  const secondContent = JSON.stringify({
    artifact_id: "work-start:test",
    artifact_type: "delivery_art_work_start_record",
    custody: { persisted_at: "2026-08-08T03:16:01.000Z" },
  });
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        const description = { raw: `Delivery ART operation: ${operationKey}` };
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    description,
                    fileName: "second.json",
                    id: 96,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/96/content" },
                    },
                  },
                  {
                    description,
                    fileName: "first.json",
                    id: 95,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/95/content" },
                    },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/95/content") {
        return textResponse(firstContent);
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/96/content") {
        return textResponse(secondContent);
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const result = await client.readDeliveryArtOperationAttachment({
    deliveryRecordId: 698,
    operationKey,
  });

  assert.equal(result.attachment.id, 95);
  assert.equal(result.content, firstContent);
});

test("readDeliveryArtOperationAttachment fails closed on conflicting duplicate operation markers", async () => {
  const operationKey =
    "delivery.artifact.review_packet.finalize:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        const description = { raw: `Delivery ART operation: ${operationKey}` };
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    description,
                    fileName: "first.json",
                    id: 97,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/97/content" },
                    },
                  },
                  {
                    description,
                    fileName: "second.json",
                    id: 98,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/98/content" },
                    },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/97/content") {
        return textResponse('{"artifact_id":"first"}');
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/98/content") {
        return textResponse('{"artifact_id":"second"}');
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () => client.readDeliveryArtOperationAttachment({
      deliveryRecordId: 698,
      operationKey,
    }),
    (error) => error.details === "delivery_art_operation_ambiguous",
  );
});

test("readDeliveryArtAttachment resolves equivalent duplicate filenames", async () => {
  const filename = "work-start-delivery-698-sha256.json";
  const firstContent = JSON.stringify({
    artifact_id: "work-start:test",
    artifact_type: "delivery_art_work_start_record",
    custody: {
      persisted_at: "2026-08-08T03:16:00.000Z",
      uri: `openproject://work_packages/698/attachments/${filename}`,
    },
  });
  const secondContent = JSON.stringify({
    artifact_id: "work-start:test",
    artifact_type: "delivery_art_work_start_record",
    custody: {
      persisted_at: "2026-08-08T03:16:01.000Z",
      uri: `openproject://work_packages/698/attachments/${filename}`,
    },
  });
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    fileName: filename,
                    id: 100,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/100/content" },
                    },
                  },
                  {
                    fileName: filename,
                    id: 99,
                    _links: {
                      downloadLocation: { href: "/api/v3/attachments/99/content" },
                    },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/99/content") {
        return textResponse(firstContent);
      }
      if (options.method === "GET" && parsed.pathname === "/api/v3/attachments/100/content") {
        return textResponse(secondContent);
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const result = await client.readDeliveryArtAttachment({
    deliveryRecordId: 698,
    filename,
  });

  assert.equal(result.attachment.id, 99);
  assert.equal(result.content, firstContent);
});

test("readDeliveryArtArtifactFamily returns every candidate version for one stable identity", async () => {
  const artifactId = "architecture-packet:delivery-698-v1";
  const artifactType = "delivery_art_architecture_packet";
  const filenames = [
    "architecture-packet-delivery-698-v1-aaaaaaaa.json",
    "architecture-packet-delivery-698-v1-bbbbbbbb.json",
  ];
  const contents = new Map([
    [101, '{"version":"first"}'],
    [102, '{"version":"second"}'],
    [103, JSON.stringify({ artifact_id: `${artifactId}-extra`, artifact_type: artifactType })],
  ]);
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    description: { raw: `${artifactType} ${artifactId} sha256:bbbbbbbb` },
                    fileName: filenames[1],
                    id: 102,
                    _links: { downloadLocation: { href: "/api/v3/attachments/102/content" } },
                  },
                  {
                    description: { raw: `${artifactType} ${artifactId} sha256:aaaaaaaa` },
                    fileName: filenames[0],
                    id: 101,
                    _links: { downloadLocation: { href: "/api/v3/attachments/101/content" } },
                  },
                  {
                    description: { raw: "Unrelated JSON attachment" },
                    fileName: "architecture-packet-delivery-698-v1-extra-cccccccc.json",
                    id: 103,
                    _links: { downloadLocation: { href: "/api/v3/attachments/103/content" } },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      const attachmentId = Number(parsed.pathname.match(/^\/api\/v3\/attachments\/(\d+)\/content$/)?.[1]);
      if (options.method === "GET" && contents.has(attachmentId)) {
        return textResponse(contents.get(attachmentId));
      }
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  const family = await client.readDeliveryArtArtifactFamily({
    artifactId,
    artifactType,
    deliveryRecordId: 698,
  });

  assert.deepEqual(family.map((entry) => entry.filename), filenames);
  assert.deepEqual(family.map((entry) => entry.content), [contents.get(101), contents.get(102)]);
});

test("readDeliveryArtAttachment rejects download URLs outside the OpenProject origin", async () => {
  let foreignReadAttempted = false;
  const client = createOpenProjectClient({
    config,
    async fetchImpl(url, options) {
      const parsed = new URL(url);
      if (options.method === "GET" && parsed.pathname === "/api/v3/work_packages/698") {
        return jsonResponse({
          _embedded: {
            attachments: {
              _embedded: {
                elements: [
                  {
                    fileName: "review-packet.json",
                    id: 93,
                    _links: {
                      downloadLocation: {
                        href: "https://untrusted.example/attachments/93/content",
                      },
                    },
                  },
                ],
              },
            },
          },
          id: 698,
        });
      }
      foreignReadAttempted = true;
      throw new Error(`unexpected request ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () => client.readDeliveryArtAttachment({
      deliveryRecordId: 698,
      filename: "review-packet.json",
    }),
    (error) => error.details === "delivery_art_attachment_origin_mismatch",
  );
  assert.equal(foreignReadAttempted, false);
});
