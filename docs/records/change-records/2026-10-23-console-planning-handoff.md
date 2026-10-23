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
    - src/app.js
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

### Native first work-session read maintenance

Read-only next-step preflight for Story1308 returned a valid native
decision-required projection with null session revision, while its negotiated
canonical envelope failed502. The HTTP descriptor referenced nonexistent
updated_at unless source authorization existed. Status now uses the existing
full-observation digest and read time; domain session_revision stays unchanged
for commands. No session, source authorization or CLI business write is created
to make first entry work. Absent, ordinary and source-authorized status reads,
repeat observations and unchanged command concurrency are exercised through
the actual producer and Console consumer. This is existing1298 maintenance,
classified extend of the existing status boundary, child_isolated_landing_unit
maintenance-1275-unstarted-work-session-read; one owner/rollback boundary, no
ART child or architecture change. Revert this source change for rollback.

### Aggregate planning projection ordering maintenance

Actual retained Refinement completed with canonical receipt, but repeated native
reads used unchanged input version-5/sequence5 while `projected_at` changed.
Consumer integrity correctly rejected conflicting snapshots at one sequence.
Work Design has the same composite-response/input-version mismatch. Both packet
handlers now reuse the existing full-snapshot digest and projection timestamp;
domain input versions and mutation concurrency remain unchanged. Existing native
run package coordinates, authorization, receipt custody and replay guards are
not weakened. Tests cover repeated aggregate observations, default JSON
compatibility and actual producer-to-Console consumption before publication.

### Native planning-write fidelity maintenance

The actual reviewed Console PI Objective create was rejected before mutation
because the input omitted Target PI. Native creation also requires compatible
Iteration. The coordinated follow-up adds these inputs in the Console without
marking work Ready or changing native rules. Refinement now routes work-item
Target PI and Iteration through existing coordinated `plan/apply`, not generic
Feature update, and preserves native parent/type/subject reconciliation with
current classification before later explicit-id metadata changes. It rejects
changed or ambiguous scope and unexpected creations. Final readback verifies
all effectful accepted values rather than certifying returned references alone.

Validation includes all seven real native create types, missing/mismatched PI
inputs, generic Feature/inherited-parent constraints, actual Delivery service
and OpenProject plan writer with existing records and roadmap projection,
zero-creation replay, classification ordering, stale scope and missing/ignored
readback. These source checks do not replace the pending same-record Console
retry after exact source acceptance and normal activation. No new ART repair
item, permission, API, profile, ledger or execution-authority grant is added.

- required follow-up: land coherent WG/OOS/CGG/Console source, exact Security acceptance, then normal whole-runtime activation and actual Console Work Design/Refinement readback before app delivery
- owner: existing #1298 operator journey maintenance
- due date or closure condition: actual same-record Console proof and existing #1275 acceptance closeout
