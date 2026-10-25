import { sourceEditorSchemas, mergeSourceEditorPaths } from "./source_editor_openapi_tools.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent } from "./openapi_component_sync_tools.mjs";
import {
  upsertConsoleCompatibleOpenApiPath as upsertOpenApiPath,
} from "./console_source_authority_openapi_tools.mjs";
import {
  deliveryArtArchitectureDraftRequestExample,
} from "./delivery_art_architecture_openapi_example.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const decisionPath = path.join(
  repoRoot,
  "contracts",
  "delivery-art-work-session",
  "decision.schema.json",
);
const lifecycleContextRequestPath = path.join(
  repoRoot,
  "contracts",
  "delivery-art-work-session",
  "lifecycle-context-request.schema.json",
);
const sourceRealizationStartPath = path.join(
  repoRoot,
  "contracts",
  "delivery-art-work-session",
  "source-realization-start.schema.json",
);
const original = readFileSync(openApiPath, "utf8");
let synchronized = original;

const decisionSchema = JSON.parse(readFileSync(decisionPath, "utf8"));
delete decisionSchema.$schema;
delete decisionSchema.$id;
const lifecycleContextRequestSchema = JSON.parse(
  readFileSync(lifecycleContextRequestPath, "utf8"),
);
delete lifecycleContextRequestSchema.$schema;
delete lifecycleContextRequestSchema.$id;
const sourceRealizationStartSchema = JSON.parse(
  readFileSync(sourceRealizationStartPath, "utf8"),
);
delete sourceRealizationStartSchema.$schema;
delete sourceRealizationStartSchema.$id;
delete sourceRealizationStartSchema.$defs;
sourceRealizationStartSchema.properties.request_id = {
  $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1",
};
sourceRealizationStartSchema.properties.execution_id = {
  $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1",
};
sourceRealizationStartSchema.properties.retry_of.oneOf[0] = {
  $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1",
};

const nullableRevision = {
  oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
};
const commandId = {
  type: "string",
  pattern: "^work-session-command:[A-Za-z0-9._:-]+$",
  maxLength: 200,
};
const workItemId = {
  type: "string",
  pattern: "^(?:work-item-)?[1-9][0-9]*$",
};

