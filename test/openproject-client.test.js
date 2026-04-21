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
  customFieldDeliveryRefId: 11,
  deliveryCustomFieldOriginIdeaRefId: 12,
  deliveryCustomFieldPm2PhaseId: 13,
  deliveryCustomFieldTargetPiId: 14,
  deliveryNewStatusId: 88,
  deliveryProjectIdentifier: "workspace-delivery-art",
  deliveryTopLevelTypeId: 51,
  triagedStatusId: 82,
  parkedStatusId: 83,
  acceptedStatusId: 85,
  rejectedStatusId: 80,
  implementedStatusId: 86,
  customFieldAffectedScopeId: 4,
  customFieldAiAssistLaneId: 9,
  customFieldSuspectedOwnerId: 3,
  customFieldSourceReferenceId: 2,
  customFieldSourceSurfaceId: 1,
  customFieldTriageConfidenceId: 8,
  customFieldTrustBoundaryAreasId: 5,
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

test("getIdea retries a recoverable network error once", async () => {
  const calls = [];
  let attempts = 0;
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      attempts += 1;

      if (attempts === 1) {
        throw new Error("socket hang up");
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            _links: {
              status: {
                title: "accepted",
              },
            },
            createdAt: "2026-04-18T10:00:00Z",
            customField1: "telegram",
            customField2: JSON.stringify({
              integration_id: "default",
              native_ref: {
                command: "idea",
                message_id: "985",
              },
              surface: "telegram",
            }),
            customField11: "openproject://work_packages/77",
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
                "Needs a bounded broker workflow before later decision handling.",
                "",
                "## Operator decision notes",
                "",
                "Ready to move this into tracked delivery.",
                "",
                "## Internal evaluation",
                "",
                "_No internal evaluation recorded._",
              ].join("\n"),
            },
            id: 41,
            lockVersion: 9,
            subject: "Bounded read path",
            updatedAt: "2026-04-19T14:06:00Z",
          }),
      };
    },
  });

  const result = await client.getIdea(41);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].url, "http://example.test/api/v3/work_packages/41");
  assert.equal(result.ideaId, "idea-41");
  assert.equal(result.status, "accepted");
  assert.equal(result.deliveryRef, "openproject://work_packages/77");
});

test("listIdeas requests the latest idea work packages with bounded paging", async () => {
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
                  createdAt: "2026-04-18T11:09:24.565Z",
                  customField1: "telegram",
                  customField2: JSON.stringify({
                    integration_id: "default",
                    native_ref: {
                      command: "idea",
                      message_id: "989",
                    },
                    surface: "telegram",
                  }),
                  description: {
                    raw: "## Captured idea\n\nNeed a better status view.\n\n## Discussion excerpt or source context\n\n- source surface: telegram\n- source ref: `{\"surface\":\"telegram\"}`\n- operator id: 1338752889\n- operator handle: @mfshaf7\n\n## Triage summary\n\n_Pending triage._\n\n## Operator decision notes\n\n_Pending operator decision._",
                  },
                  id: 41,
                  subject: "Need a better status view",
                  updatedAt: "2026-04-18T11:09:24.565Z",
                },
              ],
            },
            count: 1,
            offset: 1,
            pageSize: 5,
            total: 4,
          }),
      };
    },
  });

  const result = await client.listIdeas({
    limit: 5,
    offset: 1,
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/v3/projects/workspace-proposals/work_packages");
  assert.equal(url.searchParams.get("pageSize"), "5");
  assert.equal(url.searchParams.get("offset"), "1");
  assert.equal(url.searchParams.get("sortBy"), '[["id","desc"]]');
  assert.equal(url.searchParams.get("filters"),
    JSON.stringify([{ type: { operator: "=", values: ["41"] } }]),
  );
  assert.equal(calls[0].options.method, "GET");
  assert.equal(result.total, 4);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].ideaId, "idea-41");
  assert.equal(result.items[0].status, "captured");
});

