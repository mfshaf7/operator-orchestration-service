# Model Profile Request Operator Surface

## Purpose

Use this workflow to request a new governed model profile or a reviewed change
to an existing profile. OOS records and reviews the request. Platform
Engineering implements an approved request in its canonical registry. Security
Architecture accepts or rejects the resulting trust boundary through its own
review.

The source gate is active only for the Security-reviewed `dev-integration`
boundary. Platform work item `#1241` still owns composition and live operating
proof; source activation alone is not runtime completion.

## Console lifecycle path

The staged Console integration uses the existing request state and Platform
operation provider. Commission it only after paired source review and exact
composition acceptance; the checked-in lifecycle and preparation flags are off.
Preview is design evidence, never a live policy change.

1. Open **Model Operations → Purpose profiles → profile dashboard → Change
   profile policy**. Choose create a permission profile for an installed AI capability, amend, activate,
   suspend, retire or exception. Change operating rules only where relevant.
   The owner derives caller/output contracts, current source and the full target.
2. **Check impact** reads Platform source without invoking a model or depending
   on gateway health. Review affected workflows, the resulting state and the
   separate Security requirement. Submit a reason and data classification.
   Create and policy amendment result in suspended policy. Request names,
   purpose descriptions and review reasons are metadata; revising that wording
   alone does not change live permissions.
3. In **Purpose request history**, start review and record an explicit decision.
   Approve/reject and reason are saved atomically as an immutable decision
   artifact; ordinary users do not type a URI or calculate a hash. Existing
   externally referenced native commands remain compatible for recovery.
4. Activation and exception require an additional explicit **Security acceptance**
   from a configured Security decision maker, bound to the exact source and
   candidate. This is separate from request approval. Advisors cannot accept or
   submit final decisions. Revision invalidates Security acceptance.
5. **Prepare source review** asks the existing Platform owner to consume that
   approved request under its distinct fulfiller identity. Gary prepares only
   the three native policy documents, validates and publishes through the normal
   maintenance source bridge. No fabricated ART identity or browser command is
   involved. Source authoring can outlast an HTTP acknowledgement: check the
   original operation instead of starting a second one.
6. Inspect the exact PR/head and use **Approve & merge reviewed source** as the
   accountable human. The owner checks Gary's author, exact head, base, checks
   and human identity. Merged source is read back and published separately from
   running permission. **Apply & verify running policy** reuses the admitted
   runner and compares actual gateway source digests and profile state. Active
   policy also requires observed provider readiness; a failed check stays
   unverified and never becomes an active badge.
7. Resume the original operation after interruption. Its source/review/receipt
   identities survive restart. A rollback uses the original receipt/bundle,
   produces another Gary PR and requires human review. Later source changes
   prevent overwrite. Owned branches/worktrees are retired after verification;
   dirty or unique source is retained with a visible owner failure.

The control path does not need AI inference, an available model, or any active
profile. Runtime reconciliation may still report unavailable or unverified;
that must not prevent a later manual control/recovery request. A private commissioned management overlay lets the existing runner keep controls
available with no active profile. Unmanaged all-inactive launches remain denied;
no inference permission is granted.

### Lifecycle API additions

| Action | Route | Result |
| --- | --- | --- |
| Check impact | `POST /v1/model-profile-requests/lifecycle/prepare` | Owner-derived effect and source; no target JSON returned to the browser. |
| Submit | `POST /v1/model-profile-requests/lifecycle/submit` | Real context admission and native draft/submit. |
| Record decision | `POST /v1/model-profile-requests/{request_id}/review-decisions` | Atomic saved decision artifact plus native review transition. |
| Security status/acceptance | `GET/POST /v1/model-profile-requests/{request_id}/security-acceptance` | Separate role and current revision/candidate. |
| Original implementation | `GET/POST /v1/model-profile-requests/{request_id}/operation` | Exact operation status or bounded implementation/recovery action. |
| Private handoff | `GET /v1/model-profile-requests/{request_id}/lifecycle` | Owner or distinct approved-only Platform fulfiller. |
| Saved decision | `GET /v1/model-profile-requests/{request_id}/decisions/{digest}` | Actual stored immutable artifact; same approved-only fulfiller rule. |

