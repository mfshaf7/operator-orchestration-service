# 2026-09-24 Work Session Terminal Obligation Preflight

## Summary

The normal Delivery ART work-session path now projects completion-narrative and architecture-defined conformance-fidelity obligations before source work, and Review Packet evidence projection can inherit unambiguous fidelity directly from the architecture packet.

## Classification

- area: Delivery ART work-session lifecycle
- type: workflow control correction
- runtime impact: source-only OOS API and CLI projection behavior; no runtime activation or credential-boundary change

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: `#1170` under Delivery Epic `#1154`
- related products or components: Delivery ART work sessions and Review Packets

## Root Cause

- immediate failure: `#1165` reached Review Packet authoring with the wrong fidelity and reached closeout with an incomplete narrative.
- actual root cause: authoritative terminal obligations existed before implementation, but configured-path preflight and active status did not project them together, while evidence projection discarded its detailed fidelity requirements from the persisted editable document.
- why it escaped earlier controls: the canonical validators correctly rejected invalid transitions, but only after source work and manual evidence authoring had already occurred.

## Source Changes

- changed workflow, adapter, or contract: add one work-contract projection to preflight, start, and active status; block source creation on known narrative defects; persist exact conformance requirements; inherit only omitted and unambiguous fidelity.
- tests or validator added: focused work-session and review-evidence tests cover early blocking, status visibility, fidelity inheritance, explicit contradiction, and mixed-fidelity ambiguity.
- related change records: workspace improvement candidate `2026-08-24-art-architecture-topology-capture-regression`

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: source-only change
- image tag or digest: None
- runtime revision: None

## Live Verification

- local validation: focused Node test suites plus the repository CI-equivalent suite before merge
- live or dev-integration verification: normal #1170 work-session preflight, source lifecycle, Review Packet, merge, and closeout
- residual risk: historical evidence documents retain their authored fidelity; only newly projected omitted values inherit architecture truth

## Follow-Up

- required follow-up: Console clients should render the documented work contract when the #1154 Console lifecycle feature is implemented.
- owner: `governance-operations-console`
- due date or closure condition: Feature #1160 completion
