# Layout Capability Checklist

Missing typography/layout capabilities in the fragment engine, inventoried
2026-07-23 from the whole-corpus browser sweep (46 books) and the engine's
own degradation records. Every unchecked item currently renders through a
defined approximation and is reported in the chapter's degradations — none
is a silent divergence or a hard failure.

**Acceptance rule for every item:** the browser is the baseline. An item is
checked only when the corpus A/B tooling (`apps/reader/compare.html`,
`scratchpad corpus-ab` line diff) shows the implementation matching pinned
Chromium on the books that exercise it — never when unit tests alone pass.

## Tier 1 — affects nearly every book (attack in this order)

- [ ] **Justified CJK punctuation compression (JLREQ)** — unimplemented.
      Browsers fit 1–2 more characters per line, so line breaks and page
      breaks drift early book-wide. Root cause of 49 mismatched chapters in
      the corpus line diff.
- [ ] **Full margin-collapse semantics between blocks** — approximate.
      Paragraph gaps render visibly larger than the browser's.
- [ ] **Line-height cascade details** — in progress (cascade provenance is
      already reported to the materializer). Residual 1–6px line drift in
      some books.
- [ ] **Forced page breaks (`break-before/after: always`)** — ignored with
      a degradation note. Common in real EPUBs; cheap high-value fix.

## Tier 2 — whole feature classes, currently approximated

- [ ] **Vertical writing (`writing-mode: vertical-rl`) and bidi/RTL** —
      everything lays out horizontal LTR. Largest single project; most
      visible on Japanese vertical-set novels.
- [ ] **Real flex/grid layout** — containers flatten to block flow (only
      the bounded single-image-centered-flex subset is real).
      `display: contents` renders as inline.
- [ ] **Table layout** — table-family displays lay out as blocks;
      colspan/rowspan pass through unused.
- [ ] **Positioning** — `absolute` lays out in flow; `relative` with a
      non-auto inset ignores the offset.
- [ ] **Floated images (line-box wrapping)** — block floats with clearance
      are implemented; floated images degrade to in-flow.
- [ ] **Preserved white space (`pre`, `pre-wrap`, `nowrap`)** — still a
      fail path in the fragment tree build (one of the few remaining
      non-fail-open sites; `<pre>`-heavy books will hit it).
- [ ] **Sizing gaps** — `calc()` drops its percentage component;
      `max-content`/`min-content`/`fit-content`/`stretch` become auto;
      basis-less percentage heights become 0;
      `box-sizing: border-box` is treated as content-box.
- [ ] **Inline-box horizontal margin/padding/border** (the glyph-shifting
      kind) — ignored; inline vertical margins ignored.

## Tier 3 — text and paint details

- [ ] **`vertical-align` beyond baseline/sub/super** — length offsets and
      the text-top/bottom family all fall to baseline; sub/super use fixed
      ratios pending oracle calibration.
- [ ] **`text-decoration` fidelity** — only a single solid foreground-color
      line; double/wavy/dashed styles, decoration colors, and overline
      approximate to that line or drop.
- [ ] **Generated content** — `::before`/`::after`, `first-letter`,
      `first-line`, hyphenation: none.
- [ ] **Ruby fidelity** — implemented, but annotation geometry has never
      been pixel-checked against the browser; `ruby-align` is a no-op.
- [ ] **Paint gaps** — `opacity`, `transform`, `box-shadow`/`text-shadow`,
      gradient and multi-layer backgrounds, arbitrary-length
      `background-size` (only auto/cover/contain paint), single-slot
      `border-radius`, non-sRGB colors (oklch/lab), no stacking
      contexts/z-index (document-order paint).

## Tier 4 — fonts

- [ ] **Pinned fallback breadth** — the platform font database is
      deliberately excluded (native and wasm resolve identically), so
      system family names ("宋体", "游明朝") fall to the pinned set: only
      Tinos + SourceHanSerifCN, both serif. No sans-serif/monospace
      faces, no dedicated bold/italic faces (synthesis unverified).
- [ ] **Metric/paint divergence for sanitizer-rejected faces** — a face
      the canvas OTS rejects is skipped for paint while shaping (swash)
      still used it; affected runs draw with fallback glyph widths.

## Recently closed (2026-07-23, for context)

- [x] Fonts unresolvable in wasm (no generic/script fallback mapping;
      platform DB divergence) — blanked ~30 books' pages.
- [x] Style-layer whole-book rejections (box-sizing, font-variant,
      background-size values, line-break, bidi) — 8 books refused.
- [x] Malformed-XML chapters silently blanked (bare `&`, control chars,
      HTML entities) — now repaired like an HTML parser.
- [x] GIF/WebP/BMP image dimensions unsupported; a single undecodable
      image or font face failed the whole book.
