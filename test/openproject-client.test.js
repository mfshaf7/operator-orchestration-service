import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  createCapturePayload,
  createNodeRequestImpl,
  createOpenProjectClient,
  mapWorkPackageToIdeaRecord,
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
    source: {
      context_ref: {
        conversation_id: "-1002519919856",
        thread_id: "1",
      },
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "123",
      },
      surface: "telegram",
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
      context_ref: {
        conversation_id: "-1002519919856",
        thread_id: "1",
      },
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "123",
      },
      surface: "telegram",
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
    source: {
      native_ref: {
        message_id: "123",
      },
      surface: "telegram",
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
        source: {
          native_ref: {
            message_id: "123",
          },
          surface: "telegram",
        },
        title: "Backlog title",
      }),
    (error) =>
      error.errorClass === "authentication_failure" &&
      error.statusCode === 403,
  );
});

test("createNodeRequestImpl passes the configured host header to the transport", async () => {
  const calls = [];
  const fakeHttp = {
    request(url, options, handler) {
      calls.push({
        headers: options.headers,
        method: options.method,
        url: url.toString(),
      });

      const response = new EventEmitter();
      response.statusCode = 200;

      process.nextTick(() => {
        handler(response);
        response.emit(
          "data",
          Buffer.from(JSON.stringify({ identifier: "workspace-proposals" })),
        );
        response.emit("end");
      });

      return {
        end() {},
        on(eventName, callback) {
          if (eventName === "error") {
            this._errorCallback = callback;
          }
          return this;
        },
        write() {},
      };
    },
  };

  const requestImpl = createNodeRequestImpl({ httpImpl: fakeHttp });
  const client = createOpenProjectClient({
    config: {
      ...config,
      baseUrl: "http://example.test",
    },
    requestImpl,
  });

  const result = await client.checkProjectReachability();

  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.Host, "example.test");
  assert.equal(calls[0].url, "http://example.test/api/v3/projects/workspace-proposals");
  assert.equal(result.targetRef, "openproject://projects/workspace-proposals");
});

test("mapWorkPackageToIdeaRecord returns a normalized broker projection", () => {
  const result = mapWorkPackageToIdeaRecord(config, {
    _links: {
      status: {
        title: "captured",
      },
    },
    createdAt: "2026-04-18T10:00:00Z",
    customField1: "telegram",
    customField2: JSON.stringify({
      context_ref: {
        conversation_id: "-1002519919856",
        thread_id: "1",
      },
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "985",
      },
      surface: "telegram",
    }),
    description: {
      raw: [
        "## Captured idea",
        "",
        "Need a bounded broker-owned help surface.",
        "",
        "## Discussion excerpt or source context",
        "",
        "- source surface: telegram",
        "- source ref: `{\"surface\":\"telegram\"}`",
        "- operator id: 1338752889",
        "- operator handle: @mfshaf7",
        "",
        "## Triage summary",
        "",
        "_Pending triage._",
        "",
        "## Operator decision notes",
        "",
        "_Pending operator decision._",
      ].join("\n"),
    },
    id: 40,
    subject: "Broker help ownership is wrong",
    updatedAt: "2026-04-18T10:05:00Z",
  });

  assert.equal(result.ideaId, "idea-40");
  assert.equal(result.recordRef, "openproject://work_packages/40");
  assert.equal(result.title, "Broker help ownership is wrong");
  assert.equal(result.body, "Need a bounded broker-owned help surface.");
  assert.equal(result.status, "captured");
  assert.equal(result.operator.id, "1338752889");
  assert.equal(result.operator.handle, "mfshaf7");
  assert.equal(result.source.surface, "telegram");
  assert.equal(result.source.integration_id, "default");
  assert.equal(result.source.native_ref.message_id, "985");
});

test("lookupIdeaBySource queries the project using source-identity filters", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            _embedded: {
              elements: [
                {
                  _links: {
                    status: {
                      title: "captured",
                    },
                  },
                  createdAt: "2026-04-18T10:00:00Z",
                  customField1: "telegram",
                  customField2: JSON.stringify({
                    native_ref: {
                      command: "idea",
                      message_id: "985",
                    },
                    surface: "telegram",
                  }),
                  description: {
                    raw: [
                      "## Captured idea",
                      "",
                      "Bounded read path",
                      "",
                      "## Discussion excerpt or source context",
                      "",
                      "- source surface: telegram",
                      "- source ref: `{\"surface\":\"telegram\"}`",
                      "- operator id: 1338752889",
                      "- operator handle: @mfshaf7",
                      "",
                      "## Triage summary",
                      "",
                      "_Pending triage._",
                      "",
                      "## Operator decision notes",
                      "",
                      "_Pending operator decision._",
                    ].join("\n"),
                  },
                  id: 40,
                  subject: "Bounded read path",
                  updatedAt: "2026-04-18T10:05:00Z",
                },
              ],
            },
          }),
      };
    },
  });

  const result = await client.lookupIdeaBySource({
    native_ref: {
      command: "idea",
      message_id: "985",
    },
    surface: "telegram",
  });

  assert.match(
    calls[0].url,
    /\/api\/v3\/projects\/workspace-proposals\/work_packages\?filters=/,
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(result.ideaId, "idea-40");
  assert.equal(result.source.native_ref.message_id, "985");
});
