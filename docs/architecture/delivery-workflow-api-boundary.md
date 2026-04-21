# Delivery Workflow API Boundary

## Purpose

Define which current OpenProject delivery operations belong in the broker as
workflow APIs and which must remain in `platform-engineering` as OpenProject
runtime or admin controls.

This document exists because the first accepted-idea delivery slice proved the
workflow model, but the execution surfaces were still implemented as direct
OpenProject operator scripts in `platform-engineering/products/openproject`.

That was acceptable while the execution semantics were still changing quickly.
It is no longer the best long-term product shape.

## Boundary Rules

The durable split is:

- `operator-orchestration-service`
  - owns workflow-shaped delivery commands and read models
  - owns audit, correlation, bounded validation, and caller auth at that seam
  - must not become a generic OpenProject CRUD proxy
- `platform-engineering`
  - owns OpenProject runtime, bootstrap, access, identity provisioning, and
    platform-admin controls
  - may keep thin operator wrappers that call broker-owned internal APIs

The broker plane should stay intent-shaped:

- good: `POST /v1/delivery-work-items/{id}/blocker`
- bad: `PATCH /v1/openproject/work-packages/{id}` with arbitrary fields

## Current Broker Baseline

The broker already owns the proposal-plane lifecycle:

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`

Those routes prove the correct boundary shape: proposal truth stays under
`ideas`, and the broker owns bounded cross-plane transitions.

## Target Delivery API Families

The next workflow plane should be added as broker-owned internal APIs:

- `/v1/delivery-initiatives/...`
- `/v1/delivery-work-items/...`

These families should own workflow meaning for delivery execution while leaving
OpenProject as the canonical execution backend.

## Command Classification

The current OpenProject delivery command catalog in
`platform-engineering/products/openproject/scripts/README.md` falls into three
classes.

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

### Remain Thin Platform Wrappers Over Existing Broker APIs

These commands are already broker-owned in meaning. The platform command may
continue to exist for operator convenience, but it should only wrap the broker
API:

| Current command | Existing broker route |
| --- | --- |
| `openproject_consume_accepted_idea.sh` | `POST /v1/ideas/{idea_id}/consume` |
| `openproject_close_delivery_initiative.sh` | `POST /v1/ideas/{idea_id}/closeout` |

### Migrate Behind New Broker Delivery APIs

These commands are workflow-shaped delivery operations. They should move behind
new internal broker APIs and remain callable from thin platform wrappers:

| Current command | Target API family | Why it belongs in the broker |
| --- | --- | --- |
| `openproject_update_delivery_initiative.sh` | `delivery-initiatives` | updates delivery governance state and PM² meaning |
| `openproject_show_delivery_initiatives.sh` | `delivery-initiatives` | portfolio read model for delivery workflow truth |
| `openproject_show_delivery_execution.sh` | `delivery-initiatives` | initiative execution read model with blockers and dependencies |
| `openproject_check_delivery_closeout_readiness.sh` | `delivery-initiatives` | workflow preflight gate for terminal transition |
| `openproject_apply_delivery_plan.sh` | `delivery-initiatives` | bounded decomposition and reconciliation workflow |
| `openproject_create_delivery_work_item.sh` | `delivery-work-items` | intent-shaped child creation under delivery control |
| `openproject_move_delivery_work_item.sh` | `delivery-work-items` | hierarchy correction is workflow semantics, not platform admin |
| `openproject_update_delivery_work_item.sh` | `delivery-work-items` | bounded execution updates for one work item |
| `openproject_manage_delivery_dependency.sh` | `delivery-work-items` | dependency meaning belongs with delivery workflow control |
| `openproject_manage_delivery_blocker.sh` | `delivery-work-items` | blocker governance is workflow behavior |
| `openproject_manage_delivery_parking.sh` | `delivery-work-items` | park/resume decisions are workflow lifecycle operations |

## Migration Rules

The migration should preserve the current operator surface while moving meaning
into the broker:

1. keep `make openproject-*` entrypoints as the primary operator surface
2. implement broker-owned internal delivery APIs
3. convert platform commands into thin wrappers over those APIs
4. keep direct OpenProject rails-runner logic only for platform-admin commands

The migration must not:

- expose a public delivery-management ingress
- create a generic OpenProject passthrough endpoint family
- move project/bootstrap/admin controls into the broker

## First Migration Slice

The first migration slice should be small but high-leverage:

1. one read model:
   - delivery execution summary
2. one command surface:
   - delivery work-item update

That gives the broker both:

- a real delivery read surface beyond proposal truth
- one bounded execution command beyond consume/closeout

## Out Of Scope For This Boundary

This document does not change the current intentional scope limits:

- no Telegram delivery-management command surface
- no generic OpenProject CRUD API
- no multi-ART routing or solution-train workflow
- no separate OpenClaw-style source-to-stage-to-prod maturity model for
  OpenProject

## Related Sources

- `docs/architecture/overview.md`
- `docs/architecture/runtime-shape.md`
- `docs/contracts/openproject-adapter-v1.md`
- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `docs/contracts/accepted-idea-delivery-closeout-v1.md`
- `platform-engineering/products/openproject/scripts/README.md`
