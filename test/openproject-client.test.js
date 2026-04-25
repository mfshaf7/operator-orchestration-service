import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  createCapturePayload,
  createNodeRequestImpl,
  createOpenProjectClient,
  mapWorkPackageToIdeaRecord,
  syncExecutionContextSection,
} from "../src/openproject-client.js";
import { readMarkdownSections } from "../src/delivery-narrative.js";
import {
  DELIVERY_ACTIVE_STATUSES,
  DELIVERY_BACKLOG_ITERATION_LABEL,
  DELIVERY_PLANNING_WORKFLOW,
  DELIVERY_TARGET_PI_REQUIRED_TYPES,
} from "../src/delivery-taxonomy.js";
import {
  DELIVERY_PM2_CLOSING_PHASE,
  DELIVERY_RETIRED_STATUS,
  evaluateDeliveryInitiativeReviewState,
} from "../src/delivery-initiative-review.js";

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

test("delivery planning workflow mirror exposes the canonical gate metadata", () => {
  assert.equal(
    DELIVERY_PLANNING_WORKFLOW.workflow_id,
    "delivery-art-planning-workflow",
  );
  assert.equal(
    DELIVERY_BACKLOG_ITERATION_LABEL,
    "Not committed to a PI iteration yet.",
  );
  assert.ok(DELIVERY_ACTIVE_STATUSES.has("ready"));
  assert.ok(DELIVERY_TARGET_PI_REQUIRED_TYPES.has("PI Objective"));
});

test("delivery initiative review mirror exposes the canonical closing phase", () => {
  assert.equal(DELIVERY_PM2_CLOSING_PHASE, "Closing");
  assert.equal(DELIVERY_RETIRED_STATUS, "retired");
});

test("evaluateDeliveryInitiativeReviewState requires system demo and clean execution for Closing", () => {
  const result = evaluateDeliveryInitiativeReviewState({
    epic: {
      inspect_and_adapt_actions_present: false,
      pm2_phase: "Executing",
      system_demo_evidence_present: false,
    },
    summary: {
      blocked_count: 1,
      completed_with_weak_done_narrative_count: 0,
      completed_with_weak_evidence_count: 0,
      completed_without_evidence_count: 0,
      completed_without_owner_count: 0,
      open_descendant_count: 2,
      unresolved_dependency_count: 0,
    },
  });

  assert.equal(result.closing_transition_ready, false);
  assert.deepEqual(result.closing_transition_reasons, [
    "system_demo_missing",
    "open_descendants_present",
    "blocked_items_present",
  ]);
});

test("evaluateDeliveryInitiativeReviewState requires Closing and inspect-and-adapt for done", () => {
  const result = evaluateDeliveryInitiativeReviewState({
    epic: {
      inspect_and_adapt_actions_present: false,
      pm2_phase: "Executing",
      system_demo_evidence_present: true,
    },
    summary: {
      blocked_count: 0,
      completed_with_weak_done_narrative_count: 0,
      completed_with_weak_evidence_count: 0,
      completed_without_evidence_count: 0,
      completed_without_owner_count: 0,
      open_descendant_count: 0,
      unresolved_dependency_count: 0,
    },
  });

  assert.equal(result.completion_transition_ready, false);
  assert.deepEqual(result.completion_transition_reasons, [
    "pm2_phase_not_closing",
    "inspect_and_adapt_missing",
  ]);
});

test("evaluateDeliveryInitiativeReviewState treats done narrative drift as a closeout blocker", () => {
  const result = evaluateDeliveryInitiativeReviewState({
    epic: {
      inspect_and_adapt_actions_present: true,
      pm2_phase: "Closing",
      system_demo_evidence_present: true,
    },
    summary: {
      blocked_count: 0,
      completed_with_weak_done_narrative_count: 1,
      completed_with_weak_evidence_count: 0,
      completed_without_evidence_count: 0,
      completed_without_owner_count: 0,
      open_descendant_count: 0,
      unresolved_dependency_count: 0,
    },
  });

  assert.equal(result.closing_transition_ready, false);
  assert.deepEqual(result.closing_transition_reasons, ["done_narrative_weak"]);
});

test("evaluateDeliveryInitiativeReviewState requires terminal descendants for retirement", () => {
  const result = evaluateDeliveryInitiativeReviewState({
    epic: {
      inspect_and_adapt_actions_present: false,
      pm2_phase: "Executing",
      status: "retired",
      system_demo_evidence_present: false,
    },
    summary: {
      blocked_count: 0,
      completed_with_weak_done_narrative_count: 0,
      completed_with_weak_evidence_count: 0,
      completed_without_evidence_count: 0,
      completed_without_owner_count: 0,
      open_descendant_count: 1,
      unresolved_dependency_count: 0,
    },
  });

  assert.equal(result.retirement_transition_ready, false);
  assert.deepEqual(result.retirement_transition_reasons, [
    "open_descendants_present",
    "pm2_phase_not_cleared_for_retired",
  ]);
});

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
                    name: "PM² Phase",
                  },
                  customField31: {
                    fieldFormat: "string",
                    name: "Owner Repo",
                    writable: true,
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
    ownerRepo: "operator-orchestration-service",
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
  assert.equal(createPayload.customField31, "operator-orchestration-service");
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
  const deliveryTypeAllowedValues = [
    "Feature",
    "Enabler",
    "Milestone",
    "PI Objective",
    "Risk",
    "User story",
    "Task",
  ].map((title, index) => ({
    href: `/api/v3/types/${index + 1}`,
    title,
  }));
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
              count: 6,
              offset: 1,
              pageSize: 100,
              total: 6,
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
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/39" },
                      status: { title: "done" },
                      type: { title: "Task" },
                    },
                    id: 42,
                    subject: "Close the first bounded execution slice",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/39" },
                      status: { title: "retired" },
                      type: { title: "Task" },
                    },
                    id: 43,
                    subject: "Retired duplicate planning item",
                  },
                ],
              },
            }),
          };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/38"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              id: 38,
              lockVersion: 1,
              subject: "Productize governed local-agent platform",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/38/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {},
              },
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const formPayload = JSON.parse(options.body);
        if (!formPayload?._links?.type?.href) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: deliveryTypeAllowedValues,
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
              _embedded: {
                schema: {},
              },
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
        const filters = JSON.parse(parsedUrl.searchParams.get("filters") ?? "[]");
        const involvedId = filters[0]?.involved?.values?.[0] ?? null;

        if (involvedId === "40") {
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

        if (["38", "39", "41", "42", "43"].includes(involvedId)) {
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
    "http://example.test/api/v3/projects/workspace-delivery-art/work_packages?offset=1&pageSize=100&filters=%5B%5D",
  );
  assert.equal(result.deliveryRecordId, 38);
  assert.equal(result.deliveryRecordRef, "openproject://work_packages/38");
  assert.equal(result.executionSummary.summary.total_items, 5);
  assert.equal(result.executionSummary.summary.blocked_count, 1);
  assert.equal(result.executionSummary.summary.by_status.done, 1);
  assert.equal(result.executionSummary.summary.by_status.retired, 1);
  assert.equal(result.executionSummary.summary.dependency_count, 1);
  assert.equal(result.executionSummary.summary.unresolved_dependency_count, 1);
  assert.equal(result.executionSummary.summary.retired_count, 1);
  assert.equal(result.executionSummary.execution_tree.children[0].id, 39);
  assert.deepEqual(
    result.executionSummary.execution_tree.children[0].children.map((child) => child.id),
    [40, 41, 42],
  );
  assert.ok(
    calls.some(
      ({ url, options }) =>
        options.method === "GET" &&
        new URL(url).pathname === "/api/v3/relations" &&
        JSON.parse(new URL(url).searchParams.get("filters") ?? "[]")[0]?.involved?.values?.[0] ===
          "40",
    ),
  );
  assert.equal(
    result.executionSummary.execution_tree.children[0].children[0].dependency_blocked,
    true,
  );
  assert.deepEqual(
    result.executionSummary.execution_tree.children[0].children[0].unresolved_dependency_work_package_ids,
    [41],
  );
  assert.equal(
    result.executionSummary.execution_tree.children[0].children[2].status,
    "done",
  );
  assert.equal(result.executionSummary.retired_items[0].id, 43);
});

test("getDeliveryExecutionSummary paginates OpenProject project reads by page offset", async () => {
  const calls = [];
  const deliveryTypeAllowedValues = [
    "Feature",
    "Enabler",
    "Milestone",
    "PI Objective",
    "Risk",
    "User story",
    "Task",
  ].map((title, index) => ({
    href: `/api/v3/types/${index + 1}`,
    title,
  }));
  const firstPageElements = [
    {
      _links: {
        status: { title: "in-progress" },
        type: { title: "Epic" },
      },
      id: 38,
      subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
    },
    ...Array.from({ length: 99 }, (_, index) => {
      const id = 39 + index;
      return {
        _links: {
          parent: { href: "/api/v3/work_packages/38" },
          status: { title: "done" },
          type: { title: "Task" },
        },
        id,
        subject: `Older delivery item ${id}`,
      };
    }),
  ];
  const secondPageElements = Array.from({ length: 49 }, (_, index) => {
    const id = 138 + index;
    return {
      _links: {
        parent: { href: "/api/v3/work_packages/38" },
        status: { title: id === 181 ? "in-progress" : "ready" },
        type: { title: "Task" },
      },
      id,
      subject: `Later delivery item ${id}`,
    };
  });

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        const offset = parsedUrl.searchParams.get("offset");
        if (offset === "1") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                count: 100,
                offset: 1,
                pageSize: 100,
                total: 149,
                _embedded: {
                  elements: firstPageElements,
                },
              }),
          };
        }

        if (offset === "2") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                count: 49,
                offset: 2,
                pageSize: 100,
                total: 149,
                _embedded: {
                  elements: secondPageElements,
                },
              }),
          };
        }
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/38"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              id: 38,
              lockVersion: 1,
              subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/38/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {},
              },
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const formPayload = JSON.parse(options.body);
        if (!formPayload?._links?.type?.href) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: deliveryTypeAllowedValues,
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
              _embedded: {
                schema: {},
              },
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
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
    includeParked: true,
    recordId: 38,
  });

  const workPackageCalls = calls.filter(
    ({ url, options }) =>
      options.method === "GET" &&
      new URL(url).pathname === "/api/v3/projects/workspace-delivery-art/work_packages",
  );
  assert.deepEqual(
    workPackageCalls.map(({ url }) => new URL(url).searchParams.get("offset")),
    ["1", "2"],
  );
  assert.equal(result.executionSummary.summary.total_items, 148);
  assert.ok(
    result.executionSummary.execution_tree.children.some((child) => child.id === 175),
  );
  assert.ok(
    result.executionSummary.execution_tree.children.some((child) => child.id === 181),
  );
});

test("completeDeliveryWorkItem rejects parent completion while descendants remain open", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/181") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Dev Integration Admin" },
                responsible: { title: "Dev Integration Admin" },
                parent: { href: "/api/v3/work_packages/38" },
                status: { title: "in-progress" },
                type: { title: "Feature" },
              },
              customField201: "operator-orchestration-service",
              customField202: "Workflow Integration",
              customField203: "PI-2026-02 / active broker tranche",
              customField204: "All broker execution-plane child tasks are completed and evidenced.",
              customField205: "Broker routes and evidence standards are ready for execution.",
              customField206: "All child work is done or retired, evidence is attached, and validation passed.",
              customField207: "Enabler",
              description: {
                raw: [
                  "## What This Enables",
                  "",
                  "Completes broker ownership of the ART execution plane.",
                  "",
                  "## Benefit Hypothesis",
                  "",
                  "A fully broker-owned execution plane removes direct wrapper drift.",
                  "",
                  "## Scope Boundaries",
                  "",
                  "Admin-only OpenProject controls remain outside the execution plane.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                ].join("\n"),
              },
              id: 181,
              lockVersion: 3,
              subject: "Enabler: Complete broker ownership of the OpenProject ART execution plane",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/181/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                        { href: "/api/v3/statuses/9", title: "done" },
                      ],
                    },
                  },
                  customField201: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField202: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField203: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField204: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField205: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField206: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                  customField207: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 3,
              offset: 1,
              pageSize: 100,
              total: 3,
              _embedded: {
                elements: [
                  {
                    _links: {
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 181,
                    subject: "Enabler: Complete broker ownership of the OpenProject ART execution plane",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/181" },
                      status: { title: "ready" },
                      type: { title: "Task" },
                    },
                    id: 182,
                    subject: "Fix broker-backed ART mutation gaps and switch update and batch operator surfaces",
                  },
                ],
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    async () =>
      client.completeDeliveryWorkItem({
        changedSurfaces: "- `src/openproject-client.js`",
        completionSummary: "Completed the broker-only execution-plane cutover.",
        recordId: 181,
        testResultEvidence: "- PASS: Broker routes responded with the expected execution state.",
        validationEvidence: "- PASS: `node --test test/http.test.js test/delivery-service.test.js`",
      }),
    (error) => {
      assert.equal(error.name, "OpenProjectError");
      assert.equal(error.statusCode, 422);
      assert.equal(error.details, "completion_open_descendants");
      assert.match(error.message, /#182 \(ready\)/);
      return true;
    },
  );
  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/181",
    ),
    false,
  );
});

test("completeDeliveryWorkItem preserves Validation Evidence when it is the last section", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/184"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                parent: { href: "/api/v3/work_packages/181" },
                responsible: { title: "admin" },
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Operator Orchestration Service",
              customField32: "PI-2026-02 / Iteration 1",
              customField33: {
                format: "markdown",
                raw: "- Completion stays on the broker route.",
              },
              customField34: {
                format: "markdown",
                raw: "- Closeout workflow tranche is active.",
              },
              customField35: {
                format: "markdown",
                raw: "- Evidence is recorded before completion.",
              },
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Add broker-owned completion, review, and closeout-readiness workflows.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Closeout needs one governed workflow seam.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Live devint broker proof and validation output exist before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: operator-orchestration-service",
                  "- Parent item: #181",
                  "- Delivery team: Operator Orchestration Service",
                  "- Iteration: PI-2026-02 / Iteration 1",
                ].join("\n"),
              },
              id: 184,
              lockVersion: 4,
              percentageDone: 40,
              remainingTime: "PT3H",
              subject: "Add broker-owned completion, review, and closeout-readiness workflows",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/184/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/91",
                          title: "done",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 2,
              offset: 1,
              pageSize: 100,
              total: 2,
              _embedded: {
                elements: [
                  {
                    _links: {
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/181" },
                      status: { title: "in-progress" },
                      type: { title: "Task" },
                    },
                    id: 184,
                    subject: "Add broker-owned completion, review, and closeout-readiness workflows",
                  },
                ],
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/184"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/181" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              description: {
                raw: JSON.parse(options.body).description.raw,
              },
              id: 184,
              percentageDone: 100,
              remainingTime: "PT0S",
              subject: "Add broker-owned completion, review, and closeout-readiness workflows",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.completeDeliveryWorkItem({
    changedSurfaces: "- operator-orchestration-service/src/openproject-client.js",
    completionSummary:
      "Completed the broker closeout workflow family and preserved the final validation section in the attestation record.",
    recordId: 184,
    testResultEvidence:
      "- PASS: Live broker closeout-readiness read returned the active descendant count.",
    validationEvidence:
      "- PASS: node --test test/openproject-client.test.js test/delivery-service.test.js test/http.test.js",
  });

  assert.equal(result.workPackage.status, "done");
  assert.equal(result.completionEvidenceState.present, true);
  assert.equal(result.completionEvidenceState.formattingValid, true);
  assert.equal(
    result.completionEvidenceState.sections["Validation Evidence"],
    true,
  );
  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/184",
    ),
    true,
  );
});

