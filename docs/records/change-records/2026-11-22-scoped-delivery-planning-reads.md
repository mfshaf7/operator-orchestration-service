---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Scope Delivery register and PI Planning reads

## Summary

Work Design and Refinement request the current register directly. History
keeps its separate read scope and exact record lookup. PI Planning indexes
current Epic membership from real OpenProject descendants, loads scoped
trees, and resolves external prerequisites by source identity.

## Classification

Owner-repo maintenance for the coordinated Console release.

## Ownership

This is Console maintenance in the broker owner repo under `console-reads-20261122-delivery-reads`.
The Console consumer is reviewed in its own repo and activates through the
same Platform composition.

## Root Cause

The current registers and PI Planning queried a broad Delivery history and built trees beyond their selected work.

## Source Changes

Broker tests cover current versus history, actual assignment, unassigned work,
focused Epics and archived prerequisites. The planning index expires after
30 seconds and refreshes after a confirmed placement. Exact source reads and
existing write validation continue to govern changes to a plan.

### OpenProject contract evidence

This diff adds a GET index and scopes existing reads. The prior
[disposable OpenProject form proof](2026-11-22-pi-planning-delivery-rehearsal.md#openproject-contract-evidence)
verified writable Target PI and Iteration fields, native allowed values, and
the Catalog-owned read-only version field. Current write eligibility still
requires the same native form schema and dated Catalog checks. The planning
index supplies display membership and has no mutation authority.

## Live Verification

Local and isolated evidence covers the source candidate. Live readback follows
exact-source acceptance through the existing Console composition.

## Artifact And Deployment Evidence

The broker image must be built from the reviewed merged revision.

## Follow-Up

Review the exact source and the composed Console release before activation.
Retain the previous accepted composition for rollback.
