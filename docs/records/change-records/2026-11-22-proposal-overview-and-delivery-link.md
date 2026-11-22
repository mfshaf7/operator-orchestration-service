---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Bound Proposal overview and restore Delivery links

## Summary

The compact Proposal register view supports the Console overview without
fetching the linked Delivery detail per row. The Proposal Hub retains the full
record and resolves the link using the canonical Delivery member reference.
Repository acknowledgement recovery checks the existing journal receipt before
returning success after a response interruption.

## Classification

Owner-repo maintenance for the coordinated Console release.

## Ownership

This is Console maintenance in the broker owner repo under `console-reads-20261122-proposal-delivery-link`.
The Console consumer is reviewed in its own repo and activates through the
same Platform composition.

## Root Cause

The Home overview used each Proposal row’s full Delivery link resolution. The hub relied on a root binding where the native member used a record reference.

## Source Changes

Proposal register and service tests verify the compact projection, full hub
link, and exact journal recovery. This release uses the existing broker caller
and workflow authority. The compact route returns less data to the same caller.
Existing repository acknowledgement and Delivery write permissions still apply.

## Live Verification

Local and isolated evidence covers the source candidate. Live readback follows
exact-source acceptance through the existing Console composition.

## Artifact And Deployment Evidence

The broker image must be built from the reviewed merged revision.

## Follow-Up

Review the exact source and the composed Console release before activation.
Retain the previous accepted composition for rollback.
