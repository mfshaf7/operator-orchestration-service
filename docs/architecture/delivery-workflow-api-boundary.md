# Delivery Workflow API Boundary

## Purpose

Define which current OpenProject delivery operations belong in the broker as
workflow APIs and which must remain in `platform-engineering` as OpenProject
runtime or admin controls.

This document exists because the first accepted-idea delivery slice proved the
workflow model while `platform-engineering/products/openproject` still carried
transitional execution scripts. That transitional surface is now retired.

## Boundary Rules

The durable split is:

- `governance-operations-console`
  - is the future primary normal operator workplace
  - owns presentation, operator intent capture, and interaction state
  - does not own canonical workflow state machines, evidence derivation, or
    backend mutation authority
- `operator-orchestration-service`
  - owns workflow-shaped delivery commands and read models
  - owns audit, correlation, bounded validation, and caller auth at that seam
  - must not become a generic OpenProject CRUD proxy
- `platform-engineering`
  - owns OpenProject runtime, bootstrap, access, identity provisioning, and
    platform-admin controls
  - owns ART quality validation and one-time normalization controls
  - does not own delivery execution reads or writes

The broker plane should stay intent-shaped:

- good: `POST /v1/delivery-work-items/{id}/blocker`
- bad: `PATCH /v1/openproject/work-packages/{id}` with arbitrary fields

The same API must support Console, CLI, and approved channel adapters. CLI-only
or handcrafted-file-only workflow behavior is transitional and cannot be the
completion boundary for a governed capability.

## Current Broker Baseline

The broker already owns the proposal-plane lifecycle:

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`

Those routes establish the intended boundary: proposal truth stays under
`ideas`, and the broker owns bounded cross-plane transitions.

The broker now also owns the first delivery initiative command slice:

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`

Those routes keep PM² and initiative meaning on the top-level Epic while the
plan-apply path reuses and reconciles child nodes instead of acting as a
generic OpenProject CRUD surface.

## Target Delivery API Families

The delivery workflow plane is broker-owned internal API surface:

- `/v1/delivery-initiatives/...`
- `/v1/delivery-work-items/...`

These families should carry the workflow meaning for delivery execution while
OpenProject remains the canonical execution backend.

## Command Classification

The durable split now falls into two classes.

### Stay Platform Admin Or Runtime Control

These commands should remain owned by `platform-engineering` because they
control OpenProject runtime, project bootstrap, or platform-admin surfaces:

| Current command | Reason it stays platform-side |
| --- | --- |
| `openproject_apply.sh` | deploys or reconciles the OpenProject runtime |
| `openproject_status.sh` | reports platform runtime status, not workflow truth |
| `openproject_access.sh` | operator access path and local exposure control |
| `openproject_sync_admin_password.sh` | admin credential synchronization |
| `openproject_configure_idea_backlog.sh` | proposal project bootstrap and schema provisioning |
| `openproject_configure_delivery_art.sh` | delivery project bootstrap and schema provisioning |
| `openproject_sync_delivery_art_views.sh` | board/query/view provisioning in OpenProject |
| `openproject_verify_clean_start.sh` | production activation hygiene and data-plane gating |
| `openproject_provision_operator_orchestration_identity.sh` | broker identity/access provisioning in OpenProject |
| `openproject_uninstall.sh` | destructive product/runtime removal |

`make openproject-provision-operator-orchestration-delivery-access` belongs in
the same class even though its shell entrypoint is currently folded into the
identity provisioning path.

### Broker-Owned Execution Plane

These workflow operations are now broker-only. They are not supported as
product-local execution scripts anymore:

- proposal consume and closeout
- delivery initiative reads
- delivery planning and PI-objective reads
- delivery initiative governance and plan apply
- system-demo, inspect-and-adapt, and PI review recording
- delivery work-item create, update, move, blocker, dependency, parking, bulk
  update, and completion

## Enforcement Rules

The boundary must not:

- expose a public delivery-management ingress
- create a generic OpenProject passthrough endpoint family
- move project/bootstrap/admin controls into the broker
- recreate product-local delivery execution scripts in `platform-engineering`

## Current State

The broker now owns the active delivery read and write surface used for:

- initiative portfolio reads
- initiative execution reads
- planning reads
- PI-objective reads
- closeout readiness reads
- initiative governance and plan apply
- system-demo, inspect-and-adapt, and PI review recording
- work-item create, bulk update, update, move, blocker, dependency, parking,
  and complete

Platform-side execution scripts are no longer part of the supported operator
model.

## Out Of Scope For This Boundary

This document does not change the current intentional scope limits:

- no Telegram delivery-management command surface
- no generic OpenProject CRUD API
- no multi-ART routing or solution-train workflow
- no separate product-governed source-to-stage-to-prod maturity model for
  OpenProject

## Related Sources

- [docs/architecture/overview.md](overview.md)
- [docs/architecture/runtime-shape.md](runtime-shape.md)
- [docs/contracts/openproject-adapter-v1.md](../contracts/openproject-adapter-v1.md)
- [docs/contracts/accepted-idea-delivery-consumption-v1.md](../contracts/accepted-idea-delivery-consumption-v1.md)
- [docs/contracts/accepted-idea-delivery-closeout-v1.md](../contracts/accepted-idea-delivery-closeout-v1.md)
- [platform-engineering/products/openproject/scripts/README.md](https://github.com/mfshaf7/platform-engineering/blob/main/products/openproject/scripts/README.md)
