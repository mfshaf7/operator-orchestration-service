# Repository Custody Authority Bundle

This digest-pinned bundle lets OOS validate custody requests, WGCF decisions,
provider readback, and terminal receipts against the exact Workspace
Governance authority merged for Delivery `#1040` and corrected under `#1042`.

OOS owns workflow and receipt custody, but it does not become policy or
provider authority. WGCF issues the readiness decision; the repository provider
owns physical state and immutable identity; Platform owns provider application
identity; Security owns trust acceptance. Successful custody does not imply
Workspace Intake, active inventory, Delivery Catalog, or product admission.

The copied authority and schemas remain upstream-owned. `manifest.json` binds
their exact source commit and byte digests so local changes fail closed.
