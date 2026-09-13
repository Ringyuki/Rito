# Limitations

Rito is intentionally focused on EPUB rendering, not browser-equivalent
web layout. Anything the engine cannot honour is degraded with a recorded
reason or fails the chapter closed; nothing is silently misplaced.

## CSS Scope

- no flexbox
- no grid
- no multicolumn layout
- no `position: fixed`, `position: sticky` or `position: absolute`;
  `position: relative` is accepted only with inert (auto or zero) insets
- no `min-height` or `max-height` on blocks yet
- `transform` supports `rotate()` only, on block boxes
- forced page breaks (`break-before: page` and friends) are projected as
  `auto`: pagination follows the multicolumn oracle
- `text-transform` and `text-justify` values other than the defaults are
  degraded

## Writing System Scope

- left-to-right and `vertical-rl` only; no RTL / BiDi
- vertical text is the first slice: upright columns with rotated and
  shifted punctuation; ruby, markers and inline atoms keep their
  horizontal path
- no automatic hyphenation (`hyphens: auto` is not implemented)
- one line breaker: greedy fill with the browser's break opportunities;
  there is no paragraph-optimal alternative

## Typography Overrides

- `setTypography()` is reader-wide and coarse: it overrides root and body
  behaviour and does not rewrite EPUB-authored selectors
- `fontFamily` / `fontFamilyForce` select among the faces the engine can
  shape with: a publication `@font-face` family name picks that font, while
  every generic family resolves to the pinned faces in policy order and
  system font names are unavailable. Offer font choices by opening the
  reader with a policy containing the chosen faces.

## Durable Source Locators

Durable source-locator projection resolves unavailable today for:

- exact source-anchored reading-position restore (page-index persistence
  works)
- `search()` result `source` ranges (matches and navigation work; callers
  recover durable ranges through `getChapterTextIndices()`)
- search highlights painted from a committed source range

`resolveExactSourceRange` itself works, including across soft-wrapped
lines, so annotation re-projection from stored source ranges is unaffected.

## Loading Model

- the archive stays in memory; the first chapter is laid out eagerly and
  later chapters and binary resources load as they are needed
- ZIP, inflation and XML resource budgets are not enforced; do not treat
  arbitrary untrusted EPUB input as unbounded data
- browser fonts and images are prepared by the browser binding (`FontFace`,
  `createImageBitmap`); Flutter decodes images in the application

## Platform Assumptions

- the main `@ritojs/core` entry is the browser reader facade over the WASM
  engine; it depends on `Worker`, `FontFace`, `createImageBitmap`, Canvas
  and optionally `OffscreenCanvas`
- `@ritojs/kit` assumes `OffscreenCanvas` support for its compositing
- `rito_flutter` paints through Skia; residual differences against the
  browser pen are rasterizer-level and itemized in
  `tools/paint-parity/EXEMPTIONS.md`
- the Flutter pen replays text left to right and cannot promise
  browser-identical complex-script shaping; WOFF/WOFF2 faces need a
  transcoding registrar; inset box shadows and 3D border styles fail
  closed there

## Format Scope

- EPUB 3 first
- no explicit EPUB 2 compatibility layer

## Guidance

These limitations are deliberate boundary choices. If you need broad
browser CSS compatibility, Rito is the wrong abstraction. If you need
controllable EPUB pagination that renders the same page on every host,
these tradeoffs are intentional.
