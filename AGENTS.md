# AGENTS

## Role

`operator-orchestration-service` is the proposed shared operator workflow
broker for the workspace.

Treat this repo as the durable middle layer between:

- fast operator-facing surfaces such as Telegram
- bounded AI-assist providers
- canonical backend systems such as OpenProject

This repo is not a channel plugin repo and not a platform release-authority
repo.

## Owner Boundary

This repo should own:

- stable workflow APIs
- workflow audit and correlation
- provider-agnostic AI-assist orchestration for bounded workflows
- adapters to canonical backend systems

This repo should not own:

- Telegram UX or transport behavior
- platform environment contracts
- security standards or review authority
- direct governance mutation of workspace contracts

## Current Maturity

- workspace intake status: proposed
- component role: shared operator-facing workflow service
- do not overbuild the runtime before the contract is settled

Start with:

1. workflow contract
2. audit and approval model
3. backend adapter seams
4. service auth and credential custody
5. only then runtime implementation

## Architecture Rules

- keep channel adapters thin
- keep provider details behind a service seam
- keep canonical record mutation behind explicit operator approval
- prefer bounded workflow endpoints over general chat endpoints
- do not let the model become the policy authority

## First Workflow

The first intended workflow is idea capture and triage:

- capture idea text and operator context
- optionally request bounded AI triage
- return structured suggestion
- write accepted result into OpenProject

## Required Cross-Repo References

When implementing or changing this repo, check:

- `workspace-governance/contracts/intake-policy.yaml`
- `workspace-governance/contracts/intake-register.yaml`
- `workspace-governance/contracts/repos.yaml`
- `workspace-governance/contracts/components.yaml`
- `security-architecture/docs/standards/ai-security-and-governance.md`
- `security-architecture/docs/reviews/security-review-checklist.md`
- `security-architecture/docs/architecture/components/operator-orchestration-service/README.md`
- `security-architecture/docs/reviews/components/2026-04-18-operator-orchestration-service-runtime-admission.md`
- `platform-engineering/docs/standards/governed-ai-access-model.md`
- `openclaw-telegram-enhanced/docs/architecture.md`
- `platform-engineering/products/openproject/runtime-contract.md`
- `docs/records/change-records/README.md`

## Done Criteria

Meaningful changes should leave behind:

- a documented workflow/API contract
- explicit ownership and non-ownership language
- audit and approval expectations
- updated docs when workflow shape changes
- security-tagged change-record evidence for runtime, delivery, or secrets-affecting changes

If a future change introduces real credentials, runtime delivery, or a governed
AI invocation path, the repo will also need concrete security review outputs and
repo-level governance enforcement.
