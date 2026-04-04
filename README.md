# Rito

A TypeScript-first Canvas-based EPUB rendering library.

Rito is a rendering core for EPUB content. It loads EPUB archives, parses XHTML chapters with CSS stylesheets, computes paginated layout (including tables, lists, floats, and hyphenation), and renders spreads onto an HTML Canvas with theme support.

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

**Reader interface:**

| Method / Property             | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `renderSpread(index, scale?)` | Render a spread onto the canvas             |
| `resize(w, h)`                | Resize viewport and re-paginate             |
| `setSpreadMode(mode)`         | Switch single/double and re-paginate        |
| `updateLayout(w, h, spread?)` | Update viewport/spread in one pass          |
| `setTheme({ bg, fg })`        | Update colors (takes effect on next render) |
| `findPage(tocEntry)`          | Map a TOC entry to a page index             |
| `findSpread(pageIdx)`         | Find which spread contains a page           |
| `resolveTocEntry(tocEntry)`   | Resolve a TOC entry to page + spread        |
| `findActiveTocEntry(pageIdx)` | Find the current TOC entry for a page       |
| `getCanvasSize(scale?)`       | Get canvas dimensions for current config    |
| `dispose()`                   | Release all resources                       |
| `totalSpreads`                | Number of spreads                           |
| `toc`                         | Table of contents entries                   |
| `pages` / `spreads`           | Computed pages and spreads                  |
| `chapterMap`                  | Chapter-to-page-range mapping               |

### Stable Primitives

The main entry re-exports a curated set of stable high-level functions for custom pipelines:

| Function                             | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `loadEpub(data, options?)`           | Parse an EPUB ArrayBuffer into an `EpubDocument` |
| `prepare(doc, config, canvas)`       | Load fonts/images and paginate in one async step |
| `render(spread, ctx, config, opts?)` | Render a spread to a 2D context                  |
| `paginate(doc, config, measurer)`    | Lay out and paginate all chapters into `Page[]`  |
| `buildSpreads(pages, config)`        | Group pages into `Spread[]`                      |
| `createLayoutConfig(input)`          | Create a `LayoutConfig` from shorthand options   |
| `getSpreadDimensions(config)`        | Compute canvas dimensions for a spread           |
| `createTextMeasurer(canvas)`         | Create a `TextMeasurer` from a canvas element    |
| `paginateInWorker(worker, ...)`      | Run pagination through a caller-provided Worker  |
| `disposeResources(resources)`        | Release prepared resources                       |

### Advanced Entry (`rito/advanced`)

Internal APIs and expert-level helpers for parser, style resolver, layout engine, runtime metadata, asset preparation, and diagnostics are available via a separate entry point:

```ts
import { parseXhtml, resolveStyles, layoutBlocks, renderPage } from 'rito/advanced';
```

- **Parser**: `parseXhtml`, `parseContainer`, `parsePackageDocument`, `parseNavDocument`, `parseNcx`, `createZipReader`
- **Style**: `resolveStyles`, `parseCssRules`, `parseCssDeclarations`, `matchesSelector`, `calculateSpecificity`
- **Layout**: `layoutBlocks`, `paginateBlocks`, `createGreedyLayouter`, `flattenInlineContent`
- **Render**: `renderPage`, `createCanvasTextMeasurer`, `createTextMeasurer`, `buildFontString`, `loadFonts`, `loadImages`, `loadAssets`, `paginateWithAssets`
- **Runtime**: `PaginationSession`, `paginateWithMeta`, `findPageForTocEntry`
- **Diagnostics**: `createLogger`, `Logger`, `LogLevel`

## Capabilities

- Parse EPUB 3 container metadata, manifest, spine, NAV/NCX table of contents.
- Parse XHTML into a structured node tree (block, inline, text, image, table, list).
- Extract embedded fonts, images, and SVG cover art.
- Resolve CSS with selector matching (element, class, ID, descendant, pseudo-class), specificity, cascading, inheritance, and `@font-face`.
- Layout engine: block layout, inline text with greedy line breaking and hyphenation, floats, tables with border styling, ordered/unordered lists, and block images.
- Pagination with page-break awareness and chapter-start detection.
- Single-page and two-page spread modes.
- Canvas rendering with theme support (background/foreground color override with WCAG contrast detection).

## Reader App

The workspace includes a reader app in `apps/reader/`. It demonstrates the full library API with file loading, keyboard/touch navigation, TOC sidebar, progress bar, font scaling, spread mode toggle, and dark/light theming.

```bash
pnpm run dev:reader
```

## Current Limitations

- **CSS subset** — supports common properties (font, color, margin, padding, border, text-align, display, white-space, list-style, float) but no flexbox, grid, or positioning.
- **Greedy line breaking** — no Knuth-Plass or advanced typographic optimization.
- **No widow/orphan control** — blocks split at line boundaries only.
- **Simplified resource scoping** — stylesheets merge at document level; font/image path matching uses heuristics.
- **Eager loading** — `loadEpub` loads all chapters into memory at once.
- **Browser-oriented** — `loadFonts`, `loadImages`, and `prepare` depend on browser APIs (`FontFace`, `createImageBitmap`).
- **No RTL/BiDi** — left-to-right text layout only.
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
  src/reader.ts     Reader implementation
  src/parser/       EPUB structure + XHTML content parsing
  src/model/        Shared geometry/data structures
  src/style/        CSS subset parsing + style resolution
  src/layout/       Pure layout computation + pagination + spread building
  src/render/       Canvas rendering + browser resource preparation
  src/runtime/      High-level orchestration (loadEpub, paginate)
  src/utils/        Small shared utilities

apps/reader/
  src/components/   Reader UI components (toolbar, canvas, TOC sidebar, progress bar)
  src/hooks/        Reader state and interaction hooks
  src/lib/          Small app-specific helpers
```

Public exports flow through `src/index.ts`. Internal APIs are available via `src/advanced.ts` (`rito/advanced`).
