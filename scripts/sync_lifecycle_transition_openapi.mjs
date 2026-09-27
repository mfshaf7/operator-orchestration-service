import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  addConsoleSourceProjectionMedia,
  upsertConsoleCompatibleOpenApiPath,
} from "./console_source_authority_openapi_tools.mjs";
import {
  upsertOpenApiComponent,
  upsertOpenApiPath,
} from "./openapi_component_sync_tools.mjs";

const root = new URL("../", import.meta.url);
const openapiPath = fileURLToPath(new URL("docs/api/openapi.json", root));
const original = readFileSync(openapiPath, "utf8");
let source = original;
const check = process.argv.includes("--check");
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string", minLength: 1, maxLength: 1024 };
const detail = { type: "string", minLength: 1, maxLength: 4096 };
const timestamp = { type: "string", format: "date-time" };
const nullable = (shape) => ({ oneOf: [shape, { type: "null" }] });
const object = (properties, extra = {}) => ({
  type: "object",
  required: Object.keys(properties),
  additionalProperties: false,
  properties,
  ...extra,
});
const references = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: text,
};

function project(value, name) {
  if (Array.isArray(value)) return value.map((entry) => project(entry, name));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["$schema", "$id"].includes(key))
      .map(([key, entry]) => [
        key,
        key === "$ref" && entry.startsWith("#/$defs/")
          ? `#/components/schemas/${name}/${entry.slice(2)}`
          : project(entry, name),
      ]),
  );
}

const projectionSchema = project(
  JSON.parse(readFileSync(
    new URL(
      "contracts/lifecycle-transition/lifecycle-transition-projection.schema.json",
      root,
    ),
    "utf8",
  )),
  "LifecycleTransitionProjection",
);
const routeIds = [
  "proposal-to-delivery",
  "proposal-to-prototype",
  "prototype-to-delivery",
];
const authority = object({
  owner_ref: text,
  role: {
    enum: [
      "decision-authority",
      "orchestration",
      "source-domain",
      "target-adapter",
      "target-domain",
      "validation-authority",
    ],
  },
});
const gate = object({
  evidence_ref: nullable(text),
  gate_id: text,
  owner_ref: text,
  required_fix: nullable(detail),
  state: { enum: ["blocked", "not-required", "passed"] },
});
const decision = object({
  authority_owner_ref: text,
  control_id: text,
  decision: { enum: ["approved", "deferred", "pending"] },
  evidence_type: text,
  justification: nullable(detail),
  receipt_ref: nullable(text),
  recorded_at: nullable(timestamp),
  review_at: nullable(timestamp),
});
const admission = object({
  reason_code: nullable(text),
  receipt_ref: nullable(text),
  recorded_at: timestamp,
  state: { enum: ["admitted", "rejected"] },
  target_record_ref: nullable(text),
});
const eventBase = {
  schema_version: { const: 1 },
  event_id: text,
  expected_sequence: { type: "integer", minimum: 0 },
  authority,
  evidence_refs: { ...references, minItems: 1 },
  recorded_at: timestamp,
};
const eventVariant = (kind, details) => object({
  ...eventBase,
  artifact_kind: { const: kind },
  details,
});
const eventSchema = {
  oneOf: [
    eventVariant("validation-started", object({ run_ref: text })),
    eventVariant("validation-completed", object({
      gates: { type: "array", maxItems: 32, items: gate },
      receipt_ref: nullable(text),
      requires_authority_decision: { type: "boolean" },
      state: { enum: ["passed", "blocked"] },
    })),
    eventVariant("authority-decision-recorded", object({ decision })),
    eventVariant("target-admission-recorded", object({ admission })),
    eventVariant("application-started", object({ run_ref: text })),
    eventVariant("target-application-recorded", object({
      application: object({
        evidence_kind: {
          enum: ["target-admission-receipt", "target-application-receipt"],
        },
        receipt_ref: text,
        resulting_refs: references,
        target_record_ref: text,
      }),
    })),
    eventVariant("application-failed", object({
      failure: object({
        code: text,
        detail,
        retryable: { const: true },
        run_ref: text,
      }),
    })),
    eventVariant("gate-blocked", object({ gate })),
    eventVariant("source-correction-returned", object({
      correction: object({
        owner_ref: text,
        reason_code: text,
        required_fix: detail,
      }),
    })),
    eventVariant("transition-deferred", object({
      deferred: object({
        justification: detail,
        reason_code: text,
        review_at: timestamp,
      }),
    })),
    eventVariant("transition-cancelled", object({ reason_code: text })),
    eventVariant("transition-superseded", object({
      superseding_transition_id: text,
    })),
  ],
};

