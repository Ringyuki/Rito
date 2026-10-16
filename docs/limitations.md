# Limitations

Rito is intentionally focused on EPUB rendering, not browser-equivalent
web layout. Anything the engine cannot honour is degraded with a recorded
reason or fails the chapter closed; nothing is silently misplaced.

## CSS Scope

- no flexbox
- no grid
- no multicolumn layout
- no `position: fixed` or `position: sticky`; `position: relative` is
  accepted only with `auto` insets
- `position: absolute` places a block-level box (a `::before` or `::after`
  included) against the border box of its nearest positioned ancestor,
  so a containing block with borders places it off by their widths; an
  absolutely positioned inline element stays in its line
- `::before` and `::after` show their strings and `attr()` values;
  `counter()`, quotes and images in `content` show nothing
- a floated image is a float only when it opens its block's content; one
  that follows text on its line stays an inline image
- no `min-height` or `max-height` on blocks yet
- `transform` supports `rotate()` only, on block boxes
- forced page breaks (`break-before: page` and friends) are projected as
  `auto`: pagination follows the multicolumn oracle
- `text-transform` and `text-justify` values other than the defaults are
  degraded
- inset box shadows are not painted
- `@font-face` sources in WOFF or WOFF2 are not decoded: text set in such
  a face falls to the next face its family list resolves to

## Writing System Scope

- left-to-right and `vertical-rl` only; no RTL / BiDi
- vertical text is the first slice: upright columns with rotated and
  shifted punctuation, ruby annotations run down beside their base and
  inline images keep their physical box
- no automatic hyphenation (`hyphens: auto` is not implemented)
- one line breaker: greedy fill with the browser's break opportunities;
  there is no paragraph-optimal alternative

## Typography Overrides

- `setTypography()` is reader-wide and coarse: `fontSize` sets the root
  font size, and `lineHeight` and `fontFamily` apply as a user-origin rule
  on every element, which loses to a declaration the book makes on that
  element unless the matching force flag is set
- `fontFamily` names faces the engine can shape with: the publication's
  `@font-face` families and the host's faces (the pinned policy plus faces
  added with `addFontFaces`). A system font is usable once its bytes are
  added (the Local Font Access API exposes them); its name alone resolves to
  nothing, and `unresolvedFontFamilies` reports it. Variable fonts are
  rejected as host faces.

## Durable Source Locators

A `search()` result reports its `source` as unavailable when the engine
cannot prove the match against the chapter's source text; the match and
navigation to it still work, and `@ritojs/kit` paints no highlight for such
a result.

Otherwise reading positions are restored through their source locators, and
annotations and search highlights are projected from stored source ranges
by `resolveExactSourceRange`, including across soft-wrapped lines.

## Loading Model

- the archive stays in memory; the chapter being read is laid out first
  and the whole book behind it, and chapter sources and binary resources
  are read from the archive when first needed
- ZIP, inflation and XML budgets are enforced and fail the open or the
  chapter: at most 512 MiB archive bytes, 10,000 entries, 128 MiB per
  inflated entry, 512 MiB inflated in total and a 200:1 compression ratio,
  inflation stops at the declared size, and an XHTML document is limited to
  128 levels of nesting and 1,000,000 nodes
- browser fonts and images are prepared by the browser binding (`FontFace`,
  `createImageBitmap`); `rito_flutter` decodes images with Flutter's codec
  when the session has an image cache, and takes them from the application
  otherwise

## Platform Assumptions

- the main `@ritojs/core` entry is the browser reader facade over the WASM
  engine; it depends on `Worker`, `FontFace`, `createImageBitmap`, Canvas
  and optionally `OffscreenCanvas`
- `@ritojs/kit` assumes `OffscreenCanvas` support for its compositing
- `rito_flutter` paints through Flutter's own rasterizer; the differences
  against the browser pen measured under Skia are rasterizer-level and
  itemized in `tools/paint-parity/EXEMPTIONS.md`
- the Flutter pen draws each text cluster left to right through Flutter's
  own shaper and cannot promise browser-identical complex-script shaping

## Format Scope

- EPUB 3 first
- no explicit EPUB 2 compatibility layer

## Guidance

These limitations are deliberate boundary choices. If you need broad
browser CSS compatibility, Rito is the wrong abstraction. If you need
controllable EPUB pagination that renders the same page on every host,
these tradeoffs are intentional.
