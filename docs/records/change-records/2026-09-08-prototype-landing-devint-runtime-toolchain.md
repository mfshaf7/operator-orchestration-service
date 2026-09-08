---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/devint-host-service-profile.test.js
  workstreams:
    - WS-007
  notes: "Restores tools already required by the reviewed Prototype Landing boundary; no identity, permission, destination, or stage/prod authority changes."
---

# Prototype Landing Dev-Integration Runtime Toolchain

## Summary

ART #1116 corrects the accepted-idea-delivery API runtime so the already
approved Prototype Landing source client can use Git and Python after every
pod restart.

## Classification

- area: accepted-idea-delivery runtime profile
- type: bounded dev-integration runtime correction
- runtime impact: API pod image and startup preflight only

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1116 under Feature #1110 and Epic #892
- related proof: Console operating proof #1115

## Root Cause

The profile copied current OOS source into a stock Node image. The resulting
service passed HTTP readiness, but the image did not contain the Git and Python
executables required by the Prototype Landing authority and source paths.

## Source Changes

- Run the API container on the immutable published OOS runtime image.
- Continue copying the profile-selected local checkout into `/runtime` so the
  image does not replace source-session truth.
- Refuse startup when Git or Python is unavailable.
- Add focused profile regression coverage and operator guidance.

## Artifact And Deployment Evidence

- runtime image: immutable OOS digest recorded in the profile
- source execution: selected checkout copied by the existing init container
- stage or production impact: none

## Live Verification

The merged profile must launch in the active accepted-idea-delivery lane,
survive restart with Git and Python available, and allow Console preparation to
read the exact mounted Prototype Studio authority revision. Console proof #1115
owns the subsequent successful Landing and bounded negative cases.

## Rollback

Revert the profile image and startup preflight together. This does not alter
Prototype records, OOS workflow semantics, WGCF decisions, Platform identity,
or Console source.

## Follow-Up

Complete the live runtime verification in ART #1116, then resume the Console
operating proof owned by ART #1115. No additional runtime capability is created
by this correction.
