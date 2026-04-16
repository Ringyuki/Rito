# Capabilities

This page describes what Rito is designed to support today.

## EPUB

- EPUB 3 container metadata, manifest, and spine parsing
- NAV and NCX table of contents parsing
- lazy chapter reads via `EpubDocument.readChapter()`
- embedded stylesheet, font, image, and SVG cover extraction

## XHTML Parsing

- block and inline node parsing
- text nodes with source references
- images
- tables and lists
- chapter-level body attributes and linked stylesheet discovery

## CSS / Style Resolution

- element, class, id, compound, descendant, child, and adjacent-sibling selectors
- attribute selectors
- `:first-child` and `:last-child`
- `::before` and `::after` with string `content`
- specificity and cascade resolution
- inheritance
- `@font-face`
- `rem`
- `calc()`
- `box-sizing`, `border-radius`, and `opacity`
- `box-shadow`, `text-shadow`, and 2D `transform`
- `object-fit` for images
- chapter-scoped body styles

## Layout / Pagination

- block layout
- greedy and Knuth-Plass line breaking
- Liang hyphenation (`en-us`)
- floats
- inline images and inline atoms
- `display: inline-block`
- tables
- lists
- `margin: auto`
- `overflow: hidden`
- `vertical-align`
- `position: relative` and `position: absolute`
- page-break controls
- widow/orphan handling
- chapter-start-aware spread building
- single-page and double-page spread modes

## Rendering

- page and spread rendering to Canvas
- theme-aware background and foreground overrides
- WCAG-aware foreground replacement in dark mode scenarios
- paint-ready layout/render boundary

## Interaction Primitives

- hit maps
- link maps
- text selection
- full-text search
- source-anchored annotations
- reading position tracking
- semantic tree generation
- accessibility mirror helpers

## Reader Surface / Controller Layer

Through `@ritojs/kit` and `@ritojs/react`, the ecosystem also supports:

- animated page transitions
- overlay rendering for selection, search, and annotations
- pointer, touch, and keyboard wiring
- local-storage backed reading position and annotations
- React hooks and mount components

## Related Docs

- [Limitations](./limitations.md)
- [Architecture](./architecture.md)
