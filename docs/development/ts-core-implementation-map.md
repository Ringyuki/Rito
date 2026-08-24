# TS Core Reference Implementation Map

This document maps the TypeScript core that predates the Rust rewrite. It is now
the reference implementation used for parity work, golden diagnostics, and
display-detail comparison. Its job is to make the existing engine explicit: what
each layer owns, why that boundary exists, which contracts are worth preserving,
and which implementation details should not be copied blindly.

The app-facing production reader now enters through root `@ritojs/core`. The old
TypeScript reader is reachable only in source through `src/reference/index.ts`.
Do not add public compatibility or reference subpaths.

## Reading Order

Start with the public entrypoints, then follow the data flow:

1. `src/index.ts`
   Small public API and production reader entry.
2. `src/reference/index.ts`
   Internal source-only reference facade for tests, diagnostics, and parity work.
3. `src/reference/reader/**`
   Legacy TypeScript Canvas reader implementation.
4. `src/reference/ts-core/runtime/load-epub.ts`
   EPUB bytes to `EpubDocument`.
5. `src/reference/ts-core/runtime/pagination-session.ts`
   Parsed chapters to pages plus navigation/search metadata.
6. `src/reference/ts-core/layout/**`
   Styled tree to paint-ready layout blocks and pages.
7. `src/reference/ts-core/render/display-list/**`
   Pages/spreads to platform-neutral draw commands.
8. `src/reference/ts-core/render/backends/canvas/**`
   Canvas consumption of the display list.
9. `src/reference/ts-core/interaction/**`
   Hit maps, selection, search, anchors, annotations.

## API Rings

### `@ritojs/core`

`src/index.ts` exports the small stable surface and the production reader:

- Rust-backed `createReader` and runtime preload helper.
- Layout config and page/spread types.

Why: this keeps the app-facing reader stable while Rust owns the core runtime.

### Removed legacy subpaths

The package no longer exports `@ritojs/core/advanced`, `@ritojs/core/web`, or
focused helper subpaths for selection/search/annotations/position/a11y/dom.

Why: the old TypeScript implementation is a development reference, not a
production dependency surface. Controller-level interaction helpers now live in
`@ritojs/kit`.

### Source-only reference facade

`src/reference/index.ts` is not a package subpath. It exists so tests and
diagnostic scripts can intentionally import the TypeScript reference
implementation without reaching through random parser/layout/render internals.
The legacy TypeScript reader implementation itself lives under
`src/reference/reader/**`, and the legacy TypeScript core implementation lives
under `src/reference/ts-core/**`. Production reader code lives under
`src/reader/**` and browser binding code under `src/bindings/browser/reader/**`.

Rules:

- Do not add `./reference` to `package.json` exports.
- Do not import `src/reference` from production reader code.
- Do not import `src/reference` from `@ritojs/kit`, `@ritojs/react`, or
  `apps/reader`.
- Root old-core directories such as `src/layout`, `src/render`, and
  `src/runtime` are no longer present. Tests and public compatibility exports
  must import `src/reference/ts-core/**` explicitly. Do not put implementation
  logic back in root package source.

### Kit-owned interaction helpers

Selection, search, annotation, position, hit-map, a11y, and DOM helper code now
lives under `packages/kit/src/interaction/**`. That keeps `@ritojs/core` thin
while preserving controller behavior for `@ritojs/kit`, `@ritojs/react`, and
the reader app.

## End-To-End Reference Reader Flow

This is the legacy TypeScript reference reader path. It is no longer the
production `@ritojs/core` reader path, but it remains the parity oracle for
golden, diagnostic, and display-detail comparison work:

```text
createReader(data, canvas, options)
  -> loadEpub(data)
  -> loadAssets(document, canvas)
       -> loadFonts(document)
       -> loadImagesWithDecoder(document)
       -> create Canvas text measurer
  -> paginateWithAssets(document, layout, assets)
       -> paginateWithMeta(...)
       -> PaginationSession.paginateAll()
  -> buildSpreads(pages, layout, chapterStartPages)
  -> renderSpread(index)
       -> render(spread, ctx, layout, options)
       -> buildSpreadDisplayList(spread, layout, options)
       -> canvasDisplayListRenderer.render(...)
```

Two details are critical:

- Fonts are loaded before pagination so Canvas text measurement sees the book's
  fonts.
- Images are decoded before pagination so layout can use intrinsic dimensions.

If either step is skipped, pagination still runs, but text metrics and image
aspect ratios can be wrong. This is exactly the failure mode exposed by earlier
native/Node development bridges.

## EPUB Runtime Layer

### `loadEpub`