const schemas = {
  LifecycleTransitionProjection: projectionSchema,
  LifecycleTransitionCreateRequest: object({
    schema_version: { const: 1 },
    route_id: { enum: routeIds },
    correlation_id: text,
    idempotency_key: text,
    requested_by: text,
    source: object({
      owner_ref: { enum: ["proposal", "prototype"] },
      projection_version: text,
      record_id: text,
      source_version: text,
    }),
    reason: object({ code: text, detail }),
    evidence_refs: { ...references, minItems: 1 },
    supersedes_transition_id: nullable(text),
  }),
  LifecycleTransitionEvent: eventSchema,
  LifecycleTransitionMutationResult: object({
    replayed: { type: "boolean" },
    transition: ref("LifecycleTransitionProjection"),
  }),
  LifecycleTransitionList: object({
    schema_version: { const: 1 },
    transitions: {
      type: "array",
      maxItems: 100,
      items: ref("LifecycleTransitionProjection"),
    },
    next_cursor: nullable(text),
  }),
  LifecycleTransitionHistory: object({
    schema_version: { const: 1 },
    transition_id: text,
    entries: {
      type: "array",
      maxItems: 100,
      items: projectionSchema.$defs.historyEntry,
    },
    next_cursor: nullable(text),
  }),
};
for (const [name, schema] of Object.entries(schemas)) {
  source = upsertOpenApiComponent(source, name, schema);
}

const projectionExample = JSON.parse(readFileSync(
  new URL(
    "contracts/lifecycle-transition/prototype-to-delivery.current.valid.json",
    root,
  ),
  "utf8",
));
const createExample = {
  schema_version: 1,
  route_id: "prototype-to-delivery",
  correlation_id: "prototype-governance-console:delivery:1",
  idempotency_key: "prototype-governance-console:delivery:1",
  requested_by: "governance-operations-console",
  source: {
    owner_ref: "prototype",
    projection_version: "1",
    record_id: "prototype:governance-console",
    source_version: "baseline:governance-console:1",
  },
  reason: {
    code: "baseline-approved",
    detail: "Continue governed delivery from the accepted Prototype baseline.",
  },
  evidence_refs: ["prototype-baseline://governance-console/1"],
  supersedes_transition_id: null,
};
const eventExample = {
  schema_version: 1,
  event_id: "validation-started:prototype-governance-console:1",
  expected_sequence: 0,
  artifact_kind: "validation-started",
  authority: {
    owner_ref: "workspace-governance-control-fabric",
    role: "validation-authority",
  },
  evidence_refs: ["wgcf-run://lifecycle-transition/1"],
  recorded_at: "2026-09-27T12:01:00Z",
  details: { run_ref: "wgcf-run://lifecycle-transition/1" },
};
const errorResponses = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 500, 503].map((status) => [
    String(status),
    {
      description:
        "Bounded validation, authorization, conflict, integrity, or dependency failure.",
    },
  ]),
);
const transitionIdParameter = {
  name: "transition_id",
  in: "path",
  required: true,
  schema: text,
};
const callerSecurity = [{ CallerIdHeader: [], CallerSecretHeader: [] }];

source = upsertOpenApiPath(source, "/v1/lifecycle-transitions", {
  post: {
    security: callerSecurity,
    operationId: "createLifecycleTransition",
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "lifecycle-transition-journal",
    "x-oos-workflow-family": "lifecycle-transition",
    tags: ["Lifecycle Transitions"],
    summary: "Acknowledge one deterministic lifecycle transition",
    description:
      "Creates or replays one owner-bound transition journal record for an admitted cross-domain route. It does not execute WGCF validation or a target mutation.",
    requestBody: {
      required: true,
      description: "Bind the immutable route, source revision, reason, requester, correlation, and idempotency identity.",
      content: {
        "application/json": {
          schema: ref("LifecycleTransitionCreateRequest"),
          example: createExample,
        },
      },
    },
    responses: {
      201: {
        description: "Transition acknowledged and durably journaled.",
        content: {
          "application/json": {
            schema: ref("LifecycleTransitionMutationResult"),
            example: { replayed: false, transition: projectionExample },
          },
        },
      },
      200: {
        description: "Byte-equivalent transition request replayed.",
        content: {
          "application/json": {
            schema: ref("LifecycleTransitionMutationResult"),
            example: { replayed: true, transition: projectionExample },
          },
        },
      },
      ...errorResponses,
    },
  },
  get: {
    security: callerSecurity,
    operationId: "listLifecycleTransitions",
    "x-oos-owner": "operator-orchestration-service",
    "x-oos-primary-caller": "governance-operations-console",
    "x-oos-surface": "lifecycle-transition-journal",
    "x-oos-workflow-family": "lifecycle-transition",
    tags: ["Lifecycle Transitions"],
    summary: "List bounded lifecycle transition projections",
    description:
      "Lists current owner-backed journal projections with bounded filters and opaque pagination.",
    parameters: [
      { name: "route_id", in: "query", schema: { enum: routeIds } },
      { name: "source_record_id", in: "query", schema: text },
      {
        name: "state",
        in: "query",
        schema: projectionSchema.$defs.projection.properties.state,
      },
      { name: "cursor", in: "query", schema: text },
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    ],
    responses: {
      200: {
        description: "Bounded transition projection page.",
        content: {
          "application/json": {
            schema: ref("LifecycleTransitionList"),
            example: {
              schema_version: 1,
              transitions: [projectionExample],
              next_cursor: null,
            },
          },
        },
      },
      ...errorResponses,
    },
  },
});

