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

## Validation

The local drift check compares the documented route surface in `openapi.json`
to the implemented HTTP route surface in `src/app.js`.

Run:

```bash
npm run validate:api-docs
```
