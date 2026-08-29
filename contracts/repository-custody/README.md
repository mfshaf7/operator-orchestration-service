# Repository Custody Authority Bundle

This digest-pinned bundle lets OOS validate custody requests, WGCF decisions,
provider readback, and terminal receipts against the exact Workspace
Governance authority merged for Delivery `#1054`.

OOS owns workflow and receipt custody, but it does not become policy or
provider authority. WGCF issues the readiness decision; the repository provider
owns physical state and immutable identity; Platform owns provider application
identity; Security owns trust acceptance. Successful custody does not imply
Workspace Intake, active inventory, Delivery Catalog, or product admission.

The authority covers both linking an existing repository and provisioning a new
organization-owned repository. The copied schemas remain upstream-owned.
`manifest.json` binds their exact source commit and byte digests so local drift
fails closed.