source = upsertConsoleCompatibleOpenApiPath(
  source,
  "/v1/lifecycle-transitions/{transition_id}",
  addConsoleSourceProjectionMedia({
    get: {
      security: callerSecurity,
      operationId: "getLifecycleTransition",
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "lifecycle-transition-journal",
      "x-oos-workflow-family": "lifecycle-transition",
      tags: ["Lifecycle Transitions"],
      summary: "Read one canonical lifecycle transition projection",
      description:
        "Returns the current OOS journal projection with exact next action, owner evidence references, monotonic revision, and freshness.",
      parameters: [transitionIdParameter],
      responses: {
        200: {
          description: "Canonical lifecycle transition projection.",
          content: {
            "application/json": {
              schema: ref("LifecycleTransitionProjection"),
              example: projectionExample,
            },
          },
        },
        ...errorResponses,
      },
    },
  }, "get"),
);

source = upsertOpenApiPath(
  source,
  "/v1/lifecycle-transitions/{transition_id}/events",
  {
    post: {
      security: callerSecurity,
      operationId: "appendLifecycleTransitionEvent",
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "authorized-owner-adapter",
      "x-oos-surface": "lifecycle-transition-journal",
      "x-oos-workflow-family": "lifecycle-transition",
      tags: ["Lifecycle Transitions"],
      summary: "Append one authorized owner event",
      description:
        "Appends one revision-checked owner event. Event identity replay is allowed only for byte-equivalent input; stale order and unauthorized owner roles fail closed.",
      parameters: [transitionIdParameter],
      requestBody: {
        required: true,
        description: "Append one owner-authored event against the exact current journal sequence.",
        content: {
          "application/json": {
            schema: ref("LifecycleTransitionEvent"),
            example: eventExample,
          },
        },
      },
      responses: {
        201: {
          description: "Owner event durably appended.",
          content: {
            "application/json": {
              schema: ref("LifecycleTransitionMutationResult"),
              example: { replayed: false, transition: projectionExample },
            },
          },
        },
        200: {
          description: "Byte-equivalent event replayed.",
          content: {
            "application/json": {
              schema: ref("LifecycleTransitionMutationResult"),
              example: { replayed: true, transition: projectionExample },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
);

source = upsertOpenApiPath(
  source,
  "/v1/lifecycle-transitions/{transition_id}/history",
  {
    get: {
      security: callerSecurity,
      operationId: "getLifecycleTransitionHistory",
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "lifecycle-transition-journal",
      "x-oos-workflow-family": "lifecycle-transition",
      tags: ["Lifecycle Transitions"],
      summary: "Read bounded lifecycle transition history",
      description:
        "Returns ordered owner evidence coordinates without embedding raw artifacts or secrets.",
      parameters: [
        transitionIdParameter,
        { name: "cursor", in: "query", schema: text },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        200: {
          description: "Bounded lifecycle transition history page.",
          content: {
            "application/json": {
              schema: ref("LifecycleTransitionHistory"),
              example: {
                schema_version: 1,
                transition_id: projectionExample.projection.transition_id,
                entries: projectionExample.projection.history.entries,
                next_cursor: null,
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  },
);

if (check) {
  if (source !== original) {
    throw new Error("Lifecycle Transition OpenAPI projection is stale.");
  }
} else {
  writeFileSync(openapiPath, source);
}
console.log(
  `Lifecycle Transition OpenAPI ${check ? "verified" : "synchronized"}.`,
);
