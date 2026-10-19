# Platform Operation Adapter Operator Surface

## Operator outcome

Use the Governance Operations Console as the normal surface. The Console reads
capabilities and operation state from OOS; OOS coordinates with the Platform
owner and returns an exact next action. Operators must not reconstruct normal
Dev Integration or Governed Release work by calling Platform, editing state
files, or using a shell.

This source revision provides the OOS half of the workflow. Until Security
accepts the exact revision and Platform commissions its owner routes, the
runtime stays disabled and returns `platform_operation_not_configured`.

## What the Console must do

1. Read `GET /v1/platform-operations/catalog` immediately before preparing a
   command.
2. Select only an available capability for the exact subject and retain its
   `source_version`.
3. Construct the finite command, calculate its canonical intent digest, and
   obtain the operator's approval for that exact digest.
4. Submit it once to `POST /v1/platform-operations/commands` with a stable
   command id and idempotency key.
5. Retain the OOS `operation_id`; read that resource until it is terminal or
   exposes an operator control.
6. Show `next_action.code`, `authority`, and `reason` without translating a
   blocked state into success.
7. For retry or cancel, create a new stable control id and idempotency key and
   reuse both unchanged after a lost response.
8. For a terminal operation, show the owner receipt and any retained effect.

The Console may list recent records through `GET /v1/platform-operations`.
Operation responses never grant authority for a second effect; a new intent
requires a new command and approval.

## State interpretation

| State | Meaning | Operator action |
| --- | --- | --- |
| `requested`, `queued`, `running` | The exact command is retained and owner work is pending. | Wait, or cancel only when the projection exposes cancel. |
| `blocked` | Current owner truth is unavailable or a dependency blocks progress. | Follow the returned owner and exact next action; do not resubmit with a new key. |
| `failed` | The owner produced a terminal failure receipt. | Retry only when `retryable` is true; otherwise request correction from the named owner. |
| `cancelled` | The owner produced a cancellation receipt. | Inspect retained effects; do not assume rollback. |
| `succeeded` | The owner produced a terminal success receipt. | Treat only the recorded receipt effect as proven. |

## Source authorization through the Console

The finite `agent-source.issue`, `agent-source.renew`, and `agent-source.revoke`
actions extend the existing Platform operation family. They do not authorize a
new repository, installation, App permission, model, or deployment. Ordinary
source remains separate from the explicitly marked proposed-owner bootstrap
purpose described below. Their source implementation is not operating acceptance: exact
Security acceptance and coherent Platform/Console commissioning are still
required. An unavailable canonical subject resolver fails closed; accepting
the typed Prototype wire shape alone does not make Prototype authoring usable.

### Proposed-owner bootstrap source boundary

The staged credential-operation dispatcher additionally recognizes only
`trusted-owner-bootstrap` with a real `repository-bootstrap` subject. The
ordinary Delivery/Prototype input and receipt contracts remain closed and
reject that purpose. A missing bootstrap workflow resolver fails before
issuance; accepting this wire shape is not an available Console workflow.
The Console adapter is source-staged in Repository Intake with isolated
browser/recovery and native OOS protocol checks. Normal operator bootstrap
execution still requires exact composed Security/Platform acceptance and its
complete operating witness.

Read-only bootstrap preparation binds its authenticated caller/operator and
verifies successful canonical Repository Custody, current proposed source-only Intake, absence from active/retired
Inventory, and exact provider identity before target source inspection. The
current public synthetic adapter reads a stable provider main and verifies
bounded regular UTF-8 Git blobs. Private/client source is explicitly
unqualified; no ambient credential or exposure-changing fallback exists.
Preparation creates no checkout, token, source request, admission or runtime.
Custody is shared workspace authority under its authenticated API contract,
not a caller-private historical record. The new source request, exact approval,
session and credential intent are caller-bound; no custody-adoption mechanism
or fabricated legacy ownership is introduced.

The trusted OOS template produces only finite owner controls and the actual
operator-selected owner evidence profile. Existing README bytes are retained;
independent controls are not overwritten. CI is optional. Bootstrap validation
does not execute app commands or count as application acceptance. The optional
CI app runner uses actual selected tests/validations and explicit Git base/head
substitution; missing application source is reported as bootstrap-only.

The separate credential subject binds the exact proposed entry version/digest,
custody receipt, template/plan digests, finite changed paths and operator
decision. Workflow write additionally requires a separate approval reference
and the exact selected workflow path. Platform independently rereads canonical
proposed Intake before minting. The projection is purpose-marked; ordinary
consumers cannot adopt it. The existing issuer, renewal, uncertain-operation
recovery, human reviewer separation and exact revocation remain in use.
Neither successful bootstrap nor an App installation admits or activates an
owner or permits model/application imports.

1. For Delivery, obtain and review the actual work-session decision through
   its normal preflight. Resolve every prerequisite other than the missing
   projected source credential. Do not create a fake session to obtain access.
2. `POST /v1/platform-operations/source-preparations` with one `preparation`
   containing `preparation_id`, the actual subject selector, `decision`,
   `expires_at`, and `supersedes_intent_digest` (initially null). OOS derives
   repository/provider ids, installation, branch, fetched base, reviewer and
   source-start digest from its canonical workflow. The browser cannot choose
   these coordinates. Preparation creates no branch, worktree, or token and
   does not constitute approval.