const sourceAuthorization = {
  type: "object", additionalProperties: false, required: ["intent_ref", "session_id"],
  properties: { intent_ref: { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" },
    session_id: { type: "string", minLength: 1 }, revision: { type: "string", format: "date-time" },
    state: { enum: ["revocation-pending", "revocation-required", "revoked"] }, operation_ref: { type: ["string", "null"] } },
};

const components = {
  ...sourceEditorSchemas,
  DeliveryArtArchitecturePacketDraftDecisionV1: {
    type: "object",
    additionalProperties: false,
    required: ["status", "rationale"],
    properties: {
      status: {
        enum: ["draft", "architecture-ready", "blocked-pending-architecture-decision"],
      },
      rationale: { type: "string", minLength: 1 },
    },
  },
  DeliveryArtArchitecturePacketDraftInputV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "delivery_id",
      "covered_work_item_ids",
      "repo_revisions",
      "architecture",
      "conformance_plan",
      "decision",
    ],
    properties: {
      schema_version: { const: 1 },
      delivery_id: { type: "string", pattern: "^delivery-[1-9][0-9]*$" },
      covered_work_item_ids: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      },
      repo_revisions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["repo", "base_ref", "commit"],
          properties: {
            repo: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
            base_ref: { type: "string", minLength: 1 },
            commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
          },
        },
      },
      architecture: {
        type: "object",
        description: "Complete operator-authored schema-v6 architecture design. This OpenAPI component describes the transport envelope only; OOS validates the full workspace-governance Architecture Packet schema, semantic contract, and live ART topology at runtime.",
        additionalProperties: true,
      },
      conformance_plan: {
        type: "object",
        description: "Complete operator-authored schema-v6 conformance plan. OOS validates it against the canonical workspace-governance Delivery ART contract at runtime.",
        additionalProperties: true,
      },
      decision: {
        $ref: "#/components/schemas/DeliveryArtArchitecturePacketDraftDecisionV1",
      },
    },
  },
  DeliveryArtArchitecturePacketDraftRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["input"],
    properties: {
      input: {
        $ref: "#/components/schemas/DeliveryArtArchitecturePacketDraftInputV1",
      },
    },
  },
  DeliveryArtArchitecturePacketDraftResponseV1: {
    type: "object",
    additionalProperties: false,
    required: ["architecture_packet", "source_snapshot", "workflow_id"],
    properties: {
      architecture_packet: {
        $ref: "#/components/schemas/DeliveryArtCustodyArtifact",
      },
      source_snapshot: {
        type: "object",
        additionalProperties: false,
        required: [
          "art_digest",
          "covered_record_count",
          "dependency_record_count",
          "relation_count",
        ],
        properties: {
          art_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
          covered_record_count: { type: "integer", minimum: 1 },
          dependency_record_count: { type: "integer", minimum: 0 },
          relation_count: { type: "integer", minimum: 0 },
        },
      },
      workflow_id: { const: "delivery-art-architecture-packet-draft" },
    },
  },
  DeliveryArtArchitecturePacketPersistRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["artifact"],
    properties: {
      artifact: { $ref: "#/components/schemas/DeliveryArtCustodyArtifact" },
    },
  },
  DeliveryArtArchitecturePacketPersistResponseV1: {
    type: "object",
    additionalProperties: true,
    required: ["artifact", "custody_receipt", "owner_receipt", "workflow_id"],
    properties: {
      artifact: { $ref: "#/components/schemas/DeliveryArtCustodyArtifact" },
      custody_receipt: { type: "object", additionalProperties: true },
      owner_receipt: { type: "object", additionalProperties: true },
      workflow_id: { const: "delivery-art-architecture-packet-persist" },
    },
  },
  DeliveryArtCurrentArchitectureRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["delivery_id"],
    properties: {
      delivery_id: {
        type: "string",
        pattern: "^delivery-[1-9][0-9]*$",
      },
    },
  },
  DeliveryArtCurrentArchitectureResponseV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "artifact",
      "contract_posture",
      "custody_receipt",
      "projected_reference",
    ],
    properties: {
      artifact: { $ref: "#/components/schemas/DeliveryArtCustodyArtifact" },
      contract_posture: { enum: ["current", "historical-read-only"] },
      custody_receipt: { type: "object", additionalProperties: true },
      projected_reference: { type: "object", additionalProperties: true },
    },
  },
  DeliveryArtWorkSessionDecisionV1: decisionSchema,
  DeliveryArtLifecycleContextRequestV1: lifecycleContextRequestSchema,
  DeliveryArtLifecycleContextRequestEnvelopeV1: {
    type: "object",
    additionalProperties: false,
    required: ["context"],
    properties: {
      context: { $ref: "#/components/schemas/DeliveryArtLifecycleContextRequestV1" },
    },
  },
  DeliveryArtLifecycleContextStatusV1: {
    type: "object",
    additionalProperties: false,
    required: ["commissioned", "default_mode", "latest_binding", "measurements"],
    properties: {
      commissioned: { type: "boolean" },
      default_mode: { const: "packet" },
      latest_binding: { type: ["object", "null"], additionalProperties: true },
      measurements: {
        type: "object",
        additionalProperties: false,
        required: ["packet_count", "raw_fallback_count", "denied_count"],
        properties: {
          packet_count: { type: "integer", minimum: 0 },
          raw_fallback_count: { type: "integer", minimum: 0 },
          denied_count: { type: "integer", minimum: 0 },
        },
      },
    },
  },
  DeliveryArtLifecycleContextResultV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "workflow_id",
      "session_id",
      "mode",
      "replayed",
      "content",
      "binding",
      "measurements",
      "authority",
    ],
    properties: {
      workflow_id: { const: "delivery-art-lifecycle-context" },
      session_id: {
        type: "string",
        pattern: "^work-session:delivery-[1-9][0-9]*:[a-z0-9][a-z0-9._:-]*$",
      },
      mode: { enum: ["packet", "raw-fallback"] },
      replayed: { type: "boolean" },
      content: { type: "string", minLength: 1 },
      binding: { type: "object", additionalProperties: true },
      measurements: {
        $ref: "#/components/schemas/DeliveryArtLifecycleContextStatusV1/properties/measurements",
      },
      classification: { type: "object", additionalProperties: true },
      budget: { type: "object", additionalProperties: true },
      authority: {
        type: "object",
        additionalProperties: false,
        required: [
          "legal_next_action",
          "lifecycle_authority",
          "raw_fallback_explicit",
        ],
        properties: {
          legal_next_action: { type: ["string", "null"] },
          lifecycle_authority: { const: "operator-orchestration-service" },
          raw_fallback_explicit: { type: "boolean" },
        },
      },
    },
  },
  DeliveryArtWorkSessionPreflightRequestV1: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { $ref: "#/components/schemas/DeliveryArtWorkSessionDecisionV1" },
    },
  },
  DeliveryArtWorkSessionStartRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "object",
        additionalProperties: false,
        required: ["command_id", "expected_session_revision"],
        properties: {
          command_id: commandId,
          expected_session_revision: nullableRevision,
          source_intent_ref: { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" },
          decision: { $ref: "#/components/schemas/DeliveryArtWorkSessionDecisionV1" },
        },
      },
    },
  },
  DeliveryArtWorkSessionCommandRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "object",
        additionalProperties: false,
        required: ["command_id", "expected_session_revision"],
        properties: {
          command_id: commandId,
          expected_session_revision: { type: "string", format: "date-time" },
          source_intent_ref: { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" },
        },
      },
    },
  },
  DeliveryArtWorkSessionRecoveryRequestV1: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: {
        type: "object",
        additionalProperties: false,
        required: ["command_id", "expected_session_revision", "recovery"],
        properties: {
          command_id: commandId,
          expected_session_revision: { type: "string", format: "date-time" },
          source_intent_ref: { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" },
          recovery: {
            type: "object",
            additionalProperties: false,
            required: ["session_id", "session_revision", "reason", "pull_request"],
            properties: {
              session_id: { type: "string", pattern: "^work-session:delivery-[1-9][0-9]*:[a-z0-9][a-z0-9._:-]*$" },
              session_revision: { type: "string", format: "date-time" },
              reason: { type: "string", minLength: 20 },
              mode: { enum: ["archive-unmerged", "archive-merged-evidence"] },
              pull_request: {
                oneOf: [
                  { type: "null" },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["url", "head_commit", "merge_commit"],
                    properties: {
                      url: { type: "string", format: "uri", pattern: "^https://" },
                      head_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
                      merge_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
                    },
                  },
                ],
              },
              source: {
                type: "object",
                additionalProperties: false,
                required: ["local_branch_head", "worktree_head"],
                properties: {
                  local_branch_head: { type: "string", pattern: "^[0-9a-f]{40}$" },
                  worktree_head: { type: "string", pattern: "^[0-9a-f]{40}$" },
                },
              },
            },
            oneOf: [
              {
                required: ["pull_request"],
                not: { anyOf: [{ required: ["mode"] }, { required: ["source"] }] },
                properties: { pull_request: { type: "object" } },
              },
              {
                required: ["mode", "pull_request", "source"],
                properties: {
                  mode: { const: "archive-unmerged" },
                  pull_request: { type: "null" },
                },
              },
              {
                required: ["mode", "pull_request"],
                not: { required: ["source"] },
                properties: {
                  mode: { const: "archive-merged-evidence" },
                  pull_request: { type: "object" },
                },
              },
            ],
          },
        },
      },
    },
  },
  DeliveryArtWorkSessionNextActionV1: {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["authority", "code", "reason"],
    properties: {
      authority: { type: "string", minLength: 1 },
      code: { type: "string", minLength: 1 },
      inputs: { type: "object", additionalProperties: true },
      reason: { type: "string", minLength: 1 },
    },
    description: "Exact next-action projection without a host shell command.",
  },
  DeliveryArtSourceObservationV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "base_commit",
      "branch",
      "changed_files",
      "head_commit",
      "state",
      "upstream_commit",
    ],
    properties: {
      base_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
      branch: { type: "string", minLength: 1 },
      changed_files: {
        type: "array",
        uniqueItems: true,
        items: { type: "string", minLength: 1 },
      },
      head_commit: { type: "string", pattern: "^[0-9a-f]{40}$" },
      state: { type: "string", minLength: 1 },
      upstream_commit: {
        oneOf: [
          { type: "string", pattern: "^[0-9a-f]{40}$" },
          { type: "null" },
        ],
      },
    },
  },
  DeliveryArtAgentSourceIdentityV1: {
    type: "object",
    additionalProperties: false,
    required: ["state"],
    properties: {
      state: {
        enum: [
          "inactive",
          "credential-required",
          "author-setup-required",
          "ready",
          "suspended",
          "invalid",
        ],
      },
      reason_code: { type: "string", minLength: 1 },
      identity_id: { type: "string", minLength: 1 },
      logical_agent_id: { type: "string", pattern: "^agent-[a-z0-9-]+$" },
      display_name: { type: "string", pattern: "^Agent [A-Z]" },
      provider_principal: { type: "string", minLength: 1 },
      definition_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      app_id: { type: "integer", minimum: 1 },
      installation_id: { type: "integer", minimum: 1 },
      repository: { type: "string", pattern: "^[^/]+/[^/]+$" },
      repository_id: { type: "integer", minimum: 1 },
      landing_unit_id: { type: "string", minLength: 1 },
      branch: { type: "string", minLength: 1 },
      fetched_base: { type: "string", pattern: "^[0-9a-f]{40}$" },
      human_reviewer_id: { type: "string", minLength: 1 },
      git_author_name: { type: "string", minLength: 1 },
      git_author_email: { type: "string", minLength: 1 },
      authorization_expires_at: {
        oneOf: [{ type: "string", format: "date-time" }, { type: "null" }],
      },
    },
  },
  DeliveryArtConfiguredPathBlockerV1: {
    type: "object",
    additionalProperties: false,
    required: ["authority", "code", "next_action", "reason"],
    properties: {
      authority: { type: "string", minLength: 1 },
      code: { type: "string", minLength: 1 },
      next_action: { $ref: "#/components/schemas/DeliveryArtWorkSessionNextActionV1" },
      reason: { type: "string", minLength: 1 },
    },
  },
  DeliveryArtWorkContractV1: {
    type: "object",
    additionalProperties: false,
    required: ["completion_narrative", "conformance", "schema_version"],
    properties: {
      schema_version: { const: 1 },
      completion_narrative: {
        type: "object",
        additionalProperties: false,
        required: ["blockers", "items", "ready"],
        properties: {
          ready: { type: ["boolean", "null"] },
          blockers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["issues", "work_item_id"],
              properties: {
                issues: { type: "array", items: { type: "string" } },
                work_item_id: workItemId,
              },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["evaluated", "issues", "record_ref", "satisfied", "work_item_id"],
              properties: {
                evaluated: { type: "boolean" },
                issues: { type: "array", items: { type: "string" } },
                record_ref: { type: ["string", "null"] },
                satisfied: { type: ["boolean", "null"] },
                work_item_id: workItemId,
              },
            },
          },
        },
      },
      conformance: {
        type: "object",
        additionalProperties: false,
        required: ["cases", "target_readiness"],
        properties: {
          target_readiness: { enum: ["merge-ready", "operating-ready"] },
          cases: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["applies_to_work_item_ids", "fidelity", "id", "target_readiness"],
              properties: {
                applies_to_work_item_ids: { type: "array", items: workItemId },
                expected_outcome: { type: "string", minLength: 1 },
                fidelity: { type: "string", minLength: 1 },
                id: { type: "string", minLength: 1 },
                target_readiness: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
  DeliveryArtWorkContractV2: {
    type: "object",
    additionalProperties: false,
    required: ["completion_narrative", "conformance", "schema_version"],
    properties: {
      schema_version: { const: 2 },
      completion_narrative: {
        $ref: "#/components/schemas/DeliveryArtWorkContractV1/properties/completion_narrative",
      },
      conformance: {
        type: "object",
        additionalProperties: false,
        required: [
          "evidence_owner_cases",
          "outcome_cases",
          "target_readiness",
        ],
        properties: {
          target_readiness: { enum: ["merge-ready", "operating-ready"] },
          evidence_owner_cases: { $ref: "#/components/schemas/DeliveryArtWorkContractV2/$defs/cases" },
          outcome_cases: { $ref: "#/components/schemas/DeliveryArtWorkContractV2/$defs/cases" },
        },
      },
    },
    $defs: {
      cases: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "applies_to_work_item_ids",
            "evidence_owner_landing_unit_id",
            "fidelity",
            "id",
            "target_readiness",
          ],
          properties: {
            applies_to_work_item_ids: { type: "array", items: workItemId },
            evidence_owner_landing_unit_id: { type: "string", minLength: 1 },
            expected_outcome: { type: "string", minLength: 1 },
            fidelity: { type: "string", minLength: 1 },
            id: { type: "string", minLength: 1 },
            target_readiness: { enum: ["merge-ready", "operating-ready"] },
          },
        },
      },
    },
  },
  DeliveryArtWorkContract: {
    oneOf: [
      { $ref: "#/components/schemas/DeliveryArtWorkContractV1" },
      { $ref: "#/components/schemas/DeliveryArtWorkContractV2" },
    ],
  },
  DeliveryArtConfiguredPathProjectionV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "architecture",
      "art",
      "blockers",
      "context",
      "evidence",
      "human_gates",
      "landing_unit",
      "next_action",
      "ready",
      "review",
      "schema_version",
      "source",
      "status",
      "validation",
      "work_contract",
    ],
    properties: {
      schema_version: { const: 1 },
      status: { enum: ["implementation-ready", "blocked"] },
      ready: { type: "boolean" },
      art: {
        type: "object",
        additionalProperties: false,
        required: ["initiative", "parent_feature", "target"],
        properties: {
          initiative: { type: ["object", "null"], additionalProperties: true },
          parent_feature: { type: ["object", "null"], additionalProperties: true },
          target: { type: ["object", "null"], additionalProperties: true },
        },
      },
      landing_unit: { type: "object", additionalProperties: true },
      architecture: { type: "object", additionalProperties: true },
      source: { type: "object", additionalProperties: true },
      review: { type: "object", additionalProperties: true },
      validation: { type: "object", additionalProperties: true },
      evidence: { type: "object", additionalProperties: true },
      work_contract: { $ref: "#/components/schemas/DeliveryArtWorkContract" },
      human_gates: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      context: { type: "object", additionalProperties: true },
      blockers: {
        type: "array",
        items: { $ref: "#/components/schemas/DeliveryArtConfiguredPathBlockerV1" },
      },
      next_action: { $ref: "#/components/schemas/DeliveryArtWorkSessionNextActionV1" },
    },
  },
  DeliveryArtWorkSessionCommandReceiptV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "command_id",
      "completed_at",
      "caller_id",
      "digest",
      "executor_id",
      "operator_id",
      "ref",
      "request_digest",
      "result_state",
      "work_item_id",
    ],
    properties: {
      caller_id: { type: "string", minLength: 1 },
      command_id: commandId,
      completed_at: { type: "string", format: "date-time" },
      digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      executor_id: { type: "string", minLength: 1 },
      operator_id: { type: "string", minLength: 1 },
      ref: { type: "string", pattern: "^oos://delivery-art/work-session-command-receipts/" },
      request_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      result_state: { type: "string", minLength: 1 },
      work_item_id: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
    },
  },
  DeliveryArtLandingUnitCloseoutV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "completed",
      "ancestor_dispositions",
      "covered_work_item_ids",
      "failed",
      "packet_digest",
      "packet_id",
      "parent_closeouts",
      "initiative_disposition",
      "skipped_work_items",
      "state",
    ],
    properties: {
      ancestor_dispositions: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      completed: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      covered_work_item_ids: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      },
      failed: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      packet_digest: { type: ["string", "null"] },
      packet_id: { type: ["string", "null"] },
      parent_closeouts: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      initiative_disposition: {
        oneOf: [
          { type: "object", additionalProperties: true },
          { type: "null" },
        ],
      },
      skipped_work_items: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      state: { enum: ["complete", "partial_failure"] },
    },
  },
  DeliveryArtWorkSessionProjectionV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "delivery_id",
      "landing_unit_id",
      "next_action",
      "session_id",
      "session_revision",
      "state",
      "work_item_id",
      "workflow_id",
    ],
    properties: {
      workflow_id: { const: "delivery-art-work-session" },
      source_authorization: sourceAuthorization,
      delivery_id: {
        oneOf: [
          { type: "string", pattern: "^delivery-[1-9][0-9]*$" },
          { type: "null" },
        ],
      },
      work_item_id: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      covered_work_item_ids: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      },
      landing_unit_id: { type: ["string", "null"] },
      session_id: { type: ["string", "null"] },
      session_revision: nullableRevision,
      state: { type: "string", minLength: 1 },
      next_action: { $ref: "#/components/schemas/DeliveryArtWorkSessionNextActionV1" },
      decision_draft: { $ref: "#/components/schemas/DeliveryArtWorkSessionDecisionV1" },
      configured_path: {
        $ref: "#/components/schemas/DeliveryArtConfiguredPathProjectionV1",
      },
      work_contract: { $ref: "#/components/schemas/DeliveryArtWorkContract" },
      cleanup_receipt: { type: "object", additionalProperties: true },
      cleanup: { type: "object", additionalProperties: true },
      architecture_supersession: { type: "object", additionalProperties: true },
      architecture_supersession_receipt: {
        type: "object",
        additionalProperties: true,
      },
      recovery_receipt: { type: "object", additionalProperties: true },
      facts: { type: "object", additionalProperties: { type: "string" } },
      projection: { type: "object", additionalProperties: true },
      agent_source: { $ref: "#/components/schemas/DeliveryArtAgentSourceIdentityV1" },
      pull_request: { type: "object", additionalProperties: true },
      source: { $ref: "#/components/schemas/DeliveryArtSourceObservationV1" },
      replayed: { type: "boolean" },
      command_receipt: {
        $ref: "#/components/schemas/DeliveryArtWorkSessionCommandReceiptV1",
      },
      lifecycle_context: {
        $ref: "#/components/schemas/DeliveryArtLifecycleContextStatusV1",
      },
      source_authorization: {
        type: "object", additionalProperties: false, required: ["intent_ref", "session_id"],
        properties: { intent_ref: { type: "string", pattern: "^source-intent:" }, session_id: { type: "string" },
          state: { enum: ["revoked", "revocation-pending", "revocation-required"] }, operation_ref: { type: ["string", "null"] } },
      },
      closeout: {
        $ref: "#/components/schemas/DeliveryArtLandingUnitCloseoutV1",
      },
    },
  },
  DeliveryArtSourceRealizationStableIdV1: {
    type: "string",
    pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  },
  DeliveryArtSourceRealizationDigestV1: {
    type: "string",
    pattern: "^sha256:[0-9a-f]{64}$",
  },
  DeliveryArtSourceRealizationStartV1: sourceRealizationStartSchema,
  DeliveryArtSourceRealizationStartEnvelopeV1: {
    type: "object",
    additionalProperties: false,
    required: ["realization"],
    properties: {
      realization: {
        $ref: "#/components/schemas/DeliveryArtSourceRealizationStartV1",
      },
    },
  },
  DeliveryArtSourceRealizationContinueV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "command_id",
      "expected_revision",
      "accepted_change_set_digest",
      "requested_at",
    ],
    properties: {
      schema_version: { const: 1 },
      command_id: { $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1" },
      expected_revision: { type: "string", format: "date-time" },
      accepted_change_set_digest: {
        $ref: "#/components/schemas/DeliveryArtSourceRealizationDigestV1",
      },
      requested_at: { type: "string", format: "date-time" },
    },
  },
  DeliveryArtSourceRealizationCancelV1: {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "command_id", "expected_revision", "reason", "requested_at"],
    properties: {
      schema_version: { const: 1 },
      command_id: { $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1" },
      expected_revision: { type: "string", format: "date-time" },
      reason: { type: "string", minLength: 20 },
      requested_at: { type: "string", format: "date-time" },
    },
  },
  DeliveryArtSourceRealizationRecoverV1: {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "command_id", "expected_revision", "requested_at"],
    properties: {
      schema_version: { const: 1 },
      command_id: { $ref: "#/components/schemas/DeliveryArtSourceRealizationStableIdV1" },
      expected_revision: { type: "string", format: "date-time" },
      requested_at: { type: "string", format: "date-time" },
    },
  },
  DeliveryArtSourceRealizationCommandEnvelopeV1: {
    type: "object",
    additionalProperties: false,
    required: ["realization"],
    properties: { realization: { type: "object" } },
  },
  DeliveryArtSourceRealizationProjectionV1: {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "workflow_id",
      "session_id",
      "work_item_id",
      "revision",
      "state",
      "attempt",
      "next_action",
      "replayed",
    ],
    properties: {
      schema_version: { const: 1 },
      workflow_id: { const: "delivery-art-source-realization" },
      source_authorization: sourceAuthorization,
      session_id: { type: "string", minLength: 1 },
      work_item_id: { type: "string", pattern: "^work-item-[1-9][0-9]*$" },
      revision: nullableRevision,
      state: {
        enum: [
          "not-started",
          "accepted",
          "draft-ready",
          "applying",
          "apply-unknown",
          "source-created",
          "cancelled",
          "failed",
        ],
      },
      attempt: { type: ["object", "null"], additionalProperties: true },
      next_action: {
        type: "object",
        additionalProperties: false,
        required: ["code", "authority", "reason"],
        properties: {
          code: { type: "string", minLength: 1 },
          authority: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
      replayed: { type: "boolean" },
    },
  },
  DeliveryArtWorkSessionErrorV1: {
    type: "object",
    additionalProperties: false,
    required: ["error", "message", "details"],
    properties: {
      error: { type: "string", minLength: 1 },
      message: { type: "string", minLength: 1 },
      details: { type: ["object", "null"], additionalProperties: true },
    },
  },
};

