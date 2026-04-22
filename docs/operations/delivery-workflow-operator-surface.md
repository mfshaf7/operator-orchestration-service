# Delivery Workflow Operator Surface

## Purpose

Define the only supported execution plane for `Workspace Delivery ART`.

The broker is the canonical operator surface for delivery workflow reads and
writes. Product-local OpenProject execution scripts are retired.

## Boundary

Use `operator-orchestration-service` for:

- proposal-to-delivery consumption and closeout
- delivery initiative reads
- delivery planning and PI-objective reads
- delivery work-item reads and writes
- completion, review, and evidence recording

Use `platform-engineering/products/openproject` only for:

- OpenProject runtime deploy, status, and access
- OpenProject bootstrap and schema provisioning
- service identity provisioning
- ART quality validation and one-time normalization
- clean-start, backup, restore, and uninstall controls

Do not add delivery execution scripts back into `platform-engineering`.

## Supported API Families

### Proposal To Delivery

- `POST /v1/ideas/{idea_id}/consume`
- `POST /v1/ideas/{idea_id}/closeout`

### Delivery Initiative Reads

- `GET /v1/delivery-initiatives`
- `GET /v1/delivery-initiatives/{delivery_id}/execution-summary`
- `GET /v1/delivery-initiatives/{delivery_id}/planning`
- `GET /v1/delivery-initiatives/{delivery_id}/pi-objectives`
- `GET /v1/delivery-initiatives/{delivery_id}/closeout-readiness`

### Delivery Initiative Writes

- `POST /v1/delivery-initiatives/{delivery_id}/governance`
- `POST /v1/delivery-initiatives/{delivery_id}/plan/apply`
- `POST /v1/delivery-initiatives/{delivery_id}/system-demo`
- `POST /v1/delivery-initiatives/{delivery_id}/inspect-and-adapt`
- `POST /v1/delivery-initiatives/{delivery_id}/pi-review`

### Delivery Work-Item Writes

- `POST /v1/delivery-work-items`
- `POST /v1/delivery-work-items/bulk-update`
- `POST /v1/delivery-work-items/{work_item_id}/update`
- `POST /v1/delivery-work-items/{work_item_id}/move`
- `POST /v1/delivery-work-items/{work_item_id}/blocker`
- `POST /v1/delivery-work-items/{work_item_id}/dependency`
- `POST /v1/delivery-work-items/{work_item_id}/parking`
- `POST /v1/delivery-work-items/{work_item_id}/complete`

## Caller Rules

- callers use broker workflow routes, not raw OpenProject REST writes
- callers use broker caller auth, correlation, and bounded payloads
- callers may continue to use raw numeric OpenProject ids during the current
  compatibility period, but the durable contract is broker-shaped delivery and
  work-item ids

## Dev-Integration Execution

Inside the `accepted-idea-delivery` devint profile, validate these routes by
calling the broker deployment in the profile namespace.

Use the broker pod environment for:

- `CALLER_ALLOWED_IDS`
- `CALLER_AUTH_SHARED_SECRET`

That keeps the proof path aligned with the real internal workflow seam.

## Strict Exception Rule

Direct OpenProject runners are allowed only for:

- bootstrap before the broker runtime is available
- break-glass recovery
- platform-admin maintenance that is not part of the delivery execution plane

Those exceptions are not a second supported operator surface.
