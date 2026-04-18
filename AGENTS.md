# AGENTS

## Role

`operator-orchestration-service` is the active shared operator workflow broker
for the workspace.

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

- workspace intake status: active
- component role: shared operator-facing workflow service
- current runtime and contract are active, but the workflow scope should still
  stay bounded

Start with:

1. workflow contract
2. audit and approval model
3. backend adapter seams
4. service auth and credential custody
5. only then runtime implementation

## Dev-Integration Profile

This repo owns the first concrete `dev-integration` profile:
`dev-integration/profiles/idea-workflow/`.

That profile defines the runtime shape for fast local `k3s` iteration of the
broker-owned idea workflow. It is allowed to use:

- local branches
- git worktrees
- dirty working trees
- local-only commits

It must not:

- write to governed stage or prod backends
- consume governed shared secrets
- claim governed stage or prod evidence

Treat the profile as the runtime-shape owner. The shared lane standard and
runner still belong to `workspace-governance` and `platform-engineering`.

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
- `platform-engineering/docs/standards/dev-integration-lane.md`
- `openclaw-telegram-enhanced/docs/architecture.md`
- `platform-engineering/products/openproject/runtime-contract.md`
- `dev-integration/profiles/idea-workflow/README.md`
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
