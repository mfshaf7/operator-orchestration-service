---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-15-governance-console-platform-operation.md
  notes: "Approved owner maintenance; fresh composed exact-revision acceptance and normal activation follow the OOS and Console merges. This record does not grant completion or runtime authority."
---
# Fresh canonical closeout guidance

## Summary

Keep canonical closeout source freshness distinct from domain readiness so
operators can read actual blockers without acquiring completion authority.

## Ownership

OOS owns the native read envelope. Console consumes it, ART owns the work state,
and Security and Platform retain acceptance and runtime commissioning authority.

## Classification

Owner maintenance for the existing Console journey, tracked by the operating-truth
improvement candidate. Landing Unit `maintenance-1275-closeout-source-truth` is
isolated by OOS ownership, review and rollback. No new ART item or architecture
version is required. Rollback reverts only this read-envelope correction.

## Source Changes

The closeout GET supplies an explicit source-freshness attestation after the
existing native service read. The shared envelope renderer accepts that owner
descriptor without changing its default mapping for other routes.

## Root Cause

The authenticated native closeout read returned HTTP 200, a current observation
and the exact ART binding, with `projection_state: not_ready` and real missing
demo, open-objective, PM² and Inspect & Adapt reasons. The generic mapper
converted that domain readiness into unknown source freshness. Console then
correctly rejected the invalid freshness claim and hid the actionable blockers.

Only the successful validated native closeout read explicitly attests current
source freshness. Its unchanged domain readiness still governs every mutation.
Generic stale/unknown/unavailable mappings, source expiry, binding, identity,
permissions and canonical completion controls remain unchanged. An unavailable
backend never receives a successful current source envelope.

## Artifact And Deployment Evidence

HTTP regression cases cover all existing closeout domain postures and retain
their blockers/readiness; an unavailable canonical owner returns an error with
no source envelope. Existing source-authority and closeout-service tests also
run. Exact committed full local/provider CI and separate human review precede
merge. No OpenProject mutation shape changes. This record describes source work;
it does not claim an unperformed merge or deployment.

## Live Verification

After accepted activation, read the native not-ready closeout through the real
Console and verify current source binding plus visible actionable blockers.
Then complete actual PI review and guided closeout using their owner paths.

## Follow-Up

Security's complete-runtime acceptance pins OOS and Console revisions. After
both owner changes merge, refresh only those two accepted pins and the generated
Security index, then run the existing complete-runtime activation and unflagged
native reader. Actual Console PI review and closeout remain required operating
proof; source tests are not that proof. No Platform source change is planned.
