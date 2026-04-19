---
security_evidence:
  review_areas:
    - runtime
    - ai
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-19 Accepted Idea Delivery Design And Profile

## Summary

Reserved the next broker workflow phase for consuming accepted ideas from
`Workspace Proposals` into a separate OpenProject delivery ART project, and
added a proposed `dev-integration` profile to rehearse that shape locally once
admitted.

## Classification

- change type: workflow design and proposed dev-integration profile
- lane: `dev-integration`
- workflow: accepted-idea consumption into PM²-governed one-ART delivery

## Ownership

- broker workflow seam and proposed profile owner:
  `operator-orchestration-service`
- delivery project and OpenProject product contract owner:
  `platform-engineering`
- profile lifecycle and registry owner:
  `workspace-governance`

## Root Cause

The accepted-idea backlog shape is now strong enough that the next enterprise
gap is no longer proposal intake. The missing piece is a real delivery plane
that can consume accepted ideas into enterprise project management without
overloading the proposal backlog itself.

## Source Changes

- added the reserved broker contract for accepted-idea delivery consumption
- updated repo guidance to describe the next workflow phase explicitly
- added a proposed `accepted-idea-delivery` dev-integration profile with a
  documented runtime target and placeholder command scripts

## Artifact And Deployment Evidence

- none yet; this is a design and proposed-profile landing only

## Live Verification

- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --repo-root . --against-ref origin/main`
- `git diff --check`

## Follow-Up

- admit or adjust the proposed `accepted-idea-delivery` profile only after the
  OpenProject delivery contract is stable enough to rehearse
- implement accepted-idea consumption in the new local profile rather than
  stretching the existing `idea-workflow` lane