test("completeDeliveryWorkItem keeps broker completion notes inside the operator note section", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/184"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                parent: { href: "/api/v3/work_packages/181" },
                responsible: { title: "admin" },
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Operator Orchestration Service",
              customField32: "PI-2026-02 / Iteration 1",
              customField33: {
                format: "markdown",
                raw: "- Completion stays on the broker route.",
              },
              customField34: {
                format: "markdown",
                raw: "- Closeout workflow tranche is active.",
              },
              customField35: {
                format: "markdown",
                raw: "- Evidence is recorded before completion.",
              },
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Add broker-owned completion, review, and closeout-readiness workflows.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Closeout needs one governed workflow seam.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Live devint broker proof and validation output exist before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: operator-orchestration-service",
                  "- Parent item: #181",
                  "- Delivery team: Operator Orchestration Service",
                  "- Iteration: PI-2026-02 / Iteration 1",
                  "",
                  "## Operator work notes",
                  "",
                  "- 2026-04-24T00:00:00.000Z accepted-idea-delivery-smoke: Filling the execution contract before ART closeout.",
                ].join("\n"),
              },
              id: 184,
              lockVersion: 4,
              percentageDone: 40,
              remainingTime: "PT3H",
              subject: "Add broker-owned completion, review, and closeout-readiness workflows",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/184/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/91",
                          title: "done",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 2,
              offset: 1,
              pageSize: 100,
              total: 2,
              _embedded: {
                elements: [
                  {
                    _links: {
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/181" },
                      status: { title: "in-progress" },
                      type: { title: "Task" },
                    },
                    id: 184,
                    subject: "Add broker-owned completion, review, and closeout-readiness workflows",
                  },
                ],
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/184"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/181" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              description: {
                raw: JSON.parse(options.body).description.raw,
              },
              id: 184,
              percentageDone: 100,
              remainingTime: "PT0S",
              subject: "Add broker-owned completion, review, and closeout-readiness workflows",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.completeDeliveryWorkItem({
    changedSurfaces: "- operator-orchestration-service/src/openproject-client.js",
    completionNote:
      "Local-only completion on branch `codex/art-completion-note-preflight-guard` at commit `1234567`.",
    completionSummary:
      "Completed the broker closeout workflow family and preserved the final validation section in the attestation record.",
    recordId: 184,
    testResultEvidence:
      "- PASS: Live broker closeout-readiness read returned the active descendant count.",
    validationEvidence:
      "- PASS: node --test test/openproject-client.test.js test/delivery-service.test.js test/http.test.js",
  });

  assert.equal(result.workPackage.status, "done");
  assert.equal(result.completionEvidenceState.formattingValid, true);

  const patchCall = calls.find(
    ({ url, options }) =>
      options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/184",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  const sections = readMarkdownSections(patchPayload.description.raw);
  assert.match(
    sections.get("Operator work notes"),
    /Local-only completion on branch `codex\/art-completion-note-preflight-guard`/,
  );
  assert.equal(
    sections.get("Validation Evidence"),
    "- PASS: node --test test/openproject-client.test.js test/delivery-service.test.js test/http.test.js",
  );
});

test("listDeliveryProjectAssignablePrincipals reads the live assignable-principal list", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 4,
              identifier: "workspace-delivery-art",
              name: "Workspace Delivery ART",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/workspaces/4/available_assignees"
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
                      self: { href: "/api/v3/users/5" },
                    },
                    _type: "User",
                    id: 5,
                    login: "operator-orchestration-service",
                    name: "Operator Orchestration-Service",
                  },
                  {
                    _links: {
                      self: { href: "/api/v3/users/6" },
                    },
                    _type: "User",
                    id: 6,
                    login: "platform-engineering",
                    name: "Platform Engineering",
                  },
                ],
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.listDeliveryProjectAssignablePrincipals();

  assert.deepEqual(result.project, {
    id: 4,
    identifier: "workspace-delivery-art",
    name: "Workspace Delivery ART",
    recordRef: "openproject://projects/workspace-delivery-art",
  });
  assert.deepEqual(result.principals, [
    {
      href: "/api/v3/users/5",
      id: 5,
      login: "operator-orchestration-service",
      name: "Operator Orchestration-Service",
      type: "User",
    },
    {
      href: "/api/v3/users/6",
      id: 6,
      login: "platform-engineering",
      name: "Platform Engineering",
      type: "User",
    },
  ]);
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).pathname),
    [
      "/api/v3/projects/workspace-delivery-art",
      "/api/v3/workspaces/4/available_assignees",
    ],
  );
});

test("completeDeliveryWorkItem rejects weak done-state narrative before patching OpenProject", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/184"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                parent: { href: "/api/v3/work_packages/181" },
                responsible: { title: "admin" },
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Operator Orchestration Service",
              customField32: "PI-2026-02 / Iteration 1",
              customField33: {
                format: "markdown",
                raw: "- Completion stays on the broker route.",
              },
              customField34: {
                format: "markdown",
                raw: "- Closeout workflow tranche is active.",
              },
              customField35: {
                format: "markdown",
                raw: "- Evidence is recorded before completion.",
              },
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Add broker-owned completion, review, and closeout-readiness workflows.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Closeout needs one governed workflow seam.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Live devint broker proof and validation output exist before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: operator-orchestration-service",
                ].join("\n"),
              },
              id: 184,
              lockVersion: 4,
              percentageDone: 40,
              remainingTime: "PT3H",
              subject: "Add broker-owned completion, review, and closeout-readiness workflows",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/184/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/91",
                          title: "done",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              count: 2,
              offset: 1,
              pageSize: 100,
              total: 2,
              _embedded: {
                elements: [
                  {
                    _links: {
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Establish the governed enterprise AI agent control plane and runtime foundation",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/181" },
                      status: { title: "in-progress" },
                      type: { title: "Task" },
                    },
                    id: 184,
                    subject: "Add broker-owned completion, review, and closeout-readiness workflows",
                  },
                ],
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.completeDeliveryWorkItem({
        changedSurfaces: "- operator-orchestration-service/src/openproject-client.js",
        completionSummary:
          "Attempted to complete the broker closeout workflow family with weak done-state narrative context.",
        recordId: 184,
        testResultEvidence:
          "- PASS: Live broker closeout-readiness read returned the active descendant count.",
        validationEvidence:
          "- PASS: node --test test/openproject-client.test.js test/delivery-service.test.js test/http.test.js",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "done_narrative_invalid" &&
      /Execution Context: missing bullet `Parent item:`/.test(error.message),
  );
  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/184",
    ),
    false,
  );
});

test("createDeliveryWorkItem uses the OpenProject form schema to create a ready child work item", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/61"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/38" },
                priority: { href: "/api/v3/priorities/8", title: "Normal" },
                status: { title: "in-progress" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-02",
              id: 61,
              subject: "Brokerize core delivery control commands behind internal APIs",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const formPayload = JSON.parse(options.body);
        const requestedTypeHref = formPayload?._links?.type?.href ?? null;

        if (!requestedTypeHref) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: [
                          {
                            href: "/api/v3/types/7",
                            title: "User story",
                          },
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
              _embedded: {
                payload: {
                  _links: {
                    status: {
                      href: "/api/v3/statuses/1",
                      title: "new",
                    },
                  },
                },
                schema: {
                  assignee: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          login: "admin",
                          title: "Dev Integration Admin",
                        },
                      ],
                    },
                  },
                  responsible: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          login: "admin",
                          title: "Dev Integration Admin",
                        },
                      ],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/1",
                          title: "new",
                        },
                        {
                          href: "/api/v3/statuses/22",
                          title: "ready",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    required: false,
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/custom_options/3601",
                          title: "Business",
                        },
                        {
                          href: "/api/v3/custom_options/3602",
                          title: "Enabler",
                        },
                        {
                          href: "/api/v3/custom_options/3603",
                          title: "Improvement",
                        },
                      ],
                    },
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

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
                elements: [],
              },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
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
                assignee: { title: "Dev Integration Admin" },
                responsible: { title: "Dev Integration Admin" },
                priority: { href: "/api/v3/priorities/8", title: "Normal" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / Iteration 2",
              customField36: "Enabler",
              customField33: {
                format: "markdown",
                raw: "- Operator can create one child task through the broker.",
              },
              customField34: {
                format: "markdown",
                raw: "- Parent feature and PI are already active.",
              },
              customField35: {
                format: "markdown",
                raw: "- Live devint proof recorded.",
              },
              description: {
                raw: [
                  "## What This Enables",
                  "",
                  "Create the work item through the broker.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Need a ready child task for the active broker slice.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Live devint proof recorded.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                ].join("\n"),
              },
              dueDate: "2026-04-25",
              estimatedTime: "PT8H",
              id: 69,
              lockVersion: 1,
              percentageDone: 0,
              remainingTime: "PT8H",
              startDate: "2026-04-21",
              subject: "Enabler: Brokerize delivery work-item move",
              updatedAt: "2026-04-21T10:00:00Z",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/69"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Dev Integration Admin" },
                responsible: { title: "Dev Integration Admin" },
                priority: { href: "/api/v3/priorities/8", title: "Normal" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField36: "Enabler",
              id: 69,
              lockVersion: 1,
              subject: "Enabler: Brokerize delivery work-item move",
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/69"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Dev Integration Admin" },
                parent: { href: "/api/v3/work_packages/61" },
                priority: { href: "/api/v3/priorities/8", title: "Normal" },
                responsible: { title: "Dev Integration Admin" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / Iteration 2",
              customField36: "Enabler",
              customField33: {
                format: "markdown",
                raw: "- Operator can create one child task through the broker.",
              },
              customField34: {
                format: "markdown",
                raw: "- Parent feature and PI are already active.",
              },
              customField35: {
                format: "markdown",
                raw: "- Live devint proof recorded.",
              },
              description: {
                raw: [
                  "## What This Enables",
                  "",
                  "Create the work item through the broker.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Need a ready child task for the active broker slice.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Live devint proof recorded.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                ].join("\n"),
              },
              dueDate: "2026-04-25",
              estimatedTime: "PT8H",
              id: 69,
              percentageDone: 0,
              remainingTime: "PT8H",
              startDate: "2026-04-21",
              subject: "Enabler: Brokerize delivery work-item move",
              updatedAt: "2026-04-21T10:00:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.createDeliveryWorkItem({
    acceptanceCriteria: "- Operator can create one child task through the broker.",
    assigneeLogin: "admin",
    definitionOfDone: "- Live devint proof recorded.",
    definitionOfReady: "- Parent feature and PI are already active.",
    deliveryTeam: "Workflow Integration",
    description: [
      "## What This Enables",
      "",
      "Create the work item through the broker.",
      "",
      "## Why This Matters Now",
      "",
      "Need a ready child task for the active broker slice.",
      "",
      "## Evidence Expectation",
      "",
      "Live devint proof recorded.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `operator-orchestration-service`",
    ].join("\n"),
    dueDate: "2026-04-25",
    estimatedWork: "8",
    executionClassification: "Enabler",
    iteration: "PI-2026-02 / Iteration 2",
    ownerRepo: "operator-orchestration-service",
    parentRecordId: 61,
    percentComplete: 0,
    remainingWork: "8",
    responsibleLogin: "admin",
    startDate: "2026-04-21",
    status: "ready",
    subject: "Brokerize delivery work-item move",
    type: "User story",
  });

  const createPayload = JSON.parse(calls[4].options.body);
  assert.equal(createPayload._links.parent, undefined);
  assert.equal(createPayload._links.type.href, "/api/v3/types/7");
  assert.equal(createPayload._links.priority.href, "/api/v3/priorities/8");
  assert.equal(createPayload._links.status.href, "/api/v3/statuses/22");
  assert.equal(createPayload._links.assignee.href, "/api/v3/users/1");
  assert.equal(createPayload._links.responsible.href, "/api/v3/users/1");
  assert.equal(createPayload.customField14, "PI-2026-02");
  assert.equal(createPayload.customField30, "operator-orchestration-service");
  assert.equal(createPayload.customField31, "Workflow Integration");
  assert.equal(createPayload.customField32, "PI-2026-02 / Iteration 2");
  assert.equal(createPayload.customField36.title, "Enabler");
  assert.equal(createPayload.customField33.format, "markdown");
  assert.equal(
    createPayload.customField33.raw,
    "- Operator can create one child task through the broker.",
  );
  assert.equal(createPayload.customField34.format, "markdown");
  assert.equal(
    createPayload.customField34.raw,
    "- Parent feature and PI are already active.",
  );
  assert.equal(createPayload.customField35.format, "markdown");
  assert.equal(createPayload.customField35.raw, "- Live devint proof recorded.");
  assert.equal(createPayload.estimatedTime, "PT8H");
  assert.equal(createPayload.remainingTime, "PT8H");
  const patchPayload = JSON.parse(calls[6].options.body);
  assert.equal(patchPayload._links.parent.href, "/api/v3/work_packages/61");
  assert.equal(result.workItemRecordRef, "openproject://work_packages/69");
  assert.equal(result.parentWorkItemRecordId, 61);
  assert.equal(result.workItem.assigneeLogin, "Dev Integration Admin");
  assert.equal(result.workItem.executionClassification, "Enabler");
  assert.equal(result.workItem.parentId, 61);
  assert.equal(result.workItem.targetPi, "PI-2026-02");
  assert.equal(result.workItem.type, "User story");
  assert.equal(result.workItem.customFields["Owner Repo"], "operator-orchestration-service");
  assert.equal(result.workItem.customFields["Execution Classification"], "Enabler");
  assert.equal(
    result.workItem.customFields["Acceptance Criteria"],
    "- Operator can create one child task through the broker.",
  );
  assert.equal(
    result.workItem.customFields["Definition of Ready"],
    "- Parent feature and PI are already active.",
  );
  assert.equal(
    result.workItem.customFields["Definition of Done"],
    "- Live devint proof recorded.",
  );
  assert.equal(result.creationApplied.execution_classification, "Enabler");
  assert.equal(result.creationApplied.target_pi, "PI-2026-02");
  assert.equal(result.creationApplied.status, "ready");
});

