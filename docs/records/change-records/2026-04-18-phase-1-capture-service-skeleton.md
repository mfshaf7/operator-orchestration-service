# 2026-04-18 phase-1 capture service skeleton

## Summary

Implemented the first real `operator-orchestration-service` runtime skeleton as
a small internal Node service with bounded health, readiness, version, and
capture endpoints plus a stable OpenProject adapter seam and structured stdout
audit events.

## Why

- the repo needed a real executable service boundary before Telegram wiring or
  runtime admission
- `operator-orchestration-service` is the correct owner because the workflow
  seam must stay separate from both Telegram UX and platform rollout logic

## Scope

- added a capture-first HTTP runtime
- added config loading for caller auth and OpenProject contract mapping
- added an OpenProject adapter for project-scoped work package creation
- added structured audit emission for capture requests and backend writes
- added repo-local tests for payload shaping, auth enforcement, and HTTP
  behavior

## Validation

- `npm test`
- `git diff --check`

## Security Evidence

```yaml
security_evidence:
  review_areas:
    - identity
    - secrets
    - runtime
  reviewed_artifacts:
    - docs/architecture/security-model.md
    - docs/contracts/openproject-adapter-v1.md
    - docs/contracts/audit-events-v1.md
  notes: "Runtime admission and Vault-delivered secret wiring remain deferred; live OpenProject create validation is still blocked by the current least-privilege role gap on the automation identity."
```
