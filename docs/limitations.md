# Limitations

Rito is intentionally focused on EPUB rendering, not browser-equivalent web layout.

## CSS Scope

- no flexbox
- no grid
- no multicolumn layout
- no `position: fixed`
- no `position: sticky`
- no `@media` queries
- no general sibling combinator (`~`)
- no full browser-equivalent positioned-layout model

## Writing System Scope

- left-to-right layout only
- no RTL / BiDi support
- bundled hyphenation patterns are currently `en-us` only

## Typography Overrides

- `setTypography()` is reader-wide and coarse
- it overrides root/body behavior
- it does not rewrite EPUB-authored selectors

## Loading Model

- ZIP inflation is eager
- `createReader()` and `prepare()` paginate the full spine up front
- browser-side resource preparation is eager for fonts/images used by the current pipeline

## Platform Assumptions

- browser-oriented rendering pipeline
- core rendering depends on browser APIs such as `FontFace` and `createImageBitmap`
- `OffscreenCanvas` is supported by the core but not required for the basic `Reader` path
- `@ritojs/kit` assumes `OffscreenCanvas` support for its compositing architecture

## Format Scope

- EPUB 3 first
- no explicit EPUB 2 compatibility layer

## Guidance

These limitations are deliberate boundary choices for this project.
If you need broad browser CSS compatibility, Rito is the wrong abstraction.
If you need controllable EPUB pagination and Canvas rendering, these tradeoffs are intentional.
