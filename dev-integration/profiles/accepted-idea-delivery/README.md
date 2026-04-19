# Accepted Idea Delivery Dev-Integration Profile

This profile is reserved for the next local `dev-integration` phase:

- consume accepted ideas from `Workspace Proposals`
- create linked delivery records in the separate OpenProject delivery ART
  project
- rehearse the PM²-governed, one-ART handoff locally before any governed stage
  path exists for it

## Lifecycle

Current lifecycle in the shared workspace contract:

- `proposed`

That means:

- the profile is documented
- the runtime shape is reserved
- the profile is not self-serve launchable from the shared runner yet

## Intended Runtime Shape

- local OpenProject on `k3s`
- real `operator-orchestration-service` source mounted into a local runtime
- local ART project seeding and accepted-idea consumption rehearsal

## Intended Participating Repos

- `operator-orchestration-service`
- `platform-engineering`

## Planned Operator Surface

Once admitted and implemented, the profile is expected to use the shared
`platform-engineering` entrypoints:

- `make devint-up PROFILE=accepted-idea-delivery`
- `make devint-status PROFILE=accepted-idea-delivery`
- `make devint-smoke PROFILE=accepted-idea-delivery`
- `make devint-down PROFILE=accepted-idea-delivery`
- `make devint-reset PROFILE=accepted-idea-delivery`
- `make devint-promote-check PROFILE=accepted-idea-delivery`

Until admission is complete, these are design targets only, not active
procedures.

## Stage Handoff Checks

Once this profile becomes active, its governed handoff is expected to prove:

- `accepted idea lookup`
- `delivery-art project verification`
- `consume accepted idea`
- `backlink verification`

## Design References

- `docs/contracts/accepted-idea-delivery-consumption-v1.md`
- `platform-engineering/products/openproject/delivery-art-contract.md`
- `platform-engineering/docs/decisions/adr/ADR-013-openproject-proposal-to-delivery-split-and-one-art-model.md`
