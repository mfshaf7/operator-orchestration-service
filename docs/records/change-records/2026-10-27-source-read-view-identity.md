---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/app.js
    - src/console-source-authority.js
    - docs/contracts/console-source-authority.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Existing authenticated readback identity repair. Preserve canonical record revisions, caller authority and consumer conflict detection. Exact composed Security reacceptance precedes runtime activation; generated owner-record index follows the merged owner source.
---

# Bind canonical Console read views without changing record versions

## Summary

Give query-selected representations distinct stable source references. Native
Proposal combined/plain/combined reads returned different payload shapes with
the same binding, version-2 and event sequence2. The Console correctly rejected
the command preflight, blocking the original accepted Proposal's handoff.

## Classification

- area: existing authenticated Console readback
- type: approved owner maintenance of a proven read-performance regression
- runtime impact: negotiated read-view identity only; ordinary JSON unchanged

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; the new Proposal has no Delivery target yet
- related components: Governance Operations Console and existing source owners

## Root Cause

- immediate failure: `source_authority_conflict` before Proposal Handoff command submission
- actual root cause: snapshot negotiation changed the representation while the shared producer derived source identity from the pathname alone; both views retained the canonical record version
- why it escaped earlier controls: separate JSON snapshot and trusted-envelope tests did not alternate the combined view and the plain command-preflight read in one consumer ordering context

## Source Changes

Use only owner-selected normalized representation selectors in source identity.
Canonical selector digests keep maximum legal file selections within the
existing1024-character binding bound. Selector key order is irrelevant; ordered
file selections remain distinct. Normalize absent/false Proposal history and
first history page. Scope Delivery Intake pages/search and initiative-list filters/views, owner-bootstrap and
Prototype list limits, Custody pages, Delivery Intake selectors and both source-file selection routes.
Workspace Intake/Inventory already scope list record references. Ordinary JSON
lists outside negotiated readback are unchanged.

The original proposal, command identity, canonical revision, mutation guards,
credential boundaries, consumer conflict checks and media version remain intact.
No cache reset, counter, fallback, permission or workflow mechanism is added.

- tests: native-shaped combined/plain/combined read sequence, unchanged repeat read, equivalent defaults, history pages, list windows, both ordered file-selection routes, unknown-query identity exclusion and maximum selection bound
- related record: `2026-10-26-console-read-performance.md`

## Artifact And Deployment Evidence

- source/build evidence: exact Gary head, fetched-base local validation and hosted checks retained with the owner PR
- image tag or digest: None at source preparation
- runtime revision: unchanged until exact acceptance and normal activation

## Live Verification

- local validation: focused98tests and the unchanged real Console decoder passed; full CI-equivalent validation required before source publication
- live or dev-integration verification: pre-repair native source triplet proves the conflicting binding at one record revision; original same-command Handoff must succeed after commissioning
- residual risk: source landing alone does not prove the operating path

## Follow-Up

- required follow-up: merge owner source, update composed Security exact-source acceptance and generated index, activate through the existing Platform path, verify original native Handoff, retire exact credentials/worktrees/branches
- owner: OOS source; Security acceptance; Platform runtime
- closure condition: original Proposal advances without duplicate targets, consumer integrity remains enforced, and owner cleanup completes
