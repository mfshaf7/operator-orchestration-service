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
                id: 41,
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
  assert.equal(snapshot.projection.records.length, 2);
  assert.equal(
    Object.hasOwn(snapshot.projection.records[1].description_sections, "Operator work notes"),
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
