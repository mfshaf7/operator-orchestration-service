# Repository Custody Workflow Contract

This directory owns the OOS workflow result envelope for repository custody.
The request, readiness decision, provider readback, and custody receipt remain
exact digest-pinned projections of the Workspace Governance authority under
`contracts/repository-custody/`.

The result records provider-operation checkpoints as well as terminal evidence,
so an uncertain create can recover without blindly issuing a second create.
Normal runtime activation remains disabled by the synchronized upstream
manifest. Completed Security, provider-identity, and Console work items are
historical evidence; they do not replace an explicit activation change.
