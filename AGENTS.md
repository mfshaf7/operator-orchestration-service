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

A second concrete profile lives at:
`dev-integration/profiles/accepted-idea-delivery/`.

These profiles define the runtime shape for fast local `k3s` iteration of
broker-owned workflows. They are allowed to use:

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

The active `accepted-idea-delivery` profile now owns the next local workflow
phase:

- consume accepted ideas from `Workspace Proposals`
- create linked delivery records in the separate OpenProject ART project
- rehearse that handoff locally before any governed rollout path exists

For serious project delivery that is already tracked in `Workspace Delivery
ART`, treat the ART as the primary work-state truth. Use this repo for
implementation and API-contract truth, not as the project queue.

## Architecture Rules

- keep channel adapters thin
- keep provider details behind a service seam
- keep canonical record mutation behind explicit operator approval
- prefer bounded workflow endpoints over general chat endpoints
- do not let the model become the policy authority

## First Workflow

The first intended workflow is idea capture and triage:

- capture idea text and operator context
- record operator-authored triage framing from Telegram or another phone-friendly
  surface
- record bounded durable outcomes such as `parked`, `accepted`, or `rejected`
- store internal evaluation metadata using workspace-derived canonical tokens
  plus full notes, without exposing that write path to Telegram
- reserve bounded AI-assisted triage discussion as an optional future path, not
  a prerequisite
- defer `owner-assigned` until the owner vocabulary is explicit

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
- `dev-integration/profiles/accepted-idea-delivery/README.md`
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

## Review guidelines

For Codex GitHub review, treat the following as `P1` when they plausibly
regress the bounded workflow-control model:

- unbounded agentic behavior, direct policy authority, or operator-approval
  bypass
- OpenProject schema, workflow contract, or audit-event changes that do not
  update the documented contract and audit model
- Telegram UX, delivery logic, or direct workspace-governance mutation leaking
  into this broker layer
- governed AI language that implies a live approved AI runtime path when the
  actual path is still suspended or bounded
