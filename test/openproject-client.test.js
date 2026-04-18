import test from "node:test";
import assert from "node:assert/strict";

import {
  createCapturePayload,
  createOpenProjectClient,
} from "../src/openproject-client.js";

const config = {
  apiToken: "test-token",
  baseUrl: "http://example.test",
  capturedStatusId: 81,
  customFieldSourceReferenceId: 2,
  customFieldSourceSurfaceId: 1,
  hostHeader: "example.test",
  ideaTypeId: 41,
  projectIdentifier: "workspace-proposals",
};

test("createCapturePayload shapes the canonical capture fields", () => {
  const payload = createCapturePayload(config, {
    body: "We need a durable backlog.",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    source: "telegram",
    sourceRef: {
      chat_id: "-1002519919856",
      message_id: "123",
      topic_id: "1",
    },
    title: "Need a durable backlog",
  });

  assert.equal(payload.subject, "Need a durable backlog");
  assert.equal(payload._links.type.href, "/api/v3/types/41");
  assert.equal(payload._links.status.href, "/api/v3/statuses/81");
  assert.equal(payload.customField1, "telegram");
  assert.equal(
    payload.customField2,
    JSON.stringify({
      chat_id: "-1002519919856",
      message_id: "123",
      topic_id: "1",
    }),
  );
  assert.match(payload.description.raw, /## Captured idea/);
  assert.match(payload.description.raw, /## Triage summary/);
});

test("captureIdea posts to the project-scoped work package endpoint", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            _links: {
              status: {
                title: "captured",
              },
            },
            id: 12,
          }),
      };
    },
  });

  const result = await client.captureIdea({
    body: "Backlog body",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    source: "telegram",
    sourceRef: {
      message_id: "123",
    },
    title: "Backlog title",
  });

  assert.equal(
    calls[0].url,
    "http://example.test/api/v3/projects/workspace-proposals/work_packages",
  );
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].options.headers.Host, "example.test");
  assert.equal(result.recordRef, "openproject://work_packages/12");
  assert.equal(result.status, "captured");
});

test("captureIdea maps authorization failures to a typed backend error", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({
          errorIdentifier: "urn:openproject-org:api:v3:errors:MissingPermission",
          message: "You are not authorized to access this resource.",
        }),
    }),
  });

  await assert.rejects(
    () =>
      client.captureIdea({
        body: "Backlog body",
        operator: {
          handle: "mfshaf7",
          id: "1338752889",
        },
        source: "telegram",
        sourceRef: {
          message_id: "123",
        },
        title: "Backlog title",
      }),
    (error) =>
      error.errorClass === "authentication_failure" &&
      error.statusCode === 403,
  );
});
