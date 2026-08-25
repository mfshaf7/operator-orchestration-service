# Refinement Runtime

## Purpose

Use the Refinement runtime after Work Design has a trusted completed handoff.
It projects canonical metadata work, requests bounded field advice, and applies
one explicitly accepted immutable packet through a recoverable durable run.

The Governance Operations Console calls OOS only. Do not call CGG, the
governed AI gateway, Temporal, or OpenProject directly from the Console.

## Operator Sequence

1. Read the current packet with
   `GET /v1/delivery-refinement/{package_id}/projection?source_ref=...`.
2. Optionally request advice for one exact packet field with
   `POST /v1/delivery-refinement/{package_id}/assist`.
3. Keep the returned value suggestion-only. The operator accepts, edits, or
   ignores it in the Console draft.
4. Submit the complete accepted packet with
   `POST /v1/delivery-refinement/{package_id}/apply`.
5. Poll the returned `poll_ref` until the run is terminal.
6. Treat only `completed` plus a non-null canonical readback receipt as
   success.

Use the current projection again after a stale-packet or stale-draft response.
Reuse the original idempotency key when recovering the same accepted input.
Never generate a second key merely because the API or worker was interrupted.

## Activation

Source ships inactive. All of these settings must be deliberately supplied by
the later Platform activation work:

- `CGG_REFINEMENT_BASE_URL`
- `CGG_REFINEMENT_CALLER_ID`
- `CGG_REFINEMENT_CALLER_SECRET`
- `GOVERNED_AI_GATEWAY_BASE_URL`
- `OOS_REFINEMENT_RUNTIME_ENABLED=true`
- `OOS_REFINEMENT_WORKER_ENABLED=true`
- `OOS_REFINEMENT_EXECUTION_AUTHORIZED=true`
- admitted `OOS_TEMPORAL_*` connection settings

Run the worker with `npm run refinement:worker`. The API process does not own
the workflow or activity pollers.

## Recovery And Evidence

Temporal owns active run state. OpenProject remains canonical for Delivery
records and stores the trusted OOS receipt event after readback. An identical
apply replay returns the existing run or receipt. A conflicting replay is
rejected.

Do not claim success from an accepted run, a completed activity call, or an AI
response. The terminal receipt must identify the accepted draft digest, source
Work Design receipt, canonical Delivery reference, changed references, and
post-apply source revision.

Configured failures never fall back to local fixture state. Suspend the
Refinement profile and worker independently if rollback is required; preserve
run and receipt history for review.