for (const [name, schema] of Object.entries(components)) {
  synchronized = upsertOpenApiComponent(synchronized, name, schema);
}

const security = [{ CallerIdHeader: [], CallerSecretHeader: [] }];
const parameter = {
  name: "work_item_id",
  in: "path",
  required: true,
  schema: workItemId,
};
const operatorParameter = {
  name: "x-oos-operator-id",
  in: "header",
  required: true,
  description:
    "Accountable human operator identity admitted for the authenticated application caller.",
  schema: { type: "string", minLength: 1 },
};
const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionErrorV1" },
    },
  },
});
const responseExample = {
  workflow_id: "delivery-art-work-session",
  delivery_id: "delivery-886",
  work_item_id: "work-item-1024",
  landing_unit_id: "delivery-886-oos-work-session-api",
  session_id: "work-session:delivery-886:delivery-886-oos-work-session-api",
  session_revision: "2026-08-27T01:00:00Z",
  state: "source-work",
  next_action: {
    code: "source-work-required",
    reason: "Complete and validate the bounded source change.",
    authority: "operator-orchestration-service",
  },
  facts: { source: "unpushed" },
  projection: {
    complete: false,
    gate: "source-work",
    state: "source-work-required",
    summary: "Source work remains open.",
  },
  pull_request: { state: "missing" },
  agent_source: {
    state: "credential-required",
    identity_id: "agent-source-github-app-v1",
    logical_agent_id: "agent-gary",
    display_name: "Agent Gary",
    provider_principal: "mfshaf7-agent-gary[bot]",
    definition_digest: `sha256:${"c".repeat(64)}`,
    app_id: 4907049,
    installation_id: 160815600,
    repository: "mfshaf7/operator-orchestration-service",
    repository_id: 1213863054,
    landing_unit_id: "delivery-886-oos-work-session-api",
    branch: "feature/1024-delivery-work-session-api",
    fetched_base: "a".repeat(40),
    human_reviewer_id: "mfshaf7",
    git_author_name: "Agent Gary",
    git_author_email: "327854141+mfshaf7-agent-gary[bot]@users.noreply.github.com",
    authorization_expires_at: null,
    reason_code: "agent_source_credential_missing",
  },
  source: {
    base_commit: "a".repeat(40),
    branch: "feature/1024-delivery-work-session-api",
    changed_files: ["src/delivery-art/work-session-service.js"],
    head_commit: "b".repeat(40),
    state: "unpushed",
    upstream_commit: null,
  },
};
const preflightResponseExample = {
  workflow_id: "delivery-art-work-session",
  delivery_id: "delivery-1154",
  work_item_id: "work-item-1163",
  landing_unit_id: null,
  session_id: null,
  session_revision: null,
  state: "implementation-ready",
  next_action: {
    authority: "operator-orchestration-service",
    code: "work-session-start-ready",
    inputs: {
      landing_unit_id: "delivery-1154-configured-path-preflight-oos",
      work_item_id: "work-item-1163",
    },
    reason: "All configured-path prerequisites are ready for work start.",
  },
  configured_path: {
    schema_version: 1,
    status: "implementation-ready",
    ready: true,
    art: { initiative: {}, parent_feature: {}, target: {} },
    landing_unit: {
      id: "delivery-1154-configured-path-preflight-oos",
      owner_repo: "operator-orchestration-service",
    },
    architecture: { custody_state: "durable", decision_status: "architecture-ready" },
    source: { base: { state: "ready" }, branch: { state: "available" } },
    review: { human_reviewer_id: "mfshaf7", required: true },
    validation: { conformance_dimensions: [], target_readiness: "merge-ready" },
    evidence: { classes: ["tests", "validations"] },
    work_contract: {
      schema_version: 1,
      completion_narrative: { blockers: [], items: [], ready: true },
      conformance: { cases: [], target_readiness: "merge-ready" },
    },
    human_gates: [],
    context: { required: false, state: "not-required" },
    blockers: [],
    next_action: {
      authority: "operator-orchestration-service",
      code: "work-session-start-ready",
      inputs: { work_item_id: "work-item-1163" },
      reason: "All configured-path prerequisites are ready for work start.",
    },
  },
};
const commandExample = {
  command: {
    command_id: "work-session-command:continue-1024-1",
    expected_session_revision: "2026-08-27T01:00:00Z",
  },
};
const startCommandExample = {
  command: {
    command_id: "work-session-command:start-1024-1",
    expected_session_revision: null,
  },
};
const recoveryCommandExample = {
  command: {
    command_id: "work-session-command:recover-1024-1",
    expected_session_revision: "2026-08-27T01:00:00Z",
    recovery: {
      session_id: "work-session:delivery-886:delivery-886-api",
      session_revision: "2026-08-27T01:00:00Z",
      reason: "Preserve the merged session with missing pre-merge evidence.",
      pull_request: {
        url: "https://github.com/example/repo/pull/1",
        head_commit: "a".repeat(40),
        merge_commit: "b".repeat(40),
      },
    },
  },
};
const operationMetadata = {
  "x-oos-owner": "operator-orchestration-service",
  "x-oos-primary-caller": "governance-operations-console",
  "x-oos-surface": "operator-facing",
  "x-oos-workflow-family": "delivery-work-session",
};
const commandOperation = ({ action, description, schemaName }) => ({
  post: {
    tags: ["Delivery ART"],
    summary: `${action[0].toUpperCase()}${action.slice(1)} a Delivery work session`,
    description,
    operationId: `${action}DeliveryArtWorkSession`,
    security,
    parameters: [parameter, operatorParameter],
    requestBody: {
      required: true,
      description: action === "start"
        ? "Provide a unique command id, the expected session revision, and optionally the accepted Landing Unit decision. Omitting the decision returns a caller-bound draft."
        : action === "recover"
          ? "Provide the exact session revision, substantive reason, and either the merged PR binding or archive-unmerged local source binding. Recovery archives history but does not certify completion."
        : "Provide a unique command id and the exact session revision shown by the latest authoritative projection.",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schemaName}` },
          example: action === "start"
            ? startCommandExample
            : action === "recover"
              ? recoveryCommandExample
              : commandExample,
        },
      },
    },
    responses: {
      200: {
        description: "Authoritative work-session projection and command receipt.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionProjectionV1" },
            example: responseExample,
          },
        },
      },
      400: errorResponse("The command envelope is invalid."),
      401: errorResponse("Caller authentication is missing or invalid."),
      403: errorResponse("Caller identity is not bound to this work session."),
      409: errorResponse("The command is stale, conflicting, blocked, or requires reconciliation."),
      503: errorResponse("The admitted source executor or an authoritative dependency is unavailable."),
    },
    ...operationMetadata,
  },
});
const sourceRealizationExample = {
  schema_version: 1,
  workflow_id: "delivery-art-source-realization",
  session_id: "work-session:delivery-1275:delivery-1275-source-realization",
  work_item_id: "work-item-1285",
  revision: "2026-10-14T01:00:01Z",
  state: "draft-ready",
  attempt: {
    request_id: "source-realization-request-1285-1",
    execution_id: "console-execution-1285-1",
    state: "draft-ready",
    objective_digest: `sha256:${"a".repeat(64)}`,
    change_set: {
      change_set_id: "change-set-1285-1",
      digest: `sha256:${"b".repeat(64)}`,
      commit_message: "feat: implement the accepted source plan",
      operations: [{
        action: "replace",
        path: "src/example.js",
        content_digest: `sha256:${"c".repeat(64)}`,
        expected_digest: `sha256:${"d".repeat(64)}`,
      }],
    },
  },
  next_action: {
    code: "source-realization-acceptance-required",
    authority: "operator",
    reason: "Review and accept the exact change-set digest before Agent Gary commits it.",
  },
  replayed: false,
};
const sourceRealizationRequestExamples = {
  start: {
    realization: {
      schema_version: 1,
      request_id: "source-realization-request-1285-1",
      execution_id: "console-execution-1285-1",
      expected_session_revision: "2026-10-14T00:59:00Z",
      objective: "Implement the accepted bounded source plan with its required tests.",
      requested_at: "2026-10-14T00:59:30Z",
      budget_tokens: 3000,
      retry_of: null,
    },
  },
  continue: {
    realization: {
      schema_version: 1,
      command_id: "source-realization-accept-1285-1",
      expected_revision: "2026-10-14T01:00:01Z",
      accepted_change_set_digest: `sha256:${"b".repeat(64)}`,
      requested_at: "2026-10-14T01:01:00Z",
    },
  },
  cancel: {
    realization: {
      schema_version: 1,
      command_id: "source-realization-cancel-1285-1",
      expected_revision: "2026-10-14T01:00:01Z",
      reason: "The operator rejected this exact draft after review.",
      requested_at: "2026-10-14T01:01:00Z",
    },
  },
  recover: {
    realization: {
      schema_version: 1,
      command_id: "source-realization-recover-1285-1",
      expected_revision: "2026-10-14T01:02:00Z",
      requested_at: "2026-10-14T01:03:00Z",
    },
  },
};
const sourceRealizationOperation = ({ action, description, schemaName }) => ({
  post: {
    tags: ["Delivery ART"],
    summary: `${action[0].toUpperCase()}${action.slice(1)} bounded source realization`,
    description,
    operationId: `${action}DeliveryArtSourceRealization`,
    security,
    parameters: [parameter, operatorParameter],
    requestBody: {
      required: true,
      description: "Provide the caller-bound source-realization request or command for the exact current realization revision.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["realization"],
            properties: {
              realization: { $ref: `#/components/schemas/${schemaName}` },
              source_intent_ref: { type: "string", pattern: "^source-intent:[A-Za-z0-9][A-Za-z0-9._:/@+\\-]{0,241}$" },
            },
          },
          example: sourceRealizationRequestExamples[action],
        },
      },
    },
    responses: {
      200: {
        description: "Authoritative bounded source-realization projection.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeliveryArtSourceRealizationProjectionV1" },
            example: sourceRealizationExample,
          },
        },
      },
      400: errorResponse("The source-realization command is invalid."),
      401: errorResponse("Caller authentication is missing or invalid."),
      403: errorResponse("Caller or operator identity does not match the work session."),
      409: errorResponse("The source-realization revision, binding, or lifecycle state conflicts."),
      502: errorResponse("The governed model or source executor returned invalid output."),
      503: errorResponse("The bounded source-realization runtime is unavailable."),
    },
    ...operationMetadata,
    "x-oos-workflow-family": "delivery-art-source-realization",
  },
});