`src/reference/ts-core/runtime/load-epub.ts` parses the EPUB container and eagerly loads:

- OPF package metadata, manifest, spine.
- Stylesheets.
- Embedded fonts.
- Images.
- TOC from EPUB 3 NAV or EPUB 2 NCX.

Chapter XHTML is lazy through `document.readChapter(idref)`.

Why:

- Eager resource maps make pagination/resource adapters deterministic.
- Lazy chapter reading avoids parsing every chapter until pagination needs it.
- `EpubDocument` is a simple platform-neutral object that can be closed.

Important limitation:

- It relies on `DOMParser` for XML/HTML parsing, so non-browser tests use a DOM
  environment. A Rust port needs its own XML/XHTML parsing stack.

### `PaginationSession`

`src/reference/ts-core/runtime/pagination-session.ts` owns whole-book pagination state:

- Current spine index for incremental pagination.
- Accumulated pages.
- `chapterMap`: idref to page range.
- `anchorMap`: fragment id to page index.
- `chapterTextIndices`: source text indices for anchoring/search.
- `footnoteMap`: `manifestHref#fragment` to structured footnote entry.

`paginateNextChapter()` supports incremental same-chapter pagination.
`paginateAll()` resets state, pre-scans all chapters, extracts cross-document
footnotes, and paginates all chapters.

Why:

- Incremental pagination is needed for future async/cancel flows.
- Full pagination currently gives stronger metadata for TOC, anchors,
  footnotes, search, and annotations.

Rust implication:

- Keep the distinction between a pagination session and a revision.
- Preserve the metadata maps; they are not optional byproducts.

## Parser Layer

### EPUB Parser

`src/reference/ts-core/parser/epub/**` handles:

- ZIP file access.
- `META-INF/container.xml`.
- OPF package document.
- NAV/NCX TOC.
- Basic metadata/manifest/spine validation.

Why:

- EPUB structure is resolved before layout.
- Manifest hrefs become the canonical keys used later for resources,
  navigation, and footnotes.

Rust parity status:

- `crates/rito-core` now has a first EPUB parser path that reads the real EPUB
  ZIP, parses container/OPF/NAV/NCX, loads stylesheet/font/image resource
  summaries, and matches the TS `book-01 / smoke.greedy` fixture for package
  and resource output.
- It also resolves spine idrefs to raw chapter XHTML entries and matches the TS
  fixture's chapter href/linear/text length/text hash fields.
- It now parses chapter XHTML into Rust-owned source tree nodes and matches the
  TS fixture's parsed XHTML summaries and structural detail hashes for the same
  book/config pair.
- This is deliberately still below CSS/layout/render parity. It proves the Rust
  engine can consume the same source book and produce the same parser contracts,
  not that rendering parity exists yet.

### XHTML Parser

`src/reference/ts-core/parser/xhtml/xhtml-parser.ts` converts chapter XHTML into a small internal
tree:

- `block`, `inline`, `text`, and `image` nodes.
- Selected attributes: `class`, `style`, `id`, `href`, language, table spans.
- `allAttributes` for CSS attribute selector matching.
- `sourceRef.nodePath` for source anchoring.
- `<svg><image ...>` cover patterns become image nodes.
- `<br>` becomes a newline text node.
- Inline anchors around block children are unwrapped, with href/style copied
  down to block children.
- Chapter-local `<link rel="stylesheet">` hrefs are collected.
- `lang` and `xml:lang` are preserved for line-breaking behavior.
- Table cell `colspan` / `rowspan` are parsed onto node attributes.
- All raw element attributes are retained for CSS attribute selectors.
- Body attributes are returned separately so chapter body styles and
  presentational attributes can influence the styled root.

Why:

- Layout should not depend on DOM nodes.
- Source references enable text anchors, search, selection, and annotation
  geometry without re-reading DOM.
- The parser intentionally normalizes many EPUB quirks into a smaller model.

Not-to-copy blindly:

- Source refs are node paths inside a parsed tree. They are not stable
  publication locators by themselves.
- The inline-anchor-unwrapping rule is pragmatic and loses some ancestor
  selector semantics.
- Normal whitespace is collapsed during parsing; `<pre>` preserves raw text.

Rust parity status:

- `crates/rito-core` now has a Rust XHTML parser with TS-compatible summaries
  for the `book-01 / smoke.greedy` fixture.
- It preserves selected attributes, `allAttributes`, namespace-prefixed
  attributes such as `epub:type` and `xml:lang`, stylesheet links, body
  attributes, image sources, collapsed whitespace, and `sourceRef.nodePath`
  values.
