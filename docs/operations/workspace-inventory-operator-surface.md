# Workspace Inventory Operations

Workspace Inventory Promotion moves one currently admitted Workspace Intake
entry into exactly one active repository, product, or component inventory. It
does not classify a new entrant, change an existing active record, activate a
runtime, or grant release authority.

## Availability

The promotion, lifecycle, and read-only registry workflows are pinned to the
reviewed Workspace Governance authority and WGCF readiness manifests in the
existing #1206/#1207 operation chain. Routine availability comes from the exact
activated Console/OOS/WGCF, Security decision, Platform composition and composed
operating evidence, not this document or source readiness. This complete
registration extension requires its own exact composed acceptance before use;
it does not deactivate or recertify a previously accepted composition.

The same closed runtime boundary applies to promotion and lifecycle changes.
Source readiness, a prepared review, or a WGCF receipt does not activate normal
mutation and cannot be projected as operating-ready.

The Governance Operations Console is the normal operator client. OOS owns the
durable workflow and returns exact next actions. Workspace Governance owns the
canonical merged YAML, WGCF owns non-mutating readiness, Platform owns the
exact-repository provider identity, and a human owns review and merge.

## Promotion Procedure

1. GET `/v1/workspace-inventory/registry` to read the exact committed active
   records and promotion candidates derived from admitted Workspace Intake
   entries. This caller-authenticated projection is deterministic for one
   authority revision, creates no workflow state, and performs no canonical
   mutation.
2. POST one `repo`, `product`, or `component` target to
   `/v1/workspace-inventory/preparations`. Retain the returned authority
   revision, admitted intake reference, expected state, and canonical paths.
   Preparation reads committed authority only; it creates no workflow state.
3. Review and bind a Workspace Inventory request to that exact preparation.
   The target must still be admitted and absent from active inventory.
4. POST the immutable request, authority revision, session reference, and
   execution reference to `/v1/workspace-inventory/promotions`. HTTP 202 proves
   durable acknowledgement only.
5. POST `{}` to
   `/v1/workspace-inventory/promotions/{request_id}/continue`. OOS obtains the
   durable WGCF readiness receipt and, only when ready, prepares the owner
   mutation and opens or recovers one review.
6. At `review-required`, inspect the returned review URL. The review must
   contain the admitted intake removal, one matching active inventory addition
   and the exact owner-derived registration companions described below.
   Complete full owner validation, exact-head validation and human review, then
   merge through the provider. OOS has no merge endpoint.
7. Continue again. OOS proves the reviewed head is in canonical `main`, reads
   the merged authority, and checks the active record against the approved
   mutation. Only `succeeded` with a `merged-authority` receipt proves active
   inventory.

GET `/v1/workspace-inventory/promotions/{request_id}` reads caller-owned
progress without advancing it. The API and examples are in
[OpenAPI](../api/openapi.json).

### Original Request Discovery

After an interrupted acknowledgement, browser restart or closed dialog, read
`GET /v1/workspace-inventory/promotions?target_kind=<kind>&target_name=<name>`.
Lifecycle uses the same selector at `/v1/workspace-inventory/lifecycle/requests`.
Each authenticated caller sees only its selected target and workflow family,
newest first, at most25 safe locators and32KiB of row data. The opaque
`next_cursor` belongs to that caller, family and target. The journal revision
and pending count cover every matching request, including later pages.

These reads do not initialize absent storage, prepare source, evaluate readiness
or advance work. Corrupt/unavailable retained state is an error, never empty
history. Reopen the returned exact request ID through its existing GET, then
explicitly continue/check review or cancel that original. Request locators are
opaque owner-returned identifiers, not authorization or new command templates.
Do not mint another promotion after a lost acknowledgement. Console must finish
fresh journal discovery and direct pending work to its original request before
offering a new explicit promotion or lifecycle review. Generic OOS idempotency
and concurrency semantics remain unchanged; this is no global single-request
policy or new canonical authority.

## States And Recovery

| State or condition | Operator action |
| --- | --- |
| `accepted`, `evaluating`, or `preparing` | Continue the same request. Restart does not require reconstruction. |
| `review-required` | Review and merge the exact returned head, continue, or cancel before merge. |
| `blocked` or `rejected` | Correct the reported source or readiness issue and submit a new immutable request. |
| `stale` | Prepare again and submit a new request against current authority. |
| Dependency unavailable | Restore the bounded dependency, then continue the same request. |
| Lost acknowledgement | Resubmit the identical command; OOS returns the original request. |
| Altered or conflicting review | Do not force-push. Cancel when still unmerged, then prepare a new request. |
| `cancelled` | Terminal. Evidence remains; reuse requires a new request identity. |
| `succeeded` | Terminal. Use a later lifecycle workflow for further changes. |

