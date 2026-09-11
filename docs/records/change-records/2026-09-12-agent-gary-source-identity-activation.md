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
    - src/art-cli.js
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
- Projects credential lifetime as `authorization_expires_at`; provider-native
  token field names and token values remain outside reconstructable work-session
  state and command receipts.
- Routes normal `work` CLI reads and commands through the caller-bound OOS
  work-session API so only the designated source executor consumes Agent Gary
  credentials. Commands bind the latest server revision and use unique command
  identifiers whose server-side request digests preserve safe replay.
- Reconciles historical root-owned files only within the dedicated
  work-session state volume before the non-root broker starts, preserving
  restart continuity without widening host filesystem access.

## Artifact And Deployment Evidence

- Source-only change in the existing admitted `accepted-idea-delivery`
  dev-integration profile.
- Local API and worker images built successfully from the Landing Unit head as
  `oos-api:1137-test` and `oos-orchestration-worker:1137-test`.
- The API health smoke passed and the worker preserved its default fail-closed
  startup posture.
- The managed profile reconcile was attempted twice and stopped at different
  Ruby initialization points with host process exit `139`. The changing crash
  location is consistent with the known host RAM fault, so no full-profile
  deployment claim is made.
- Bounded recovery restarted only the existing delivery source executor and
  broker after applying the committed state-volume ownership correction. Both
  returned ready, and broker-owned session state remained writable by runtime
  UID/GID `1000`.

## Live Verification

- Local validation passed: all `1021` OOS tests, orchestration and refinement
  bundles, every generated OpenAPI/schema check, governance docs, base-aware
  change-record and OpenProject mutation-contract checks, and
  `git diff --check` against fetched `origin/main`.
- Dev-integration dogfood passed: OOS consumed the bounded Platform credential,
  configured the exact Agent author, pushed the exact non-main head, created
  GitHub pull request `#207` as `mfshaf7-agent-gary[bot]`, and requested review
  from `mfshaf7`.
- GitHub validation for pull request `#207` passed the
  `validate-governance-docs` job.
- Secret-safe persistence was verified after the initial command result exposed
  the provider field name `token_expires_at`: the public projection now uses
  `authorization_expires_at`, and the durable-state secret guard rejects the
  provider-native token field.
- Residual risk: the exact final pull-request head still requires human review
  and merge, followed by operating-readiness issuance and immutable Review
  Packet finalization. The host RAM fault prevents a truthful full managed-profile
  reconcile claim but does not weaken those gates.

## Follow-Up

- Required follow-up: publish this final source head through the existing Agent
  pull request, finalize merge-ready evidence, obtain human review and merge,
  issue operating readiness, finalize the Review Packet, and close #1137.
- Owner: OOS for evidence and lifecycle coordination; `mfshaf7` for review and
  merge.
- Closure condition: the finalized Review Packet covers #1137 and the ART
  closeout succeeds.
