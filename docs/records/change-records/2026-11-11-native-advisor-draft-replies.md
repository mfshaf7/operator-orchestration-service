---
security_evidence:
  review_areas: [ai, identity, delivery, runtime]
  findings: []
  risks: []
  workstreams: [WS-007]
  reviewed_artifacts:
    - src/catalog/membership-service.js
    - src/catalog/http-client.js
    - test/catalog-membership-service.test.js
    - docs/operations/delivery-project-members.md
    - src/advisor-draft-reply.js
    - src/advisor-work-instructions.js
    - src/work-design/service.js
    - src/agent-console/service.js
    - src/orchestration/catalog.js
    - src/refinement/service.js
    - src/source-authoring/editor-assistant.js
    - src/source-authoring/prototype-context.js
    - src/saved-work/store.js
    - src/app.js
    - contracts/delivery-art-work-session/source-editor-assistant-request.schema.json
    - contracts/refinement/assist-request.schema.json
    - test/saved-work-http.test.js
    - test/saved-work.test.js
    - test/source-editor-assistant.test.js
    - contracts/work-design/advisor-draft-reply.schema.json
    - test/advisor-draft-reply.test.js
    - test/work-design-service.test.js
  notes: "Approved local preview batch. Native provider structure is decoded into the existing inert client envelope; source validation is separate from fresh composed Security acceptance and operating proof."
---

# 2026-11-11 Native advisor draft replies

## Summary

The Context diagram advisor returned JSON Patch, omitted intent, or returned
prose inside a schema-free text field. The Console correctly preserved the draft
but the backend could still mark such output ready. Extend the existing provider
contract with a schema-constrained native reply and validate it before success.

## Classification

### Approved membership workflow repair

