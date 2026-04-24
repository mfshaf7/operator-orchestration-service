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
- roadmap-compatible `Target PI` to `version` projection
- identity provisioning
- access and clean-start admin controls

`Target PI` remains the canonical ART planning field. OpenProject `version`
is a derived compatibility projection used by roadmap-style UI surfaces and is
not a second authoritative PI field for broker callers. PI-assigned work
projects to the matching version, and work with blank `Target PI` projects to
the derived roadmap bucket `Not yet committed to a PI`.

The planning workflow is also explicit:

1. consume accepted work into one `Epic` shell
2. frame the initiative while it stays backlog-shaped
3. commit PI objectives and features during PI planning
4. elaborate user stories only for committed features
5. execute from child stories, defects, or tasks
6. review carryover and decommit work deliberately at PI boundaries

Broker planning-workflow metadata mirror:

- `src/delivery-planning-workflow.json`

That file mirrors the canonical owner contract in
`platform-engineering/products/openproject/delivery-art-planning-workflow.json`
so the broker, quality checker, and operator guidance use the same phase and
gate ids.

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

### Read Endpoints

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Command Endpoints

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`

## Delivery Work-Item API Family

### Purpose

Own bounded work-item workflow reads and writes without forcing callers to
scan the full initiative execution tree for basic resumption context.

Planning rules for this family:

- `PI Objective`, `User story`, `Task`, and `Milestone` work must carry
  `Target PI`
- PI-committed non-`Epic` work must also carry non-backlog `Iteration`
- `User story` and `Task` creation or moves require a PI-committed parent
- backlog features stay umbrella-shaped until PI commitment

### Read Endpoints

- `GET /v1/delivery-work-items/{work_item_id}/continuation-context`

### Command Endpoints

- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/complete`

### Execution Summary Contract

The execution summary should provide a stable read model for operators and
broker clients without exposing raw OpenProject query semantics.

Minimum summary shape:

- initiative identity and subject
- top-level status
- PM² phase
- target PI
- counts by status, type, PI, and assignee
- blocked item count
- dependency-blocked item count
- parked item count
- retired item count
- recursive execution tree

### Governance Contract

`POST /v1/delivery-initiatives/{delivery_id}/governance` updates only
initiative-level fields on the top-level delivery Epic.

The route is intentionally narrow:

- it does not expose generic OpenProject field patching
- it does not accept child work-item fields
- it preserves PM² and initiative meaning on the top-level Epic only

Supported governance fields are:

- `status`
- `target_pi`
- `assignee_login`
- `responsible_login`
- `pm2_phase`
- `sponsor`
- `business_objective`
- `success_criteria`
- `system_demo_evidence`
- `inspect_and_adapt_actions`
- `nfr_category`
- `description`

When `assignee_login` or `responsible_login` is supplied on the initiative
governance route, it must resolve through the same live assignable-principal
surface used for work-item writes. Initiative closeout uses those stored values
too, so top-level epics must not be forced onto a separate unsafe admin path
just to satisfy completion requirements.

### Plan Apply Contract

`POST /v1/delivery-initiatives/{delivery_id}/plan/apply` owns bounded
reconciliation for the delivery tree below one initiative.

The broker should:

- reuse or update existing nodes by `parent + type + subject`
- create new nodes only when a matching node does not already exist
- validate readiness before publishing any `ready` node
- preserve the current reconcile modes used for live proof
- keep initiative updates separate from child-item updates

Supported reconcile controls are:

- `reconcile_missing=ignore|park`
- `reconcile_decision=retire|defer`
- `reconcile_reason`
- `reconcile_retirement_reason`
- `reconcile_review_date`

The plan payload may also include an initiative-level `epic_updates` section
for the top-level Epic when the delivery plan needs to refresh initiative
meaning alongside the tree reconciliation.

#### Implemented v1 Slice

