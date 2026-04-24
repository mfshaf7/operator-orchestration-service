# Accepted Idea Delivery Consumption v1

## Purpose

Define the broker-owned internal workflow contract for consuming an already
accepted proposal from `Workspace Proposals` into the separate OpenProject
delivery ART project.

The broker route now exists as an internal endpoint. The surrounding
`accepted-idea-delivery` persistent workbench plus the disposable
`accepted-idea-delivery-mutation-smoke` companion profile provide the
local-k3s rehearsal path for this handoff before any governed stage delivery
surface is treated as ready.

## Design Position

The broker continues to treat `Workspace Proposals` as the proposal plane.

Once a proposal is accepted, the next delivery workflow should:

- create a linked delivery record in the ART project
- preserve the source proposal as the proposal-of-record
- preserve explicit backlinks in both directions

The target delivery model is defined in:

- `platform-engineering/products/openproject/delivery-art-contract.md`

## Preconditions

The source proposal must already:

- exist in `Workspace Proposals`
- have status `accepted`
- preserve captured body, triage summary, and operator decision notes

Recommended but not mandatory metadata for first consumption:

- suspected owner
- affected scope
- trust boundary areas
- confidence
- AI assist lane
- notes

## Consumption Result

The consume step should create one top-level delivery initiative in the ART
project.

Recommended target type:

- `Epic`

That record becomes the delivery-of-record for the accepted idea.

## Field Mapping

Minimum fields copied from source proposal:

- title
- captured body
- triage summary
- operator decision notes
- evaluation metadata
- source proposal reference

Minimum fields created on the delivery record:

- `Origin Idea Ref`
- `PM² Phase`
- `Target PI`

## Link Contract

Source proposal should store:

- `delivery_ref`

Delivery record should store:

- `origin_idea_ref`

These references must remain durable and human-readable.

## Lifecycle Rules

The consume step must not:

- overwrite the source proposal in place
- replace proposal lifecycle with delivery execution status
- silently mark the source proposal `implemented`

Expected behavior:

- source proposal stays `accepted` while delivery is active
- source proposal moves to `implemented` only after delivery closes with a real
  outcome
- that terminal transition is handled by the separate closeout workflow, not by
  consume

## Operator Surface

Phase 1 recommendation:

- no Telegram command
- no public chat surface
- explicit operator or broker-controlled internal action only

The first implementation may start as a manual or internal-only flow before any
operator-facing command surface is admitted.

## Implemented Endpoint

The broker seam is:

- `POST /v1/ideas/{idea_id}/consume`

Current high-level behavior:

- validate the source proposal is `accepted`
- reuse an existing delivery record when one already exists for the same source
  idea
- otherwise create the linked delivery record in the ART project as one
  top-level `Epic` shell
- write the source and target backlinks with durable human-readable refs
- emit attributable audit events
- do not auto-create PI objectives, stories, or tasks during consume

Optional request field:

- `input.target_pi`
  - use this only when the initiative is already deliberately PI-committed at
    consume time; otherwise leave it blank and commit PI later through the ART
    planning workflow

Current response shape:

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

## Deferred In v1

- automatic bidirectional synchronization
- direct Telegram execution management
- multiple ART routing
- solution-train coordination

## Related Contract

Delivery closeout is defined separately in:

- `accepted-idea-delivery-closeout-v1.md`
