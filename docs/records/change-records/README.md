# Change Records

Use this lane for meaningful repo changes that alter trust boundaries, workflow
contracts, approval handling, backend adapters, or AI-assist behavior.

Even before this repo is admitted and live, design-shaping changes should leave
behind durable records here once implementation starts.

Use repo-relative links for same-repo navigation from change records. Do not
use `/home/mfshaf7/projects/...` markdown links in git-tracked records.

OpenProject mutation-surface changes must also satisfy:

```bash
npm run validate:openproject-mutation-contracts
```

That gate applies when a PR changes the broker's OpenProject mutation adapter,
delivery service mutation behavior, ART planning/review workflow contracts, or
the delivery operator surface. The PR must include:

- a changed regression test covering the live OpenProject form contract
- a change record that states the live contract evidence, including writable
  fields, allowed values, or the explicit read-only proof when the broker must
  defer to a platform projection path
