---
security_evidence:
  review_areas:
    - identity
    - secrets
    - runtime
    - delivery
    - ai
  reviewed_artifacts:
    - contracts/delivery-art-work-session/agent-source-identity.json
    - src/delivery-art/agent-source-identity.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/source-executor.js
    - dev-integration/profiles/accepted-idea-delivery
  workstreams:
    - WS-007
  notes: "Consumes only the Platform-owned short-lived Agent Gary projection; human review and merge remain mandatory."
---

# Agent Gary Source Identity Activation

## Summary

ART #1137 activates Agent Gary as the bounded source implementor for OOS
Delivery work sessions while preserving human review and merge authority.

## Classification

- area: Delivery ART source identity and pull-request publication
- type: source-backed identity, secret-consumption, and delivery control
- runtime impact: activates only in the admitted `accepted-idea-delivery` dev-integration profile

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: #1137 under Feature #920 and Epic #892
- related products or components: Platform agent identity projection, Workspace Governance source contract, Security Architecture review, GitHub App

## Root Cause

- immediate failure: OOS source work still depended on the human Git identity for authoring and publication.
- actual root cause: the Platform-owned Agent Gary credential boundary from #1136 had no bounded OOS consumer.
- why it escaped earlier controls: consumer activation was deliberately sequenced after identity provisioning and security acceptance.

## Source Changes

- Adds an exact OOS consumer contract for identity, repository, Landing Unit,
  branch, fetched base, reviewer, expiry, allowed actions, and denied actions.
- Adds per-action locked credential reads, exact Agent Git author preparation,
  one-repository provider-scope verification, exact-head push and pull-request
  publication, and human reviewer assignment.
- Keeps approval and merge human-only and rejects ambient human credential
  fallback for Agent actions.
- Adds safe status projection, finite source-executor actions, profile wiring,
  OpenAPI projection, and focused identity/restart/security tests.

## Artifact And Deployment Evidence

- source-only change in the existing admitted dev-integration profile
- image tag or digest: None
- runtime revision: pending source merge and dev-integration dogfood

## Live Verification

- local validation: pending full OOS suite and base-aware validation
- live or dev-integration verification: pending Agent-authored exact-head PR dogfood for #1137
- residual risk: activation proof remains incomplete until the Platform projection is delivered and the Agent-authored PR is human-reviewed and merged

## Follow-Up

- required follow-up: deliver a bounded credential, publish this Landing Unit as Agent Gary, verify human-only review and merge, and close #1137 with a finalized Review Packet
- owner: Platform Engineering for credential lifecycle; OOS for consumption; `mfshaf7` for review and merge
- due date or closure condition: before ART #1137 closes
