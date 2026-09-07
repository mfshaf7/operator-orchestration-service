# Prototype Landing

Prototype Landing turns one immutable entry packet and operator-accepted setup
into reviewed Prototype Studio source. It lands an `exploring` Prototype with
its support profile, source custody, docs, history, and validation plan. It does
not activate runtime, promote the Prototype to Candidate or Baseline, create
Delivery work, or publish a Portfolio product.

## Availability

The implementation and isolated composed conformance path are source-complete
but normal runtime availability remains inactive. Its synchronized manifest
pins the Workspace Governance contract, WGCF readiness implementation,
Prototype Studio owner command, and Security review. Platform work item #1090
supplies the repository-scoped identity and dev-integration composition. The
normal OOS and WGCF activation gates remain closed until a later explicit
Security and Platform activation decision.

The Governance Operations Console is the normal operator client. It projects
these OOS APIs and does not keep its own Landing state machine or write
Prototype Studio source.

## Procedure

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
terminal replay, and unchanged-canonical-source behavior. It intentionally leaves normal OOS,
WGCF, and Platform activation gates closed.
