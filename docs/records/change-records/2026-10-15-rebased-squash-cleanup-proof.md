---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/delivery-art/work-session-cli-adapters.js
    - test/delivery-art-work-session-resource-retirement.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The repair preserves fail-closed exact-diff cleanup, requires the recorded base to remain an ancestor, and adds no source, review, merge, runtime, credential, or deletion authority."
---

# 2026-10-15 Rebased squash cleanup proof

## Summary

Allow terminal work-session cleanup to prove an exact squash merge when the
reviewed branch was legitimately rebased from its recorded session base onto a
newer descendant of that base before review.

## Classification

- area: Delivery ART work-session resource retirement
- type: owner-repo maintenance repair
- runtime impact: cleanup may retire an exact reviewed branch after a safe
  descendant-base rebase; source, review, and merge authority are unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- Landing Unit: `maintenance-oos-rebased-squash-cleanup`
- triggering session:
  `work-session:delivery-1275:delivery-1275-source-realization`

## Root Cause

The cleanup proof compared the recorded session base directly to the reviewed
head. After a legitimate rebase, that range also contained upstream changes
already present in the squash parent, so it could not equal the landed squash
change and cleanup remained blocked.

## Source Changes

The proof now derives the reviewed change from the merge base shared by the
exact reviewed head and the exact single-parent squash parent. It separately
requires the original recorded session base to be an ancestor of that derived
base. This accepts only a descendant-base rebase and preserves the existing
exact diff comparison against the landed squash commit.

Regression coverage proves the rebased descendant case succeeds while the
existing unreviewed-change, missing-merge-evidence, non-single-parent, branch
head mismatch, and source ancestry denials remain intact.

## Artifact And Deployment Evidence

- source-only maintenance change
- no runtime configuration, image, credential, route, or activation change
- the repair takes effect when the exact reviewed OOS revision lands

## Live Verification

- focused real-Git resource-retirement suite
- full serial owner test suite
- governance documentation validation
- source-backed change-record validation against `origin/main`
- `git diff --check origin/main...HEAD`

## Rollback

Revert this Landing Unit to restore the former conservative cleanup behavior.
No source branch should be deleted manually if exact equivalence cannot be
proven.

## Follow-Up

Retry the blocked #1285 terminal cleanup through the normal `work close`
operation after this exact repair revision is deployed to the active OOS
dev-integration service. No separate product feature or ART child is required.