- Current parity follows the generated TS fixture. In the fixture environment,
  the cover SVG is reported as an unsupported `SVG` element and skipped, even
  though the TS source has a narrower SVG image extraction path. Treat this as
  a fixture-discovered behavior to resolve deliberately before depending on SVG
  cover extraction in Rust.

## Style Layer

### CSS Parsing

`src/reference/ts-core/style/css/**` implements a purpose-built CSS subset:

- Rule extraction, comments, grouped selectors.
- `@font-face` parsing.
- Declaration parsing through property handlers.
- Values are converted into structured `ComputedStyle` fields.
- Unknown properties are ignored.
- `!important` is stripped but priority is not implemented.
- Viewport units are re-parsed during cascade when viewport is known.
- `calc()` supports arithmetic over resolved numeric lengths.
- Length parsing supports `px`, `pt`, `em`, `rem`, `%`, `vh`, `vw`, and bare
  numeric values in selected contexts.
- Property handlers cover text/font properties, spacing, borders/backgrounds,
  shadows, layout sizing/float/clear/position/page-break/widow-orphan, opacity,
  object-fit, and transform.
- Background shorthand is a focused parser for color, `url(...)`, repeat,
  size, and position; gradients are ignored.
- Transform parsing supports translate/scale/rotate and drops unsupported
  matrix/skew/3D functions.

Rust parity status:

- `crates/rito-core` now parses stylesheet rule blocks and `@font-face` entries
  far enough to match the generated TS fixture's selector hashes,
  raw-declaration hashes, declaration-key counts, font-face summaries, and CSS
  detail hashes for `book-01 / smoke.greedy`.
- The Rust fixture also includes normalized declaration value hashes, and the
  current Rust parser matches TS for the declaration subset exercised by the
  fixture: lengths, percentages, colors, margins, padding, background,
  borders, text shadow, transforms, font face, and common text properties.
- Rust now also exports selector-match summaries over the parsed XHTML tree and
  matches the TS fixture for chapter-scoped author rule matching, specificity,
  and cascade-ordered author-rule matches.
- This is not yet cascade parity. Inheritance, specificity ordering,
  viewport-dependent reparsing, UA/inline rules, and computed-style snapshots
  are still next.

Why:

- The engine only needs properties that affect EPUB layout/rendering.
- Structured style values let layout/render avoid CSS string parsing.
- The property-handler split is an important Rust-port checklist: every handled
  property is an intentional layout/render input.

### Selector Matching And Rule Index

`src/reference/ts-core/style/cascade/selector-matcher.ts` is not a full browser selector engine,
but it supports more than simple tag/class matching:

- Element, class, id, universal, and compound selectors.
- Descendant, child (`>`), and adjacent sibling (`+`) combinators.
- Attribute selectors: `[attr]`, `=`, `~=`, `|=`, `^=`, `$=`, `*=`.
- `:first-child` and `:last-child`.
- `::before` and `::after` extraction.
- Bracket/quote-aware splitting so spaces inside attribute selectors are not
  treated as combinators.

`src/reference/ts-core/style/cascade/rule-index.ts` pre-indexes rules by the rightmost compound
selector's tag/class/id keys, with a universal fallback and source-order
preservation.

Why:

- Matching every rule against every node is too expensive for full books.
- The rightmost compound selector is the only part that must match the target
  node, so it is a useful candidate filter before full selector matching.

Not-to-copy blindly:

- Unsupported pseudo-classes silently fail or are effectively stripped by the
  subset parser. A Rust port should either match this subset explicitly or move
  to a real CSS selector parser with defined unsupported behavior.

Rust parity status:

- `crates/rito-core` now has a selector matcher for the TS-supported subset:
  element/class/id/universal/compound selectors, descendant/child/adjacent
  sibling combinators, attribute operators, and first/last child pseudo-classes.
- The fixture exporter records per-chapter selector-match hashes using the
  current TS matcher and the same stylesheet-href filtering as pagination.
- The fixture exporter also records cascade-ordered author-rule match hashes,
  so Rust currently validates selector specificity and source-order-stable
  ordering for matching author rules.
- This does not yet validate rule-index candidate filtering, pseudo-element
  injection, inline style, UA rules, or computed style output.

### Cascade

`src/reference/ts-core/style/cascade/resolver.ts` applies:

1. Inherited parent style or `DEFAULT_STYLE`.
2. Runtime replaced-element defaults.
3. User-agent rules.
4. Author stylesheet rules.
5. Inline style.

It also:

- Tracks sibling context for selectors such as first/last child and adjacent
  sibling.
- Injects pseudo-elements.
- Applies language.
- Filters out `display: none`.
- Keeps body-level styles separate and supports runtime typography overrides.
- Applies `<body bgcolor="...">` as a legacy presentational background
  attribute.
