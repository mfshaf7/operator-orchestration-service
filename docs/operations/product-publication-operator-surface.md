# Product Publication Operator Surface

## Purpose

Use this workflow to record an operator-approved, readiness-backed decision to
list, update, unlist, or archive a product in a governed portfolio projection.
OOS owns the journal and terminal receipt. Workspace Governance owns the
contract, the product repo owns its lifecycle evidence, WGCF owns readiness,
Security owns acceptance, and the Console only submits intent and renders the
result.

Security `#1271` approved the existing `internal` target plus the exact
`unpublish`, `archive`, and `restore` path through `unlisted` and `archived`.
The OOS source manifest binds that decision and admits only `internal`,
`unlisted`, and `archived`; `client` and `public` remain denied. Platform
`#1273` must commission the exact activated source in the loopback
`dev-integration` profile before live use. Source activation is not operating
acceptance.

## API

| Action | Route | Result |
| --- | --- | --- |
| Prepare | `GET /v1/product-publications/products/{product_id}/preparation` | Read-only committed owner references, caller-owned current state and up to 20 recent requests. No readiness evaluation, source write or publication. |
| Submit or replay | `POST /v1/product-publications` | Exact WGCF readback, publication packet, and immutable terminal OOS receipt. |
| Read | `GET /v1/product-publications/{request_id}` | Caller-owned receipt plus the versioned lifecycle-maintenance projection and exact next action. |

Submit requires caller-specific `x-oos-caller-id` and
`x-oos-caller-secret` credentials plus `x-oos-operator-id`. The operator must
match the commissioned caller/operator binding.

## Product selection and preparation

Preparation uses the same authenticated caller and explicit operator binding as
publication submission. WGCF resolves one registered product's typed publication manifest from existing trusted owner source mounts;
OOS composes its current receipt and recent journal requests from one store
snapshot. The response expires after two minutes. Missing/ambiguous owner
information blocks preparation without inventing a manifest or listing state.
Unavailable journal reads fail closed rather than implying version zero. If fresh
source cannot be read but a caller-owned journal exists, OOS returns only the
known receipt/recent requests with source unavailable, null source authority and
no available publication actions. Original results stay inspectable independently
of current owner-source health. An unknown product with no journal does not get
an invented initial state on a source failure.

`prepared` means the input references were resolved, not that publication was
approved. The existing submit path rereads owner evidence and checks current
publication version, Security scope, readiness and explicit operator decision.
Other callers cannot inspect the product's private publication journal. Browser
inputs contain product identity, intended action and reason; paths, revisions,
digests and prior receipt are prepared by the owners.

This additive source extension requires exact-source Security/Platform review
and commissioning before live operating acceptance. Existing activation and
allowed target postures are unchanged.

## Engineering protocol



1. Commit the product source snapshot named by `owner_revision`.
2. Commit the owner manifest at a later `manifest_revision`; that commit must
   descend from the product source snapshot.
3. Submit one command containing both revisions, the exact committed manifest
   digest, current publication state, target tuple, operator decision, and
   exact Security decision reference.
4. OOS obtains and rereads WGCF readiness. It returns `applied` only when the
   evidence is current and ready. `stale` or `blocked` readiness returns a
   terminal `rejected` receipt and does not advance the version.
5. Read the OOS receipt. After Console `#1256` lands, refresh the Console's
   authoritative projection from this same API.

For an update, unpublish, or archive command, use the latest OOS receipt ID,
digest, version, and posture. Do not reconstruct those values from Console
display state.

The response keeps five facts separate: canonical lifecycle state, publication
posture, owner route, evidence findings/freshness, and operational health.
Operational health remains `not-projected` until Platform child `#1269`
provides its independent source. The bounded history is ordered by publication
version and preserves exact Workspace Inventory lifecycle references for v2
events.

Do not submit schema-v2 `archive` or `restore` until Platform `#1273` reports
the exact `#1272` source revision as commissioned. The source gate admits both
actions, but a runtime carrying the prior Security decision must fail startup
rather than silently broaden access. A successful restore returns the product
to `unlisted` only; it does not restore runtime, release, access, or Security
acceptance.

The required maintenance order is:

1. commit fresh active/`internal` owner evidence and unpublish to `unlisted`;
2. retire through Workspace Registry;
3. commit fresh schema-v2 retired/`unlisted` evidence and archive;
4. restore through Workspace Registry;
5. commit fresh schema-v2 active/`unlisted` restoration evidence and restore
   publication from `archived` to `unlisted`;
6. independently publish back to `internal` when restoring the original
   baseline, then commit fresh final active/`internal` owner evidence; and
7. verify Registry, publication, owner manifest, Console, OOS, WGCF, and
   Platform readback agree.

Never copy `manifest_source` from a prior command. Each boundary requires a
current reviewed owner-manifest commit. An interrupted sequence resumes from
authoritative Registry and Product Publication readback at the last durable
state; it never uses a direct compensating mutation.

## Recovery

- Exact replay is safe and returns the original receipt.
- `idempotency_conflict` means an identity was reused for changed content;
  create a new request identity after correcting the command.
- `publication_version_conflict` means the prior receipt or posture is stale;
  read the current request chain and submit a new command against it.
- `readiness_expired` or `readiness_mismatch` requires fresh WGCF evidence;
  never bypass the readback or replace it with a copied payload.
- Storage integrity or lock failure is a hard stop. Restore the journal; do
  not manufacture a replacement receipt.
- `lifecycle_maintenance_inactive` means the selected source still carries the
  inactive gate or a deliberately narrowed service instance; do not bypass it.
- An active/`unlisted`, retired/`unlisted`, retired/`archived`, or
  active/`archived` interruption is recoverable. Reread both authorities and
  continue the ordered sequence from the next valid owner action.

## Runtime Configuration

After Security approval and both owner-source activations, Platform runtime
construction needs:

- `OOS_RUNTIME_PROFILE=dev-integration`
- `OOS_PRODUCT_PUBLICATION_ENABLED=true`
- `OOS_PRODUCT_PUBLICATION_STATE_ROOT`
- `OOS_PRODUCT_PUBLICATION_CALLER_OPERATOR_BINDINGS_JSON`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_URI`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_DIGEST`
- `OOS_PRODUCT_PUBLICATION_SECURITY_DECISION_REVISION`
- `WGCF_PRODUCT_PUBLICATION_BASE_URL`
- `WGCF_PRODUCT_PUBLICATION_CALLER_ID`
- `WGCF_PRODUCT_PUBLICATION_CALLER_SECRET`
- `WGCF_PRODUCT_PUBLICATION_IMPLEMENTATION_REF`
- `WGCF_PRODUCT_PUBLICATION_SERVICE_IDENTITY_REF`

Configuration alone does not override the reviewed profile, source scope, or
Security decision binding. Missing or partial configuration still fails closed.
The three Security values are one exact reviewed decision binding; OOS rejects
a runtime whose configured URI, SHA-256 digest, or full Git revision differs
from the source manifest. OOS then rejects a command carrying different
Security evidence before it contacts WGCF or writes journal state.

The lifecycle-maintenance source scope admits exactly `unlisted`, `internal`,
and `archived`, with `archive` and `restore` as the only maintenance actions.
The fixed action bindings still constrain every source/target pair. OOS rejects
`client`, `public`, wrong-order, contradictory, stale, or unapproved input
before WGCF access or journal mutation. Expanding that set requires another
reviewed source revision and Security decision; Platform configuration cannot
broaden it. The owner-manifest source path and receipt are evidence bindings,
not access grants; access remains enforced by the product owner.
