# Lifecycle Transition Journal Operator Surface

## Purpose

The Lifecycle Transition journal is the OOS-owned record of cross-domain
project movement. It publishes current state, exact next action, owner evidence
coordinates, bounded history, freshness, and monotonic revision for exactly
three admitted routes:

- `proposal-to-delivery`
- `proposal-to-prototype`
- `prototype-to-delivery`

Workspace Governance owns route vocabulary. OOS owns the command and journal.
WGCF owns readiness evaluation. Source and target systems retain their own
records and mutation authority. The Governance Operations Console is a caller
and projection consumer, not lifecycle authority.

## Normal API

| Action | Route | Result |
| --- | --- | --- |
| Acknowledge | `POST /v1/lifecycle-transitions` | Creates or exactly replays one deterministic transition. |
| List | `GET /v1/lifecycle-transitions` | Returns a bounded page filtered by route, source record, or current state. |
| Read | `GET /v1/lifecycle-transitions/{transition_id}` | Returns the canonical Console source projection. |
| Append evidence | `POST /v1/lifecycle-transitions/{transition_id}/events` | Appends one owner-authorized event against the current sequence. |
| Read history | `GET /v1/lifecycle-transitions/{transition_id}/history` | Returns bounded evidence coordinates without raw artifacts. |

The read route supports
`application/vnd.mfshaf7.console-source-projection+json; version=1`. Live
consumers must accept only current, unexpired, monotonically advancing
projections.

## Mutation Rules

- Transition identity binds route, source record, source version, correlation,
  and idempotency input.
- Target home, lane, ingress, and owners are derived from the pinned Workspace
  Governance contract. Callers cannot override them.
- Every event requires an exact current sequence, owner role, caller-to-owner
  binding, timestamp, and at least one evidence reference.
- Same event identity is replayable only when its complete input is identical.
- Applied state requires the completion receipt declared by the locked route.
- `applied`, `cancelled`, and `superseded` are immutable terminal states.
- Failed application is retryable. Non-retryable outcomes must be represented
  as a blocked, returned, rejected, deferred, cancelled, or superseded state.

## Recovery

The journal does not hide partial failure. A retryable application failure
projects `retry-application` to OOS. A blocked gate projects `resolve-gate` to
the gate owner. Returned source projects `correct-source` to the source domain.
Deferred and rejected transitions remain visible with their review action.

A corrected request may create a new deterministic transition and atomically
supersede the prior live transition. The old record remains readable and links
to the replacement.

## Runtime Configuration

The dev-integration runtime requires:

- `OOS_LIFECYCLE_TRANSITION_ENABLED=true`
- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_LIFECYCLE_TRANSITION_STATE_ROOT`
- `OOS_LIFECYCLE_TRANSITION_WRITER_BINDINGS_JSON`

Writer bindings map authenticated caller IDs to the exact owner references they
may represent. Missing state custody or writer bindings fail runtime startup.
The accepted-idea-delivery profile mounts the journal on a host-backed state
directory so broker restarts do not erase accepted records.

## Non-Ownership

This surface does not perform WGCF evaluation, invent source packets, decide
target admission, mutate Proposal or Prototype authority, apply Delivery
ingress, aggregate generic Console activity, or replace route-specific owner
receipts. Those capabilities call or feed this journal through their own
bounded contracts.