The distinct Platform caller cannot list all requests, see unapproved requests,
record operator decisions or impersonate an operator. Preparation/control bodies
accept fixed selectors and bounded fields, not endpoints, shell commands,
credentials, checkouts or arbitrary policy JSON. Native five source-lock schemas
are unchanged; the additional lifecycle schema describes the adapter inputs.

## Normal API

| Action | Route | Authority and result |
| --- | --- | --- |
| Create | `POST /v1/model-profile-requests` | Operator-bound OOS draft; no lifecycle mutation. |
| List | `GET /v1/model-profile-requests` | Caller-owned request projections only. |
| Read | `GET /v1/model-profile-requests/{request_id}` | Current revision, next action, history, and receipt. |
| Review | `POST /v1/model-profile-requests/{request_id}/commands` | Revision-bound review transition by the bound operator. |
| Fulfill | `POST /v1/model-profile-requests/{request_id}/fulfillment` | Platform-owned implementation evidence after approval. |

Create and review calls require `x-oos-caller-id`, that caller's dedicated
secret, and `x-oos-operator-id`. The operator header must equal the configured
binding for the authenticated caller. Fulfillment uses a separately admitted
Platform caller identity and does not accept operator impersonation.

## Procedure

1. Create one request with a unique `request_id` and `idempotency_key`.
2. For an existing profile, bind the request to its exact profile ID, registry
   artifact digest, and source version. For a new profile, keep both fields
   null.
3. Revise the draft if needed, then submit it at the exact current revision.
4. Start review. Record either requested changes, approval, or rejection.
   Approval and rejection require a durable decision artifact reference.
5. After approval, Platform records `implementing`, then `applied` or `failed`.
   `applied` requires exact base/result versions, reviewed source evidence, and
   a Platform receipt.
6. Read the final OOS projection and the separate authoritative Platform
   profile projection. OOS fulfillment is coordination evidence, not the
   canonical profile lifecycle.

The staged Console is the normal client after exact commissioning. Direct HTTP
use remains an engineering and recovery path.

## Recovery

- On `revision_conflict`, read the request and decide against the new current
  revision; do not blindly retry stale input.
- An exact command or fulfillment replay is safe and does not append history.
  The same identity with changed input is rejected.
- After `failed`, correct the Platform-side cause and record a new
  `implementing` update against the current revision before recording another
  result.
- Corrupt state, a lost transaction lock, missing caller/operator bindings, or
  a missing Platform fulfiller fails closed. Restore the durable state or
  commissioned configuration; do not replace it with an untracked file.
- Rejected and withdrawn requests are terminal. Create a new explicitly linked
  request for materially changed intent.

## Runtime Configuration

Runtime construction requires all of:

- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_MODEL_PROFILE_REQUEST_ENABLED=true`
- `OOS_MODEL_PROFILE_REQUEST_STATE_ROOT`
- `OOS_MODEL_PROFILE_REQUEST_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_MODEL_PROFILE_FULFILLMENT_CALLER_IDS`

The feature remains disabled by default. Its manifest permits construction
only in `dev-integration` after Security work item `#1243`; stage and production
remain denied. Configuration existing does not prove that Platform `#1241`
completed composition or live operating proof.

## Evidence

Each mutation appends an ordered event and a digest-bound receipt containing
the caller, operator where applicable, request revision, review and fulfillment
state, delivery reference, source reference, and prior receipt. The projection
always states `profile_lifecycle_changed: false`.

## Non-Ownership

This surface cannot select providers or models, write the Platform registry,
grant Security acceptance, activate a profile, or enable Temporal definitions.
Those remain with their existing owners.

## Automatic preparation maintenance extension

The normal Console request is one form: choose an installed AI capability,
review its behavior guide, and supply the profile name, review description,
reason, data classification and requested operating policy. The description and
review notes do not author task instructions. Platform supplies current workflow identity/repository/output-contract
bindings. OOS obtains the supporting context reference from an actual CGG text
admission, then invokes the unchanged native create and submit transitions.
No AI inference, review approval or profile activation is performed.

