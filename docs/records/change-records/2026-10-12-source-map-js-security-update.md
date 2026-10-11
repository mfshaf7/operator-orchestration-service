# Source Map JS Security Update

## Summary

Refresh the transitive `source-map-js` lockfile entry from 1.2.1 to 1.2.2 to
remove GHSA-68fv-2mgg-jv7q. No direct dependency, OOS source behavior, API,
workflow, identity, credential, data, or mutation boundary changes.

## Classification

- area: dependency supply-chain maintenance
- type: owner-repo maintenance
- runtime impact: source-only until a later reviewed runtime convergence

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; Epic #1203 was already closed before this independent advisory was repaired
- related products or components: Operator Orchestration Service dependency graph

## Root Cause

- immediate finding: `npm audit` reported one high-severity advisory against transitive `source-map-js` 1.2.1
- dependency path: `@temporalio/worker` -> `source-map-loader` -> `source-map-js`
- correction: accept the compatible patched transitive release 1.2.2 in `package-lock.json`

## Source Changes

- update only the `source-map-js` version, resolution URL, and integrity digest in `package-lock.json`
- retain all direct dependency versions and every OOS source file unchanged

## Live Verification

- `npm audit`: zero vulnerabilities after the lock refresh
- `npm ci`: exact lockfile installation passed
- full owner repository test suite: 1,260/1,260 passed
- governance-doc, change-record, mutation-contract, and diff checks: passed against fetched `origin/main`

## Artifact And Deployment Evidence

The active `refinement-catalog` composition remains on the already approved
OOS revision `a78372ca87c2d2e87a9f52f91699ad873f467072`. This maintenance unit does
not converge or change that runtime. A future deployment of the new OOS source
revision must follow the existing exact-revision Security delta and composition
convergence gates.

## Follow-Up

- required follow-up: None before source merge; normal exact-revision review applies before later runtime deployment
- owner: `operator-orchestration-service`
- closure condition: protected merge with zero-vulnerability audit and passing owner validation