- Sorts matches by origin rank (`ua`, `author`, `inline`) and specificity.
- Resolves `em` in two passes: first final `font-size` against the parent font
  size, then all other declarations against the element's final font size.

Why:

- Layout consumes a `StyledNode` tree, not raw CSS.
- Non-inherited properties are stripped by `inheritableStyle`, which prevents
  margins, borders, widths, backgrounds, and percentage fields from leaking to
  children.

Rust implication:

- The Rust style model should be structured from day one.
- The current CSS parser is useful as a subset definition, not as a model for
  robustness.

### Pseudo-Elements

`src/reference/ts-core/style/cascade/pseudo-elements.ts` injects synthetic styled nodes for
`::before` and `::after` when `content` resolves to text:

- Pseudo-elements inherit from the host, then apply their own declarations.
- Default pseudo-element display is inline.
- Block pseudo-elements under inline hosts are demoted to inline.
- If a block pseudo-element is mixed with inline/text children, inline runs are
  wrapped in anonymous block boxes.

Why:

- Pseudo-elements must enter the same layout pipeline as normal content.
- Anonymous block wrapping prevents inline children from being dropped by the
  block-child layout path.

## Layout Layer

The layout layer is platform-neutral and must not depend on Canvas or DOM APIs.
It consumes `StyledNode` and produces paint-ready layout types.

### Layout Config

`src/reference/ts-core/layout/core/config.ts` normalizes input into `LayoutConfig`:

- viewport size.
- page size.
- margins.
- spread mode and gap.
- root font size and typography overrides.
- pagination policy.

Why: the rest of layout reads one normalized object and does not need to
understand UI options.

### Block Layout

`src/reference/ts-core/layout/block/**` lays out styled nodes into continuous content-space
`LayoutBlock`s before pagination.

Major responsibilities:

- Margin collapse.
- Padding, border boxes, box sizing, auto margins.
- Flow blocks and container flattening/wrapping.
- Floats and clear.
- Images and replaced elements.
- Tables.
- Lists and markers.
- Absolute/relative positioning.
- Page-break flags.
- Paint aggregation from style into `BlockPaint`.
- Horizontal box metrics: percentage margins/padding, CSS width/max-width,
  `box-sizing`, and auto-margin centering.
- Container decision: visually decorated containers become wrapper blocks;
  undecorated containers are flattened into their children.
- List markers: `disc`, `circle`, `square`, decimal, alpha, and roman markers
  are injected as text runs before the first line.
- Horizontal rules use `border-top` style when present, otherwise a 1px solid
  line using the element color.

Why:

- Layout produces geometry and paint data together.
- Render does not ask style questions later.

Image layout depends on `ImageSizeMap`. If no intrinsic size exists,
`layout/block/image.ts` uses a fallback aspect ratio of `0.75`.

Rust implication:

- Image metadata must be available before layout.
- A native core cannot rely on the platform renderer to fix image geometry.

### Floats And Positioned Blocks

Floats live in `src/reference/ts-core/layout/block/float-layout.ts` and
`src/reference/ts-core/layout/block/float-context.ts`:

- Float sizing resolves margins, shrink-to-fit width, and side.
- Placement searches for the first vertical slot where the float fits.
- Active left/right float widths reduce available line/block space.
- `clear` resolves to the max float bottom for left/right/both.
- A small tolerance is used around float overlap checks to avoid sub-pixel
  browser divergence.

Absolute positioning lives in `src/reference/ts-core/layout/block/absolute-layout.ts`:

- Absolutely positioned children are laid out out-of-flow.
- `top/left/bottom/right` resolve relative to the containing block.
- Block children are laid out recursively; leaf content uses text layout.

Why:

- Floats and absolute blocks influence geometry but not normal-flow ordering in
  the same way as regular blocks.
- The current implementation is pragmatic EPUB layout, not a complete CSS 2.1
  visual formatting model.

### Tables

`src/reference/ts-core/layout/table/**` implements a compact table layout:

- Rows are collected from direct `tr` children and `thead/tbody/tfoot`.
- `colspan` contributes to column count; `rowspan` marks occupied cells in
  later rows.
- Column widths are computed from min/preferred intrinsic widths.
- Auto-width tables use preferred width capped by the container instead of
  always stretching.
- Cell content is either nested block layout or paragraph layout depending on
  child types.
- Row height is the max cell height; vertical alignment offsets cell children.

Why:

- EPUB tables need stable readable layout, but the implementation is a focused
  subset. It does not attempt full browser table layout parity.

### Text Layout

`src/reference/ts-core/layout/text/**` and `src/reference/ts-core/layout/line-breaker/**` own inline layout:

