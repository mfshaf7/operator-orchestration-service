# Refinement Runtime

## Purpose

Use the Refinement runtime after Work Design has a trusted completed handoff.
It projects canonical metadata work, requests bounded field advice, and applies
one explicitly accepted immutable packet through a recoverable durable run.

The Governance Operations Console calls OOS only. Do not call CGG, the
governed AI gateway, Temporal, or OpenProject directly from the Console.

## Operator Sequence

1. Read the current packet with
   `GET /v1/delivery-refinement/{package_id}/projection?source_ref=...`.
2. Optionally request advice for one exact packet field with
   `POST /v1/delivery-refinement/{package_id}/assist`.
3. Questions and ambiguous requests return `required_operator_action=none` and
   `value=null`; they do not fill fields. Only explicit drafting returns a value
   for local editing. Keep that value suggestion-only. The operator accepts, edits, or
   ignores it in the Console draft.
4. Submit the complete accepted packet with
   `POST /v1/delivery-refinement/{package_id}/apply`.
5. Poll the returned `poll_ref` until the run is terminal.
6. Treat only `completed` plus a non-null canonical readback receipt as
   success.

Use the current projection again after a stale-packet or stale-draft response.
Reuse the original idempotency key when recovering the same accepted input.
Never generate a second key merely because the API or worker was interrupted.

## Canonical Metadata

The approved unpublished context-continuity repair extends field advice with
the current canonical selected-item and ancestor narratives. These may carry
the applied Work Design scope and architectural notes. OOS derives them from the
same validated packet; the browser cannot provide this owner context or substitute
another project's tree. Unrelated branches are excluded. A reference to a
separate finalized brief, diagram or proof does not load its contents.

The additional `work_context` travels through the existing CGG projection wrapper,
not in the operator prompt. The original assist-request digest stays separate;
the model-context digest and projection receipt bind the complete enriched input.
Changed narratives change projection identity. Old CGG callers without this
optional context remain compatible; the updated OOS consumer requires the paired
CGG source. Native field output, profile/effort and final acceptance are unchanged.

The packet reads each current target's OpenProject form and canonical values.
Done and retired descendants remain visible as history in the complete tree,
but are excluded from mutable metadata targets and form requests. An open child
under a closed ancestor still requires its current metadata. Historical work is
not reopened or assigned new PI/roles merely to refine current work.
Target PI and Iteration remain text fields when the current form declares
`String`; actual `CustomOption` fields expose only the current allowed choices.
Acceptance Criteria, Definition of Ready, Definition of Done, roles,
classification and typed PI Objective/Risk fields use the same reviewed packet,
not a second metadata editor. A field applies only to its explicit target ids.
Changing form capabilities or choices invalidates the packet revision as well
as changing the canonical tree. An unavailable empty required field stays
blocked; populated read-only values and unavailable optional fields do not
invite fake edits. The canonical writer and work-start guards remain decisive.

Work Design's tree schema does not create PI Objectives. Add the genuine
objective under its Epic through Delivery Execution's existing reviewed
`add_work_item` operation, preserving it when reconciling the Work Design tree.
Planning records the objective type and planned business value; it does not
invent future Actual Business Value or a completed PI review. Those optional
packet values remain empty until actual outcome review supplies them.

Creation of a new PI Objective requires Target PI and a compatible Iteration
in that reviewed `add_work_item` input. Do not submit a blank create and expect
Refinement to repair an item that the native writer correctly rejected.

Accepted Refinement writes run in order: initiative governance, coordinated
planning, then explicit-id work-item metadata. Target PI and Iteration use the
existing initiative `plan/apply` authority because generic Feature updates
cannot PI-commit a Feature. This reconciles only the reviewed existing tree
with `reconcileMissing: ignore`; native identity remains parent/type/subject.
Changed or ambiguous hierarchy requires a fresh review. The planning step
retains current classification, descriptions and status; accepted classification
changes apply afterward by explicit id, avoiding a new prefixed identity during
plan reconciliation. Refinement never marks items Ready automatically.

For a plan with current and future work, set PI and compatible Iteration only on
the reviewed committed scope. Future new backlog Features and their valid planned
children may keep blank PI and blank/backlog Iteration. Their planning fields are
optional in their explicit scope; committed/active and structurally required work
keeps required fields. Do not enter a fake PI to satisfy an unrelated branch.
Other metadata still follows the current packet and native authority.

When committing a previously uncommitted target, review PI and Iteration together.
Invalid pairs fail before a durable run starts. Blank optional planning inputs
retain their original values rather than clearing unreviewed state. If another
operation changes a retained planning value after acceptance, reload and review
the current packet; the run must not overwrite it or certify a false readback.

Replay reads accepted fields before repeating any mutation. Final readback
compares every effectful accepted field against its actual canonical target;
returned record references alone are insufficient. A missing target, ignored
value or unexpected plan-created reference is not a successful application.
Inspect partial effects and continue the same run; never delete an unexpected
record or fabricate a completed receipt to conceal the mismatch.

## Activation

Source ships inactive. All of these settings must be deliberately supplied by
the later Platform activation work:

