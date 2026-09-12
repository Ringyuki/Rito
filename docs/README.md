# Documentation

Rito is one Rust engine with several hosts:

- [`@ritojs/core`](../packages/rito/README.md) — the browser reader package
- [`@ritojs/kit`](./integrations/kit.md) — framework-agnostic controller,
  transitions, overlays, keyboard and storage helpers
- [`@ritojs/react`](./integrations/react.md) — React hooks and mount
  component built on core and kit
- [`rito_flutter`](../packages/rito_flutter/README.md) — the Flutter
  adapter over the engine's C ABI
- [Direct FFI](./integrations/ffi.md) — bridging the C ABI from hosts that
  are neither web nor Flutter

## Start Here

- [Getting Started](./getting-started.md) — install, fonts, first render,
  common reader operations
- [Capabilities](./capabilities.md) — what the engine lays out and paints
- [Limitations](./limitations.md) — deliberate non-goals and current gaps

## API

- [Reader API](./api/reader.md) — `createReader()`, `ReaderOptions`,
  `Reader`, and the lower-level session entry

## Integrations

- [Using `@ritojs/kit`](./integrations/kit.md)
- [Using `@ritojs/react`](./integrations/react.md)
- [Direct FFI integration](./integrations/ffi.md)

## Development Docs

Contributor documentation lives under [`development/`](./development/README.md):
the architecture and engine pipeline, the wire format, the test pipeline,
the verification instruments and the release process. Those pages describe
the source, not a stable public API.
