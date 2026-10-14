---
security_evidence:
  review_areas:
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/delivery-art-work-session/source-realization-change-set.schema.json
    - contracts/delivery-art-work-session/source-realization-start.schema.json
    - src/delivery-art/source-realization.js
    - src/delivery-art/source-executor.js
    - src/delivery-art/work-session-controller.js
    - src/delivery-art/contracts.js
    - src/delivery-art/service.js
    - src/delivery-art/work-session-cli-adapters.js
    - src/delivery-art/lifecycle-context.js
    - scripts/validate_openproject_mutation_contracts.py
    - docs/contracts/delivery-workflow-api-v1.md
    - docs/operations/delivery-workflow-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The model receives only CGG-admitted bounded context and returns a schema-validated draft. It receives no shell, repository credential, approval, review, merge, Security, or ART authority. Exact operator digest acceptance precedes isolated Agent Gary mutation. The path remains disabled until exact Security acceptance and Platform commissioning."
---

# 2026-10-14 Bounded source realization

## Summary

Add a staged, replay-safe OOS source-realization workflow that turns an accepted Delivery plan into one bounded Agent Gary commit without requiring Codex or CLI intervention in the normal Console path.

## Classification

- area: Delivery ART work-session source realization
- type: new bounded workflow capability within the existing OOS control plane
- runtime impact: source implementation can be requested, reviewed, accepted, committed, recovered, and handed back to the existing work-session lifecycle through authenticated APIs; activation remains disabled

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `openproject://work_packages/1285`
- related products or components: Governance Operations Console; Context Governance Gateway; Agent Gary source executor; governed model profile registry

## Root Cause

- immediate failure: the Delivery lifecycle stopped at `source-work-required`, so normal end-to-end operation still required manual Codex or CLI implementation.
- actual root cause: OOS had bounded context, source identity, validation, review, merge, recovery, and cleanup controls but no model-to-draft-to-exact-acceptance source transition.
- why it escaped earlier controls: earlier children proved each surrounding control independently without requiring the Console path to create a real source commit from an accepted plan.

## Source Changes

- changed workflow, adapter, or contract: add versioned start and change-set contracts, authenticated realization routes, CGG-only bounded context, governed-model binding, private draft custody, exact-digest acceptance, isolated Agent Gary apply, cancellation, retry, durable replay, unknown-outcome reconciliation, and pre-commit rollback.
- tests or validator added: real Git commit and rollback proof; exact post-commit recovery; executor durable replay; CGG/model fail-closed binding; cancellation and retry; API caller/operator forwarding; generated OpenAPI synchronization; stable serial owner-suite execution to avoid the repo's previously documented parallel resource flake; validator self-test coverage proving source-realization routes do not masquerade as OpenProject mutation routes; active-Landing-Unit architecture comparison that preserves unchanged work across unrelated packet corrections while still rejecting any local owner, execution, conformance, handoff, runtime-boundary, or gate change; crash-resumable normal-continuation refresh that serially rebinds current architecture and work-start evidence, preserves source, and invalidates stale Review Packet/readiness projections; historical dependency compatibility that preserves immutable superseded packets without allowing a valid but non-current packet to authorize new work start; canonical change-set digest reuse across operator acceptance, executor receipt, commit trailer, and replay reconciliation.
- related change records: `docs/records/change-records/2026-09-24-delivery-lifecycle-context.md`; `docs/records/change-records/2026-10-14-owner-evidence-retry-transition.md`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: Landing Unit `delivery-1275-source-realization`; implementation remains uncommissioned
- image tag or digest: None until Platform Engineering activates the reviewed exact source revision
- runtime revision: None until Security acceptance and Platform commissioning complete

## Live Verification

- local validation: focused source-realization, executor, real-Git adapter, service, HTTP, contract, and full repository validation
- live or dev-integration verification: deferred to the exact Security and Platform activation sequence, followed by Console end-to-end proof
- residual risk: model quality may yield a rejected draft; the workflow contains that outcome before mutation and requires an explicit linked retry

## Follow-Up

- required follow-up: obtain exact-head Security acceptance, commission the `source-realization-v1` profile and runtime composition, add the Console realization interaction, and prove a real simple product journey through the full Console path
- owner: Security Architecture, Platform Engineering, Governance Operations Console, and OOS according to Epic 1275
- due date or closure condition: before Epic 1275 closes
