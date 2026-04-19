# OpenProject Adapter Contract v1

## Purpose

Define the intended broker-to-OpenProject contract for the first idea workflow.

OpenProject remains the canonical system of record for captured ideas,
operator-triaged proposals, and later operator decisions.

The canonical OpenProject project model is defined in:

- `platform-engineering/products/openproject/idea-backlog-contract.md`

The broker credential and minimum project-role expectation are defined in:

- `platform-engineering/products/openproject/idea-backlog-contract.md`
- `operator-orchestration-service/docs/architecture/security-model.md`

## Scope

This contract is limited to:

- create initial idea record
- read normalized idea record projection
- lookup by broker-owned source identity
- update an idea with operator-authored triage output
- record bounded operator decision notes and first durable outcomes
- record internal evaluation metadata using canonical workspace vocabulary and
  full notes

It does not cover:

- broader project-management automation
- arbitrary work package lifecycle control
- Git artifact promotion

## Canonical Record Shape

Phase 1 expects a dedicated OpenProject idea/proposal backlog with a work
package type appropriate for captured ideas.

Minimum canonical fields should be able to express:

- title
- body or description
- source surface
- source identity
- suspected owner
- affected scope
- workflow status
- triage summary
- internal evaluation notes
- optional AI-assist decision metadata when a future AI discussion path is used

## Broker-Owned Mapping

The broker is responsible for mapping its workflow fields into OpenProject.

Channel adapters must not know OpenProject field ids or work package schema.

If the OpenProject runtime enforces a canonical external host, the broker must
be able to send the reviewed host header required by that runtime contract.

## Create Contract

On `capture`, the broker should create or reuse an OpenProject work package that
records:

- source surface, such as `telegram`
- operator identity
- source identity
- captured title and body

The broker should return a stable canonical record ref to the caller.

## Read Projection Contract

On `read` or `lookup`, the broker should return a normalized projection that is
stable for source adapters even if OpenProject schema details evolve.

Source adapters must not parse raw OpenProject work package fields directly.

## Triage Update Contract

On `triage`, the broker should update the canonical record with bounded
operator-authored framing such as:

- triage summary
- status `triaged`
- operator identity in the stable description context
- optional AI-assist metadata only when a future AI discussion path is used

The exact field placement can use description sections or custom fields, but the
mapping must be documented and stable. The current phone-friendly path does not
require a prior AI suggestion before the record moves into `triaged`.

## Decision Update Contract

On `decision`, the broker should update the canonical record so that
OpenProject reflects:

- one bounded durable outcome: `parked`, `accepted`, or `rejected`
- operator decision notes in the stable description context
- preserved captured text and preserved triage summary

The current first decision slice does not expose `owner-assigned` yet and does
not require a separate decision id. A future AI-assisted discussion path may
add optional metadata later, but it is not part of the current contract.

## Internal Evaluation Metadata Contract

On `evaluation`, the broker should update the canonical record so that
OpenProject reflects:

- suspected owner using canonical workspace tokens
- affected scope using canonical workspace tokens
- trust-boundary areas
- AI assist lane and confidence
- free-text internal evaluation notes for the later full AI write-up

This update path is internal metadata only. It does not change lifecycle
status, does not expose a Telegram command, and exists so later AI-assisted
evaluation can populate backlog metadata without inventing a second record
model.

## Error Handling Expectations

The adapter should return broker-friendly typed outcomes rather than raw
OpenProject API responses.

Expected classes:

- authentication failure
- validation failure
- duplicate source ref
- backend unavailable
- unexpected backend contract drift

## Deferred In Phase 1

- two-way sync from OpenProject back into Telegram
- webhook-driven state propagation
- rich attachment mirroring
- general-purpose OpenProject automation beyond the idea workflow
