---
security_evidence:
  review_areas:
    - delivery
    - runtime
  workstreams:
    - WS-003
---

# GitHub repository reads

## Summary

Repository Setup, Prototype transfer, and Registry use authenticated read paths
with common GitHub throttling behavior.

## Classification

Maintenance of existing Console workflows. Landing unit
`github-read-consistency-broker`.

## Ownership

OOS owns workflow state and the connected-account metadata adapter. Platform
owns the protected source read and keeps its credentials.

## Root Cause

Public setup, transfer verification, and Registry visibility had separate
anonymous reads. Some provider clients treated a throttled response as denied
access, and Registry could report an unverified repository as private.

## Source Changes

The Broker shares GitHub read transport and retry classification. Registry
checks identity and visibility through Repository Custody. Repository Setup and
Prototype import verification use the protected Platform interface.

## Artifact And Deployment Evidence

Candidate source is in an isolated worktree. Broker tests and the isolated
Console–Broker–Platform HTTP rehearsal are local evidence for this candidate.

## Live Verification

The existing metadata connection read succeeded against representative personal
and organization repositories. Scoped Source App reads succeeded for Workspace
Governance and the registered Little List repository.

## Follow-Up

Review the exact Console, Broker, and Platform revisions together and verify
the affected workflows in the accepted composition after activation.
