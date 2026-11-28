---
security_evidence:
  review_areas:
    - delivery
    - runtime
  workstreams:
    - WS-003
---

# Delivery completion evidence

## Summary

Delivery operators can read the recorded completion and its approved child
reviews from the existing work-item view.

## Classification

Owner-repo maintenance for the existing Delivery workflow. Landing unit
`delivery-usability-broker` supplies the Broker contract used by the companion
Console change.

## Ownership

OpenProject retains the work-item record and the existing
registry retains the finalized review artifacts.

## Root Cause

The continuation read omitted recorded completion notes and the retained
review links of completed children. A count-only comparison could also miss
changes to which children were complete.

## Source Changes

A completion read can request the recorded outcome and the finalized reviews
of completed direct children. The Broker binds both optional reads to the
dedicated Delivery source caller and the operator. It matches packets against
the requested child and review source. The Console completion revision includes the exact child identities. If its
pre-submission read detects a changed child set, the Console rejects the stale
command before calling the existing Broker write. Normal continuation reads
retain their existing behavior.

## Artifact And Deployment Evidence

The candidate Console and Broker rehearsed single-repository and grouped
multi-repository completion against disposable OpenProject. Both recorded and
reopened the outcome. The rehearsal also verified that a shared caller cannot
read the optional evidence, and that a changed child set rejects a write.

## Live Verification

A read-only check with the existing live Broker and registry resolved the
original finalized review for #1386, including seven recorded passing checks.
The candidate linked the retained evidence for all seven completed direct
children of Feature #1385 to two distinct repository reviews.

## Follow-Up

Land the Broker before the dependent Console and activate the reviewed
revisions together through the accepted Platform composition. The optional
reads add no data migration. Preserve existing work-item outcomes and retained
review references throughout rollback.