- Flatten styled inline content into segments.
- Convert styles into `RunPaint`.
- Create text runs, inline atoms, ruby annotations.
- Measure text via injected `TextMeasurer`.
- Greedy line breaking.
- Optional Knuth-Plass line breaking.
- Alignment, justification, vertical alignment, ruby placement.
- Hyphenation support.

Why:

- Text measurement is a platform capability, so layout takes a `TextMeasurer`
  instead of importing Canvas.
- Paragraph breaking is swappable.

Rust implication:

- This is one of the most important areas to rewrite carefully.
- Rust should own shaping/measurement/fallback, not ask every platform to do it
  differently.
- `crates/rito-core/src/layout/text_measure.rs` is the current Rust boundary
  for that decision. It still uses the TS fixture-compatible width policy so
  existing parity fixtures remain stable, but the pagination flow no longer
  owns the measurement formula directly.

### Inline Segments And Ruby

`src/reference/ts-core/layout/text/styled-segment-collector.ts` flattens styled inline trees into
segments before line breaking:

- Text transform is applied before measurement.
- Link href context is carried onto text/image atoms.
- Image nodes become inline atom segments.
- `inline-block` blocks become atom segments.
- Inline borders and inline margins are marked on first/last text fragments.
- Ruby nodes group base text with `rt` annotation text and ignore `rp` fallback
  markers.
- Source text and `sourceRef` are preserved on text segments for locators,
  search, selection, and annotation geometry.

Rust parity status:

- `crates/rito-core` now resolves styled XHTML trees into Rust `StyledNode`s and
  flattens block children into TS-compatible inline segment summaries.
- The fixture covers text, image atoms, inline-block atoms, inherited inline
  paint context, ruby annotations, href propagation, source paths, and image
  intrinsic sizing through the same href resolver semantics used by TS.
- The fixture also records the shared line-break input layer: object-replacement
  atom placeholders, style ranges, atom offsets, source text hashes, inline
  border fragment flags, ruby annotation labels, and href propagation.
- The Rust fixture now also checks greedy line-box summaries for the smoke
  layout: line counts, run/atom/ruby counts, text hashes, line/run geometry,
  CJK punctuation-safe breaks, `text-align: justify` expansion, text-indent,
  vertical alignment, line-height, and source text offsets.

Why:

- The line breaker should consume one linear stream of measured segments.
- Ruby and inline boxes have to be resolved before pagination, not at paint
  time.

### Line Breaking

The greedy line breaker and optional Knuth-Plass path are both important:

- Greedy breaking uses binary search for the longest fitting range, then adjusts
  candidates with `css-line-break`.
- CJK behavior depends on language and strictness classification.
- `Intl.Segmenter` is used for grapheme segmentation when available.
- Hyphenation is an ASCII-oriented helper, not a full language engine.
- Mixed-style text is measured by range, including spacing and inline
  margins/borders.
- Inline atoms occupy a replacement-character slot in the Knuth-Plass path.
- Knuth-Plass builds boxes/glue/penalties, solves active breakpoints with
  badness/demerits/fitness classes, and falls back to emergency breaks.

Rust implication:

- Text segmentation, shaping, line breaking, and font metrics should be treated
  as first-class native engine work. This is where platform divergence becomes
  visible fastest.
- The Rust core now has the Knuth-Plass solver, KP item builder, emergency
  fallback, and line-box reconstruction wired through the internal
  continuous/table/pagination orchestration. The item builder covers word boxes,
  whitespace glue, forced newline breaks, inline inset boxes, atom boxes, ASCII
  hyphenation penalties, and CJK inter-character glue. Reconstruction
  intentionally follows current TS KP behavior, including sourceTextOffset reset
  semantics, non-rendered break spaces, and trailing inline
  border/padding/margin application only on the last tracked fragment of a split
  segment. `white-space: pre/pre-wrap/nowrap` delegates to the existing greedy
  whitespace path. Public Rust load/revision entry points now accept `optimal`,
  and the 10-book `default.optimal` fixture matrix covers the current parity
  surface.

### Pagination

`src/reference/ts-core/layout/pagination/**` converts continuous blocks into pages:

- Computes spacing between blocks.
- Honors page-break before/after.
- Splits blocks where possible.
- Applies widow/orphan policy.
- Force-splits as fallback.
- Emits pages in content-space with page indexes.
- Validates positive page content height.
- Splits only line-box-only blocks in the normal path.
- Enforces default or block-level orphan/widow policy when enough lines exist.
- Force splitting ignores orphan/widow policy as the last overflow fallback.
- Tail blocks drop the original `anchorId` so the same anchor does not appear
  on both halves.

