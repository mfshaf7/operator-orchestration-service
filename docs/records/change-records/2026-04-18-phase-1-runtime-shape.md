# 2026-04-18 phase-1 runtime shape

## Summary

Defined the phase-1 runtime shape for `operator-orchestration-service`,
including caller authentication direction, OpenProject adapter boundary, and
structured audit expectations.

## Why

- the repo already had the high-level role and API shape
- the next implementation step needed a stable service boundary before code
- Telegram, AI, and OpenProject concerns needed a cleaner trust split

## Scope

- runtime shape
- security model
- OpenProject adapter contract
- audit event contract

## Validation

- `git diff --check`

## Security Evidence

```yaml
security_evidence:
  review_areas:
    - identity
    - secrets
    - ai
    - runtime
  reviewed_artifacts:
    - security-architecture/docs/reviews/components/2026-04-18-operator-orchestration-service-proposed-component-review.md
    - security-architecture/docs/standards/ai-security-and-governance.md
    - platform-engineering/docs/standards/governed-ai-access-model.md
  notes: "Phase 1 remains design-only. Governed AI is still deferred; local-model assistance, if used first, must not be labeled governed."
```
