# Delivery Change Control v1

Delivery Change Control is the OOS-owned workflow contract for modifying an
active Delivery package after execution has begun. It gives the Governance
Operations Console one reviewed command path without moving canonical Delivery,
Repository, Catalog, or source authority into the browser.

## Operator path

1. Read `GET /v1/delivery-initiatives/{delivery_id}/change-control`.
2. Prepare one typed command against the returned `source_revision`.
3. Record the accountable operator's explicit acceptance.
4. Submit `POST /v1/delivery-initiatives/{delivery_id}/change-control/commands`.
5. Use the returned status, receipt, before/after revisions, rollback
   disposition, and `next_action`. Refresh the projection before preparing the
   next command.

Commands are single-mutation units. A Console review may sequence several
commands, but it must refresh canonical truth between them. OOS does not claim
that an entire edited tree is one atomic transaction.

## Authority boundaries

- OOS validates commands, source revisions, acceptance, replay, receipts, and
  exact next actions.
- OpenProject remains canonical Delivery work-state truth.
- Existing Delivery mutation services continue to own work-item semantics.
- Repository operation owns repository creation and lifecycle.
- Catalog owns admission and canonical repository-value linking.
- Source executors own source-tree mutation and Git truth.
- Console owns interaction and presentation only.

`request_repository` records a routed result and points to Repository operation;
it does not create a repository. `link_repository` first uses the existing
Catalog mutation contract and then updates the Delivery work item. If Catalog
succeeds but the Delivery update fails, the result is `partial_failure` with an
explicit reconciliation action. Partial success is never projected as done.

## Revisions, replay, and rollback

The source revision is a canonical digest of the initiative's semantic
execution tree and dependency relations. Activity comments and presentation
state do not change it. A stale command fails before mutation.

Each accepted command has one durable ID and an OpenProject-backed event chain:
an accepted-intent event followed by one terminal-result event. An identical
retry returns the terminal receipt; a reused ID with a different payload fails
as a conflict.

OOS records command acceptance before invoking a mutation authority. If the
process stops before a terminal event is recorded, replay fails closed with
`delivery_change_reconciliation_required`; the operator inspects canonical
package truth instead of risking a duplicate write.

Rollback is a new reviewed compensating command against current source truth.
OOS does not automatically invert a prior change unless an exact inverse is
proven. The initial `rollback_change` operation therefore returns a durable
`rejected` result and an explicit compensating-command action rather than
pretending rollback occurred.

## Contract sources

Canonical schemas and ownership guards live in `contracts/delivery-change/`.
The OpenAPI projection is generated into `docs/api/openapi.json` by
`npm run sync:delivery-change-openapi-schemas`.
