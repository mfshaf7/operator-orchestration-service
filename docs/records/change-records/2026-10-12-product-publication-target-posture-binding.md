---
security_evidence:
  review_areas:
    - identity
    - delivery
    - runtime
  reviewed_artifacts:
    - contracts/product-publication/manifest.json
    - src/product-publication/runtime.js
    - src/product-publication/service.js
    - test/product-publication.test.js
    - docs/operations/product-publication-operator-surface.md
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: OOS now enforces the source-owned internal-only Product Publication scope before readiness access or journal mutation; runtime activation remains false.
---

# Product Publication Target Posture Binding

## Summary

OOS now binds the initial Product Publication Security scope to the `internal`
target posture and rejects every broader or terminal posture before it contacts
WGCF or mutates durable journal state. This repairs completed workflow item
`#1255` before Security review `#1257` decides whether the exact path may be
activated.

## Classification

- area: Product Publication authorization scope
- type: corrective owner-repo maintenance linked to `#1255`
- runtime impact: none; Product Publication remains source-inactive

## Ownership

- source-scope owner: `operator-orchestration-service`
- acceptance owner: `security-architecture`
- later environment activation and proof owner: `platform-engineering`

## Root Cause

The command contract correctly described every future publication posture, but
the runtime did not separately constrain which posture the current Security
decision admitted. A Console caller with valid operator authority could
therefore request `client` or `public` under the internal-only decision example.

## Source Changes

- records `allowed_target_postures: [internal]` in the OOS workflow manifest;
- passes that immutable source scope into the runtime service;
- rejects a target outside the source-owned set before WGCF access and journal
  mutation; and
- documents that Platform configuration cannot broaden the accepted set.

## Validation

- the focused negative case proves `public` is denied before WGCF;
- the existing internal positive, exact Security decision, replay, version,
  caller, readiness, and receipt cases remain required; and
- full repository and exact-base validation remain required before merge.

## Artifact And Deployment Evidence

- source-only correction under owner-repo maintenance;
- no deployment, credential, route, state, or live runtime changed; and
- `runtime_activation` remains `false`.

## Live Verification

No live claim is made. Platform `#1258` remains responsible for bounded
single-operator, loopback-only `dev-integration` proof after Security approval
and both source-owned runtime gates are activated.

## Follow-Up

Security `#1257` must review this exact merged OOS revision. Any later admission
of `client`, `public`, `unlisted`, or `archived` requires a new reviewed source
revision and Security decision before Platform may compose it.

## Rollback

Revert this change to restore the prior unconstrained target behavior while the
runtime remains inactive. Do not activate that prior revision.
