# Proposal Workflow Contract V1

## Purpose

This contract defines the stable integration boundary between the Governance
Operations Console Proposal surface and Operator Orchestration Service (OOS).
It extends the existing idea API contract with typed route, source-custody,
handoff, event, and history semantics without claiming that new runtime routes
already exist.

Workspace Proposals is the canonical record authority. OOS is the only mutation
adapter admitted by this contract. The Console is an operator client and local
draft host; it is not a Proposal record authority.

## Contract Artifacts

- `contracts/proposal-workflow/manifest.json` records live, contract-admitted,
  and deferred capabilities.
- `contracts/proposal-workflow/command.schema.json` defines versioned triage,
  disposition, and handoff commands.
- `contracts/proposal-workflow/projection.schema.json` defines the canonical
  Proposal read model expected by a future Console adapter.
- `contracts/proposal-workflow/event.schema.json` defines immutable workflow
  events.
- `contracts/proposal-workflow/history.schema.json` defines bounded read-only
  history.
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

## Runtime Boundary

This version does not add HTTP routes or OpenProject mutation fields. The live
capture, list, read, lookup, triage, decision, evaluation, Delivery consume, and
Delivery closeout routes remain unchanged.

The following require later landing units:

- OOS runtime handlers for the admitted command and projection schemas
- Console live adapter wiring
- target-owned Delivery and Prototype application receipts
- Repository Operation resolution
- event/history persistence and retrieval
- realtime push transport
- governed AI assistance

Until those units land, a client must not present schema-admitted behavior as a
successful backend mutation.
