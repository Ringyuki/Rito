# Reader API

The app-facing `Reader` facade is exported from the root `@ritojs/core`
package.

## `createReader(data, canvas, options)`

```ts
import { createReader } from '@ritojs/core';
```

Creates a ready-to-render browser `Reader` from an EPUB `ArrayBuffer`.

It opens a reader session in a Worker and resolves once the first page can
be painted:

1. parse the EPUB archive
2. lay out the chapter being read, alone, and publish the spread that shows
   the opening position
3. bind rendering to the provided Canvas target
4. lay out the whole book behind it and commit again under book-wide page
   numbers (see [`layoutScope`](#layout--interaction-data))

This is the browser's entry to the engine. Flutter apps use `rito_flutter`;
other native hosts bridge the C ABI (see
[Direct FFI integration](../integrations/ffi.md)).

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
| `logLevel`         | `LogLevel`               | `'warn'`                         | Diagnostics verbosity                  |
| `fontSize`         | `number`                 | unset                            | Initial root font-size override        |
| `lineHeight`       | `number`                 | unset                            | Initial line-height override           |
| `lineHeightForce`  | `boolean`                | `false`                          | Apply the override with `!important`   |
| `fontFamily`       | `string`                 | unset                            | `font-family` override (see below)     |
| `fontFamilyForce`  | `boolean`                | `false`                          | Apply the override with `!important`   |
| `pinnedFontPolicy` | `ReaderPinnedFontPolicy` | **required**                     | Immutable native/Canvas fallback faces |

`pinnedFontPolicy` supplies the same static TTF/OTF bytes to Rust shaping and
the browser `FontFace` registry. Each face declares a complete SHA-256 digest,
a generic role (`serif`, `sansSerif`, or `monospace`), and an optional language
tag. The reader copies the bytes during `createReader()`, verifies the digest in
the native core, and paints every run with the native-returned alias of the
exact face that shaped it. This keeps exact interaction geometry tied to the
font that is actually rendered. Faces can be added and removed while a book is
open (see [Fonts](#fonts)).

A missing or empty policy makes `createReader` **throw**: the WASM engine
shapes text with exactly these bytes and cannot start without them (there
is no reachable system font inside the runtime).

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
- `lineHeight` and `fontFamily` apply as a user-origin rule on every element

A declaration the book makes on an element wins over that rule in coarse
mode; an element without one takes the reader's value, whatever its ancestors
declare. Set `lineHeightForce` to apply the line-height override with
`!important`, over the book's own declarations.

Set `fontFamilyForce` to replace every element's own family as well (what a
reader's font choice usually means).

For `setTheme()`, omitted fields remain unchanged. Pass `null` to clear a
foreground override or restore the default white background; this is useful
when switching from a dark theme back to a book-authored light theme.

### Fonts

Fonts resolve the way CSS resolves them against installed fonts, where the
"installed" fonts are exactly the host's faces (the pinned policy plus faces
added later) and the publication's own `@font-face` fonts:

- a named family is the publication's `@font-face` family of that name, else
  the host face whose name table declares that family; a name nothing answers
  to is skipped, like an uninstalled font
- a generic (`serif`, `sans-serif`, `monospace`; `system-ui` reads as
  `sans-serif`) is the host faces of that role: the language-neutral faces
  first, then those tagged for a language, the content's own `lang` ahead of
  the rest — so a Latin face pinned for every language keeps Latin text while a
  CJK face tagged `zh-Hans` serves ideographs
- after the list, every host face follows as the fallback, serif first

Shaping runs under the content language, and paint draws each run with the
exact face that shaped it, so what is measured is what is drawn.

| Member                         | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `fonts()`                      | Every family a `font-family` choice can name (build pickers from it) |
| `unresolvedFontFamilies(list)` | The names in a `font-family` list no family answers to               |
| `addFontFaces(faces)`          | Add host faces (a system font, an imported file) and re-lay out      |
| `removeFontFaces(sha256s)`     | Remove host faces and re-lay out; one face must remain               |

`fonts()` resolves to `{ families }`, each `{ name, source: 'host' | 'publication',
genericRole, language, faces: [{ weight, style, sha256 }] }`. A face added at
runtime takes the same shape as a pinned one (`bytes`, `expectedSha256`,
`genericRole`, optional `language`); it may share its role and language with
another face, is named by its family in a `font-family` list, and joins the
faces of its `genericRole` behind those already there — language-neutral faces
ahead of language-tagged ones — so a generic reaches it for text the earlier
faces do not cover. Variable fonts are rejected.

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

### Layout / interaction data

| Member                 | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `spreads`              | Navigation record per spread: `{ index, pageIndexes, leftPageIndex, rightPageIndex? }` |
| `layoutScope`          | What the committed layout covers: `'chapter'` or `'book'`                              |
| `totalSpreads`         | Number of spreads in the committed layout                                              |
| `pageCount`            | Number of pages in the committed layout                                                |
| `dpr`                  | Device pixel ratio used by rendering                                                   |
| `getImageBlobUrl(src)` | Create or asynchronously resolve an EPUB image URL                                     |
| `interactions`         | Optional revision-safe semantic interaction provider                                   |

A layout is committed twice. When a book opens, and again after every change
that re-paginates (`resize`, `setSpreadMode`, `updateLayout`, `setTypography`,
`addFontFaces`, `removeFontFaces`), the reader lays out the chapter being read
alone and commits it with `layoutScope: 'chapter'`: the page is on screen after
one chapter's work, and `pageCount`, `totalSpreads`, `spreads`, `chapterMap` and
every page index describe that chapter, counted from its first page. The whole
book is laid out behind it and committed with `layoutScope: 'book'`, showing the
same page under its book-wide number. Both commits call the
`onLayoutCommitted` listeners, so a host that shows page numbers or a progress
bar reads them again on the second one. A page of the chapter commit is the page the book
commit gives that chapter, so nothing on screen moves between the two.

Changes made while a layout is under way wait for it: it commits, and then only
the newest of them is laid out. A host that sends a new size every frame sees a
new size each time a layout ends.

A spread carries page indexes only; page geometry comes from
`getLayoutGeometry()` and page content from the rendered frame and
`interactions`. Page and spread indexes are projections of the committed layout
and change on every commit — persist a `ReaderLocator`, not an index.
`@ritojs/kit` hides the chapter commit: its page numbers, progress and
navigation are book-wide, and a target outside the chapter is carried over to
the book commit.

When present, `interactions` exposes typed page-content targets plus exact-revision
footnote (`getFootnote(key)`) and source-locator reads. Its `enabled` flag is
true until the reader is disposed. Page targets list every text run (`kind: 'text'`)
as well as links, images and note references; filter by `kind` for click sources.
When supported, `interactions.textSelection` exposes revision-bound
point-to-caret and exact document-order range resolution across retained logical
flows; a range whose ends lie in different chapters carries `sourceSpan`, each end
with its own href, and no single-chapter `sourceLocator`. Its carets are opaque and must be passed back by
identity; selected text preserves native line/block separators and range
rectangles use page-content coordinates. A caret exposes its `pageIndex` because
word and paragraph endpoints can cross the page containing the original input
point. `resolveTextRangeFromPoints()` expands two raw points to complete ICU word
or retained logical-flow paragraph units; missing or malformed package-language
metadata falls back to locale-invariant word boundaries. Paragraph carets remain
exact text/source positions rather than forging the DOM's structural
next-block boundary. When the following flow belongs to the same chapter,
`selectedText` includes the native paragraph separator.
`resolveTextRangeToPoint()` rebinds an opaque caret and resolves the live point
against one currently committed layout, so callers never combine geometry from
two versions. A caret belongs to the layout that answered it: after either
commit, a caret from before resolves `undefined`.
`resolveTextSelectionMovement()`, when supported, atomically rebinds a fixed
anchor and live focus, advances the focus by a typed character, word, visual-line,
line-edge, paragraph, or chapter-edge movement, and returns the exact new range.
Vertical line moves return a `preferredInlinePosition` that callers pass into the
next vertical move to preserve sticky x. Reaching an incomplete retained tail is
reported as typed `pending`.
`interactions.resolveExactSourceRange`, when supported, atomically projects a
durable `{ href, sourceRange }` through that same committed revision. `href` is
the canonical manifest resource href, not a spine idref. It returns exact
page-content rectangles, a typed lazy-pagination result, or a typed unavailable
reason; callers must not substitute the legacy interpolated geometry.

Native `search()` results expose `source` as either a proven durable
`{ href, sourceRange }` or typed `sourceUnavailable`: a match whose source
range the engine cannot prove against the chapter's text reports
`sourceUnavailable`, while matches and navigation still work. Geometry is
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

| Member                           | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `onSpreadRendered(cb)`           | Subscribe to spread render notifications                |
| `onSpreadContentInvalidated(cb)` | A spread's content arrived or changed; paint it again   |
| `onLayoutCommitted(cb)`          | A layout was committed (chapter, then book); re-read it |
| `dispose()`                      | Start releasing assets and close the loaded document    |

Disposal invalidates the Reader synchronously. A browser-backed Reader returns
a promise that settles after its Worker and the session in it have been released;
`await reader.dispose()` before creating a replacement Reader. Synchronous
Reader implementations may return `void`, which is also safe to `await`.

## Usage Guidance

### Prefer `createReader()` when

- you are building a browser reading experience
- you want one object that handles loading, pagination, and rendering

A spread never waits for its images: it paints once its fonts are ready
and again as each image lands, which `onSpreadContentInvalidated` reports.
An image paints nothing for its first second, then a loading placeholder;
a late one fades in over it, and a failed one paints a broken placeholder.
A failed read that can pass is read again while the spread is held.

### Prefer `@ritojs/kit` / `@ritojs/react` when

- you need transitions, overlays, selection/search/annotation wiring, keyboard, or storage
- you are building app UI rather than only rendering pages

## Related Docs

- [Public Entry](./subpaths.md)
- [Using `@ritojs/kit`](../integrations/kit.md)
- [Direct FFI integration](../integrations/ffi.md)
