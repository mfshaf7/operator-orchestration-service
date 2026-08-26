---
security_evidence:
  review_areas:
    - runtime
    - delivery
    - identity
  reviewed_artifacts:
    - contracts/delivery-art-work-session/decision.schema.json
    - contracts/delivery-art-work-session/work-session.schema.json
    - src/app.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-runtime.js
    - dev-integration/profiles/accepted-idea-delivery/profile.yaml
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Security acceptance #1025 permits the bounded #1027 commissioning proof. The Console caller, accountable operator, OOS service, and source executor retain distinct identities; the executor exposes only finite authenticated actions over an owner-only Unix socket."
---

# 2026-08-27 Governed Delivery Source Executor

## Summary

Composed the Delivery work-session API with a bounded host source executor so
the Console can observe and command governed source work without receiving Git,
workspace, OpenProject, or WGCF authority.

## Classification

- area: Delivery work-session execution
- type: trust-boundary and dev-integration composition
- runtime impact: adds an explicitly commissioned host executor and durable OOS
  session state; normal Delivery mutation remains disabled by default

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: User story `#1027` under Feature `#910` and Epic `#886`
- security acceptance: User story `#1025`
- downstream client: Governance Operations Console User story `#1032`

## Architecture Decision

The Console authenticates as an application caller and attributes each command
to one admitted human operator. OOS owns workflow semantics, command replay,
session state, and receipts. A separate host process owns source access and
offers only typed actions over an authenticated Unix socket. The executor has
no OOS backend credentials, and the OOS pod receives no workspace source mount.

## Root Cause

- immediate gap: the work-session HTTP contract existed, but the active OOS
  runtime had no admitted source executor and therefore correctly returned
  unavailable
- structural cause: browser, workflow, backend, and source authority needed
  distinct identities and process boundaries before source actions could be
  commissioned
- correction: bind the Console and operator at OOS, retain durable workflow
  truth in OOS, and delegate only finite source actions to a private host service

## Source Changes

- separated caller and operator identity in decisions, sessions, requests, and
  command receipts
- added caller-to-operator admission binding at the HTTP boundary
- added authenticated finite source actions and owner-only socket lifecycle
- composed the API runtime from OOS artifact services and the source executor
- added read-time compatibility for existing schema-v1 local session records
- added a supervised dev-integration host service, private state paths, and
  explicit mutation commissioning
- reused the composition's existing method-scoped OOS WGCF artifact-registry
  binding instead of creating a duplicate credential path
- bounded the transient Unix socket to an operator-private runtime path that
  remains within the platform socket-address limit
- made profile convergence prune stale direct caller-auth environment
  overrides before the broker rollout
- synchronized OpenAPI and operator contract documentation

## Validation

- `npm test`: `818` passed, `0` failed
- orchestration and Refinement workflow bundles: passed
- API documentation: `90` documented routes matched `90` implemented routes
- governance documentation: passed
- source executor authentication, unavailable-runtime, identity mismatch,
  stale revision, command replay, and bounded failure tests: passed
- base-aware change-record and mutation-contract checks: required again on the
  amended immutable source head

## Artifact And Deployment Evidence

- source commit: pending amended pull-request head
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: full test, bundle, API, governance, and base-aware checks
  listed above
- dev-integration verification: pending merged OOS and Console source heads
- residual risk: mutable Delivery commissioning remains disabled unless launch
  explicitly enables the admitted single-writer boundary

## Follow-Up

- merge the OOS provider landing unit before the Console consumer landing unit
- run the bounded #1027 dev-integration proof against exact merged OOS, Console,
  and Security heads
- finalize Review Packets for #1027 and #1032 only after live positive and
  negative evidence is recorded

## Rollback

Disable explicit Delivery mutation commissioning, stop the host executor, and
revert the OOS and Console landing units. Preserve command records, session
artifacts, and ART evidence for audit.
