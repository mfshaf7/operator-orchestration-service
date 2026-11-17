# Agent Console Orchestration

This is the primary OOS operator surface for the governed Agent Console
session path introduced by ART #1245.

## Current State

The source contract is complete but disabled by default. Platform #1246 must
commission the `dev-integration` runtime binding, Console #1247 must replace
its local provider path with these routes, and Security #1248 must accept the
exact composed boundary before the Feature is operating-ready.

Do not set `OOS_AGENT_CONSOLE_ENABLED=true` outside the reviewed
`dev-integration` composition. Route availability is not approval to activate
a model profile or an owner mutation path.

## Authority And Sequence

### Native local draft advice — approved preview batch

Form and tree advisors reuse the existing `operator_draft` candidate and governed
profile. The provider returns its native `draft_reply` object, with a declared
intent and typed text, board or tree edits. OOS validates this structure and the
admitted fields before recording success, then serializes it for the existing
Console client envelope. It never repairs prose by guessing edits or falls back
to an unstructured draft reply. Ordinary chat remains a readable answer.

The Console still validates its exact captured source/view and the complete local
transaction before editing. Questions and readonly requests cannot change drafts;
switching views or changing captured content prevents a stale proposal applying.
Final workflow decisions and canonical actions remain separate explicit controls.
This source batch requires paired Platform schema and composed operating proof
before it is claimed live.

This shared draft path serves Proposal triage and disposition, Prototype
Candidate and Baseline promotion drafting, Execution selected-node text,
Work Design and Refinement blocker justifications, and Orchestration Definition
drafting. They use the same native reply validation; none needs a separate model
endpoint or provider-format implementation. A malformed reply is retained as a
failed invocation with no usable draft result. Replaying that request returns
the same outcome without a new model call; a subsequent intentional request can
proceed normally.

Work Design Context and Build Tree use their dedicated Work Design assist route
with the same native reply shape. Refinement metadata and source-editor assistance
keep their existing native field-value and file-edit contracts respectively.

OOS owns session identity, one-active-invocation ordering, deterministic
replay, terminal state, and invocation receipts. Every invocation follows one
fixed sequence:

1. authenticate the caller with a caller-specific credential and bind
   `x-oos-operator-id` to that caller;
2. reserve the invocation durably before any upstream call;
3. send the exact candidate to the pinned CGG Agent Console projection
   contract;
4. verify the complete CGG schema, session binding, candidate digest, safety
   flags, authority flags, receipts, and timeline;
5. send only the model-safe projection to the governed AI gateway;
6. verify the active profile, caller, task, response schema, audit reference,
   and timeline;
7. record a terminal completed, failed, or cancelled invocation and its
   digest-bound receipt before responding.

There is no raw-context fallback and no direct provider path. An upstream
transport error becomes a bounded retryable failure; it cannot leave the
session permanently busy.

## Routes

All routes require `x-oos-caller-id`, `x-oos-caller-secret`, and
`x-oos-operator-id`.

- `POST /v1/agent-console/sessions` creates or replays a session.
- `GET /v1/agent-console/sessions/{session_id}` reads the caller-owned session.
- `POST /v1/agent-console/sessions/{session_id}/invocations` runs one governed
  invocation.
- `POST /v1/agent-console/sessions/{session_id}/actions` admits one canonical,
  session-bound Agent Action through the existing OOS/WGCF enforcement path.
- `POST /v1/agent-console/sessions/{session_id}/close` closes the exact
  expected revision.

The action route is not an arbitrary dispatcher. It fails closed unless the
runtime has an admitted owner adapter, the action binds the current operator,
session, and agent instance, WGCF allows the exact current request, and any
mutation returns the owner receipt required by the canonical Agent Action
contract. With no admitted adapter, it returns `503` without evaluation or
dispatch.

## Configuration

- `OOS_AGENT_CONSOLE_ENABLED` — defaults to `false`.
- `OOS_RUNTIME_PROFILE` — must equal `dev-integration` when enabled.
- `OOS_AGENT_CONSOLE_STATE_ROOT` — private atomic session and receipt store.
- `OOS_AGENT_CONSOLE_CALLER_OPERATOR_BINDINGS_JSON` — exact caller-to-operator
  map.
- `CGG_AGENT_CONSOLE_BASE_URL`
- `CGG_AGENT_CONSOLE_CALLER_ID`
- `CGG_AGENT_CONSOLE_CALLER_SHARED_SECRET`
- `GOVERNED_AI_GATEWAY_BASE_URL`
- `WGCF_DELIVERY_ART_BASE_URL`, `WGCF_DELIVERY_ART_CALLER_ID`, and
  `WGCF_DELIVERY_ART_CALLER_SECRET` for Agent Action evaluation.

Provider credentials are never projected into OOS. CGG and WGCF secrets must
come from the Platform-owned runtime composition, not source or Console input.

## Recovery

An identical session, invocation, or close retry returns the retained result.
A conflicting identity or payload is rejected. After a process restart, read
the session before issuing a new invocation. A terminal failed or cancelled
invocation clears the active reservation; rerun only with a new invocation and
idempotency identity when the operator intentionally wants a new model call.

Do not edit the state file by hand. Preserve it for diagnosis if integrity
validation fails, disable the runtime, and repair the owning source or
composition before retrying.

## Evidence

The pinned CGG schemas and source commit are recorded in
`contracts/agent-console/manifest.json`. API examples and request/response
contracts are generated into `docs/api/openapi.json`. Source completion for
#1245 proves merge-ready protocol behavior; live positive and negative cases
belong to Platform #1246 and activation acceptance belongs to Security #1248.

## Advisor work knowledge and context

