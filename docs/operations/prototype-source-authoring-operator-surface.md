# Prototype source authoring

This is the primary OOS procedure for bounded app/design authoring of an actual
canonical Studio Prototype. It is not Prototype Landing, baseline approval,
Delivery work, graduation or product runtime activation.

## Availability and ownership

Source preparation is in progress. Platform's corresponding model profile is
suspended. Existing source-work configuration is not acceptance of that new
purpose. Console controls and
fresh exact composed Security acceptance/commissioning remain required before
normal availability. Tests or an existing route are not operating acceptance.

OOS owns workflow state, actor binding, canonical eligibility, private draft
custody, exact acceptance and recovery. Studio owns registry/source/design
scope and native validation. CGG admits/redacts/budgets context only. Platform
owns the existing isolated executor composition, source credential custody and
governed model gateway. Gary authors/publishes; the accountable human reviews
and merges. No new service, model, provider route or permission grant is needed.

This first adapter admits explicit incubation-repo custody, synthetic/mock data
and internal/operator-review visibility. It does not qualify private-client or
dedicated-repository authoring. Unrelated registry commits do not invalidate an
active unchanged source session, but material source/design/custody changes do.

## Normal API-first sequence

Use authenticated caller-specific credentials. Writes retain the existing
Console mutation authority and map the caller to its configured accountable
operator. The browser never supplies repository/provider coordinates, a source
root, branch, fetched base, credential or arbitrary executable command.

1. Read `GET /v1/prototypes` and select the actual canonical Prototype. Submit
   `POST /v1/prototype-source-requests` with a stable `prototype-source-request:`
   id, actual `prototype_id`, exact `expected_registry_revision` and
   `expected_source_revision`, bounded objective and `requested_at`. This
   adapter currently selects both revisions from the same Studio snapshot;
   the contract preserves them separately. Preparation creates no Git resource,
   credential or model invocation.
2. Follow [Platform source authorization](platform-operation-adapter.md).
   Prepare the selector `{kind: "prototype", prototype_id, source_request_id}`
   with `decision: null`. Inspect and explicitly approve its immutable exact
   ordinary-source intent; submit the issue command through Platform Operations.
   OOS derives scope before any source session exists. Do not invent a Delivery
   item, use a Landing credential or repeat engineering credential delivery.
3. `POST /v1/prototype-source-requests/{request_id}/session` with the retained
   `source_intent_ref`, schema version, stable command id and request time.
   OOS records the actual private session, binds approved authorization and
   prepares its owned review worktree under a live lease. Missing approval may
   leave recoverable private metadata but cannot create source resources.
4. `POST .../generate` with the exact current realization revision, stable
   generation request/execution ids, budget, time, source intent and `retry_of`
   (`null` initially). OOS captures only selected app/design files, retains the
   exact CGG request before dispatch and sends only its model-safe projection
   through `prototype-source-authoring-v1`. The existing local model drafts a
   bounded change set; it cannot select tools, owner controls, profiles, CI,
   credentials, approval, publication, merge or activation.
5. Inspect `GET .../draft` as inert source text. `POST .../accept` carries
   `{command, source_intent_ref}`; the command binds the exact current revision
   and `accepted_change_set_digest`. Only this accepted digest can commit as
   Gary. No source is applied by generation or a read.
6. `POST .../publish` carries `{command, source_intent_ref}` and
   `command.expected_pull_request: null`. It runs the selected Studio native
   `make validate` against a fetched `origin/main`, publishes through the
   existing Gary adapter, and retains this exact PR/head. This is Studio's
   selected check, not a requirement that every future project use Actions.
7. `POST .../review`, then `POST .../merge`, each carries `{command}` and the
   exact retained PR URL/head. These are explicit human-authority actions,
   separate from model-draft acceptance. The executor rechecks the exact head,
   native owner validation, GitHub Actions `validate` result and configured
   human identity. Merge additionally requires exact-head human approval.
8. `POST .../close` carries the same bounded human-control shape. It confirms
   merged readback, stops/revokes only the owned source intent, proves Git
   ancestry or exact squash-change equivalence, retires only owned unchanged
   resources and rereads absence. Unknown, dirty, unique, pre-existing or
   retained resources block completion; they are never silently discarded.

Delivery controls use schema version, command id, current expected revision,
request time and `expected_pull_request` (`{url, head_commit}` except publish).
The [OpenAPI contract](../api/openapi.json) owns the complete closed DTOs and
examples. Encode the actual request id as one URL segment. All bodies and
artifacts are bounded; models receive neither tokens nor private raw context.

## Trusted Preview preparation

For deterministic owner metadata instead of model app/design drafting, include
the closed optional `owner_preparation` in the original source request:
`kind: preview-profile`, reviewed `port` (1024–65535), `support_profile`
(`interactive` or `unattended`), `runtime_activation`, `ttl_seconds`
(300–86400) and `decision_ref` (`record://...`). This is bound into the original
source-start authorization; it cannot be added or changed after approval.
The normal `/generate` action prepares a draft through the commissioned Studio
`plan-preview` command on the exact immutable source snapshot, without context
projection or model invocation. Its retained generation DTO remains unchanged;
the token budget has no effect on this non-model operation.

