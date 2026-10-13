# 2026-10-14 Non-architecture owner evidence tests

## Summary

Add an unconditional OOS test command so ordinary source-backed maintenance can satisfy the existing test-and-validation evidence baseline when no Architecture Packet conformance case applies.

## Classification

- area: Delivery ART owner evidence profile
- type: owner-repo maintenance
- runtime impact: future evidence acquisitions use the accepted-base profile; no active runtime behavior changes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1301`
- related products or components: Operator Orchestration Service; Governance Operations Console delivery workflow

## Root Cause

- immediate failure: work-item 1301 preflight rejected the OOS profile as missing required test evidence.
- actual root cause: the profile's only real-git test command was `matching-fidelity`, so it was correctly excluded when the non-architecture Landing Unit had no conformance cases.
- why it escaped earlier controls: profile validation covered architecture-bound cases but had no regression case for the required evidence kinds with an empty conformance plan.

## Source Changes

- changed workflow, adapter, or contract: add an unconditional full owner test command and document the non-architecture baseline.
- tests or validator added: exercise the accepted OOS profile with no conformance cases while requiring both tests and validations.
- related change records: `workspace-governance/reviews/improvement-candidates/2026-10-14-owner-evidence-retry-transition-regression.yaml`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only accepted-base profile repair
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused owner-evidence acquisition tests and full repository checks
- live or dev-integration verification: work-item 1301 preflight must accept the landed profile from exact `origin/main`
- residual risk: architecture-bound acquisitions run the unconditional baseline test plus any matching-fidelity test command; this favors complete evidence over deduplicating identical invocations

## Follow-Up

- required follow-up: start work-item 1301 and repair bounded failed-evidence retry semantics
- owner: `operator-orchestration-service`
- due date or closure condition: work-item 1301 reaches finalized evidence and work-item 1284 resumes successfully