test("createDeliveryWorkItem rejects story-level work beneath an uncommitted feature", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/61"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "new" },
                type: { title: "Feature" },
              },
              customField14: null,
              id: 61,
              subject: "Improvement: Define the consume-to-PI-planning workflow",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const formPayload = JSON.parse(options.body);
        const requestedTypeHref = formPayload?._links?.type?.href ?? null;

        if (!requestedTypeHref) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: [
                          {
                            href: "/api/v3/types/7",
                            title: "User story",
                          },
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
              _embedded: {
                payload: {
                  _links: {
                    status: {
                      href: "/api/v3/statuses/1",
                      title: "new",
                    },
                  },
                },
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/1",
                          title: "new",
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
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                elements: [],
              },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.createDeliveryWorkItem({
        parentRecordId: 61,
        subject: "Improvement: Define the initiative-shell consume model",
        type: "User story",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "parent_feature_missing_target_pi" &&
      /PI-committed parent Feature/.test(error.message),
  );
});

test("createDeliveryWorkItem defers execution classification when the create form omits it", async () => {
  const calls = [];
  let workItemFetchCount = 0;
  let workItemFormCount = 0;
  let patchCount = 0;
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/61"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                priority: { href: "/api/v3/priorities/8", title: "Normal" },
                status: { title: "ready" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              id: 61,
              lockVersion: 3,
              subject: "Enabler: Decide whether extraction is justified",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const requestPayload = JSON.parse(options.body ?? "{}");
        const requestedTypeHref = requestPayload?._links?.type?.href ?? null;

        if (!requestedTypeHref) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: [
                          { href: "/api/v3/types/7", title: "User story" },
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
              _embedded: {
                payload: {
                  _links: {
                    status: { title: "new" },
                  },
                },
                schema: {
                  assignee: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/users/1", title: "admin" }],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    required: false,
                    type: "Formattable",
                    writable: true,
                  },
                  responsible: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/users/1", title: "admin" }],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/statuses/22", title: "ready" }],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
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
                status: { title: "ready" },
                type: { title: "User story" },
              },
              id: 69,
              lockVersion: 1,
              subject: "Enabler: Brokerize delivery work-item move",
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/69") {
        workItemFetchCount += 1;
        const payload =
          workItemFetchCount >= 3
            ? {
                _links: {
                  assignee: { title: "Dev Integration Admin" },
                  parent: { href: "/api/v3/work_packages/61" },
                  priority: { href: "/api/v3/priorities/8", title: "Normal" },
                  responsible: { title: "Dev Integration Admin" },
                  status: { title: "ready" },
                  type: { title: "User story" },
                },
                customField14: "PI-2026-03",
                customField30: "operator-orchestration-service",
                customField31: "Workflow Integration",
                customField32: "PI-2026-03 / Iteration 1",
                customField33: {
                  format: "markdown",
                  raw: "- Operator can create one child story through the broker.",
                },
                customField34: {
                  format: "markdown",
                  raw: "- Parent feature and PI are already committed.",
                },
                customField35: {
                  format: "markdown",
                  raw: "- Live devint proof recorded.",
                },
                customField36: "Enabler",
                description: {
                  format: "markdown",
                  raw: [
                    "## What This Enables",
                    "",
                    "Create the work item through the broker.",
                    "",
                    "## Why This Matters Now",
                    "",
                    "Need a ready child task for the active broker slice.",
                    "",
                    "## Evidence Expectation",
                    "",
                    "Live devint proof recorded.",
                    "",
                    "## Execution Context",
                    "",
                    "- Owner repo: `operator-orchestration-service`",
                  ].join("\n"),
                },
                id: 69,
                lockVersion: 4,
                subject: "Enabler: Brokerize delivery work-item move",
                updatedAt: "2026-04-25T10:00:00Z",
              }
            : {
                _links: {
                  assignee: { title: "Dev Integration Admin" },
                  parent: { href: "/api/v3/work_packages/61" },
                  priority: { href: "/api/v3/priorities/8", title: "Normal" },
                  responsible: { title: "Dev Integration Admin" },
                  status: { title: "ready" },
                  type: { title: "User story" },
                },
                customField14: "PI-2026-03",
                customField30: "operator-orchestration-service",
                customField31: "Workflow Integration",
                customField32: "PI-2026-03 / Iteration 1",
                customField33: {
                  format: "markdown",
                  raw: "- Operator can create one child story through the broker.",
                },
                customField34: {
                  format: "markdown",
                  raw: "- Parent feature and PI are already committed.",
                },
                customField35: {
                  format: "markdown",
                  raw: "- Live devint proof recorded.",
                },
                description: {
                  format: "markdown",
                  raw: [
                    "## What This Enables",
                    "",
                    "Create the work item through the broker.",
                    "",
                    "## Why This Matters Now",
                    "",
                    "Need a ready child task for the active broker slice.",
                    "",
                    "## Evidence Expectation",
                    "",
                    "Live devint proof recorded.",
                    "",
                    "## Execution Context",
                    "",
                    "- Owner repo: `operator-orchestration-service`",
                  ].join("\n"),
                },
                id: 69,
                lockVersion: workItemFetchCount === 1 ? 2 : 3,
                subject: "Enabler: Brokerize delivery work-item move",
                updatedAt: "2026-04-25T10:00:00Z",
              };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(payload),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/69/form"
      ) {
        workItemFormCount += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    required: false,
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                      ],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/statuses/22", title: "ready" }],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/69") {
        patchCount += 1;
        const responsePayload =
          patchCount === 1
            ? {
                _links: {
                  assignee: { title: "Dev Integration Admin" },
                  parent: { href: "/api/v3/work_packages/61" },
                  priority: { href: "/api/v3/priorities/8", title: "Normal" },
                  responsible: { title: "Dev Integration Admin" },
                  status: { title: "ready" },
                  type: { title: "User story" },
                },
                customField14: "PI-2026-03",
                customField30: "operator-orchestration-service",
                customField31: "Workflow Integration",
                customField32: "PI-2026-03 / Iteration 1",
                customField33: {
                  format: "markdown",
                  raw: "- Operator can create one child story through the broker.",
                },
                customField34: {
                  format: "markdown",
                  raw: "- Parent feature and PI are already committed.",
                },
                customField35: {
                  format: "markdown",
                  raw: "- Live devint proof recorded.",
                },
                id: 69,
                lockVersion: 3,
                subject: "Enabler: Brokerize delivery work-item move",
              }
            : {
                _links: {
                  assignee: { title: "Dev Integration Admin" },
                  parent: { href: "/api/v3/work_packages/61" },
                  priority: { href: "/api/v3/priorities/8", title: "Normal" },
                  responsible: { title: "Dev Integration Admin" },
                  status: { title: "ready" },
                  type: { title: "User story" },
                },
                customField14: "PI-2026-03",
                customField30: "operator-orchestration-service",
                customField31: "Workflow Integration",
                customField32: "PI-2026-03 / Iteration 1",
                customField33: {
                  format: "markdown",
                  raw: "- Operator can create one child story through the broker.",
                },
                customField34: {
                  format: "markdown",
                  raw: "- Parent feature and PI are already committed.",
                },
                customField35: {
                  format: "markdown",
                  raw: "- Live devint proof recorded.",
                },
                customField36: "Enabler",
                id: 69,
                lockVersion: 4,
                subject: "Enabler: Brokerize delivery work-item move",
              };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(responsePayload),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.createDeliveryWorkItem({
    acceptanceCriteria: "- Operator can create one child story through the broker.",
    assigneeLogin: "admin",
    definitionOfDone: "- Live devint proof recorded.",
    definitionOfReady: "- Parent feature and PI are already committed.",
    deliveryTeam: "Workflow Integration",
    description: [
      "## What This Enables",
      "",
      "Create the work item through the broker.",
      "",
      "## Why This Matters Now",
      "",
      "Need a ready child task for the active broker slice.",
      "",
      "## Evidence Expectation",
      "",
      "Live devint proof recorded.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `operator-orchestration-service`",
    ].join("\n"),
    executionClassification: "Enabler",
    iteration: "PI-2026-03 / Iteration 1",
    ownerRepo: "operator-orchestration-service",
    parentRecordId: 61,
    responsibleLogin: "admin",
    status: "ready",
    subject: "Brokerize delivery work-item move",
    targetPi: "PI-2026-03",
    type: "User story",
  });

  const createCall = calls.find(
    (call) =>
      call.options.method === "POST" &&
      new URL(call.url).pathname === "/api/v3/projects/workspace-delivery-art/work_packages",
  );
  assert.ok(createCall);
  const createPayload = JSON.parse(createCall.options.body);
  assert.equal(createPayload.customField36, undefined);

  const patchCalls = calls.filter(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/69",
  );
  assert.equal(patchCalls.length, 2);
  const deferredPatchPayload = JSON.parse(patchCalls[1].options.body);
  assert.deepEqual(deferredPatchPayload.customField36, {
    href: "/api/v3/custom_options/3602",
    title: "Enabler",
  });
  assert.equal(workItemFormCount, 2);
  assert.equal(result.workItem.executionClassification, "Enabler");
  assert.equal(result.workItem.customFields["Execution Classification"], "Enabler");
});

test("createDeliveryWorkItem rejects blocked status outside the blocker workflow", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/61"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/38" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              id: 61,
              subject: "Enabler: Brokerize guided closeout",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const formPayload = JSON.parse(options.body);
        const requestedTypeHref = formPayload?._links?.type?.href ?? null;
        if (!requestedTypeHref) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: [
                          { href: "/api/v3/types/7", title: "User story" },
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
              _embedded: {
                payload: {
                  _links: {
                    status: { href: "/api/v3/statuses/1", title: "new" },
                  },
                },
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/3", title: "blocked" },
                        { href: "/api/v3/statuses/1", title: "new" },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    required: false,
                    type: "String",
                    writable: true,
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    required: false,
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.createDeliveryWorkItem({
        description: [
          "## What This Enables",
          "",
          "Create the blocked item.",
          "",
          "## Why This Matters Now",
          "",
          "The blocker path must stay bounded.",
          "",
          "## Evidence Expectation",
          "",
          "Blocked work is recorded through the blocker workflow.",
          "",
          "## Execution Context",
          "",
          "- Owner repo: `operator-orchestration-service`",
        ].join("\n"),
        executionClassification: "Enabler",
        ownerRepo: "operator-orchestration-service",
        parentRecordId: 61,
        status: "blocked",
        subject: "Enabler: Test blocked create rejection",
        targetPi: "PI-2026-03",
        type: "User story",
      }),
    (error) =>
      error?.name === "OpenProjectError" &&
      error.message.includes("Use the blocker workflow to enter blocked status") &&
      error.errorClass === "validation_failure" &&
      error.details === "blocked_requires_blocker_workflow",
  );
});

test("updateDeliveryWorkItem applies bounded workflow fields without exposing arbitrary patch semantics", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                responsible: { title: "admin" },
                status: { title: "ready" },
                type: { title: "Task" },
              },
              customField14: null,
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / Iteration 2",
              customField33: {
                format: "markdown",
                raw: "- Broker mapping supports bounded update semantics.",
              },
              customField34: {
                format: "markdown",
                raw: "- The active broker slice is already admitted.",
              },
              customField35: {
                format: "markdown",
                raw: "- Validation and evidence are attached before completion.",
              },
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Add bounded delivery work-item update mapping.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "The broker update path must preserve the execution contract.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Validation and evidence are attached before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
              updatedAt: "2026-04-21T02:10:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  assignee: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          title: "admin",
                        },
                      ],
                    },
                  },
                  responsible: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          title: "admin",
                        },
                      ],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/91",
                          title: "in-progress",
                        },
                        {
                          href: "/api/v3/statuses/92",
                          title: "ready",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                responsible: { title: "admin" },
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / Iteration 2",
              customField33: {
                format: "markdown",
                raw: "- Broker mapping supports bounded update semantics.",
              },
              customField34: {
                format: "markdown",
                raw: "- The active broker slice is already admitted.",
              },
              customField35: {
                format: "markdown",
                raw: "- Validation and evidence are attached before completion.",
              },
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Broker mapping is underway.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "The broker update path must preserve the execution contract.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Validation and evidence are attached before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                  "",
                  "## Operator work notes",
                  "",
                  "- 2026-04-21T02:12:00.000Z codex-local: Started broker update implementation.",
                ].join("\n"),
              },
              id: 56,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
              updatedAt: "2026-04-21T02:12:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryWorkItem({
    assigneeLogin: "admin",
    description: [
      "## What This Achieves",
      "",
      "Broker mapping is underway.",
      "",
      "## Why This Matters Now",
      "",
      "The broker update path must preserve the execution contract.",
      "",
      "## Evidence Expectation",
      "",
      "Validation and evidence are attached before completion.",
      "",
      "## Execution Context",
      "",
      "- Owner repo: `operator-orchestration-service`",
    ].join("\n"),
    recordId: 56,
    status: "in-progress",
    targetPi: "PI-2026-02",
    workNote: "Started broker update implementation.",
    workNoteAuthor: "codex-local",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 6);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/91");
  assert.equal(patchPayload._links.assignee.href, "/api/v3/users/1");
  assert.equal(patchPayload.customField14, "PI-2026-02");
  assert.match(patchPayload.description.raw, /## Operator work notes/);
  assert.match(patchPayload.description.raw, /Started broker update implementation\./);
  assert.equal(result.workItemRecordRef, "openproject://work_packages/56");
  assert.equal(result.workItem.status, "in-progress");
  assert.equal(result.workItem.assigneeLogin, "admin");
  assert.equal(result.changesApplied.target_pi.to, "PI-2026-02");
});

