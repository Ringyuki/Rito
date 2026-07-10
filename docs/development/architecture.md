# Architecture

Rito's production engine is Rust. TypeScript provides the browser package
facade and UI integration layers; the previous TypeScript engine is retained
only as a source-level reference oracle.

## Product Shape

```text
crates/rito-core/
  EPUB/XHTML/CSS/style/layout/pagination
  display commands, runtime revisions, frames, resources, search, geometry

crates/rito-wasm/
  thin wasm-bindgen boundary over rito-core

packages/rito-core-wasm/
  private WASM build and decoder workspace

packages/rito/
  public @ritojs/core reader facade
  browser worker, resource, and Canvas bindings
  source-only TypeScript reference implementation

packages/kit/
  framework-agnostic controller and interaction orchestration

packages/react/
  React lifecycle and state integration over core + kit

apps/reader/
  demonstration application
```

Application and integration layers depend toward the engine layers above them.
Rust core never depends on browser, Canvas, React, or application code. The
public core package must not depend on Kit or React.

## Rust Core Boundaries

`crates/rito-core` owns the production document model and policy:

1. EPUB archive and publication parsing
2. XHTML parsing and CSS/style resolution
3. layout, line breaking, and pagination
4. paint-ready display commands
5. document, revision, frame, and resource lifecycle
6. locator resolution, search, and interaction geometry

Keep these layers explicit. Layout must not acquire browser or Canvas
dependencies. Rendering payloads must be derived from typed paint-ready Rust
models rather than reparsing CSS or reconstructing layout in JavaScript.

The runtime boundary is a long-lived document handle. A layout change creates
a revision, and clients request spread frames and resources for that revision.
Page and spread indexes are revision-local; durable positions use source
locators.

## Browser Boundary

`crates/rito-wasm` exposes a narrow browser-target binding. It translates
typed Rust results into the transport representations consumed by the browser
shell; it does not own reader policy.

`packages/rito/src/bindings/browser/**` is the allowed browser-specific shell:

- load the WASM module
- run the document runtime in a Worker when available
- transfer frame and resource payloads
- register fonts and decode images with browser APIs
- execute paint commands on Canvas

Browser APIs such as `Worker`, `FontFace`, `createImageBitmap`, `Blob`, Canvas,
and `document.fonts` stay in this binding layer. The shell must not duplicate
pagination, navigation, cache, or revision policy that belongs in Rust.

`RITOFCB2` is the packed frame-command ABI. `RITORB1` is an experimental,
private metadata wire and must remain opt-in until real-session A/B testing
shows no interaction regression. JSON and binary diagnostic views must derive
from the same typed Rust model.

## TypeScript Reference Boundary

The historical TypeScript engine lives under:

```text
packages/rito/src/reference/ts-core/**
```

It exists for parity comparisons, golden generation, and focused diagnostics.
It is not a production fallback and must not be imported by public package
entries, Kit, React, or the demo app. The guarded Canvas presentation adapter
is the current temporary exception and should remain explicit.

Do not recreate production implementations under root `src/parser`,
`src/style`, `src/layout`, `src/render`, or `src/runtime`. Fixes learned from
the reference implementation must be ported into Rust rather than making the
reference tree authoritative again.

## Public Package Boundary

The public `@ritojs/core` package exposes the root reader facade and
`./package.json` only. Its stable surface includes `createReader()`,
`preloadReaderRuntime()`, reader types, and small reader-facing helpers.

Legacy `web`, `advanced`, `integration`, `selection`, `search`, `annotations`,
`position`, `a11y`, and `dom` subpaths are not public APIs. Controller-level
selection, search, annotations, accessibility, storage, transitions, and DOM
wiring belong in `@ritojs/kit`; React glue belongs in `@ritojs/react`.

`packages/rito-core-wasm` is a private build workspace, not a runtime package.
The `@ritojs/core` build bundles its JavaScript binding/decoder modules and
copies the generated `.wasm` into the public package's `dist/`. Release pack
checks reject private workspace runtime dependencies or imports and exercise an
isolated install. The private workspace must not become an accidental fourth
public package.

## Required Invariants

- Rust owns production parsing, style, layout, pagination, runtime, and
  interaction geometry.
- Layout code has no Canvas or browser dependencies.
- JavaScript does not infer semantic targets from paint commands.
- A frame and every resource lease are associated with a revision.
- Stale revision responses cannot replace the active revision.
- Revision and frame caches have explicit bounded lifecycles.
- Public exports go through `packages/rito/src/index.ts` and stay small.
- Source-only reference code never leaks into published entry points.
- Debug JSON and compact wire formats derive from one typed model.

## Verification Strategy

Changes must be checked at each boundary:

- Rust unit tests for parsing, layout, runtime, wire validation, and lifecycle
- parity fixtures and render-command hashes against the TypeScript oracle
- WASM build, decoder, and browser-worker tests
- TypeScript architecture-invariant, integration, and public-API tests
- Canvas pixel goldens and reader end-to-end tests
- package tarball checks before release

See [Current Development Status](./current-status.md) for the active migration
handoff and [Testing Pipeline](./testing-pipeline.md) for the detailed gates.
