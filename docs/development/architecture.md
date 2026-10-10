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
crates/rito-wasm             the reader session through wasm-bindgen, for the browser
crates/rito-ffi              the C ABI actor for native hosts
crates/rito-inline-spike     a line-break parity instrument, never a dependency

packages/rito-core-wasm      private WASM build, session worker and wire decoders
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
8. documents, revisions, the reader session and its wire, resources (`runtime`)
9. locators, search, selection, annotations, footnotes (`interaction`)

`layout` holds only the layout configuration and the page ranges a
revision publishes per chapter. The `ENGINE_MODULES` inventory in
`lib.rs` is checked by `tests/workspace_smoke.rs`.

The host boundary is one protocol, the reader session. A host opens a
publication, asks for the page at a locator under a layout, and gets an
artifact: one spread's paint, its hit targets and semantics, and the
fonts and images it draws. The chapter that page is in is laid out first,
alone, so the page is on screen after one chapter's work; the whole book
is laid out behind it and adopted as the same page under its book-wide
number. Every later question — a turn, a spread by its position, a
selection, a search, a footnote — names an artifact, and through it the
revision the artifact came from. Page and spread indexes are
revision-local; durable positions use source locators.

A revision holds its page table, not its pages: its page numbers are
final the moment it exists, while the fragment trees and interaction
artifacts behind those numbers are rebuilt into a bounded working set as
queries reach them. Memory is therefore proportional to what is being
read, not to the length of the book, which matters most in the browser,
where a WebAssembly heap only grows and a peak becomes a floor.

## Host boundaries

`rito-wasm` exports one class, the reader session, and moves its wire
messages across the boundary; it owns no reader policy. `rito-ffi` runs a
session on one actor thread and exchanges fixed-width values and owned
byte buffers. The messages are the same on both: open, seek, adjacent
turns and peeks, a spread by its position, candidate adoption, background
advance, resources, fonts, footnotes, search, text geometry, source
ranges, selection, annotation targets and reading-position questions.

`packages/rito/src/bindings/browser/**` is the only place browser APIs
live: it runs the session in a Worker, decodes its artifacts, registers
fonts and decodes images, and blits primitives on Canvas. The reader it
builds on the session (`session-reader/`) holds one committed layout at a
time — the chapter being read, then the whole book — and replaces the
visible artifact only by the session's compare-and-swap. It must not
paginate, parse CSS, place a glyph or infer semantics from paint.

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
- There is one host protocol. The browser through WASM and native hosts
  through the C ABI speak the reader session; nothing else reaches the
  engine.
- An artifact belongs to a revision, and the visible artifact is replaced
  only by compare-and-swap: a stale answer cannot replace the page shown.
- A page of a chapter laid out alone is the page the whole-book layout
  gives that chapter, byte for byte.
- A page rebuilt into the working set is identical to the page the
  whole-book pass produced; a disagreement fails the read.
- Revisions and live artifacts have explicit lifecycles and a bounded
  count; a host releases what it no longer shows.
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
