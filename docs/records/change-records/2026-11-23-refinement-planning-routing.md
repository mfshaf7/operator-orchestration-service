---
security_evidence:
  review_areas: [delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/delivery-change/pi-planning.js
    - src/delivery-execution-navigation.js
    - src/refinement/packet-model.js
    - test/delivery-art-openproject.test.js
    - src/saved-work/store.js
    - test/saved-work.test.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session-cli-adapters.js
    - test/delivery-art-service.test.js
    - test/http.test.js
  notes: Applies preparation checks per item, binds read-only plan facts to the authenticated operator, and keeps drafts inert within existing operator-scoped custody.
---

# Refinement and PI Planning routing

## Summary

Refinement projects open preparation needs. PI Planning owns objective
decisions and dated assignments.

## Classification

Shared Delivery workflow maintenance. The Landing Unit Decision is
`feature_single_landing_unit` for the broker.

## Ownership

OOS owns the navigation projection and planning eligibility. The Console
owner updates Current, History and the planning controls using that projection.

## Root Cause

Refinement reused execution readiness, which includes an iteration. Including
PI Objective metadata in Refinement also kept its gate open after a valid
preparation receipt. One blocked child could move the package into Execution
and bypass planning preparation checks for other items.

## Source Changes

Project only remaining Refinement preparation, retaining the objective in the
readable tree. Planning review checks each selected item even when the package
is visible in Execution. Existing execution eligibility and dependency checks
continue to apply.

Technical Plan drafts reuse the existing caller/operator/subject binding and
revision checks described in the [Saved Operator Work security review](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-10-29-saved-operator-work.md).
The saved draft stores bounded editable data. Validation, approval and
durable plan recording use the existing separate architecture packet routes.
Single-repository plans reuse the installation defaults and require lifecycle
and authorization evidence when the selected plan uses those controls. The
facts route uses the existing authenticated caller and bounded source
executor. It returns observations for draft preparation without recording a
plan or authorizing execution. Advisor readiness reports whether the native
service is active.

## Live Verification

A read-only canonical owner replay reproduced the open Refinement metadata
gate for a PI objective added after a completed apply. The current native
Refinement form schema supplied editable metadata for incomplete delivery
work. That same form contract continues to cover the eligible work items,
while objectives are retained as readable tree entries. The native adapter
regression verifies the form requests, field data types, `allowedValues`,
and the handling of required fields that become read-only. Original receipts
are preserved.

## Artifact And Deployment Evidence

The connected disposable rehearsal passed both Delivery handoff routes, PI
scheduling and replay, private Technical Plan validation, approval through
WGCF custody, closeout and locked History. The running installation and
business records stayed outside the rehearsal.

## Follow-Up

Release qualification pairs exact reviewed OOS and Console revisions. Recheck
the original Refinement receipt, focused PI Planning and the dependency after
activation. Scheduling decisions remain with the operator.