const paths = {
  "/v1/delivery-art/architecture-packets/draft": {
    post: {
      tags: ["Delivery ART"],
      summary: "Author a current Architecture Packet candidate",
      description: "Authors a non-durable schema-v6 candidate from explicit operator design while OOS binds the authenticated Console caller to its configured operator, captures fresh scoped ART truth, derives current supersession, and computes canonical identity, fingerprints, custody, timestamps, and digest. The route performs no WGCF or OpenProject mutation.",
      operationId: "draftDeliveryArtArchitecturePacket",
      security,
      parameters: [operatorParameter],
      requestBody: {
        required: true,
        description: "Provide only editable design, conformance, repository-revision, scope, and decision intent. Authority-bearing fields are rejected. The architecture and conformance objects must be complete schema-v6 sections validated by the canonical runtime contract.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DeliveryArtArchitecturePacketDraftRequestV1",
            },
            example: deliveryArtArchitectureDraftRequestExample(),
          },
        },
      },
      responses: {
        200: {
          description: "Canonical local Architecture Packet candidate and bounded fresh-snapshot summary.",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DeliveryArtArchitecturePacketDraftResponseV1",
              },
              example: {
                architecture_packet: {
                  artifact_id: "architecture-packet:delivery-1275-v1",
                  artifact_type: "delivery_art_architecture_packet",
                  custody: {
                    state: "local-draft",
                    uri: "local://delivery-art/architecture-packet:delivery-1275-v1.json",
                  },
                  delivery_id: "delivery-1275",
                  integrity: { content_digest: `sha256:${"b".repeat(64)}` },
                  operator: { id: "operator:workspace-owner" },
                  schema_version: 6,
                },
                source_snapshot: {
                  art_digest: `sha256:${"a".repeat(64)}`,
                  covered_record_count: 1,
                  dependency_record_count: 0,
                  relation_count: 0,
                },
                workflow_id: "delivery-art-architecture-packet-draft",
              },
            },
          },
        },
        400: errorResponse("The authoring envelope or request version is invalid."),
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("The caller-specific credential or caller-to-operator binding is invalid."),
        409: errorResponse("The proposed design contradicts current scoped ART truth."),
        422: errorResponse("The generated candidate fails the canonical schema-v6 contract."),
        502: errorResponse("Current ART or projected architecture authority is inconsistent."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-art-custody",
    },
  },
  "/v1/delivery-art/architecture-packets/persist": {
    post: {
      tags: ["Delivery ART"],
      summary: "Persist an approved Architecture Packet",
      description: "Persists one current schema-v6 Architecture Packet through WGCF after verifying its server-bound Console caller and accountable operator, exact fresh ART scope, current supersession, canonical validation, and cutover safety. WGCF failure prevents OpenProject projection; projection failure never deletes durable evidence.",
      operationId: "persistDeliveryArtArchitecturePacket",
      security,
      parameters: [operatorParameter],
      requestBody: {
        required: true,
        description: "Provide the exact local candidate returned by the authoring route with decision.status=architecture-ready. OOS recomputes fingerprints and digest.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DeliveryArtArchitecturePacketPersistRequestV1",
            },
            example: {
              artifact: {
                artifact_id: "architecture-packet:delivery-1275-v1",
                artifact_type: "delivery_art_architecture_packet",
                custody: {
                  state: "local-draft",
                  uri: "local://delivery-art/architecture-packet:delivery-1275-v1.json",
                },
                delivery_id: "delivery-1275",
                integrity: { content_digest: `sha256:${"b".repeat(64)}` },
                operator: { id: "operator:workspace-owner" },
                schema_version: 6,
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Durable architecture artifact, custody receipt, and bounded owner receipt.",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DeliveryArtArchitecturePacketPersistResponseV1",
              },
              example: {
                artifact: {
                  artifact_id: "architecture-packet:delivery-1275-v1",
                  artifact_type: "delivery_art_architecture_packet",
                  custody: {
                    state: "durable",
                    uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
                  },
                  delivery_id: "delivery-1275",
                  integrity: { content_digest: `sha256:${"a".repeat(64)}` },
                  operator: { id: "operator:workspace-owner" },
                  schema_version: 6,
                },
                custody_receipt: {},
                owner_receipt: {
                  caller_id: "governance-operations-console",
                  operator_id: "operator:workspace-owner",
                  projected: true,
                  replayed: false,
                },
                workflow_id: "delivery-art-architecture-packet-persist",
              },
            },
          },
        },
        400: errorResponse("The canonical request envelope is invalid."),
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller identity is not bound to the packet's accountable operator."),
        409: errorResponse("The packet is undecided, stale, semantically unchanged, missing exact supersession, or blocked by active sessions."),
        422: errorResponse("The candidate fails canonical schema or semantic validation."),
        503: errorResponse("Delivery ART mutation admission or a required custody dependency is unavailable."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-art-custody",
    },
  },
  "/v1/delivery-art/architecture-packets/current": {
    post: {
      tags: ["Delivery ART"],
      summary: "Resolve the current accepted Delivery architecture",
      description: "Reads the latest structured architecture reference projected on the Delivery Epic and resolves its immutable WGCF artifact. The response identifies whether the packet is current v6 or historical read-only evidence. This route does not mutate ART or custody.",
      operationId: "getCurrentDeliveryArtArchitecturePacket",
      security,
      requestBody: {
        required: true,
        description: "Provide the Delivery initiative identifier whose latest accepted architecture packet must be resolved.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DeliveryArtCurrentArchitectureRequestV1",
            },
            example: { delivery_id: "delivery-892" },
          },
        },
      },
      responses: {
        200: {
          description: "Current architecture artifact and custody evidence.",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DeliveryArtCurrentArchitectureResponseV1",
              },
              example: {
                artifact: {
                  artifact_id: "architecture-packet:delivery-892-v6",
                  artifact_type: "delivery_art_architecture_packet",
                  custody: {
                    state: "durable",
                    uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
                  },
                  delivery_id: "delivery-892",
                  integrity: { content_digest: `sha256:${"a".repeat(64)}` },
                  operator: { id: "operator:workspace-owner" },
                  schema_version: 6,
                },
                contract_posture: "current",
                custody_receipt: {},
                projected_reference: {
                  artifact_status: "architecture-ready",
                  reference: {
                    digest: `sha256:${"a".repeat(64)}`,
                    uri: `wgcf://artifacts/delivery-art/sha256/${"a".repeat(64)}`,
                  },
                },
              },
            },
          },
        },
        401: errorResponse("Caller authentication is missing or invalid."),
        404: errorResponse("No current architecture reference is projected."),
        409: errorResponse("The latest projected architecture is not ready."),
        502: errorResponse("The projected reference and immutable artifact disagree."),
      },
      "x-oos-owner": "operator-orchestration-service",
      "x-oos-primary-caller": "governance-operations-console",
      "x-oos-surface": "operator-facing",
      "x-oos-workflow-family": "delivery-art-custody",
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/context": {
    post: {
      tags: ["Delivery ART"],
      summary: "Project bounded Delivery lifecycle context",
      description: "Derives typed ART, repository, validation, and runtime sources in OOS, projects them through CGG by default, and records packet or explicit raw-fallback measurements against the work session. CGG failure never silently downgrades to raw context.",
      operationId: "projectDeliveryArtLifecycleContext",
      security,
      parameters: [parameter, operatorParameter],
      requestBody: {
        required: true,
        description: "Request packet-default lifecycle context or one explicit reason-bound raw fallback for the active work session.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DeliveryArtLifecycleContextRequestEnvelopeV1",
            },
            example: {
              context: {
                schema_version: 1,
                request_id: "context-request-1165-1",
                execution_id: "console-execution-1165-1",
                operation: "continue",
                mode: "packet",
                budget_tokens: 3000,
                fallback_reason: null,
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Bounded lifecycle context and durable safe binding.",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DeliveryArtLifecycleContextResultV1",
              },
              example: {
                workflow_id: "delivery-art-lifecycle-context",
                session_id: "work-session:delivery-1154:delivery-1154-lifecycle-context",
                mode: "packet",
                replayed: false,
                content: "Bounded lifecycle context packet.",
                binding: {
                  request_id: "context-request-1165-1",
                  packet_ref: "/v1/context/packets/context-request-1165-1",
                },
                measurements: {
                  packet_count: 1,
                  raw_fallback_count: 0,
                  denied_count: 0,
                },
                classification: { highest_sensitivity: "internal" },
                budget: { requested_tokens: 3000, admitted_tokens: 420 },
                authority: {
                  legal_next_action: "source-work-required",
                  lifecycle_authority: "operator-orchestration-service",
                  raw_fallback_explicit: false,
                },
              },
            },
          },
        },
        400: errorResponse("The lifecycle context request is invalid."),
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller or operator identity does not match the session."),
        409: errorResponse("The session is missing or the request conflicts with prior context."),
        422: errorResponse("CGG denied unsafe or inadmissible context."),
        503: errorResponse("CGG lifecycle context is not commissioned or unavailable."),
      },
      ...operationMetadata,
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/realization": {
    get: {
      tags: ["Delivery ART"],
      summary: "Read bounded source realization",
      description: "Returns the authoritative staged realization state without exposing generated source content. Exact paths and digests remain visible for operator review.",
      operationId: "getDeliveryArtSourceRealization",
      security,
      parameters: [parameter, operatorParameter],
      responses: {
        200: {
          description: "Authoritative bounded source-realization projection.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryArtSourceRealizationProjectionV1" },
              example: sourceRealizationExample,
            },
          },
        },
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller or operator identity does not match the work session."),
        409: errorResponse("The Delivery work session is missing."),
        503: errorResponse("The bounded source-realization runtime is unavailable."),
      },
      ...operationMetadata,
      "x-oos-workflow-family": "delivery-art-source-realization",
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/realization/start":
    sourceRealizationOperation({
      action: "start",
      description: "Captures clean bounded repository context, admits it through CGG, invokes only the commissioned governed model profile, and stages the validated change set without mutating source.",
      schemaName: "DeliveryArtSourceRealizationStartV1",
    }),
  "/v1/delivery-work-items/{work_item_id}/work-session/realization/continue":
    sourceRealizationOperation({
      action: "continue",
      description: "Applies and commits only the exact operator-accepted change-set digest through the isolated source executor as Agent Gary.",
      schemaName: "DeliveryArtSourceRealizationContinueV1",
    }),
  "/v1/delivery-work-items/{work_item_id}/work-session/realization/cancel":
    sourceRealizationOperation({
      action: "cancel",
      description: "Cancels a draft-ready change set without mutating source and retains the reasoned terminal attempt for an explicitly linked retry.",
      schemaName: "DeliveryArtSourceRealizationCancelV1",
    }),
  "/v1/delivery-work-items/{work_item_id}/work-session/realization/recover":
    sourceRealizationOperation({
      action: "recover",
      description: "Reconciles an unknown apply result through the exact replay-safe source action; it never generates a new change set or authorizes another mutation.",
      schemaName: "DeliveryArtSourceRealizationRecoverV1",
    }),
  "/v1/delivery-work-items/{work_item_id}/work-session": {
    get: {
      tags: ["Delivery ART"],
      summary: "Read a Delivery work session",
      description: "Returns OOS-owned session state, exact next action, bounded source observation, and evidence references. The browser never derives Git or completion truth.",
      operationId: "getDeliveryArtWorkSession",
      security,
      parameters: [parameter, operatorParameter],
      responses: {
        200: {
          description: "Authoritative work-session projection.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionProjectionV1" },
              example: responseExample,
            },
          },
        },
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller identity is not bound to this work session."),
        503: errorResponse("The admitted source executor or an authoritative dependency is unavailable."),
      },
      ...operationMetadata,
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/start": commandOperation({
    action: "start",
    description: "Drafts the caller-bound Landing Unit decision when no decision is supplied, or starts one reconstructable session from an accepted decision. New work requires current durable schema-v6 architecture. A dependency-blocked covered item is admitted only when that packet proves the dependency is internal to the exact Landing Unit and declares the same start order. Historical v1-v5 packets remain readable only for sessions already bound to them. Replays are content-bound and return the retained receipt.",
    schemaName: "DeliveryArtWorkSessionStartRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/preflight": {
    post: {
      tags: ["Delivery ART"],
      summary: "Preflight a configured Delivery work path",
      description: "Reads ART, current architecture, Landing Unit, owner source, Agent identity, provider, validation, evidence, human-gate, and context posture without creating a session, branch, worktree, credential, or source resource. Work start uses the same evaluator.",
      operationId: "preflightDeliveryArtWorkSession",
      security,
      parameters: [parameter, operatorParameter],
      requestBody: {
        required: true,
        description: "Optionally provide the accepted Landing Unit decision. Omitting it returns a caller-bound draft and the exact decision-required blocker without persisting either.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/DeliveryArtWorkSessionPreflightRequestV1",
            },
            example: {},
          },
        },
      },
      responses: {
        200: {
          description: "Read-only implementation-ready projection or deterministic blocker list.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryArtWorkSessionProjectionV1" },
              example: preflightResponseExample,
            },
          },
        },
        400: errorResponse("The decision or work-item identifier is invalid."),
        401: errorResponse("Caller authentication is missing or invalid."),
        403: errorResponse("Caller identity is not bound to this work path."),
        503: errorResponse("The admitted source executor or an authoritative dependency is unavailable."),
      },
      ...operationMetadata,
    },
  },
  "/v1/delivery-work-items/{work_item_id}/work-session/continue": commandOperation({
    action: "continue",
    description: "Runs only the next deterministic transition already authorized by the session and exact source observation. A stale session revision fails without execution.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/reconstruct": commandOperation({
    action: "reconstruct",
    description: "Explicitly replaces a session bound to superseded architecture only after OOS proves that source, pull-request, Review Packet, readiness, and evidence activity remain pristine. The prior and replacement bindings are retained in a supersession receipt.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/recover": commandOperation({
    action: "recover",
    description: "Archives an exact active session after a verified merged PR without pre-merge evidence, a verified merged PR with one preserved durable merge-ready packet, or a clean architecture-superseded unmerged local branch with no remote branch or PR. Retains artifacts and local source; it does not clear ART blockers or complete the item.",
    schemaName: "DeliveryArtWorkSessionRecoveryRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/merge": commandOperation({
    action: "merge",
    description: "Merges only the exact open pull request already bound to a durable merge-ready Review Packet. A changed head, unresolved Security gate, stale revision, or non-ready lifecycle state fails without merge.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
  "/v1/delivery-work-items/{work_item_id}/work-session/close": commandOperation({
    action: "close",
    description: "Completes bounded ART closeout only after finalized evidence and closeout readiness exist. Terminal cleanup remains part of this command and is receipt-backed.",
    schemaName: "DeliveryArtWorkSessionCommandRequestV1",
  }),
};

mergeSourceEditorPaths(paths, "delivery");
for (const [route, pathItem] of Object.entries(paths)) {
  synchronized = upsertOpenApiPath(synchronized, route, pathItem);
}

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error("docs/api/openapi.json Delivery work-session contract is stale");
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "check" })}\n`);
} else {
  writeFileSync(openApiPath, synchronized);
  process.stdout.write(`${JSON.stringify({ ok: true, mode: "write" })}\n`);
}
