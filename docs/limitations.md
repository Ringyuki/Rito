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
- `fontFamily` / `fontFamilyForce` are accepted but do not change the rendered
  faces yet: the pinned fallback chain applies in policy order, and selecting
  faces by the override's generic family is not implemented. Offer font
  choices by opening the reader with a policy containing the chosen faces.

## Durable Source Locators

Under the fragment engine (the only pipeline), durable source-locator
projection resolves unavailable today:

- exact source-anchored reading-position restore (page-index persistence works)
- `search()` result `source` ranges (matches and navigation work; callers
  recover durable ranges through `getChapterTextIndices()`)
- search highlights painted from a committed source range
- internal-link navigation that must grow pagination past the known extent

`resolveExactSourceRange` itself works, including across soft-wrapped lines,
so annotation re-projection from stored source ranges is unaffected.

## Loading Model

- the root `createReader()` path is Rust-backed and keeps EPUB parsing,
  pagination, frame cache, and resource scheduling behind the native runtime
- the older TypeScript reference pipeline is source-only and may paginate the
  full spine up front when used by diagnostics or golden tooling
- the Rust-backed path keeps the archive in memory, loads the first chapter
  eagerly, and loads later chapters and binary resources as they are needed
- configurable ZIP, inflation, and XML resource budgets from the TypeScript
  reference have not yet been mirrored by the Rust production path; do not
  treat arbitrary untrusted EPUB input as unbounded data
- browser resource preparation is still browser-bound for fonts and images
  used by the current Canvas presentation layer

## Platform Assumptions

- the main `@ritojs/core` entry is the app-facing browser reader facade backed by
  the native core
- the browser facade depends on browser APIs such as `FontFace`,
  `createImageBitmap`, Canvas, and optional `OffscreenCanvas`
- `OffscreenCanvas` is supported by the browser facade but not required for the basic `Reader` path
- `@ritojs/kit` assumes `OffscreenCanvas` support for its compositing architecture

## Format Scope

- EPUB 3 first
- no explicit EPUB 2 compatibility layer

## Guidance

These limitations are deliberate boundary choices for this project.
If you need broad browser CSS compatibility, Rito is the wrong abstraction.
If you need controllable EPUB pagination with a Web Canvas preset or a custom display-list backend,
these tradeoffs are intentional.
