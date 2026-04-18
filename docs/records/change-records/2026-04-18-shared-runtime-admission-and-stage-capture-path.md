---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  findings:
    - F-007
  risks:
    - R-007
  workstreams:
    - WS-007
---

# 2026-04-18 Shared Runtime Admission And Stage Capture Path

## Summary

- change class: shared component runtime admission
- user-facing impact: adds the first bounded `/idea` capture path through the broker service
- operator-facing impact: introduces a shared internal runtime, image path, and deployment contract for `operator-orchestration-service`

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `workspace-governance`
  - `platform-engineering`
  - `security-architecture`
  - `openclaw-telegram-enhanced`
- trust-boundary areas:
  - identity
  - secrets
  - delivery
  - runtime

## Ownership

- workflow API and runtime owner: `operator-orchestration-service`
- shared runtime admission and secret delivery owner: `platform-engineering`
- workspace inventory and repo admission owner: `workspace-governance`
- security review owner: `security-architecture`
- Telegram adapter owner: `openclaw-telegram-enhanced`

## Root Cause

The broker had a capture-capable runtime skeleton but was still only a proposed component. That left a gap between the intended operator workflow model and the platform’s actual ability to deploy, audit, and verify the service as a governed shared runtime.

## Source Changes

- added repo-local governance enforcement:
  - `.github/pull_request_template.md`
  - `.github/workflows/validate-governance-docs.yaml`
  - `scripts/validate_governance_docs.py`
  - `scripts/validate_change_record_requirement.py`
  - `docs/records/change-records/policy.yaml`
- added runtime admission artifacts:
  - `Dockerfile`
  - `.github/workflows/build-image.yaml`
  - `contracts/interface-manifest.json`
- updated repo guidance and README to reference the runtime-admission security artifacts and change-record lane

## Artifact And Deployment Evidence

- image build owner workflow:
  - `.github/workflows/build-image.yaml`
- immutable image digest:
  - pending platform rollout after merge
- shared runtime deployment evidence:
  - pending `platform-engineering` admission and Argo reconciliation

## Live Verification

- repo-local runtime tests:
  - pending in this owner repo change set
- shared runtime verification:
  - pending platform deployment and `/healthz` plus `/readyz` checks
- stage capture verification:
  - pending Telegram `/idea` end-to-end rehearsal on stage

## Follow-Up

- admit the repo and component into active workspace contracts
- add the shared component docs and runtime manifests in `platform-engineering`
- add the component security view and runtime-admission review in `security-architecture`
- wire the stage Telegram `/idea` capture path after the shared runtime is reachable