3. Show the returned exact source scope and expiry. The explicit approval must
   explain that this scope permits renewal when actual source actions require
   it and exact revocation on terminal close/cancel. Approve the ordinary-source
   issue command with `capability_id: agent-source.issue` and input exactly
   `{source_intent, session_id}` from the preparation. Use the current catalog
   subject/version and the normal canonical command digest/approval procedure.
4. Follow its retained Platform operation. Unknown issue outcomes are read or
   retried under the original identity, never replaced with another mint.
   `failure.retry_after` is an owner uncertainty boundary, not permission to
   retry early or assume that a token was revoked.
5. Supply the preparation's `intent_id` as `command.source_intent_ref` in the
   real Delivery start. OOS rechecks the requested start before recording the
   source command as pending. A credential still settling returns
   `platform_source_credential_pending` with its operation id, so the same
   unchanged source command can be retried. Changed decision, owner, base,
   branch, actor, subject or session fails closed.
6. Later source commands recover the reference from the real session. Missing
   bindings on pre-existing sessions require an explicitly prepared and
   approved matching scope; they do not inherit ambient engineering tokens.
   The actual canonical session binds once. Ordinary progress does not replace
   the original subject snapshot or invent a new architecture version.
7. On an actual source action, OOS renews only this still-approved, unexpired,
   unstopped scope when the source owner's existing rotation window requires
   it. It retains the original approval reference/time and deterministic owner
   command identity. GET, list, preparation and preflight never mint or renew.
   Every normal Agent source dispatch checks the private lease again, including
   expiry between actions. The check and raw token never cross into the model,
   browser, source repository, or command journal.
8. Explicit cancellation of source access uses exact `agent-source.revoke`,
   not generic worker cancellation. Accepted local stop precedes provider
   dispatch, so loss of owner connectivity cannot restore write access.
   Source effects serialize with stop; a busy stop is not an accepted stop.
   Terminal work close and session retirement request the same exact owner
   revocation. Follow `source_authorization.operation_ref` until its receipt is
   confirmed; `revocation-pending` or `revocation-required` is not completion.

Cold recovery uses `GET /v1/platform-operations/source-preparations/{intent_id}`
or the caller-scoped list at `/v1/platform-operations/source-preparations`.
These return original scope and safe approval/receipt metadata, not credentials.
Their `operation_refs.issue` and `operation_refs.revoke` identify the original
retained Platform operations, including an interrupted terminal stop. Reconcile
or explicitly retry those exact operations; do not scan a bounded history or
invent a replacement issue/revoke because an acknowledgement was lost.
For Delivery, `start_decision` retains the canonical prospective Work Session
decision already held by its source proof. Reload can recover those original
choices before session creation rather than guessing a new Landing Unit or
silently borrowing another scope. Prototype preparations return null there.
Expiry or stop cannot be undone by replaying an old successful issue receipt.
Fresh explicit approval may reauthorize the same still-valid source session
after expiry: revoke the predecessor, prepare a new intent naming its exact
digest, approve issue, and pass that new reference in the normal source command.
OOS verifies the issued successor and unchanged actual session/scope before
adopting it. This does not require changed source, a new branch or a new story.
Real source recovery instead binds its actual changed source-start input.
Neither path silently replaces approval or automatically extends its deadline.

Read/review, accountable human merge, and terminal cleanup retain their existing
authority boundaries. Source authorization does not grant Agent Gary human
merge or repository-administration rights. Owner-repo maintenance and explicit
engineering recovery retain their documented Platform delivery path; they are
not the normal Console source workflow.

## Runtime activation

Platform commissioning supplies the values; OOS operators do not invent them.
All must be present before activation:

- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_PLATFORM_OPERATION_ENABLED=true`
- `OOS_PLATFORM_OPERATION_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_PLATFORM_OPERATION_PROVIDER_BASE_URL`
- `OOS_PLATFORM_OPERATION_PROVIDER_CALLER_ID`
- `OOS_PLATFORM_OPERATION_PROVIDER_CALLER_SECRET`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_URI`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_DIGEST`
- `OOS_PLATFORM_OPERATION_SECURITY_DECISION_REVISION`
- optional `OOS_PLATFORM_OPERATION_STATE_ROOT`
- `OOS_PLATFORM_OPERATION_PROVIDER_ALLOW_HTTP=true` only for an admitted
  loopback or cluster-local development target

Activation must bind the Security decision to the exact reviewed OOS revision.
Changing that revision requires a new or refreshed Security decision.

## Recovery

- After an OOS restart, read the existing OOS operation. Non-terminal state is
  reconciled by immutable command identity without resubmitting the command.
- After a lost submit response, repeat the same command with the same
  idempotency key. OOS returns the retained operation or rejects changed intent.
- After a lost control response, repeat the exact same control with the same
  idempotency key. Do not generate a replacement key.
- When the Platform owner is unreachable, preserve the blocked operation and
  restore owner connectivity. Do not edit OOS state files.
- Corrupt retained state is a fail-closed service condition. Preserve it for
  investigation; do not delete it to make the screen green.

## Validation boundary

Unit and API tests prove the OOS contract, persistence, denial, replay,
conflict, retry, cancel, and restart behavior. Platform deployment and live
Console-to-Platform execution are separate acceptance steps in #1291, #1292,
and #1298.