The unpublished advisor repair extends the existing paths with source-owned
work guides in `src/advisor-work-instructions.js`. Proposal triage/disposition,
Prototype Candidate/Baseline, Execution narrative, blocker justification and
Definition Design each receive their own guide through the Agent Console task
instruction. Work Design Context/Build Tree, Refinement metadata and the source
editor receive their guides through their existing native routes. Overview
assistance remains scoped to the supplied Console observations.

The guide states the job, applicable workflow boundaries and evidence limits.
Promotion requirements are read from the canonical Prototype maturity contract;
Orchestration examples come from its registered source definitions. Source
examples do not establish runtime admission or promise a universal activity
catalog. These instructions add no model, permission, tool, automatic retry or
final-decision authority.

Console context includes current field values, relevant checks and explicitly
missing evidence. References, tree listings and document names are not loaded
contents. Repository instructions, Codex conversations and skills are not
automatically inherited. If missing evidence could change advice, the advisor
must identify it and ask a focused question while helping with the supported
part. Small wording changes do not require unrelated contracts or full sources.

Selected draft assistance rejects context-budget truncation before model
dispatch. Paired CGG guards preserve complete Work Design drafts and Refinement
fields; the source editor requires explicit complete-budget metadata for its
selected buffers. A denial asks the operator to narrow the scope and preserves
the draft. Ordinary overview chat retains its existing bounded projection.
Source tests and browser request checks establish wiring and conformance;
qualified model behavior requires reviewed composed activation and real cases.

## AI activity history

The Console's Agent Runtime dock provides Recent AI activity and a bounded
History dialog. Opening history or inspecting a row performs only owner reads.
The row's task, source workspace, item identity, request state/time and available
receipt/context/model-audit references come from OOS. Assistance completion does
not imply draft acceptance or canonical workflow completion.

`GET /v1/agent-console/activity` requires the same caller-specific credential
and `x-oos-operator-id` binding as the existing Agent Console path. It accepts
only `limit` (default 10, range 1–50) and the returned opaque `cursor`.
Pagination is stable by request timestamp and identity; terminal updates do not
move an item between pages. The caller cannot select a different operator or
owner. Reads do not create a session, replay a model call, submit a draft or
change any canonical workflow record.

The projection includes retained Agent Console invocations. Optional closed
activity kind and record identity are retained for new requests and bind their
existing request digest. Older requests show absent labels/links explicitly.
Native Work Design context/tree and Refinement metadata requests retain their
existing model paths and record safe summaries in the same private store when
Agent Console recording is active. Recording requires an enrolled caller-specific
identity and its configured operator. Other existing native callers keep their
original service path without entering this operator-scoped history. No prior native history is fabricated
from stdout or browser state; its coverage begins when recording is deployed.

History returns recorded working/completed/failed/cancelled outcomes. An
unfinished reservation from an earlier owner process is unconfirmed after
restart; history does not retry it or claim a terminal result. Native advice
retains its actual CGG/model audit references without inventing an Agent
Console invocation receipt. Prompt text, results, draft payloads, credentials
and error messages never enter this read projection.

The private store remains authoritative. Reads verify its existing digest;
unchanged file versions reuse at most 16 bounded metadata pages, and writes
invalidate that cache. The browser keeps one bounded older page rather than
accumulating all history. A failed continuation retains that page and retries
the same cursor. A failed refresh exposes source unavailability and retains
previous results as an older observation, without selecting preview examples.
Record navigation uses admitted Console workspace intents only; missing record
metadata keeps request inspection available without a guessed destination.

Source admission is separate from commissioning. This local maintenance
candidate stays uncommitted with the operator's UI batch. Land OOS before the
dependent Console, finish the source-scoped Security delta, bind final commits
and use the existing Platform activation procedure before claiming live history
qualification. Normal operation is through the Console; this GET is its owned
API and engineering recovery surface.

## Selected project knowledge — unpublished continuity extension

The Console can explicitly select one Proposal, Prototype or Delivery item for
read-only discussion. Its existing authenticated owner reader resolves that
exact identifier on send; the browser cannot submit the item body or a URL to
fetch. OOS receives the resulting current source, revision, observations and
coverage inside the digest-bound candidate, not a new model retrieval tool.
Linked documents, repository files and other projects remain unavailable unless
their own admitted workflow supplies them. Current recorded facts take precedence
over old working conversation; all content remains untrusted input, not approval.

Truncated selected project detail or conversation fails before model dispatch.
Normal bounded overview compatibility stays available. The same model/profile,
provider data permission and manual final-decision boundaries apply. The Console
discloses the actual selected source revision/coverage with the reply.

Working chat now uses the existing private saved-input store as described in
[Saved operator work](saved-operator-work.md). It is distinct from model receipts
and never creates canonical project state. Exact composed source review and
activation are still required; isolated conformance checks are not live proof.


### Technical Plan Advisor

`execution-architecture` extends the existing Agent Console draft-advisor route
for the Console's package-scoped Technical Plan & Approval workspace. It uses
`agent-console-assistant-v1`, including Model Operations selection, CGG context
admission, the native structured reply and activity/receipt evidence. This is a
new named role of the existing capability, not a new model/provider connection.
Only manual requests invoke it. The work guide is source-owned in
`src/advisor-work-instructions.js` and the activity kind is registered in the
existing invocation and activity contracts.

The supplied selected section contract and actual project observations guide
local JSON drafting. The advisor may explain or draft that section when asked;
it cannot grant architecture approval, record custody, select covered work,
change source pins, or start/complete execution. Missing Work Design, source
contents or cross-section evidence remains unknown. The Console explicitly
identifies which saved diagram and supporting sections are loaded. Final plan
validation, human approval and recording keep the existing architecture API and
owner authority. Questions return answer/clarify with no edits.
