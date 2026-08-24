# Proposal Workflow Contract V1

## Purpose

This contract defines the stable integration boundary between the Governance
Operations Console Proposal surface and Operator Orchestration Service (OOS).
It extends the existing idea API contract with live typed route,
source-custody, prepared-handoff, event, and history semantics.

Workspace Proposals is the canonical record authority. OOS is the only mutation
adapter admitted by this contract. The Console is an operator client and local
draft host; it is not a Proposal record authority.

## Contract Artifacts

- `contracts/proposal-workflow/manifest.json` records live, contract-admitted,
  and deferred capabilities.
- `contracts/proposal-workflow/command.schema.json` defines versioned triage,
  disposition, and handoff commands.
- `contracts/proposal-workflow/command-result.schema.json` defines the accepted
  command receipt with its resulting projection, event, and history.
- `contracts/proposal-workflow/handoff-application.schema.json` binds one
  prepared Proposal packet and source version to a Delivery application.
- `contracts/proposal-workflow/handoff-application-result.schema.json` defines
  the stable Delivery application receipt and resulting Proposal evidence.
- `contracts/proposal-workflow/projection.schema.json` defines the canonical
  Proposal read model used by Console adapters.
- `contracts/proposal-workflow/event.schema.json` defines immutable workflow
  events.
- `contracts/proposal-workflow/history.schema.json` defines bounded read-only
  history.
- `contracts/proposal-workflow/storage-state.schema.json` mirrors the Platform
  machine-state field contract used for canonical persistence.
- `docs/api/openapi.json` carries exact projections of these schemas as OpenAPI
  components. Components do not make an HTTP operation live.

The existing live API remains documented by `intake-api-v1.md`.

## Lifecycle And Workflow

The canonical lifecycle is:

- `captured`
- `triaged`
- `parked`
- `accepted`
- `rejected`
- `implemented`

Triage records one summary. Disposition records `accepted`, `parked`, or
`rejected`. A parked Proposal may return through Disposition. An accepted
Disposition must select either `delivery` or `prototype` and must carry an
explicit source-custody posture.

Repository is a handoff gate, not a route target. The admitted repository modes
are `existing`, `new`, and `not-required`. Their custody classifications are
`existing-repo`, `new-repo-required`, `platform-internal`, and
`non-source-work`.

Handoff reviews an accepted route and its source-custody gate. A ready handoff
may prepare a packet, but preparation does not prove target application. The
Proposal remains `accepted` after handoff application. It becomes
`implemented` only after downstream completion evidence is reconciled into the
canonical Proposal record.

History is read-only. Reading history never advances workflow state.

## Fail-Closed Guards

Every admitted write command carries:

- the canonical OpenProject record reference
- the expected record version
- a `current` projection state
- the current lifecycle status
- the fixed Workspace Proposals and OOS authority declaration

Commands against stale, offline, syncing, error, unknown-version, wrong-project,
or non-OOS authority projections are invalid. Triage, Disposition, and Handoff
also reject source lifecycle states outside their declared transition sets.

An accepted Disposition without route and source custody is invalid. A ready
Handoff with pending repository custody is invalid. An applied Handoff
projection without a target-owned receipt and target record reference is
invalid.

## Live Runtime Boundary

The versioned Proposal workflow routes are:

- `GET /v1/proposals/{proposal_id}/projection`
- `POST /v1/proposals/{proposal_id}/commands`
- `POST /v1/proposals/{proposal_id}/handoff/apply`
- `GET /v1/proposals/{proposal_id}/events/{event_id}`
- `GET /v1/proposals/{proposal_id}/history`

The command route requires caller authentication and an expected canonical
record version. OOS applies the description, lifecycle status, and Platform
machine-state field in one optimistic-concurrency OpenProject mutation. It then
adds one structured OpenProject activity comment as the immutable operator
event. The command is acknowledged only after both durable records exist.

Command IDs are idempotent. An exact replay returns the existing receipt and
event without a second state mutation. If the state mutation succeeded but the
event comment failed, the replay repairs only the missing event. A command ID
reused for different content is rejected.

History accepts only structured event comments authored by the authenticated
OOS OpenProject service user. Operator comments and event-shaped comments from
other authors do not become workflow history.

The handoff application route is limited to accepted Proposals whose prepared
route targets Delivery and whose repository custody is resolved or explicitly
not required. OOS adapts the Proposal packet to the source-neutral
[Delivery ingress contract](delivery-ingress-v1.md), creates or reuses one
top-level Delivery Epic through the existing canonical intake adapter,
preserves the Proposal-to-Delivery backlink, and then records the target
reference and deterministic receipt in Proposal state. It does not create
Delivery execution children or assign a Target PI.

An exact application replay returns HTTP `200` without creating another
Delivery Epic. If target creation or the Proposal backlink committed before a
transport failure, OOS reuses that target. If the final Proposal state or event
write committed before a response failure, OOS refetches canonical truth and
returns the proven result instead of blindly repeating the mutation.

A target failure records a deterministic failure receipt and
`target-application-failed` event, and leaves the prepared handoff blocked.
After the target is available, refresh the Projection and retry with the same
`application_id`, packet reference, and refreshed source version.

The runtime requires
`OPENPROJECT_CUSTOM_FIELD_PROPOSAL_WORKFLOW_STATE_ID` in addition to the
existing Workspace Proposals configuration. Missing persistence configuration
fails the route family with `503` without disabling unrelated OOS capabilities.

The following remain separate landing units:

- Console live adapter wiring
- Prototype target application and receipts
- Repository Operation resolution
- bounded polling and explicit-refresh integration validation
- realtime push transport
- governed AI assistance

Handoff commands prepare canonical target packets only. Delivery application
requires the separate application route. Neither preparation nor application
claims lifecycle implementation or downstream completion.
