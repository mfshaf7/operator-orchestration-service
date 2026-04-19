# Accepted Idea Delivery Consumption v1

## Purpose

Define the future broker-owned workflow contract for consuming an already
accepted proposal from `Workspace Proposals` into the separate OpenProject
delivery ART project.

This contract is reserved for the next workflow phase. It is not implemented in
the broker yet.

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

## Operator Surface

Phase 1 recommendation:

- no Telegram command
- no public chat surface
- explicit operator or broker-controlled internal action only

The first implementation may start as a manual or internal-only flow before any
operator-facing command surface is admitted.

## Reserved Future Endpoint

The reserved future broker seam is:

- `POST /v1/ideas/{idea_id}/consume`

Expected high-level behavior:

- validate the source proposal is `accepted`
- create the linked delivery record in the ART project
- write the source and target backlinks
- emit attributable audit events

This endpoint remains deferred until the delivery project contract and runtime
shape are exercised in `dev-integration`.

## Deferred In v1

- automatic bidirectional synchronization
- direct Telegram execution management
- multiple ART routing
- solution-train coordination
