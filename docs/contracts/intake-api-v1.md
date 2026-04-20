# Intake API v1

## Purpose

Define the first stable internal contract for operator workflow brokering around
idea capture, idea visibility, idea triage, and bounded decision handling.

This is an internal service contract, not a public API.

## Design Rules

- endpoints are workflow-oriented, not generic chat endpoints
- requests must stay bounded and attributable
- operator approval remains required for durable workflow effects
- responses must be structured JSON

## Endpoint: Workflow Catalog

`GET /v1/workflows`

Returns the broker-owned workflow catalog for source adapters and operator
surfaces.

### Response

```json
{
  "workflows": [
    {
      "workflow_id": "idea-command",
      "title": "Idea workflow",
      "summary": "Broker-owned command-family descriptor for creating and reading idea records without exposing backend-specific semantics to source adapters.",
      "supports": {
        "capture": true,
        "triage": true,
        "decision": true,
        "list_projection": true,
        "read_projection": true,
        "source_lookup": true
      }
    },
    {
      "workflow_id": "idea-capture",
      "title": "Idea capture",
      "summary": "Create or reuse the initial canonical idea record in OpenProject through the broker-owned workflow path.",
      "supports": {
        "capture": true,
        "triage": true,
        "decision": false,
        "list_projection": true,
        "read_projection": true,
        "source_lookup": true
      }
    },
    {
      "workflow_id": "idea-triage",
      "title": "Idea triage",
      "summary": "Move a captured idea into triaged with concise operator-authored framing that remains usable from Telegram alone.",
      "supports": {
        "capture": true,
        "triage": true,
        "decision": true,
        "list_projection": true,
        "read_projection": true,
        "source_lookup": true
      }
    },
    {
      "workflow_id": "idea-decision",
      "title": "Idea decision",
      "summary": "Move a triaged idea into a first durable outcome with operator-authored decision notes.",
      "supports": {
        "capture": true,
        "triage": true,
        "decision": true,
        "list_projection": true,
        "read_projection": true,
        "source_lookup": true
      }
    }
  ]
}
```

## Endpoint: Workflow Descriptor

`GET /v1/workflows/idea-command`

Returns the canonical command-family semantics and source-specific render hints
for operator surfaces such as Telegram.

### Response

