---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - src/prototype-landing/records-client.js
    - src/prototype-landing/source-client.js
    - src/prototype-landing/service.js
    - src/prototype-landing/store.js
    - src/prototype-maturity/service.js
    - src/prototype-maturity/store.js
    - src/prototype-closure/service.js
    - src/prototype-closure/store.js
    - src/delivery-art/source-realization.js
    - src/record-authority-freshness.js
    - src/proposal-target-application/source-client.js
    - src/prototype-maturity/source-client.js
    - src/prototype-closure/source-client.js
    - src/workspace-intake/source-client.js
    - src/workspace-inventory/source-client.js
    - src/app.js
    - contracts/console-source-authority/manifest.json
    - docs/operations/prototype-landing-operator-surface.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "Bounded authenticated canonical reads only; no new mutation, provider identity, Git fetch, shell or approval authority. Exact composed Security acceptance and Platform commissioning remain required before runtime activation."
---

# 2026-10-16 Console journey owner reads

## Summary

Expose current Prototype registry/capture truth and the canonical Delivery
initiative collection to the existing Console source-projection boundary.

## Classification

- area: Console journey primary owner reads
- type: extend existing source adapters
- runtime impact: source-only until the complete repair batch is accepted

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: existing acceptance `openproject://work_packages/1298`
- related products or components: Governance Operations Console, Workspace Prototype Studio

## Root Cause

- immediate failure: live Prototype and Delivery primary workspaces expose no canonical records.
- actual root cause: workflow-specific live commands existed, but their primary record discovery was never wired; fixture exclusion correctly revealed the missing binding.
- why it escaped earlier controls: isolated capability evidence was mistaken for a complete executable operator journey.

## Source Changes

- changed workflow, adapter, or contract: authenticated read-only Prototype collection over immutable Studio Git truth and caller-scoped durable Landing/Maturity/Closure public progress; negotiated source envelopes for existing Delivery initiative and realization reads; bounded Platform data-checkpoint consumption across all six existing Studio and Workspace source adapters; explicit cancellation of an interrupted accepted-only generation under the same owner lock, without changing applying/unknown recovery or any source acceptance gate.
- tests or validator added: real Git cold reconstruction and trusted-ref advancement, checkpoint expiry/ref/owner/ancestry/symlink denial, all six adapters rejecting missing commissioned data before owner execution, invalid capture, duplicate identity, cold caller-scoped workflow discovery without source bytes, bounded HTTP authentication and canonical owner/ordering projection, accepted-only interruption cancellation with no source mutation and linked retry.
- related change records: `2026-10-14-bounded-source-realization.md`; source realization semantics are reused, not replaced.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: maintenance Landing Unit `maintenance-1275-console-journey-oos`
- image tag or digest: None before ordered commissioning
- runtime revision: None before exact Security acceptance

## Live Verification

- local validation: full serial working-tree owner suite passed with 1,369 passing tests and two intentional skips; focused 144-case reads/guards/workflow/recovery proof and generated API contract validation passed; exact committed CI-equivalent proof remains required before publication
- live or dev-integration verification: pending the coherent Console, data-freshness and realization commissioning batch
- residual risk: source/data freshness remains deployment-owned; a provider revision absent from the trusted local ref fails closed rather than triggering an OOS fetch

## Follow-Up

- required follow-up: bind the Console primary projections, commission approved record freshness and bounded realization, update the generated Security index and exact composition review, then execute the same real journey
- owner: OOS, Console, Platform and Security according to their existing boundaries
- due date or closure condition: before Epic 1275 acceptance closes
