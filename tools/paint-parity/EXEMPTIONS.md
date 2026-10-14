# Paint-parity residual ledger — Skia rasterizer exemptions

Status as of 2026-10-11, corpus at `tools/paint-parity/fixtures/`,
verdict produced by `node tools/paint-parity/run.mjs` (report.md).
`budgets.json` pins each fixture's allowed diff-pixel count and channel
delta; diff.mjs exits non-zero when a fixture exceeds its budget or has
none, so pen drift fails the run instead of surfacing in a real book.

## What the instrument compares

Since the paint-geometry lowering every fixture is lowered **in the
engine** (`cargo test -p rito-core --lib lower_paint_parity_fixtures`,
env-gated) into `RITODL1` format-2 bytes — the device-resolved primitive
list at ratio 1 — and both production pens blit those same bytes:

- **oracle** `browser/`: the production JavaScript decoder and the
  browser primitive renderer (`primitive-renderer.ts`) in headless
  Chromium;
- **lane** `flutter/`: the production Dart decoder and
  `RitoPrimitiveCanvasTarget` in flutter_tester (Skia).

Neither pen holds a geometry law any more: border bands and dash
cadences, rounded rings and crescents, box shadows, background sizing
and tiling, clip snapping, inline boxes (background bands, padding,
border edges) and decoration lines — all resolve in
`crates/rito-core/src/render/lower/`. A lowering law is proven against
Chromium by the pixel walk (`tools/corpus-oracle/pixel-walk.mjs`), not
here. What this instrument measures is the only thing left between the
two pens: the rasterizer. Every residual below is a Skia-vs-Chromium
raster difference on identical device geometry, never a rule gap; each
entry states the evidence for why it is attribution. Text runs arrive
with every cluster origin placed by the engine, so the text fixtures
carry only glyph-AA residuals: the same glyph at the same origin,
rastered by two engines.

