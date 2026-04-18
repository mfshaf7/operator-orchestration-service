---
security_evidence:
  review_areas:
    - runtime
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-18 Broker-Owned Workflow Catalog And Read Projection

## Summary

The broker now owns canonical `/idea` workflow guidance and a bounded read
projection for captured idea records. This removes the wrong Telegram-local help
ownership model and gives adapters a stable internal API for workflow semantics
and recorded-state visibility.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `openclaw-telegram-enhanced`
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - runtime

## Ownership

- workflow catalog and read projection owner: `operator-orchestration-service`
- Telegram adapter rendering owner: `openclaw-telegram-enhanced`
- shared runtime rollout owner: `platform-engineering`
- security review owner: `security-architecture`

## Root Cause

The first broker admission proved bounded capture, but the operator visibility
model stayed incomplete and the Telegram repo temporarily carried canonical
workflow guidance it did not own. That left the system with the wrong
architecture shape for multi-source intake even though the live capture path
worked.

## Source Changes

- added broker-owned workflow catalog and descriptor endpoints
- added bounded idea read and lookup endpoints
- normalized source identity so multiple intake surfaces can share one contract
- preserved temporary legacy capture compatibility for staged rollout safety

## Artifact And Deployment Evidence

- image build owner workflow:
  - `.github/workflows/build-image.yaml`
- immutable image digest:
  - pending platform rebuild and rollout after merge
- shared runtime deployment evidence:
  - pending `platform-engineering` stage rehearsal on the updated broker image

## Live Verification

- `npm test`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `git diff --check`

- stage verification:
  - pending broker and Telegram `/idea help` plus `/idea <text>` rehearsal on
    the corrected workflow contract

## Follow-Up

- rebuild and deploy the broker image through `platform-engineering`
- roll the Telegram overlay that consumes broker-owned workflow descriptors
- verify stage `/idea help` and `/idea <text>` against the corrected contract