The operator approved closing the remaining Console project-membership gap in
this maintenance batch. Extend the existing OOS/OpenProject path for existing
users/groups and project roles, with explicit review, exact project binding,
protected operator/service access, canonical readback and durable replay. Keep
global account creation and identity-provider configuration outside this scope.
The existing owner Landing Unit/branch and dev-integration profile remain;
paired Platform and Console changes preserve their separate owner boundaries.
No ART or improvement candidate is introduced. Native writable form/schema
proof is a prerequisite; denied permissions are not replaced with guessed data.
The source delta review is
[Console project membership](https://github.com/mfshaf7/security-architecture/blob/main/docs/reviews/components/2026-11-17-console-project-membership.md).

- area: existing bounded Work Design and shared form/tree advice
- type: operator-approved workflow maintenance in the new Context Brief preview batch
- runtime impact: paired CGG/Platform/OOS/Console source and normal exact-source activation after review
- Landing Unit Decision: `feature_single_landing_unit`, `maintenance-advisor-draft-protocol-20261111`

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: none; the separate shared-project-runtime initiative remains paused
- related products or components: Console, CGG context admission, Platform governed AI and Security

The operator explicitly included the same repair for all affected advisors in
this batch after the cross-surface inspection. The shared Agent Console path
covers Proposal triage/disposition, Prototype Candidate/Baseline drafting,
Execution selected-node text, Work Design/Refinement blocker justifications and
Orchestration Definition drafting. Work Design retains its dedicated assist
route. Existing native Refinement metadata and source-editor protocols remain
independent.

The operator additionally approved closing workflow-knowledge/context gaps in
this batch. Trusted OOS role guides now describe the actual workflow job,
business rules and evidence limits. Maturity requirements come from the existing
canonical YAML; Orchestration examples come from its registered source catalog,
with runtime admission explicitly separate. Console supplies current workflow
checks rather than treating field names or reference strings as loaded knowledge.
Refinement and the source editor receive their work guide on existing routes.

Selected generic draft requests reject a CGG-trimmed packet before model dispatch.
Prototype source projection preserves its budget metadata so the shared source
editor can reject incomplete selected buffers; missing completeness metadata is
also denied. Paired CGG Work Design/Refinement guards use existing denial codes.
Normal bounded overview chat remains available. No hidden source-file reads,
new provider tools, final-decision authority or automatic inference retry is added.

## Approved context-continuity checkpoints

The operator approved the concrete context map and repair plan on 2026-11-11
with "lets begin then?". Extend this same uncommitted maintenance batch and
existing Landing Units; no new ART item or shared service is introduced.
Checkpoint one supplies recorded upstream decisions, current canonical target
narratives and product workflow orientation. Later checkpoints address consistent
conversation and private recovery, then read-only supporting context/detail
selection. Each retains preview review before publication. Model permissions,
provider tools, explicit final acceptance and the paused runtime initiative stay
separate. Final composed Security review must include conversation retention and
authorized context reads when those later checkpoints are implemented.

Checkpoint two now has source implementation and focused/browser proof: optional
complete conversation travels through ordinary and custom Refinement routes;
the existing private saved-input store accepts a tightly bound conversation kind.
Own input saves retain caller/operator authentication while requiring no Delivery
mutation privilege. Conversations remain working data, never attested AI proof.
Unsent input, unknown outcomes, explicit recovery/conflict choices and omissions
are visible; restoration performs no inference. Fresh-browser, unavailable-read,
unsent input and project separation browser cases are isolated conformance proof.

Checkpoint three is implemented in unpublished source. Source editor requests
distinguish selected read-only supporting files and backend/client/local-apply
validation rejects unauthorized edits without widening project/path access.
Console selection reuses bounded, authenticated Proposal/Prototype/Delivery owner
reads. Only a closed item kind/ID comes from the browser, no arbitrary URLs or
browser-supplied project facts. OOS receives current source/revision/coverage in
the digest-bound CGG packet and refuses incomplete selected detail before model
dispatch. Additional architecture views are explicitly included read-only;
editing remains limited to the active diagram. No global scan, model tool or
cross-agent transcript store is introduced.

Isolated source-editor UI proof covers both owners, selected supporting files,
readonly overwrite refusal, apply/undo, original interrupted-request restoration
without inference, explicit exact retry and compact/large viewport layout.
Conversation/navigation qualification retains an in-flight request's origin,
preserves local diagnostics during hydration and waits for history before an
already explicit open-and-run intent. Pending source acceptance, publication,
runtime activation and real-provider judgment remain separate from those tests.

## Root Cause

- immediate failure: invalid local diagram proposals rejected by the real Console transaction guard
- actual root cause: provider schema validated an outer text wrapper, leaving the nested edit grammar to prompting and late UI parsing
- why it escaped earlier controls: passing wrapper/schema and short successful drafts did not exercise malformed native edit replies

## Source Changes

The native reply declares intent, message and typed text/board/tree payloads.
Questions and clarification cannot carry edits. A requested draft requires its
admitted field and type; readonly, unknown/duplicate fields, oversized values and
unsupported board kinds fail without mutation. Nullable unused properties are
removed deterministically. Tree additions require an explicit parent in the
existing draft; its Epic root cannot be inserted or removed by the advisor.
Existing scoped fractional geometry remains JSON data, not integer-only ART state.

The backend serializes the validated reply into existing client text envelopes.
Old normal-chat outputs remain compatible; draft requests cannot fall back to
unstructured text. The generic path reuses its existing admitted `operator_draft`
candidate. Work Design retains its profile, caller, task, source/session binding,
CGG projection and explicit final acceptance. Refinement's existing structured
field response needs no protocol change. No model, privilege or canonical action
is introduced.

## Artifact And Deployment Evidence

Uncommitted preview source. No image, live revision or deployment evidence yet.
Land CGG completeness and Platform contract before dependent OOS/Console source, then refresh Security
source acceptance and use normal complete-runtime activation. Existing private
saved-work transactions already retain the complete multi-diagram document;
no new draft store or database is added.

## Live Verification

- local validation: the full broker suite passes 1,991 tests with two documented skips, including private conversation custody, role-guide delivery, canonical maturity/catalog facts, native-output compatibility, malformed-response rejection and incomplete selected conversation/project-context denial before inference
- paired context proof: all 104 CGG tests pass; selected Work Design/Refinement projections reject budget truncation and bind upstream narrative/conversation while ordinary bounded overview compatibility remains. Console focused context tests and isolated browser cases verify actual proposal observations, promotion evidence assessments, Orchestration readiness/examples, exact selected-project reads and read-only supporting context, with no canonical owner writes
- shared-role cases: requested drafts retain their selected fields, questions carry no edits, identical successful and failed requests replay without another inference, and malformed output releases the reservation for a later intentional request; upstreams are isolated test doubles, not live-provider qualification
- paired source proof: both actual Platform provider schemas, OOS normalization and Console board/tree consumers pass an isolated integration exercise; this is not live provider proof
- live or dev-integration verification: pending exact paired-source qualification; existing live runtime remains unchanged
- residual risk: provider latency/unknown completion is separate from reply grammar; no retry or implicit model fallback is added

## Follow-Up

- required follow-up: operator preview review, full source validation, fresh Security delta, exact operating proof and normal source cleanup
- owner: existing Console/CGG/OOS/Platform/Security owners
- closure condition: reviewed batch published and qualified, with retained original data and all explicit authority boundaries intact

## Additional approved Catalog maintenance in the same preview batch

The operator approved all confirmed Catalog inspection findings on 2026-11-17.
This extends the existing owner Landing Unit and coordinated preview batch;
no new ART item, shared service, request ledger, policy authority or automatic
publication is introduced. Console changes preserve the reviewed Catalog
revision, pin readiness and accepted retry bodies, keep canonical applied
receipts despite failed list reads, and correct scoped Execution navigation,
planning eligibility, forms and shared browsing controls. The readiness adapter
reuses the existing authenticated OOS operation with server-only credentials.

OOS extends existing canonical-backend receipt replay. Fresh decisions retain
source/capability/readiness checks. An old revision can recover only an exact
replayed canonical request result; an unseen stale request must still be denied
by the canonical backend before mutation. Tests cover recovered original
receipts, stale rejection and identity mismatch, alongside existing readonly,
in-use retirement, readback and authority denials. This is source proof, not a
new broad write permission or live operating acceptance. Coordinated source,
Security review and native commissioning remain pending batch publication.

The separate live cluster incident was index corruption in the existing k3s
SQLite database. A restricted copy was reindexed and full row fingerprints
matched, including sequence state. No cluster-data reset or older snapshot
restore was used. Platform's host recovery runbook records restart containment
and exact database-handle checks. Live recovery does not activate this pending
Catalog source. Browser scenarios use synthetic responses and no canonical
Catalog writes; publication must retain that distinction.