- `CGG_REFINEMENT_BASE_URL`
- `CGG_REFINEMENT_CALLER_ID`
- `CGG_REFINEMENT_CALLER_SECRET`
- `GOVERNED_AI_GATEWAY_BASE_URL`
- `OOS_REFINEMENT_RUNTIME_ENABLED=true`
- `OOS_REFINEMENT_WORKER_ENABLED=true`
- `OOS_REFINEMENT_EXECUTION_AUTHORIZED=true`
- admitted `OOS_TEMPORAL_*` connection settings

Run the worker with `npm run refinement:worker`. The API process does not own
the workflow or activity pollers.

The complete `refinement-catalog` composition also supplies the existing Work
Design CGG endpoint, caller id and dedicated credential. Work Design does not
borrow the Refinement credential. A missing or mismatched dedicated binding
fails readiness; a standalone profile still leaves advice unavailable.

## Recovery And Evidence

Temporal owns active run state. OpenProject remains canonical for Delivery
records and stores the trusted OOS receipt event after readback. An identical
apply replay returns the existing run or receipt. A conflicting replay is
rejected.

Do not claim success from an accepted run, a completed activity call, or an AI
response. The terminal receipt must identify the accepted draft digest, source
Work Design receipt, canonical Delivery reference, changed references, and
post-apply source revision.

Configured failures never fall back to local fixture state. Suspend the
Refinement profile and worker independently if rollback is required; preserve
run and receipt history for review.

## Projection receipt verification

OOS verifies CGG's `request_digest` over the canonical projection envelope:
`{binding, refinement_context: assist_request}`. The separate
`binding.context_digest` must equal the canonical assist-request digest. These
values serve different bindings and must not be compared as the same digest.
Caller, operator, workflow/execution, packet/source revision, field selection,
task, request time, budget, redaction and suggestion-only authority checks all
remain required before model invocation. A mismatch fails closed; refresh the
original projection and investigate its owner receipt rather than applying advice.

## Paired maintenance: governed values and selected-field advice

The unpublished repair reuses the existing Delivery Catalog. Target PI and
Iteration, repository, team, assignee/responsible, initiative family, lineage
role and objective type use current choices. Native select permissions further
narrow these choices. String storage does not authorize arbitrary identifiers.
The derived uncommitted and retired roadmap buckets are never PI assignments.
Create missing values through Catalog, membership or repository onboarding;
Refinement advice cannot create them. A Catalog outage blocks affected fields
visibly and preserves unrelated narrative work. Each packet read obtains one
Catalog projection, not one request per field; changed applicable choices alter
the packet revision and invalidate stale advice or Apply input.

Single-item and shared advice bind a nonempty subset of the canonical field's
eligible targets. Source values are compared for that exact subset; mixed
shared values retain their per-item facts instead of using the first item.
The optional bounded `related_drafts` input identifies field/node pairs on the
selected items or their ancestors. OOS rejects foreign, duplicate, blocked or
generated targets and marks draft values as unaccepted operator input, separate
from canonical saved values. Related edits change the model-context identity;
late replies cannot overwrite a changed draft.

The canonical planning snapshots retain actual status, PI, Iteration and source
repository even when a counterpart is read-only. Current planning rules and
field constraints accompany selected/ancestor narratives through CGG; diagrams,
unrelated projects and unselected branches are not fetched. Planning suggestions
must match the effective saved/draft counterpart. An unavailable counterpart or
incompatible PI/Iteration returns clarification without inserting a value.
Current assignment is evidence, not permission to commit other backlog work.
Typed selectors, number/date/reference checks and the native writer remain
independent of model intelligence. Review dates use real ISO calendar dates;
Delivery reference existence/type/family checks remain native owner authority.
Sponsor and Risk Owner retain their descriptive business-responsibility meaning;
they do not grant account access. Narrative fields remain operator-authored text.

The Console keeps AI-filled fields visibly unreviewed until the operator records
review. Every final Apply still requires explicit operator acceptance. Existing
model routing is retained; a stronger model cannot substitute for missing facts.

Publication order: compatible CGG admission first, OOS producer/validation next,
then Console. The paired Security source review and later exact-source acceptance
must precede activation. Synthetic transport tests prove source wiring, not live
model quality or canonical mutation. Preserve the previous composition for rollback.


Each item retains the choices supplied by its native form. An unrelated sibling
cannot remove those choices from an individual edit. Shared edits use only choices
allowed for every selected item. Whole-number fields reject fractional or
partially parseable input before starting a run; decimal fields remain decimal.

A completed run belongs to its original Work Design handoff. Retained history
must not mark a later handoff completed. Pending/failed run status must also bind
that handoff; legacy runs without that fact remain historical evidence rather
than guessed current status. Submit the reviewed request to the owner for exact
request validation instead of treating any existing run as its acknowledgement.
The receipt digest remains authoritative; current packet values cannot reconstruct
an original accepted payload that the owner does not expose.


### Context digest interoperability

Refinement uses the existing CGG wire encoding (sorted compact JSON with ASCII
escapes) for the assist-request, admitted-context and returned-envelope digests.
This is separate from UTF-8 ART/run/receipt custody; do not replace those internal
digests or alter original source text. Non-ASCII titles, narratives and operator
questions retain the same strict source/target/authority verification. A mismatch
still blocks model invocation and must not be bypassed by accepting either digest.
