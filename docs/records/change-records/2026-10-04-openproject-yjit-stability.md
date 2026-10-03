---
security_evidence:
  review_areas:
    - runtime
  reviewed_artifacts:
    - dev-integration/profiles/accepted-idea-delivery/README.md
    - dev-integration/profiles/accepted-idea-delivery/scripts/up.sh
    - test/devint-openproject-access.test.js
  findings: []
  risks: []
  workstreams:
    - WS-007
  notes: "This local dev-integration compatibility setting disables an unstable JIT path; it adds no privilege, credential, network route, or governed environment authority."
---

# 2026-10-04 OpenProject YJIT stability

## Summary

Disable YJIT in the accepted-idea-delivery OpenProject runtime after Ruby 3.4.7
web workers repeatedly segfaulted during Delivery ART API read bursts.

## Classification

- area: accepted-idea-delivery dev-integration runtime
- type: runtime compatibility maintenance
- runtime impact: OpenProject web processes use the stable Ruby interpreter
  path while the local profile keeps its existing one-worker memory bound

## Ownership

- owner repo: `operator-orchestration-service`
- tracking reference: `operator-maintenance:openproject-yjit-stability-2026-10-04`
- related products or components: OpenProject dev-integration profile and
  Delivery ART work-session reads

## Root Cause

- immediate failure: OOS received repeated `socket hang up` failures while
  reading work item #1229
- live truth: the OpenProject pod remained Ready because Puma's master process
  survived, while its only Ruby worker emitted repeated segmentation faults
  and respawned
- runtime trigger: the OpenProject 17.2.3 image enabled YJIT for the production
  Rails process on Ruby 3.4.7; crash frames varied across Rails and ActiveRecord
  code, indicating native JIT instability rather than one application query
- containment proof: setting OpenProject's supported
  `OPENPROJECT_DISABLE__YJIT=true` switch stopped the crash loop and allowed the
  exact #1229 work-session status read to reach `source-work`

## Source Changes

- changed runtime contract: render `OPENPROJECT_DISABLE__YJIT=true` in the
  profile's Helm environment
- operator guidance: document the stable interpreter posture beside the
  existing web-worker memory bound
- regression test: assert that the generated profile script retains the YJIT
  disable switch

## Artifact And Deployment Evidence

- source evidence: owner-repo maintenance PR and merged commit
- live containment: dev-integration OpenProject web deployment updated with the
  same environment switch before source landing
- governed stage or production impact: none; this profile is local-only

## Live Verification

- exact proof: `npm run art -- work status 1229` completed and reported
  `state=source-work` after the web rollout
- residual risk: a future OpenProject/Ruby upgrade may make YJIT safe again;
  removal requires a deliberate compatibility proof under the same ART read
  burst

## Follow-Up

- required follow-up: reconcile the full `refinement-catalog` composition from
  the merged OOS revision and repeat the exact #1229 continuation proof
- owner: Operator Orchestration Service
- closure condition: merged source, healthy composition, and exact work-session
  proof without another Ruby worker crash
