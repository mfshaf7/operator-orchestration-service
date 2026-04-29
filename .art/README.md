# Managed ART Artifacts

This directory is the local managed artifact root for the broker-owned ART
draft workflow.

- `drafts/` contains editable mutation drafts created by `npm run art -- draft`.
- `review-packets/` contains source evidence packets created by
  `npm run art -- review-packet`.
- `outputs/` contains full broker responses that were too large for the default
  compact ART CLI output.
- `archive/` contains archived legacy scratch payloads moved by
  `npm run art -- scratch cleanup --archive-legacy`.

Generated artifacts are intentionally ignored by git. Durable evidence belongs
in finalized review packets, merged source commits, and ART completion records,
not in `.tmp/` payload files.
