# Prototype Closure Operator Surface

Prototype Closure coordinates four distinct actions for an already landed
Prototype: `apply-delivery`, `graduate-source`, `retire-incubation`, and
`reopen-incubation`. OOS owns the caller-bound workflow and terminal receipt;
Prototype Studio owns lifecycle and source history. WGCF owns readiness.
Delivery, a durable source owner, and Platform remain the authorities for their
respective acceptance and runtime-disposition evidence. Closure does not
publish to Portfolio or authorize a governed release.

## Availability

The API, source adapter, and OOS composition are source-active only for the
bounded `dev-integration` profile. Activation requires the dedicated Studio
repository identity, exact WGCF configuration, a caller-specific WGCF readback
credential, and current readers for Studio, Delivery, Platform, OOS, and each
selected durable owner. Setting `OOS_PROTOTYPE_CLOSURE_ENABLED` alone is not an
activation path. Missing identity, evidence-file, or owner-reader dependencies
fail closed.

### Native durable-owner source proof

For the qualified public synthetic, main-based source-only route, use the
existing finalized Delivery source-work Review Packet URI as
`durable_owner_acceptance_ref`. For `already-owned`, the same URI may also be
`already_owned_source_proof_ref`; each evidence fact is checked independently.
For `transfer`, the owner discovers the transfer proof from that exact accepted
packet, not by scanning sessions or asking an operator to author a receipt.

The app-import Landing Unit must include
`records/prototype-source-imports/<prototype-id>.json`, matching the canonical
`prototype-source-import-manifest.schema.json`. This is inert import metadata:
the actual accepted Prototype/Delivery references, approved Studio source
commit, intended custody and complete source-to-owner byte-digest mapping.
It must not contain its own future merge SHA, a claimed approval or a runtime
grant. Native review, merge and finalized Review Packet custody come first;
source graduation consumes that real evidence afterward.

Normal OOS composition resolves the existing durable artifact and current
Inventory, verifies the packet's exact Delivery and accountable operator
through the existing Delivery caller/operator binding, proves the merge is on
the provider's current public `main`, and checks every accepted Studio file's
bytes and mode against the imported Git objects. Unrelated later metadata
commits do not require rewriting historical import proof. Changed Prototype
files, missing mapping, wrong target/provider/operator, unmerged source,
Intake-only or inactive owners, unsafe paths, and private/client repositories
fail closed. No application code executes during this readback.

For graduation, WGCF scopes accepted Delivery receipt discovery to the target
already recorded in committed Studio source. OOS independently rechecks that
receipt against the verified readiness row's target, including when resuming a
retained request whose source snapshot predates this read correction. Target,
owner, packet, receipt, actor and current-version checks remain in force. A
missing marker is a broken source link, not an invitation to repeat Delivery
application. The initiative/tree/work-item narrative writers retain an existing
Prototype application marker and reject a changed or duplicate binding. The
same description replacement paths retain current native ART evidence reference
entries, including their original projection times; changing those pointers
requires their existing controlled projection workflow. For
an already lost marker, verify the original trusted target activity and restore
that exact original metadata through reviewed Console narrative editing before
continuing the same Closure request. Do not recreate its app or receipt.

The normal server supplies the existing Delivery artifact service and reviewed
Inventory authority root; injected test readers are not operating acceptance.
WGCF's bounded readback retains its eight-field verified-reference shape;
OOS separately retains the verified custody fact for Studio reconciliation.
These source changes require final composed Security acceptance and Platform
activation before being claimed as live capability.

The complete Console composition requests post-graduation disposition from the
existing authenticated Platform provider using the exact Prototype, merged
Studio revision and source event. Platform verifies current source custody and
managed Preview absence and records its existing content-addressed proof.
OOS does not choose the disposition, stop a resource or supply a proof body.
An unavailable or unverified owner response retains the same pending request;
the commissioned reader does not fall back to historical file evidence.
The existing file reader remains the recovery/pre-merge retirement interface.
Exact composed Security acceptance and normal Platform activation are required
before these source changes become operating capability. It binds Studio
committed-source readback, Delivery acceptance, OOS receipt custody, and
Platform disposition without accepting caller-authored proof bodies. Source
tests do not prove live owner acceptance or permission to mutate Studio.
Security #1140 is conditional activation approval; Platform #1107 must
commission and operating-prove the exact local runtime, and Console #1151 must
exercise all four actions through the configured operator path before normal
availability is claimed.

WGCF's `POST /v1/prototype-closures/owner-readbacks` is a caller-specific,
read-only service path. It reads accepted baseline receipts from OOS Maturity
custody, accepted Delivery application receipts from trusted OpenProject
target activity, and completed OOS retirement receipts bound to the exact
Studio retirement event. A completed retirement receipt exposes its
`receipt_id` as `receipt://prototype-closure/<digest>` for a later reopen.
It returns exact owner-backed evidence, never a caller's
proof body. The route is available only in the commissioned Closure composition
and does not replace the Studio, Platform, or durable-owner authorities.

Historical Baseline source readback uses Maturity's UTF-8 canonical record
digest, including Unicode text. Closure's current source snapshots and history
continue to use Closure's ASCII-escaped codec. These are distinct producer
contracts: do not rewrite historical receipts or normalize source text to make
the hashes match. A dependency failure retains the original request for retry.

## Isolated Conformance

ART #1109 uses a source-only conformance runner before Security activation:

