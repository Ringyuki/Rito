# Paint-parity residual ledger — Skia rasterizer exemptions

Status as of 2026-09-08, corpus at `tools/paint-parity/fixtures/`,
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
entry states the evidence for why it is attribution. Text runs are the
one primitive the pens still lay out themselves (glyph placement), so
the text fixtures also carry glyph-AA residuals until the text laws
lower.

| fixture                      | diff px       | max Δ | class                                 | evidence                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------- | ----- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| block-background-image       | 11712 (8.87%) | 23    | bilinear rounding                     | raw-pixel compare: no-repeat tile region byte-identical; scaled regions differ by ±1–2 per channel on gradient transitions (e.g. browser 2,41,252 vs flutter 3,41,252)                                                                                                                                                                     |
| image-source-rect            | 11516 (13.7%) | 14    | bilinear rounding                     | same sampler-precision class; diff confined to color-transition bands, zero structural offset (checker cell edges align row-exactly)                                                                                                                                                                                                       |
| block-badge-overlap-shadow   | 7151 (5.67%)  | 24    | blur kernel + arc AA                  | identical stadium outline, ring paths and shadow shape on both sides; residual is Skia mask-blur vs Chromium layer-blur and corner-arc coverage                                                                                                                                                                                            |
| text-synthetic-bold          | 6197 (10.5%)  | 112   | synthetic-bold stroke shape           | policy v1 pins Regular only, so weight 700 synthesizes on BOTH pens (the production web reader pins the same single-weight set); ink-segment scan shows advances identical (line endpoints within 1px, weight 650 buckets identically) — Chromium's embolden just paints fatter strokes than Skia's. Geometry and measurement stay aligned |
| theme-white-page-inline-band | 6053 (7.2%)   | 81    | glyph AA (relit ink)                  | white page → theme ground, inline band pair kept, black → exact foreground, #cc0000 → rgb(255,203,203) on both pens (base pixels agree; diff is the AA fringe of relit glyphs on the dark ground); band/page flats zero-diff                                                                                                               |
| theme-designed-page          | 5359 (5.8%)   | 94    | glyph AA (CJK + bold)                 | R1 designed teal ground + white card verified: every large flat region (page, card) is zero-diff, so both pens made identical R1/R2 keep decisions; diff rows cluster only inside text rects and sampled pixels share the base ink both sides (170,34,34 red vs its AA blend) — CJK strokes and 18px bold widen the AA fringe              |
| block-box-shadow             | 4169 (4.13%)  | 23    | blur/AA edge                          | 1–3px ring at the box/clip boundary; the spread box, offset and interior exclusion are the same device path on both sides; remaining delta is Skia mask-blur vs Chromium layer-blur edge treatment                                                                                                                                         |
| state-transform-clip         | 3454 (2.87%)  | 2     | edge AA rounding                      | Δ≤2 everywhere; rotated/scaled/clipped edges only                                                                                                                                                                                                                                                                                          |
| theme-override-dark          | 3348 (3.98%)  | 2     | glyph AA on themed ground             | dark-theme override verified end to end under R1–R3: white page ground taken over, achromatic ink lands exactly on the theme foreground, chromatic link-blue relights along lightness — both pens byte-agree on every policy decision (Δ≤2 is glyph AA)                                                                                    |
| text-shadow-ruby             | 2024 (2.41%)  | 213   | shadow sub-pixel phase + glyph AA     | shadow geometry (em-box 'top' anchor + offset) matches; Chromium's scratch canvas rasters the shadow glyph at a fractional baseline phase while Skia snaps glyphs to whole rows — a ≤1px soft fringe. Ruby itself is row-identical including AA gray levels                                                                                |
| text-colors-fonts            | 1561 (1.85%)  | 3     | glyph AA + alpha compositing rounding | Δ≤3; synthetic-italic and translucent-fill coverage rounding                                                                                                                                                                                                                                                                               |
| text-inline-box              | 1538 (1.52%)  | 2     | fill edge AA                          | envelope geometry exact; Δ≤2 on fractional box edges                                                                                                                                                                                                                                                                                       |
| block-radius                 | 583 (0.46%)   | 5     | arc AA                                | per-corner and overlap-scaled outlines are identical device paths on both sides (614 px / Δ128 while the Flutter pen still resolved its own radii); only arc coverage is left                                                                                                                                                              |
| text-decoration              | 171 (0.25%)   | 2     | fill edge AA                          | the engine lowers each line to a rect on whole rows (top rounded, thickness floored to ≥1, the browser's own snap); both pens fill the same rect, and Δ≤2 is the antialiasing of its fractional x extents (431 px / two-row blends while the pens stroked the unsnapped centreline)                                                        |
| hr-styles                    | 361 (0.50%)   | 1     | stroke/dash AA                        | one set of device rects on both sides (565 px / Δ11 while the Flutter pen strokes its own rule model); dot/dash caps differ in coverage                                                                                                                                                                                                    |
| text-family-fallback         | 319 (0.58%)   | 1     | glyph AA                              | family stack split verified: quoted/bare/multi-level stacks resolve to the same face both pens paint (a split regression rasters Ahem boxes and blows past 20%)                                                                                                                                                                            |
| text-baseline-phases         | 123 (0.13%)   | 38    | glyph AA phase                        | baseline rows identical; Chromium spreads glyph AA one extra row at fractional phases (hinting), Skia does not                                                                                                                                                                                                                             |
| block-borders-solid          | 48 (0.05%)    | 1     | stroke edge AA                        | one set of device rects on both sides (199 px / Δ5 while the Flutter pen snapped its own bands); dash segment ends differ by coverage rounding                                                                                                                                                                                             |
| text-letter-spacing          | 11 (0.01%)    | 1     | glyph AA                              | half-spacing origin compensation verified by ink-segment scan                                                                                                                                                                                                                                                                              |
| block-border-dotted-1px      | 0 (0%)        | 0     | bit-identical                         | the engine's binary dot grid blits to the same pixels on both rasterizers                                                                                                                                                                                                                                                                  |

## Rules the pens still hold (text only, until the text laws lower)

- Text baseline: alphabetic baseline at `round(rect.y + 0.8×sizePx)`,
  anchored via `computeDistanceToActualBaseline`. The engine already put
  the baseline on a device row (CSS-pixel line top, one device-grid
  round of the sum); the run itself stays in CSS pixels and both pens
  paint it under `scale(ratio)`, because the synthetic-bold outset
  follows the CSS font size, not the device size.
- Cluster placement: a horizontal run arrives with the origin of every
  cluster (the engine's fixed-point advances with spacing and justify
  shares folded in), and both pens draw each cluster at its origin with
  their own spacing off — the browser pen one `fillText` per cluster, the
  Flutter pen one cached `ui.Paragraph` per (cluster, style). The pens
  still place the runs that carry no origins (vertical columns); an
  outside list marker and a ruby annotation carry origins like any other
  horizontal run, the marker box sized and the annotation distributed by
  the engine. There SkParagraph half-leads each
  cluster edge vs Chromium trailing, so the glyph origin compensates by
  `−letterSpacing/2` (word spacing needs no compensation).
- Text shadows: every layer is one bitmap holding the whole run (all its
  clusters), blurred once, the way the browser blurs a run's mask —
  blurring clusters one by one composites neighbouring glows over each
  other and reads darker where they overlap.
- Ruby / text-shadow 'top' anchor: OS/2 `sTypoAscender` (em-box top),
  baseline still snapped to a whole row; shadow layers paint
  back-to-front UNDER the glyph in full, anchored at the glyph's own
  origin (Blink composites shadow underneath, body on top; σ = blur/2).
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

The Flutter pen needs `RitoFontEnvelopeStore` fed with the raw font
bytes (`register(family, bytes)`); it derives the OS/2 typo pair
Chromium anchors ruby and text shadows with. Without registration it
falls back to SkParagraph metrics, which are hhea-based and drift by
1–3px on 'top' anchors. Inline box envelopes no longer need it: the
engine snaps them from the host's grid metric and the fixtures carry
the extent explicitly (`paint.box`).
