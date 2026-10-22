# Repository Owner Bootstrap

## Availability and boundary

This is staged implementation for the existing local `dev-integration`
composition, not current operational acceptance. The Console adapter is staged
in its existing Repository Intake surface, with isolated browser/identity and
native OOS protocol proof. Exact-source Security review, coherent Platform
commissioning and the complete normal operating witness remain required. An unavailable dependency
returns a named blocker; no fixture, Codex-authored app or CLI-only fallback
substitutes for the normal workflow.

OOS owns this bounded workflow. Workspace Governance owns classification and
Inventory, Platform owns credentials, Gary owns implementation/publication,
and the accountable human owns review/merge. Existing Intake/source-work
configuration and exact accepted composition are reused, without another
enable manifest or model profile. Bootstrap never invokes a model.

The operator's new request, approval and source session are caller-bound.
Repository Custody remains shared canonical workspace evidence behind its
authenticated API, not private caller-owned historical state. Bootstrap must
verify its successful receipt, exact provider identity and selected owner;
it does not adopt, reopen or mutate the terminal custody request.

The current source adapter qualifies only public synthetic repositories on
`main`. Private/client source is explicitly unqualified; no visibility change
or ambient credential fallback occurs. Current proposed or admitted source-only Intake
and absence from active/retired Inventory are mandatory before checkout or
credential issuance. Ordinary Delivery/Prototype credentials still deny this
state. Control-plane or Security-bound registration needs its real review,
not this source-only shortcut.

The host's proposed-owner and ordinary-source readers use the same fresh
Platform-owned record checkpoint. A bundled contract revision is a required
ancestor of Platform's current accepted baseline, not an exact replacement for
it. That approved baseline must be an ancestor of the exact clean cached main;
expiry, changed HEAD/ref or unrelated/older authority still blocks. Do not edit
the checkpoint or repin contract bundles to bypass a missing Platform refresh.

## Prepare and inspect

1. Complete the existing canonical custody and proposed Intake decisions.
2. `POST /v1/repository-owner-bootstrap/preparations` with the exact owner key,
   custody request id, applicable owner evidence profile, actual project marker
   paths, explicit optional-CI choice and operator decision reference. The
   [OpenAPI contract](../api/openapi.json) defines the closed input fields.
   Select real project tests/validations and required fidelity; do not copy
   documentation examples or substitute bootstrap tests for application proof.
3. Inspect the finite plan and `preparation_digest`. This read-only preparation
   creates no request journal, checkout, token, admission or runtime. Existing
   README bytes are preserved; independent controls are not overwritten.
   The optional CI validates pull requests at their exact base/head and pushes
   to the qualified `main` branch at their actual before/head. It does not run
   on first pushes of review branches or tags, whose prior ref is absent.
   Control-only bootstrap is explicitly not application evidence; once the
   selected application markers exist, the real owner profile must pass.
4. Explicitly create one request at `POST .../requests`, carrying a stable
   `request_id`, the same preparation input, exact reviewed preparation digest,
   request time and nullable workflow permission approval reference. OOS
   rereads authority/source and rejects a stale preparation before effects.
   A workflow file additionally requires its separate actual App/installation
   grant and explicit approval; ordinary bootstrap without CI retains four
   permissions. No App or installation administration occurs here.

Use `GET .../requests?owner_repo=<key>` for bounded metadata and its separately
returned original pending request. Even an off-page pending request remains
recoverable. Use `GET .../requests/{request_id}` to resume that exact identity;
do not generate a replacement request because an acknowledgement was lost.
Reads and list never mint/renew, create source, or load historical source
payloads into the metadata list. URL-encode request ids as one path segment.

## Existing owner controls

When current regular guidance, review controls and a valid fetched-base owner
profile already exist, preparation returns `existing_owner_controls`, no source plan and
no source session. Preserve those controls. A different requested profile is
rejected rather than silently replacing existing owner policy.

An admitted owner absent from active/retired Inventory may use this same
workflow for missing control repair; ordinary source remains denied. The finite
plan creates absent CODEOWNERS and PR review template and appends missing
`## Review guidelines` to the exact original AGENTS bytes, with a replacement
digest. Existing profile, README, application source, Makefile, schema, scripts
and workflow bytes are preserved. An existing incomplete review section or PR
template blocks for explicit owner review rather than being overwritten.
This is not a general migration or application-authoring permission.

