---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - scripts/test_prototype_closure_conformance.mjs
    - scripts/evaluate_prototype_closure_wgcf.py
    - docs/operations/prototype-closure-operator-surface.md
  workstreams:
    - WS-007
  notes: "Isolated source conformance only; synthetic owner receipts and inactive live Closure runtime."
---

# Prototype Closure Conformance

## Summary

ART #1109 adds an isolated cross-repo Closure conformance run for Delivery
application, source graduation, incubation retirement, and reopening. It
exercises current Console, WGCF, OOS, and Studio source without enabling the
live Closure workflow.

## Classification

- Area: Prototype Closure cross-repo conformance.
- Type: source-backed validation and evidence generation.
- Runtime impact: none; the live Closure feature flag remains disabled.

## Root Cause

Owner-local tests did not demonstrate that current Console command binding,
WGCF readiness, OOS coordination, and Studio append-only history agree across
the complete Closure sequence. #1109 is the planned composed proof for that
gap, not an incident workaround.

## Ownership And Boundary

- Owner repo: `operator-orchestration-service`.
- Input owners: Workspace Prototype Studio, Workspace Governance Control Fabric,
  and Governance Operations Console at their fetched `origin/main` commits.
- Delivery, durable-owner, and Platform evidence are synthetic owner fixtures
  with explicit owner, subject, revision, and digest bindings. They are not
  live acceptance or Security approval.
- All Studio writes and merges occur in temporary clones; the source inputs
  and active runtimes remain unchanged.

## Source Changes

The runner proves WGCF issue/replay/readback, OOS decision and review phases,
exact real-Git source changes, terminal receipts, cancellation, stale review
heads, and post-merge readback recovery. Its structured output records the
fetched input revisions, fixture revision, reviewed and merged heads, owner
evidence, source events, receipt digests, history, and clone cleanup.

## Artifact And Deployment Evidence

The source PR and its generated local `.art/receipts/` conformance output are
the review artifacts. The script does not deploy an image or activate a route.
The Review Packet must bind the exact PR head and verified conformance output
before source merge.

## Live Verification

No live owner acceptance or Studio mutation is claimed. The run uses current
source revisions and an isolated temporary Git history with synthetic owner
receipts; live proof belongs to later Security and Platform gates.

## Verification

- Run `npm run test:prototype-closure-conformance -- ...` with the inputs shown
  in the Closure operator surface.
- Run the focused Closure suite, OpenAPI and governance-doc validation, and
  base-aware change-record checks before PR merge.
- The conformance result does not prove live owner adapters, commissioned
  GitHub identity, Platform disposition, or a normal-availability workflow.

## Follow-Up

Security #1140 reviews the source/control posture after #1109. Platform
#1107 owns actual identity commissioning, runtime disposition, and operating
proof before normal Closure availability.
