# Intake API v1

## Purpose

Define the first stable internal contract for operator workflow brokering around
idea capture and idea triage.

This is an internal service contract, not a public API.

## Design Rules

- endpoints are workflow-oriented, not generic chat endpoints
- requests must stay bounded and attributable
- operator approval remains required for durable workflow effects
- responses must be structured JSON

## Endpoint: Capture Idea

`POST /v1/ideas/capture`

Creates or updates the initial canonical idea record in the backing system.

### Request

```json
{
  "source": "telegram",
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "source_ref": {
    "chat_id": "-1002519919856",
    "topic_id": "1",
    "message_id": "123"
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
  "record_ref": "openproject://ideas/123",
  "status": "captured"
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
