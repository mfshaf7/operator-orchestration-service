# Repository Lifecycle Contract Bundle

This directory is the digest-pinned OOS consumer bundle for repository
lifecycle requests, WGCF decisions, terminal receipts, and immutable audit
projections. The canonical source remains `workspace-governance`; OOS verifies
every copied schema against `manifest.json` before accepting workflow input.

This bundle is intentionally separate from the earlier repository-custody
onboarding bundle. Lifecycle actions operate only on repositories whose custody
is already `linked` or `provisioned`.