test("updateDeliveryWorkItem synchronizes execution context when planning repair restates governance fields", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/42" },
                status: { title: "new" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              customField29: "Enabler",
              customField30: "platform-engineering",
              customField31: "Platform Engineering",
              customField32: "PI-2026-03 / Iteration 1",
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Moves ART quality and readiness reads onto the broker path.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "The normal operator workflow must stop depending on Rails dump helpers.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Broker-native validation and quality proof must pass before closeout.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `platform-engineering`",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Move normal ART quality checks onto the broker-native path",
              updatedAt: "2026-04-25T03:00:00Z",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/42"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "User story" },
              },
              description: { raw: "" },
              id: 42,
              lockVersion: 4,
              subject: "Provide broker-native quality and readiness reads",
              updatedAt: "2026-04-25T02:50:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField29: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/42" },
                status: { title: "new" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              customField30: "platform-engineering",
              customField31: "Platform Engineering",
              customField32: "PI-2026-03 / Iteration 1",
              description: {
                raw: JSON.parse(options.body).description.raw,
              },
              id: 56,
              lockVersion: 7,
              subject: "Move normal ART quality checks onto the broker-native path",
              updatedAt: "2026-04-25T03:05:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryWorkItem({
    deliveryTeam: "Platform Engineering",
    iteration: "PI-2026-03 / Iteration 1",
    ownerRepo: "platform-engineering",
    recordId: 56,
    targetPi: "PI-2026-03",
    workNote: "Normalized the planning-repair execution context.",
    workNoteAuthor: "codex-local",
  });

  const patchPayload = JSON.parse(calls.at(-1).options.body);
  assert.match(patchPayload.description.raw, /- Owner repo: `platform-engineering`/);
  assert.match(
    patchPayload.description.raw,
    /- Parent item: #42 Provide broker-native quality and readiness reads/,
  );
  assert.match(patchPayload.description.raw, /- Delivery team: `Platform Engineering`/);
  assert.match(patchPayload.description.raw, /- Iteration: `PI-2026-03 \/ Iteration 1`/);
  assert.match(patchPayload.description.raw, /## Operator work notes/);
  assert.match(
    patchPayload.description.raw,
    /Normalized the planning-repair execution context\./,
  );
  assert.equal(result.changesApplied.description.to_present, true);
});

test("syncExecutionContextSection replaces a trailing execution context instead of duplicating it", () => {
  const description = [
    "## What This Enables",
    "",
    "The residual runner can now retire cleanly.",
    "",
    "## Execution Context",
    "",
    "- Owner repo: `platform-engineering`",
  ].join("\n");

  const result = syncExecutionContextSection(description, {
    deliveryTeam: "Platform Engineering",
    iteration: "Program-wide / planning",
    ownerRepo: "platform-engineering",
    parentId: 306,
    parentSubject:
      "Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
  });

  const executionContextCount = (result.match(/^## Execution Context$/gm) ?? []).length;
  assert.equal(executionContextCount, 1);
  assert.match(
    result,
    /- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface/,
  );
  assert.match(result, /- Delivery team: `Platform Engineering`/);
  assert.match(result, /- Iteration: `Program-wide \/ planning`/);
});

test("syncExecutionContextSection removes orphaned execution context bullets left before the heading", () => {
  const description = [
    "## Scope Boundaries",
    "",
    "- Retire the residual runner classification.",
    "- Keep the broker-owned ART workflow off direct Rails reads.",
    "",
    "- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
    "- Delivery team: `Platform Engineering`",
    "- Iteration: `Program-wide / planning`",
    "- Target PI: `PI-2026-03`",
    "- Primary surface: `platform-engineering/products/openproject/runbooks`",
    "",
    "## Execution Context",
    "",
    "- Owner repo: `platform-engineering`",
  ].join("\n");

  const result = syncExecutionContextSection(description, {
    deliveryTeam: "Platform Engineering",
    iteration: "Program-wide / planning",
    ownerRepo: "platform-engineering",
    parentId: 306,
    parentSubject:
      "Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
  });

  const lines = result.split("\n");
  const executionContextHeadingIndex = lines.findIndex(
    (line) => line === "## Execution Context",
  );
  const precedingLine = lines[executionContextHeadingIndex - 1];

  assert.equal(precedingLine, "");
  assert.match(result, /^## Scope Boundaries$/m);
  assert.match(result, /^## Execution Context$/m);
  assert.match(
    result,
    /- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface/,
  );
  assert.equal(
    (
      result.match(
        /- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface/g,
      ) ?? []
    ).length,
    1,
  );
});

test("updateDeliveryWorkItem repairs a malformed description with orphaned execution-context bullets", async () => {
  const calls = [];
  const malformedDescription = [
    "## What This Enables",
    "",
    "The platform can retire the last residual runner path.",
    "",
    "## Benefit Hypothesis",
    "",
    "The admin surface is easier to audit.",
    "",
    "## Scope Boundaries",
    "",
    "- Retire the residual runner classification.",
    "- Do not regress the broker-owned normal ART workflow back to direct Rails-backed reads.",
    "",
    "- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
    "- Delivery team: `Platform Engineering`",
    "- Iteration: `Program-wide / planning`",
    "- Target PI: `PI-2026-03`",
    "- Primary surface: `platform-engineering/products/openproject/runbooks`",
    "",
    "## Execution Context",
    "",
    "- Owner repo: `platform-engineering`",
    "- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
    "- Delivery team: `Platform Engineering`",
    "- Iteration: `Program-wide / planning`",
    "- Target PI: `PI-2026-03`",
    "- Primary surface: `platform-engineering/products/openproject/runbooks`",
  ].join("\n");

  const cleanDescription = [
    "## What This Enables",
    "",
    "The platform can retire the last residual runner path.",
    "",
    "## Benefit Hypothesis",
    "",
    "The admin surface is easier to audit.",
    "",
    "## Scope Boundaries",
    "",
    "- Retire the residual runner classification.",
    "- Do not regress the broker-owned normal ART workflow back to direct Rails-backed reads.",
    "",
    "## Execution Context",
    "",
    "- Owner repo: `platform-engineering`",
    "- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
    "- Delivery team: `Platform Engineering`",
    "- Iteration: `Program-wide / planning`",
    "- Target PI: `PI-2026-03`",
    "- Primary surface: `platform-engineering/products/openproject/runbooks`",
  ].join("\n");

  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/322") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Platform Engineering" },
                parent: { href: "/api/v3/work_packages/306" },
                responsible: { title: "Platform Engineering" },
                status: { title: "ready" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              customField29: "Enabler",
              customField30: "platform-engineering",
              customField31: "Platform Engineering",
              customField32: "Program-wide / planning",
              customField33: {
                format: "markdown",
                raw: "- Residual runner inventory is complete.",
              },
              customField34: {
                format: "markdown",
                raw: "- Replacement read paths are already proven.",
              },
              customField35: {
                format: "markdown",
                raw: "- Residual runner file and references are retired cleanly.",
              },
              description: { raw: malformedDescription },
              id: 322,
              lockVersion: 4,
              subject: "Enabler: Retire residual OpenProject platform-admin Rails runners after the admin surface is proven",
              updatedAt: "2026-04-25T05:47:18Z",
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/306") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              id: 306,
              subject: "Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/322/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField29: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField33: {
                    location: "payload",
                    name: "Acceptance Criteria",
                    type: "Formattable",
                    writable: true,
                  },
                  customField34: {
                    location: "payload",
                    name: "Definition of Ready",
                    type: "Formattable",
                    writable: true,
                  },
                  customField35: {
                    location: "payload",
                    name: "Definition of Done",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/322") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Platform Engineering" },
                parent: { href: "/api/v3/work_packages/306" },
                responsible: { title: "Platform Engineering" },
                status: { title: "ready" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              customField29: "Enabler",
              customField30: "platform-engineering",
              customField31: "Platform Engineering",
              customField32: "Program-wide / planning",
              customField33: {
                format: "markdown",
                raw: "- Residual runner inventory is complete.",
              },
              customField34: {
                format: "markdown",
                raw: "- Replacement read paths are already proven.",
              },
              customField35: {
                format: "markdown",
                raw: "- Residual runner file and references are retired cleanly.",
              },
              description: {
                raw: JSON.parse(options.body).description.raw,
              },
              id: 322,
              lockVersion: 5,
              subject: "Enabler: Retire residual OpenProject platform-admin Rails runners after the admin surface is proven",
              updatedAt: "2026-04-25T06:00:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryWorkItem({
    description: cleanDescription,
    recordId: 322,
  });

  const patchPayload = JSON.parse(calls.at(-1).options.body);
  assert.match(patchPayload.description.raw, /^## Scope Boundaries$/m);
  assert.match(patchPayload.description.raw, /^## Execution Context$/m);
  assert.doesNotMatch(
    patchPayload.description.raw,
    /\n\n- Parent item: #306 Replace remaining OpenProject platform-admin Rails internals with a dedicated platform-admin control surface\n- Delivery team: `Platform Engineering`\n- Iteration: `Program-wide \/ planning`\n- Target PI: `PI-2026-03`\n- Primary surface: `platform-engineering\/products\/openproject\/runbooks`\n\n## Execution Context/m,
  );
  assert.equal(result.changesApplied.description.to_present, true);
});

test("updateDeliveryWorkItem rejects PI-committed work without iteration", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "new" },
                type: { title: "Feature" },
              },
              customField14: null,
              customField32: null,
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Commit the planning workflow feature.",
                  "",
                  "## Benefit Hypothesis",
                  "",
                  "Keeps PI planning explicit.",
                  "",
                  "## Scope Boundaries",
                  "",
                  "Commit the feature only.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `platform-engineering`",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Improvement: Define the consume-to-PI-planning workflow",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3601", title: "Business" },
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                        { href: "/api/v3/custom_options/3603", title: "Improvement" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        targetPi: "PI-2026-03",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "delivery_planning_state_invalid" &&
      /Feature with Target PI must also carry Iteration/.test(error.message),
  );
  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" &&
        new URL(url).pathname === "/api/v3/work_packages/56",
    ),
    false,
  );
});

test("updateDeliveryWorkItem rejects entering blocked status through generic update", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-03 / Iteration 1",
              id: 56,
              lockVersion: 6,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/91", title: "in-progress" },
                        { href: "/api/v3/statuses/93", title: "blocked" },
                      ],
                    },
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        status: "blocked",
      }),
    (error) =>
      error?.name === "OpenProjectError" &&
      error.errorClass === "validation_failure" &&
      error.details === "blocked_requires_blocker_workflow",
  );
});

test("updateDeliveryWorkItem rejects clearing active blocker state through generic update", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField84: { title: "workaround" },
                status: { title: "blocked" },
                type: { title: "Task" },
              },
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-03 / Iteration 1",
              customField80: "Current blocker is still active.",
              customField81: "The task cannot resume through generic update.",
              customField82: "mfshaf7",
              customField83: "2026-04-25",
              customField85: "Use the blocker route to clear active blocker state.",
              customField86: "mfshaf7",
              customField87: "2026-04-26",
              id: 56,
              lockVersion: 6,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/91", title: "in-progress" },
                        { href: "/api/v3/statuses/93", title: "blocked" },
                      ],
                    },
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                  customField80: {
                    location: "payload",
                    name: "Blocker Statement",
                    type: "String",
                    writable: true,
                  },
                  customField81: {
                    location: "payload",
                    name: "Blocker Impact",
                    type: "Formattable",
                    writable: true,
                  },
                  customField82: {
                    location: "payload",
                    name: "Blocker Owner",
                    type: "String",
                    writable: true,
                  },
                  customField83: {
                    location: "payload",
                    name: "Blocker Discovered On",
                    type: "Date",
                    writable: true,
                  },
                  customField84: {
                    location: "_links",
                    name: "Blocker Decision Path",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/2", title: "workaround" },
                      ],
                    },
                  },
                  customField85: {
                    location: "payload",
                    name: "Blocker Justification",
                    type: "Formattable",
                    writable: true,
                  },
                  customField86: {
                    location: "payload",
                    name: "Blocker Follow-Up Owner",
                    type: "String",
                    writable: true,
                  },
                  customField87: {
                    location: "payload",
                    name: "Blocker Review Date",
                    type: "Date",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        status: "in-progress",
      }),
    (error) =>
      error?.name === "OpenProjectError" &&
      error.errorClass === "validation_failure" &&
      error.details === "blocker_clear_requires_blocker_workflow",
  );
});

test("moveDeliveryWorkItem rejects moving a user story under an uncommitted feature", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/80"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "new" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-03",
              id: 80,
              lockVersion: 4,
              subject: "Improvement: Define the initiative-shell consume model",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/90"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/277" },
                status: { title: "new" },
                type: { title: "Feature" },
              },
              customField14: null,
              id: 90,
              lockVersion: 2,
              subject: "Improvement: Define the consume-to-PI-planning workflow",
            }),
        };
      }

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
                      parent: { href: "/api/v3/work_packages/61" },
                      type: { title: "User story" },
                    },
                    customField14: "PI-2026-03",
                    id: 80,
                    subject: "Improvement: Define the initiative-shell consume model",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/277" },
                      type: { title: "Feature" },
                    },
                    customField14: null,
                    id: 90,
                    subject: "Improvement: Define the consume-to-PI-planning workflow",
                  },
                  {
                    _links: {
                      type: { title: "Epic" },
                    },
                    id: 277,
                    subject: "Establish the governed consume-to-PI-planning workflow for Workspace Delivery ART",
                  },
                ],
              },
              count: 3,
              offset: 1,
              pageSize: 100,
              total: 3,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.moveDeliveryWorkItem({
        newParentRecordId: 90,
        recordId: 80,
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "new_parent_missing_target_pi" &&
      /PI-committed parent Feature/.test(error.message),
  );
});

test("updateDeliveryWorkItem rejects malformed completion evidence on done items before patching", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                responsible: { title: "admin" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Operator Orchestration Service",
              customField32: "PI-2026-02 / Iteration 2",
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Broker mapping is complete.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "The broker update path must preserve the execution contract.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Validation and evidence are attached before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: operator-orchestration-service",
                  "- Delivery team: Operator Orchestration Service",
                  "- Iteration: PI-2026-02 / Iteration 2",
                  "",
                  "## Completion Summary",
                  "",
                  "Completed the broker mapping slice.",
                  "",
                  "## Changed Surfaces",
                  "",
                  "- src/openproject-client.js",
                  "",
                  "## Test Result Evidence",
                  "",
                  "- PASS: `npm test`",
                  "",
                  "## Validation Evidence",
                  "",
                  "- PASS: `git diff --check`",
                  "- 2026-04-24T00:23:26.494Z broker: malformed completion note landed here.",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
              updatedAt: "2026-04-21T02:12:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        workNote: "Touching the done record without fixing the malformed completion body.",
        workNoteAuthor: "codex-local",
      }),
    (error) => {
      assert.equal(error.name, "OpenProjectError");
      assert.equal(error.statusCode, 422);
      assert.equal(error.details, "completion_evidence_invalid");
      assert.match(error.message, /Completion evidence does not meet the ART closeout standard/);
      return true;
    },
  );

  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/56",
    ),
    false,
  );
});

