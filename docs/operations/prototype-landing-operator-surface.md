# Prototype Landing

Prototype Landing turns one immutable entry packet and operator-accepted setup
into reviewed Prototype Studio source. It lands an `exploring` Prototype with
its support profile, source custody, docs, history, and validation plan. It does
not activate runtime, promote the Prototype to Candidate or Baseline, create
Delivery work, or publish a Portfolio product.

## Availability

The implementation and isolated composed conformance path are source-complete.
Its synchronized manifest pins the Workspace Governance contract, the active
WGCF readiness implementation, the Prototype Studio owner command, and both
Security reviews. The OOS source capability is active only for the
evidence-bound `dev-integration` composition. It fails closed without the exact
repository-scoped identity and approved configuration; a partial OOS, WGCF, or
identity activation remains unavailable.

The Governance Operations Console is the normal operator client. It projects
these OOS APIs and does not keep its own Landing state machine or write
Prototype Studio source.

## Procedure

GET `/v1/prototypes` is the primary read-only Prototype register, including
Proposal captures that have not yet landed. It reads the registry, validated
capture records and related owner documents from one exact Studio `main`
revision. The configured provider identity must be current and that revision
must exist in the deployment-owned trusted Git ref. The reader neither fetches
Git nor executes source, and missing, malformed, oversized or inconsistent
records make the entire read unavailable rather than returning partial truth.
The negotiated Console source envelope binds the Studio owner, exact commit
and monotonic Git ancestry count. The default JSON response remains available
to existing engineering clients. A successful empty register is distinct from
unavailable authority; neither may be populated from fixtures or browser state.

The collection also includes caller-owned Landing, Maturity and Closure progress
and terminal receipts from their existing durable stores. This restores pending
reviews after a cold browser restart without guessing request IDs or rebuilding
receipts from source files. Each family's `workflow_sources` posture explicitly
distinguishes an unavailable coordinator from a successfully empty history.
Coordination does not override Studio lifecycle: only validated succeeded owner
readback may change a projected source state. The collection envelope binds the
whole read digest and observation ordering; `authority_revision` and
`authority_sequence` retain the underlying exact Studio commit and Git ordering.

The commissioned complete-runtime lane sets
`OOS_RECORD_AUTHORITY_FRESHNESS_REQUIRED=true` for every Studio and Workspace
Governance source adapter. Platform supplies a separate private clone rather
than advancing the reviewed execution checkout. Its non-secret
`.git/console-record-authority.json` checkpoint binds `schema_version: 1`,
`owner_repo`, `trusted_ref: refs/remotes/origin/main`, `reviewed_revision`,
`record_revision`, `observed_at` and `valid_until`. The validity interval is at
most ten minutes. Missing, expired, future, mismatched, symlinked or malformed
checkpoints block reads and source preparation before owner command execution.
Platform owns approved record-only ref advancement and control-code/schema
equality; OOS performs only checkpoint, ancestry and trusted-ref reads. Existing
uncommissioned owner-checkout tooling remains compatible without this flag and
does not constitute the accepted complete-runtime operating path.

1. POST one `prototype_id` to `/v1/prototype-landings/preparations`. Retain the
   exact Studio revision and expected registry state. This read does not create
   workflow state or mutate source.
2. Complete the entry packet, Landing request, and plan. Upstream Proposal or
   import values remain suggestions until the operator accepts the request.
   The request must bind the preparation revision and current registry digest.
3. POST the artifacts with `operator_approval_ref`, `authority_revision`,
   `session_ref`, and `execution_ref` to `/v1/prototype-landings`. HTTP 202
   proves durable acknowledgement only.
4. POST `{}` to `/v1/prototype-landings/{request_id}/continue`. OOS obtains and
   rereads WGCF readiness. A blocked, stale, or expired result produces no
   apply artifact or source change.
5. For ready work, OOS invokes the exact committed Prototype Studio owner
   command in an isolated branch, checks the bounded changed-file set, and
   opens or recovers one matching pull request.
6. At `review-required`, inspect the returned review URL. Owner validation and
   human approval must cover the exact head before a human merges it. OOS has
   no merge endpoint and never writes `main` directly.
7. Continue again. OOS proves successful exact-head checks, human review,
   canonical merge ancestry, and byte-identical merged files. Only then does it
   emit `succeeded`, merged readback, and a terminal receipt whose next action
   is Candidate Promotion.

GET `/v1/prototype-landings/{request_id}` reads caller-owned durable progress
without advancing it. Source file bytes, imported content, credentials, and
provider tokens are never returned in this projection. The route schemas and
examples are in [OpenAPI](../api/openapi.json).

## Recovery

| Situation | Operator action |
| --- | --- |
| Lost submit acknowledgement | Resubmit the identical command; OOS returns the retained workflow. |
| Process or host restart | Read the request, then continue from its last durable phase. |
| Provider acknowledgement lost | Continue; OOS finds and verifies the bound branch or pull request before any new write. |
| WGCF blocked or stale | Correct the reported input and submit a new request identity against fresh preparation state. |
| Readiness expired before preparation | Prepare and submit a new request; expired readiness is never reused for apply. |
| Review head changed | Cancel or close the mismatched review and submit a new request. Never force-push the bound branch. |
| Operator cancels before merge | POST `{}` to `/v1/prototype-landings/{request_id}/cancel`; OOS reconciles any prepared branch, closes the matching review, and retains evidence. |
| Merge races cancellation | OOS records the merged result instead of claiming cancellation. Reversal is separate reviewed work. |
| Coordination state is corrupt | Stop writes and restore the persisted OOS volume. Do not reconstruct receipts from UI state. |

## Runtime Boundary

Platform provides an installation token restricted to exactly
`workspace-prototype-studio`; PATs, ambient `gh` login, broad installations,
redirects, and alternate provider hosts are denied. OOS rereads the token file
for rotation. The trusted Studio checkout is read-only input; all preparation
runs in a temporary clone at an exact commit.

OOS persists coordination in its existing protected local volume with atomic
replacement, fsync, and a kernel lock. This is single-host durability, not a
multi-host database claim. Imported content, when later activated, must resolve
under the Platform-admitted staging root and is revalidated by Prototype
Studio before publication.

## Verification

```bash
node --test test/prototype-landing-*.test.js
npm run validate:prototype-landing-openapi
npm run validate:api-docs
npm run test:prototype-landing-source -- --authority-root <committed-workspace-prototype-studio-checkout>
```

The source conformance command uses temporary clones only. It does not open a
real provider review, mutate Studio `main`, or activate a runtime.

For the composed #1092 proof, bind the exact WGCF and Studio checkouts and
write the value-safe report outside tracked source:

```bash
npm run test:prototype-landing-conformance -- \
  --authority-root <committed-workspace-prototype-studio-checkout> \
  --wgcf-root <committed-workspace-governance-control-fabric-checkout> \
  --wgcf-python <python-with-wgcf-dependencies> \
  --evidence-output <evidence-path>
```

This path runs WGCF's actual pinned policy and durable issue/replay/readback
implementation against the same disposable Studio clone used by OOS. It proves
blocked, stale, persisted recovery, exact-review-head, merged-readback,
terminal replay, and unchanged-canonical-source behavior. The value-safe report
records the exact OOS, WGCF, and Studio revisions used for the proof. It
intentionally leaves normal OOS, WGCF, and Platform activation gates closed.
