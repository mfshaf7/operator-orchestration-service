# Delivery Work Design Contract V1

## Status

The OOS assist and apply runtime from ART `#993` and the dev-integration profile
activation from ART `#995` are complete. ART `#997` adds the authenticated
current-state projection and restart-safe apply receipt custody required before
the Console adapter can replace fixture authority. Stage and production remain
out of scope.

The machine-readable source is
[`contracts/work-design/manifest.json`](../../contracts/work-design/manifest.json)
and its adjacent JSON Schemas.

## Purpose

The approved preview repair adds a schema-constrained provider `draft_reply`.
It is validated against the selected field types before OOS emits the existing
client text envelope. Legacy format strings in admitted draft data cannot
override the native provider schema. The public Work Design source, CGG, profile,
caller and explicit canonical Apply contracts remain unchanged. Exact paired
source qualification is required before claiming this repair live.

Provide one provider-neutral protocol for two Work Design assist tasks:

- `context_advice`
- `tree_advice`

`context_advice` explains the architecture of the system being designed:
current evidence, intended changes, responsibilities, interactions and relevant
boundaries, plus explicit unknowns. Work records constrain the scope; they are
not automatically system components. A runtime interaction sequence is valid
architectural context, while an implementation task list alone is insufficient.
Non-runtime work may describe rules and information handoffs without services.
The advisor cannot claim repository/runtime inspection beyond admitted evidence.

`tree_advice` uses the accepted context to propose the ART work breakdown. The
two tasks retain their existing schemas, profile and authority. Context has no
mandatory diagram notation, component count or semantic keyword gate. Questions
remain answer-only; edits require the existing explicit draft request.

The same contract separately defines operator-approved application of an
accepted Work Design draft to canonical Delivery through OOS. A read-only
projection returns the current source revision and durable application history
without allowing the Console to read OpenProject directly.

## Authority Boundary

| Concern | Authority |
| --- | --- |
| Work Design workflow, task instructions, response validation, acceptance, and apply | `operator-orchestration-service` |
| Context admission, redaction, budgeting, and model-safe projection | `context-governance-gateway` |
| Logical profile, provider route, credentials, egress, and activation | `platform-engineering` |
| Trust review and activation decision | `security-architecture` |
| Operator interaction and backend-derived projection | `governance-operations-console` |
| Canonical ART records | OpenProject through the OOS adapter |

No Console, model, CGG, or gateway output can mutate canonical Delivery.

## Runtime Operations

The OOS API and OpenAPI contract now expose:

- `GET /v1/delivery-work-design/{package_id}/projection?source_ref=...`
- `POST /v1/delivery-work-design/{package_id}/assist`
- `POST /v1/delivery-work-design/{package_id}/apply`

The projection requires normal caller authentication but no mutation authority.
Apply additionally requires the existing Delivery mutation authority.

## Assist Sequence

1. The Console sends a typed task, operator prompt, source revision, and current
   context or tree draft to OOS.
2. OOS verifies source and operator identity, then admits the complete task
   context through CGG.
3. CGG returns only a receipt-bound model-safe packet projection.
4. OOS invokes `delivery-work-design-advisor-v1` through the governed AI
   gateway using the versioned task contract and required output schema.
5. OOS validates the complete response before returning typed advice and
   evidence references to the Console.
6. The operator may accept, ignore, or edit the advice. Advice never starts
   apply.

The assist result preserves the existing Console concepts: confidence,
required operator action, prose guidance, affected node, and bounded patch
summary. `mocked` is not a valid live response status.

The staged reasoning repair keeps these two tasks on the same profile and
permission boundary. Context instructions explain actual card rendering and
CSS-pixel geometry supplied by the editor, distinguish the scrollable canvas
from the sampled visible area, and preserve substantive architecture across
named views. Build Tree uses the entire supplied accepted brief to decompose
outcomes, preserving existing branch identities and relevant boundary work.
Neither guide demands a fixed diagram format or number of work items.

All human-facing advisor drafts follow shared readability guidance. The
destination field's contract takes precedence, including required scaffold
headings and ordering for Work Items. When the operator asks for a longer
Context note draft, the advisor can use `#` for the title and `##` for useful
section headings, with blank lines between paragraphs. Short notes and existing
plain-text notes remain valid. Finalized briefs retain the recorded note text.

An optional `draft_scope` carries the actual local note/diagram/tree fields,
bounded conversation and advice-text format. Its role, package, source and
revision must match the ordinary request. It enters the canonical context
digest and CGG content before model invocation; it never bypasses admission by
being concatenated to the operator prompt. The optional scope is represented as
exact JSON text inside that canonical advice context and request binding. This
preserves ordinary canvas numbers, including fractional coordinates and sketch
geometry, without applying or relaxing ART's integer-only artifact restriction.
The existing Work Design profile
and task remain authoritative. The Console may validate the returned advice
text as an inert local draft proposal and edit only explicitly requested local
fields. Questions and ambiguous requests do not edit. This does not start apply,
approve a context brief, commit a PI, create ART records or grant tool authority.

