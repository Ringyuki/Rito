# Documentation

Rito is split into a core reader package and optional integration layers:

- [`@ritojs/core`](../packages/rito/README.md) — app-facing Rust-backed reader contract
- [`@ritojs/kit`](./integrations/kit.md) — framework-agnostic controller, transitions, overlays, keyboard, and storage helpers
- [`@ritojs/react`](./integrations/react.md) — React hooks and mount component built on top of `@ritojs/core` and `@ritojs/kit`
- [Direct FFI](./integrations/ffi.md) — bridging the engine's C ABI from hosts that are neither web nor Flutter (build `rito-ffi` from source, wire lockstep rules)

## Start Here

- [Getting Started](./getting-started.md) — install, first render, common reader operations
- [Capabilities](./capabilities.md) — what Rito supports today
- [Limitations](./limitations.md) — deliberate non-goals and current gaps

## API

- [Reader API](./api/reader.md) — root `createReader()`, `ReaderOptions`, `Reader`
- [Reference Primitives](./api/primitives.md) — source-only TS parser/layout/render primitives for diagnostics and migration
- [Specialized Subpaths](./api/subpaths.md) — current public subpath policy

## Integrations

- [Using `@ritojs/kit`](./integrations/kit.md)
- [Using `@ritojs/react`](./integrations/react.md)

## Recommended Reading Order

1. [Getting Started](./getting-started.md)
2. [Reader API](./api/reader.md) for browser Canvas apps, or [Reference Primitives](./api/primitives.md) for diagnostics and migration work
3. [Capabilities](./capabilities.md)
4. Integration docs if you are building UI on top of the core

## Development Docs

Contributor, architecture, migration, diagnostic, testing, and release notes live under
[`development/`](./development/README.md). If you are continuing implementation work,
start with the development [current status handoff](./development/current-status.md).
Development docs are source-level project documentation, not stable user-facing API
documentation.
