# Documentation

Rito is split into a small public core package plus optional integration layers:

- [`rito`](../README.md) — core EPUB parser, layout, pagination, rendering, and stable interaction primitives
- [`@rito/kit`](./integrations/kit.md) — framework-agnostic controller, transitions, overlays, keyboard, and storage helpers
- [`@rito/react`](./integrations/react.md) — React hooks and mount component built on top of `rito` and `@rito/kit`

## Start Here

- [Getting Started](./getting-started.md) — install, first render, common reader operations
- [Capabilities](./capabilities.md) — what Rito supports today
- [Limitations](./limitations.md) — deliberate non-goals and current gaps
- [Architecture](./architecture.md) — parser/style/layout/render/runtime boundaries and package layering
- [Release & Versioning](./releasing.md) — package publishing, changelog, and versioning policy
- [Release Runbook](./release-runbook.md) — exact release steps and commands

## API

- [Reader API](./api/reader.md) — `createReader()`, `ReaderOptions`, `Reader`
- [Stable Primitives](./api/primitives.md) — `loadEpub`, `prepare`, `paginate`, `render`, and related helpers
- [Advanced Entry](./api/advanced.md) — `rito/advanced` exports for expert use
- [Specialized Subpaths](./api/subpaths.md) — `rito/selection`, `search`, `annotations`, `position`, `a11y`, `dom`

## Integrations

- [Using `@rito/kit`](./integrations/kit.md)
- [Using `@rito/react`](./integrations/react.md)

## Recommended Reading Order

1. [Getting Started](./getting-started.md)
2. [Reader API](./api/reader.md)
3. [Capabilities](./capabilities.md)
4. [Architecture](./architecture.md)
5. Integration docs if you are building UI on top of the core
