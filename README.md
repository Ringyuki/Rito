# Rito

A TypeScript-first Canvas-based EPUB rendering library.

Rito is a rendering core for EPUB content. It loads EPUB archives, lazily reads XHTML spine chapters, resolves CSS (including child/sibling/attribute selectors, pseudo-classes, and per-chapter body styles), computes paginated layout (including tables, lists, floats, transforms, hyphenation, and widow/orphan control), and renders spreads onto an HTML Canvas with theme support.

> [!WARNING]
> Rito is still under development! We do not recommend that you use it in production environments, but of course we always welcome your PR!

## Setup

```bash
pnpm install
pnpm run build
```

## Quick Start

```ts
import { createReader } from 'rito';

const response = await fetch('book.epub');
const canvas = document.querySelector('canvas')!;

const reader = await createReader(await response.arrayBuffer(), canvas, {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
});

reader.renderSpread(0);
console.log(`${reader.totalSpreads} spreads, ${reader.toc.length} TOC entries`);

// Navigate, resize, theme, and clean up
reader.renderSpread(1);
reader.updateLayout(1024, 768, 'single');
const firstEntry = reader.toc[0];
if (firstEntry) {
  const chapter = reader.resolveTocEntry(firstEntry);
  if (chapter) reader.renderSpread(chapter.spreadIndex);
}
reader.setTheme({ backgroundColor: '#1a1a2e', foregroundColor: '#e0e0e0' });
reader.renderSpread(0);

reader.dispose();
```

## API

### `createReader(data, canvas, options)`

Creates a fully initialized `Reader` from an EPUB `ArrayBuffer`. Parses the archive, registers fonts, decodes images, paginates, and builds spreads in one call.

**Options:**

| Option             | Type                    | Default                          | Description                       |
| ------------------ | ----------------------- | -------------------------------- | --------------------------------- |
| `width`            | `number`                | _(required)_                     | Viewport width in logical pixels  |
| `height`           | `number`                | _(required)_                     | Viewport height in logical pixels |
| `margin`           | `number`                | `40`                             | Page margin in logical pixels     |
| `spread`           | `'single' \| 'double'`  | `'single'`                       | Spread mode                       |
| `spreadGap`        | `number`                | `20`                             | Gap between pages in double mode  |
| `backgroundColor`  | `string`                | `'#ffffff'`                      | Page background color             |
| `foregroundColor`  | `string`                | —                                | Text color override (dark mode)   |
| `devicePixelRatio` | `number`                | `window.devicePixelRatio \|\| 1` | HiDPI backing-store ratio         |
| `lineBreaking`     | `'greedy' \| 'optimal'` | `'greedy'`                       | Line-breaking algorithm           |
| `useWorker`        | `boolean`               | `false`                          | Paginate in a Web Worker          |
| `logLevel`         | `LogLevel`              | `'warn'`                         | Diagnostics verbosity             |
| `paginationPolicy` | `PaginationPolicy`      | —                                | Widow/orphan control policy       |

**Reader interface:**

| Method / Property                                | Description                                 |
| ------------------------------------------------ | ------------------------------------------- |
| `renderSpread(index, scale?)`                    | Render a spread onto the canvas             |
| `resize(w, h)`                                   | Resize viewport and re-paginate             |
| `setSpreadMode(mode)`                            | Switch single/double and re-paginate        |
| `updateLayout(w, h, spread?, margin?)`           | Update viewport/spread/margin in one pass   |
| `setTheme({ backgroundColor, foregroundColor })` | Update colors (takes effect on next render) |
| `findPage(tocEntry)`                             | Map a TOC entry to a page index             |
| `findSpread(pageIdx)`                            | Find which spread contains a page           |
| `resolveTocEntry(tocEntry)`                      | Resolve a TOC entry to page + spread        |
| `findActiveTocEntry(pageIdx)`                    | Find the current TOC entry for a page       |
| `getCanvasSize(scale?)`                          | Get canvas dimensions for current config    |
| `getLayoutGeometry()`                            | Get the current layout configuration        |
| `getChapterTextIndices()`                        | Get source-based chapter text indices       |
| `setTypography(opts)`                            | Re-paginate with typography overrides       |
| `onSpreadRendered(cb)`                           | Subscribe to render notifications           |
| `dispose()`                                      | Release all resources                       |
| `metadata`                                       | EPUB package metadata                       |
| `totalSpreads`                                   | Number of spreads                           |
| `toc`                                            | Table of contents entries                   |
| `pages` / `spreads`                              | Computed pages and spreads                  |
| `chapterMap`                                     | Chapter-to-page-range mapping               |
| `measurer`                                       | Text measurer for interaction APIs          |