Why:

- Pagination is deliberately separate from block layout so it can split already
  laid-out content.

Rust implication:

- Keep pagination separate from block layout. It makes testing and incremental
  revision work easier.

### Spreads

`src/reference/ts-core/layout/spread/index.ts` pairs pages into spreads:

- Single mode: one page per spread.
- Double mode: left/right pages with optional first page alone.
- Chapter starts can force a right page to start a new spread.

Why:

- Spreads are a presentation grouping over already-paginated pages.

## Render Layer

### Display List

`src/reference/ts-core/render/display-list/**` converts pages/spreads into logical-pixel draw
commands:

- State: push/pop, translate, transform, opacity, clip.
- Paint: page, block, text, ruby, image, horizontal rule.
- Block decoration carries background, border, radius, and shadow.
- Text commands carry `RunPaint`.
- Image commands carry src and precomputed destination rect.

Why:

- This is the core platform-neutral render contract.
- Render backends should consume commands, not reinterpret layout or CSS.

Rust implication:

- Preserve or intentionally evolve this contract. It is the best bridge between
  current TS behavior and a future native core.
- Runtime-facing Rust frames must stay paint-ready: text/ruby commands expose
  raw strings for render backends, while fixture hashes may summarize those
  strings only in parity-only summaries.

### Canvas Backend

`src/reference/ts-core/render/backends/canvas/**` renders display lists to Canvas:

- Applies transform/clip/opacity state.
- Paints block backgrounds/borders/shadows/background images.
- Paints text/ruby from `RunPaint`.
- Draws images into the command rect.
- Handles dashed/dotted horizontal rules and border paths.

Why:

- Canvas is one backend. It should not own layout semantics.

### Web Resources

`src/reference/ts-core/render/web/resources.ts` owns the Web prepare path:

- Load fonts.
- Decode images.
- Create Canvas text measurer.
- Paginate with assets.
- Dispose decoded resources.

Why:

- Correct layout requires loaded fonts and image dimensions before pagination.
- Web resource loading is platform-specific, so it stays in `web`.

### Font And Image Resource Details

The resource adapters under `src/reference/ts-core/render/assets/**` are deliberately injected:

- `loadFontsWithRegistry()` parses `@font-face`, resolves font bytes through
  manifest href matching, and calls a platform `FontRegistry`.
- The Web registry wraps `FontFace` and `document.fonts`.
- `loadImagesWithDecoder()` decodes every EPUB image through a platform
  `ImageDecoder` and returns dimensions/images keyed by href.
- `createLazyImageLoaderWithDecoder()` is an optional LRU decoder with
  synchronous `resolveImage()` for cached images and async `preload()`.
- `collectPageImageSources()` and `collectSpreadImageSources()` walk layout
  output for block background images, block images, inline image atoms, and
  nested inline-block images.
- Canvas text measurement caches widths by font string, word spacing, letter
  spacing, and text, and resolves font metrics from Canvas text metrics with
  fallbacks.

Why:

- Layout needs dimensions and font metrics before painting.
- The display list carries image srcs, not bytes or decoded image objects.

Rust implication:

- A Rust core should own font registration, image metadata, and cache lifecycle
  explicitly. The current Web adapters show the dependency shape, not the ideal
  native implementation.

## Interaction Layer

`src/reference/ts-core/interaction/**` derives reader interactions from layout output.

### Hit Map

`interaction/core/hit-map.ts` builds page-content-space hit entries from:

- Text runs.
- Inline atoms.
- Block-level images.

It also resolves char positions using a `TextMeasurer`.

Why:

- Interaction should be derived from layout geometry, not display-list pixels.
- Bounds are explicitly in page-content space, without page margins.

### Selection, Search, Anchors, Annotations

The interaction layer also includes:

- Selection rects and selected text.
- Search indexing over page text.
- Source-based anchor models.
- Reading positions.
- Annotation rect resolution.
- Semantic tree construction.

Why:

- These are pure computation primitives over pages, hit maps, and source
  indices. They are not renderer-specific.

Rust implication:

- These APIs are strong candidates for direct Rust ownership.
- Source refs need a more durable locator story than raw node paths.

### Kit-owned Search And Position Helpers

The kit-owned search helper is page-based:

- It builds text by walking page text runs.
- It maps page text offsets back to run positions.
- It supports case-sensitive and ASCII-style whole-word search.
- It exposes stateful result navigation and highlight rect collection.

The kit-owned position helper serializes/restores coarse reading positions
using spread index, page index, and chapter map data.

Why:

- The older interaction helpers are useful Web API utilities.

Rust implication:

