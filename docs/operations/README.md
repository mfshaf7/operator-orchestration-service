# Operator Workflow Index

This is the primary operator index for `operator-orchestration-service`.

Start here to select the workflow that owns the requested action. Each linked
surface defines its authority boundary, availability, procedure, recovery, and
evidence. Contract manifests remain authoritative for runtime activation;
completed ART items are historical evidence, not live feature flags.

## Workspace And Proposal

- [Proposal Workflow](proposal-workflow-operator-surface.md)
- [Proposal Target Application](proposal-target-application-operator-surface.md)
- [Workspace Intake](workspace-intake-operator-surface.md)
- [Workspace Inventory](workspace-inventory-operator-surface.md)
- [Lifecycle Transition Journal](lifecycle-transition-operator-surface.md)

## Prototype

- [Prototype Landing](prototype-landing-operator-surface.md)
- [Prototype Maturity](prototype-maturity-operator-surface.md)
- [Prototype Delivery Application](prototype-delivery-application.md)
- [Prototype Closure](prototype-closure-operator-surface.md)

## Delivery

- [Delivery Workflow](delivery-workflow-operator-surface.md)
- [Delivery Catalog Runtime](delivery-catalog-runtime.md)
- [Refinement Runtime](refinement-runtime.md)
- [Workflow Activity](workflow-activity-operator-surface.md)

## Repository

- [Repository Custody](repository-custody-workflow.md)
- [Repository Lifecycle](repository-lifecycle-workflow.md)

## Shared Runtime Controls

- [Durable Orchestration](durable-orchestration-operator-surface.md)
- [Agent Action Enforcement](agent-action-enforcement.md)
- [Model Profile Requests](model-profile-request-operator-surface.md)

Use the Console as the normal operator client where the selected surface says
that integration is available. Use the OOS CLI for engineering, recovery, or
diagnostic work described by the selected surface. Do not infer mutation
authority from a route existing in source.