```json
{
  "workflow_id": "idea-command",
  "title": "Idea workflow",
  "purpose": "Create, inspect, and list canonical idea records in Workspace Proposals through the broker-owned operator workflow path.",
  "summary": "Broker-owned command-family descriptor for creating and reading idea records without exposing backend-specific semantics to source adapters.",
  "lifecycle_note": "The canonical backlog supports the full status model now. Telegram currently exposes capture, operator-authored triage, bounded decision for `parked`, `accepted`, and `rejected`, plus list, list all, and show. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet, `owner-assigned` remains broker-managed until an explicit owner vocabulary is enabled, future archival is reserved as a visibility flag only for terminal records, and accepted ideas can now move through the broker-owned internal `POST /v1/ideas/{idea_id}/consume` route into the separate OpenProject delivery ART project without adding a Telegram command.",
  "lifecycle_statuses": [
    {
      "status": "captured",
      "meaning": "Raw record exists, but no approved triage or ownership decision exists yet.",
      "next_step": "Review the captured record, then move it into triage or park it in the canonical backlog."
    },
    {
      "status": "triaged",
      "meaning": "An operator-authored or operator-accepted framing exists and the idea now has a clearer shape.",
      "next_step": "Confirm the framing, assign the right proposal type or owner, or park it if it is not ready."
    },
    {
      "status": "parked",
      "meaning": "Worth keeping, but intentionally deferred instead of moving into active work right now.",
      "next_step": "Set a revisit point or bring it back into owner assignment when it becomes actionable."
    },
    {
      "status": "owner-assigned",
      "meaning": "A durable owning repo, product, or component has been identified for the idea.",
      "next_step": "Promote it into an accepted proposal or concrete owner-repo work when the next action is clear."
    },
    {
      "status": "accepted",
      "meaning": "Ready to move out of the proposal backlog and into concrete governed work.",
      "next_step": "Promote it into the next governed artifact such as an ADR, review, change plan, or delivery work item."
    },
    {
      "status": "rejected",
      "meaning": "Explicitly not proceeding in its current form.",
      "next_step": "Keep the record for traceability only; do not continue active work unless it is explicitly reopened. It is a future archive candidate."
    },
    {
      "status": "implemented",
      "meaning": "The intended outcome already landed elsewhere.",
      "next_step": "Link the realized outcome if needed, but do not continue using the backlog item as active work. It is a future archive candidate."
    },
    {
      "status": "superseded",
      "meaning": "Replaced by a newer or better-framed idea.",
      "next_step": "Use the newer record as the active reference and keep this one only as historical context. It is a future archive candidate."
    }
  ],
  "operator_guidance": {
    "what_to_send": [
      "use `/idea <text>` to capture a new idea",
      "use `/idea triage <idea-id> <summary>` to record operator-authored framing and move a captured item into `triaged`",
      "use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` to record the first bounded durable decision",
      "use `/idea list` to review the recent idea slice",
      "use `/idea list all` to review every stored idea through broker pagination",
      "use `/idea list status <status>` to review one status slice such as `captured` or `parked`",
      "use `/idea show <idea-id>` to inspect one stored idea record"
    ],
    "after_capture": [
      "each reply includes the canonical idea id, record reference, and current status",
      "use `/idea triage <idea-id> <summary>` when the raw capture is clear enough to frame from Telegram alone",
      "use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` when the next durable outcome is clear",
      "use `/idea list all` when you need the full stored backlog instead of only the recent slice"
    ]
  },
  "source_hints": {
    "telegram": {
      "command_descriptors": [
        {
          "invocation": "/idea <idea text>",
          "purpose": "Capture a new idea into the canonical backlog."
        },
        {
          "invocation": "/idea triage <idea-id> <summary>",
          "purpose": "Record operator-authored triage framing and move the idea into triaged."
        },
        {
          "invocation": "/idea decide <idea-id> <parked|accepted|rejected> <notes>",
          "purpose": "Record the next bounded durable outcome without exposing owner-assignment yet."
        },
        {
          "invocation": "/idea list",
          "purpose": "Show the recent stored idea slice with current statuses."
        },
        {
          "invocation": "/idea list all",
          "purpose": "Show the full stored idea backlog through broker pagination."
        },
        {
          "invocation": "/idea list status <status>",
          "purpose": "Show the recent stored idea slice filtered by one canonical status."
        },
        {
          "invocation": "/idea list all status <status>",
          "purpose": "Show the full stored idea backlog filtered by one canonical status."
        },
        {
          "invocation": "/idea show <idea-id>",
          "purpose": "Inspect one stored idea record in detail."
        },
        {
          "invocation": "/idea help",
          "purpose": "Show the canonical workflow guidance and lifecycle status model."
        }
      ],
      "help_invocation": "/idea help",
      "invocation_examples": [
        "/idea <idea text>",
        "/idea triage <idea-id> <summary>",
        "/idea decide <idea-id> <parked|accepted|rejected> <notes>",
        "/idea list",
        "/idea list all",
        "/idea list status <status>",
        "/idea list all status <status>",
        "/idea show <idea-id>",
        "/idea help"
      ],
      "note": "Use `/idea <text>` to capture a new idea. Use `/idea triage <idea-id> <summary>` to record operator-authored framing, then `/idea decide <idea-id> <parked|accepted|rejected> <notes>` for the first durable outcome. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet."
    }
  }
}
```

`GET /v1/workflows/idea-capture`

Returns the canonical workflow semantics, operator guidance, and source-specific
render hints for `idea-capture`.

### Response

```json
{
  "workflow_id": "idea-capture",
  "title": "Idea capture",
  "purpose": "Capture a concrete idea or problem statement into Workspace Proposals before triage and ownership decisions.",
  "summary": "Create or reuse the initial canonical idea record in OpenProject through the broker-owned workflow path.",
  "operator_guidance": {
    "what_to_send": [
      "the idea itself or the problem worth tracking",
      "enough context to recognize it later",
      "one message is enough; triage and ownership come later"
    ],
    "after_capture": [
      "review the returned idea id and canonical record reference",
      "when the framing is clear enough from phone-only access, use `/idea triage <idea-id> <summary>` to record the first bounded triage outcome",
      "use the broker read projection when you need to confirm what was stored",
      "triage and ownership assignment come later through separate broker workflows"
    ],
    "examples": [
      "We need a governed place to capture deferred architecture ideas before they become Git artifacts"
    ]
  },
  "source_hints": {
    "telegram": {
      "help_invocation": "/idea help",
      "invocation_examples": [
        "/idea <idea text>",
        "/idea help"
      ],
      "note": "Use a single message in the same chat or topic where the idea came up."
    }
  }
}
```

`GET /v1/workflows/idea-triage`

Returns the canonical workflow semantics for the first phone-friendly triage
step.

### Response

```json
{
  "workflow_id": "idea-triage",
  "title": "Idea triage",
  "purpose": "Record operator-authored triage framing for an existing idea and move it into the triaged state without requiring AI assistance.",
  "summary": "Move a captured idea into triaged with a concise operator-authored summary that remains usable from Telegram alone.",
  "operator_guidance": {
    "what_to_send": [
      "the canonical idea id such as `idea-37`",
      "one bounded operator-authored summary that makes the next decision easier",
      "use `/idea triage <idea-id> <summary>` from Telegram when desktop Codex access is unavailable"
    ],
    "after_capture": [
      "triage is the phone-friendly framing step, not the final durable decision step",
      "use it to move a captured item into triaged with an operator-authored summary",
      "the reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet"
    ],
    "examples": [
      "Move this into triaged: needs a bounded broker workflow before decision",
      "Frame this as a deferred platform contract cleanup instead of a product bug"
    ]
  },
  "source_hints": {
    "telegram": {
      "invocation_examples": [
        "/idea triage idea-37 Needs a bounded broker workflow before decision"
      ],
      "note": "Use `/idea triage <idea-id> <summary>` for the first bounded framing step. `/idea triage discuss <idea-id>` is reserved for a future AI-assisted path and is not implemented yet."
    }
  }
}
```

`GET /v1/workflows/idea-decision`

Returns the canonical workflow semantics for the first durable phone-friendly
decision step.

### Response

```json
{
  "workflow_id": "idea-decision",
  "title": "Idea decision",
  "purpose": "Record the first durable bounded decision for an existing idea without exposing owner-assignment yet.",
  "summary": "Move a triaged idea into a first durable outcome with operator-authored decision notes.",
  "operator_guidance": {
    "what_to_send": [
      "the canonical idea id such as `idea-37`",
      "one of `parked`, `accepted`, or `rejected`",
      "one bounded note that explains the outcome for later readback"
    ],
    "after_capture": [
      "decision is the first durable outcome step after triage framing",
      "the current bounded statuses are `parked`, `accepted`, and `rejected`",
      "`owner-assigned` stays deferred until the owner vocabulary is explicit"
    ]
  },
  "source_hints": {
    "telegram": {
      "invocation_examples": [
        "/idea decide idea-37 parked Revisit after the owner-assigned vocabulary lands",
        "/idea decide idea-38 accepted Ready to turn this into a governed artifact next"
      ],
      "note": "Use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` after triage. `owner-assigned` is not exposed yet."
    }
  }
}
```

## Endpoint: Capture Idea

`POST /v1/ideas/capture`

Creates or updates the initial canonical idea record in the backing system.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "source": {
    "surface": "telegram",
    "integration_id": "default",
    "context_ref": {
      "conversation_id": "-1002519919856",
      "conversation_type": "supergroup",
      "thread_id": "1"
    },
    "native_ref": {
      "command": "idea",
      "message_id": "123"
    }
  },
  "title": "Need a durable place to store deferred ideas",
  "body": "One of the most common triggers for new ideas is discussion with Codex."
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "record_system": "openproject",
  "record_ref": "openproject://work_packages/123",
  "status": "captured",
  "workflow_id": "idea-capture"
}
```

