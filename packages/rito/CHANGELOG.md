# @ritojs/core

## 3.1.0

No changes in this release.

## 3.0.0

### Major Changes

- e86a0f6: `reader.getChapterTextIndices()` and the `ChapterTextIndex` / `ChapterTextSpan` types are removed. Nothing in Rito read them since annotation targets, TOC entries and position order moved into the engine, yet every revision commit shipped the whole book's text from the worker to build them. Durable source ranges come from `search()` results, selections and `createAnnotationTarget`. `@ritojs/core-wasm` drops `getChapterTextIndicesAtRevision`, `getChapterTextIndices`, `createRitoCoreWasmReaderChapterTextIndexMap`, the `chapterTextIndices` revision-bundle field and their types.
- 20336ad: `createReader()` opens a book on the reader session protocol, the one the Flutter adapter and the C ABI speak, and the revision runtime it used to run on is removed. A layout — at open and after every change that paginates again — is committed twice: the chapter being read first, laid out alone, so its page is on screen after one chapter's work, then the whole book under book-wide page numbers. `Reader.layoutScope` says which commit is current (`'chapter'` or `'book'`), `onLayoutCommitted` fires for both, and during the chapter commit `pageCount`, `totalSpreads`, `spreads`, `chapterMap` and every page index describe that chapter alone. `@ritojs/kit` keeps its page numbers, progress and navigation book-wide throughout: a turn inside the chapter is immediate, and a turn past its edge or a jump outside it waits for the book and lands there.

  Measured in the demo reader on a production build (headless Chromium, 393×760@3x single page and 1280×860@2x double page, three books, medians): opening a book takes 215–280 ms where the revision runtime it replaces took 540–750 (measured on that runtime as it stood just before its removal); a font-size or font-family change shows its page in 38–90 ms where it took 90–375, and in 170–210 ms where it took 360–670 on a book whose text is nearly all one chapter; page numbers follow the first page by 165–215 ms (320–350 ms on the one-chapter book); page counts match that runtime's.

  Breaking: `Reader.getFootnotes()` is removed — a session answers one note by its key, through `interactions.getFootnote(key)`. A caret from `interactions.textSelection` belongs to the commit that answered it, so a selection made between the chapter commit and the book commit is cleared by the second. `interactions.enabled` no longer turns false for a preview, because there is none. `@ritojs/core-wasm` ships the session runtime alone: the document wrapper, the revision worker and its client, and their types are gone.

- dbd610e: `@ritojs/core` exports the reader and nothing of the session under it. `openBrowserReaderSession()`, `createBrowserReaderSessionCanvasPresenter()`, `RitoReaderError`, `BrowserReaderImageResourceError` and its code, `BrowserReaderCanvasUnsupportedError` and every `BrowserReader*` type are removed from the package's entry. A host built on the raw session had to run its artifact operations one at a time and release every candidate it did not adopt; `createReader()` does both, and is now the browser's one host of the session. An error a reader rejects with still carries the session's `code`.

### Minor Changes

