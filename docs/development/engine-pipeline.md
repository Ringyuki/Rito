# Engine Pipeline

One engine lays out and paints every page. This page follows a chapter
from the archive to the bytes a host blits, naming the crate and module
that owns each stage.

```text
EPUB archive
  │  crates/rito-core/src/epub        container, package, spine, TOC, resources
  ▼
XHTML source tree
  │  crates/rito-source                immutable node arena with source spans
  ▼
Computed style
  │  crates/rito-stylo                 Stylo cascade behind a private facade
  │  crates/rito-style-contract        typed, versioned style tables
  ▼
Formatting tree
  │  crates/rito-core/src/fragment_bridge.rs
  ▼
Fragment tree (pages)
  │  crates/rito-fragment              the layout contract
  │  crates/rito-block                 block flow and fragmentation
  │  crates/rito-inline                Parley-backed inline flows
  ▼
Display commands (CSS pixels)
  │  crates/rito-core/src/fragment_paint.rs
  ▼
Primitives (device pixels)
  │  crates/rito-core/src/render/lower
  ▼
RITODL1 format 2
  │  crates/rito-core/src/render/commands/reader_wire
  ▼
Hosts blit: web Canvas pen, Flutter pen
```

## Parsing

`rito-core::epub` reads the container, the package document, the spine,
the manifest and both table-of-contents forms, and indexes stylesheets,
fonts and images by href. Chapters parse on demand. `rito-source` owns
the XHTML node arena: an immutable topology whose nodes carry source
spans, which every later stage addresses by index. Reader semantics that
are engine-independent (footnote asides, note anchors, link targets) are
resolved on this tree before layout sees it.

## Style

`rito-stylo` runs the real Stylo cascade over the source arena with the
publication's stylesheets, the reading-system UA stylesheet (`ua.rs`,
the single place reading-system defaults such as `img { object-fit:
contain }` are declared) and presentational hints. Stylo types never
leave that crate. The result is projected into the typed tables of
`rito-style-contract`: a layout table (`LayoutStyleTable`) and an
inline table (`InlineStyleTable`), both indexed by source node. Every
consumer downstream reads those tables; nothing re-parses CSS.

Colours reach paint as 8-bit sRGB (`style/paint_values.rs`), the way a
browser stores a legacy colour value; a colour in another space is a
recorded degradation, not a guess.

## Bridge

`fragment_bridge.rs` turns one chapter's source tree and style tables
into a `FormattingTree`: block containers, inline flows of typed items,
sized leaves (rules, images), table structure, list markers, ruby pairs.
It is also the capability gate. A property the layout crates cannot
honour is either degraded with a recorded reason or fails the chapter
closed; the tree never carries a value the engine would silently
misplace. Layout-inert paint (block backgrounds, borders, shadows,
transforms, rules) is collected here as typed `NodePaint` entries that
the painter applies later.

## Layout

`rito-fragment` defines the contract: `FormattingTree + ConstraintSpace +
BreakToken -> FragmentTree`. `rito-block` composes block flow with CSS
margin collapsing, floats and clearance, tables and fragmentation into
pages, resuming from break tokens. `rito-inline` lays out inline flows
with Parley: shaping, line breaking with Chromium's tailoring, CJK
punctuation compression, justification, spacing, ruby measurement and
outside list markers. It shapes with exactly the font bytes it was
constructed with — the reader's pinned faces plus the publication's
`@font-face` bindings — so page N is the same page on every platform.

Layout happens in CSS pixels on a 1/64 px grid where the browser does.
The device pixel ratio is a paint parameter only: pagination and page
counts are identical at every ratio.

## Paint

`fragment_paint.rs` walks a page's fragment tree and emits typed
`DisplayCommand`s (`render/commands.rs`): page and block paint, text and
ruby runs with the origin of every glyph cluster, images, rules, clips
and transforms. Coordinates are stored at display precision (six
decimals, exact for every 1/64 position). A text run's baseline is the
one place the ratio enters here: it rounds on the device grid the way
the browser's two-stage raster does.

## Lowering

`render/lower` resolves each command to device primitives: box edges and
border widths snap to whole CSS pixels, borders become bands and dashes,
radii become paths, shadows get their sigma, backgrounds size and tile,
inline boxes and decoration lines become fills around their text run,
and the finished primitives scale by the ratio last. A text run stays in
CSS pixels; the host draws it under `scale(ratio)` because glyph
rasterization follows the CSS font size.

## Wire and pens

The primitive list is encoded as `RITODL1` format 2 (see
[Wire Format](./wire-format.md)). The web pen
(`packages/rito/src/bindings/browser/primitive-renderer.ts`) and the
Flutter pen (`packages/rito_flutter/lib/src/render/primitive_replayer.dart`)
decode and blit; neither holds a layout or paint law. A browser reader
runs the engine in a Worker through `crates/rito-wasm`; Flutter and other
native hosts use the C ABI in `crates/rito-ffi`.

## Runtime

`rito-core::runtime` owns document handles, layout revisions, the
per-revision frame cache, resources and interaction geometry. A layout
change creates a revision; hosts request spread frames (lowered bytes
plus metadata) and resources against that revision. Interaction reads
(page targets, text carets and ranges, search, source-anchored ranges,
page semantics) are served from the fragment page artifacts, never
inferred from paint.

## Doctrine

- The browser is the oracle. A layout or paint rule is proven by the
  pixel walk against pinned Chromium, not by a unit test alone.
- Fail closed or degrade with a record. No stage guesses.
- Typed end to end. No JSON, CSS token strings or host-side inference on
  the production path; JSON exists only in the test-support fixture
  codec the paint-parity instrument reads and writes.
