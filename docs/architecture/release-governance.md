# Release Governance

## Purpose

`operator-orchestration-service` is a shared control-plane component. Its stage
and prod release truth cannot stop at "the image built" or "the pod is
healthy".

This repo owns the component-specific verification catalogs and the source-side
artifact metadata that the platform release authority uses when recording:

- stage candidate
- stage verification
- stage readiness approval
- prod post-promotion verification

The platform release authority and shared deployment contract still live in
`platform-engineering/`.

## Release Artifacts This Repo Owns

- [../../verification-catalog.yaml](../../verification-catalog.yaml)
- [../../prod-verification-catalog.yaml](../../prod-verification-catalog.yaml)
- [../records/change-records/README.md](../records/change-records/README.md)
- [../../.github/workflows/build-image.yaml](../../.github/workflows/build-image.yaml)

## Stage Verification Intent

The stage verification catalog proves that the recorded candidate still behaves
like a bounded workflow broker:

- runtime starts and reports healthy readiness
- workflow catalog is readable
- OpenProject reachability remains intact
- one representative bounded workflow path works on the intended rehearsal
  surface

## Prod Verification Intent

The prod verification catalog is narrower and deployment-oriented:

- the shared deployment contract and live digest still match
- the workflow catalog still serves the expected bounded route family
- the OpenProject adapter remains operational on the promoted contract

## Source Metadata Expectation

The image build workflow must publish durable release metadata for the exact
digest it pushed so the platform release authority can record candidate or prod
contract truth without guessing the source SHA.

At minimum that metadata should identify:

- source repo and source SHA
- published image repository
- published image digest
- workflow run or immutable artifact reference

## Related Control Planes

- platform release authority:
  [`platform-engineering/docs/components/operator-orchestration-service/release-governance.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/components/operator-orchestration-service/release-governance.md)
- shared release-governance standard:
  [`platform-engineering/docs/standards/governed-release-control-model.md`](https://github.com/mfshaf7/platform-engineering/blob/main/docs/standards/governed-release-control-model.md)
- release-governance tier model:
  [`workspace-governance/contracts/release-governance.yaml`](https://github.com/mfshaf7/workspace-governance/blob/main/contracts/release-governance.yaml)
