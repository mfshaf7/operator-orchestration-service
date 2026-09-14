# Prototype Closure Operator Surface

Prototype Closure coordinates four distinct actions for an already landed
Prototype: `apply-delivery`, `graduate-source`, `retire-incubation`, and
`reopen-incubation`. OOS owns the caller-bound workflow and terminal receipt;
Prototype Studio owns lifecycle and source history. WGCF owns readiness.
Delivery, a durable source owner, and Platform remain the authorities for their
respective acceptance and runtime-disposition evidence. Closure does not
publish to Portfolio or authorize a governed release.

## Availability

The API and source adapters are implemented but **inactive**. The normal
runtime returns `503 prototype_closure_not_active`. A local test with an
injected service does not prove live owner acceptance or permission to mutate
Studio. Security's implementation review is `approved-with-findings`, not
activation approval. Owner evidence adapters, a dedicated repository-scoped
identity, composed conformance, final Security review, and Platform
commissioning remain separate gates.

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

- `apply-delivery` needs an accepted baseline and an owner-accepted Delivery
  target. It moves Studio to `graduating` and project phase to
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
