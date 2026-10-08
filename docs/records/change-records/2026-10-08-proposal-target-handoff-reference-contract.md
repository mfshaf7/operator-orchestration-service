---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-10-08-proposal-target-application-trust-boundary.md
    - contracts/proposal-target-application/manifest.json
    - contracts/proposal-target-application/request.schema.json
    - contracts/proposal-target-application/record.schema.json
    - contracts/proposal-target-application/result.schema.json
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: Fresh Security reacceptance is required before Platform recomposes the repaired Proposal Target source.
---

# Proposal Target Handoff Reference Contract

## Summary

The Proposal Target sub-contract now accepts the canonical handoff reference
already emitted by the live Proposal workflow. This is owner-repo maintenance
for Platform commissioning story `#1236`; it creates no additional ART child.

## Classification

- area: Proposal-to-Prototype target application
- type: cross-repo contract conformance repair
- runtime impact: permits an accepted live Proposal handoff to reach the
  existing human-reviewed Prototype Studio source path

## Ownership

- Proposal workflow authority: `operator-orchestration-service`
- target contract authority: `workspace-prototype-studio`
- existing commissioning work: `openproject://work_packages/1236`
- Security authority: `openproject://work_packages/1235`

## Root Cause

The canonical Proposal workflow permits bounded handoff identifiers and the
Console generates `proposal-handoff:idea-<id>:version-<version>`. The Proposal
Target request, result, and record schemas were tested only with the synthetic
legacy form `proposal-packet:<id>`. Live preparation therefore passed, but OOS
rejected its own generated Studio request before source mutation.

## Source Changes

- pins the merged Prototype Studio authority revision that accepts both the
  canonical handoff form and the retained legacy packet form;
- synchronizes the exact Studio request, record, and result schemas and their
  digests into OOS;
- updates the generated OpenAPI projection and its source generator; and
- exercises the canonical live handoff form in the OOS target workflow test.

The accepted form remains bounded to Proposal identity and record version. It
does not admit free-form content, another repository, another target, or a new
caller authority.

## Validation

- exact Studio-to-OOS schema synchronization
- Proposal Target contract and OpenAPI generation checks
- focused target application and boundary tests
- complete OOS test suite
- base-aware change-record validation

## Artifact And Deployment Evidence

- Studio authority merge: `workspace-prototype-studio@4066ea5ba5a68ab7ab12acc7fc395897e1ae6c3f`
- OOS source evidence remains the reviewed pull request and its eventual merge
- no runtime or deployment completion is claimed by this source repair

## Live Verification

Source validation is not operating proof. Security must reaccept the exact
Studio and OOS merges, Platform must repin and recompose them, and story
`#1236` must resume the same live Proposal application before availability is
claimed.

## Follow-Up

- Security reaccepts the exact Studio and OOS merges.
- Platform advances the exact source pins and recomposes `dev-integration`.
- Existing story `#1236` resumes the live application, denial matrix, and
  restart/rollback/redelivery proof.

## Rollback

Revert the Studio and OOS contract changes together, restore the prior exact
source pins, revoke the projected Proposal Target token, and keep the live
application non-terminal. Do not reinterpret a rejected request as success.