test("createNodeRequestImpl passes the configured host header to the transport", async () => {
  const calls = [];
  const fakeHttp = {
    request(url, options, handler) {
      calls.push({
        agent: options.agent,
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
  assert.equal(calls[0].agent, false);
  assert.equal(calls[0].headers.Host, "example.test");
  assert.equal(calls[0].url, "http://example.test/api/v3/projects/workspace-proposals");
  assert.equal(result.targetRef, "openproject://projects/workspace-proposals");
});

test("mapWorkPackageToIdeaRecord returns a normalized broker projection", () => {
  const result = mapWorkPackageToIdeaRecord(config, {
    _links: {
      customField5: [
        { href: "/api/v3/custom_options/4", title: "runtime" },
        { href: "/api/v3/custom_options/5", title: "ai" },
      ],
      customField8: { href: "/api/v3/custom_options/11", title: "medium" },
      customField9: { href: "/api/v3/custom_options/14", title: "local" },
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
    customField3: "repo:operator-orchestration-service",
    customField4: "repo:operator-orchestration-service, repo:openclaw-telegram-enhanced",
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
        "",
        "## Internal evaluation",
        "",
        "Broker owns the canonical workflow contract and Telegram remains a thin adapter.",
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
  assert.equal(
    result.evaluation.suspectedOwner,
    "repo:operator-orchestration-service",
  );
  assert.deepEqual(result.evaluation.affectedScope, [
    "repo:operator-orchestration-service",
    "repo:openclaw-telegram-enhanced",
  ]);
  assert.deepEqual(result.evaluation.trustBoundaryAreas, ["runtime", "ai"]);
  assert.equal(result.evaluation.confidence, "medium");
  assert.equal(result.evaluation.aiAssistLane, "local");
  assert.equal(result.deliveryRef, null);
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

test("triageIdea updates the canonical record and moves it into triaged", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "captured",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
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
              id: 41,
              lockVersion: 3,
              subject: "Bounded read path",
              updatedAt: "2026-04-18T10:05:00Z",
            }),
        };
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            _links: {
              status: {
                title: "triaged",
              },
            },
            createdAt: "2026-04-18T10:00:00Z",
            customField1: "telegram",
            customField2: JSON.stringify({
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
                "Needs a bounded broker workflow before later decision handling.",
                "",
                "## Operator decision notes",
                "",
                "_Pending operator decision._",
              ].join("\n"),
            },
            id: 41,
            lockVersion: 4,
            subject: "Bounded read path",
            updatedAt: "2026-04-19T12:00:00Z",
          }),
      };
    },
  });

  const result = await client.triageIdea({
    recordId: 41,
    summary: "Needs a bounded broker workflow before later decision handling.",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[1].options.body);
  assert.equal(patchPayload.lockVersion, 3);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/82");
  assert.match(
    patchPayload.description.raw,
    /Needs a bounded broker workflow before later decision handling\./,
  );
  assert.equal(result.ideaId, "idea-41");
  assert.equal(result.status, "triaged");
  assert.equal(
    result.triageSummary,
    "Needs a bounded broker workflow before later decision handling.",
  );
});

test("decideIdea updates the canonical record with decision notes and status", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "triaged",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "_Pending operator decision._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 4,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T12:00:00Z",
            }),
        };
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            _links: {
              status: {
                title: "parked",
              },
            },
            createdAt: "2026-04-18T10:00:00Z",
            customField1: "telegram",
            customField2: JSON.stringify({
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
                "Needs a bounded broker workflow before later decision handling.",
                "",
                "## Operator decision notes",
                "",
                "Revisit this after the owner-assigned vocabulary lands.",
              ].join("\n"),
            },
            id: 41,
            lockVersion: 5,
            subject: "Bounded read path",
            updatedAt: "2026-04-19T12:30:00Z",
          }),
      };
    },
  });

  const result = await client.decideIdea({
    notes: "Revisit this after the owner-assigned vocabulary lands.",
    recordId: 41,
    status: "parked",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[1].options.body);
  assert.equal(patchPayload.lockVersion, 4);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/83");
  assert.match(
    patchPayload.description.raw,
    /Revisit this after the owner-assigned vocabulary lands\./,
  );
  assert.equal(result.ideaId, "idea-41");
  assert.equal(result.status, "parked");
  assert.equal(
    result.operatorDecisionNotes,
    "Revisit this after the owner-assigned vocabulary lands.",
  );
});