Work Design scope context is bounded at 64,000 characters and the selected
scope at 128,000 characters; CGG admits up to 32,000 budget tokens, still within
its existing input-byte bound. This is not a guarantee that every maximum-sized
field combination fits. Oversized complete input is rejected; editable content
is never silently shortened. An identical legacy note or tree is referenced
from the exact scoped field rather than sent twice. Nonidentical legacy data
remains supplied. Request identity and source binding retain the original input.

CGG projection has a 30-second deadline. The Work Design gateway JSON exchange
has a 630-second whole-response deadline around the Platform's 600-second
provider allowance. Native Node HTTP transport avoids the independent five-minute
response-header cutoff of the ordinary fetch transport. This does not extend
other workflows or canonical Apply. Client disconnect propagates a signal to
the current projection/gateway wait. Stopping that wait is not proof that a
provider turn stopped; no automatic second invocation follows a lost response.
These source changes require paired exact-source activation before live proof.

## Apply Sequence

1. The Console sends the exact accepted draft id, digest, tree, source revision,
   idempotency key, and operator acceptance record to OOS.
2. OOS rejects stale source, mismatched acceptance identity, conflicting replay,
   or invalid tree structure.
3. OOS reconstructs prior application state from authenticated OpenProject
   activities and rejects conflicting replay.
4. OOS records a deterministic `apply-intent` activity before calling the
   canonical Delivery `plan/apply` adapter.
5. OOS reads back the backend result, records an `apply-completed` activity,
   and returns created, updated, and reused record references plus that durable
   activity receipt.
6. A retry after restart returns the completed receipt without another
   mutation. If only an intent exists, OOS reruns the canonical reconciler and
   completes receipt custody from backend truth.

Advisor evidence is optional on apply. An operator can complete Work Design
without model assistance, and model evidence never substitutes for acceptance.

## Failure Contract

Failures use the bounded codes in
[`error.schema.json`](../../contracts/work-design/error.schema.json). The
response records correlation plus available audit or receipt references and
does not expose provider secrets, raw context, or unvalidated provider output.

Configured live mode fails closed. It must not silently return fixture advice
when CGG, profile, gateway, provider, schema, operator, or backend checks fail.

`ai_provider_busy` (429) means all selected attempts were refused before
submission because the account was occupied. `ai_context_capacity_exceeded`
(413) means a configured model could not fit the supplied complete input.
`ai_completion_unknown` (503, not retryable) retains the original unconfirmed
invocation and available gateway audit reference. It takes precedence over
other attempt outcomes. None of these is evidence of an offline account.
Uncertain completion must not trigger an automatic retry or fallback.

## Storage And Audit

This contract adds no database. Canonical work and versioned Work Design apply
events remain in OpenProject. Context artifacts and redaction receipts remain in
CGG, provider audit remains behind the governed AI gateway, and the Console
remains a projection.

Only activity comments authored by the authenticated OOS OpenProject identity
and matching the strict versioned event marker become receipt truth. Ordinary
comments and foreign-user comments are ignored. Malformed or conflicting
trusted events fail closed. The bounded projection returns at most the newest
100 completed applications while the adapter keeps a bounded history scan.

Every assist binds:

- caller and operator identity
- Delivery and package identity
- source revision
- request and correlation identity
- task contract and logical profile
- CGG packet and redaction receipt
- output schema and gateway audit reference

Every apply additionally binds the accepted draft digest, idempotency key,
backend readback, and final receipt.

OOS uses in-process serialization only as an optimization for simultaneous
requests. Durable event history and canonical backend reconciliation remain the
authority after restart. Application and event identities derive from the
accepted request rather than provider output.

## Activation And Rollback

`delivery-work-design-advisor-v1` is active only in the admitted
`work-design-advice` dev-integration composition. Platform supplies the CGG and
governed AI gateway endpoints plus one composition-lifetime CGG caller binding;
OOS rejects partial or foreign projection and keeps standalone Work Design fail
closed. The Console continues to use the same-origin OOS routes and receives no
CGG, gateway, provider, or cluster credential.

Rollback removes the OOS composition projections and caller binding, then
suspends only the Work Design profile. It must not disable
`intake-classifier-v1`, remove historical audit or receipts, alter unrelated ART
workflows, or broaden direct provider access.


### Structured advisor reply transport

Native provider replies carry human explanation and typed edits separately. After
native validation, the existing HTTP compatibility `text` field may encode the
complete reply up to 128,000 characters. It must not inherit the 12,000-character
human-message limit. The shared Agent Console compatibility response uses the
same transport bound. Native message, field, operation and scope validation still
apply before encoding; an oversized transaction fails without partial edits.
The Console applies the same aggregate reply limit and retains its atomic local
transaction and unchanged-context checks. This is draft assistance, not canonical
Apply or implementation completion. Completed provider records are retained and
must not be regenerated merely because a downstream consumer rejected encoding.
