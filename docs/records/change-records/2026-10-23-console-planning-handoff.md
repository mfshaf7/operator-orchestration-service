---
security_evidence:
  review_areas:
    - ai
    - delivery
    - identity
    - runtime
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/scripts/common.sh
    - src/openproject-client.js
    - src/refinement/activities.js
    - src/refinement/packet-model.js
  notes: "Extends only the registered complete composition with the existing purpose-specific Work Design binding. Canonical form permissions, allowed choices, explicit target ids, reviewed immutable packets and readback remain authoritative; no new identity, direct browser backend access or model source-authoring authority."
---

# 2026-10-23 Console planning handoff

## Summary

Repair the existing Console Work Design and Refinement handoff exposed during
the real public synthetic to-do journey, without new ART repair children or
replacement workflow mechanisms.

## Classification

- area: shared operator planning workflow
- type: maintenance of existing composition and canonical metadata projection
- runtime impact: requires reviewed complete-runtime activation

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: existing Epic #1275 acceptance #1298 maintenance
- related products or components: Console, CGG, Workspace Delivery ART

## Root Cause

- immediate failure: actual Console Work Design assist returned 503 because its CGG upstream was not configured in the complete composition
- actual root cause: the registered complete composition omitted the existing dedicated Work Design binding; both native profile guards admitted it only in the standalone advice composition. Refinement also omitted canonical contract fields and treated real text fields as unavailable-choice selects.
- why it escaped earlier controls: general runtime health and injected packet fixtures did not exercise the native producer, both consumers and actual current OpenProject forms together

## Source Changes

- changed workflow, adapter, or contract: accept the existing dedicated binding in both registered compositions; project current per-target forms, values, field kinds and allowed choices; scope typed fields and accepted effects to explicit ids; preserve source narratives and bind capabilities into packet revision
- tests or validator added: full-composition positive/negative shell checks; native OpenProject reader-to-packet form contract test; typed apply/readback replay and reversed-id missing-field regression tests
- follow-on native gate correction: the first cross-owner proof stopped at parser/editor projection. The actual Console Apply decision remained false for reviewed metadata because the open metadata-review gate omitted its existing Delivery metadata route. Bind that gate to the existing bulk-update route; verify unresolved denial, accepted draft resolution and blocked/stale denial through the actual Console decision, without CLI metadata pre-writes or a new mechanism.
- related change records: None

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source pending full CI-equivalent and provider checks; operating proof remains pending the coordinated activation and same Console request
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused native reader, packet, source and activity tests pass; full committed-head validation is recorded with the Landing Unit evidence before publication
- live or dev-integration verification: read-only actual form inspection of Epic #1306 and all seven create types confirmed String Target PI/Iteration, Formattable contract text, CustomOption classification/objective type and writable User roles; zero business mutations
- residual risk: source validation is not actual journey acceptance. No private/client, hostile multi-tenant, production deployment or crash-cure claim.

## Follow-Up

- required follow-up: land coherent WG/OOS/CGG/Console source, exact Security acceptance, then normal whole-runtime activation and actual Console Work Design/Refinement readback before app delivery
- owner: existing #1298 operator journey maintenance
- due date or closure condition: actual same-record Console proof and existing #1275 acceptance closeout
