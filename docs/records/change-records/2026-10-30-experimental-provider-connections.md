---
security_evidence:
  review_areas: [runtime, delivery, secrets, ai]
  reviewed_artifacts:
    - src/model-operations/connections.js
    - src/model-operations/platform-client.js
    - src/model-operations/contracts.js
    - src/app.js
    - docs/api/openapi.json
  findings: []
  risks: []
  workstreams: [WS-003, WS-005]
---

# Experimental native provider connection workflow

## Summary

ART1370 extends the existing Model Operations API with named Experimental
Claude, DeepSeek and GLM/Z.AI Standard API connections. Platform owns durable
connection state and credential custody; OOS authenticates intent and validates
owner evidence. No provider credential is placed in the generic request journal.

## Classification

Source-only existing-workflow extension under Epic1363 and its admitted
architecture-packet:delivery-1363-v1. Landing Unit Decision:
child_isolated_landing_unit, delivery-1363-workflows, because OOS has its own
workflow review/rollback boundary after the Platform contract.

## Ownership

OOS owns bounded APIs, caller/operator binding, audit and receipt verification.
Platform owns presets, invocation, custody, CAS fencing, health and registration.
Console owns the operator controls. Security1371 accepts exact composed sources
before Platform1381 commissions them. Existing purpose permissions remain intact.

## Root Cause

The existing workflow implements Ollama/Codex registration and routing but has
no protected transient API-key ingress or named API connection lifecycle. This
is the approved capability extension, not a newly invented defect.

## Source Changes

Reuse existing authentication, the Model Operations service and owner client.
Add closed connection/credential commands, retained original-operation reads
and explicit reconciliation, separate from the existing durable model request
queue. Bind receipts to safe command digests and current operator; reject extra
secret/native fields. Keys are transient, never persisted, audited or retried by
OOS. Disable redirects on management/credential transport. Accept truthful null
cloud runtime metadata and preserve mandatory Experimental qualification.
Extend native API documentation and controlled positive/negative tests.

## Artifact And Deployment Evidence

Source-only. No runtime, identity, routing, registration or account mutation.
The existing composed gate:ai-routing-composed-security remains authoritative.
The final Review Packet binds the actual merged PR; exact-source Security
acceptance and the existing complete-runtime lifecycle precede activation.

## Live Verification

Controlled tests cover authorization, no secret journaling/audit, owner receipt
tampering, lost acknowledgement across OOS restart, original-operation readback,
HTTP routes and redirect denial, null metadata and independent Experimental
maturity. CI-equivalent committed validation precedes merge. The operator has
no eligible provider accounts: real-account qualification is explicitly pending.

## Follow-Up

Console1369 consumes these same APIs; Security1371 reviews the exact owner heads;
Platform1381 commissions and checks the real Console plus existing-provider
regression. No controlled API fixture is installed in the active user registry.
Rollback uses the prior reviewed composition and preserves owner state. Finish
source-resource retirement and scoped cleanup before reporting completion.
