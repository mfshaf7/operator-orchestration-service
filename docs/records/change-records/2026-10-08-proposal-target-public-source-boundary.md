---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
  reviewed_artifacts:
    - contracts/proposal-target-application
    - src/proposal-target-application/contracts.js
    - src/proposal-target-application/service.js
    - scripts/sync_proposal_target_application_openapi.mjs
    - docs/operations/proposal-target-application-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: The adapter remains runtime-inactive and awaits the exact Security review in ART #1235.
---

# Proposal Target Public Source Boundary

## Summary

Owner maintenance removes unreviewed Proposal and operator content from the
public Workspace Prototype Studio publication path discovered during Security
review #1235.

## Classification

- area: Proposal-to-Prototype target application
- type: public-source data-handling correction
- runtime impact: inactive until Security #1235 and the later activation chain

## Ownership

- owner repo: `operator-orchestration-service`
- target contract owner: `workspace-prototype-studio`
- tracking signal: `2026-10-08-proposal-target-public-source-prepublication-regression`

## Root Cause

- immediate failure: the target request and generated files carried free-form
  names, objectives, rationales, custody refs, and operator identity.
- actual root cause: the implementation treated pull-request review as the
  safety boundary even though a branch in the public repo is already public.
- why it escaped: source integrity and review controls were tested, but the
  pre-publication data projection itself had no negative contract tests.

## Source Changes

- pins Prototype Studio public-safe target contract v2 at exact owner commit
  `eab7af0c44de2e76eb381bf06447105ce3a28863`
- derives Prototype and application identities from the Proposal number
- sends only opaque refs, digests, timestamps, generated identifiers, and
  enumerated route or custody posture to the public owner
- rejects caller-selected Prototype naming and proves private fields are absent
  from the public request

## Artifact And Deployment Evidence

- source-only correction; `runtime_activation` remains `false`
- exact target-owner source authority: `eab7af0c44de2e76eb381bf06447105ce3a28863`
- no image, environment, or live runtime change

## Live Verification

- focused Proposal target service, contract, and real-Git adapter tests
- synchronized owner-contract and OpenAPI checks
- full repository CI-equivalent validation before merge
- fresh Security decision remains assigned to #1235 before any live activation

## Follow-Up

- Security #1235 must review the exact merged Prototype Studio and OOS
  revisions before any runtime activation or Platform commissioning.
