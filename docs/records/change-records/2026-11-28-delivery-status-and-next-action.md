---
security_evidence:
  review_areas:
    - delivery
    - runtime
  workstreams:
    - WS-003
---

# Delivery status and next action

## Summary

Delivery shows package progress, the work waiting within it, and the current
step for a selected Work Session using the corresponding owner records.

## Classification

Maintenance for the existing Delivery workflow. The Broker supplies the
read contract consumed by the companion Console landing unit. The components
can be reviewed independently and must be rehearsed together.

## Ownership

OpenProject owns recorded work status, dependencies and completion. The
Broker derives package navigation and resolves Work Session actions. Console
presents the scope and routes to the affected record. The existing planning,
repository access, release and Security authorities enforce their gates.

## Root Cause

The Broker treated a waiting descendant as a package blocker and treated
terminal leaf work as enough to enter package closeout. The session follow-up
adapter also expected the closeout read under the wrong field. The Console
used separate conditions for counts, filtering and attention, and a Pulse
route lost its package reference.

## Source Changes

Package status now reflects the scope of a hold and the remaining executable
work. Deferred scope, inherited holds and direct waits carry separate
identities. Closeout Pending requires terminal descendant obligations and
continues to defer the closeout decision to the owner. The selected Work
Session points to the recorded hold, unresolved prerequisite, required
iteration or remaining initiative work. An active pre-merge session respects
a newly recorded hold. An already merged revision retains its existing
verification and closeout gates. Grouped dependencies inside an approved
Landing Unit keep their exact ordering requirements.

## Artifact And Deployment Evidence

The candidate Broker and Console client read real changes from a disposable
OpenProject profile. Cases covered mixed waits, held Features, an Epic-wide
hold, defer and resume, and Feature and PI Objective obligations at closeout.
The API validator and owner test suites passed. OpenProject field mappings
and write contracts were exercised through the existing disposable profile.

## Live Verification

The read-only candidate preview used the current live owner data for #1384.
It showed In Progress, with story #1413 waiting to start and risk #1419
carrying a completion prerequisite. Retained
Work Session #1386 preserved the original review and seven passing checks.
Its next move returned to the open work. The selected #1395 read named the
missing iteration. Intake, Work Design, Refinement and PI Planning each
returned their own scoped state.

## Follow-Up

Review the preview, then sequence the Broker and Console revisions through
the existing Security and Platform review. Rollback restores the previous
accepted runtime revisions. The navigation fields are additive and no data
migration is needed.