## Endpoint: Read Idea

`GET /v1/ideas/{idea_id}`

Returns the broker-owned normalized projection of the canonical record.

### Response

```json
{
  "idea_id": "idea-123",
  "workflow_id": "idea-capture",
  "record_system": "openproject",
  "record_ref": "openproject://work_packages/123",
  "status": "captured",
  "title": "Need a durable place to store deferred ideas",
  "body": "One of the most common triggers for new ideas is discussion with Codex.",
  "source": {
    "surface": "telegram",
    "integration_id": "default",
    "context_ref": {
      "conversation_id": "-1002519919856",
      "thread_id": "1"
    },
    "native_ref": {
      "command": "idea",
      "message_id": "123"
    }
  },
  "evaluation": {
    "suspected_owner": null,
    "affected_scope": [],
    "trust_boundary_areas": [],
    "confidence": null,
    "ai_assist_lane": null,
    "notes": null
  },
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "triage_summary": null,
  "operator_decision_notes": null,
  "created_at": "2026-04-18T10:00:00Z",
  "updated_at": "2026-04-18T10:00:00Z"
}
```

## Endpoint: List Ideas

`GET /v1/ideas?limit=<n>&offset=<n>&status=<status>`

Returns a bounded status-bearing projection of idea records. The broker keeps
the response normalized and paginated instead of exposing raw OpenProject
collection objects to source adapters. Source adapters may stitch multiple
pages together for an explicit "list all" command without changing this
contract.

