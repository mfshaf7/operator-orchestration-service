---
security_evidence:
  review_areas:
    - runtime
    - delivery
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/devint-host-service-profile.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "The correction projects only the two existing reviewed Workspace authority helpers required by the enabled Intake and Inventory source clients. It adds no permission, route, credential, or canonical mutation authority."
---

# 2026-10-03 Workspace Authority Runtime Helper Packaging

## Summary

Correct the `accepted-idea-delivery` broker runtime assembly so the enabled
Workspace Intake and Inventory source clients can invoke their existing,
reviewed Workspace Governance owner helpers from the copied `/runtime` tree.

## Classification

- area: Workspace Intake and Active Inventory dev-integration composition
- type: runtime packaging correction
- runtime impact: the broker init container now copies the two required
  read/prepare helper scripts into the same runtime tree as their callers

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: Workspace Delivery ART `#1210` non-source operating proof
- related products or components: Workspace Intake, Active Inventory, and the
  `refinement-catalog` dev-integration composition

## Root Cause

- immediate failure: the direct Inventory registry probe returned
  `workspace_inventory_authority_unavailable` even though the exact authority
  checkout and repository-scoped identity were mounted and valid.
- actual root cause: the profile copied `src/` and `contracts/` into
  `/runtime`, while both source clients resolve their owner helpers from
  `/runtime/scripts/`; neither required Python helper was copied.
- why it escaped earlier controls: profile tests asserted that Git, Python,
  source, and contracts existed, but did not assert the runtime-relative helper
  files required by the enabled source clients. Host real-Git conformance used
  the complete checkout and therefore could not expose the packaging omission.

## Source Changes

- changed workflow, adapter, or contract: copy only
  `workspace_intake_source.py` and `workspace_inventory_source.py` into the
  broker runtime during profile reconciliation; workflow behavior and API
  contracts are unchanged.
- tests or validator added: extend the profile source-toolchain regression test
  to require both runtime-relative helper copies.
- related change records: Platform's invalidated
  `2026-10-02-workspace-intake-inventory-devint-commissioning` record remains
  historical evidence and is not reused as operating proof.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: pending reviewed owner PR
  and exact-source dev-integration relaunch
- image tag or digest: unchanged; the profile assembles the accepted source
  checkout into an ephemeral runtime volume
- runtime revision: pending merged OOS commit and refreshed Platform pin

## Live Verification

- local validation: pending profile regression, repository validation, and
  real-Git Intake/Inventory conformance
- live or dev-integration verification: pending exact-source relaunch followed
  by commission, delivery, direct status, restart, revocation, rollback, and
  final activation proof
- residual risk: activation remains fail-closed until refreshed exact-source
  Security acceptance and Platform pins land

## Follow-Up

- required follow-up: merge the reviewed OOS correction, obtain exact-source
  Security acceptance, refresh Platform's accepted OOS/Security pins, and
  complete `#1210` with secret-free live receipts.
- owner: `operator-orchestration-service`, then `security-architecture` and
  `platform-engineering` in that order
- due date or closure condition: before Workspace Intake or Inventory is
  represented as operating-ready