| fixture                      | diff px        | max Δ | class                                 | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------- | ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| block-background-image       | 11712 (8.87%)  | 23    | bilinear rounding                     | raw-pixel compare: no-repeat tile region byte-identical; scaled regions differ by ±1–2 per channel on gradient transitions (e.g. browser 2,41,252 vs flutter 3,41,252)                                                                                                                                                                                                                                                                       |
| image-source-rect            | 11516 (13.78%) | 14    | bilinear rounding                     | same sampler-precision class; diff confined to color-transition bands, zero structural offset (checker cell edges align row-exactly)                                                                                                                                                                                                                                                                                                         |
| block-badge-overlap-shadow   | 7853 (6.23%)   | 24    | blur kernel + arc AA                  | identical stadium outline, ring paths and shadow shape on both sides; residual is Skia mask-blur vs Chromium layer-blur and corner-arc coverage                                                                                                                                                                                                                                                                                              |
| text-synthetic-bold          | 6197 (10.54%)  | 112   | synthetic-bold stroke shape           | policy v1 pins Regular only, so weight 700 synthesizes on BOTH pens (the production web reader pins the same single-weight set); ink-segment scan shows advances identical (line endpoints within 1px, weight 650 buckets identically) — Chromium's embolden just paints fatter strokes than Skia's. Geometry and measurement stay aligned                                                                                                   |
| theme-white-page-inline-band | 5662 (6.74%)   | 54    | glyph AA (relit ink)                  | white page → theme ground, inline band pair kept, black → exact foreground, #cc0000 → rgb(255,203,203) on both pens (base pixels agree; diff is the AA fringe of relit glyphs on the dark ground); band/page flats zero-diff                                                                                                                                                                                                                 |
| theme-designed-page          | 4784 (5.18%)   | 94    | glyph AA (CJK + bold)                 | R1 designed teal ground + white card verified: every large flat region (page, card) is zero-diff, so both pens made identical R1/R2 keep decisions; diff rows cluster only inside text rects and sampled pixels share the base ink both sides (170,34,34 red vs its AA blend) — CJK strokes and 18px bold widen the AA fringe                                                                                                                |
| block-box-shadow             | 4169 (4.14%)   | 23    | blur/AA edge                          | 1–3px ring at the box/clip boundary; the spread box, offset and interior exclusion are the same device path on both sides; remaining delta is Skia mask-blur vs Chromium layer-blur edge treatment                                                                                                                                                                                                                                           |
| state-transform-clip         | 3454 (2.88%)   | 2     | edge AA rounding                      | Δ≤2 everywhere; rotated/scaled/clipped edges only                                                                                                                                                                                                                                                                                                                                                                                            |
| theme-override-dark          | 3352 (3.99%)   | 2     | glyph AA on themed ground             | dark-theme override verified end to end under R1–R3: white page ground taken over, achromatic ink lands exactly on the theme foreground, chromatic link-blue relights along lightness — both pens byte-agree on every policy decision (Δ≤2 is glyph AA)                                                                                                                                                                                      |
| text-shadow-ruby             | 3273 (3.9%)    | 14    | shadow blur kernel + glyph AA         | shadow geometry (each cluster at the baseline the engine placed, plus the shadow's offset) matches on both pens; since the pens draw the engine's cluster origins, the Flutter pen blurs each run's clusters as one layer (Skia ImageFilter) where Chromium blurs a scratch canvas (shadowBlur) — the residual is the two blur profiles' soft fringe (Δ≤14), no glyph or shadow moves. Ruby itself is row-identical including AA gray levels |
| text-colors-fonts            | 1550 (1.84%)   | 3     | glyph AA + alpha compositing rounding | Δ≤3; synthetic-italic and translucent-fill coverage rounding                                                                                                                                                                                                                                                                                                                                                                                 |
| text-inline-box              | 1540 (1.52%)   | 2     | fill edge AA                          | envelope geometry exact; Δ≤2 on fractional box edges                                                                                                                                                                                                                                                                                                                                                                                         |
| text-vertical                | 1534 (2%)      | 255   | glyph AA + rotated-mark raster        | a vertical-rl column generated from the painter itself: upright glyphs one step apart, corner marks shifted, brackets and dashes each under a quarter-turn transform, the annotation spread down its base — both pens draw the same engine origins (the browser lane is byte-identical to the column pen it replaced); residual is Skia vs Chromium glyph AA on CJK strokes and the rotated marks                                            |
| block-radius                 | 583 (0.46%)    | 5     | arc AA                                | per-corner and overlap-scaled outlines are identical device paths on both sides (614 px / Δ128 while the Flutter pen still resolved its own radii); only arc coverage is left                                                                                                                                                                                                                                                                |
| text-decoration              | 175 (0.26%)    | 2     | fill edge AA                          | the engine lowers each line to a rect on whole rows (top rounded, thickness floored to ≥1, the browser's own snap); both pens fill the same rect, and Δ≤2 is the antialiasing of its fractional x extents (431 px / two-row blends while the pens stroked the unsnapped centreline)                                                                                                                                                          |
| hr-styles                    | 361 (0.5%)     | 1     | stroke/dash AA                        | one set of device rects on both sides (565 px / Δ11 while the Flutter pen strokes its own rule model); dot/dash caps differ in coverage                                                                                                                                                                                                                                                                                                      |
| text-family-fallback         | 312 (0.57%)    | 1     | glyph AA                              | family stack split verified: quoted/bare/multi-level stacks resolve to the same face both pens paint (a split regression rasters Ahem boxes and blows past 20%)                                                                                                                                                                                                                                                                              |
| text-baseline-phases         | 116 (0.13%)    | 13    | glyph AA phase                        | baseline rows identical; Chromium spreads glyph AA one extra row at fractional phases (hinting), Skia does not                                                                                                                                                                                                                                                                                                                               |
| block-borders-solid          | 57 (0.06%)     | 1     | fill edge AA                          | four-colour box: the two-colour corners meet on the miter diagonal (the browser's quad from the outer to the inner corner, filled as a path); Δ1 on the diagonal and the band edges                                                                                                                                                                                                                                                          |
| text-letter-spacing          | 11 (0.01%)     | 1     | glyph AA                              | letter spacing arrives folded into the engine's cluster origins and both pens draw with their own spacing off (ink-segment scan)                                                                                                                                                                                                                                                                                                             |
| image-broken-fallback-dark   | 538 (0.58%)    | 2     | fill and path edge AA                 | the broken-image placeholder on a dark page at five sizes: block and icon come from one engine-lowered primitive, the same device geometry on both pens; Δ≤2                                                                                                                                                                                                                                                                                 |
| image-broken-fallback        | 121 (0.13%)    | 1     | fill and path edge AA                 | the broken-image placeholder at five sizes, down to a 12px box; Δ≤1 on identical device geometry                                                                                                                                                                                                                                                                                                                                             |
| image-loading-fallback       | 102 (0.11%)    | 1     | fill and path edge AA                 | the loading placeholder at the same sizes; Δ≤1 on identical device geometry                                                                                                                                                                                                                                                                                                                                                                  |
| block-border-dotted-1px      | 0 (0%)         | 0     | bit-identical                         | the engine's binary dot grid blits to the same pixels on both rasterizers                                                                                                                                                                                                                                                                                                                                                                    |

## Rules the pens still hold (text only, until the text laws lower)

- Text baseline: both pens draw each cluster at the alphabetic baseline
  the engine sent, already on a device row (CSS-pixel line top, one
  device-grid round of the sum); `rect.y + 0.8×sizePx` survives only as
  the fallback for a run that arrives without origins. The run itself
  stays in CSS pixels and both pens paint it under `scale(ratio)`,
  because the synthetic-bold outset follows the CSS font size, not the
  device size.
- Cluster placement: every run arrives with the origin (x, y) of every
  cluster — the engine's fixed-point advances with spacing and justify
  shares folded in along a line, one step per glyph down a column, an
  outside marker's box sized and a ruby annotation distributed by the
  engine, a column's rotated marks as their own runs under a quarter-turn
  transform — and both pens draw each cluster at its origin with their
  own spacing off: the browser pen one `fillText` per cluster, the
  Flutter pen one cached `ui.Paragraph` per (cluster, style). A fixture
  run written without origins is shaped by the engine on the way in
  (`lower/tests/parity.rs`, the pinned faces both harnesses load), so neither
  pen holds a spacing or placement law: a run that still arrives without
  origins draws as one string at its rect start.
- Text shadows: the Flutter pen draws each shadow layer as one bitmap
  holding the whole run (all its clusters) and blurs it once; the
  browser pen casts one canvas shadow per cluster into a scratch canvas
  the layers share. Layers paint back-to-front UNDER the glyph in full,
  at the glyph's own origin (Blink composites shadow underneath, body on
  top; σ = blur/2).
- Ruby and text shadows have no anchor of their own in either pen:
  every cluster origin, an annotation's included, is an alphabetic
  baseline the engine placed.
- Color: every typed space (incl. display-p3) converts to sRGB with
  per-channel clip, matching the browser pen's sRGB canvas.
- Theme override (R1–R3): page grounds with α==1 and relative luminance
  < 0.75 stay the book's and mark the page book-owned; ink re-resolves
  only on theme-supplied grounds (the run's own band, lowered to an
  opaque fill just before it → containing opaque block fill → book-owned
  page ground all return the original pair); the
  replacement keeps hue/saturation and moves lightness to the theme
  foreground's, with achromatic ink landing exactly on the foreground.
  The engine declares grounds on its fills (page, or an opaque block
  with its unsnapped box); both pens accumulate them during replay and
  search back-to-front with the same containment test; the Dart pen
  quantizes channels to 0-255 before HSL so relit channels match the
  browser bit for bit.

## Font metrics contract

The Flutter pen anchors nothing by font metrics. It reads
`RitoFontEnvelopeStore`, fed with the raw font bytes
(`register(family, bytes)`), for one thing: the weight a face was
declared with, so a family of one face declared bold is not emboldened
again. Inline box envelopes are the engine's: it snaps them from the
host's grid metric and the fixtures carry the extent explicitly
(`paint.box`).
