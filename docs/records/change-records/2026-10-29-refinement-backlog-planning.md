---
security_evidence:
  review_areas:
    - runtime
    - delivery
  findings: []
  risks: []
  workstreams:
    - WS-007
---

# Refinement preserves uncommitted backlog planning

## Summary

Repair existing Refinement PI planning so current committed scope can be reviewed
beside valid uncommitted future Features. The operator explicitly selected
owner-repo maintenance for this repair, with no new ART child. Shipping,
installation packaging and new release-contract work remain deferred.

## Classification

Bounded existing-workflow repair, tracked as owner-repo maintenance by explicit
operator direction. This changes no authority boundary or API shape.

## Ownership

- Owner: Operator Orchestration Service.
- Tracking: this owner-repo maintenance record.
- Landing Unit: `maintenance-refinement-backlog-planning-20261029`.
- Decision: one isolated owner change; its source, tests and rollback are
  independent of Console UI repair siblings.
- Agent Gary authors source; the delegated accountable human reviews exact head.
- Existing Console UI and Refinement v1 interfaces are reused.

## Root Cause

The accepted ART planning rules permit new backlog Features and valid
non-executable planned children without PI commitment. Live canonical backlog
records coexist with a current Refinement packet that incorrectly marks their
blank Target PI and Iteration as missing required fields. That prevents the
operator from applying the valid mixed plan through the Console.

## Source Changes

The packet previously gave every current descendant the same planning-field
requirement. It now uses the native type/status rules and disjoint required and
optional target scopes. Accepted pairs use the existing planning validator.
Existing committed/active requirements, native hierarchy/leaf guards, final
human acceptance and field writable/read-only boundaries remain enforced.

## Live form contract evidence

The captured existing Console/OOS projections prove canonical uncommitted
Features with null PI and Iteration while their Refinement packet reports both
required/missing. Existing source-adapter reads obtain the actual OpenProject
form schema and writable/allowedValues metadata. No new writable field, custom
option, raw OpenProject mutation route or permission is introduced.

Regression coverage retains the real OpenProject adapter against its bounded
HTTP form fixture: Target PI and Iteration are writable String fields; version
is read-only and remains owner-reconciled. Packet tests additionally cover
unavailable blank optional fields, active missing required fields and retained
terminal history. Synthetic fixtures prove source behavior, not live operation.

## Live Verification

The existing packet projection, acceptance validation and activity/readback
paths share bounded planning helpers. Empty optional planning inputs keep their
reviewed source value. A concurrent mutation to retained planning conflicts
before planning writes; readback also checks the retained value before receipt.

Required validation includes focused mixed-posture and native-form regression
tests, the full owner suite, deterministic workflow bundles, API/docs checks,
fetched-base change-record and mutation-contract gates, and image smoke.

## Artifact And Deployment Evidence

Source validation is separate from operating qualification. Current OOS API and
Refinement worker consume pinned reviewed source. Paired exact-source Security
acceptance precedes the normal Platform runtime update. Preserve primary accepted
checkouts until that sequence is ready. Use the original Console Refinement
application and canonical receipt for operating proof; do not substitute broker
recovery, fixture success or a recreated initiative for that proof.

Rollback restores previous accepted source/images and paired decision through
the existing Platform lifecycle. Preserve business records, accepted inputs,
run IDs and historical receipts. No schema/data migration or installer is added.

## Follow-Up

Complete source validation, exact-head review, paired acceptance, normal runtime
update and original Console operating proof. Then stop for the operator's repair-
priority discussion. Do not start unrelated baseline or product-shipping work.