```bash
npm run test:prototype-closure-conformance -- \
  --studio-root /home/mfshaf7/projects/workspace-prototype-studio \
  --wgcf-root /home/mfshaf7/projects/workspace-governance-control-fabric \
  --console-root /home/mfshaf7/projects/governance-operations-console \
  --wgcf-python /home/mfshaf7/projects/workspace-governance-control-fabric/.venv/bin/python \
  --evidence-output .art/receipts/prototype-closure-conformance-1109.json
```

Fetch `origin/main` in all three input repositories first. The runner refuses
stale fetched refs, clones exact commits, and uses real Git history inside
temporary Studio clones. It exercises Console command construction, current
WGCF readiness issue/replay/readback, OOS durable phases, all four Closure
actions, denied and cancelled paths, changed review heads, post-merge recovery,
terminal receipts, and append-only Studio history. It removes the temporary
clones after the run and writes a bounded evidence file with exact revisions.

Delivery, durable-owner, and Platform receipts in this run are explicitly
synthetic fixtures. A passing run is not live owner acceptance, human review
of an actual Studio PR, Security activation approval, or runtime commissioning.

## Normal Operator Path After Activation

1. Read `POST /v1/prototype-closures/preparations` with a Prototype ID to obtain
   the current committed Studio revision, lifecycle, custody, record digest,
   and a bounded summary of validated append-only Closure history. History
   events show source truth; they are not terminal OOS receipts.
   This read does not create a request or change source. Submit
   `POST /v1/prototype-closures/requests` with one immutable canonical
   request bound to that exact source state. The authenticated caller
   must match `request.operator_id`. Replay with identical input returns the
   existing request; changed input under the same identity conflicts.
2. Call `POST /v1/prototype-closures/requests/{request_id}/continue` with `{}`.
   OOS reads the exact Studio lifecycle, record digest, and source custody,
   then asks WGCF for current readiness and reads the durable readiness back.
   A blocked or stale result ends with a denied receipt and no Studio event.
3. At `decision-required`, record `approve` or `deny` through
   `POST /v1/prototype-closures/requests/{request_id}/decisions`. Denial is
   terminal without source mutation. Approval binds the readiness digest; it
   does not itself accept a target or merge source.
4. Continue to reconcile the action-specific target, custody, or runtime
   evidence with its owner. OOS then prepares exactly one Studio registry
   change and append-only history event on a review branch. The source event
   must bind the accepted request and verified evidence refs.
5. Present the Studio PR URL, exact head, changed paths, validation result,
   and proposed disposition to the operator in the conversation. Agent Gary
   may use the operator account to approve and merge only after explicit
   authorization for that PR and head. The GitHub approval body must be a
   JSON object with `schema_version: 1`,
   `artifact_type: prototype-closure-delegated-approval`, the exact
   `pull_request_number` and `head_commit`, `operator_login`,
   `operator_decision: approved-in-conversation`, and
   `executed_by: agent-gary`. A changed head requires a new decision and
   approval. OOS checks that attestation and the exact-head owner validation;
   the provider record does not independently prove the chat decision.
   `review-required` is not a
   completed closure. After observing the merge, OOS stays at
   `pending-readback` until the exact merged Studio event, lifecycle, custody,
   and source revision agree. Graduation then remains at
   `pending-runtime-disposition` until Platform confirms exact active-resource
   revocation or absence for the merged source. Only then may OOS issue a
   completed receipt. The Platform proof must identify the Prototype and
   merged Studio revision and use a content-addressed reference. OOS reads
   that proof; it does not revoke runtime resources itself.
6. Read `GET /v1/prototype-closures/requests/{request_id}` for the durable
   phase, next action, review, readback, and receipt. The projection excludes
   the base64 source-file bodies held for review publication.

## Recovery Rules

An unavailable dependency retains the last durable phase. Before merge, a
retry may continue the same bound request and prepared source; it must not
silently replace the request or create an unrelated branch. After a merge is
observed, retry only readback reconciliation. Do not create another source
event, claim failure as a rollback, or issue a terminal success while readback
is uncertain. A changed review head, absent independent review, stale source,
or missing owner receipt stops progress for investigation. Denied and failed
pre-merge receipts carry a finding and next action but no completed source
event.

`POST /v1/prototype-closures/requests/{request_id}/cancel` takes `{}`. It
closes an unmerged review and records a denied, operator-cancelled result. A
branch may remain for audit. If a merge raced with cancellation, OOS moves to
`pending-readback` instead; cancellation cannot undo merged Studio history.

## Action Boundaries

- `apply-delivery` starts only after Prototype-to-Delivery ingress has returned
  an owner-accepted Delivery target and exact receipt. The Closure request
  carries both refs alongside the accepted baseline. This path accepts only
  the new Delivery Epic issued or idempotently reused by ingress; Closure does
  not create the target. It moves Studio to `graduating` and project phase to
  `delivery-governed`, but leaves source custody in Studio.
- `graduate-source` needs durable owner and repository acceptance plus exact
  transfer or already-owned source proof. It moves custody out of Studio only
  after those receipts exist.
- `retire-incubation` needs a retention plan and exact Platform runtime
  disposition proof. It ends local incubation, not accepted Delivery work.
- `reopen-incubation` needs the prior retirement receipt and retained source
  readback. It returns to exploration without restoring old preview
  credentials or deleting history.

The [API contract](../api/openapi.json) documents route bodies and responses.
The pinned source schemas are under [`contracts/prototype-closure/`](../../contracts/prototype-closure/).