### Stable Primitives

The main entry re-exports a curated set of stable high-level functions for custom pipelines:

| Function                             | Description                                                     |
| ------------------------------------ | --------------------------------------------------------------- |
| `loadEpub(data, options?)`           | Parse an EPUB ArrayBuffer into an `EpubDocument`                |
| `prepare(doc, config, canvas)`       | Load fonts/images and paginate in one async step                |
| `render(spread, ctx, config, opts?)` | Render a spread to a 2D context                                 |
| `paginate(doc, config, measurer)`    | Lay out and paginate all chapters into `Page[]`                 |
| `buildSpreads(pages, config)`        | Group pages into `Spread[]`                                     |
| `createLayoutConfig(input)`          | Create a `LayoutConfig` from shorthand options                  |
| `getSpreadDimensions(config)`        | Compute canvas dimensions for a spread                          |
| `createTextMeasurer(canvas)`         | Create a `TextMeasurer` from a canvas element                   |
| `paginateInWorker(worker, ...)`      | Pre-read chapters on the caller side, then paginate in a Worker |
| `disposeResources(resources)`        | Release prepared resources                                      |

### Advanced Entry (`rito/advanced`)

Internal APIs and expert-level helpers for parser, style resolver, layout engine, runtime metadata, asset preparation, and diagnostics are available via a separate entry point:

```ts
import { parseXhtml, resolveStyles, layoutBlocks, renderPage } from 'rito/advanced';
```

- **Parser**: `parseXhtml`, `parseContainer`, `parsePackageDocument`, `parseNavDocument`, `parseNcx`, `createZipReader`
- **Style**: `resolveStyles`, `parseCssRules`, `parseCssDeclarations`, `matchesSelector`, `calculateSpecificity`
- **Layout**: `layoutBlocks`, `paginateBlocks`, `createGreedyLayouter`, `createKnuthPlassLayouter`, `flattenInlineContent`
- **Render**: `renderPage`, `createCanvasTextMeasurer`, `createTextMeasurer`, `buildFontString`, `loadFonts`, `loadImages`, `createLazyImageLoader`, `loadAssets`, `paginateWithAssets`
- **Runtime**: `PaginationSession`, `paginateWithMeta`, `findPageForTocEntry`
- **Diagnostics**: `createLogger`, `Logger`, `LogLevel`

### Specialized Entry Points

Rito also exposes focused subpath entries for higher-level interaction and integration helpers:

- `rito/selection` — stateful text selection engine
- `rito/search` — full-text search engine
- `rito/annotations` — source-anchored annotation store + resolver helpers
- `rito/position` — reading-position tracker
- `rito/a11y` — semantic tree + visually hidden DOM mirror helpers
- `rito/dom` — optional DOM bindings (pointer, clipboard, link cursor)
- `rito/worker` — pagination worker entry

## Capabilities

- Parse EPUB 3 container metadata, manifest, spine, and NAV/NCX table of contents.
- Parse XHTML into a structured node tree (block, inline, text, image, table, list).
- Lazily read chapter XHTML through `EpubDocument.readChapter()` after archive parsing.
- Extract embedded fonts, images, and SVG cover art.
- Resolve CSS with element/class/ID/compound/descendant selectors, specificity, cascading, inheritance, `@font-face`, `rem`, and `calc()`.
- Layout engine: block layout, greedy or Knuth-Plass line breaking, Liang hyphenation (`en-us`), floats, inline images, tables, lists, `margin: auto`, `vertical-align`, and `position: relative`.
- Pagination with page-break awareness, widow/orphan control, and chapter-start-aware spread building.
- Single-page and two-page spread modes.
- Optional worker pagination for layout computation after main-thread chapter pre-read.
- Canvas rendering with theme support (background/foreground color override with WCAG contrast detection).
- Source-anchored annotations that remain stable across repagination, spread-mode switches, and viewport changes.
- Interaction primitives and engines for selection, search, annotations, reading position, and accessibility mirrors.

