---
security_evidence:
  review_areas: [identity, secrets, delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# PI Planning and Delivery rehearsal corrections

## Summary

Refinement prepares work metadata. PI Planning commits work to a dated
calendar and records objectives. Execution reads the saved plan and continues
eligible work through the existing source and evidence-only workflows.

## Classification

Delivery workflow maintenance and release preparation for the approved batch.
Runtime changes cover the planning, source setup, and closeout paths.

## Ownership

The broker changes belong to one owner Landing Unit,
`pi-planning-delivery-rehearsal-oos-20261122`, with decision
`feature_single_landing_unit`. The related Platform Catalog and Console
changes have their own owner repositories and ship in the same coordinated
activation. The current business work and its planning records stay in the
operator's existing Delivery initiative.

## Root Cause

Refinement and Execution both exposed parts of PI Planning. Free-form
iteration labels could reach the writer without a dated calendar. In the
rehearsal, source-free objective review depended on a source checkout lookup,
Prototype intake rejected a valid initial revision, and source closeout
depended on a historical ART record absent from a fresh installation.

## Source Changes

Catalog creates and dates PIs together with their generated iteration windows.
Existing labels and assignments remain readable until the operator approves a
plan change. Reconciliation of a calendar preserves existing assignments.

### OpenProject contract evidence

In disposable OpenProject, the broker read the native create and update form
schema. Target PI and Iteration used the native, writable custom fields. The
read-only native version field remains outside the generic work-item writer;
the Platform Catalog control owns version dates. The broker checks changed
placements against that Catalog's dated windows before invoking the existing
native form writer. Disposable requests verified rejection of invented
iterations, successful dated assignments and exact receipt replay. The
calendar rehearsal verified readback of dated iterations with saved labels and
work-item assignments intact. No rehearsal dates were applied to the working
ART.

In the connected run, canonical Refinement and PI Planning advanced a prepared
package through Execution and closeout. Objective review recorded evidence
without a repository when authoritative session custody confirmed there was no
source session. Source-backed work still follows its existing session path.
The Prototype intake replay used the native initial lock version of zero and
returned one original receipt.

### Source and trust boundaries

- Retirement uses the admitted broker capability manifest. Historical work
  item #970 remains activation evidence in Workspace Governance. Closed ART
  scope, finalized Review Packet custody, exact merged source, and resource
  ownership are still checked before cleanup. Ref updates retain their
  compare-and-delete guards.
- Repository setup retains exact Gary authorship, human approval of the current
  head, and the required validation. The standard protected GitHub squash
  request includes that exact head. After an interrupted response, the broker
  reads the same pull request before confirming success.
- The register reads the exact verified Platform snapshot and rejects expired
  or changed authority. The separate writer retains its existing credentials
  and approval requirements.
- The private source editor recognizes the checkout owned by the same
  installation and Landing Unit. It keeps the canonical read envelope. The
  owner's trusted application verification mode governs merge-ready evidence;
  operating evidence and specified architecture cases retain their own tests.

These boundaries build on the [original retirement review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-08-23-delivery-art-work-session-resource-retirement.md).

## Artifact And Deployment Evidence

The release decision must reference the exact new source and its accompanying
Security evidence. The current source candidate is qualified only in the
disposable and local test environments.

## Live Verification

The earlier disposable GitHub run proved the author, review, merge, and
finalized packet flow. The fresh follow-up broker booted without work item #970
and used the new manifest. Follow-up checkout, merge, and cleanup regressions
used local Git. Broker and Console unit, semantics, and contract checks cover
the behavior of the release candidate.

## Follow-Up

Review the owner sources, bind the landed broker manifest to Workspace
Governance, and review the exact composed sources before normal Platform
activation. Keep a pre-change readback before dating a real PI. Confirm the
schedule with the operator and compare saved assignments and labels after
applying it. Source rollback uses the prior accepted composition. A committed
calendar or work-item update requires its own reviewed correction.
