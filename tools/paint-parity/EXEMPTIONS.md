# Paint-parity residual ledger — Impeller/Skia AA exemptions

Status as of 2026-07-28, corpus at `tools/paint-parity/fixtures/`,
verdict produced by `node tools/paint-parity/run.mjs` (report.md).

Every geometric and conditional rule of the browser pen is ported and
verified pixel-exact. The residuals below are rasterizer-level
differences between Chromium's canvas pipeline and Flutter's Skia
(flutter_tester) that the Flutter pen cannot reproduce without
replacing the rasterizer. Each entry states the evidence for why it is
attribution, not a rule gap.

| fixture                 | diff px       | max Δ | class                                 | evidence                                                                                                                                                                                                                                                    |
| ----------------------- | ------------- | ----- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| block-background-image  | 11712 (8.9%)  | 23    | bilinear rounding                     | raw-pixel compare: no-repeat tile region byte-identical; scaled regions differ by ±1–2 per channel on gradient transitions (e.g. browser 2,41,252 vs flutter 3,41,252)                                                                                      |
| image-source-rect       | 11516 (13.8%) | 14    | bilinear rounding                     | same sampler-precision class; diff confined to color-transition bands, zero structural offset (checker cell edges align row-exactly)                                                                                                                        |
| text-shadow-ruby        | 4652 (5.5%)   | 112   | shadow sub-pixel phase + glyph AA     | shadow geometry (em-box 'top' anchor + offset) matches; Chromium's scratch canvas rasters the shadow glyph at a fractional baseline phase while Skia snaps glyphs to whole rows — a ≤1px soft fringe. Ruby itself is row-identical including AA gray levels |
| block-box-shadow        | 4169 (4.1%)   | 23    | blur/AA edge                          | 1–3px ring at the box/clip boundary; sigma (blur/2), spread, offset, interior exclusion all verified; remaining delta is Skia mask-blur vs Chromium layer-blur edge treatment                                                                               |
| state-transform-clip    | 3454 (2.9%)   | 2     | edge AA rounding                      | Δ≤2 everywhere; rotated/scaled/clipped edges only                                                                                                                                                                                                           |
| text-inline-box         | 1800 (1.8%)   | 2     | fill edge AA                          | envelope geometry exact; Δ≤2 on fractional box edges                                                                                                                                                                                                        |
| text-colors-fonts       | 1561 (1.9%)   | 3     | glyph AA + alpha compositing rounding | Δ≤3; synthetic-italic and translucent-fill coverage rounding                                                                                                                                                                                                |
| block-borders-solid     | 803 (0.9%)    | 10    | stroke edge AA                        | snapped endpoints/half-pixel verified; dash segment ends differ by coverage rounding                                                                                                                                                                        |
| block-radius            | 589 (0.5%)    | 5     | arc AA                                | per-corner path and §5.5 scaling verified; Δ≤5 on arc boundaries                                                                                                                                                                                            |
| hr-styles               | 488 (0.7%)    | 8     | stroke/dash AA                        | centerline snap verified; dot/dash caps differ in coverage                                                                                                                                                                                                  |
| text-decoration         | 431 (0.6%)    | 2     | half-pixel line AA                    | unsnapped decoration lines blend across two rows with ±1 rounding                                                                                                                                                                                           |
| block-border-dotted-1px | 186 (0.2%)    | 6     | corner overlap AA                     | binary dot grid verified (offsets, double-dot parity, rounded origin); residual at corners where two edges' dots meet                                                                                                                                       |
| text-baseline-phases    | 123 (0.1%)    | 38    | glyph AA phase                        | baseline rows identical; Chromium spreads glyph AA one extra row at fractional phases (hinting), Skia does not                                                                                                                                              |
| text-family-fallback    | 319 (0.6%)    | 1     | glyph AA                              | family stack split verified: quoted/bare/multi-level stacks resolve to the same face both pens paint (a split regression rasters Ahem boxes and blows past 20%)                                                                                             |
| text-letter-spacing     | 11 (0.01%)    | 1     | glyph AA                              | half-spacing origin compensation verified by ink-segment scan                                                                                                                                                                                               |

## Rules ported (geometry, must stay exact)

- Two-stage text snap: alphabetic baseline at `round(rect.y + 0.8×sizePx)`,
  anchored via `computeDistanceToActualBaseline`.
- Letter spacing: SkParagraph half-leads each cluster edge vs Chromium
  trailing — glyph origin compensates by `−letterSpacing/2`.
  Word spacing needs no compensation (segment-scan verified).
- Ruby / text-shadow 'top' anchor: OS/2 `sTypoAscender` (em-box top),
  baseline still snapped to a whole row; shadow pass replicates the
  scratch-canvas knockout (layers back-to-front, dstOut glyph knockout,
  σ = blur/2).
- Inline envelope: grid-fit `usWinAscent/usWinDescent` (canvas
  fontBoundingBox) around the baseline, padding/border expansion,
  browser paint order (background, borders, shadows, glyphs, decoration).
- Block borders: endpoint rounding + odd-width half-pixel; 1px dotted
  binary grid ({0,1,3,5,…} even-span, {0,2,…} odd-span, row at
  `round(edge − 0.5)`); rounded uniform ring stroke; non-uniform
  triangle-clip with even-odd outer−inner fill; `double` strokes solid
  (browser pen has no double geometry).
- Box shadow: back-to-front, interior even-odd exclusion, σ = blur/2,
  blurred copy then spread shape.
- Background image: cover/contain scaling, centre default for sized
  images, px/percent position, every non-`no-repeat` mode tiles both
  axes, radius/corner clipping.
- Radius: px / pct / per-corner wire forms, CSS Backgrounds §5.5
  overlap scaling; corners shape background only (shadows/borders see 0).
- Image: 9-argument sourceRect sampling, canvas-default bilinear
  (FilterQuality.low).
- Horizontal rule: centerline `round + odd-height half-pixel`, endpoint
  rounding, 0.75× dotted pen.
- Color: every typed space (incl. display-p3) converts to sRGB with
  per-channel clip, matching the browser pen's sRGB canvas.

## Font metrics contract

The Flutter pen needs `RitoFontEnvelopeStore` fed with the raw font
bytes (`register(family, bytes)`); it derives the OS/2 typo/win pairs
Chromium anchors with. Without registration it falls back to
SkParagraph metrics, which are hhea-based and drift by 1–3px on 'top'
anchors and inline envelopes.
