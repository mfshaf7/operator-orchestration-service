# Prototype Maturity

Prototype Maturity coordinates the two local incubation decisions owned by
Workspace Prototype Studio:

- Candidate Promotion moves an `exploring` Prototype to `candidate`.
- Baseline Promotion moves a `candidate` Prototype to `baseline-approved`.

OOS owns durable progression, operator-decision binding, review waits,
recovery, history, and terminal receipts. Prototype Studio remains canonical
source authority, WGCF owns readiness, and the Governance Operations Console
is a projection-only operator client. Neither transition grants Delivery,
runtime, Security, source-custody, or publication authority.

## Availability

The source implementation, isolated composed conformance path, Security review,
and WGCF readiness activation are complete. The synchronized OOS manifest
activates only this source capability for `dev-integration`. Normal
availability still requires Platform to commission the dedicated identity and
compose the exact approved runtime, followed by Console operating proof.
Prototype Landing credentials and WGCF caller secrets cannot satisfy the
Prototype Maturity configuration.

## Procedure

1. POST `prototype_id` and `transition` to
   `/v1/prototype-maturity/preparations`. Retain the exact Studio revision and
   expected lifecycle state. This read creates no workflow state and changes no
   source.
2. Build the transition-specific Request and Packet from the returned source
   state. POST them with `authority_revision`, `session_ref`, and
   `execution_ref` to `/v1/prototype-maturity/requests`. HTTP 202 proves durable
   acknowledgement only.
3. POST `{}` to
   `/v1/prototype-maturity/requests/{request_id}/continue`. OOS obtains and
   rereads exact WGCF readiness. Blocked, stale, or expired readiness produces
   no decision or source change.
4. At `decision-required`, POST one decision to
   `/v1/prototype-maturity/requests/{request_id}/decisions`. Candidate supports
   `promote-candidate`, `block-promotion`, and `route-closeout`; Baseline
   supports `approve-baseline`, `block-baseline`, and `route-closeout`. A block
   must include its issue, owner, and required fix.
5. Continue the request. A promotion prepares the bounded Studio change and
   opens or recovers one exact pull request. A block or closeout route proves
   unchanged source and ends immediately with a terminal receipt.
6. At `review-required`, validate and approve the exact pull-request head, then
   merge it. OOS has no merge endpoint and never writes `main` directly.
7. Continue again. OOS proves checks, human review, canonical merge ancestry,
   and byte-identical merged files before emitting merged readback and a
   terminal receipt.

GET `/v1/prototype-maturity/requests/{request_id}` reads caller-owned durable
progress without advancing it. Prepared file bytes and credentials are not
returned. Candidate success points to Baseline Promotion; Baseline success
points to the separate Movement Request workflow. A closeout route records
intent only; the closeout workflow owns retirement.

## Recovery

| Situation | Operator action |
| --- | --- |
| Lost submit or decision acknowledgement | Repeat the identical command; OOS returns the retained state. |
| Process or host restart | Read the request and continue from the last durable phase. |
| WGCF blocks or reports stale source | Correct the evidence and submit a fresh request against new preparation state. |
| Readiness expires before decision or source preparation | Prepare and submit a fresh request; expired readiness is not reusable. |
| Provider acknowledgement is lost | Continue; OOS verifies the retained branch or review before creating anything. |
| Review closes without merge | Submit a fresh maturity request after correcting the review outcome. |
| Operator cancels before merge | POST `{}` to the request's `/cancel` endpoint; no completion receipt is fabricated. |
| Merge races cancellation | OOS records the proven merged result. Reversal is separate reviewed work. |
| Coordination state is corrupt | Stop writes and restore the protected OOS state volume. |

## Runtime Boundary

Platform must eventually provide a GitHub installation token restricted to
exactly `workspace-prototype-studio`. PATs, ambient CLI credentials, broad
installations, redirects, and alternate provider destinations are rejected.
OOS prepares source in a temporary exact-revision clone and persists only
bounded coordination state using atomic replacement and a kernel lock.

## Verification

```bash
node --test test/prototype-maturity-*.test.js
npm run test:prototype-maturity-source -- --authority-root /path/to/workspace-prototype-studio
npm run validate:prototype-maturity-contracts
npm run validate:prototype-maturity-openapi
npm run validate:api-docs
```

The source conformance command operates on a disposable clone of the supplied
committed authority. These checks do not open a real provider review, mutate
Prototype Studio `main`, or activate the runtime.

For the composed #1100 proof, bind exact clean Console, WGCF, and Studio
checkouts and write the value-safe report outside tracked source:

```bash
npm run test:prototype-maturity-conformance -- \
  --authority-root <committed-workspace-prototype-studio-checkout> \
  --console-root <committed-governance-operations-console-checkout> \
  --wgcf-root <committed-workspace-governance-control-fabric-checkout> \
  --wgcf-python <python-with-wgcf-dependencies> \
  --evidence-output <evidence-path>
```

This path composes the Console command and terminal projection, WGCF's actual
policy and durable issue/replay/readback implementation, OOS coordination, and
a disposable real-Git Studio authority. It proves blocked and successful
decisions, stale authority, cancellation, caller isolation, replay conflict,
restart recovery, changed-review rejection, readback mismatch recovery, exact
Candidate and Baseline revisions, stable terminal receipts, and unchanged
canonical Studio source. It intentionally leaves normal runtime activation
closed.
