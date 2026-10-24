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
3. Keep the returned value suggestion-only. The operator accepts, edits, or
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

The packet reads each target's current OpenProject form and canonical values.
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
