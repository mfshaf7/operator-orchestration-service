# Intake API v1

## Purpose

Define the first stable internal contract for operator workflow brokering around
idea capture, idea visibility, and idea triage.

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
        "triage": false,
        "decision": false,
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
        "triage": false,
        "decision": false,
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
  "lifecycle_note": "The canonical backlog supports the full status model now. Telegram currently exposes capture, list, list all, and show; later status moves remain broker and backlog managed until triage and decision actions are enabled.",
  "lifecycle_statuses": [
    {
      "status": "captured",
      "meaning": "Raw record exists, but no approved triage or ownership decision exists yet.",
      "next_step": "Review the captured record, then move it into triage or park it in the canonical backlog."
    },
    {
      "status": "triaged",
      "meaning": "An operator accepted the initial triage and the idea now has a clearer shape.",
      "next_step": "Confirm the framing, assign the right proposal type or owner, or park it if it is not ready."
    }
  ],
  "operator_guidance": {
    "what_to_send": [
      "use `/idea <text>` to capture a new idea",
      "use `/idea list` to review the recent idea slice",
      "use `/idea list all` to review every stored idea through broker pagination",
      "use `/idea show <idea-id>` to inspect one stored idea record"
    ],
    "after_capture": [
      "each reply includes the canonical idea id, record reference, and current status",
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
          "invocation": "/idea list",
          "purpose": "Show the recent stored idea slice with current statuses."
        },
        {
          "invocation": "/idea list all",
          "purpose": "Show the full stored idea backlog through broker pagination."
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
        "/idea list",
        "/idea list all",
        "/idea show <idea-id>",
        "/idea help"
      ]
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
      ]
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

`GET /v1/ideas?limit=<n>&offset=<n>`

Returns a bounded status-bearing projection of idea records. The broker keeps
the response normalized and paginated instead of exposing raw OpenProject
collection objects to source adapters. Source adapters may stitch multiple
pages together for an explicit "list all" command without changing this
contract.

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

Requests a bounded structured suggestion for an existing idea.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "summary": "Need a place to store architecture ideas that are not implementation-ready yet.",
    "discussion_excerpt": "Ideas often emerge during discussion with Codex.",
    "bounded_context_refs": [
      "telegram://openclaw-stage/-1002519919856?messages=123,124"
    ]
  }
}
```

### Response

```json
{
  "decision_id": "triage-456",
  "summary": "Capture deferred architecture ideas in a canonical backlog before they become Git artifacts.",
  "suggested_type": "governance-proposal",
  "suggested_owner": "workspace-governance",
  "suggested_status": "triaged",
  "affected_scope": [
    "workspace-governance",
    "openproject",
    "openclaw-telegram-enhanced"
  ],
  "confidence": "medium",
  "why": [
    "cross-repo governance concern",
    "not implementation-ready yet",
    "best canonical store is OpenProject"
  ]
}
```

## Endpoint: Record Decision

`POST /v1/ideas/{idea_id}/decision`

Records the operator outcome for a prior suggestion and updates the backing
system.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "decision_id": "triage-456",
  "action": "accept",
  "edits": {
    "suggested_owner": "workspace-governance"
  }
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "decision_id": "triage-456",
  "status": "triaged",
  "record_ref": "openproject://ideas/123"
}
```

## Audit Expectations

Every request should be attributable at minimum by:

- operator id
- source surface
- source reference
- workflow endpoint
- correlation or decision id
- backend write result

When AI assist is involved, audit must also capture:

- profile id or provider lane
- suggestion timestamp
- operator acceptance or override outcome

## Deferred Items

Not part of v1:

- general conversational endpoints
- arbitrary tool calling
- direct mutation of workspace contracts
- promotion of ideas into Git artifacts without separate operator action

## Transitional Compatibility

To keep staged delivery safe while adapters upgrade, the broker may accept the
earlier `source` plus `source_ref` payload shape for `capture` and `lookup`.
That compatibility is temporary and is not the target contract.