The first implemented delivery-plane routes are:

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`
- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`
- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `GET /v1/delivery-work-items/{work_item_id}/continuation-context`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/complete`

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
      "retired_count": 0,
      "total_items": 3,
      "unresolved_dependency_count": 1
    },
    "dependency_relations": [],
    "unresolved_dependency_relations": [],
    "blocked_items": [],
    "parked_items": [],
    "retired_items": [],
    "execution_tree": {}
  },
  "workflow_id": "delivery-execution-summary"
}
```

### Continuation Context Contract

`GET /v1/delivery-work-items/{work_item_id}/continuation-context` provides the
minimum resumption packet needed to continue one ART item without scanning the
full execution summary by hand.

Minimum response shape:

- initiative identity for the enclosing delivery Epic
- target work item identity and current status
- parent chain from Epic to the target parent
- open siblings under the same parent
- direct open child items under the target
- previously completed related items, tagged by relation
- dependency context for the target item
- initiative-level active and ready fronts

Example response shape:

```json
{
  "delivery_id": "delivery-38",
  "delivery_record_ref": "openproject://work_packages/38",
  "delivery_record_system": "openproject",
  "work_item_id": "work-item-177",
  "work_item_record_ref": "openproject://work_packages/177",
  "work_item_record_system": "openproject",
  "continuation_context": {
    "delivery_epic": {
      "id": 38,
      "record_ref": "openproject://work_packages/38",
      "status": "in-progress",
      "subject": "Productize governed local-agent platform",
      "type": "Epic"
    },
    "target_item": {
      "id": 177,
      "record_ref": "openproject://work_packages/177",
      "status": "in-progress",
      "subject": "Add supporting-component readiness contracts for shared stage and prod services",
      "type": "Task"
    },
    "parent_chain": [
      {
        "id": 172,
        "record_ref": "openproject://work_packages/172",
        "status": "in-progress",
        "subject": "Enabler: Standardize governed source-to-stage-to-prod release control across products and shared components",
        "type": "Feature"
      }
    ],
    "open_siblings": [
      {
        "id": 178,
        "record_ref": "openproject://work_packages/178",
        "status": "new",
        "subject": "Add aggregate fail-closed environment readiness validation and operator workflow",
        "type": "Task"
      }
    ],
    "previously_completed_related_items": [],
    "dependency_context": {
      "depends_on": [],
      "required_by": [],
      "unresolved_dependencies": []
    }
  },
  "workflow_id": "delivery-work-item-continuation-context"
}
```

### Implemented Work-Item Create Contract

The next broker-owned delivery command surface is:

- `POST /v1/delivery-work-items`

Request shape:

- required:
  - `parent_work_item_id`
  - `type`
  - `subject`
- optional:
  - `status`
  - `target_pi`
  - `execution_classification`
  - `assignee_login`
  - `responsible_login`
  - `owner_repo`
  - `description`
  - `start_date`
  - `due_date`
  - `estimated_work`
  - `remaining_work`
  - `percent_complete`
  - `delivery_team`
  - `iteration`
  - `acceptance_criteria`
  - `definition_of_ready`
  - `definition_of_done`
  - `nfr_category`
  - `pi_objective_type`
  - `planned_business_value`
  - `actual_business_value`
  - `roam_state`
  - `risk_owner`
  - `risk_review_date`
  - `risk_disposition`
  - `wsjf_user_business_value`
  - `wsjf_time_criticality`
  - `wsjf_rr_oe`
  - `wsjf_job_size`

Compatibility rules:

- `parent_work_item_id` accepts the broker-shaped form `work-item-61`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- when `assignee_login` is supplied, it must resolve to a principal that
  OpenProject exposes as assignable in the target project or work-item form
- when `responsible_login` is supplied, it must resolve to a principal that
  OpenProject exposes as assignable in the target project or work-item form
- operator workflow preflight should read the live assignable-principal list
  before setting those fields, using the broker-pod helper:
  `node scripts/show_delivery_art_assignables.mjs`
- the broker resolves delivery custom fields from the live OpenProject form
  schema instead of requiring a large static custom-field-id registry
