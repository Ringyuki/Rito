# @ritojs/kit

## 1.0.1

### Patch Changes

- Updated dependencies [a000e28]
- Updated dependencies [feb6d09]
- Updated dependencies [feb6d09]
- Updated dependencies [5db2dba]
- Updated dependencies [a000e28]
- Updated dependencies [5db2dba]
  - @ritojs/core@1.0.1

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

- Updated dependencies [cd79681]
- Updated dependencies [8483656]
- Updated dependencies [44ace14]
- Updated dependencies [244ada2]
- Updated dependencies [44ace14]
  - @ritojs/core@1.0.0

## 0.13.0

### Minor Changes

- d4d14e6: Harden EPUB loading and footnote HTML, fix pagination/typography/render/interaction correctness, bound resource caches and ZIP/image work, add strict DOM-free XML parsing and the stable core integration boundary, and make theme/lifecycle cleanup reliable across Core, Kit, and React.

### Patch Changes

- 58950f2: Accept legacy HTML-style void elements such as `<br>` and `<img>` in EPUB XHTML
  while preserving strict XML failures for other malformed markup.
- 9af6efe: Avoid quadratic line-breaking work when EPUB chapters contain very large flat text blocks or
  thousands of forced line breaks.
- Updated dependencies [d4d14e6]
- Updated dependencies [58950f2]
- Updated dependencies [9af6efe]
  - @ritojs/core@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies [9c1688b]
- Updated dependencies [9c1688b]
- Updated dependencies [9c1688b]
  - @ritojs/core@0.12.1

## 0.12.0

### Minor Changes

- bf99147: Add reader typography initialization, restore-safe position persistence, annotation click coordinates, and jump navigation.
- 82a637c: Add source-anchored reading positions with restore-safe layout projection.

### Patch Changes

- Updated dependencies [bf99147]
- Updated dependencies [82a637c]
  - @ritojs/core@0.12.0

## 0.11.0

### Minor Changes

- fe48b60: Add the internal reader runtime foundation: revision-scoped protocol contracts,
  reader-session orchestration, frame building, locator/search/footnote/resource
  commands, worker-neutral transports, resource transfer lifecycle, and native
  reader architecture/UI planning docs.

### Patch Changes

- Updated dependencies [fe48b60]
  - @ritojs/core@0.11.0

## 0.10.0

### Minor Changes

- 89e3441: Split core into a platform-neutral display-list API and a Web Canvas preset entry.

### Patch Changes

- 897cbfa: Fix float clearing to use CSS float margin boxes.
- e798c67: Refactor tag defaults into the UA cascade and fix none border layout
- 49ab16d: Fix forced-break line alignment and KP inline run merging.
- Updated dependencies [897cbfa]
- Updated dependencies [e798c67]
- Updated dependencies [49ab16d]
- Updated dependencies [89e3441]
  - @ritojs/core@0.10.0

## 0.9.0

### Minor Changes

- 5313906: Add runtime line-breaking configuration so readers can switch between greedy and optimal pagination.

  Fix greedy line breaking so English hyphenation does not cross into adjacent CJK text, preventing mixed Latin/CJK runs from being split and over-justified.

  Fix Canvas text spacing reset and hit testing so mixed Latin/CJK text, brackets, and selections stay aligned after rendering letter- or word-spaced content.

### Patch Changes

- Updated dependencies [5313906]
  - @ritojs/core@0.9.0

## 0.8.0

### Minor Changes

- 424acd3: Add Unicode-aware CJK and mixed-script line breaking with CSS line-break, word-break, text-justify, and inherited language support.

### Patch Changes

- 7e6844d: Fix custom-font title centering and honor body bgcolor page backgrounds during pagination.
- Updated dependencies [424acd3]
- Updated dependencies [7e6844d]
  - @ritojs/core@0.8.0

## 0.7.3

### Patch Changes

- e37770a: Refactor layout, render, and reader internals to reduce lint complexity while preserving rendering output.
- Updated dependencies [e37770a]
  - @ritojs/core@0.7.3

## 0.7.2

### Patch Changes

- 2796283: Fix search navigation state updates when jumping to a distant result. Far search jumps now emit spreadChange so reader state stays in sync after skipping animated navigation.
- Updated dependencies [2796283]
  - @ritojs/core@0.7.2

## 0.7.1

### Patch Changes

- f4b520d: Fix controller render-scale initialization to avoid canvas resize flicker when reloading a book.
- Updated dependencies [f4b520d]
  - @ritojs/core@0.7.1

## 0.7.0

### Minor Changes

- 570f326: Add per-property force flags and null-clear semantics to `setTypography`.
  - `lineHeightForce` / `fontFamilyForce`: when `true` and the corresponding value is set, the override is rewritten onto every element during pagination, bypassing element-level CSS (e.g. `p { line-height: 1.3em }`). When `false` (default), the override only cascades from body and element-level rules still win — preserves previous behavior.
  - Value fields (`fontSize`, `lineHeight`, `fontFamily`) now accept `null` to explicitly clear a previously-set override and fall back to the book's natural value. `undefined` continues to mean "no change".

  Existing callers that pass values or `undefined` continue to work unchanged.

### Patch Changes

- Updated dependencies [570f326]
  - @ritojs/core@0.7.0

## 0.6.0

### Minor Changes

- Prepare the public release surface for the Rito packages.

  This release removes worker pagination from the core package, fixes controller and React lifecycle issues found during prepublish review, and adds package-level documentation plus release metadata for the public packages.

### Patch Changes

- Updated dependencies
  - @ritojs/core@0.6.0
