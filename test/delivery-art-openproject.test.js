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
        return jsonResponse({
          _embedded: {
            elements: [
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
            ],
          },
          count: 1,
          total: 1,
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
  assert.equal(snapshot.dependencyRecordCount, 1);
  assert.equal(snapshot.relationCount, 1);
  assert.deepEqual(snapshot.projection.relations, [
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
    [698, 800, 801, 802],
  );
  assert.equal(
    Object.hasOwn(
      snapshot.projection.records.find((record) => record.id === 802).description_sections,
      "Operator work notes",
    ),
    false,
  );
  assert.equal(
    calls.filter((call) => new URL(call.url).pathname === "/api/v3/relations").length,
    1,
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
  assert.equal(replayed.replayed, true);
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
