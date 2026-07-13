# Reader API

The app-facing `Reader` facade is exported from the root `@ritojs/core`
package.

## `createReader(data, canvas, options)`

```ts
import { createReader } from '@ritojs/core';
```

Creates a ready-to-render browser `Reader` from an EPUB `ArrayBuffer`.

It performs the standard reader pipeline:

1. parse the EPUB archive
2. open a long-lived document runtime
3. create an initial layout revision
4. build spread frames and resource schedules
5. bind rendering to the provided Canvas target

Use this when you want the normal app-facing API instead of assembling the pipeline manually.
For non-Web runtimes, target the Rust runtime contract behind the root package
instead of the legacy TypeScript Canvas helper path.

The older TypeScript Canvas reader is retained only as source reference code
inside this repository. New app-facing reader code should depend on the root
package entry.

## `ReaderOptions`

| Option             | Type                    | Default                          | Notes                                  |
| ------------------ | ----------------------- | -------------------------------- | -------------------------------------- |
| `width`            | `number`                | required                         | Viewport width in logical pixels       |
| `height`           | `number`                | required                         | Viewport height in logical pixels      |
| `margin`           | `number`                | `40`                             | Page margin                            |
| `spread`           | `'single' \| 'double'`  | `'single'`                       | Requested spread mode                  |
| `spreadGap`        | `number`                | `20`                             | Gap between pages in double mode       |
| `backgroundColor`  | `string \| null`        | `'#ffffff'`                      | Page background; `null` restores white |
| `foregroundColor`  | `string \| null`        | unset                            | Reader-wide override; `null` clears it |
| `devicePixelRatio` | `number`                | `window.devicePixelRatio \|\| 1` | HiDPI backing ratio                    |
| `lineBreaking`     | `'greedy' \| 'optimal'` | `'greedy'`                       | Line-breaking strategy                 |
| `logLevel`         | `LogLevel`              | `'warn'`                         | Diagnostics verbosity                  |
| `paginationPolicy` | `PaginationPolicy`      | unset                            | Widow/orphan configuration             |
| `fontSize`         | `number`                | unset                            | Initial root font-size override        |
| `lineHeight`       | `number`                | unset                            | Initial line-height override           |
| `lineHeightForce`  | `boolean`               | `false`                          | Force line height on every node        |
| `fontFamily`       | `string`                | unset                            | Initial body font-family override      |
| `fontFamilyForce`  | `boolean`               | `false`                          | Force font family on every node        |

## `Reader`

### Render / layout

| Member                                              | What it does                                     |
| --------------------------------------------------- | ------------------------------------------------ |
| `renderSpread(index, scale?)`                       | Render a spread to the bound canvas              |
| `renderSpreadTo(index, ctx)`                        | Render to a Canvas 2D target                     |
| `resize(width, height)`                             | Re-paginate for a new viewport                   |
| `setSpreadMode(mode)`                               | Re-paginate with a new spread mode               |
| `setLineBreaking(lineBreaking)`                     | Re-paginate with a new line-breaking strategy    |
| `updateLayout(width, height, spreadMode?, margin?)` | Update viewport and spread settings in one pass  |
| `getCanvasSize(scale?)`                             | Return CSS canvas size for the current layout    |
| `getLayoutGeometry()`                               | Return the active `LayoutConfig`                 |
| `notifyActiveSpread(index)`                         | Trigger spread-change listeners without painting |

### Theme / typography

| Member                                                | What it does                                             |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `setTheme({ backgroundColor, foregroundColor })`      | Update render colors without re-pagination               |
| `setTypography({ fontSize, lineHeight, fontFamily })` | Re-paginate with coarse reader-wide typography overrides |

Each `setTypography()` value accepts `undefined` (leave unchanged), `null`
(clear the override), or an explicit value. By default it is intentionally
coarse:

- `fontSize` overrides root font size
- `lineHeight` overrides body line-height behavior
- `fontFamily` overrides body font family

EPUB element-level rules continue to win in coarse mode. Set
`lineHeightForce` or `fontFamilyForce` to apply that override to every element.

For `setTheme()`, omitted fields remain unchanged. Pass `null` to clear a
foreground override or restore the default white background; this is useful
when switching from a dark theme back to a book-authored light theme.

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
| `getImageBlobUrl(src)`    | Create or asynchronously resolve an EPUB image URL   |
| `interactions`            | Optional revision-safe semantic interaction provider |

When present, `interactions` exposes typed page-content targets plus exact-revision
footnote and source-locator reads. Its `enabled` flag is false while a visual-only
preview is displayed; callers must not reuse targets from the previous canonical
revision during that interval. Page targets intentionally cover semantic click
sources only. When supported, `interactions.textSelection` exposes revision-bound
point-to-caret and same-flow range resolution. Its carets are opaque and must be
passed back by identity; range rectangles use page-content coordinates.
`interactions.resolveExactSourceRange`, when supported, atomically projects a
durable `{ href, sourceRange }` through that same committed revision. `href` is
the canonical manifest resource href, not a spine idref. It returns exact
page-content rectangles, a typed lazy-pagination result, or a typed unavailable
reason; callers must not substitute the legacy interpolated geometry.

Native `search()` results expose `source` as either a proven durable
`{ href, sourceRange }` or typed `sourceUnavailable`. Geometry is intentionally
not attached to every result: resolve only visible results through
`resolveExactSourceRange`. `@ritojs/kit` performs this lazy projection and does
not fall back to layout-local HitMaps when the native capability is present.

`getImageBlobUrl()` may return either an object URL immediately or a promise for
one. Every resolved URL is caller-owned and must be revoked when it is replaced
or no longer displayed. `@ritojs/kit` performs that ownership and stale-request
handling for its `imageClick` event.

`FootnoteEntry.html` is an allowlist-sanitized fragment. Active elements,
event/style attributes, host CSS classes, auto-fetching image sources, unsafe
URL schemes and unapproved attributes are removed before the value crosses the
Reader boundary. EPUB footnote images remain unavailable until the host can
rewrite them through an explicit caller-owned resource URL.

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

### Prefer source-only reference tooling when

- you are doing diagnostics, parity work, or migration tooling
- you intentionally need the legacy TypeScript parser/layout/render primitives
- you understand that this is not the production reader path

### Prefer `@ritojs/kit` / `@ritojs/react` when

- you need transitions, overlays, selection/search/annotation wiring, keyboard, or storage
- you are building app UI rather than only rendering pages

## Related Docs

- [Reference Primitives](./primitives.md)
- [Advanced Internals](./advanced.md)
- [Specialized Subpaths](./subpaths.md)
