---
security_evidence:
  review_areas:
    - identity
    - secrets
    - delivery
    - runtime
  findings: []
  risks: []
  workstreams:
    - WS-021
---

# 2026-04-21 Broker Create Role Alignment And Formattable-Field Repair

## Summary

The broker-backed OpenProject delivery create path was repaired after live
devint revalidation exposed two gaps: the accepted-idea-delivery profile was
still provisioning the broker identity without `Work package structure editor`,
and the create adapter was not preserving markdown-backed custom-field payloads
reliably enough for the SAFe execution model.

## Classification

- owner repo: `operator-orchestration-service`
- related control planes:
  - `platform-engineering`
  - `security-architecture`
- trust-boundary areas:
  - identity
  - secrets
  - delivery
  - runtime

## Ownership

- broker route, request validation, OpenProject API adapter logic, and devint
  workflow profile:
  `operator-orchestration-service`
- product contract wording and operator wrapper guidance:
  `platform-engineering`

## Root Cause

The first broker create slice was marked complete before the live devint lane
had been revalidated against the current automation role set. That allowed a
lane-local role drift to survive: the devint profile kept provisioning only the
older three-role membership, so the parent patch path failed live even though
the source contract had already widened to require structure-edit permissions.

## Source Changes

- accepted-idea-delivery devint profile:
  - added `Work package structure editor` to the broker identity provisioning
    role set
- OpenProject adapter:
  - preserve `.raw` values for formattable custom fields when reading schema
    values and created work-package payloads
  - keep create payloads for formattable SAFe fields as markdown objects
  - improve assignee-option failure text to state the assignable-principal rule
- delivery API contract:
  - document that `assignee_login` must resolve to an assignable principal in
    the target project or work-item form

## Artifact And Deployment Evidence

- deployment artifact:
  - live devint reprovision in `devint-accepted-idea-delivery-mfshaf7`
- proof artifact:
  - `.dev-integration/accepted-idea-delivery/mfshaf7/oos-task-62-create-repair-proof.json`

## Live Verification

- broker identity roles in the live devint lane now include:
  - `Reader`
  - `Work package creator`
  - `Work package editor`
  - `Work package structure editor`
- live broker create proof:
  - `POST /v1/delivery-work-items`
  - created `work-item-74` / `openproject://work_packages/74`
  - parent preserved as `work-item-61`
  - `Target PI = PI-2026-02`
  - structured SAFe custom fields persisted on the created record
- `npm test`
- `node --check src/openproject-client.js`
- `bash -n dev-integration/profiles/accepted-idea-delivery/scripts/up.sh`
- `python3 scripts/validate_governance_docs.py --repo-root .`
- `python3 scripts/validate_change_record_requirement.py --against-ref origin/main`
- `git diff --check`

## Follow-Up

- keep later brokerized delivery surfaces on the same live-revalidation
  discipline before closing the ART task
- leave arbitrary human assignment out of the broker contract unless the target
  project actually exposes that principal as assignable