- b7fd15d: Annotation targets are built and read by the engine, so a highlight stored by one host resolves identically on every other. `AnnotationTarget` is now `{ version: 1, href, sourceRange, quote: { exact, prefix, suffix }, position: { start, end, chapterLength } }`, with offsets in UTF-16 units over the chapter's raw parsed text; the selector objects, `text` context and every Kit-side anchoring helper are removed, and targets in the earlier shape are not read. `ReaderController.addAnnotation()` (and `useAnnotations().add`) now returns a `Promise`: it reads the selection at call time and resolves once `interactions.createAnnotationTarget` has built the target, reporting a failed build on the `error` event (source `'annotation-target'`) instead of rejecting. Stored targets are located by `interactions.resolveAnnotationTarget` — the source range checked against its quote, then the best-context quote, then the stored offsets, then the length-scaled position — and `ResolutionStatus` names that level: `'exact' | 'quote' | 'position' | 'progression' | 'orphaned'`. `@ritojs/core` adds `ReaderAnnotationTarget`, `ReaderAnnotationTargetResolution` and the two interactions.
- 372f172: The engine derives `line-height: normal` geometry from the fonts it shapes with, the way Blink derives it — whole-pixel ascent, descent and line gap per font, ruby annotations stacked on normalized em heights, super/sub spans on their LayoutUnit shift — so every host lays out the same lines. The browser reader no longer measures metrics with the DOM, injects them or reflows to converge on them. A character no registered face covers keeps the advance shaping gives it instead of a measured system-fallback width. `@ritojs/core-wasm` drops `takeHostLineMetricRequests`, `setHostLineMetrics` and their types, and the reader diagnostics hook drops `hostLineMetrics`, `unmetHostLineMetricRequests` and `hostLineMetricsEpochs`.
- 0100fb2: `reader.interactions.tocEntryAtPosition({ href, point })` names the TOC entry a source position reads under (the last entry, in TOC order, whose target is at or before it, decided on the source alone — for a stored highlight's or bookmark's chapter), and `reader.interactions.compareSourcePositions(first, second)` orders two source positions in reading order (`-1`, `0` or `1`). Both are the engine functions a native host calls through `rito_resolve_navigation`, so every host answers alike. `ReaderSourcePosition` joins the public types.
- 664d0d8: Fonts resolve the way CSS resolves them against installed fonts, and paint draws exactly the face that shaped each run. A named family is the publication's `@font-face` family of that name, else the host face of that name; a generic (`serif`, `sans-serif`, `monospace`, `system-ui`) is the host faces of its role, language-neutral faces first, then those tagged for a language with the content's own `lang` ahead of the rest; every host face follows as the fallback, serif first. Shaping runs under the content language, so `locl` applies as in the browser. Every text, ruby and marker run now names one face by its alias (a run shaped across faces paints once per face), publication faces register under a per-file alias with their `@font-face` weight and style, and pinned faces report their own weight and slope, so the platform synthesizes bold or italic exactly where CSS would. Artifacts list the pinned faces they paint with (`rito-host-font:<sha256>` hrefs, readable through `readResource`), so a reader-session host registers every face it needs from the artifact alone. New: `reader.fonts()` returns the font catalog (host and publication families with role, language and faces) to build font choices from; `addFontFaces` and `removeFontFaces` change the host faces while a book is open (a system font, an imported file) and lay it out again; `unresolvedFontFamilies` names what a `font-family` list would skip, and the kit controller reports such names from `setTypography` as an `error` event with source `font-family`. The same operations exist on the Flutter session (`fontCatalog`, `addFontFaces`, `removeFontFaces`, `unresolvedFontFamilies`) and the C ABI (`rito_font_catalog`, `rito_unresolved_font_families`, `rito_add_host_font_faces`, `rito_remove_host_font_faces`).
- 3acb230: An image that can no longer arrive paints a broken-picture placeholder instead of nothing: a block over the image box tinted 6% toward the text colour, with a picture icon split along a crack centred in it. The engine lowers the placeholder geometry with every inline image (`RITODL1` opcode 14, `image-fallback`, one loading and one broken variant) and both renderers paint the variant matching the image's state, tinted from the theme's page and text colours. In the browser reader an image that is still on its way shows nothing for its first second, then the loading placeholder; one that arrives after that fades in over it in 150ms. An image whose shard the host could not load shows the broken placeholder and is read again when its page is shown again, and while it stays shown after 2s, 5s and then every 15s; an image the publication cannot serve stays broken.
- 434bbfa: A publication can be opened from shards instead of a whole EPUB. `rito-pack` splits a book into a skeleton (every chapter, stylesheet, font and navigation file, the file table and every image's intrinsic dimensions) and one content shard per image, audio or video file, each deflated when that makes it smaller and optionally sealed with per-shard XChaCha20-Poly1305 keys. The whole book lays out from the skeleton alone (a median of 7% of the archive on the test corpus), so opening, page numbers, the table of contents, search and turning behave exactly as for the EPUB; only painting an image waits on its shard. `createReader` and React's `load` accept a `ReaderShardedPublication` (`{ skeleton, key?, loadShards }`) wherever they accepted an `ArrayBuffer`: the engine names an image's shard the first time it is read, the client loads it through `loadShards`, hands it to the worker and retries the read. While the reader is idle, the client also supplies image shards ahead of need, nearest the chapter being read first, one at a time and only while no other call is in flight. Engine errors gain the `resource-pending` code with `pendingShards`; a page is prepared without waiting for its images, so it paints at once, and an image whose shard has not arrived is read, and repainted, as soon as the shard is in.

### Patch Changes

- 1246015: `Reader.findActiveTocEntry` and the TOC targets behind `findPage`/`resolveTocEntry` now come from the engine's source-locator resolution, so an entry whose fragment repeats an id from an earlier chapter, points at an inline element or at an empty `<a id/>` marker is placed where following it lands instead of being dropped; previously such entries never highlighted. The engine also decides each page's active entry itself (the last entry, in TOC order, whose target is at or before the page) and the browser binding only looks it up. Resolving a locator no longer builds a chapter's page artifacts unless the selector needs source positions, which takes TOC placement on a 730-page book from about 850 ms to under 3 ms.
- f68344a: The engine parses a publication's stylesheets once instead of once per chapter per layout, and its layout cache evicts in logarithmic time where a full cache scanned every entry on each insert. A reader session's font catalog and unresolved family names now cross from the worker as the same binary messages the C ABI uses.
- 2fa5498: A reader keeps a bounded log of what it asked its session and what it was answered — each request with its duration and outcome, each layout commit, each warning, and a request still unanswered shown as pending — so a report of something going wrong can carry it. `__ritoReaderDiagnostics.log()` returns it; bytes and long lists are shortened to their sizes and strings to 96 characters, so an entry can carry up to that much of a footnote, a selected range, an annotation's quote or a search query.
- 7d8ae3e: The browser worker allows as many live artifacts as the engine (six; it was four), and the worker client holds a call made while it is busy instead of refusing it.
- 20336ad: A page turn's first frame only composites. A page buffer is now rastered when it is painted (a canvas records its drawing calls and rasters them when first read as an image, which used to be the turn's first frame), a neighbouring spread is painted into its buffer when its content arrives instead of only once after the previous turn, and the accessibility mirror is rebuilt once the reader is at rest on a spread — after the frame that shows it and after a turn onto it has ended — instead of laying out two pages of text in front of that frame. On a 1280×860@2x double page the first frame of a turn follows the key by 19–25 ms where it took 29–34. A key a widget on the page has already handled (a slider stepping on an arrow key) is no longer taken as a reader shortcut, and search results are found again in a layout that replaces the one they were found in.
- 01bd730: A block or image sized with `fit-content`, `min-content`, `max-content`, `fit-content()`, `-webkit-fill-available` or `stretch` no longer fails its chapter's layout; previously a single `width: fit-content` card stopped pagination at that chapter. Until these sizes are computed they lay out as `auto` (an image keeps its natural size), an intrinsic `max-width` caps nothing, and the rest of the element's style — numeric widths and caps, padding, margins and borders — still applies. Floats with `stretch` or `-webkit-fill-available` fill the available width; the other keywords shrink to fit.

