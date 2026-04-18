# OpenProject Adapter Contract v1

## Purpose

Define the intended broker-to-OpenProject contract for the first idea workflow.

OpenProject remains the canonical system of record for captured ideas and
triaged proposals.

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
- update an idea with triage output
- record operator acceptance or override

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
- latest triage decision id
- latest triage confidence

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
suggestion metadata such as:

- triage summary
- suggested type
- suggested owner
- suggested status
- affected scope
- confidence
- decision id

The exact field placement can use description sections or custom fields, but the
mapping must be documented and stable.

## Decision Update Contract

On operator accept, edit, or discard, the broker should update the canonical
record so that OpenProject reflects:

- the final triage disposition
- who accepted or overrode it
- the decision id tied to that outcome

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
