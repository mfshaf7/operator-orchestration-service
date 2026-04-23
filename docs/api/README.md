# API Reference Front

This directory is the canonical API reference front for
`operator-orchestration-service`.

It is layered under the existing workflow/operator docs:

- workflow meaning stays in
  [../operations/delivery-workflow-operator-surface.md](../operations/delivery-workflow-operator-surface.md)
- route and payload reference lives here

## Source Of Truth

- machine-readable source:
  [openapi.json](openapi.json)
- browsable Redoc front:
  [index.html](index.html)
- fast CLI lookup:
  `npm run api:contract -- <METHOD> <PATH>`

Use this order by default when working on an existing broker route:

1. `npm run api:contract -- <METHOD> <PATH>` for the bounded route contract
2. `openapi.json` or Redoc when you need the fuller surrounding context
3. `src/app.js` and service code only to confirm implementation details or
   resolve drift

## Scope

The reference front covers the currently implemented broker route families:

- health and version
- workflow catalog
- idea workflow routes
- delivery initiative routes
- delivery work-item routes

It does not change workflow meaning, trust boundaries, or the rule that the
broker remains a bounded workflow surface rather than a generic OpenProject
proxy.

## How To Read The Broker Payloads

- `/v1/...` routes are broker contracts, not raw OpenProject work-package
  payloads.
- Most write routes use an `input` envelope. The mutable fields you should fill
  live under that object.
- Idea capture and bounded idea decisions also use an `operator` envelope so
  the broker can attribute the human action that created, triaged, or decided
  the idea.
- Broker-shaped ids look like:
  - `idea-40`
  - `delivery-38`
  - `work-item-177`
- Clear-style booleans such as `clear_target_pi` mean "remove the current
  stored value" rather than "set this field to false".

## What Improved In The Redoc Front

- each route now explains when to use it
- write routes now carry concrete request examples
- shared request schemas now include examples as well, so expanding the schema
  panel still shows realistic payloads
- internal-only routes are called out explicitly so the front does not blur
  source-adapter commands with broker control writes

## Internal And Operator-Facing Routes

This front intentionally documents both:

- operator-facing broker routes
- internal-only broker routes such as proposal consumption, closeout, and
  evaluation metadata writes

Those internal-only routes are marked as such in the spec descriptions so the
reference front does not blur adapter-visible workflow commands with internal
broker control paths.

## Local Use

Serve the directory locally, then open the Redoc front in a browser:

```bash
python3 -m http.server 18186 --directory docs/api
```

Then open:

```text
http://127.0.0.1:18186/
```

For a fast terminal lookup instead of opening the whole front:

```bash
npm run api:contract -- GET /v1/delivery-work-items/work-item-188/continuation-context
```

## Validation

The local drift check compares the documented route surface in `openapi.json`
to the implemented HTTP route surface in `src/app.js`.

Run:

```bash
npm run validate:api-docs
```