## 2.1.0

## 2.0.0

### Major Changes

- 9c981a8: Layout options the engine never acted on are removed instead of being accepted silently: `ReaderOptions.lineBreaking` and `Reader.setLineBreaking()` (one line breaker exists; `'optimal'` always laid out as greedy), `ReaderOptions.paginationPolicy` and the `PaginationPolicy` type (widow/orphan control comes from the book's CSS), and `LayoutConfig.textMeasurement` (shaping is always font-aware). The browser host no longer measures Canvas glyph advances or re-paginates when those measurements change; the engine shapes with the pinned faces and the publication's `@font-face` fonts only, so every such re-pagination produced identical pages. `@ritojs/kit` and `@ritojs/react` drop the `setLineBreaking` action and its `lineBreaking` model field.
- 0dfd1d8: Every `V1` suffix leaves the API. The repository never carried a second version of any of these types, and the one number that does move (the reader protocol version, now 5) proved the suffix meaningless. `openBrowserReaderV1` is `openBrowserReaderSession`, `createBrowserReaderV1CanvasPresenter` is `createBrowserReaderSessionCanvasPresenter`, `RitoReaderErrorV1` is `RitoReaderError`, and every `…V1` type on the public entry drops it. The reader session protocol's own modules and files carry `reader-session` where they carried `reader-v1`, so the session protocol and the revision worker no longer share a prefix. Only two places still name a version: the wire magic tags, whose trailing digit is the format number a decoder checks, and the numeric protocol and format version constants themselves.
- e7438ed: `Reader` drops its fabricated page model. `Reader.pages` and the `Page` type are removed: the engine owns page content and geometry, and the projection carried an empty `content` array and a copy of the layout page size. `Spread` is now the engine's navigation record, `{ index, pageIndexes, leftPageIndex, rightPageIndex? }`, instead of a wrapper around fake pages; `Reader.spreads`, `totalSpreads`, `findSpread()` and `findPage()` keep their signatures on that shape, and `Reader.pageCount` is added. `Reader.measurer` and the `TextMeasurer`, `TextMetrics`, `MeasurePaint` and `FontShorthand` types are removed: measurement lives in the engine and the stub measured a fixed 8px per character. `Reader.pagination` and `ReaderIncrementalPagination` are removed: every revision is laid out complete in one step, so `complete` was always `true` and `ensureSpread()` only compared an index against `totalSpreads`.

  In `@ritojs/kit`, `buildHitMap` and `resolveAnnotations` leave the entry point together with the page/hit-map path they served (the synchronous selection engine, link and hit maps, the page-walking accessibility mirror source, and the page-text search index): selection, clicks, search highlights, annotations, and the accessibility mirror read `reader.interactions`, `createController` throws when `reader.interactions.textSelection` is missing, and `ReaderController.pages`, `paginationComplete`, `selectionRange`, `selectionChange.range`, and `ResolvedAnnotationSegment.range` are removed. Growth navigation is removed with it (the pending-growth navigation state, `ensureSelectionSpread`, and the retry of a queued TOC target on layout commit): a target beyond `totalSpreads` is out of range. In `@ritojs/react`, `useSelection()` no longer reports `range`, and `useRitoReader().spreads` is the navigation record.

- 05bbb1d: Every revision is complete the moment it is created, and the public types now say only that: a revision summary is `{ revisionId, revisionVersion, layoutKey, pageCount, spreadCount }` (a chapter-local one `coordinate`, `localPageCount`, `localSpreadCount`) with no `status`, `knownExtent` or `finalExtent`; `createRevision` returns that summary and `createChapterLocalRevision` returns `{ revision, target }` in a mutation result keyed `created`. Reader protocol v1 moves to version 5: `BrowserReaderArtifact` drops `terminalExtent` (every whole-book artifact carries `bookPageIndex` and `bookPageCount`), adjacent availability is `'available' | 'chapter-boundary' | 'terminal'`, the search response drops `scopeComplete`, and a `complete` background advance carries no artifact because the first publication candidate already carries the book page count. Hosts decoding the wire by hand must move their version gate to 5.

### Patch Changes

- 5755997: Fragment-painted text and image commands carry the enclosing link's target and an image's alt text again. The fragment cutover shipped them as `None`, so the hit entries a host resolves taps against carried no links — a tap on a note anchor fell through to the image viewer.

## 1.0.1

### Patch Changes

- a000e28: Backward cross-chapter page turns land in one call: chapter-local pagination now builds the whole target chapter through the fragment engine in a single pass (no page-cap windows or pending-seek retries), shares the whole-book footnote index and image dimensions so background candidates always match the visible pages, and an open locator that no longer resolves degrades sourcePoint → progression → chapter start instead of refusing the book.
- feb6d09: Images letterbox inside the author box (`img { object-fit: contain }` in the UA stylesheet, author-overridable).
- feb6d09: JPEG dimensions honor EXIF 90-degree orientations.
- 5db2dba: Page turns no longer snap back: progression locators resolve on the chapter's page grid (text-free pages round-trip to themselves), and background layout commits never move the visible spread.
- a000e28: Layout no longer depends on which chapters the engine laid out first (the line-height:normal strut cache keys on font inputs, not per-chapter style ids), the V1 display protocol covers explicit background sizes, border edge widths, and inline box extents, and fragment-table search hits carry durable source anchors.
- 5db2dba: Spreads with still-decoding images paint immediately and fill in when the bitmaps land, instead of blocking the page turn.

## 1.0.0

### Major Changes

- 44ace14: The fragment engine is now the only pagination pipeline, and misconfiguration fails loudly.

  Breaking changes in `@ritojs/core`:
  - `createReader` now **requires** `pinnedFontPolicy` with at least one face. The engine shapes
    text with those exact font bytes; without them it previously fell back to the legacy pipeline
    and silently rendered something else entirely. A missing or empty policy now throws at open.
  - The `experimentalFragmentPagination` option is **removed** (it briefly existed as
    `fragmentPagination`). The fragment engine is always on; the legacy pagination path and its
    demo kill-switch URL (`?fragmentPagination=0`) are gone. Its output was never pixel-accurate
    and a fallback that lands on a broken rendering is a trap, not a safety net.
  - The 0.13 compatibility subpaths (`@ritojs/core/web`, `/advanced`, `/selection`, `/search`,
    `/annotations`, `/position`, `/a11y`, `/dom`) are **removed**, together with the root
    `loadEpub` export. Migration:
    - `createReader`, `Reader`, `ReaderOptions` — import from `@ritojs/core` (same signatures).
    - `buildHitMap`, `resolveAnnotations`, `AnnotationRecord`, `AnnotationRecordPatch`,
      `RecordStorageAdapter`, `ReadingPosition`, `parseReadingPosition` — import from
      `@ritojs/kit` (their production home; `buildHitMap` accepts `reader.pages` pages directly).
    - `loadEpub` (data-level parse/validate without a canvas) has no replacement yet; validate by
      opening a reader, or stay on 0.13 for that single call until a data-level oracle ships.
  - Bounded revisions paginate the whole book in one step on the fragment engine, so the
    continuation-drain worker protocol (and its release-protocol e2e) is retired. Progressive
    per-chapter publication is planned on top of the fragment page table.

  `@ritojs/kit` additions and fixes:
  - `buildHitMap` and `resolveAnnotations` are exported from the package root.
  - Page-turn springs settle at the 0.13 thresholds again (sub-pixel and essentially stationary);
    a coarser settle cut had every turn end with a visible snap instead of the eased landing.

  Known limitations of the fragment engine in this release:
  - `setTypography({ fontFamily })` does not change the rendered faces: the pinned
    fallback chain is applied in policy order rather than by generic role, so the
    first face keeps serving every glyph. Hosts that offer a font choice should
    open the reader with a pinned font policy containing the chosen faces
    (the pattern the Flutter reader uses).
  - `search()` finds matches and navigates to them, but reports its sources as
    unavailable; callers fall back to `getChapterTextIndices()` for durable
    ranges. Exact source range resolution itself works, including across
    soft-wrapped lines.
  - Durable source-locator projection (exact reading-position persistence and
    restore, search-result highlight painted from a committed source range,
    internal-link growth past the known extent) resolves unavailable pending
    the fragment source-locator cutover; page-index based persistence keeps
    working in the meantime.

- 244ada2: Replace the public TypeScript reader runtime with the Rust/WASM-backed native core, move the old
  TypeScript engine behind a source-only parity oracle, and migrate Kit and React to the root Reader
  contract. The public core package now ships its WASM runtime internally instead of exposing legacy
  implementation subpaths. Kit reading positions now persist native source locators, and
  `ReaderController.goToPosition` returns a Promise while resolving them through an atomic
  Reader-owned revision transition. Exact revision bundles, search, footnotes and chapter text
  indices now cross both in-process and Worker transports, and Browser frame/resource/search/release
  operations bind the complete revision version in preparation for bounded incremental pagination.
  Bounded sessions now publish a slim exact-version presentation without cumulative footnote or
  chapter-text payloads, can grow directly to a durable source locator, and can explicitly drain to a
  complete revision. Locator transport echoes its normalized request, and recoverable locator/frame
  reads fail only their target instead of releasing a healthy session.
  Native text ranges now span exact retained flows within a chapter, preserve native line and block
  separators, survive reflow through durable source ranges, and expose TOC-backed destination labels
  for internal-link previews. Production Reader gestures retain their anchor while reversing direction
  and preserve the latest valid in-flight drag result when pointer release lands outside text or races a
  cancelled exact-read response.
  Rust-authoritative ICU word and retained-flow paragraph selection now power mouse double/triple click,
  repeated-click drag, and touch long press while preserving exact cross-page source ranges.
  Released native selections now survive asynchronous image/frame content repaints. Candidate revisions
  calibrate browser font advances and exact-size vertical font boxes before becoming interactive, so
  caret/highlight geometry matches native selection without shrinking the forgiving line-height hit area.
  Captured touch handles can now grow an unpublished bounded spread and continue across the appended
  revision through an atomic stable-prefix caret-to-point operation; replacement layouts still invalidate
  the selection, and stale growth cannot supersede a newer navigation or layout intent.
  Primary mouse/pen and touch long-press selection drags now use the same exact gesture lease to dwell
  across already-published or lazily appended spread edges, replay through the new coordinate projection,
  retain precise copied text after immediate release, and suppress target activation after a physical turn.
  Every physical selection press now claims one latest-input barrier before resolving coordinates, cancels
  older spread/locator/portable-position work without invalidating a stable reading position, and passes the
  same claim to derived mouse semantics or the delayed long-press instead of letting them reclaim ownership.
  Canvas-focused keyboard selection now uses an atomic Rust fixed-anchor movement contract for physical
  characters, platform-specific word and paragraph boundaries, sticky visual lines, line edges and
  same-chapter edges. Serialized Kit commands retry append-staled reads, preserve collapsed caret continuity,
  fail closed when a newer input or navigation owns the surface, and grow/reveal a lazy chapter tail without
  dropping the retained highlight.
  The locale-aware ICU auto data increases the release WASM by about 2.5 MB raw (1.9 MB gzip) and
  37 initial memory pages; this preserves Chinese, Japanese, Thai, and locale-tailored word behavior.

### Patch Changes

- cd79681: Theme overrides (dark/sepia) own the page ground again: the Rust core
  materializes the book's body background for pixel parity, and the Canvas
  renderer now substitutes the host theme background for it whenever a
  foreground/background override is active, instead of letting the
  materialized white bury the theme.
- 8483656: A multi-line exact source range now resolves under the fragment engine. The
  fragment backend reported the laid-out page text — line and page separators
  included — as both the selected text and the source checksum, so any range
  that crossed a soft-wrapped line failed its source verification and came back
  `sourceUnavailable`. Selected text now reads continuously across soft wraps
  inside one block (matching what a browser selection copies, with `\n` only at
  block boundaries), and the checksum segments are split on those boundaries so
  they verify against the source document.
- 44ace14: Pixel-parity fixes measured against pinned Chromium across the 123-book corpus:
  - A childless inline box (an empty `<sup>` footnote anchor) joins its line's metrics with its
    font's integer envelope around the raised baseline, matching Blink's integer half-leading and
    `super` shift laws. A whole book of footnoted prose now renders at pixel zero.
  - An inline flow holding nothing but empty anchors is an empty paragraph (CSS 2.1 §9.4.2), and
    an empty anchor settles a pending collapsed space into the previous text run — calibre books
    with mid-sentence `<a></a>` anchors no longer grow phantom lines or fuse words.
  - The line-end punctuation trim measures a straddle-suppressed opener in its mid-line half-width
    form and un-suppresses the pair when the extension lands, matching Blink's shaping-domain
    order; quote-chain line breaks land where the browser breaks them.

## 0.13.0

### Minor Changes

- d4d14e6: Harden EPUB loading and footnote HTML, fix pagination/typography/render/interaction correctness, bound resource caches and ZIP/image work, add strict DOM-free XML parsing and the stable core integration boundary, and make theme/lifecycle cleanup reliable across Core, Kit, and React.

### Patch Changes

- 58950f2: Accept legacy HTML-style void elements such as `<br>` and `<img>` in EPUB XHTML
  while preserving strict XML failures for other malformed markup.
- 9af6efe: Avoid quadratic line-breaking work when EPUB chapters contain very large flat text blocks or
  thousands of forced line breaks.

## 0.12.1

### Patch Changes

- 9c1688b: Open spec-violating EPUBs that earlier failed to load. The OPF parser now
  defaults missing `dc:title` / `dc:language` / `dc:identifier` to an empty string
  with a warning instead of throwing (the structural `<manifest>` / `<spine>`
  checks stay strict), and the ZIP reader percent-decodes container paths on a
  lookup miss, so a manifest href like `Text/Character%20Profile.xhtml` resolves
  to the literal `Text/Character Profile.xhtml` archive entry.
- 9c1688b: Resolve in-content illustrations that previously rendered as broken images.
  `loadEpub` now indexes every image file present in the archive — not only those
  declared in the OPF manifest — so spec-violating books that reference undeclared
  illustrations still get image data. Manifest resource reads are individually
  tolerant (a single missing/mislabeled entry is skipped with a warning instead of
  aborting the load), and href resolution percent-decodes on miss so references
  like `Images/My%20Pic.jpg` match a literal `Images/My Pic.jpg` entry.
- 9c1688b: Parse EPUB chapters whose XHTML is invalid in strict XML. The source normalizer
  now escapes stray ampersands (e.g. `Schmidt & Bender`), remaps HTML named
  entities undefined without a DTD (`&copy;`, `&mdash;`, `&nbsp;`, …) to numeric
  references, and strips characters illegal in XML (C0 controls, `U+FFFE/FFFF`,
  lone surrogates, and numeric refs pointing to them), while leaving comments and
  CDATA sections untouched. Chapters that previously failed with errors such as
  `EntityRef: expecting ';'` or `PCDATA invalid Char value 31` now parse.

## 0.12.0

### Minor Changes

- bf99147: Add reader typography initialization, restore-safe position persistence, annotation click coordinates, and jump navigation.
- 82a637c: Add source-anchored reading positions with restore-safe layout projection.

## 0.11.0

### Minor Changes

- fe48b60: Add the internal reader runtime foundation: revision-scoped protocol contracts,
  reader-session orchestration, frame building, locator/search/footnote/resource
  commands, worker-neutral transports, resource transfer lifecycle, and native
  reader architecture/UI planning docs.

## 0.10.0

### Minor Changes

- 89e3441: Split core into a platform-neutral display-list API and a Web Canvas preset entry.

### Patch Changes

- 897cbfa: Fix float clearing to use CSS float margin boxes.
- e798c67: Refactor tag defaults into the UA cascade and fix none border layout
- 49ab16d: Fix forced-break line alignment and KP inline run merging.

## 0.9.0

### Minor Changes

- 5313906: Add runtime line-breaking configuration so readers can switch between greedy and optimal pagination.

  Fix greedy line breaking so English hyphenation does not cross into adjacent CJK text, preventing mixed Latin/CJK runs from being split and over-justified.

  Fix Canvas text spacing reset and hit testing so mixed Latin/CJK text, brackets, and selections stay aligned after rendering letter- or word-spaced content.

## 0.8.0

### Minor Changes

- 424acd3: Add Unicode-aware CJK and mixed-script line breaking with CSS line-break, word-break, text-justify, and inherited language support.

### Patch Changes

- 7e6844d: Fix custom-font title centering and honor body bgcolor page backgrounds during pagination.

## 0.7.3

### Patch Changes

- e37770a: Refactor layout, render, and reader internals to reduce lint complexity while preserving rendering output.

## 0.7.2

### Patch Changes

- 2796283: Fix search navigation state updates when jumping to a distant result. Far search jumps now emit spreadChange so reader state stays in sync after skipping animated navigation.

## 0.7.1

### Patch Changes

- f4b520d: Fix controller render-scale initialization to avoid canvas resize flicker when reloading a book.

## 0.7.0

### Minor Changes

- 570f326: Add per-property force flags and null-clear semantics to `setTypography`.
  - `lineHeightForce` / `fontFamilyForce`: when `true` and the corresponding value is set, the override is rewritten onto every element during pagination, bypassing element-level CSS (e.g. `p { line-height: 1.3em }`). When `false` (default), the override only cascades from body and element-level rules still win — preserves previous behavior.
  - Value fields (`fontSize`, `lineHeight`, `fontFamily`) now accept `null` to explicitly clear a previously-set override and fall back to the book's natural value. `undefined` continues to mean "no change".

  Existing callers that pass values or `undefined` continue to work unchanged.

## 0.6.0

### Minor Changes

- Prepare the public release surface for the Rito packages.

  This release removes worker pagination from the core package, fixes controller and React lifecycle issues found during prepublish review, and adds package-level documentation plus release metadata for the public packages.