test("updateDeliveryWorkItem keeps work notes inside the operator note section on done items", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                responsible: { title: "admin" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / local follow-on",
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Keeps ART closeout writes bounded to the broker surface.",
                  "",
                  "## Why This Matters Now",
                  "",
                  "Follow-up work notes must not break a completed record.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Operator notes stay separate from completion evidence.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                  "- Delivery team: `Workflow Integration`",
                  "- Iteration: `PI-2026-02 / local follow-on`",
                  "",
                  "## Operator work notes",
                  "",
                  "- 2026-04-24T00:23:07.476Z accepted-idea-delivery-smoke: Existing completion note.",
                  "",
                  "## Completion Summary",
                  "",
                  "Closed the broker-side ART guard slice.",
                  "",
                  "## Changed Surfaces",
                  "",
                  "- `src/openproject-client.js`",
                  "",
                  "## Test Result Evidence",
                  "",
                  "- PASS: `npm test`",
                  "",
                  "## Validation Evidence",
                  "",
                  "- PASS: `npm run validate:completion-evidence -- payload.json`",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Keep completion-note insertion bounded inside operator notes",
              updatedAt: "2026-04-24T01:10:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        const patchPayload = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                responsible: { title: "admin" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / local follow-on",
              description: patchPayload.description,
              id: 56,
              lockVersion: 7,
              subject: "Keep completion-note insertion bounded inside operator notes",
              updatedAt: "2026-04-24T01:12:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryWorkItem({
    recordId: 56,
    workNote: "Follow-up proof stayed inside the operator note section.",
    workNoteAuthor: "broker",
  });

  const patchCall = calls.find(
    ({ url, options }) =>
      options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/56",
  );
  const patchPayload = JSON.parse(patchCall.options.body);
  const sections = readMarkdownSections(patchPayload.description.raw);
  assert.match(
    sections.get("Operator work notes"),
    /Follow-up proof stayed inside the operator note section\./,
  );
  assert.equal(
    sections.get("Validation Evidence"),
    "- PASS: `npm run validate:completion-evidence -- payload.json`",
  );
  assert.equal(result.workItem.status, "done");
});

test("updateDeliveryWorkItem rejects generic completion through the update surface", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              id: 56,
              lockVersion: 6,
              subject: "Add bounded delivery work-item update mapping in the broker service layer",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ _embedded: { schema: {} } }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        status: "done",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "completion_requires_evidence",
  );
  assert.equal(calls.at(-1).options.method, "POST");
});

test("updateDeliveryWorkItem rejects weak done-state narrative before patching OpenProject", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/56"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "admin" },
                responsible: { title: "admin" },
                status: { title: "done" },
                type: { title: "Task" },
              },
              customField14: "PI-2026-02",
              customField30: "operator-orchestration-service",
              customField31: "Workflow Integration",
              customField32: "PI-2026-02 / local follow-on",
              description: {
                raw: [
                  "## What This Achieves",
                  "",
                  "Tighten the ART completion evidence preflight.",
                  "",
                  "## Evidence Expectation",
                  "",
                  "Validation and evidence are attached before completion.",
                  "",
                  "## Execution Context",
                  "",
                  "- Owner repo: `operator-orchestration-service`",
                  "- Delivery team: `Workflow Integration`",
                  "- Iteration: `PI-2026-02 / local follow-on`",
                  "",
                  "## Completion Summary",
                  "",
                  "Hardened the ART closeout path before broker writes.",
                  "",
                  "## Changed Surfaces",
                  "",
                  "- `src/openproject-client.js`",
                  "",
                  "## Test Result Evidence",
                  "",
                  "- PASS: `npm test`",
                  "",
                  "## Validation Evidence",
                  "",
                  "- PASS: `npm run validate:completion-evidence`",
                ].join("\n"),
              },
              id: 56,
              lockVersion: 6,
              subject: "Fail closed on ART completion evidence format before broker writes",
              updatedAt: "2026-04-24T00:10:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/56/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  assignee: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          title: "admin",
                        },
                      ],
                    },
                  },
                  responsible: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/1",
                          title: "admin",
                        },
                      ],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/statuses/91",
                          title: "done",
                        },
                      ],
                    },
                  },
                  customField14: {
                    location: "payload",
                    name: "Target PI",
                    type: "String",
                    writable: true,
                  },
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  customField32: {
                    location: "payload",
                    name: "Iteration",
                    type: "String",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryWorkItem({
        recordId: 56,
        workNote: "Tried to add one more follow-up note.",
        workNoteAuthor: "codex-local",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "done_narrative_invalid" &&
      /Narrative headings: Why This Matters Now/.test(error.message),
  );

  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/56",
    ),
    false,
  );
});

test("moveDeliveryWorkItem applies bounded hierarchy mutation semantics", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/63"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-02",
              description: {
                raw: [
                  "## Purpose",
                  "",
                  "Move the delivery work-item path behind the broker.",
                ].join("\n"),
              },
              id: 63,
              lockVersion: 4,
              subject: "Enabler: Brokerize delivery work-item move",
              updatedAt: "2026-04-21T07:00:00Z",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/75"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/38" },
                status: { title: "in-progress" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-02",
              id: 75,
              lockVersion: 2,
              subject: "Enabler: Another delivery control slice",
              updatedAt: "2026-04-21T07:00:00Z",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
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
                    id: 61,
                    subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "User story" },
                    },
                    id: 63,
                    subject: "Enabler: Brokerize delivery work-item move",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    customField14: "PI-2026-02",
                    id: 75,
                    subject: "Enabler: Another delivery control slice",
                  },
                ],
              },
              count: 4,
              offset: 1,
              pageSize: 100,
              total: 4,
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/63"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/75" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              customField14: "PI-2026-02",
              description: {
                raw: [
                  "## Purpose",
                  "",
                  "Move the delivery work-item path behind the broker.",
                  "",
                  "## Operator work notes",
                  "",
                  "- 2026-04-21T07:05:00.000Z codex-local: Moving this task under the new feature parent.",
                ].join("\n"),
              },
              id: 63,
              subject: "Enabler: Brokerize delivery work-item move",
              updatedAt: "2026-04-21T07:05:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.moveDeliveryWorkItem({
    newParentRecordId: 75,
    recordId: 63,
    workNote: "Moving this task under the new feature parent.",
    workNoteAuthor: "codex-local",
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[2].options.method, "GET");
  assert.equal(calls[3].options.method, "PATCH");
  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/63",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload.lockVersion, 4);
  assert.equal(patchPayload._links.parent.href, "/api/v3/work_packages/75");
  assert.match(patchPayload.description.raw, /## Operator work notes/);
  assert.match(patchPayload.description.raw, /Moving this task under the new feature parent\./);
  assert.equal(result.previousParentWorkItemRecordId, 61);
  assert.equal(result.workItem.executionClassification, "Enabler");
  assert.equal(result.workItem.parentId, 75);
  assert.equal(result.workItem.type, "User story");
  assert.equal(result.noteApplied, "description_section");
});

test("manageDeliveryBlocker applies the bounded blocker set workflow", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/64"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              id: 64,
              lockVersion: 7,
              subject: "Enabler: Brokerize delivery blocker management",
              updatedAt: "2026-04-21T08:00:00Z",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/64/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                        { href: "/api/v3/statuses/3", title: "blocked" },
                      ],
                    },
                  },
                  customField80: {
                    location: "payload",
                    name: "Blocker Statement",
                    type: "String",
                    writable: true,
                  },
                  customField81: {
                    location: "payload",
                    name: "Blocker Impact",
                    type: "Formattable",
                    writable: true,
                  },
                  customField82: {
                    location: "payload",
                    name: "Blocker Owner",
                    type: "String",
                    writable: true,
                  },
                  customField83: {
                    location: "payload",
                    name: "Blocker Discovered On",
                    type: "Date",
                    writable: true,
                  },
                  customField84: {
                    location: "_links",
                    name: "Blocker Decision Path",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "remove" },
                        { href: "/api/v3/custom_options/2", title: "workaround" },
                      ],
                    },
                  },
                  customField85: {
                    location: "payload",
                    name: "Blocker Justification",
                    type: "Formattable",
                    writable: true,
                  },
                  customField86: {
                    location: "payload",
                    name: "Blocker Follow-Up Owner",
                    type: "String",
                    writable: true,
                  },
                  customField87: {
                    location: "payload",
                    name: "Blocker Review Date",
                    type: "Date",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/64"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField84: { title: "workaround" },
                status: { title: "blocked" },
                type: { title: "Task" },
              },
              customField80: "Current blocker workflow still depends on the platform-side runner.",
              customField81: "Execution proof cannot continue until the blocker workflow is broker-owned.",
              customField82: "mfshaf7",
              customField83: "2026-04-21",
              customField85: "Lift the existing blocker semantics behind the broker before continuing.",
              customField86: "mfshaf7",
              customField87: "2026-04-24",
              id: 64,
              subject: "Enabler: Brokerize delivery blocker management",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryBlocker({
    action: "set",
    blockerDecisionPath: "workaround",
    blockerDiscoveredOn: "2026-04-21",
    blockerFollowUpOwner: "mfshaf7",
    blockerImpact: "Execution proof cannot continue until the blocker workflow is broker-owned.",
    blockerJustification: "Lift the existing blocker semantics behind the broker before continuing.",
    blockerOwner: "mfshaf7",
    blockerReviewDate: "2026-04-24",
    blockerStatement: "Current blocker workflow still depends on the platform-side runner.",
    recordId: 64,
  });

  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[2].options.method, "PATCH");
  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 7);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/3");
  assert.equal(patchPayload._links.customField84.href, "/api/v3/custom_options/2");
  assert.equal(
    patchPayload.customField80,
    "Current blocker workflow still depends on the platform-side runner.",
  );
  assert.equal(result.actionApplied, "set");
  assert.equal(result.workItem.status, "blocked");
  assert.equal(result.blocker.decision_path, "workaround");
  assert.equal(result.blocker.review_date, "2026-04-24");
});

test("manageDeliveryBlocker clears blocker fields and resumes a non-blocked status", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/64"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField84: { title: "workaround" },
                status: { title: "blocked" },
                type: { title: "Task" },
              },
              customField80: "Current blocker workflow still depends on the platform-side runner.",
              customField81: "Execution proof cannot continue until the blocker workflow is broker-owned.",
              customField82: "mfshaf7",
              customField83: "2026-04-21",
              customField85: "Lift the existing blocker semantics behind the broker before continuing.",
              customField86: "mfshaf7",
              customField87: "2026-04-24",
              id: 64,
              lockVersion: 8,
              subject: "Enabler: Brokerize delivery blocker management",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/64/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                        { href: "/api/v3/statuses/3", title: "blocked" },
                      ],
                    },
                  },
                  customField80: {
                    location: "payload",
                    name: "Blocker Statement",
                    type: "String",
                    writable: true,
                  },
                  customField81: {
                    location: "payload",
                    name: "Blocker Impact",
                    type: "Formattable",
                    writable: true,
                  },
                  customField82: {
                    location: "payload",
                    name: "Blocker Owner",
                    type: "String",
                    writable: true,
                  },
                  customField83: {
                    location: "payload",
                    name: "Blocker Discovered On",
                    type: "Date",
                    writable: true,
                  },
                  customField84: {
                    location: "_links",
                    name: "Blocker Decision Path",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "remove" },
                        { href: "/api/v3/custom_options/2", title: "workaround" },
                      ],
                    },
                  },
                  customField85: {
                    location: "payload",
                    name: "Blocker Justification",
                    type: "Formattable",
                    writable: true,
                  },
                  customField86: {
                    location: "payload",
                    name: "Blocker Follow-Up Owner",
                    type: "String",
                    writable: true,
                  },
                  customField87: {
                    location: "payload",
                    name: "Blocker Review Date",
                    type: "Date",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/64"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Task" },
              },
              customField80: null,
              customField81: null,
              customField82: null,
              customField83: null,
              customField85: null,
              customField86: null,
              customField87: null,
              id: 64,
              subject: "Enabler: Brokerize delivery blocker management",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryBlocker({
    action: "clear",
    recordId: 64,
    resumeStatus: "in-progress",
  });

  const patchPayload = JSON.parse(calls[2].options.body);
  assert.equal(patchPayload.lockVersion, 8);
  assert.equal(patchPayload._links.status.href, "/api/v3/statuses/2");
  assert.deepEqual(patchPayload._links.customField84, { href: null, title: null });
  assert.equal(patchPayload.customField80, null);
  assert.equal(result.actionApplied, "clear");
  assert.equal(result.workItem.status, "in-progress");
  assert.equal(result.blocker.statement, null);
  assert.equal(result.blocker.decision_path, null);
});

test("manageDeliveryBlocker rejects resume statuses outside active execution posture", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/64"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField84: { title: "workaround" },
                status: { title: "blocked" },
                type: { title: "Task" },
              },
              customField80: "Current blocker workflow still depends on the platform-side runner.",
              customField81: "Execution proof cannot continue until the blocker workflow is broker-owned.",
              customField82: "mfshaf7",
              customField83: "2026-04-21",
              customField85: "Lift the existing blocker semantics behind the broker before continuing.",
              customField86: "mfshaf7",
              customField87: "2026-04-24",
              id: 64,
              lockVersion: 8,
              subject: "Enabler: Brokerize delivery blocker management",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/64/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                        { href: "/api/v3/statuses/4", title: "done" },
                      ],
                    },
                  },
                  customField80: {
                    location: "payload",
                    name: "Blocker Statement",
                    type: "String",
                    writable: true,
                  },
                  customField81: {
                    location: "payload",
                    name: "Blocker Impact",
                    type: "Formattable",
                    writable: true,
                  },
                  customField82: {
                    location: "payload",
                    name: "Blocker Owner",
                    type: "String",
                    writable: true,
                  },
                  customField83: {
                    location: "payload",
                    name: "Blocker Discovered On",
                    type: "Date",
                    writable: true,
                  },
                  customField84: {
                    location: "_links",
                    name: "Blocker Decision Path",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "remove" },
                        { href: "/api/v3/custom_options/2", title: "workaround" },
                      ],
                    },
                  },
                  customField85: {
                    location: "payload",
                    name: "Blocker Justification",
                    type: "Formattable",
                    writable: true,
                  },
                  customField86: {
                    location: "payload",
                    name: "Blocker Follow-Up Owner",
                    type: "String",
                    writable: true,
                  },
                  customField87: {
                    location: "payload",
                    name: "Blocker Review Date",
                    type: "Date",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.manageDeliveryBlocker({
        action: "clear",
        recordId: 64,
        resumeStatus: "done",
      }),
    (error) =>
      error?.name === "OpenProjectError" &&
      error.errorClass === "validation_failure" &&
      error.details === "invalid_resume_status" &&
      error.message.includes("resume_status must be one of: new, ready, in-progress"),
  );
});