`status` is optional. When supplied, it must be one of the canonical lifecycle
statuses:

- `captured`
- `triaged`
- `parked`
- `owner-assigned`
- `accepted`
- `rejected`
- `implemented`
- `superseded`

### Response

```json
{
  "ideas": [
    {
      "idea_id": "idea-123",
      "workflow_id": "idea-capture",
      "record_system": "openproject",
      "record_ref": "openproject://work_packages/123",
      "status": "captured",
      "title": "Need a durable place to store deferred ideas",
      "body_preview": "One of the most common triggers for new ideas is discussion with Codex.",
      "source": {
        "surface": "telegram",
        "integration_id": "default"
      },
      "created_at": "2026-04-18T10:00:00Z",
      "updated_at": "2026-04-18T10:00:00Z"
    }
  ],
  "page": {
    "count": 1,
    "has_more": false,
    "limit": 10,
    "next_offset": null,
    "offset": 1,
    "previous_offset": null,
    "total": 1
  }
}
```

## Endpoint: Lookup Idea By Source

`POST /v1/ideas/lookup`

Looks up the canonical idea record by the broker-owned source identity.

### Request

```json
{
  "source": {
    "surface": "telegram",
    "integration_id": "default",
    "context_ref": {
      "conversation_id": "-1002519919856",
      "thread_id": "1"
    },
    "native_ref": {
      "command": "idea",
      "message_id": "123"
    }
  }
}
```

## Endpoint: Triage Idea

`POST /v1/ideas/{idea_id}/triage`

Records operator-authored framing for an existing idea and moves it into the
`triaged` state.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "summary": "Needs a bounded broker workflow before later decision handling."
  }
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "record_ref": "openproject://work_packages/123",
  "record_system": "openproject",
  "status": "triaged",
  "triage_summary": "Needs a bounded broker workflow before later decision handling.",
  "updated_at": "2026-04-19T12:00:00Z",
  "workflow_id": "idea-triage"
}
```

## Endpoint: Record Decision

`POST /v1/ideas/{idea_id}/decision`

Records the first durable bounded operator outcome for an already-triaged idea.

The current bounded decision statuses are:

- `parked`
- `accepted`
- `rejected`

The broker rejects direct decision requests for `captured` items. An idea must
be triaged first.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "status": "parked",
    "notes": "Revisit after the owner-assigned vocabulary lands."
  }
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "operator_decision_notes": "Revisit after the owner-assigned vocabulary lands.",
  "record_ref": "openproject://work_packages/123",
  "record_system": "openproject",
  "status": "parked",
  "updated_at": "2026-04-19T13:15:00Z",
  "workflow_id": "idea-decision"
}
```

## Internal Endpoint: Record Evaluation Metadata

`POST /v1/ideas/{idea_id}/evaluation`

Records internal backlog metadata for later AI-assisted owner and scope
population without changing lifecycle status or exposing a Telegram command.

### Request

