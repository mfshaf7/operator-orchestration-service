# Accepted Idea Delivery Closeout v1

## Purpose

Define the bounded internal broker workflow for closing a completed delivery
record and moving the source proposal from `accepted` to `implemented`.

This contract exists so the proposal backlog stays canonical for lifecycle
truth while the delivery ART stays canonical for execution truth.

## Rules

- the source proposal must already be `accepted`
- the source proposal must already carry a durable `delivery_ref`
- the linked delivery record must still point back to the source
  `origin_idea_ref`
- the linked delivery record must already be `done`
- closeout must not remove or rewrite the durable proposal-to-delivery
  backlink

## Internal Endpoint

- `POST /v1/ideas/{idea_id}/closeout`

This endpoint is internal-only. It does not add a Telegram command surface.

### Request

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "closeout_notes": "Delivered through the first bounded productization execution slice."
  }
}
```

### Response

```json
{
  "idea_id": "idea-123",
  "record_ref": "openproject://work_packages/123",
  "record_system": "openproject",
  "status": "implemented",
  "delivery_ref": "openproject://work_packages/456",
  "delivery_record_ref": "openproject://work_packages/456",
  "delivery_record_system": "openproject",
  "delivery_status": "done",
  "delivery_closeout_notes": "Delivered through the first bounded productization execution slice.",
  "workflow_id": "accepted-idea-delivery-closeout"
}
```

## Audit Expectations

Every request should be attributable at minimum by:

- operator id
- workflow endpoint
- correlation id
- source proposal ref
- linked delivery ref
- backend write result

## Not Part Of v1

- automatic reopen or regression handling
- multi-ART closeout coordination
- Telegram delivery closeout command surface
- bidirectional execution-to-backlog status synchronization beyond this bounded
  terminal handoff