test("manageDeliveryParking parks a work item, clears blocker fields, and appends a work note", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/66"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "ready" },
                type: { title: "Task" },
                customField31: { title: null },
                customField34: { title: null },
              },
              customField32: null,
              customField33: null,
              customField41: "Temporary blocker statement",
              customField42: "Temporary blocker impact",
              customField43: "mfshaf7",
              customField44: "2026-04-21",
              customField45: "workaround",
              customField46: "Proof must complete first.",
              customField47: "mfshaf7",
              customField48: "2026-04-21",
              description: {
                raw: [
                  "## Purpose",
                  "",
                  "Move delivery parking and resume behind a broker-owned internal API.",
                ].join("\n"),
              },
              id: 66,
              lockVersion: 3,
              subject: "Enabler: Brokerize delivery parking and resume",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/66/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/10", title: "ready" },
                        { href: "/api/v3/statuses/11", title: "parked" },
                        { href: "/api/v3/statuses/12", title: "retired" },
                      ],
                    },
                  },
                  customField31: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "defer" },
                        { href: "/api/v3/custom_options/2", title: "retire" },
                      ],
                    },
                    fieldFormat: "list",
                    location: "_links",
                    name: "Parking Decision",
                  },
                  customField32: {
                    fieldFormat: "string",
                    name: "Parking Reason",
                  },
                  customField33: {
                    fieldFormat: "date",
                    name: "Parking Review Date",
                  },
                  customField34: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3", title: "superseded" },
                        { href: "/api/v3/custom_options/4", title: "duplicate" },
                      ],
                    },
                    fieldFormat: "list",
                    location: "_links",
                    name: "Retirement Reason",
                  },
                  customField41: { fieldFormat: "string", name: "Blocker Statement" },
                  customField42: { fieldFormat: "string", name: "Blocker Impact" },
                  customField43: { fieldFormat: "string", name: "Blocker Owner" },
                  customField44: { fieldFormat: "date", name: "Blocker Discovered On" },
                  customField45: { fieldFormat: "string", name: "Blocker Decision Path" },
                  customField46: { fieldFormat: "string", name: "Blocker Justification" },
                  customField47: { fieldFormat: "string", name: "Blocker Follow-Up Owner" },
                  customField48: { fieldFormat: "date", name: "Blocker Review Date" },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/66"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "parked" },
                type: { title: "Task" },
                customField31: { title: "defer" },
                customField34: { title: null },
              },
              customField32: "Hold this task outside active scope until the next slice starts.",
              customField33: "2026-05-01",
              customField41: null,
              customField42: null,
              customField43: null,
              customField44: null,
              customField45: null,
              customField46: null,
              customField47: null,
              customField48: null,
              description: {
                raw: [
                  "## Purpose",
                  "",
                  "Move delivery parking and resume behind a broker-owned internal API.",
                  "",
                  "## Operator work notes",
                  "",
                  "- 2026-04-21T00:00:00.000Z codex-local: Parking proof is running through the broker route.",
                ].join("\n"),
              },
              id: 66,
              subject: "Enabler: Brokerize delivery parking and resume",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryParking({
    action: "park",
    parkDecision: "defer",
    parkReason: "Hold this task outside active scope until the next slice starts.",
    parkReviewDate: "2026-05-01",
    recordId: 66,
    workNote: "Parking proof is running through the broker route.",
    workNoteAuthor: "codex-local",
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/66",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload._links.status.title, "parked");
  assert.equal(patchPayload._links.customField31.title, "defer");
  assert.equal(
    patchPayload.customField32,
    "Hold this task outside active scope until the next slice starts.",
  );
  assert.equal(patchPayload.customField33, "2026-05-01");
  assert.equal(patchPayload.customField41, null);
  assert.match(patchPayload.description.raw, /## Operator work notes/);
  assert.equal(result.actionApplied, "park");
  assert.equal(result.parking.decision, "defer");
  assert.equal(result.parking.review_date, "2026-05-01");
  assert.equal(result.noteApplied, "description_section");
  assert.deepEqual(result.changesApplied.blocker_fields_cleared, [
    "statement",
    "impact",
    "owner",
    "discovered_on",
    "decision_path",
    "justification",
    "follow_up_owner",
    "review_date",
  ]);
  assert.equal(result.workItem.status, "parked");
});

test("manageDeliveryParking resumes an inactive work item and clears parking fields", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/66"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "retired" },
                type: { title: "Task" },
                customField31: { title: "retire" },
                customField34: { title: "superseded" },
              },
              customField32: "Superseded by the broker-owned route.",
              customField33: "2026-05-01",
              description: {
                raw: [
                  "## Purpose",
                  "",
                  "Move delivery parking and resume behind a broker-owned internal API.",
                ].join("\n"),
              },
              id: 66,
              lockVersion: 4,
              subject: "Enabler: Brokerize delivery parking and resume",
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/66/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/10", title: "ready" },
                        { href: "/api/v3/statuses/11", title: "parked" },
                        { href: "/api/v3/statuses/12", title: "retired" },
                      ],
                    },
                  },
                  customField31: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/1", title: "defer" },
                        { href: "/api/v3/custom_options/2", title: "retire" },
                      ],
                    },
                    fieldFormat: "list",
                    location: "_links",
                    name: "Parking Decision",
                  },
                  customField32: {
                    fieldFormat: "string",
                    name: "Parking Reason",
                  },
                  customField33: {
                    fieldFormat: "date",
                    name: "Parking Review Date",
                  },
                  customField34: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3", title: "superseded" },
                        { href: "/api/v3/custom_options/4", title: "duplicate" },
                      ],
                    },
                    fieldFormat: "list",
                    location: "_links",
                    name: "Retirement Reason",
                  },
                  customField41: { fieldFormat: "string", name: "Blocker Statement" },
                  customField42: { fieldFormat: "string", name: "Blocker Impact" },
                  customField43: { fieldFormat: "string", name: "Blocker Owner" },
                  customField44: { fieldFormat: "date", name: "Blocker Discovered On" },
                  customField45: { fieldFormat: "string", name: "Blocker Decision Path" },
                  customField46: { fieldFormat: "string", name: "Blocker Justification" },
                  customField47: { fieldFormat: "string", name: "Blocker Follow-Up Owner" },
                  customField48: { fieldFormat: "date", name: "Blocker Review Date" },
                },
              },
            }),
        };
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/work_packages/66"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "ready" },
                type: { title: "Task" },
                customField31: { title: null },
                customField34: { title: null },
              },
              customField32: null,
              customField33: null,
              id: 66,
              subject: "Enabler: Brokerize delivery parking and resume",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryParking({
    action: "resume",
    recordId: 66,
    resumeStatus: "ready",
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/66",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload._links.status.title, "ready");
  assert.deepEqual(patchPayload._links.customField31, { href: null, title: null });
  assert.equal(patchPayload.customField32, null);
  assert.equal(patchPayload.customField33, null);
  assert.deepEqual(patchPayload._links.customField34, { href: null, title: null });
  assert.equal(result.actionApplied, "resume");
  assert.equal(result.parking.decision, null);
  assert.equal(result.parking.reason, null);
  assert.equal(result.parking.review_date, null);
  assert.equal(result.parking.retirement_reason, null);
  assert.equal(result.workItem.status, "ready");
});

test("manageDeliveryDependency updates an existing relation and removes duplicate links", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/70"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "new" },
                type: { title: "Task" },
              },
              id: 70,
              lockVersion: 6,
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/67"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              id: 67,
              lockVersion: 1,
              subject: "Enabler: Brokerize delivery initiative governance update",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Productize governed local-agent platform",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 61,
                    subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "Task" },
                    },
                    id: 67,
                    subject: "Enabler: Brokerize delivery initiative governance update",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "new" },
                      type: { title: "Task" },
                    },
                    id: 70,
                    subject: "Enabler: Brokerize delivery plan apply and reconciliation",
                  },
                ],
              },
              count: 4,
              offset: 1,
              pageSize: 100,
              total: 4,
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
        const filters = JSON.parse(parsedUrl.searchParams.get("filters") ?? "[]");
        const involvedId = filters[0]?.involved?.values?.[0] ?? null;

        if (involvedId === "70") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                count: 2,
                offset: 1,
                pageSize: 100,
                total: 2,
                _embedded: {
                  elements: [
                    {
                      _links: {
                        from: { href: "/api/v3/work_packages/67" },
                        to: { href: "/api/v3/work_packages/70" },
                      },
                      description: "Old dependency description.",
                      id: 12,
                      lag: 1,
                      relationType: "follows",
                    },
                    {
                      _links: {
                        from: { href: "/api/v3/work_packages/67" },
                        to: { href: "/api/v3/work_packages/70" },
                      },
                      description: "Duplicate dependency row.",
                      id: 13,
                      lag: 1,
                      relationType: "follows",
                    },
                  ],
                },
              }),
          };
        }
      }

      if (
        options.method === "PATCH" &&
        parsedUrl.pathname === "/api/v3/relations/12"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                from: { href: "/api/v3/work_packages/67" },
                to: { href: "/api/v3/work_packages/70" },
              },
              description: "Dependency proof through the broker route.",
              id: 12,
              lag: 2,
              relationType: "follows",
            }),
        };
      }

      if (
        options.method === "DELETE" &&
        parsedUrl.pathname === "/api/v3/relations/13"
      ) {
        return {
          ok: true,
          status: 204,
          text: async () => "",
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryDependency({
    action: "set",
    dependsOnRecordId: 67,
    description: "Dependency proof through the broker route.",
    lag: 2,
    recordId: 70,
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/relations/12",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload.lag, 2);
  assert.equal(patchPayload.description, "Dependency proof through the broker route.");
  assert.equal(result.actionApplied, "set");
  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.deepEqual(result.removedDuplicateRelationIds, [13]);
  assert.equal(result.relation.depends_on.id, 67);
  assert.equal(result.relation.target.id, 70);
});

test("manageDeliveryDependency creates a predecessor-scoped relation for a new dependency", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/70"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "new" },
                type: { title: "Task" },
              },
              id: 70,
              lockVersion: 6,
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/67"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              id: 67,
              lockVersion: 1,
              subject: "Enabler: Brokerize delivery initiative governance update",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Productize governed local-agent platform",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 61,
                    subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "Task" },
                    },
                    id: 67,
                    subject: "Enabler: Brokerize delivery initiative governance update",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "new" },
                      type: { title: "Task" },
                    },
                    id: 70,
                    subject: "Enabler: Brokerize delivery plan apply and reconciliation",
                  },
                ],
              },
              count: 4,
              offset: 1,
              pageSize: 100,
              total: 4,
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
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

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/67/relations"
      ) {
        return {
          ok: true,
          status: 201,
          text: async () =>
            JSON.stringify({
              _links: {
                from: { href: "/api/v3/work_packages/67" },
                to: { href: "/api/v3/work_packages/70" },
              },
              description: "Dependency proof through the broker route.",
              id: 14,
              lag: 3,
              relationType: "follows",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryDependency({
    action: "set",
    dependsOnRecordId: 67,
    description: "Dependency proof through the broker route.",
    lag: 3,
    recordId: 70,
  });

  const createCall = calls.find(
    (call) =>
      call.options.method === "POST" &&
      new URL(call.url).pathname === "/api/v3/work_packages/67/relations",
  );
  assert.ok(createCall);
  assert.deepEqual(JSON.parse(createCall.options.body), {
    _links: {
      to: {
        href: "/api/v3/work_packages/70",
      },
    },
    description: "Dependency proof through the broker route.",
    lag: 3,
    type: "follows",
  });
  assert.equal(result.actionApplied, "set");
  assert.equal(result.created, true);
  assert.equal(result.updated, false);
  assert.equal(result.relation.depends_on.id, 67);
  assert.equal(result.relation.target.id, 70);
});

test("manageDeliveryDependency clears all matching dependency relations", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/70"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "new" },
                type: { title: "Task" },
              },
              id: 70,
              lockVersion: 6,
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/67"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              id: 67,
              lockVersion: 1,
              subject: "Enabler: Brokerize delivery initiative governance update",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Productize governed local-agent platform",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 61,
                    subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "Task" },
                    },
                    id: 67,
                    subject: "Enabler: Brokerize delivery initiative governance update",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "new" },
                      type: { title: "Task" },
                    },
                    id: 70,
                    subject: "Enabler: Brokerize delivery plan apply and reconciliation",
                  },
                ],
              },
              count: 4,
              offset: 1,
              pageSize: 100,
              total: 4,
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
        const filters = JSON.parse(parsedUrl.searchParams.get("filters") ?? "[]");
        const involvedId = filters[0]?.involved?.values?.[0] ?? null;

        if (involvedId === "70") {
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
                        from: { href: "/api/v3/work_packages/67" },
                        to: { href: "/api/v3/work_packages/70" },
                      },
                      description: "Dependency proof through the broker route.",
                      id: 12,
                      lag: 2,
                      relationType: "follows",
                    },
                  ],
                },
              }),
          };
        }
      }

      if (
        options.method === "DELETE" &&
        parsedUrl.pathname === "/api/v3/relations/12"
      ) {
        return {
          ok: true,
          status: 204,
          text: async () => "",
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.manageDeliveryDependency({
    action: "clear",
    dependsOnRecordId: 67,
    recordId: 70,
  });

  assert.equal(result.actionApplied, "clear");
  assert.equal(result.removedCount, 1);
  assert.deepEqual(result.removedRelationIds, [12]);
  assert.equal(result.relation.depends_on.id, 67);
  assert.equal(result.relation.target.id, 70);
});

