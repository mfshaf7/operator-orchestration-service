---
security_evidence:
  review_areas: [ai, delivery]
  reviewed_artifacts:
    - src/work-design/service.js
    - docs/contracts/work-design-v1.md
  findings: []
  risks: []
  workstreams: [WS-007]
  notes: "Existing scoped context advice only; no model, privilege, draft action or canonical mutation is added."
---

# 2026-11-11 Work Design system context

## Summary

Clarify the existing Context advice task to explain the system being designed,
with evidence, current/proposed behavior and unknowns, before ART decomposition.
Tree advice remains the separate work-breakdown task. This operator-approved
maintenance publishes with the Console Intake/readability and context correction.

## Classification

- area: existing Work Design AI assistance
- type: bounded owner maintenance; no new ART item
- runtime impact: model task instructions change after exact composed acceptance
- Landing Unit Decision: `child_isolated_landing_unit`, `maintenance-context-architecture-advisor-20261111`; OOS owns the broker instruction and independent runtime rollout.

## Ownership

- owner repo: `operator-orchestration-service`
- related ART slice: None; Epic1384 implementation remains separate
- related products or components: Governance Operations Console, Workspace Governance, Security Architecture

## Root Cause

- immediate failure: the operator reported Context diagrams describing delivery tasks instead of the system.
- actual root cause: generic task instructions did not distinguish system architecture from work decomposition; Console starters reinforced the delivery workflow.
- why it escaped earlier controls: schema, custody and snapshot checks validate structure and authority, not architectural understanding.

## Source Changes

- changed workflow, adapter, or contract: context/tree task instructions and existing Work Design contract explanation.
- tests or validator added: request-path checks for distinct task purpose, preserved source and operator prompt, and answer-only output; existing draft and source-binding tests remain.
- related change records: existing Work Design runtime baseline and the coupled Console/Workspace Governance batch.

## Artifact And Deployment Evidence

- source-only change, or build/deployment evidence: owner validation and hosted checks precede publication; exact composed Security acceptance precedes normal Platform activation.
- image tag or digest: existing runtime image unchanged; reviewed source-mounted instruction changes.
- runtime revision: the exact merged source is bound by composed acceptance, not guessed from this record.

## Live Verification

- local validation: focused Work Design and complete owner CI-equivalent checks must pass for the committed source.
- live or dev-integration verification: after commissioning, use the real Console advisor to answer an architecture/task-plan question without editing, then explicitly draft a relevant system architecture; retain model/custody evidence.
- residual risk: generated advice can still be wrong; source inspection and operator review remain necessary. No semantic keyword gate is introduced.

## Follow-Up

- required follow-up: land dependent Security index and composed source acceptance, verify native advice and retire source resources.
- owner: OOS, with Console presentation and Workspace Governance skill owners.
- due date or closure condition: same approved batch; source landing alone does not claim operating completion.
