---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/openproject-client.js
    - test/openproject-client.test.js
    - dev-integration/profiles/accepted-idea-delivery/scripts/smoke.sh
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This read-only performance repair preserves the existing OpenProject trust boundary, caller authorization, and response contract."
---

# Delivery ART Initiative Read Scope

## Summary

Initiative-scoped Delivery ART reads now request only the requested Epic and
its descendants from OpenProject, then request relations only for that bounded
tree. Any connected external dependency and its parent chain are hydrated by
exact identifier so cross-initiative evidence remains present.

## Classification

- area: Delivery ART read adapter and dev-integration runtime acceptance
- type: owner-repo maintenance
- landing unit decision: `feature_single_landing_unit`
- runtime impact: replaces ART-wide work-package pagination and unrelated
  relation requests with one ancestor-filtered read plus exact connected
  dependency reads, without changing the packet or API contract

## Ownership

- owner repo: `operator-orchestration-service`
- work-tracking home: owner-repo-only maintenance; no new ART item
- related products or components: accepted-idea-delivery broker and OpenProject
  Delivery ART adapter

## Root Cause

- immediate failure: the persistent profile's read-only smoke timed out after
  20 seconds while reading the optimized active-session packet
- actual root cause: the initiative-scoped state builder still downloaded the
  complete Delivery ART project, which had grown beyond 1,100 work packages;
  twelve sequential OpenProject pages consumed about 45 seconds before packet
  construction began
- why it escaped earlier controls: fixture-scale tests proved packet semantics
  but did not assert the work-package or relation-read boundary in a
  multi-initiative project

## Source Changes

- changed workflow, adapter, or contract: the existing initiative identifier
  now drives OpenProject's `ancestor` filter, with an exact root read and exact
  hydration for connected external dependencies and their ancestor chains
- tests or validator added: the multi-initiative execution-summary regression
  test proves the ancestor-filtered query, proves that unrelated relation
  sources are not queried, and preserves connected cross-initiative
  dependencies
- API contract: unchanged

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: local source validation and
  branch-bound full-composition dev-integration rehearsal completed before
  merge
- image tag or digest: not applicable; accepted-idea-delivery copies the pinned
  OOS source revision into its local runtime
- runtime revision: worktree branch `maintenance/scope-art-relation-reads` from
  OOS base `6e9ff2d7282aa09d64bfc738137f0580e6bf3f12`; the merged revision remains
  subject to post-merge reconciliation

## Live Verification

- local validation: focused multi-initiative, pagination, continuation, and
  mutation-state regression tests passed; full Node suite passed with 1,192
  tests and 2 intentional skips; governance docs, diff-aware change-record,
  diff-aware OpenProject mutation, generated API docs, and `git diff --check`
  passed against `origin/main`
- live or dev-integration verification: the full `refinement-catalog`
  composition accepted the worktree override; the persistent profile's
  read-only smoke passed in 13.42 seconds, including active-session,
  initiative-evidence, and work-item closeout evidence reads
- residual risk: the OpenProject ancestor filter is a required runtime
  capability; it is present in the deployed OpenProject 17.2.3 contract and is
  exercised by branch-bound live smoke

## Follow-Up

- required follow-up: merge, reconcile the persistent profile to merged main,
  and repeat the read-only smoke before Architecture Packet v5 cutover
- owner: `operator-orchestration-service`
- due date or closure condition: merged-main smoke passes within its existing
  timeout and the Epic #1203 v5 packet can be persisted

## Security Boundary

No caller, credential, mutation, approval, or environment authority changes.
The repair reduces authorized read scope and remains limited to
`dev-integration`; stage and production activation remain separately governed.

## Rollback

Revert the landing commit and reconcile the accepted-idea-delivery profile.
The prior behavior is read-only but may again exceed the smoke timeout as ART
inventory grows.
