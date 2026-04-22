# Audit Events v1

## Purpose

Define the minimum structured audit events for brokered operator workflows.

## Event Families

Phase 1 should emit at least these event families:

- `workflow.catalog.served`
- `workflow.descriptor.served`
- `idea.capture.requested`
- `idea.capture.recorded`
- `idea.record.read`
- `idea.record.lookup`
- `idea.triage.requested`
- `idea.triage.recorded`
- `idea.decision.requested`
- `idea.decision.recorded`
- `idea.evaluation.requested`
- `idea.evaluation.recorded`
- `backend.openproject.write`
- `delivery.initiative.governance_updated`
- `delivery.plan.applied`

## Required Shared Fields

Every event should include:

- `event_type`
- `timestamp`
- `correlation_id`
- `caller.id`

When the workflow is actor-initiated or source-bound, also include:

- `operator.id`
- `source.surface`
- source identity or lookup ref

## AI-Specific Fields

When an event uses AI assist, include:

- `ai.provider_lane`
- `ai.profile_id` when governed-profile based
- `ai.decision_id`
- `ai.confidence`

Current phase-1 operator-authored triage does not emit AI-specific fields. If a
future AI-assisted discussion path is added, it may introduce an additional
event such as `idea.triage.suggested`.

## Backend Fields

For backend write events, include:

- `backend.system`
- `backend.target_ref`
- `backend.result`

For delivery plan application events, include bounded counters for the plan
result when they are available:

- `created_count`
- `updated_count`
- `reused_count`
- `deferred_count`
- `retired_count`

## Outcome Fields

Decision and backend result events should include:

- `outcome`
- `status`
- `error_class` when applicable

## Logging Direction

Phase 1 recommendation:

- emit structured JSON logs to stdout
- keep the event schema stable and documented here

If a future durable audit store is added, it should ingest the same event shape
rather than redefining the contract.
