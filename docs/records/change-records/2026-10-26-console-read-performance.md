---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/app.js
    - src/openproject-client.js
    - src/delivery-service.js
    - src/delivery-history-reader.js
    - src/proposal-workflow/service.js
    - src/prototype-landing/records-client.js
    - src/prototype-landing/source-client.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: Approved maintenance of existing authenticated read paths. Preserve global scope, exact command authority, original owner evidence and trusted-ref/admission checks. Immutable parsed Git content is cached by exact revision; mutable workflow journals and authority checks are never cached. Exact composed Security acceptance precedes runtime commissioning.
---

# Preserve Console capabilities while reducing repeated owner reads

## Summary

Separate the complete global Delivery register and operational trees from
independently paged original Intake evidence. Coalesce Proposal projection and
first-page history into one fresh owner snapshot. Reuse only immutable parsed
Prototype Git content, with authority rechecked on every request.

## Classification

- area: existing authenticated Console owner reads
- type: approved owner maintenance; existing read-instability learning candidate
- runtime impact: optional GET representations and bounded target pages; no business writes

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; completed initiatives remain closed
- related components: Governance Operations Console and existing owner services

## Root Cause

- immediate failure: the Console waited for whole-ART execution graphs and original evidence before displaying any package inventory.
- actual root cause: archive size amplified routine global polling, and each Proposal required duplicate record/activity scans for projection and history. Prototype polls reparsed identical immutable Git records.
- why it escaped earlier controls: the earlier proof verified retained evidence and successful commands without a whole-screen latency and growing-history capability comparison. A selected-only UI draft was rejected before publication because it could narrow global work visibility.

## Source Changes

The optional console view preserves all root packages, backend statuses,
lineage, PI facts and complete active/parked execution summaries. Terminal
child graphs are explicitly deferred. Operational roots share a scoped
dependency graph; default inventory and exact workflow authorization remain
unchanged. Intake native pages include inspected root identities, including
roots without ingress; a complete admission total requires complete verified
coverage. Original trusted activity, reciprocal source, custody and receipt
checks remain with their owners. OpenProject form schema calls are read-only;
no writable field, allowedValues, mutation or approval contract is changed.

Proposal snapshot preserves original first-page history and projection from
one fresh record/event scan. Its documented one-based page offset is honored
by next/previous continuations and status/closeout scans; advancing by record
count had skipped native pages. The Console retains all bounded global pages
and rejects changed totals or repeated identities instead of silently hiding
records after the newest25. This corrects a native42-record witness.

Prototype warm reads cache one exact Git revision after the same validators
and source admission. Both trusted-ref checks still run every time; mutable
Landing, Maturity and Closure journals remain fresh. Cold Git reads use at
most four concurrent file operations with unchanged file/byte bounds.

- tests: global scope and operational-tree equality;2000 archived packages; original custody; duplicate/foreign/missing scope;142 Proposals with bounded concurrency; page-number continuation; immutable snapshot clone isolation, growth and authority loss.
- related record: `2026-10-26-delivery-owner-history.md`

## Artifact And Deployment Evidence

- source/build evidence: CI-equivalent owner validation and exact reviewed head are retained with the PR; acceptance follows the existing composed Security decision.
- image tag or digest: None at source preparation
- runtime revision: unchanged until existing Platform commissioning

## Live Verification

- local validation: focused capability/growth checks passed; full source and fetched-base checks are required before publication.
- native pre-commissioning profile: full inventory14749ms; corrected complete-root/operational-tree read7683ms; scoped summaries exactly equal the original owner summaries. These are owner-call timings, not final browser acceptance.
- residual risk: native backend latency and explicit read limits remain. Source landing is not operating proof; fresh cold/warm Console and original-product history checks are required.

## Follow-Up

- required follow-up: exact source review, composed Security acceptance, existing Platform commissioning and actual full Console performance/capability proof; close the existing learning candidate and retire source credentials/branches/worktrees.
- owner: OOS, Console, Security and Platform within existing authority boundaries
- closure condition: original evidence intact, global capabilities preserved, native reads verified and cleanup complete