Optional bootstrap CI remains explicit. Active workspace registration separately
requires the existing PR-control policy, including a pull-request validation
workflow. Omitting CI at bootstrap does not waive that later promotion gate.

`POST .../requests/{request_id}/existing-checkout` binds the current revision,
command id and time. It materializes or verifies only the exact public
canonical checkout and profile, using current proposed/custody authority.
No Gary identity, credential, extra review branch or dummy PR is created.
Existing clean main refreshes only by fast-forward; dirty or unique source
is preserved with a visible blocker. Repeated inspection can reuse the durable
checkout. This proves owner controls, not app readiness or Inventory admission.

## Trusted control source review

1. For a real scaffold plan, prepare and explicitly approve its separate
   `repository-bootstrap` / `trusted-owner-bootstrap` intent through the
   existing [Platform operation surface](platform-operation-adapter.md).
   Select this real bootstrap request, not an invented ART or Prototype id.
2. `POST .../requests/{request_id}/session` with its approved source-intent
   reference and immutable command. Current proposed authority is rechecked
   (proposed or admitted, never active/retired Inventory) after provider I/O and
   before target checkout. The canonical owner checkout
   remains durable; only its review worktree/branches are disposable resources.
3. `GET .../draft` returns the exact trusted control change set. Render it as
   inert text. `POST .../accept` binds the current source revision and exact
   `accepted_change_set_digest`. It uses the existing bounded apply/recovery
   kernel and Gary Git author, not model-generated owner controls.
4. For uncertain apply, `POST .../recover` reconciles the retained change set.
   Native committed-source replay and durable pre-effect resource provenance
   prevent duplicate commits and lost-ack cleanup ambiguity. Unknown or dirty
   source is never deleted to manufacture recovery.
5. `POST .../publish` runs native validation on an isolated snapshot of the
   exact committed control data using current trusted validator bytes and
   publishes through Gary's existing
   provider adapter. Existing project code, shadow imports and app commands
   and preserved independent validation commands are not executed by this
   bootstrap host check. Every committed path, byte,
   mode, template, base and source identity is rechecked before push.
6. `POST .../review`, then `POST .../merge`, bind the retained PR URL and head.
   Human review is separate from accepting source bytes and from Gary's
   publication identity. Existing exact-head approval and merge controls apply.
7. `POST .../close` confirms that same provider merge, exact canonical owner
   readback, credential revocation and proven owned resource retirement.
   Canonical checkout stays in place. Dirty, unique, pre-existing or unproven
   resources block closure rather than being discarded.

Source controls carry schema version, command id, expected current revision,
request time and the exact PR URL/head; publish uses a null expected PR.
Inspect retained original control commands after interruption and reconcile
those exact commands. New ids do not authorize duplicate uncertain effects.
The existing Platform revoke action remains the immediate source-access stop.
Before source is committed, `POST .../cancel-unapplied` binds the current
revision and an explicit reason. Prepared authorization references are retained
before credentials can be approved. Cancellation permanently stops unissued
preparations without claiming provider revocation, revokes issued/uncertain
scopes through Platform, and retires only proven pristine source resources.
Unknown cancellation reuses its original retained command. Committed, dirty,
remote or uncertain source cannot be discarded as an unapplied draft; recover
or review it instead. The normal Console and full recovery operating witness
are still required before this becomes an accepted operational workflow.

## Next authority and blockers

Successful bootstrap/checkout proves only reviewed owner controls and source
readiness. The next steps are the existing explicit admitted Intake and active
Inventory workflows, with actual owner profile checks before promotion.
Application work then uses the ordinary Delivery source route. No bootstrap
receipt is application acceptance, product publication or runtime activation.

Remove missing current authority/permission through its named owner. A changed
base or profile requires fresh inspection, not a validation waiver. Preserve
unknown effects and dirty/unique source; recover the original request. Risk
acceptance or deferral must remain an explicit justified owner decision and
cannot fabricate a passing receipt or silently grant broader source authority.