test("recordIdeaEvaluation updates internal metadata without changing lifecycle status", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "triaged",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
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
                  "Needs structured owner evaluation.",
                  "",
                  "## Operator decision notes",
                  "",
                  "_Pending operator decision._",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 6,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T13:00:00Z",
            }),
        };
      }

      if (options.method === "POST") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField5: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "identity" },
                        { href: "/api/v3/custom_options/2", title: "secrets" },
                        { href: "/api/v3/custom_options/3", title: "delivery" },
                        { href: "/api/v3/custom_options/4", title: "runtime" },
                        { href: "/api/v3/custom_options/5", title: "ai" },
                      ],
                    },
                  },
                  customField8: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/10", title: "low" },
                        { href: "/api/v3/custom_options/11", title: "medium" },
                        { href: "/api/v3/custom_options/12", title: "high" },
                      ],
                    },
                  },
                  customField9: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/13", title: "none" },
                        { href: "/api/v3/custom_options/14", title: "local" },
                        { href: "/api/v3/custom_options/15", title: "governed" },
                        { href: "/api/v3/custom_options/16", title: "exception" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            _links: {
              customField5: [
                { href: "/api/v3/custom_options/4", title: "runtime" },
                { href: "/api/v3/custom_options/5", title: "ai" },
              ],
              customField8: {
                href: "/api/v3/custom_options/11",
                title: "medium",
              },
              customField9: {
                href: "/api/v3/custom_options/14",
                title: "local",
              },
              status: {
                title: "triaged",
              },
            },
            createdAt: "2026-04-18T10:00:00Z",
            customField1: "telegram",
            customField2: JSON.stringify({
              integration_id: "default",
              native_ref: {
                command: "idea",
                message_id: "985",
              },
              surface: "telegram",
            }),
            customField3: "repo:operator-orchestration-service",
            customField4: "repo:operator-orchestration-service, repo:openclaw-telegram-enhanced",
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
                "Needs structured owner evaluation.",
                "",
                "## Operator decision notes",
                "",
                "_Pending operator decision._",
                "",
                "## Internal evaluation",
                "",
                "Broker owns the canonical workflow contract and Telegram remains a thin adapter.",
              ].join("\n"),
            },
            id: 41,
            lockVersion: 7,
            subject: "Bounded read path",
            updatedAt: "2026-04-19T13:05:00Z",
          }),
      };
    },
  });

  const result = await client.recordIdeaEvaluation({
    evaluation: {
      affectedScope: [
        "repo:operator-orchestration-service",
        "repo:openclaw-telegram-enhanced",
      ],
      aiAssistLane: "local",
      confidence: "medium",
      notes: "Broker owns the canonical workflow contract and Telegram remains a thin adapter.",
      suspectedOwner: "repo:operator-orchestration-service",
      trustBoundaryAreas: ["runtime", "ai"],
    },
    recordId: 41,
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 6);
  assert.equal(
    patchPayload.customField3,
    "repo:operator-orchestration-service",
  );
  assert.equal(
    patchPayload.customField4,
    "repo:operator-orchestration-service, repo:openclaw-telegram-enhanced",
  );
  assert.deepEqual(patchPayload._links.customField5, [
    { href: "/api/v3/custom_options/4", title: "runtime" },
    { href: "/api/v3/custom_options/5", title: "ai" },
  ]);
  assert.deepEqual(patchPayload._links.customField8, {
    href: "/api/v3/custom_options/11",
    title: "medium",
  });
  assert.deepEqual(patchPayload._links.customField9, {
    href: "/api/v3/custom_options/14",
    title: "local",
  });
  assert.match(
    patchPayload.description.raw,
    /Broker owns the canonical workflow contract and Telegram remains a thin adapter\./,
  );
  assert.equal(result.status, "triaged");
  assert.equal(
    result.evaluation.suspectedOwner,
    "repo:operator-orchestration-service",
  );
});