```json
{
  "input": {
    "suspected_owner": "repo:operator-orchestration-service",
    "affected_scope": [
      "repo:operator-orchestration-service",
      "repo:openclaw-telegram-enhanced"
    ],
    "trust_boundary_areas": ["runtime", "ai"],
    "confidence": "medium",
    "ai_assist_lane": "local",
    "notes": "Broker owns the workflow contract and Telegram remains a thin adapter."
  }
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "evaluation": {
    "suspected_owner": "repo:operator-orchestration-service",
    "affected_scope": [
      "repo:operator-orchestration-service",
      "repo:openclaw-telegram-enhanced"
    ],
    "trust_boundary_areas": ["runtime", "ai"],
    "confidence": "medium",
    "ai_assist_lane": "local",
    "notes": "Broker owns the workflow contract and Telegram remains a thin adapter."
  },
  "record_ref": "openproject://work_packages/123",
  "record_system": "openproject",
  "status": "triaged",
  "updated_at": "2026-04-19T14:00:00Z",
  "workflow_id": "idea-evaluation-metadata"
}
```

## Internal Endpoint: Consume Accepted Idea Into Delivery ART

`POST /v1/ideas/{idea_id}/consume`

Consumes an already accepted proposal into the separate OpenProject delivery
ART project while preserving the proposal record as the intake-of-record.

This endpoint is internal-only. It does not add a Telegram command surface.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "target_pi": "PI-2026-02"
  }
}
```

`input.target_pi` is optional.

### Response

```json
{
  "idea_id": "idea-123",
  "record_ref": "openproject://work_packages/123",
  "record_system": "openproject",
  "status": "accepted",
  "delivery_created": true,
  "delivery_ref": "openproject://work_packages/456",
  "delivery_record_ref": "openproject://work_packages/456",
  "delivery_record_system": "openproject",
  "delivery_status": "new",
  "delivery_pm2_phase": "Initiating",
  "target_pi": "PI-2026-02",
  "workflow_id": "accepted-idea-delivery-consume"
}
```

## Audit Expectations

Every request should be attributable at minimum by:

- operator id
- source surface
- source reference
- workflow endpoint
- correlation id
- backend write result

When AI assist is involved, audit must also capture:

- profile id or provider lane
- suggestion timestamp
- operator acceptance or override outcome

## Reserved Future Archive Placeholder

Archive is reserved as a future visibility control, not a lifecycle stage.

Reserved metadata shape:

```json
{
  "archival": {
    "archived": true,
    "archived_at": "2026-04-19T15:00:00Z",
    "archived_reason": "terminal-noise-reduction"
  }
}
```

Rules:

- archive remains future-only and is not implemented by the broker yet
- archive must not replace lifecycle status
- only terminal statuses are future archive candidates:
  - `rejected`
  - `implemented`
  - `superseded`
- active or coordination states are not archive candidates:
  - `captured`
  - `triaged`
  - `parked`
  - `owner-assigned`
  - `accepted`
- no Telegram command, broker endpoint, list behavior, or response field is
  introduced by this placeholder alone

## Accepted Idea Delivery Notes

Accepted ideas now have an explicit internal consume step into the separate
OpenProject delivery ART project.

Design rules:

- the source proposal must already be `accepted`
- the source proposal remains the proposal-of-record
- the consume step creates a linked delivery record in the ART project
- the delivery record becomes the execution-of-record
- the initial ART model is one ART, PM²-governed at the top level and
  Kanban-tracked for execution

This workflow is documented in:

- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `platform-engineering/products/openproject/delivery-art-contract.md`

The broker endpoint exists now, but no Telegram command or automatic
synchronization behavior is introduced by this step alone.

## Deferred Items

Not part of v1:

- AI-assisted `/idea triage discuss <idea-id>` suggestions
- archive visibility flag and archive-aware list behavior
- general conversational endpoints
- arbitrary tool calling
- direct mutation of workspace contracts
- promotion of ideas into Git artifacts without separate operator action

## Transitional Compatibility

To keep staged delivery safe while adapters upgrade, the broker may accept the
earlier `source` plus `source_ref` payload shape for `capture` and `lookup`.
That compatibility is temporary and is not the target contract.