- `status=done` is intentionally rejected
- `target_pi` drives the writable delivery PI signal used by the broker-owned
  workflow surface; platform-owned view sync remains responsible for PI board
  convergence
- structural types are:
  - `Epic`
  - `PI Objective`
  - `Feature`
  - `User story`
  - `Defect`
  - `Task`
  - `Milestone`
  - `Risk`
- `Enabler` and `Improvement` are not structural types
  - express them through `execution_classification` on `Feature` or
    `User story`

Example request shape:

```json
{
  "input": {
    "parent_work_item_id": "work-item-61",
    "type": "User story",
    "execution_classification": "Enabler",
    "subject": "Brokerize delivery work-item move",
    "status": "ready",
    "target_pi": "PI-2026-02",
    "owner_repo": "operator-orchestration-service",
    "assignee_login": "operator-orchestration-service",
    "responsible_login": "operator-orchestration-service",
    "delivery_team": "Workflow Integration",
    "iteration": "PI-2026-02 / Iteration 2",
    "acceptance_criteria": "- Operator can create one child task through the broker."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-69",
  "work_item_record_ref": "openproject://work_packages/69",
  "work_item_record_system": "openproject",
  "parent_work_item_id": "work-item-61",
  "work_item": {
    "assigneeLogin": "Operator Orchestration-Service",
    "descriptionPresent": true,
    "executionClassification": "Enabler",
    "parentId": 61,
    "recordRef": "openproject://work_packages/69",
    "status": "ready",
    "subject": "Enabler: Brokerize delivery work-item move",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "creation_applied": {
    "execution_classification": "Enabler",
    "status": "ready",
    "target_pi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-create"
}
```

### Implemented Work-Item Update Contract

The first broker-owned delivery command surface is:

- `POST /v1/delivery-work-items/{work_item_id}/update`

