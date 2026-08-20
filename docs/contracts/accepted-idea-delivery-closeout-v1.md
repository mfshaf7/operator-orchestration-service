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
- normal top-level Delivery initiative closeout attempts this source transition
  after the Delivery Epic is already durably `done`
- source closeout failure must not roll back or rewrite completed Delivery ART
  state; the Delivery response reports `source_closeout_pending` instead
- replay against an already `implemented` source is successful and returns
  `closeout_outcome: replayed` without another source mutation
- a retired Delivery outcome is not implementation evidence and must never move
  its source Proposal to `implemented`

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
  "closeout_outcome": "implemented",
  "delivery_ref": "openproject://work_packages/456",
  "delivery_record_ref": "openproject://work_packages/456",
  "delivery_record_system": "openproject",
  "delivery_status": "done",
  "delivery_closeout_notes": "Delivered through the first bounded productization execution slice.",
  "workflow_id": "accepted-idea-delivery-closeout"
}
```

`closeout_outcome` is `implemented` for the first successful source mutation
and `replayed` when the exact terminal relationship was already closed.

## Delivery Initiative Close Integration

`POST /v1/delivery-initiatives/{delivery_id}/close` performs the source
closeout only after the top-level Delivery Epic reaches `done`. Its response
includes:

```json
{
  "source_closeout_status": "implemented",
  "source_closeout_receipt": {
    "idea_id": "idea-123",
    "source_record_ref": "openproject://work_packages/123",
    "delivery_record_ref": "openproject://work_packages/456",
    "status": "implemented",
    "error": null,
    "workflow_id": "accepted-idea-delivery-closeout"
  }
}
```

When Delivery is complete but the source mutation fails, Delivery still
returns success with `source_closeout_status: source_closeout_pending`. The
receipt carries a bounded error and the exact internal retry route:

```json
{
  "status": "source_closeout_pending",
  "retry": {
    "method": "POST",
    "path": "/v1/ideas/idea-123/closeout"
  }
}
```

Delivery initiatives with no Proposal origin return `not_applicable` rather
than inventing a source relationship.

## Historical Reconciliation

- `POST /v1/ideas/delivery-closeouts/reconcile`

The route defaults to `dry-run`. It scans only Proposal records in `accepted`
or `implemented`, follows only their durable `delivery_ref`, and verifies the
Delivery `origin_idea_ref` backlink before reporting eligibility.

Dry-run request:

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "mode": "dry-run"
  }
}
```

The dry-run response includes `candidate_digest`, computed from the sorted exact
Proposal and Delivery references that are eligible at inspection time.

Apply requires an explicit closeout note:

```json
{
  "operator": {
    "id": "1338752889",
    "handle": "mfshaf7"
  },
  "input": {
    "mode": "apply",
    "closeout_notes": "Reconciled from the exact completed Delivery backlink.",
    "expected_candidate_digest": "sha256:approved-dry-run-digest"
  }
}
```

Apply fails before any mutation when its expected digest does not equal the
current candidate digest.

The result distinguishes `eligible`, `implemented`, `already_implemented`,
`delivery_not_done`, `delivery_retired`, `delivery_ref_missing`, and
`inspection_failed`. Apply never infers a relationship from titles, dates, or
operator memory.

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
- inferred or multi-ART closeout coordination
- Telegram delivery closeout command surface
- bidirectional execution-to-backlog status synchronization beyond this bounded
  terminal handoff
