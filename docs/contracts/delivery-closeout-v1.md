# Delivery Closeout v1

Delivery Closeout is the OOS-owned acceptance, terminal mutation, outcome, and
history contract for one Delivery initiative. It gives the Governance
Operations Console one normal closeout path without moving ART, source,
Workspace Intake, product, release, or Portfolio authority into the browser.

## Operator Path

1. Read `GET /v1/delivery-initiatives/{delivery_id}/closeout`.
2. Resolve every readiness reason until `projection_state` is `ready`.
3. Prepare one command against the returned `source_revision`.
4. Record the accountable operator's explicit acceptance and bounded evidence.
5. Submit `POST /v1/delivery-initiatives/{delivery_id}/closeout/commands`.
6. Use the returned status, outcome ref, receipt, and exact `next_action`.

The lower-level `closeout-readiness` and `close` routes remain available for
contract verification and recovery. The versioned closeout family is the
normal Console adapter because it adds revision checks, acceptance, replay,
outcome classification, and durable history around those proven primitives.

## Authority Boundaries

- OOS owns closeout semantics, normalization, revision checks, accepted intent,
  replay, receipts, outcome history, and exact next action.
- OpenProject remains canonical Delivery and ART truth.
- The existing guided initiative-close service owns the terminal ART mutation.
- Console owns interaction and presentation only.
- Workspace Governance owns entrant classification and active inventory.
- Product owners own product outcome packets.
- Platform and Portfolio retain independent release and publication authority.

The typed impact is `none`, `workspace_entrant`, or
`existing_product_change`. It is evidence emitted by closeout, not proof that a
downstream authority accepted or applied anything.

## Replay And Recovery

Each command records an accepted-intent event before terminal mutation and one
terminal event afterward. An identical retry returns the terminal result. A
reused command id with another payload fails as a conflict.

Replay identity covers the Delivery id, expected source revision, accountable
operator, accepted decision and note, and closeout operation. The
server-issued `accepted_at` observation is deliberately excluded so a retry
after a lost response does not become a different semantic command. Events
written before this semantic identity marker fail closed to explicit
reconciliation; OOS does not guess that an older full-command digest matches.

Closeout mutation currently requires the existing single-writer OOS runtime
posture. Commands for the same Delivery initiative are serialized inside that
writer and then reconciled against durable OpenProject events. Supporting
multiple concurrent writer replicas would require a shared lease or an atomic
event-append contract and is not claimed by this version.

If accepted intent exists without terminal evidence, OOS returns
`delivery_closeout_reconciliation_required`. It never repeats the close
blindly. If Delivery closes but its source Proposal cannot be reconciled, the
result is `partial_failure`; Delivery completion remains true and the next
action identifies source reconciliation.

## Contract Sources

Canonical schemas and ownership guards live in `contracts/delivery-closeout/`.
The OpenAPI projection is generated into `docs/api/openapi.json` by
`npm run sync:delivery-closeout-openapi-schemas`.