Current compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-56`
- the broker also accepts a raw numeric OpenProject work package id during the
  migration period
- allowed request fields in this first slice:
  - `status`
  - `target_pi`
  - `clear_target_pi`
  - `assignee_login`
  - `clear_assignee`
  - `responsible_login`
  - `clear_responsible`
  - `description`
  - `clear_description`
  - `work_note`
  - `start_date`
  - `clear_start_date`
  - `due_date`
  - `clear_due_date`
  - `estimated_work`
  - `clear_estimated_work`
  - `remaining_work`
  - `clear_remaining_work`
  - `percent_complete`
  - `owner_repo`
  - `delivery_team`
  - `iteration`
  - `acceptance_criteria`
  - `definition_of_ready`
  - `definition_of_done`
  - `nfr_category`
  - `pi_objective_type`
  - `planned_business_value`
  - `actual_business_value`
  - `roam_state`
  - `risk_owner`
  - `risk_review_date`
  - `risk_disposition`
  - `wsjf_user_business_value`
  - `wsjf_time_criticality`
  - `wsjf_rr_oe`
  - `wsjf_job_size`
- `status=done` is intentionally rejected
  - evidence-backed completion remains a separate workflow

### Implemented Work-Item Bulk Update Contract

The broker-owned batch execution surface is:

- `POST /v1/delivery-work-items/bulk-update`

Request shape:

- required:
  - `schema_version`
  - `updates`
- each update entry requires:
  - `target_work_package_id`
- each update entry otherwise accepts the same bounded fields as the single
  `update` route

Compatibility rules:

- `schema_version` must equal `1`
- batch execution applies the same broker validation used by the single-item
  update route
- the broker stops on the first invalid or missing work item instead of hiding
  failures behind partial direct-runner behavior

Example request shape:

```json
{
  "input": {
    "status": "in-progress",
    "target_pi": "PI-2026-02",
    "assignee_login": "operator-orchestration-service",
    "responsible_login": "operator-orchestration-service",
    "work_note": "Started broker update implementation."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-56",
  "work_item_record_ref": "openproject://work_packages/56",
  "work_item_record_system": "openproject",
  "work_item": {
    "assigneeLogin": "Operator Orchestration-Service",
    "description": "## Purpose\n\nBroker mapping is underway.",
    "descriptionHeadings": [
      "Purpose",
      "Operator work notes"
    ],
    "descriptionPresent": true,
    "recordRef": "openproject://work_packages/56",
    "status": "in-progress",
    "subject": "Add bounded delivery work-item update mapping in the broker service layer",
    "targetPi": "PI-2026-02",
    "type": "Task",
    "updatedAt": "2026-04-21T02:12:00Z"
  },
  "changes_applied": {
    "status": {
      "from": "ready",
      "to": "in-progress"
    },
    "target_pi": {
      "from": null,
      "to": "PI-2026-02"
    },
    "assignee_login": {
      "from": null,
      "to": "admin"
    },
    "description": {
      "from_present": true,
      "to_present": true
    },
    "work_note": {
      "applied": true
    }
  },
  "workflow_id": "delivery-work-item-update"
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
- `POST /v1/delivery-work-items/bulk-update`
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

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/move`

Request shape:

- required:
  - `new_parent_work_item_id`
- optional:
  - `work_note`

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-63`
- `new_parent_work_item_id` accepts the broker-shaped form `work-item-75`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- the route is intentionally limited to delivery hierarchy mutation, not
  generic structure editing

The broker should reject moves that would:

- cross initiative boundaries silently
- create parent loops
- move into unsupported parent type relationships
- create duplicate sibling placement under the new parent

Example request shape:

```json
{
  "input": {
    "new_parent_work_item_id": "work-item-75",
    "work_note": "Move this task under the new broker feature parent."
  }
}
```

Example response shape:

```json
{
  "work_item_id": "work-item-63",
  "work_item_record_ref": "openproject://work_packages/63",
  "work_item_record_system": "openproject",
  "parent_work_item_id": "work-item-75",
  "previous_parent_work_item_id": "work-item-61",
  "work_item": {
    "descriptionPresent": true,
    "executionClassification": "Enabler",
    "parentId": 75,
    "recordRef": "openproject://work_packages/63",
    "status": "ready",
    "subject": "Enabler: Brokerize delivery work-item move",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "changes_applied": {
    "parent": {
      "from": 61,
      "to": 75
    },
    "work_note": {
      "applied": true
    }
  },
  "note_applied": "description_section",
  "workflow_id": "delivery-work-item-move"
}
```

### Blocker Contract

Record or clear blocker governance on one work item.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/blocker`

Request shape:

- required:
  - `action`
- required for `action=set`:
  - `blocker_statement`
  - `blocker_impact`
  - `blocker_owner`
  - `blocker_discovered_on`
  - `blocker_decision_path`
  - `blocker_justification`
- conditionally required for `action=set` when `blocker_decision_path != remove`:
  - `blocker_follow_up_owner`
  - `blocker_review_date`
- required for `action=clear`:
  - `resume_status`

Minimum blocker semantics:

- blocker statement
- blocker impact
- blocker owner
- blocker discovered date
- decision path
- justification
- follow-up owner
- optional review date

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-64`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- `resume_status` must not be `blocked`
- `blocker_discovered_on` and `blocker_review_date` must be ISO dates
  (`YYYY-MM-DD`) when provided

Example request shape:

```json
{
  "input": {
    "action": "set",
    "blocker_statement": "Broker blocker route is under live proof in devint.",
    "blocker_impact": "Task #64 cannot complete until set and clear semantics are verified against OpenProject.",
    "blocker_owner": "mfshaf7",
    "blocker_discovered_on": "2026-04-21",
    "blocker_decision_path": "workaround",
    "blocker_justification": "Use the broker route itself for proof, then clear the blocker back to active execution.",
    "blocker_follow_up_owner": "mfshaf7",
    "blocker_review_date": "2026-04-21"
  }
}
```

Example response shape:

```json
{
  "action_applied": "set",
  "blocker": {
    "statement": "Broker blocker route is under live proof in devint.",
    "impact": "Task #64 cannot complete until set and clear semantics are verified against OpenProject.",
    "owner": "mfshaf7",
    "discovered_on": "2026-04-21",
    "decision_path": "workaround",
    "justification": "Use the broker route itself for proof, then clear the blocker back to active execution.",
    "follow_up_owner": "mfshaf7",
    "review_date": "2026-04-21"
  },
  "changes_applied": {
    "status": {
      "from": "in-progress",
      "to": "blocked"
    }
  },
  "work_item_id": "work-item-64",
  "work_item_record_ref": "openproject://work_packages/64",
  "work_item_record_system": "openproject",
  "work_item": {
    "executionClassification": "Enabler",
    "recordRef": "openproject://work_packages/64",
    "status": "blocked",
    "subject": "Enabler: Brokerize delivery blocker management",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-blocker"
}
```

### Dependency Contract

Record or clear explicit predecessor relationships between delivery items.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/dependency`

Request shape:

- required:
  - `action`
  - `depends_on_work_item_id`
- optional for `action=set`:
  - `lag`
  - `clear_lag`
  - `description`
  - `clear_description`

Minimum dependency semantics:

- predecessor identity
- successor identity
- optional lag
- optional description

Compatibility rules:

- `work_item_id` and `depends_on_work_item_id` accept the broker-shaped form
  `work-item-65`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- a work item cannot depend on itself
- `lag` and `clear_lag=true` are mutually exclusive
- `description` and `clear_description=true` are mutually exclusive
- both work items must belong to the configured delivery project
- the broker preserves operator semantics:
  - the target work item depends on the predecessor work item
  - the underlying OpenProject relation is created as `follows` from the
    predecessor to the target
- duplicate dependency rows for the same predecessor-target pair are collapsed
  during `action=set`

Example request shape:

```json
{
  "input": {
    "action": "set",
    "depends_on_work_item_id": "work-item-67",
    "lag": 2,
    "description": "Governance update must land before plan-reconcile brokerization starts."
  }
}
```

Example response shape:

```json
{
  "action_applied": "set",
  "created": false,
  "depends_on_work_item_id": "work-item-67",
  "relation": {
    "id": 12,
    "relation_type": "follows",
    "lag": 2,
    "description": "Governance update must land before plan-reconcile brokerization starts.",
    "depends_on": {
      "id": 67,
      "record_ref": "openproject://work_packages/67",
      "subject": "Enabler: Brokerize delivery initiative governance update",
      "status": "ready"
    },
    "target": {
      "id": 70,
      "record_ref": "openproject://work_packages/70",
      "subject": "Enabler: Brokerize delivery plan apply and reconciliation",
      "status": "new"
    }
  },
  "removed_duplicate_relation_ids": [
    13
  ],
  "target_work_item_id": "work-item-70",
  "updated": true,
  "workflow_id": "delivery-work-item-dependency"
}
```

### Parking Contract

Park or resume a work item without hard deletion.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/parking`

Request shape:

- required:
  - `action`
- required for `action=park`:
  - `park_decision`
  - `park_reason`
- conditionally required for `action=park` when `park_decision=defer`:
  - `park_review_date`
- conditionally required for `action=park` when `park_decision=retire`:
  - `retirement_reason`
- required for `action=resume`:
  - `resume_status`
- optional:
  - `work_note`

Minimum parking semantics:

- park decision
- park reason or note
- resume status when unparked

Parked work items remain in history and reporting, but are hidden from active
execution views by default.

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-66`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- `park_decision` must be `defer` or `retire`
- `park_review_date` must be an ISO date (`YYYY-MM-DD`) when required
- `retirement_reason` is required only for `park_decision=retire`
- `resume_status` must not be `parked` or `retired`
- parking clears active blocker fields on the same work item
- execution-summary read models treat both `parked` and `retired` as inactive
  scope when `include_parked=false`

Example request shape:

```json
{
  "input": {
    "action": "park",
    "park_decision": "defer",
    "park_reason": "Keep this task out of active scope until the next slice starts.",
    "park_review_date": "2026-05-01",
    "work_note": "Parking proof is running through the broker route."
  }
}
```

Example response shape:

```json
{
  "action_applied": "park",
  "changes_applied": {
    "status": {
      "from": "ready",
      "to": "parked"
    },
    "work_note": {
      "applied": true
    }
  },
  "note_applied": "description_section",
  "parking": {
    "decision": "defer",
    "reason": "Keep this task out of active scope until the next slice starts.",
    "review_date": "2026-05-01",
    "retirement_reason": null
  },
  "work_item_id": "work-item-66",
  "work_item_record_ref": "openproject://work_packages/66",
  "work_item_record_system": "openproject",
  "work_item": {
    "executionClassification": "Enabler",
    "recordRef": "openproject://work_packages/66",
    "status": "parked",
    "subject": "Enabler: Brokerize delivery parking and resume",
    "targetPi": "PI-2026-02",
    "type": "User story"
  },
  "workflow_id": "delivery-work-item-parking"
}
```

### Completion Contract

Complete one delivery work item through evidence-backed closeout semantics.

Implemented route:

- `POST /v1/delivery-work-items/{work_item_id}/complete`

Request shape:

- required:
  - `completion_summary`
  - `changed_surfaces`
  - `test_result_evidence`
  - `validation_evidence`
- optional:
  - `completion_note`
  - `residual_follow_up`
  - `test_result_artifact`

Compatibility rules:

- `work_item_id` accepts the broker-shaped form `work-item-181`
- the broker also accepts raw numeric OpenProject work package ids during the
  migration period
- completion is a separate workflow and is not available through generic
  `update`
- `update` revalidates the done-state narrative contract before patching
  OpenProject whenever the resulting work item remains `done`
- completion rejects work items that still have active blocker state
- completion rejects work items with missing required execution-contract fields
- completion rejects any work item that still has descendants outside `done` or
  `retired`
- parent items must not close before the full child tree is terminal
- completion evidence must satisfy the ART attestation formatting rules before
  the broker patches the OpenProject record
- the broker validates the final stored body after any broker-added note, not
  just the user-supplied completion payload
- done-state descriptions must also satisfy the stronger narrative contract
  before the broker patches the OpenProject record
- broker-added completion or work notes must stay inside `Operator work notes`
  rather than leaking into evidence sections
- `Execution Context` must stay a flat bullet list and keep the stored:
  - `Owner repo`
  - `Parent item` when a parent exists
  - `Delivery team` when that field is set
  - `Iteration` when that field is set
- `test_result_evidence` lines must start with:
  - `- PASS:`
  - `- FAIL:`
  - `- NOT APPLICABLE:`
  - `- Attached artifact:`
- `validation_evidence` lines must start with:
  - `- PASS:`
  - `- FAIL:`
  - `- CHECK:`
  - `- NOT APPLICABLE:`
  - `- Attached artifact:`
- use the local preflight before the broker write:
  - `npm run validate:completion-evidence -- <payload.json>`

Execution-summary reads surface the same closeout signal for done items:

- `done_narrative_contract_applicable`
- `done_narrative_contract_satisfied`
- `done_narrative_contract_issues`

This keeps parent closeout honest even when a merged repo slice exists before
the ART child tree is actually finished.

## Operator Surface Rule

These broker routes are the supported delivery execution surface.

`platform-engineering` may keep direct OpenProject runners only for bootstrap,
break-glass recovery, ART quality validation, and one-time normalization. It
must not reintroduce product-local delivery execution scripts or a second
operator-facing command family for ART reads and writes.

## Related Sources

- `docs/architecture/overview.md`
- `docs/architecture/runtime-shape.md`
- `docs/architecture/delivery-workflow-api-boundary.md`
- `docs/contracts/openproject-adapter-v1.md`
- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `docs/contracts/accepted-idea-delivery-closeout-v1.md`
