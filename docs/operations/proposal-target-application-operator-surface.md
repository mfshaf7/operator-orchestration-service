# Proposal Target Application Operator Surface

This is the primary OOS operator surface for applying one accepted Workspace
Proposal routed to `prototype` into a target-owned Workspace Prototype Studio
capture. The workflow coordinates an exact reviewed Git change, verifies the
human-reviewed merge and owner bytes, then records the Studio receipt and
target backlink on the canonical Proposal.

The capability is source-complete but runtime-inactive until the Security and
Platform children of Delivery Epic 1203 approve and commission the exact
revision. A prepared or merged Studio branch alone is not a completed Proposal
application; success requires the final Proposal acknowledgement.

## API Sequence

1. `POST /v1/proposal-target-applications/preparations` with one `proposal_id`
   and `prototype_id`. OOS reads the current Proposal and Prototype Studio
   authority without mutation. An unresolved repository gate stops here.
2. `POST /v1/proposal-target-applications` with the exact returned Proposal
   and target bindings plus operator approval, session, execution,
   correlation, and idempotency identities.
3. `POST /v1/proposal-target-applications/{application_id}/continue` to prepare
   the two bounded Studio capture files and open or reconcile the deterministic
   review. The returned `review-required` state names the exact review.
4. After the human identity approves and merges that exact head, call
   `continue` again. OOS verifies checks, ancestry, merged bytes, Studio
   readback, and target receipt before mutating the Proposal handoff to
   `applied`.
5. `GET /v1/proposal-target-applications/{application_id}` returns the current
   caller-bound projection for refresh and recovery.

`cancel` closes an unmerged review. If a merge won the race, cancellation
reconciles and completes the application instead of reporting false
cancellation. A retained prepared branch is reported explicitly for cleanup.

## Boundaries And Recovery

- Prototype Studio exclusively owns the capture record and target receipt.
- OOS owns orchestration state, GitHub review coordination, the final Proposal
  acknowledgement, and the Console-facing workflow projection.
- Repository creation remains owned by Repository Operation; this workflow
  only consumes its resolved Proposal gate.
- The capture remains `exploring` and `captured`. It does not run Prototype
  Landing, update `prototypes.yaml`, activate runtime, or mark the Proposal
  implemented.
- Exact replay returns the existing application. Conflicting application or
  idempotency identities fail closed.
- Transport and dependency failures retain the last durable phase. Retry the
  same `continue`; do not submit replacement evidence.

The synchronized target-owner contract is pinned by
`contracts/proposal-target-application/manifest.json`. Validate it with:

```bash
npm run validate:proposal-target-application-contracts
```
