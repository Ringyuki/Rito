# Documentation

Rito is split into a platform-neutral core, a Web Canvas preset, and optional
integration layers:

- [`@ritojs/core`](../packages/rito/README.md) — platform-neutral EPUB parser, layout, pagination, display-list, and adapter contracts
- `@ritojs/core/web` — browser Canvas preset inside `@ritojs/core`, including `createReader()`
- [`@ritojs/kit`](./integrations/kit.md) — framework-agnostic controller, transitions, overlays, keyboard, and storage helpers
- [`@ritojs/react`](./integrations/react.md) — React hooks and mount component built on top of the Web reader and `@ritojs/kit`

## Start Here

- [Getting Started](./getting-started.md) — install, first render, common reader operations
- [Capabilities](./capabilities.md) — what Rito supports today
- [Limitations](./limitations.md) — deliberate non-goals and current gaps
- [Architecture](./architecture.md) — parser/style/layout/render/runtime boundaries and package layering
- [Native Reader Architecture](./native-reader-architecture.md) — production Flutter/native reader runtime design and development plan
- [Native Reader UI Plan](./native-reader-ui-plan.md) — immersive Flutter reader shell, design language, interaction, motion, and UI roadmap
- [Testing Pipeline](./testing-pipeline.md) — unit, integration, structured golden, render golden, and e2e strategy
- [Rendering Diagnostics](./rendering-diagnostics.md) — standard workflow for Rito vs browser XHTML mismatches
- [Release & Versioning](./releasing.md) — package publishing, changelog, and versioning policy

## API

- [Reader API](./api/reader.md) — Web Canvas `createReader()`, `ReaderOptions`, `Reader`
- [Stable Primitives](./api/primitives.md) — `loadEpub`, `paginate`, `buildSpreads`, display-list builders, and adapter contracts
- [Advanced Entry](./api/advanced.md) — `@ritojs/core/advanced` exports for expert use
- [Specialized Subpaths](./api/subpaths.md) — `@ritojs/core/web`, `integration`, `selection`, `search`, `annotations`, `position`, `a11y`, `dom`

## Integrations

- [Using `@ritojs/kit`](./integrations/kit.md)
- [Using `@ritojs/react`](./integrations/react.md)

## Recommended Reading Order

1. [Getting Started](./getting-started.md)
2. [Reader API](./api/reader.md) for browser Canvas apps, or [Stable Primitives](./api/primitives.md) for custom runtimes
3. [Capabilities](./capabilities.md)
4. [Architecture](./architecture.md)
5. Integration docs if you are building UI on top of the core
