# Workflow Activity Operator Surface

## Purpose

`GET /v1/workflow-activity` gives the Governance Operations Console one
bounded, read-only chronology across canonical OOS workflow owners. The first
admitted sources are Lifecycle Transition and durable orchestration.

This surface removes the need for the Console to reconstruct chronology from
browser-local receipts. OOS composes owner projections at read time and does
not create a second activity database.

## Read Contract

The caller may filter by `source_id`, `category`, `outcome`, or exact
`subject_ref`. `limit` defaults to 50 and cannot exceed 100. `next_cursor` is
opaque and bound to the complete filter set; changing a filter invalidates the
cursor. Ordering is newest first with event identity as the deterministic tie
breaker, so newly arriving events do not shift an existing continuation page.

Each event retains:

- canonical source owner, source record, and revision
- correlation and causation identifiers when the owner records them
- actor, action, subject, outcome, and timestamp
- exact receipt and evidence references without embedding raw artifacts
- currently available owner action coordinates

## Partial And Failure Posture

The page is `current` only when every selected source is available and its
bounded owner window is complete. An unavailable, stale, malformed, or
truncated source makes the page explicitly `partial`. The source status names
the safe error code but does not expose upstream exception text, logs, request
payloads, or secrets.

Authentication and authorization failures fail the whole request. Conflicting
payloads for one event identity also fail closed. Retries and replay deduplicate
identical event identities and cannot create synthetic freshness.

## Ownership

- OOS owns the aggregate read contract and source adapters.
- Lifecycle Transition and durable orchestration remain owners of their
  records, state, receipts, and exact next actions.
- WGCF remains readiness and validation authority; its receipts are referenced,
  not copied or reinterpreted.
- The Console is a projection consumer. It does not persist or mutate this
  chronology.

## Validation

Run:

```bash
node --test test/workflow-activity-service.test.js test/workflow-activity-http.test.js
npm run validate:workflow-activity-openapi
npm run validate:api-docs
```

## Rollback

Remove the aggregate route, runtime composition, source adapters, contract,
OpenAPI projection, tests, and this operator surface together. Owner workflow
records and their existing read routes remain unchanged.
