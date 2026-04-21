# Delivery Workflow API v1

## Purpose

Define the next broker-owned internal API families for delivery execution after
the proposal-plane handoff is complete.

This contract extends the current bounded broker model from:

- proposal-plane lifecycle under `/v1/ideas/...`

into:

- delivery-initiative workflow under `/v1/delivery-initiatives/...`
- delivery work-item workflow under `/v1/delivery-work-items/...`

It does not turn the broker into a generic OpenProject proxy.

## Design Position

The durable split is:

- `Workspace Proposals`
  - canonical proposal-of-record
  - lifecycle brokered through `/v1/ideas/...`
- `Workspace Delivery ART`
  - canonical execution-of-record
  - workflow brokered through the delivery API families in this document

OpenProject remains the canonical backend. The broker owns:

- intent-shaped workflow commands
- bounded validation and read projection
- audit, correlation, and caller auth at the workflow seam

`platform-engineering` continues to own:

- OpenProject runtime and bootstrap
- project schema provisioning
- board and view sync
- identity provisioning
- access and clean-start admin controls

## Non-Goals

This contract does not introduce:

- generic OpenProject CRUD passthrough
- public ingress
- Telegram delivery-management commands
- multi-ART routing
- solution-train coordination

## Identity Model

The broker should expose a broker-owned delivery identity rather than forcing
callers to use raw OpenProject ids forever.

Recommended response fields:

- `delivery_id`
- `delivery_ref`
- `delivery_record_ref`
- `delivery_record_system`

Current compatibility rule:

- `delivery_ref` and `delivery_record_ref` continue to carry the durable
  OpenProject-style reference such as `openproject://work_packages/77`
- the broker may accept raw OpenProject numeric ids during migration, but that
  is not the long-term caller contract

## Delivery Initiative API Family

### Purpose

Own top-level execution workflow for one delivery initiative.

### Planned Read Endpoints

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Planned Command Endpoints

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`

### Execution Summary Contract

The execution summary should provide a stable read model for operators and thin
platform wrappers without exposing raw OpenProject query semantics.

Minimum summary shape:

- initiative identity and subject
- top-level status
- PM² phase
- target PI
- counts by status, type, PI, and assignee
- blocked item count
- dependency-blocked item count
- parked item count
- recursive execution tree

#### Implemented v1 Slice

The first implemented delivery-plane route is:

- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`

Current compatibility rules:

- `delivery_id` accepts the broker-shaped form `delivery-38`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- query flags:
  - `include_done=true|false`
  - `include_parked=true|false`

Example response shape:

```json
{
  "delivery_id": "delivery-38",
  "delivery_record_ref": "openproject://work_packages/38",
  "delivery_record_system": "openproject",
  "execution_summary": {
    "epic": {
      "id": 38,
      "record_ref": "openproject://work_packages/38",
      "status": "in-progress",
      "subject": "Productize governed local-agent platform",
      "type": "Epic"
    },
    "summary": {
      "blocked_count": 1,
      "by_assignee": {
        "_none_": 2,
        "admin": 1
      },
      "by_status": {
        "blocked": 1,
        "in-progress": 1,
        "new": 1
      },
      "by_target_pi": {
        "PI-2026-02": 2,
        "_none_": 1
      },
      "by_type": {
        "Feature": 1,
        "Task": 2
      },
      "dependency_blocked_count": 1,
      "dependency_count": 1,
      "include_done": true,
      "include_parked": false,
      "parked_count": 0,
      "total_items": 3,
      "unresolved_dependency_count": 1
    },
    "dependency_relations": [],
    "unresolved_dependency_relations": [],
    "blocked_items": [],
    "parked_items": [],
    "execution_tree": {}
  },
  "workflow_id": "delivery-execution-summary"
}
```

### Closeout Readiness Contract

The closeout-readiness surface should answer whether terminal proposal closeout
is allowed without executing closeout itself.

Minimum result shape:

- `ready_for_closeout`
- unmet checks such as:
  - initiative not `done`
  - open descendants present
  - active blockers present
  - unresolved dependencies present

## Delivery Work Item API Family

### Purpose

Own bounded workflow commands for child execution items inside one delivery
initiative.

### Planned Endpoints

- `POST /v1/delivery-work-items`
- `GET /v1/delivery-work-items/{work_item_id}`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/parking`

### Create Contract

Create one bounded child item under an existing initiative or parent item.

Minimum request intent:

- parent identity
- work item type
- subject
- optional status
- optional target PI
- optional assignee
- optional description

The broker should reject duplicate sibling intent when the target parent, type,
and subject already describe the same active work item.

### Update Contract

Update one existing work item through explicit workflow fields only.

Allowed fields in v1:

- status
- target PI
- assignee
- description
- work note

The broker must not accept arbitrary field bags.

### Move Contract

Move one work item to a different valid parent within the same delivery
initiative.

The broker should reject moves that would:

- cross initiative boundaries silently
- create parent loops
- move into unsupported parent type relationships

### Blocker Contract

Record or clear blocker governance on one work item.

Minimum blocker semantics:

- blocker statement
- blocker impact
- blocker owner
- decision path
- justification
- follow-up owner
- optional review date

### Dependency Contract

Record or clear explicit predecessor relationships between delivery items.

Minimum dependency semantics:

- predecessor identity
- successor identity
- optional lag
- optional description

### Parking Contract

Park or resume a work item without hard deletion.

Minimum parking semantics:

- park decision
- park reason or note
- resume status when unparked

Parked work items remain in history and reporting, but are hidden from active
execution views by default.

## Platform Wrapper Rule

Existing `make openproject-*` entrypoints may remain as the primary operator
surface, but for workflow-shaped delivery operations they should become thin
wrappers over these broker APIs.

That includes:

- initiative governance update
- execution summary
- plan apply
- closeout readiness
- create/update/move work item
- blocker, dependency, and parking management

## First Implementation Slice

The first implementation slice should stay small:

1. `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
2. `POST /v1/delivery-work-items/{work_item_id}/update`

This gives the broker:

- one real delivery read model
- one bounded execution command

without forcing the entire delivery operator surface to migrate at once.

## Related Sources

- `docs/architecture/overview.md`
- `docs/architecture/runtime-shape.md`
- `docs/architecture/delivery-workflow-api-boundary.md`
- `docs/contracts/openproject-adapter-v1.md`
- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `docs/contracts/accepted-idea-delivery-closeout-v1.md`