- Native search should not simply copy the page-based helper. It should be
  designed around chapter text indices, Unicode-safe folding, snippets, and
  durable locators once the Rust source model exists.

### Anchors And Annotation Selectors

`src/reference/ts-core/interaction/anchors/**` builds chapter-level normalized text indices and
selector models:

- `ChapterTextIndex` stores normalized text plus spans mapping source node paths
  to normalized offsets.
- Annotation targets derive source range, text quote, text position, and
  progression selectors from the same offset pair.
- Resolver fallback order is source range, quote, text position, then
  progression.
- Geometry resolution maps source/text offsets back to hit-map text segments
  and page-content rectangles.

Why:

- Durable annotations need multiple selector strategies, because source text
  can shift across revisions.
- The current source path model is useful inside one parsed chapter, but is not
  a stable publication locator by itself.

### Footnotes

`src/reference/ts-core/runtime/footnote-extractor.ts` handles EPUB structural footnotes:

- It collects `epub:type="noteref"` targets.
- Full-book extraction supports cross-document notes through manifest href
  resolution.
- Footnote keys are `manifestHref#fragment`, not bare fragments.
- Referenced footnote bodies are removed from normal chapter flow and stored as
  structured text/html entries.

Why:

- Footnotes should not paginate as duplicate body content when they are meant to
  be shown as reader UI.
- Href-aware keys avoid cross-chapter fragment collisions.

Rust implication:

- Carry noteref semantics through parsing/layout. Do not infer footnotes from
  arbitrary links later in the frame builder.

### DOM And Accessibility Helpers

`src/reference/ts-core/dom/**` and the `a11y`/`dom` subpaths are Web integration helpers:

- `bindPointerEvents()` drives `SelectionEngine` from canvas pointer events.
- `bindClipboard()` writes selected text on Cmd/Ctrl-C.
- `bindLinkCursor()` updates cursor state and invokes link callbacks.
- `createA11yMirror()` builds a visually hidden DOM mirror from the semantic
  tree for screen readers.

Why:

- These helpers are outside the engine. They should not influence Rust core
  design beyond showing the shape of platform shell responsibilities.

## Reader Facade

`src/reader/**` is the Web-facing high-level reader:

- Loads EPUB.
- Loads Web assets.
- Paginates and builds spreads.
- Renders spreads to Canvas.
- Handles resize, spread mode, line breaking, typography overrides.
- Provides TOC navigation, image blob URLs, footnotes, and chapter text indices.
- Manages resource disposal.

Why:

- It is a product-facing convenience API over the lower-level core.
- It is Web-specific because it owns Canvas/resource lifecycles.

Rust implication:

- Do not port this facade one-for-one.
- Port the engine underneath it; keep platform shells thin.

## Removed Reader Runtime Spike

The former `src/runtime/reader-session/**` and
`src/web/reader-runtime-worker-*.ts` spike has been deleted from `@ritojs/core`.
It was internal-only and unconsumed by the stable Web reader.

Lessons worth carrying into Rust planning:

- A long-lived document/session boundary is useful, but it should wrap proven
  Rust engine primitives rather than drive the first port.
- Layout revisions and stale-response gates are still important for async
  shells.
- Resource bytes should not be embedded in JSON control payloads.
- Unknown wire input belongs at the binding/message boundary.
- Frame cache and prefetch behavior must be validated against real rendering
  latency before becoming public contract.

Lessons not worth copying directly:

- The exact TypeScript command/response shapes.
- The worker-neutral transport stack before a real engine boundary exists.
- The TS frame builder as a substitute for native render parity.

## Shared Utilities

`src/reference/ts-core/utils/**` contains small cross-layer helpers:

- `resolve-href.ts` builds ambiguity-aware href resolvers used by images,
  fonts, navigation, and footnotes. Lookup order is exact href, unambiguous
  suffix, then unambiguous basename.
- `color.ts` parses CSS named/hex/rgb/hsl colors and computes WCAG contrast so
  display-list foreground overrides can avoid unreadable text.
- `logger.ts` provides a lightweight level-filtered logger used by load,
  pagination, resource, and runtime paths.

Why:

- These helpers encode behavior that affects EPUB correctness even though they
  are not parser/layout/render modules.
- Rust should keep href resolution deterministic and ambiguity-aware from the
  start.

## Test and Golden Infrastructure

### Unit Tests

`packages/rito/tests/unit/**` covers parser, CSS, layout, rendering,
interaction, runtime protocol, and architecture invariants.

### Architecture Invariants

`architecture-invariants.test.ts` enforces:

- Public entrypoint boundaries.
- Layout/render separation.
- Render cannot import `ComputedStyle`.
- Render cannot parse CSS strings.
- Runtime platform neutrality.