test("consumeAcceptedIdea creates a delivery record and backfills the source backlink", async () => {
  const calls = [];
  const currentRecord = {
    body: "Need a bounded broker-owned help surface.",
    deliveryRef: null,
    evaluation: {
      affectedScope: [
        "repo:operator-orchestration-service",
        "repo:openclaw-telegram-enhanced",
      ],
      aiAssistLane: "local",
      confidence: "medium",
      notes: "Broker owns the workflow contract and Telegram remains a thin adapter.",
      suspectedOwner: "repo:operator-orchestration-service",
      trustBoundaryAreas: ["runtime", "ai"],
    },
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    operatorDecisionNotes: "Ready to move this into tracked delivery.",
    recordRef: "openproject://work_packages/41",
    source: {
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "985",
      },
      surface: "telegram",
    },
    status: "accepted",
    title: "Bounded read path",
    triageSummary: "Needs a bounded broker workflow before later decision handling.",
    updatedAt: "2026-04-19T14:00:00Z",
  };

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ _embedded: { elements: [] } }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField13: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/custom_options/30",
                          title: "Initiating",
                        },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 201,
          text: async () =>
            JSON.stringify({
              _links: {
                customField13: {
                  href: "/api/v3/custom_options/30",
                  title: "Initiating",
                },
                status: {
                  title: "new",
                },
              },
              createdAt: "2026-04-19T14:05:00Z",
              customField12: "idea-41",
              customField14: "PI-2026-02",
              id: 77,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:05:00Z",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "Broker owns the canonical workflow contract and Telegram remains a thin adapter.",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 9,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:06:00Z",
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "Broker owns the canonical workflow contract and Telegram remains a thin adapter.",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 10,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:06:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.consumeAcceptedIdea({
    currentRecord,
    recordId: 41,
    targetPi: "PI-2026-02",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.match(
    calls[0].url,
    /\/api\/v3\/projects\/workspace-delivery-art\/work_packages\?filters=/,
  );
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    calls[1].url,
    "http://example.test/api/v3/projects/workspace-delivery-art/work_packages/form",
  );
  assert.equal(calls[2].options.method, "POST");
  const createPayload = JSON.parse(calls[2].options.body);
  assert.equal(createPayload._links.type.href, "/api/v3/types/51");
  assert.equal(createPayload._links.status.href, "/api/v3/statuses/88");
  assert.deepEqual(createPayload._links.customField13, {
    href: "/api/v3/custom_options/30",
    title: "Initiating",
  });
  assert.equal(createPayload.customField12, "idea-41");
  assert.equal(createPayload.customField14, "PI-2026-02");
  assert.match(createPayload.description.raw, /## Accepted proposal/);
  assert.equal(calls[3].options.method, "GET");
  assert.equal(calls[4].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[4].options.body);
  assert.equal(patchPayload.lockVersion, 9);
  assert.equal(patchPayload.customField11, "openproject://work_packages/77");
  assert.equal(result.deliveryCreated, true);
  assert.equal(result.deliveryRecord.recordRef, "openproject://work_packages/77");
  assert.equal(result.deliveryRecord.pm2Phase, "Initiating");
  assert.equal(result.sourceRecord.deliveryRef, "openproject://work_packages/77");
  assert.equal(result.sourceUpdated, true);
});

test("consumeAcceptedIdea recovers when the source backlink patch commits before the response socket drops", async () => {
  const calls = [];
  const currentRecord = {
    body: "Need a bounded broker-owned help surface.",
    deliveryRef: null,
    evaluation: {
      affectedScope: [],
      aiAssistLane: null,
      confidence: null,
      notes: null,
      suspectedOwner: null,
      trustBoundaryAreas: [],
    },
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    operatorDecisionNotes: "Ready to move this into tracked delivery.",
    recordRef: "openproject://work_packages/41",
    source: {
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "985",
      },
      surface: "telegram",
    },
    status: "accepted",
    title: "Bounded read path",
    triageSummary: "Needs a bounded broker workflow before later decision handling.",
    updatedAt: "2026-04-19T14:00:00Z",
  };

  let deliveryRefApplied = false;

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                elements: [
                  {
                    _links: {
                      customField13: {
                        href: "/api/v3/custom_options/30",
                        title: "Initiating",
                      },
                      status: {
                        title: "new",
                      },
                    },
                    createdAt: "2026-04-19T14:05:00Z",
                    customField12: "idea-41",
                    customField14: "PI-2026-02",
                    id: 77,
                    subject: "Bounded read path",
                    updatedAt: "2026-04-19T14:05:00Z",
                  },
                ],
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: deliveryRefApplied
                ? "openproject://work_packages/77"
                : null,
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: deliveryRefApplied ? 10 : 9,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:06:00Z",
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        deliveryRefApplied = true;
        throw new Error("socket hang up");
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.consumeAcceptedIdea({
    currentRecord,
    recordId: 41,
    targetPi: "PI-2026-02",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.match(
    calls[0].url,
    /\/api\/v3\/projects\/workspace-delivery-art\/work_packages\?filters=/,
  );
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[2].options.method, "PATCH");
  assert.equal(calls[3].options.method, "GET");
  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 9);
  assert.equal(patchPayload.customField11, "openproject://work_packages/77");
  assert.equal(result.deliveryCreated, false);
  assert.equal(result.deliveryRecord.recordRef, "openproject://work_packages/77");
  assert.equal(result.sourceRecord.deliveryRef, "openproject://work_packages/77");
  assert.equal(result.sourceUpdated, true);
});

test("consumeAcceptedIdea retries the delivery lookup after a recoverable network error", async () => {
  const calls = [];
  const currentRecord = {
    body: "Need a bounded broker-owned help surface.",
    deliveryRef: null,
    evaluation: {
      affectedScope: [],
      aiAssistLane: null,
      confidence: null,
      notes: null,
      suspectedOwner: null,
      trustBoundaryAreas: [],
    },
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    operatorDecisionNotes: "Ready to move this into tracked delivery.",
    recordRef: "openproject://work_packages/41",
    source: {
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "985",
      },
      surface: "telegram",
    },
    status: "accepted",
    title: "Bounded read path",
    triageSummary: "Needs a bounded broker workflow before later decision handling.",
    updatedAt: "2026-04-19T14:00:00Z",
  };

  let lookupAttempts = 0;

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        lookupAttempts += 1;
        if (lookupAttempts === 1) {
          throw new Error("socket hang up");
        }

        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ _embedded: { elements: [] } }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField13: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/custom_options/30",
                          title: "Initiating",
                        },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 201,
          text: async () =>
            JSON.stringify({
              _links: {
                customField13: {
                  href: "/api/v3/custom_options/30",
                  title: "Initiating",
                },
                status: {
                  title: "new",
                },
              },
              createdAt: "2026-04-19T14:05:00Z",
              customField12: "idea-41",
              customField14: "PI-2026-02",
              id: 77,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:05:00Z",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 10,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:06:00Z",
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/41"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 11,
              subject: "Bounded read path",
              updatedAt: "2026-04-19T14:06:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.consumeAcceptedIdea({
    currentRecord,
    recordId: 41,
    targetPi: "PI-2026-02",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[4].options.method, "GET");
  assert.equal(calls[5].options.method, "PATCH");
  assert.equal(result.deliveryCreated, true);
  assert.equal(result.deliveryRecord.recordRef, "openproject://work_packages/77");
  assert.equal(result.sourceRecord.deliveryRef, "openproject://work_packages/77");
  assert.equal(result.sourceUpdated, true);
});