Cancellation is POST `{}` to
`/v1/workspace-inventory/promotions/{request_id}/cancel`. If the reviewed
change merged while cancellation raced, OOS records the merged result rather
than claiming cancellation.

## Lifecycle Procedure

Lifecycle actions update one existing inventory record and append one immutable
history event. They never create or delete inventory identity. Supported actions
are `update`, `suspend`, `restore`, and `retire`; product maturity remains
independent from posture.

1. POST the target kind and name to
   `/v1/workspace-inventory/lifecycle/preparations`. Retain the exact authority
   revision, inventory and history digests, record version and digest, posture,
   current record, and latest history event reference. This is read-only.
2. Review the intended lifecycle action. `update` supplies a complete validated
   domain value without the record envelope. `restore` binds the returned latest
   suspension or retirement event. Every action supplies a reason, impact
   acknowledgements, and approval references.
3. POST the immutable command to
   `/v1/workspace-inventory/lifecycle/requests`. HTTP 202 proves only durable OOS
   acknowledgement.
4. POST `{}` to
   `/v1/workspace-inventory/lifecycle/requests/{request_id}/continue`. OOS reads
   durable WGCF readiness, prepares the selected inventory, append-only history
   and exact owner-derived registration companions, and opens or recovers one review.
5. At `review-required`, inspect and approve the exact head, then merge through
   the repository provider. OOS cannot merge it.
6. Continue again. OOS proves the exact reviewed head is canonical, reconstructs
   the merged inventory and history, and compares the record and history event
   to the prepared artifacts. Only `succeeded` with `canonical_mutation: true`
   proves completion.

GET `/v1/workspace-inventory/lifecycle/requests/{request_id}` reads caller-owned
progress. POST `{}` to the corresponding `/cancel` route closes an unmerged
review; a concurrent merge is reconciled as success.

## Runtime Boundary

The source adapter invokes only the pinned Workspace Governance owner command
inside a temporary Git checkout. Promotion binds its Intake/Inventory pair;
lifecycle binds its Inventory/history pair. Both include only changed outputs
from the existing generated metadata family. A qualified source-only repository
also carries its exact minimal repo rule, bounded data-only routing index and
conservative context declarations. Instructions outside that index, existing
control/custom rules and raw-context policy are not writable routine data.
Provider custody, admitted class/Security classification, real owner purpose
and source-only boundaries remain explicit. No CI framework, Security decision,
context parity, raw projection or runtime authority is invented by promotion.

The private owner-produced file map binds the complete preparation digest.
OOS compares it with actual changed and new source files; the provider creates
one Git tree and verifies every path, regular file mode and exact byte at review
and merged readback. Missing companions cannot become success. Retained older
pair-only preparations keep their original recovery boundary, not new authority.
Neither route writes canonical `main` directly. Unsupported control/Security
owner registrations and core-owner posture changes return readiness findings
requiring explicit reviewed owner source rather than failing after mutation.

The registry projection uses the same isolated exact-revision read boundary.
It flattens validated active records and derives candidates only from admitted
intake records whose typed active value validates against the target inventory.
It cannot invent an owner, approval, lineage, or active identity, and an
identity cannot appear in both candidate and active-record sets.

Provider access requires a Platform-mounted GitHub installation token limited
to the exact Workspace Governance repository. PATs, ambient `gh` credentials,
redirects, broader repository selection, and unbounded responses are denied.
Tokens never enter workflow state, review text, logs, or receipts.

OOS persists coordination in its existing single-host durable state volume
using locks, atomic replacement, integrity digests, and fsync. Workspace
Governance Git remains canonical; this workflow does not introduce a second
workspace database or claim multi-host storage safety.

## Verification

```bash
node --test test/workspace-inventory-*.test.js
npm run validate:workspace-inventory-openapi
npm run validate:api-docs
npm run test:workspace-inventory-source -- --authority-root <committed-workspace-governance-checkout>
```

The contract tests also reject stale authority, stale WGCF custody, and
premature runtime activation. The source tests use temporary repositories and a simulated provider. They
prove complete bounded owner-file mutation, review-head denial, restart recovery, reviewed
merge readback, and replay-stable evidence without changing a live repository.