Why:

- These tests encode architectural intent and should influence Rust module
  boundaries.

### Golden Book Layout

`tests/golden-books/**` loads real EPUB fixtures, paginates them, and compares
JSON summaries.

Why:

- These are the best initial Rust layout oracle because they avoid pixel noise.

### Golden Pixel Render

`tests/golden-pixel/**` renders browser pixels through Playwright and compares
PNG outputs.

Why:

- This verifies end-to-end Web behavior, including Canvas text and image
  rendering.

### Render Command Goldens And Diagnostics

`tests/golden-render/**` stores normalized display-list/render-command summaries
for selected pages. These sit between structural layout JSON and final PNG
pixels.

`diagnose:render` uses `packages/rito/scripts/render-diagnostic-case.mjs` to
run focused book/spread diagnostics. The diagnostic workflow is important
because text and pagination bugs often need command/layout inspection before
pixel comparison is useful.

Rust implication:

- First compare Rust structural snapshots to golden-book summaries.
- Then compare display-list command summaries.
- Pixel parity should come later, after text shaping/image/layout parity is
  credible.

### Rust Parity Fixtures

`tests/rust-fixtures/**` contains compact summaries generated from the current
TypeScript core by `scripts/export-rust-fixtures.mjs`.

Why:

- Rust should compare against stable parser/package/resource/layout/display-list
  facts without needing to execute TypeScript in Rust tests.
- These fixtures are layer references, not public runtime protocol fixtures.
- Fixture style, layout, and pagination-flow summaries resolve chapters through
  the same internal html/body root, cascade, typography-override, and `rem`
  context as reference pagination. The exporter must not maintain a parallel
  chapter-style implementation.
- Compressed fixture checks compare the canonical JSON payload after
  decompression. Export keeps existing gzip bytes when that payload is already
  current, so zlib-version differences do not create fixture-only churn.
- Current fixtures include package/resource, XHTML, CSS, selector/cascade,
  computed style, interaction metadata, image dimensions, inline segment layout
  summaries, line-break input summaries, greedy/optimal line-box summaries, continuous
  layout, pagination, spread/display-list flow, hit-map, text-position, link-map,
  and search-flow summaries for `book-01` through `book-10` across
  `smoke.greedy`, `default.greedy`, `narrow.greedy`, and `default.optimal`.

## Contracts Worth Preserving

Preserve these ideas in Rust:

- Small stable public API.
- Separate parser, style, layout, render, interaction, runtime.
- Structured computed style.
- Selector subset behavior and rule indexing, or a consciously stronger
  replacement.
- Paint-ready layout types.
- Display-list command contract.
- `TextMeasurer`/font backend abstraction, but implemented once in Rust where
  possible.
- Image intrinsic size before layout.
- Pagination metadata: chapter map, anchor map, text indices, footnotes.
- Long-lived document/revision handles as a later binding-layer concept, not as
  a copied TS command protocol.
- Resource byte side channel for JS/native bindings once Rust owns resource
  storage.
- Architecture tests as executable boundary checks.
- Golden ladder: layout snapshots, render-command snapshots, then pixel
  snapshots.
- Href resolution rules: exact match, unambiguous suffix match, unambiguous
  basename match.
- Logger/telemetry boundaries that do not leak platform dependencies into core
  logic.

## Things Not To Copy Blindly

Avoid carrying these forward as-is:

- DOMParser dependency for EPUB/XHTML/XML.
- Ad hoc CSS rule/declaration parsing as the long-term parser.
- Unsupported selector behavior hidden inside the current lightweight matcher.
- `!important` stripping without priority.
- Two-pass `em` reparsing as incidental parser behavior rather than a deliberate
  cascade model.
- Fragment-only `anchorMap` without a href-aware key.
- Raw source node paths as durable locators.
- Platform-specific Canvas text measurement as the source of truth.
- ASCII-only hyphenation and host-dependent `Intl.Segmenter` behavior.
- Public page-based search using naive lowercase indexes as the long-term
  Unicode search model.
- Partial CSS table/floats/absolute positioning as a complete layout model.
- Layout fallback image aspect ratio as normal behavior.
- DOM/a11y helper APIs as part of the native core; they belong to platform
  shells.
- Web Canvas renderer as the only rendering oracle.
- The development Node/Flutter bridge as production architecture.

## Current Engine Shape In One Sentence

The TS core is a platform-neutral EPUB/CSS/layout engine with a Web Canvas
preset, where the correct Web path depends on loading fonts and image dimensions
before pagination, and where the most reusable future contract is the
paint-ready display list plus the revision-scoped runtime protocol.