test("closeAcceptedIdeaDelivery marks the source idea implemented when delivery is done", async () => {
  const calls = [];
  const currentRecord = {
    body: "Need a bounded broker-owned help surface.",
    deliveryCloseoutNotes: null,
    deliveryRef: "openproject://work_packages/77",
    evaluation: {
      affectedScope: [],
      aiAssistLane: null,
      confidence: null,
      notes: null,
      suspectedOwner: null,
      trustBoundaryAreas: [],
    },
    ideaId: "idea-41",
    operator: {
      handle: "mfshaf7",
      id: "1338752889",
    },
    operatorDecisionNotes: "Ready to move this into tracked delivery.",
    recordRef: "openproject://work_packages/41",
    source: {
      integration_id: "default",
      native_ref: {
        command: "idea",
        message_id: "985",
      },
      surface: "telegram",
    },
    status: "accepted",
    title: "Bounded read path",
    triageSummary: "Needs a bounded broker workflow before later decision handling.",
    updatedAt: "2026-04-19T14:00:00Z",
  };

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/77") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField12: {
                  title: "idea-41",
                },
                status: {
                  title: "done",
                },
              },
              createdAt: "2026-04-21T08:55:00Z",
              customField12: "idea-41",
              id: 77,
              subject: "Bounded read path",
              updatedAt: "2026-04-21T09:00:00Z",
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/41") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "accepted",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 9,
              subject: "Bounded read path",
              updatedAt: "2026-04-21T08:58:00Z",
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/41") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: {
                  title: "implemented",
                },
              },
              createdAt: "2026-04-18T10:00:00Z",
              customField1: "telegram",
              customField2: JSON.stringify({
                integration_id: "default",
                native_ref: {
                  command: "idea",
                  message_id: "985",
                },
                surface: "telegram",
              }),
              customField11: "openproject://work_packages/77",
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
                  "Needs a bounded broker workflow before later decision handling.",
                  "",
                  "## Operator decision notes",
                  "",
                  "Ready to move this into tracked delivery.",
                  "",
                  "## Delivery closeout",
                  "",
                  "Delivered through the first bounded execution slice.",
                  "",
                  "## Internal evaluation",
                  "",
                  "_No internal evaluation recorded._",
                ].join("\n"),
              },
              id: 41,
              lockVersion: 10,
              subject: "Bounded read path",
              updatedAt: "2026-04-21T09:00:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.closeAcceptedIdeaDelivery({
    closeoutNotes: "Delivered through the first bounded execution slice.",
    currentRecord,
    recordId: 41,
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].url, "http://example.test/api/v3/work_packages/77");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].url, "http://example.test/api/v3/work_packages/41");
  assert.equal(calls[2].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 9);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/86");
  assert.match(
    patchPayload.description.raw,
    /## Delivery closeout\n\nDelivered through the first bounded execution slice\./,
  );
  assert.equal(result.deliveryRecord.recordRef, "openproject://work_packages/77");
  assert.equal(result.sourceRecord.status, "implemented");
  assert.equal(
    result.sourceRecord.deliveryCloseoutNotes,
    "Delivered through the first bounded execution slice.",
  );
});

