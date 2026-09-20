# Prototype Closure Operator Surface

Prototype Closure coordinates four distinct actions for an already landed
Prototype: `apply-delivery`, `graduate-source`, `retire-incubation`, and
`reopen-incubation`. OOS owns the caller-bound workflow and terminal receipt;
Prototype Studio owns lifecycle and source history. WGCF owns readiness.
Delivery, a durable source owner, and Platform remain the authorities for their
respective acceptance and runtime-disposition evidence. Closure does not
publish to Portfolio or authorize a governed release.

## Availability

The API, source adapter, and OOS composition are implemented but **inactive**.
The normal runtime returns `503 prototype_closure_not_active`; setting
`OOS_PROTOTYPE_CLOSURE_ENABLED` alone cannot activate it. The composition
requires the dedicated Studio repository identity, exact WGCF configuration,
separate current readers for Studio, Delivery, Platform, OOS, and each selected
durable owner, plus a Platform disposition reader. Source composition now binds
Studio committed-source readback, Delivery acceptance, and OOS receipt custody
directly when their owner stores are present. Platform and selected durable-owner
readers remain explicit dependencies; missing readers fail closed. The normal
service entrypoint does not supply those external readers yet. Source tests
using injected readers do not prove live owner acceptance or permission to
mutate Studio. Security #1140 is conditional pre-activation approval; Platform
#1107 must commission the exact local runtime, and Console #1151 must prove
the configured operator path before normal availability is claimed.

WGCF's `POST /v1/prototype-closures/owner-readbacks` is a caller-specific,
read-only service path. It reads accepted baseline receipts from OOS Maturity
custody, accepted Delivery application receipts from trusted OpenProject
target activity, and completed OOS retirement receipts bound to the exact
Studio retirement event. A completed retirement receipt exposes its
`receipt_id` as `receipt://prototype-closure/<digest>` for a later reopen.
It returns exact owner-backed evidence, never a caller's
proof body. The route remains inactive with Closure and does not replace the
Studio, Platform, or durable-owner readers required by the normal composition.

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
5. An independent human reviews the exact source head and owner validation,
   then merges through the source provider. `review-required` is not a
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
