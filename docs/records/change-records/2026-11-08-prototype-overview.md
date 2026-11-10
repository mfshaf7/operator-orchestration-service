---
security_evidence:
  review_areas: [runtime, delivery]
  reviewed_artifacts:
    - src/app.js
    - src/prototype-landing/overview.js
    - src/prototype-landing/records-client.js
    - src/prototype-landing/service.js
    - src/prototype-landing/store.js
    - src/prototype-maturity/service.js
    - src/prototype-maturity/store.js
    - src/prototype-workflow-register.js
    - scripts/sync_prototype_landing_openapi.mjs
  findings: []
  risks: []
  workstreams: [WS-007]
---

# Compact Prototype overview

## Summary

The register is paged but its independent summary still read every owner record
and retained document. Unrelated evidence growth could therefore exhaust the
legacy whole-collection document/byte limit even while individual pages worked.
The existing read API gains a compact whole-workspace count projection.

## Classification

Operator-approved owner maintenance outside active ART. Landing Unit Decision:
child_isolated_landing_unit, prototype-overview-oos-20261108. OOS deploys and
rolls back separately from the dependent Console presentation landing unit.
This is a read-only extension, with no new infrastructure or mutation authority.

## Ownership

OOS owns authentication, projection and caller-scoped workflow progress. Studio
owns committed source and lifecycle. Platform refreshes the trusted source ref;
Security and Platform retain exact-source acceptance and activation authority.

## Root Cause

The register and summary used different read shapes. Register paging bounded
selected evidence, while summary reused the legacy full snapshot and its total
document budget. The summary needs a complete aggregate, not all evidence.

## Source Changes

GET `/v1/prototypes?view=overview` validates the immutable registry and capture
bindings at one admitted revision. Its revision cache contains index facts only;
individual capture validation remains bounded, and retained source/evidence
blobs are not loaded for counts. Duplicate capture/registry identities count
once. The explicit index budget is ten thousand entries and the existing index
byte bound remains; these are limits, not a claim of arbitrary scale.

Landing and Maturity stores each read one integrity-checked snapshot and project
only the latest caller-owned metadata. Service binding validation precedes the
compact metadata projection. Full prompts, requests, source, provider details,
receipts and history are excluded from the response. Caller filtering happens
before latest selection. No summary path can authorize a source operation.

Lifecycle totals come from current Studio source. Blocked counts require an
explicit latest Maturity blocker for the current lifecycle phase; historical
blocked work cannot turn a graduated record into a current blocker. Movement
counts require an accepted source-backed baseline and Landing, not only a
baseline label. Missing coordinators, invalid records and failed reads make the
summary unavailable, never a partial successful count.

The existing paged register and exact original APIs, mutation routes, identity,
OpenProject form contracts, approvals and delivery semantics are unchanged.

## Artifact And Deployment Evidence

Source and isolated test evidence only during operator preview. Focused tests
cover an index exceeding the old document limit, no unrelated evidence reads,
caller isolation, terminal/phase blockers, complete counts, bounded output,
missing dependencies, native HTTP authentication and forbidden query parameters.
The generated API contract is synchronized from its source generator.

## Live Verification

Current production-like dev-integration retains its prior accepted backend.
Native post-activation compact-read qualification remains pending. No persistent
workflow mutations or test projects are part of this read qualification.
Underlying workflow stores still use their existing local journal snapshots;
this change avoids repeated per-page journal loads and large summary payloads,
but does not claim a database-storage redesign or unlimited installation scale.

## Follow-Up

The primary procedure is [Console register queries](../../operations/console-register-queries.md).
After operator review, complete fetched-base validation, Gary publication,
Security index/delta and exact composed acceptance, then normal Platform
activation and native readback. Backend source precedes its Console consumer;
rollback uses the previous accepted composition with no data migration.