The optional APIs are `GET /v1/model-profile-requests/options` and
`POST /v1/model-profile-requests/submit-prepared`. Both require the authenticated
caller plus its bound operator. The prepared body follows `prepared.schema.json`;
it contains operator choices and the selected workflow/setup digest, never a
browser-provided caller binding, context digest, output schema or operator ID.
The options response follows `options.schema.json`. The old full-reference API
remains the explicit integration-maintainer and compatibility path.

The current setup digest and environment are checked before context admission.
CGG must report safe redaction and denied raw projection with a genuine artifact
identity/digest. Only its packet reference is retained in the native request;
raw paths and source text remain in their existing private owner custody.
Exact retries recover the original request without re-admitting completed work.
Concurrent identical attempts may create more than one CGG admission artifact,
but native request identity and history remain singular. Existing CGG custody
and retention own those artifacts; there is no new replay store.

Known preparation failures before native create preserve editable intent and
its original ID. Busy, conflict and uncertain transport results require original
request readback. A successful native result survives a separate register-read
failure. Approval still requires the actual review decision evidence; Platform
fulfillment and Security acceptance remain separate.

Source availability does not enable this extension. Commission it only after
exact composed acceptance, with `OOS_MODEL_PROFILE_REQUEST_PREPARATION_ENABLED`
and `CGG_MODEL_PROFILE_REQUEST_BASE_URL` alongside the existing admitted
model-management configuration. Both default to inactive/absent. An unavailable
producer, caller binding, context service or current setup fails closed with a
clear preparation error. This adds no model/provider requirement to core startup.

## Bounded Console history reads

The existing list accepts `view=summary` with the same caller scope, cursor and
limit1–100. Default `view=full` preserves native compatibility. Summary records
contain only request identity, revision, display name, request time, review state,
implementation state and next action. They omit context, decision evidence,
receipts and event bodies and cannot authorize a mutation. The Console requests
25 summaries on demand and reads the selected original through its existing
current source envelope before review. Sorting and cursor comparison use the
same code-point order, including punctuation and mixed-case identifiers.

The private integrity-checked JSON store still loads its state once for a page,
but the summary path avoids cloning full event histories. No new index, cache,
store, caller privilege or lifecycle action is introduced. Profile source reads
are independent of history and no longer poll all requests. Native/full clients
retain the existing read/review/fulfillment evidence path.

## Explicit capability-profile selection and revision recovery

The operator approved multiple named permission profiles for each installed AI
capability with explicit selection. A capability is implemented integration code,
not an ART Feature or an authored business workflow. Existing model-management
configuration now accepts `profile.assign` with only capability/profile IDs.
It retains revision, operator, original-command, receipt, historical readback and
reconciliation checks. The catalog exposes registered compatible profile choices;
current configuration determines the selected choice. There is no default model
ranking, new service, storage subsystem or AI approval authority.

The base capability still authorizes its caller, context and output contract.
A selected permission preset adds restrictions; it cannot grant a different task
implementation or broader context access. Data-scope prose is reviewed policy
information, not an executable filter. Native source validation crosses the real
runtime resolver, including compatible variants and base-activation dependency.
Model routes keep stable capability/task identities. The optional selection
`policy_profile_id` identifies the effective preset under the same captured
configuration revision. Replaying an original invocation after selection changes
or process restart cannot trigger another inference.

`POST /v1/model-profile-requests/lifecycle/revise` refreshes source/context and
replaces the candidate only in a draft or changes-required request at its exact
revision. A stable command replays its saved result without readmitting context.
Acceptance clears on revision. Review-description edits remain metadata and
cannot silently remove prepared integration evidence. Direct technical setup is
explicitly a maintainer request, with automatic implementation unavailable until
actual preparation exists. Request text is not capability code or AI instructions.
The normal form supplies source-backed behavior guidance and allows operating
limits to be requested together with creation. Lifecycle/preparation deployment
flags remain off pending exact composition acceptance and an operating witness.
