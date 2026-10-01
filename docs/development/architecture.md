# Architecture

One Rust engine lays out and paints every page. Hosts transport its
output and blit it; none of them owns a layout or paint rule.

## Shape

```text
crates/rito-source           immutable XHTML source arena
crates/rito-style-contract   typed, versioned style values and tables
crates/rito-stylo            the Stylo cascade behind a private facade
crates/rito-fragment         the layout contract: tree + constraints + break token -> fragments
crates/rito-block            block flow, floats, tables, fragmentation into pages
crates/rito-inline           Parley-backed inline flows
crates/rito-core             EPUB, XHTML, style projection, the bridge, paint,
                             lowering, the wire, interaction, resources, runtime
crates/rito-wasm             wasm-bindgen facade over rito-core for the browser
crates/rito-ffi              the C ABI actor for native hosts
crates/rito-inline-spike     a line-break parity instrument, never a dependency

packages/rito-core-wasm      private WASM build and decoder workspace
packages/rito                @ritojs/core: the browser reader and Canvas pen
packages/kit                 @ritojs/kit: controller, transitions, overlays
packages/react               @ritojs/react: hooks and a mount component
packages/rito_flutter        the Flutter adapter and pen (pub.dev)
apps/reader                  the demo reader and its e2e harness
tools/corpus-oracle          the pixel walk and corpus probes
tools/paint-parity           the two-pen raster diff
```

Dependencies point toward the engine. The Rust crates never depend on
browser, Canvas, React or application code; `@ritojs/core` never depends
on kit or react.

## Rust engine boundaries

`rito-core` owns, in order:

1. EPUB archive and publication parsing (`epub`)
2. XHTML source trees and document semantics (`xhtml`, over `rito-source`)
3. style resolution and the typed projection (`style`, over `rito-stylo`)
4. the formatting tree and its capability gates (`fragment_bridge`)
5. pagination through the fragment crates (`fragment_pagination`)
6. paint: typed display commands from fragment trees (`fragment_paint`)
7. lowering to device primitives and the `RITODL1` wire (`render`)
8. document handles, revisions, frame caches, resources (`runtime`)
9. locators, search, selection, annotations, footnotes (`interaction`)

`layout` holds only the layout configuration and the page ranges a
revision publishes per chapter. The `ENGINE_MODULES` inventory in
`lib.rs` is checked by `tests/workspace_smoke.rs`.

The runtime boundary is a long-lived document handle. A layout change
creates a revision; hosts request spread frames and resources against
that revision. Page and spread indexes are revision-local; durable
positions use source locators.

A revision holds its page table, not its pages: pagination is
whole-book, so page numbers are final immediately, while the fragment
trees and interaction artifacts behind those numbers are rebuilt into a
bounded working set as queries reach them. Memory is therefore
proportional to what is being read, not to the length of the book,
which matters most in the browser, where a WebAssembly heap only grows
and a peak becomes a floor.

## Host boundaries

`rito-wasm` is a narrow binding: it serializes typed results and moves
bytes across the boundary, and owns no reader policy. `rito-ffi` runs a
session on one actor thread and exchanges fixed-width values and owned
byte buffers. The session protocol — open, seek, adjacent turns and
peeks, candidate adoption, background advance, resources, footnotes,
search, text geometry, source ranges, selection, annotation targets and
reading-position questions — is the same set of binary messages
`openBrowserReaderSession()` carries in the browser.

`packages/rito/src/bindings/browser/**` is the only place browser APIs
live: it loads the WASM module, runs the document runtime in a Worker,
transfers frame bytes and resources, registers fonts and decodes images,
and blits primitives on Canvas. It must not paginate, parse CSS, place a
glyph or infer semantics from paint.

`rito_flutter` decodes the same owned wire messages in Dart and paints
them with a `CustomPainter`; the engine is compiled by Flutter's Native
Assets hook from the tracked Rust source closure.

## Required invariants

- Rust owns parsing, style, layout, pagination, paint and interaction
  geometry; hosts blit.
- Layout and paint code has no Canvas or browser dependency.
- The display list is typed end to end; JSON exists only in the
  test-support fixture codec.
- The render module depends on no style, DOM or CSS engine.
- A frame and every resource lease belong to a revision; a stale revision
  response cannot replace the active one.
- A page rebuilt into the working set is identical to the page the
  whole-book pass produced; a disagreement fails the read.
- Revision and frame caches have explicit lifecycles and budgeted
  cleanup.
- Public TypeScript exports go through `packages/rito/src/index.ts` and
  stay small.
- Engine, wire encoder and every decoder come from the same commit.

The guards that enforce them are listed in
[Verification Instruments](./verification-instruments.md#architecture-guards).

## Verification strategy

Every change is checked at the boundary it touches, and every layout or
paint change is checked against the browser:

- Rust unit and integration tests for parsing, style, layout, lowering,
  wire validation and runtime lifecycle
- WASM build, decoder and Worker tests; TypeScript architecture, unit and
  integration tests; Dart protocol and pen tests
- pixel goldens and reader end-to-end tests in Chromium
- the pixel walk over real books against pinned Chromium and the two-pen
  paint-parity diff

See [Testing Pipeline](./testing-pipeline.md) and
[Verification Instruments](./verification-instruments.md).