The executor derives the sole profile path and independently re-renders the
native plan before apply/recovery and native validation. Caller-substituted
contents, sibling profiles and arbitrary controls are denied. Existing exact
acceptance, Git replay, Gary publication, human review/merge, terminal credential
revocation and owned cleanup remain mandatory. Model app/design requests gain
no owner-control permission. The projection exposes secret-free plan/request
digests and explicitly false model-invocation/runtime-activation evidence.

An active-profile intent means the reviewed profile may later be runnable; it
does not start a process, approve a Baseline or create browser-persistence proof.
The new tuple requires exact-source Security acceptance and coherent Platform
commissioning.

### Native Delivery-packet preparation

The alternate `owner_preparation.kind: delivery-packet` carries the existing
closed packet `work`, resolved `custody`, `evidence_refs`, `rationale` and
`decision_ref`. Native work/custody definitions are reused from the admitted
Delivery packet contract, including non-source/no-repository outcomes. Caller
Baseline receipts, Git coordinates, source paths and executable commands are
not admitted. Source preparation rejects a non-Baseline Prototype before any
source identity or resource is created. Changing the canonical Baseline
invalidates the approved scope.

The owner adapter invokes Studio's existing deterministic packet emitter and
validator in a disposable exact-source checkout. It derives the actual Git
base/head/tree and accountable operator, while Studio resolves and verifies the
committed approved Baseline and digest. Only the emitted packet and its normal
registry backlink become the inert source draft. The executor re-renders them
before apply/recovery and validates exact contents before source delivery.
There is no second packet producer, owner journal or self-referential future
commit. An owner prerequisite rejection is retained as a bounded named error;
it is not claimed as another product defect or a successful handoff.

Use the same acceptance, native validation, Gary publication, human review,
merge and cleanup sequence. After reviewed merge, recover the canonical packet
and apply it through the existing Prototype-to-Delivery API. Packet preparation
does not create Delivery work, approve target custody, admit a source owner,
import product source, graduate a Prototype or activate a runtime.

## Inspect, list, recovery and blockers

`GET /v1/prototype-source-requests?limit=100` is bounded metadata only; listing
does not load draft files or history payloads. `GET .../{request_id}` recovers
state, realization revision, exact next action and retained source-control
identifiers after a browser or broker restart. The detail projection retains
`source_request` and the attempt's original generation `request`, including its
time, execution identity and expected revision. Recover those inputs rather than
reconstructing them from current timestamps. Metadata-only lists omit them.
Every visible intermediate mutation advances the canonical revision, even when
several writes occur in one clock millisecond. Reads never renew credentials.
The draft endpoint intentionally loads one caller-owned bounded source draft
for human inspection, not executable content or raw provider logs.

Reuse the original request/command ids after a lost acknowledgement. Changed
input under the same id is rejected. Interrupted generation retains its exact
capture/projection/model input; same-request recovery does not change time or
execution identity. A failed or cancelled unapplied attempt may be followed
only by an explicit new request linked to its immediate predecessor.

If apply is `applying`/`apply-unknown`, use `POST .../recover` with its current
revision and source intent. Reconcile the accepted source action; do not
generate a replacement or cancel possibly committed source. Exact successful
apply/recovery acknowledgements remain historical reads after expiry/revocation.
`POST .../cancel-attempt` cancels only an unapplied accepted/draft-ready attempt;
it does not delete a committed change, abandon a session or silently erase
resources. A source session is terminal only after the named close procedure.

Expired source scope blocks new effects. Follow the existing exact revoke and
fresh explicit successor approval path, preserving unchanged session/branch/
start digest. A verified explicit successor can resume an interrupted generation
with its original request bindings; authorization reference is not the immutable
generation objective or execution identity. Invalid state/retry requests are
rejected before credential effects. It is not automatic reapproval or a reason to create another ART
story. Pending issuance/revocation remains linked to its original operation.

Source publication/review/merge/close uncertainty stays on its retained control
identity. Retry that exact control and inspect its canonical owner readback;
the detail projection exposes the original bounded `source_delivery[action].command`
so a cold browser can recover its revision, time and exact PR/head binding.
never replace an uncertain PR or cleanup operation with a newly named effect.
No source session completes until revocation and owned cleanup are confirmed.
Disposition of an actual blocker remains with its owner: remove it, use an
approved workaround, accept a justified risk, or defer with follow-up. Do not
substitute fixture success, handcrafted app files or CLI intervention for the
missing normal capability.

## Commissioning and rollback

Platform must compose the same accepted Studio/CGG/OOS/Console/Security sources,
configure the existing isolated executor and CGG/gateway clients, private state
and caller/operator bindings, then obtain exact composed acceptance. Reuse the
existing source-realization composition and its private work-state root (the
Prototype metadata is a separate child directory), caller bindings, isolated
executor, CGG and gateway configuration. There is no second OOS activation
manifest or flag. Platform's native Prototype profile status, consumer list and
`activation_allowed` remain the purpose activation fields. Land those reviewed
changes in the existing owning units/activation chain; never treat Delivery's
active profile or a source-work configuration flag as Prototype AI authority.

Rollback disables the consumer/purpose through the accepted composition and
stops/revokes exact owned credentials. Preserve non-secret workflow history,
private drafts, source commits and PRs. A merged source receipt is not Preview,
Candidate/Baseline, Delivery handoff, graduation or real application evidence.
Those existing owner gates remain separate and visible in the Console.