## Reader App

The workspace includes a reader app in `apps/reader/`. It demonstrates the full library API with file loading, keyboard/touch navigation, TOC sidebar, progress bar, font scaling, spread mode toggle, and dark/light theming.

```bash
pnpm run dev:reader
```

## Current Limitations

- **CSS subset** — optimized for EPUB book layout, not full browser CSS. No flexbox, grid, multicolumn layout, or `position: absolute/fixed/sticky`.
- **Selector subset** — supports element/class/ID/compound/descendant selectors only; no attribute selectors, sibling combinators, pseudo-elements, or media queries.
- **Language support** — layout is left-to-right only; no RTL/BiDi, and bundled hyphenation patterns are currently `en-us` only.
- **TOC / internal links** — fragment identifiers currently resolve to chapter start pages rather than exact anchor pages.
- **Typography overrides** — `setTypography()` applies reader-wide root/body overrides (`fontSize`, `lineHeight`, `fontFamily`). It is intentionally coarse and does not rewrite EPUB-authored selectors.
- **Default loading model** — `loadEpub()` exposes lazy `readChapter()`, but the ZIP archive is still inflated eagerly, and `createReader()` / `prepare()` still paginate the full spine up front and eagerly decode resources.
- **Worker pagination scope** — `paginateInWorker()` / `createReader({ useWorker: true })` move layout work off the main thread, but chapter pre-read / XHTML parse still happen on the caller side before posting work to the Worker.
- **Browser-oriented rendering pipeline** — `loadFonts`, `loadImages`, `prepare`, and worker pagination depend on browser APIs such as `FontFace`, `createImageBitmap`, `Worker`, and `OffscreenCanvas`.
- **EPUB 3 first** — no explicit EPUB 2 compatibility layer.

## Development

```bash
pnpm install
pnpm run check    # typecheck + lint + format + test + build
```

| Command               | Description                           |
| --------------------- | ------------------------------------- |
| `pnpm run build`      | Build the library with tsdown         |
| `pnpm run dev`        | Run workspace dev scripts in parallel |
| `pnpm run dev:reader` | Start the reader app with Vite        |
| `pnpm run dev:rito`   | Watch-build the `rito` package        |
| `pnpm run lint`       | Run ESLint                            |
| `pnpm run format`     | Format with Prettier                  |
| `pnpm run typecheck`  | Run TypeScript type checking          |
| `pnpm run test`       | Run tests with Vitest                 |
| `pnpm run check`      | Run all checks                        |

## Architecture

```text
packages/rito/
  src/index.ts      Public API (createReader + primitives)
  src/advanced.ts   Internal APIs (parser, style, layout, render primitives)
  src/reader/       Reader facade + state helpers
  src/parser/       EPUB structure + XHTML content parsing
  src/model/        Shared geometry/data structures
  src/style/        CSS subset parsing + style resolution
  src/layout/       Pure layout computation + pagination + spread building
  src/render/       Canvas rendering + browser resource preparation
  src/runtime/      High-level orchestration (loadEpub, paginate)
  src/interaction/  Search, selection, annotations, position, semantics
  src/workers/      Worker-side pagination entry + transport types
  src/dom/          Optional DOM integration helpers
  src/utils/        Small shared utilities

packages/kit/
  src/controller/   ReaderController orchestration layer
  src/transition/   Snapshot-based page-turn transitions
  src/overlay/      Highlight overlay renderer
  src/keyboard/     Shortcut manager
  src/storage/      localStorage adapters

packages/react/
  src/hooks/        React lifecycle + controller state hooks
  src/components/   Reader mount component

apps/reader/
  src/components/   Reader UI components (toolbar, canvas, TOC sidebar, progress bar)
  src/hooks/        Reader state and interaction hooks
  src/lib/          Small app-specific helpers
```

The public API is split across `src/index.ts` and documented subpath entries such as `src/advanced.ts`, `src/selection.ts`, `src/search.ts`, `src/annotations.ts`, `src/position.ts`, `src/a11y.ts`, `src/dom.ts`, and `src/worker.ts`.