test("getDeliveryExecutionSummary returns a bounded initiative summary with dependency state", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 4,
              offset: 1,
              pageSize: 100,
              total: 4,
              _embedded: {
                elements: [
                  {
                    _links: {
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    customField14: "PI-2026-02",
                    id: 38,
                    subject: "Productize governed local-agent platform",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    customField14: "PI-2026-02",
                    id: 39,
                    subject: "Move delivery workflow operations into broker-owned APIs",
                  },
                  {
                    _links: {
                      assignee: { title: "admin" },
                      parent: { href: "/api/v3/work_packages/39" },
                      status: { title: "blocked" },
                      type: { title: "Task" },
                    },
                    customField14: "PI-2026-02",
                    id: 40,
                    subject: "Add delivery execution summary projection",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/39" },
                      status: { title: "new" },
                      type: { title: "Task" },
                    },
                    id: 41,
                    subject: "Expose execution summary HTTP route",
                  },
                ],
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/40/relations"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 1,
              offset: 1,
              pageSize: 100,
              total: 1,
              _embedded: {
                elements: [
                  {
                    _links: {
                      from: { href: "/api/v3/work_packages/41" },
                      to: { href: "/api/v3/work_packages/40" },
                    },
                    description: {
                      raw: "HTTP route depends on the summary projection landing first.",
                    },
                    id: 501,
                    lag: 0,
                    relationType: "follows",
                  },
                ],
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        /^\/api\/v3\/work_packages\/(?:38|39|41)\/relations$/.test(parsedUrl.pathname)
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
              _embedded: {
                elements: [],
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.getDeliveryExecutionSummary({
    includeDone: true,
    includeParked: false,
    recordId: 38,
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(
    calls[0].url,
    "http://example.test/api/v3/projects/workspace-delivery-art/work_packages?pageSize=100&offset=1",
  );
  assert.equal(result.deliveryRecordId, 38);
  assert.equal(result.deliveryRecordRef, "openproject://work_packages/38");
  assert.equal(result.executionSummary.summary.total_items, 3);
  assert.equal(result.executionSummary.summary.blocked_count, 1);
  assert.equal(result.executionSummary.summary.dependency_count, 1);
  assert.equal(result.executionSummary.summary.unresolved_dependency_count, 1);
  assert.equal(result.executionSummary.execution_tree.children[0].id, 39);
  assert.equal(
    result.executionSummary.execution_tree.children[0].children[0].dependency_blocked,
    true,
  );
  assert.deepEqual(
    result.executionSummary.execution_tree.children[0].children[0].unresolved_dependency_work_package_ids,
    [41],
  );
});
