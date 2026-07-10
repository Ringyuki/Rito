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

- ZIP inflation is eager, but archive, entry, total-output, entry-count, and compression-ratio budgets are enforced before/during inflation
- each XML/XHTML resource is limited to 32 MiB before and after normalization, depth 256, 50,000 retained tree nodes, 100,000 parser events, and 50,000 attributes
- `createReader()` and `prepare()` from `@ritojs/core/web` paginate the full spine up front
- Web resource preparation is eager for fonts/images used by the current pipeline; image decoding is concurrency-limited and measurement caches are bounded

## Platform Assumptions

- the main `@ritojs/core` entry is platform-neutral at the render/backend boundary
- core EPUB/XML parsing is DOM-free and uses no browser or emulated DOM APIs
- `@ritojs/core/web` depends on browser APIs such as `FontFace`, `createImageBitmap`, Canvas, and optional `OffscreenCanvas`
- `OffscreenCanvas` is supported by the Web preset but not required for the basic `Reader` path
- `@ritojs/kit` assumes `OffscreenCanvas` support for its compositing architecture

## Format Scope

- EPUB 3 first
- no explicit EPUB 2 compatibility layer

## Guidance

These limitations are deliberate boundary choices for this project.
If you need broad browser CSS compatibility, Rito is the wrong abstraction.
If you need controllable EPUB pagination with a Web Canvas preset or a custom display-list backend,
these tradeoffs are intentional.
