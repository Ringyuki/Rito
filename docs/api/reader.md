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

| Option             | Type                     | Default                          | Notes                                  |
| ------------------ | ------------------------ | -------------------------------- | -------------------------------------- |
| `width`            | `number`                 | required                         | Viewport width in logical pixels       |
| `height`           | `number`                 | required                         | Viewport height in logical pixels      |
| `margin`           | `number`                 | `40`                             | Page margin                            |
| `spread`           | `'single' \| 'double'`   | `'single'`                       | Requested spread mode                  |
| `spreadGap`        | `number`                 | `20`                             | Gap between pages in double mode       |
| `backgroundColor`  | `string \| null`         | `'#ffffff'`                      | Page background; `null` restores white |
| `foregroundColor`  | `string \| null`         | unset                            | Reader-wide override; `null` clears it |
| `devicePixelRatio` | `number`                 | `window.devicePixelRatio \|\| 1` | HiDPI backing ratio                    |
| `lineBreaking`     | `'greedy' \| 'optimal'`  | `'greedy'`                       | Line-breaking strategy                 |
| `logLevel`         | `LogLevel`               | `'warn'`                         | Diagnostics verbosity                  |
| `paginationPolicy` | `PaginationPolicy`       | unset                            | Widow/orphan configuration             |
| `fontSize`         | `number`                 | unset                            | Initial root font-size override        |
| `lineHeight`       | `number`                 | unset                            | Initial line-height override           |
| `lineHeightForce`  | `boolean`                | `false`                          | Force line height on every node        |
| `fontFamily`       | `string`                 | unset                            | Accepted but inert today (see below)   |
| `fontFamilyForce`  | `boolean`                | `false`                          | Accepted but inert today (see below)   |
| `pinnedFontPolicy` | `ReaderPinnedFontPolicy` | **required**                     | Immutable native/Canvas fallback faces |

`pinnedFontPolicy` supplies the same static TTF/OTF bytes to Rust shaping and
the browser `FontFace` registry. Each face declares a complete SHA-256 digest,
a generic role (`serif`, `sansSerif`, or `monospace`), and an optional language
tag. The reader copies the bytes during `createReader()`, verifies the digest in
the native core, and uses the native-returned family alias for Canvas paint.
This keeps exact interaction geometry tied to the font that is actually
rendered. The policy is fixed for the lifetime of that `Reader`; create a new
reader to replace it.

A missing or empty policy makes `createReader` **throw**: the WASM engine
shapes text with exactly these bytes and cannot start without them (there
is no reachable system font inside the runtime, and no legacy fallback
pipeline anymore).

The core intentionally does not bundle, download, or choose fallback assets.
The application owns their licensing, distribution, locale policy, and offline
availability. EPUB-embedded fonts still provide exact shapes for the runs they
cover; the pinned faces are the only fallback beneath them.

For example, a Vite application that checks in an audited static font can load
it during application bootstrap and pass the bytes into every new Reader:

```ts
import { createReader, type ReaderPinnedFontPolicy } from '@ritojs/core';
import sourceHanSerifCnUrl from './assets/fonts/SourceHanSerifCN-Regular.otf?url';

const response = await fetch(sourceHanSerifCnUrl);
if (!response.ok) throw new Error(`Fallback font request failed: ${response.status}`);

const pinnedFontPolicy: ReaderPinnedFontPolicy = {
  schemaVersion: 1,
  faces: [
    {
      bytes: await response.arrayBuffer(),
      expectedSha256: '3754ea669c530e2473354f8f6d9f79680a44d7e26ec7d00eeabee4a7e0753c5d',
      genericRole: 'serif',
      language: 'zh-Hans',
    },
  ],
};

const reader = await createReader(epubBytes, canvas, {
  width: 800,
  height: 600,
  pinnedFontPolicy,
});
```

The digest must come from the application's audited asset manifest rather than
being calculated from the downloaded bytes and trusted afterward. `?url` is
Vite-specific; another host may read the bytes from a packaged native resource,
Cache Storage, IndexedDB, or its own asset loader. Resolve the complete policy
before calling `createReader()`. Changing the policy object later cannot mutate
an existing Reader; the replacement takes effect only when the host creates or
loads a new Reader.

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
`lineHeightForce` to apply the line-height override to every element.

> **Known limitation:** `fontFamily` does not change the rendered faces yet.
> The engine shapes and paints with the pinned font policy's faces applied in
> policy order, and selecting faces by the override's generic family is not
> implemented. Hosts that offer a font choice should open the reader with a
> pinned font policy containing the chosen faces instead (the pattern the
> Flutter reader uses).

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
point-to-caret and exact document-order range resolution across retained logical
flows within one chapter. Its carets are opaque and must be passed back by
identity; selected text preserves native line/block separators and range
rectangles use page-content coordinates. A caret exposes its `pageIndex` because
word and paragraph endpoints can cross the page containing the original input
point. `resolveTextRangeFromPoints()` expands two raw points to complete ICU word
or retained logical-flow paragraph units; missing or malformed package-language
metadata falls back to locale-invariant word boundaries. Paragraph carets remain
exact text/source positions rather than forging the DOM's structural
next-block boundary. When the following flow is retained in the same chapter,
`selectedText` still includes the native paragraph separator; at a bounded
retention edge that trailing separator can appear only after the following flow
has been retained.
`resolveTextRangeToPoint()` is the atomic continuation path for an exact caret
whose bounded revision has since appended an immutable page prefix. It rebinds
that opaque caret and resolves the live point against one currently committed
revision, so callers never combine geometry from two versions. A replacement
layout, worker session, or unrelated revision still fails closed.
`resolveTextSelectionMovement()`, when supported, atomically rebinds a fixed
anchor and live focus, advances the focus by a typed character, word, visual-line,
line-edge, paragraph, or chapter-edge movement, and returns the exact new range.
Vertical line moves return a `preferredInlinePosition` that callers pass into the
next vertical move to preserve sticky x. Reaching an incomplete retained tail is
reported as typed `pending`; endpoints in different chapters remain unavailable.
`interactions.resolveExactSourceRange`, when supported, atomically projects a
durable `{ href, sourceRange }` through that same committed revision. `href` is
the canonical manifest resource href, not a spine idref. It returns exact
page-content rectangles, a typed lazy-pagination result, or a typed unavailable
reason; callers must not substitute the legacy interpolated geometry.

Native `search()` results expose `source` as either a proven durable
`{ href, sourceRange }` or typed `sourceUnavailable`. Under the fragment
engine, results currently report `sourceUnavailable` — matches and navigation
still work, and callers recover a durable range through
`getChapterTextIndices()` (the fallback `@ritojs/kit` uses). Geometry is
intentionally not attached to every result: resolve ranges through
`resolveExactSourceRange`.

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
| `dispose()`            | Start releasing assets and close the loaded document |

Disposal invalidates the Reader synchronously. A browser-backed Reader returns
a promise that settles after its Worker and native document have been released;
`await reader.dispose()` before creating a replacement Reader. Synchronous
Reader implementations may return `void`, which is also safe to `await`.

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
