---
'@ritojs/core': minor
'@ritojs/kit': minor
---

The fragment engine is now the only pagination pipeline, and misconfiguration fails loudly.

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
- `search()` results report their source as unavailable and callers fall back
  to `getChapterTextIndices()` for durable ranges; exact source range
  resolution itself works, including across soft-wrapped lines.
