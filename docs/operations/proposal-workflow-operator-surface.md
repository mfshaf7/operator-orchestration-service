# Proposal Workflow Operator Surface

## Purpose

This is the primary operating procedure for the live versioned Proposal
workflow routes. Workspace Proposals in OpenProject remains canonical. OOS is
the only admitted mutation adapter. A Console or other client reads and submits
commands; it does not write Proposal state directly.

## Required Configuration

The route family requires the normal Workspace Proposals OpenProject settings
plus:

- `OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID`
- caller authentication that binds each request to one admitted caller ID

If the machine-state field is absent, the Proposal route family returns
`proposal_workflow_not_configured` with HTTP `503`. Other OOS route families
remain available.

## Read Before Write

1. Read `GET /v1/proposals/{proposal_id}/projection`.
2. Build the command from the returned `record_ref`, `record_version`,
   `projection_state`, and `status`.
3. Set `operator.id` to the authenticated caller ID.
4. Submit the command to `POST /v1/proposals/{proposal_id}/commands`.
5. Retain the returned owner receipt and event reference.

Do not cache a Projection as write authority. A stale `record_version` is a
normal optimistic-concurrency conflict: refresh the Projection, review the new
canonical state, and construct a new command if the operator still wants the
change.

## Command Semantics

- `triage` records the operator summary and moves `captured` to `triaged`.
- `disposition` records `accepted`, `parked`, or `rejected`. An accepted
  disposition must include a Delivery or Prototype route and source custody.
- `handoff` records a blocked or ready prepared-handoff packet. It does not
  apply the packet to the target system and does not mark the Proposal
  implemented.

Each logical submission needs a stable `command_id`. Replaying the same ID and
same command returns HTTP `200` with `replayed: true`. First acceptance returns
HTTP `201`. Reusing an ID for different content is rejected.

## History And Recovery

- Read bounded event history from
  `GET /v1/proposals/{proposal_id}/history`.
- Read one event from
  `GET /v1/proposals/{proposal_id}/events/{event_id}`.
- History includes only structured comments authored by the authenticated OOS
  OpenProject service user.
- If the state mutation succeeded but event journaling failed, retry the exact
  command. OOS repairs the missing event without applying the state twice.

Operator comments remain visible in OpenProject but do not become machine
workflow events.

## Fail-Closed Conditions

Do not retry blindly when OOS reports:

- stale record version: refresh and review canonical state
- caller/operator mismatch: correct authenticated caller binding
- wrong Proposal authority or project: route the request to Workspace Proposals
- unresolved repository custody: resolve the Repository gate first
- unsupported lifecycle transition: use the current workflow action
- backend unavailable: preserve the local draft and disable writes until a
  fresh Projection can be read

## Deferred Boundaries

This surface stops at prepared handoff. Console adapter wiring, Repository
resolution, target-owned Delivery or Prototype application receipts, realtime
push, and governed AI assistance remain separate governed work.

See [Proposal Workflow Contract V1](../contracts/proposal-workflow-v1.md) for
the machine contract and [OpenAPI](../api/openapi.json) for exact route shapes.
