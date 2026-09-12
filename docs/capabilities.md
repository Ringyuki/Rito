# Capabilities

What the engine parses, lays out and paints today. Every item below is
implemented in the Rust engine and reaches every host the same way; the
pixel walk against pinned Chromium is the acceptance bar for the layout
and paint items.

## EPUB

- EPUB 3 container, package document, manifest and spine
- NAV and NCX tables of contents
- chapters parsed on demand inside the runtime
- embedded stylesheets, `@font-face` fonts, images and SVG covers

## XHTML

- an immutable source tree with source spans on every node, addressed by
  index by every later stage
- chapter body attributes and linked stylesheet discovery
- footnote asides and note anchors resolved before layout

## CSS and Style

Style is resolved by Stylo, the same cascade Servo and Firefox use, then
projected into typed tables the layout crates read:

- the full selector grammar Stylo supports, specificity, inheritance and
  inline styles
- `@font-face`, `@media` queries evaluated against the reader's viewport
- `rem`, `em`, `calc()`
- presentational hints (`bgcolor`, `width`, `align` and friends)
- a reading-system UA stylesheet: `img { object-fit: contain }`, images
  never exceed one page, `hr` renders as the browser's inset bevel
- `box-sizing`, `border-radius` (uniform, per-corner and percentage),
  `box-shadow`, `text-shadow`, `transform: rotate()`, `object-fit`
- colours as 8-bit sRGB; `currentColor` resolved at the source

## Layout

- block flow with CSS margin collapsing, fixed widths and heights,
  `margin: auto` centering, `max-width`
- pagination into pages of the requested size, resuming split blocks and
  paragraphs across pages
- floats with `clear`
- inline flows shaped and broken by Parley: Chromium's line-break
  tailoring, CJK punctuation compression (`text-spacing-trim`), greedy
  breaking, justification, letter and word spacing, `text-indent`,
  `white-space` preservation
- inline boxes with backgrounds, padding, borders and margins; `super`
  and `sub` baseline shifts
- inline-block atoms
- images with intrinsic sizing, EXIF orientation, `object-fit: contain`
  letterboxing and SVG `viewBox` placement
- tables with row groups, collapsed borders and CSS column sizing
- lists with outside markers shaped by the engine
- `hr` rules including the inset bevel pair
- ruby with `ruby-align`, mono-ruby pairing and annotation growth
- `writing-mode: vertical-rl` as upright glyph columns with rotated and
  shifted punctuation
- single-page and double-page spreads with chapter-start-aware pairing

## Paint

- every page lowered in the engine to device-pixel primitives: fills,
  paths, strokes with dash cadences, shadows, images with tiling, text
  and ruby runs carrying the origin of every glyph cluster
- box edges and border widths snapped to whole CSS pixels, glyph
  baselines snapped on the device grid, the way the browser rasters
- `RITODL1` format 2 as the only wire; hosts blit and never interpret
- theme background and foreground overrides without re-pagination
- pinned fonts shared by layout and paint on every host

## Interaction

- page targets: links, note anchors with their footnote key, images
- text carets from points, exact document-order ranges, selection
  movement by character, word, line, paragraph and chapter edge
- full-text search with revision-scoped results
- durable source-anchored ranges re-projected through
  `resolveExactSourceRange`
- footnotes as sanitized HTML fragments
- page semantics for an accessibility mirror
- reading anchors for position persistence

## Hosts

- web: the engine as WASM in a Worker, a Canvas presenter, `@ritojs/kit`
  and `@ritojs/react` on top
- Flutter: `rito_flutter` over the C ABI with a `CustomPainter` pen
- any native host: the C ABI in `crates/rito-ffi`

## Related Docs

- [Limitations](./limitations.md)
- [Engine Pipeline](./development/engine-pipeline.md)