test("moveDeliveryWorkItem rejects cross-initiative moves", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/63"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "ready" },
                type: { title: "User story" },
              },
              id: 63,
              lockVersion: 4,
              subject: "Enabler: Brokerize delivery work-item move",
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/work_packages/95"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/90" },
                status: { title: "ready" },
                type: { title: "Feature" },
              },
              customField14: "PI-2026-03",
              id: 95,
              lockVersion: 1,
              subject: "Enabler: Different initiative feature",
            }),
        };
      }

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
                    _links: { status: { title: "in-progress" }, type: { title: "Epic" } },
                    id: 38,
                    subject: "Initiative A",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 61,
                    subject: "Feature A",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "User story" },
                    },
                    id: 63,
                    subject: "Task A",
                  },
                  {
                    _links: { status: { title: "in-progress" }, type: { title: "Epic" } },
                    id: 90,
                    subject: "Initiative B",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/90" },
                      status: { title: "ready" },
                      type: { title: "Feature" },
                    },
                    customField14: "PI-2026-03",
                    id: 95,
                    subject: "Feature B",
                  },
                ],
              },
              count: 5,
              offset: 1,
              pageSize: 100,
              total: 5,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.moveDeliveryWorkItem({
        newParentRecordId: 95,
        recordId: 63,
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "cross_initiative_move_not_allowed",
  );
});

test("updateDeliveryInitiative writes the top-level Epic target PI and initiative fields", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "new" },
                type: { title: "Epic" },
              },
              customField13: "Initiating",
              customField14: "PI-2026-01",
              description: {
                raw: "Old initiative description.",
              },
              id: 38,
              lockVersion: 7,
              subject: "Brokerize delivery initiative governance update",
              updatedAt: "2026-04-22T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/38/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Initiating" },
                        { href: "/api/v3/custom_options/2", title: "Implementing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField21: { fieldFormat: "string", name: "Sponsor" },
                  customField22: { fieldFormat: "text", name: "Business Objective" },
                  customField23: { fieldFormat: "text", name: "Success Criteria" },
                  customField24: { fieldFormat: "text", name: "System Demo Evidence" },
                  customField25: { fieldFormat: "text", name: "Inspect & Adapt Actions" },
                  customField26: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3", title: "Architecture" },
                      ],
                    },
                    location: "_links",
                    name: "NFR Category",
                    writable: true,
                  },
                  customField27: {
                    fieldFormat: "string",
                    name: "Owner Repo",
                    writable: true,
                  },
                  assignee: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/6",
                          title: "Platform Engineering",
                        },
                      ],
                    },
                  },
                  responsible: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/6",
                          title: "Platform Engineering",
                        },
                      ],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "new" },
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Platform Engineering" },
                responsible: { title: "Platform Engineering" },
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: { title: "Implementing" },
              customField14: "PI-2026-02",
              customField27: "platform-engineering",
              description: {
                raw: "Top-level delivery initiative.",
              },
              id: 38,
              lockVersion: 8,
              subject: "Brokerize delivery initiative governance update",
              updatedAt: "2026-04-22T01:00:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryInitiative({
    assigneeLogin: "Platform Engineering",
    businessObjective: "Clarify the brokered delivery governance boundary.",
    description: "Top-level delivery initiative.",
    nfrCategory: "Architecture",
    ownerRepo: "platform-engineering",
    pm2Phase: "Implementing",
    recordId: 38,
    responsibleLogin: "Platform Engineering",
    sponsor: "OpenClaw",
    status: "in-progress",
    successCriteria: "Keep the initiative fields initiative-only.",
    targetPi: "PI-2026-02",
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/38",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload.customField14, "PI-2026-02");
  assert.equal(patchPayload.customField27, "platform-engineering");
  assert.equal(patchPayload._links.assignee.title, "Platform Engineering");
  assert.equal(patchPayload._links.responsible.title, "Platform Engineering");
  assert.equal(patchPayload._links.status.title, "in-progress");
  assert.equal(result.deliveryInitiative.assignee_login, "Platform Engineering");
  assert.equal(result.deliveryInitiative.owner_repo, "platform-engineering");
  assert.equal(result.deliveryInitiative.responsible_login, "Platform Engineering");
  assert.equal(result.deliveryInitiative.targetPi, "PI-2026-02");
  assert.equal(result.changesApplied.target_pi.to, "PI-2026-02");
  assert.equal(result.changesApplied.ownerRepo.to, "platform-engineering");
});

test("updateDeliveryInitiative allows assignment-only updates when optional initiative fields are absent", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/263") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              description: {
                raw: "Top-level ART taxonomy epic.",
              },
              id: 263,
              lockVersion: 4,
              subject: "Establish machine-readable SAFe-aligned ART taxonomy and fail-closed type governance",
              updatedAt: "2026-04-24T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/263/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  assignee: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/6",
                          title: "Platform Engineering",
                        },
                      ],
                    },
                  },
                  responsible: {
                    _links: {
                      allowedValues: [
                        {
                          href: "/api/v3/users/6",
                          title: "Platform Engineering",
                        },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/263") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                assignee: { title: "Platform Engineering" },
                responsible: { title: "Platform Engineering" },
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              description: {
                raw: "Top-level ART taxonomy epic.",
              },
              id: 263,
              lockVersion: 5,
              subject:
                "Establish machine-readable SAFe-aligned ART taxonomy and fail-closed type governance",
              updatedAt: "2026-04-24T00:05:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryInitiative({
    assigneeLogin: "Platform Engineering",
    recordId: 263,
    responsibleLogin: "Platform Engineering",
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/263",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload._links.assignee.title, "Platform Engineering");
  assert.equal(patchPayload._links.responsible.title, "Platform Engineering");
  assert.equal(result.deliveryInitiative.assignee_login, "Platform Engineering");
  assert.equal(result.deliveryInitiative.responsible_login, "Platform Engineering");
});

test("updateDeliveryInitiative rejects PM² Closing without system demo and clean execution state", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: "Executing",
              description: {
                raw: "## What This Initiative Achieves\n\nGovern the initiative closeout path.",
              },
              id: 38,
              lockVersion: 7,
              subject: "Govern PM² initiative review and closing workflow",
              updatedAt: "2026-04-25T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/38/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    customField13: "Executing",
                    customField24: "",
                    customField25: "",
                    description: {
                      raw: "## What This Initiative Achieves\n\nGovern the initiative closeout path.",
                    },
                    id: 38,
                    subject: "Govern PM² initiative review and closing workflow",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Task" },
                    },
                    description: {
                      raw: "## What This Achieves\n\nFinish the remaining closeout task.",
                    },
                    id: 39,
                    subject: "Task: Finish the remaining closeout task",
                  },
                ],
              },
              count: 2,
              offset: 1,
              pageSize: 100,
              total: 2,
            }),
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  type: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/types/1", title: "Feature" },
                        { href: "/api/v3/types/2", title: "Milestone" },
                        { href: "/api/v3/types/3", title: "PI Objective" },
                        { href: "/api/v3/types/4", title: "Risk" },
                        { href: "/api/v3/types/5", title: "User story" },
                        { href: "/api/v3/types/6", title: "Defect" },
                        { href: "/api/v3/types/7", title: "Task" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/relations"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryInitiative({
        pm2Phase: "Closing",
        recordId: 38,
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "initiative_closing_transition_blocked",
  );
});

test("updateDeliveryInitiative rejects done when inspect-and-adapt and Closing are missing", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: "Executing",
              customField24: "### 2026-04-25\n- Outcome: PASS\n- Summary: Demo recorded\n- Evidence: Demo proof",
              description: {
                raw: "## What This Initiative Achieves\n\nGovern the initiative closeout path.",
              },
              id: 38,
              lockVersion: 7,
              subject: "Govern PM² initiative review and closing workflow",
              updatedAt: "2026-04-25T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/38/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "in-progress" },
                        { href: "/api/v3/statuses/2", title: "done" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    customField13: "Executing",
                    customField24: "### 2026-04-25\n- Outcome: PASS\n- Summary: Demo recorded\n- Evidence: Demo proof",
                    customField25: "",
                    description: {
                      raw: "## What This Initiative Achieves\n\nGovern the initiative closeout path.",
                    },
                    id: 38,
                    subject: "Govern PM² initiative review and closing workflow",
                  },
                ],
              },
              count: 1,
              offset: 1,
              pageSize: 100,
              total: 1,
            }),
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  type: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/types/1", title: "Feature" },
                        { href: "/api/v3/types/2", title: "Milestone" },
                        { href: "/api/v3/types/3", title: "PI Objective" },
                        { href: "/api/v3/types/4", title: "Risk" },
                        { href: "/api/v3/types/5", title: "User story" },
                        { href: "/api/v3/types/6", title: "Defect" },
                        { href: "/api/v3/types/7", title: "Task" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (
        options.method === "GET" &&
        parsedUrl.pathname === "/api/v3/relations"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryInitiative({
        recordId: 38,
        status: "done",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "initiative_done_transition_blocked",
  );
});

test("updateDeliveryInitiative rejects retired when open descendants remain", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: "Executing",
              customField24: "",
              customField25: "",
              description: {
                raw: "## What This Initiative Achieves\n\nRetire the initiative only after the subtree is terminal.",
              },
              id: 38,
              lockVersion: 7,
              subject: "Govern PM² initiative review and closing workflow",
              updatedAt: "2026-04-25T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/38/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "in-progress" },
                        { href: "/api/v3/statuses/3", title: "retired" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    customField13: "Executing",
                    customField24: "",
                    customField25: "",
                    description: {
                      raw: "## What This Initiative Achieves\n\nRetire the initiative only after the subtree is terminal.",
                    },
                    id: 38,
                    subject: "Govern PM² initiative review and closing workflow",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "ready" },
                      type: { title: "User story" },
                    },
                    description: {
                      raw: "## What This Achieves\n\nThis child story is still open.",
                    },
                    id: 40,
                    subject: "User story: Open child still active",
                  },
                ],
              },
              count: 2,
              offset: 1,
              pageSize: 100,
              total: 2,
            }),
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
                        { href: "/api/v3/custom_options/1", title: "Executing" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  type: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/types/1", title: "Feature" },
                        { href: "/api/v3/types/2", title: "Milestone" },
                        { href: "/api/v3/types/3", title: "PI Objective" },
                        { href: "/api/v3/types/4", title: "Risk" },
                        { href: "/api/v3/types/5", title: "User story" },
                        { href: "/api/v3/types/6", title: "Defect" },
                        { href: "/api/v3/types/7", title: "Task" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryInitiative({
        recordId: 38,
        status: "retired",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "initiative_retired_transition_blocked",
  );
});

test("updateDeliveryInitiative clears PM² phase when retiring an initiative", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/220") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                customField13: { title: "Initiating" },
                status: { title: "retired" },
                type: { title: "Epic" },
              },
              customField13: "Initiating",
              customField24: "",
              customField25: "",
              description: {
                raw: "## Scope Boundaries\n\nLegacy smoke artifact.\n\n## Execution Context\n\n- Owner repo: `platform-engineering`",
              },
              id: 220,
              lockVersion: 4,
              subject: "Accepted idea delivery devint smoke",
              updatedAt: "2026-04-25T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/220/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Initiating" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "retired" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

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
                      customField13: { title: "Initiating" },
                      status: { title: "retired" },
                      type: { title: "Epic" },
                    },
                    customField13: "Initiating",
                    customField24: "",
                    customField25: "",
                    description: {
                      raw: "## Scope Boundaries\n\nLegacy smoke artifact.\n\n## Execution Context\n\n- Owner repo: `platform-engineering`",
                    },
                    id: 220,
                    subject: "Accepted idea delivery devint smoke",
                  },
                ],
              },
              count: 1,
              offset: 1,
              pageSize: 100,
              total: 1,
            }),
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
                        { href: "/api/v3/custom_options/1", title: "Initiating" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  type: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/types/1", title: "Feature" },
                        { href: "/api/v3/types/2", title: "Milestone" },
                        { href: "/api/v3/types/3", title: "PI Objective" },
                        { href: "/api/v3/types/4", title: "Risk" },
                        { href: "/api/v3/types/5", title: "User story" },
                        { href: "/api/v3/types/6", title: "Defect" },
                        { href: "/api/v3/types/7", title: "Task" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/relations") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: { elements: [] },
              count: 0,
              offset: 1,
              pageSize: 100,
              total: 0,
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/220") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "retired" },
                type: { title: "Epic" },
              },
              customField13: null,
              customField24: "",
              customField25: "",
              description: {
                raw: "## Scope Boundaries\n\nLegacy smoke artifact.\n\n## Execution Context\n\n- Owner repo: `platform-engineering`",
              },
              id: 220,
              lockVersion: 5,
              subject: "Accepted idea delivery devint smoke",
              updatedAt: "2026-04-25T00:05:00Z",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.updateDeliveryInitiative({
    recordId: 220,
    status: "retired",
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/220",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.deepEqual(patchPayload._links.customField13, { href: null, title: null });
  assert.equal(result.deliveryInitiative.pm2Phase, null);
  assert.equal(result.deliveryInitiative.status, "retired");
});

test("updateDeliveryInitiative rejects explicit PM² phase when retiring an initiative", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/220") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "retired" },
                type: { title: "Epic" },
              },
              customField13: "Initiating",
              customField24: "",
              customField25: "",
              description: {
                raw: "## Scope Boundaries\n\nLegacy smoke artifact.\n\n## Execution Context\n\n- Owner repo: `platform-engineering`",
              },
              id: 220,
              lockVersion: 4,
              subject: "Accepted idea delivery devint smoke",
              updatedAt: "2026-04-25T00:00:00Z",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/220/form") {
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
                        { href: "/api/v3/custom_options/1", title: "Initiating" },
                        { href: "/api/v3/custom_options/2", title: "Closing" },
                      ],
                    },
                    location: "_links",
                    name: "PM² Phase",
                    writable: true,
                  },
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    writable: true,
                  },
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    writable: true,
                  },
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/2", title: "retired" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.updateDeliveryInitiative({
        pm2Phase: "Closing",
        recordId: 220,
        status: "retired",
      }),
    (error) =>
      error.errorClass === "validation_failure" &&
      error.details === "initiative_retired_phase_must_clear",
  );
});

