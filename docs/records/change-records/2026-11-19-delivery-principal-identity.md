---
security_evidence:
  review_areas: [identity, delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Native Delivery principal identity

## Summary

Operator-approved maintenance of the existing Delivery assignment workflow.
Landing Unit Decision: `child_isolated_landing_unit`,
`delivery-principal-identity-oos-20261119`. The backend has a distinct source,
runtime and rollback boundary from the paired Console presentation batch.
Agent Gary authors; the standing delegated human reviews and merges.

## Root Cause

A real Refinement Apply failed after initiative governance and coordinated
planning, before the first metadata record was updated. Read-only inspection
proved the target form schema marked Assignee and Responsible writable with
type User. Its allowedValues route returned the intended native user identity,
but omitted that account's login; only the authenticated caller exposed login.
The current scoped Catalog supplied that login and the matching
`openproject://users/<id>` reference. No membership change was required.

The writer matched login/display text, while Catalog offered login keys.
Refinement's canonical snapshot also read display titles into login fields,
which would disagree with accepted values after a successful assignment.
Native evidence and the original accepted input/failed-run timeline remain
in private operator custody; no tokens or real operator records enter source.

## Source Changes

Reuse the existing authenticated Catalog projection to bind login keys to
native user/group identities. Every write must still find the exact identity
in that work item's current native allowedValues. A matching display name
cannot substitute a different identity. Ambiguous Catalog identity evidence
fails closed. There is no slug conversion, new directory enumeration, new
permission or credential, or alternate native writer.

The shared resolver covers initiative, plan, create and update assignment.
Refinement reads Assignee/Responsible options from each current form, projects
only the matching Catalog keys, and normalizes saved role values by native
identity for subsequent accepted-value readback. Missing identity authority
cannot invent a successful assignment or receipt.

## Artifact And Deployment Evidence

Faithful native User-form regressions cover hidden login, different display
name, same-text/different-identity rejection, per-item restriction and both role
fields. Canonical snapshot tests retain login keys and exclude an account that
is not allowed on the target. Catalog tests reject foreign, retired and
ambiguous identity evidence. The full owner suite passed: 2,043 tests, two
existing skips. API/bundle, source safety and CI-equivalent image checks remain
required before publication.

## Security And Rollout

The [bounded identity review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-19-delivery-principal-identity.md)
retains native assignment authority and existing Catalog custody. Publish the
backend and approved Console batch, then bind exact merged revisions in the
existing composed Security decision before normal activation. Preserve the
original failed run and its partial effects. Source publication is not proof
that the pending business update completed. Re-read canonical state before a
fresh reviewed decision; do not blindly repeat an unconfirmed command.

Rollback restores the previous accepted source composition while retaining
ART values, private drafts and original run history. No data deletion or
permission expansion is part of rollback.


## Classification

Required maintenance of the existing Delivery writer and Refinement readback,
without additional ART scope or a new improvement candidate. The existing
Catalog and native form authorities are reused.

## Ownership

OOS owns mapping, requests and receipt validation. OpenProject retains identity
and target assignment permission; Platform owns runtime activation. Console
projects the existing workflow. Security owns the paired source review and
exact composition decision.

## Live Verification

Read-only native form and Catalog inspection proved the mismatch before this
repair. No test membership or synthetic mutation was made in the persistent
working project. Successful real assignment and canonical Refinement receipt
remain post-activation proof, not claims from local tests.

## Follow-Up

Land exact reviewed owner sources, refresh the generated Security owner-record
index, bind exact merged source pins and activate normally. Re-read retained
partial effects, recover reviewed metadata through the live Console and verify
native outcomes before cleanup and completion claims.
