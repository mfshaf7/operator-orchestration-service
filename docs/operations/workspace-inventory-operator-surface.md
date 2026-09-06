# Workspace Inventory Promotion

Workspace Inventory Promotion moves one currently admitted Workspace Intake
entry into exactly one active repository, product, or component inventory. It
does not classify a new entrant, change an existing active record, activate a
runtime, or grant release authority.

## Availability

The workflow source and read-only registry projection are complete but routine
runtime mutation remains inactive. The pinned contract manifest has
`runtime_activation: false`; ART #1075 proves the composed behavior without
overriding the Security decision that excluded inventory promotion from the
current Workspace Intake activation. A later explicit Security and Platform
activation must replace that gate before normal promotion is available.

The Governance Operations Console is the normal operator client. OOS owns the
durable workflow and returns exact next actions. Workspace Governance owns the
canonical merged YAML, WGCF owns non-mutating readiness, Platform owns the
exact-repository provider identity, and a human owns review and merge.

## Procedure

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
   contain exactly the admitted intake removal and one matching active
   inventory addition. Complete exact-head validation and human review, then
   merge through the provider. OOS has no merge endpoint.
7. Continue again. OOS proves the reviewed head is in canonical `main`, reads
   the merged authority, and checks the active record against the approved
   mutation. Only `succeeded` with a `merged-authority` receipt proves active
   inventory.

GET `/v1/workspace-inventory/promotions/{request_id}` reads caller-owned
progress without advancing it. The API and examples are in
[OpenAPI](../api/openapi.json).

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

## Runtime Boundary

The source adapter invokes only the pinned Workspace Governance owner command
inside a temporary Git checkout. A prepared change may modify exactly
`contracts/intake-register.yaml` and the selected active inventory file. It
never writes canonical `main` directly.

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

The source test uses temporary repositories and a simulated provider. It
proves exact two-file mutation, review-head denial, restart recovery, reviewed
merge readback, and replay-stable receipts without changing a live repository.