test("recordDeliverySystemDemo writes formattable initiative evidence", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: null,
              id: 277,
              lockVersion: 15,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: {
                format: "markdown",
                raw: "### 2026-04-25\n- Outcome: pass\n- Summary: Demo passed.\n- Evidence: Route proved the workflow.\n- Follow-up: Merge after review.",
              },
              id: 277,
              lockVersion: 16,
              subject: "PM² workflow initiative",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.recordDeliverySystemDemo({
    demoDate: "2026-04-25",
    demoEvidence: "Route proved the workflow.",
    demoFollowUp: "Merge after review.",
    demoOutcome: "pass",
    demoSummary: "Demo passed.",
    recordId: 277,
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/277",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload.lockVersion, 15);
  assert.deepEqual(patchPayload.customField24, {
    format: "markdown",
    raw: "### 2026-04-25\n- Outcome: pass\n- Summary: Demo passed.\n- Evidence: Route proved the workflow.\n- Follow-up: Merge after review.",
  });
  assert.equal(result.fieldLength, patchPayload.customField24.raw.length);
});

test("recordDeliverySystemDemo retries one stale lock-version conflict with a refreshed lockVersion", async () => {
  const calls = [];
  let patchAttempts = 0;
  let currentLockVersion = 15;
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: null,
              id: 277,
              lockVersion: currentLockVersion,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        patchAttempts += 1;
        const patchPayload = JSON.parse(options.body);
        if (patchAttempts === 1) {
          assert.equal(patchPayload.lockVersion, 15);
          currentLockVersion = 16;
          return {
            ok: false,
            status: 409,
            text: async () =>
              JSON.stringify({
                errorIdentifier: "urn:openproject-org:api:v3:errors:UpdateConflict",
                message: "Could not update the resource because of conflicting modifications.",
              }),
          };
        }

        assert.equal(patchPayload.lockVersion, 16);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: {
                format: "markdown",
                raw: "### 2026-04-25\n- Outcome: pass\n- Summary: Demo passed.\n- Evidence: Route proved the workflow.\n- Follow-up: Merge after review.",
              },
              id: 277,
              lockVersion: 17,
              subject: "PM² workflow initiative",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.recordDeliverySystemDemo({
    demoDate: "2026-04-25",
    demoEvidence: "Route proved the workflow.",
    demoFollowUp: "Merge after review.",
    demoOutcome: "pass",
    demoSummary: "Demo passed.",
    recordId: 277,
  });

  assert.equal(result.fieldLength > 0, true);
  assert.equal(patchAttempts, 2);
});

test("recordDeliverySystemDemo still fails after the bounded stale lock-version retry", async () => {
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: null,
              id: 277,
              lockVersion: 15,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: false,
          status: 409,
          text: async () =>
            JSON.stringify({
              errorIdentifier: "urn:openproject-org:api:v3:errors:UpdateConflict",
              message: "Could not update the resource because of conflicting modifications.",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  await assert.rejects(
    () =>
      client.recordDeliverySystemDemo({
        demoDate: "2026-04-25",
        demoEvidence: "Route proved the workflow.",
        demoFollowUp: "Merge after review.",
        demoOutcome: "pass",
        demoSummary: "Demo passed.",
        recordId: 277,
      }),
    (error) =>
      error.errorClass === "update_conflict" &&
      String(error.message).includes("conflicting modifications"),
  );
});

test("recordDeliverySystemDemo suppresses duplicate identical entries", async () => {
  const calls = [];
  const existingEntry = [
    "### 2026-04-25",
    "- Outcome: pass",
    "- Summary: Demo passed.",
    "- Evidence: Route proved the workflow.",
    "- Follow-up: Merge after review.",
  ].join("\n");
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField24: {
                format: "markdown",
                raw: existingEntry,
              },
              id: 277,
              lockVersion: 15,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField24: {
                    fieldFormat: "text",
                    name: "System Demo Evidence",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.recordDeliverySystemDemo({
    demoDate: "2026-04-25",
    demoEvidence: "Route proved the workflow.",
    demoFollowUp: "Merge after review.",
    demoOutcome: "pass",
    demoSummary: "Demo passed.",
    recordId: 277,
  });

  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/277",
    ),
    false,
  );
  assert.equal(result.fieldLength, existingEntry.length);
});

test("recordDeliveryInspectAndAdapt writes formattable initiative evidence", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField25: null,
              id: 277,
              lockVersion: 15,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField25: {
                format: "markdown",
                raw: "### 2026-04-25\n- Summary: Keep the PM² path fail-closed.\n- Action Items:\n1. Use the governed closeout path.\n2. Treat stale retired phases as defects.\n- Follow-up: Merge after review.",
              },
              id: 277,
              lockVersion: 16,
              subject: "PM² workflow initiative",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.recordDeliveryInspectAndAdapt({
    actionItems:
      "1. Use the governed closeout path.\n2. Treat stale retired phases as defects.",
    inspectDate: "2026-04-25",
    inspectFollowUp: "Merge after review.",
    inspectSummary: "Keep the PM² path fail-closed.",
    recordId: 277,
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/277",
  );
  assert.ok(patchCall);
  const patchPayload = JSON.parse(patchCall.options.body);
  assert.equal(patchPayload.lockVersion, 15);
  assert.deepEqual(patchPayload.customField25, {
    format: "markdown",
    raw: "### 2026-04-25\n- Summary: Keep the PM² path fail-closed.\n- Action Items:\n1. Use the governed closeout path.\n2. Treat stale retired phases as defects.\n- Follow-up: Merge after review.",
  });
  assert.equal(result.fieldLength, patchPayload.customField25.raw.length);
});

test("recordDeliveryInspectAndAdapt suppresses duplicate identical entries", async () => {
  const calls = [];
  const existingEntry = [
    "### 2026-04-25",
    "- Summary: Keep the PM² path fail-closed.",
    "- Action Items:",
    "1. Use the governed closeout path.",
    "2. Treat stale retired phases as defects.",
    "- Follow-up: Merge after review.",
  ].join("\n");
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/277") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField25: {
                format: "markdown",
                raw: existingEntry,
              },
              id: 277,
              lockVersion: 15,
              subject: "PM² workflow initiative",
            }),
        };
      }

      if (options.method === "POST" && parsedUrl.pathname === "/api/v3/work_packages/277/form") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField25: {
                    fieldFormat: "text",
                    name: "Inspect & Adapt Actions",
                    type: "Formattable",
                    writable: true,
                  },
                },
              },
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.recordDeliveryInspectAndAdapt({
    actionItems:
      "1. Use the governed closeout path.\n2. Treat stale retired phases as defects.",
    inspectDate: "2026-04-25",
    inspectFollowUp: "Merge after review.",
    inspectSummary: "Keep the PM² path fail-closed.",
    recordId: 277,
  });

  assert.equal(
    calls.some(
      ({ url, options }) =>
        options.method === "PATCH" && new URL(url).pathname === "/api/v3/work_packages/277",
    ),
    false,
  );
  assert.equal(result.fieldLength, existingEntry.length);
});

test("applyDeliveryPlan reuses existing nodes and updates a matching child", async () => {
  const calls = [];
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: "Initiating",
              customField14: "PI-2026-01",
              id: 38,
              lockVersion: 9,
              subject: "Productize governed local-agent platform",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Productize governed local-agent platform",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "in-progress" },
                      type: { title: "Feature" },
                    },
                    id: 61,
                    lockVersion: 5,
                    customField36: "Enabler",
                    subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "new" },
                      type: { title: "Feature" },
                    },
                    id: 72,
                    lockVersion: 2,
                    subject: "Disposable ART scope placeholder",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "ready" },
                      type: { title: "User story" },
                    },
                    id: 67,
                    lockVersion: 4,
                    customField36: "Enabler",
                    subject: "Enabler: Brokerize delivery initiative governance update",
                  },
                  {
                    _links: {
                      parent: { href: "/api/v3/work_packages/61" },
                      status: { title: "new" },
                      type: { title: "User story" },
                    },
                    id: 70,
                    lockVersion: 3,
                    customField36: "Enabler",
                    subject: "Enabler: Brokerize delivery plan apply and reconciliation",
                  },
                ],
              },
              count: 5,
              offset: 1,
              pageSize: 100,
              total: 5,
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/61/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "new" },
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                      ],
                    },
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3601", title: "Business" },
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                        { href: "/api/v3/custom_options/3603", title: "Improvement" },
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
        parsedUrl.pathname === "/api/v3/work_packages/67/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "new" },
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                      ],
                    },
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3601", title: "Business" },
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                        { href: "/api/v3/custom_options/3603", title: "Improvement" },
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
        parsedUrl.pathname === "/api/v3/work_packages/70/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  status: {
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/statuses/1", title: "new" },
                        { href: "/api/v3/statuses/2", title: "in-progress" },
                      ],
                    },
                  },
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [
                        { href: "/api/v3/custom_options/3601", title: "Business" },
                        { href: "/api/v3/custom_options/3602", title: "Enabler" },
                        { href: "/api/v3/custom_options/3603", title: "Improvement" },
                      ],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/67") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/61" },
                status: { title: "in-progress" },
                type: { title: "User story" },
              },
              id: 67,
              lockVersion: 4,
              subject: "Enabler: Brokerize delivery initiative governance update",
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/72") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                parent: { href: "/api/v3/work_packages/38" },
                status: { title: "new" },
                type: { title: "Feature" },
              },
              id: 72,
              lockVersion: 2,
              subject: "Disposable ART scope placeholder",
            }),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.applyDeliveryPlan({
    plan: {
      items: [
        {
          children: [
            {
              executionClassification: "Enabler",
              status: "in-progress",
              subject: "Enabler: Brokerize delivery initiative governance update",
              type: "User story",
            },
            {
              executionClassification: "Enabler",
              status: "new",
              subject: "Enabler: Brokerize delivery plan apply and reconciliation",
              type: "User story",
            },
          ],
          executionClassification: "Enabler",
          subject: "Enabler: Brokerize core delivery control commands behind internal APIs",
          type: "Feature",
        },
      ],
      schema_version: 1,
    },
    recordId: 38,
  });

  const patchCall = calls.find(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/67",
  );
  assert.ok(patchCall);
  assert.ok(
    calls.every(
      (call) =>
        !(
          call.options.method === "POST" &&
          new URL(call.url).pathname === "/api/v3/work_packages/72/form"
        ),
    ),
  );
  assert.equal(result.planResult.summary.updated_count, 1);
  assert.equal(result.planResult.summary.reused_count, 2);
  assert.equal(result.planResult.summary.created_count, 0);
  assert.equal(result.planResult.summary.retired_count, 0);
});

test("applyDeliveryPlan defers execution classification when a create form omits it", async () => {
  const calls = [];
  let featureFetchCount = 0;
  let featurePatchCount = 0;
  const client = createOpenProjectClient({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const parsedUrl = new URL(url);

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/38") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _links: {
                status: { title: "in-progress" },
                type: { title: "Epic" },
              },
              customField13: "Planning",
              customField14: "PI-2026-03",
              id: 38,
              lockVersion: 9,
              subject: "Extract the governance engine",
            }),
        };
      }

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
                      status: { title: "in-progress" },
                      type: { title: "Epic" },
                    },
                    id: 38,
                    subject: "Extract the governance engine",
                  },
                ],
              },
              count: 1,
              offset: 1,
              pageSize: 100,
              total: 1,
            }),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/projects/workspace-delivery-art/work_packages/form"
      ) {
        const requestPayload = JSON.parse(options.body ?? "{}");
        const requestedTypeHref = requestPayload?._links?.type?.href ?? null;

        if (!requestedTypeHref) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                _embedded: {
                  schema: {
                    type: {
                      _links: {
                        allowedValues: [{ href: "/api/v3/types/4", title: "Feature" }],
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
              _embedded: {
                payload: {
                  _links: {
                    status: { title: "new" },
                  },
                },
                schema: {
                  customField30: {
                    location: "payload",
                    name: "Owner Repo",
                    type: "String",
                    writable: true,
                  },
                  customField31: {
                    location: "payload",
                    name: "Delivery Team",
                    type: "String",
                    writable: true,
                  },
                  status: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/statuses/1", title: "new" }],
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
                status: { title: "new" },
                type: { title: "Feature" },
              },
              id: 80,
              lockVersion: 1,
              subject: "Enabler: Package the standalone governance engine",
            }),
        };
      }

      if (options.method === "GET" && parsedUrl.pathname === "/api/v3/work_packages/80") {
        featureFetchCount += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify(
              featureFetchCount >= 3
                ? {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "new" },
                      type: { title: "Feature" },
                    },
                    customField30: "workspace-governance",
                    customField31: "Platform Architecture",
                    customField36: "Enabler",
                    id: 80,
                    lockVersion: 4,
                    subject: "Enabler: Package the standalone governance engine",
                  }
                : {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "new" },
                      type: { title: "Feature" },
                    },
                    customField30: "workspace-governance",
                    customField31: "Platform Architecture",
                    id: 80,
                    lockVersion: featureFetchCount === 1 ? 2 : 3,
                    subject: "Enabler: Package the standalone governance engine",
                  },
            ),
        };
      }

      if (
        options.method === "POST" &&
        parsedUrl.pathname === "/api/v3/work_packages/80/form"
      ) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              _embedded: {
                schema: {
                  customField36: {
                    location: "payload",
                    name: "Execution Classification",
                    type: "String",
                    writable: true,
                    _links: {
                      allowedValues: [{ href: "/api/v3/custom_options/3602", title: "Enabler" }],
                    },
                  },
                  status: {
                    _links: {
                      allowedValues: [{ href: "/api/v3/statuses/1", title: "new" }],
                    },
                  },
                },
              },
            }),
        };
      }

      if (options.method === "PATCH" && parsedUrl.pathname === "/api/v3/work_packages/80") {
        featurePatchCount += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify(
              featurePatchCount === 1
                ? {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "new" },
                      type: { title: "Feature" },
                    },
                    customField30: "workspace-governance",
                    customField31: "Platform Architecture",
                    id: 80,
                    lockVersion: 3,
                    subject: "Enabler: Package the standalone governance engine",
                  }
                : {
                    _links: {
                      parent: { href: "/api/v3/work_packages/38" },
                      status: { title: "new" },
                      type: { title: "Feature" },
                    },
                    customField30: "workspace-governance",
                    customField31: "Platform Architecture",
                    customField36: "Enabler",
                    id: 80,
                    lockVersion: 4,
                    subject: "Enabler: Package the standalone governance engine",
                  },
            ),
        };
      }

      throw new Error(`Unexpected request: ${options.method} ${url}`);
    },
  });

  const result = await client.applyDeliveryPlan({
    plan: {
      items: [
        {
          deliveryTeam: "Platform Architecture",
          executionClassification: "Enabler",
          ownerRepo: "workspace-governance",
          subject: "Package the standalone governance engine",
          type: "Feature",
        },
      ],
      schema_version: 1,
    },
    recordId: 38,
  });

  assert.equal(result.planResult.summary.created_count, 1);
  const patchCalls = calls.filter(
    (call) =>
      call.options.method === "PATCH" &&
      new URL(call.url).pathname === "/api/v3/work_packages/80",
  );
  assert.equal(patchCalls.length, 2);
  const deferredPatchPayload = JSON.parse(patchCalls[1].options.body);
  assert.deepEqual(deferredPatchPayload.customField36, {
    href: "/api/v3/custom_options/3602",
    title: "Enabler",
  });
});
