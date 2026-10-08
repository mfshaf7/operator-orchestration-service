---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/evidence-profile.schema.json
    - src/delivery-art/review-evidence-acquisition.js
    - src/delivery-art/lifecycle-cli-adapters.js
    - src/delivery-art/lifecycle-controller.js
    - test/delivery-art-review-evidence-acquisition.test.js
    - test/delivery-art-lifecycle-cli-adapters.test.js
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair prevents unrelated same-fidelity commands from executing, permits exact capability case scoping, and trusts a candidate profile only after its exact head is accepted by the existing reviewed merge transition. It adds no source, merge, runtime mutation, or ART mutation authority."
---

# Owner Evidence Case Binding

## Summary

Bind each capability-specific owner evidence command to its exact conformance
cases, omit unmatched commands, and allow post-merge operating evidence to use
the exact source revision accepted by the existing reviewed merge gate.

## Classification

- area: Delivery ART owner evidence acquisition
- type: corrective owner-repo maintenance
- runtime impact: authenticated source executor and lifecycle evidence selection
- recommendation posture: extend the existing evidence-profile control
- Landing Unit decision: `child_isolated_landing_unit`; this OOS contract and
  runtime repair must land before Platform consumes the selector

## Ownership

- owner repo: `operator-orchestration-service`
- work home: owner-repo maintenance linked to the accepted workspace
  improvement candidate
- tracking reference:
  `workspace-governance/reviews/improvement-candidates/2026-10-08-cross-capability-owner-evidence-binding-regression.yaml`

## Root Cause

- the executor ran every profile command even when a `matching-fidelity`
  command bound zero requested cases;
- fidelity alone could not distinguish two capabilities implemented by the
  same owner repository; and
- operating evidence could read only the pre-work base profile, so a verifier
  added by the reviewed source change could not prove that change after merge.

## Source Changes

- an optional exact `conformance_case_ids` selector narrows
  `matching-fidelity` commands;
- unmatched scoped or fidelity-bound commands are omitted from acquisition and
  cannot satisfy required evidence-kind coverage;
- pre-merge acquisition continues to use the accepted base profile; and
- post-merge operating acquisition uses the exact reviewed source head profile.

## Artifact And Deployment Evidence

- source-only until the OOS maintenance pull request merges;
- Platform consumes the selector only after that merge; and
- active `dev-integration` reconciliation must use the merged OOS revision
  before Delivery #1236 retries evidence acquisition.

## Live Verification

- unit tests prove cross-capability commands are omitted;
- schema and semantic tests reject selectors on unconditional commands;
- adapter tests prove exact base and accepted-head profile resolution; and
- full OOS tests plus API and governance validation remain required before merge.

## Residual Risk

Unscoped `matching-fidelity` commands remain intentionally generic for backward
compatibility. Owner repositories must scope capability-specific commands to
exact architecture conformance case identifiers.

## Follow-Up

- add exact Repository/Catalog and Proposal Target case selectors to the
  Platform evidence profile;
- reconcile the active OOS runtime from the merged maintenance revision; and
- resume Delivery #1236 without creating another ART child.

## Rollback

Revert the selector schema, acquisition filtering, accepted-head profile
resolution, tests, operator guidance, and this record together. Existing
receipts remain immutable evidence of the profile revision used at acquisition.
