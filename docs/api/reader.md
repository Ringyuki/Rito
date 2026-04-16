# Reader API

## `createReader(data, canvas, options)`

```ts
import { createReader } from '@ritojs/core';
```

Creates a ready-to-render `Reader` from an EPUB `ArrayBuffer`.

It performs the standard browser-side pipeline:

1. parse the EPUB archive
2. load fonts and decode images
3. paginate the spine
4. build spreads
5. bind rendering to the provided canvas

Use this when you want the normal app-facing API instead of assembling the pipeline manually.

## `ReaderOptions`

| Option             | Type                    | Default                          | Notes                             |
| ------------------ | ----------------------- | -------------------------------- | --------------------------------- |
| `width`            | `number`                | required                         | Viewport width in logical pixels  |
| `height`           | `number`                | required                         | Viewport height in logical pixels |
| `margin`           | `number`                | `40`                             | Page margin                       |
| `spread`           | `'single' \| 'double'`  | `'single'`                       | Requested spread mode             |
| `spreadGap`        | `number`                | `20`                             | Gap between pages in double mode  |
| `backgroundColor`  | `string`                | `'#ffffff'`                      | Page background                   |
| `foregroundColor`  | `string`                | unset                            | Reader-wide foreground override   |
| `devicePixelRatio` | `number`                | `window.devicePixelRatio \|\| 1` | HiDPI backing ratio               |
| `lineBreaking`     | `'greedy' \| 'optimal'` | `'greedy'`                       | Line-breaking strategy            |
| `logLevel`         | `LogLevel`              | `'warn'`                         | Diagnostics verbosity             |
| `paginationPolicy` | `PaginationPolicy`      | unset                            | Widow/orphan configuration        |

## `Reader`

### Render / layout

| Member                                              | What it does                                     |
| --------------------------------------------------- | ------------------------------------------------ |
| `renderSpread(index, scale?)`                       | Render a spread to the bound canvas              |
| `renderSpreadTo(index, ctx)`                        | Render to any 2D context                         |
| `resize(width, height)`                             | Re-paginate for a new viewport                   |
| `setSpreadMode(mode)`                               | Re-paginate with a new spread mode               |
| `updateLayout(width, height, spreadMode?, margin?)` | Update viewport and spread settings in one pass  |
| `getCanvasSize(scale?)`                             | Return CSS canvas size for the current layout    |
| `getLayoutGeometry()`                               | Return the active `LayoutConfig`                 |
| `notifyActiveSpread(index)`                         | Trigger spread-change listeners without painting |

### Theme / typography

| Member                                                | What it does                                             |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `setTheme({ backgroundColor, foregroundColor })`      | Update render colors without re-pagination               |
| `setTypography({ fontSize, lineHeight, fontFamily })` | Re-paginate with coarse reader-wide typography overrides |

`setTypography()` is intentionally coarse:

- `fontSize` overrides root font size
- `lineHeight` overrides body line-height behavior
- `fontFamily` overrides body font family

It does not rewrite EPUB-authored selectors.

### Navigation / metadata

| Member                          | What it does                         |
| ------------------------------- | ------------------------------------ |
| `metadata`                      | EPUB package metadata                |
| `toc`                           | Table of contents entries            |
| `chapterMap`                    | Spine idref to page-range map        |
| `manifestHrefMap`               | Spine idref to manifest href map     |
| `findPage(entry)`               | Resolve a TOC entry to a page        |
| `findSpread(pageIndex)`         | Resolve a page to a spread           |
| `resolveTocEntry(entry)`        | Resolve a TOC entry to page + spread |
| `findActiveTocEntry(pageIndex)` | Find the active TOC entry for a page |

### Pagination / interaction data

| Member                    | What it does                                         |
| ------------------------- | ---------------------------------------------------- |
| `pages`                   | Paginated pages                                      |
| `spreads`                 | Presentation-layer spreads                           |
| `totalSpreads`            | Number of spreads                                    |
| `dpr`                     | Device pixel ratio used by rendering                 |
| `measurer`                | Text measurer used by interaction APIs               |
| `getChapterTextIndices()` | Source-based chapter text indices                    |
| `getFootnotes()`          | Extracted footnotes keyed by `manifestHref#fragment` |
| `getImageBlobUrl(src)`    | Create a blob URL for an embedded EPUB image         |

### Lifecycle

| Member                 | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `onSpreadRendered(cb)` | Subscribe to spread render notifications             |
| `dispose()`            | Release decoded assets and close the loaded document |

## Usage Guidance

### Prefer `createReader()` when

- you are building a browser reading experience
- you want one object that handles loading, pagination, and rendering
- you do not need custom orchestration between parse/layout/render stages

### Prefer the stable primitives when

- you need a custom pipeline
- you want to paginate once and render to multiple contexts
- you want tighter control over resource loading and lifecycle

### Prefer `@ritojs/kit` / `@ritojs/react` when

- you need transitions, overlays, selection/search/annotation wiring, keyboard, or storage
- you are building app UI rather than only rendering pages

## Related Docs

- [Stable Primitives](./primitives.md)
- [Advanced Entry](./advanced.md)
- [Specialized Subpaths](./subpaths.md)
