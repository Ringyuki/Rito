# Layout conformance discipline

The engine's delivery bar is browser-equivalent rendering. That bar is
enforced by three instruments, none of which is allowed to be
self-referential:

1. **Geometry differential** (`pnpm conformance`) — seeded synthetic
   cases per capability cluster, laid out by the engine (continuous
   flow, `layout_conformance_probe`) and by Chromium (ground truth via
   `getBoundingClientRect` on identical files, zero harness injection).
   Boxes join by element id; agreement is per-cluster: % of boxes within
   0.5px, max delta, missing boxes, degradations. Reports land in the
   output dir (`report.md`).
2. **Full-book pixel oracle** (`tools/corpus-oracle/pixel-ab-full.mjs`)
   — every page of a real book vs Chromium multicol at identical
   geometry/fonts; ink-weighted diff, pagination drift as a first-class
   metric, worst-page gallery that must be eyeballed before numbers are
   quoted.
3. **Degradation inventory** — the engine's own fail-open notes, dumped
   by both probes. A conformance case that degrades is a failure, not a
   comparison.

## Binding rules

- **No layout/paint change lands without differential numbers.** A PR
  touching layout algorithms cites the spec clause it implements and the
  before/after cluster numbers from `pnpm conformance`.
- **"Implemented" requires evidence.** A capability the whitelist
  attests must have: a case generator cluster here, its agreement
  threshold registered in `CERTIFIED` (tools/conformance/compare.mjs),
  and clean corpus pages in the pixel oracle. Anything less stays
  fail-closed or visibly degraded — self-attestation is what let broken
  float/table/margin code pass silently (2026-07: 0% table agreement,
  max delta 418px, zero degradation notes).
- **Certified clusters are ratchets.** `compare.mjs` exits non-zero when
  a certified cluster drops below its registered threshold. Certify a
  cluster in the same commit that brings it to threshold; never
  uncertify to make a build pass.
- **Truth refresh is explicit.** Case generation is seeded and
  deterministic; Chromium truth is re-recorded only deliberately (a
  Chromium upgrade is a truth change and gets its own commit).

## Table column sizing: use the published algorithm

Column widths follow CSS Tables 3 §3.9 (what Blink implements): an
assignable width from the grid's constraints — including that a
percentage column's share leaves the rest to fit in `M / (1 - T%)`,
bounded by the space available — then distribution through four guesses
(every column at its minimum, percentage columns at their share,
authored widths, content maxima), settling between the two guesses that
bracket the assignable width.

Three reverse-engineered variants were tried and reverted before reading
the algorithm; each fixed one case family and broke the other. When an
engine behaviour has a published algorithm, read it first — sampling the
reference browser only shows what a rule produces, never the rule.

The algorithm is implemented but not landed: driven by the engine's
current column min/max it scores worse than the ad-hoc distribution it
would replace (tables 85.5% → 73.8%, table-percent 25.9% → 81.2%), which
says the inputs are wrong, not the algorithm. Next step is to verify each
column's min-content and max-content against the browser's own before
switching the distribution over.

## Current baseline (2026-07-24, first run, seed 20260724)

| cluster         | within 0.5px | max delta | notes                            |
| --------------- | ------------ | --------- | -------------------------------- |
| vertical-rhythm | **100.0%** ✓ | 0.2px     | certified; host-injected metrics |
| tables          | 0.0%         | 418.1px   | td/tr laid at full flow width    |
| floats          | 63.8%        | 80.0px    | no line-box exclusion            |
| margin-box      | 78.6%        | 16.0px    | auto centering / offsets         |

### Pixel results (Konosuba vol. 1, 252 pages, full-book oracle)

| run                             | clean (<4%) | byte-identical | body-page median |
| ------------------------------- | ----------- | -------------- | ---------------- |
| before host metrics             | 0           | 0              | 75.8%            |
| host line metrics + CSS leading | 91          | 90             | 44.1%            |

Two measurement rules were learned the hard way and are now binding:
**capture must be bit-exact** (the oracle reads the engine canvas bitmap;
screenshotting the page region rounded a fractional canvas offset into a
whole-pixel glyph shift that looked like a total mismatch), and **silent
failure invalidates a run** (a run that quietly reverted to the old
layout produced plausible numbers; the oracle now surfaces page console
warnings).

vertical-rhythm was fixed by host-injected `line-height: normal` metrics
(`rito_inline::HostNormalLineMetric`): the rendering host measures its
own two-level normal line heights — plain strut, and the lifted height
any line containing a CJK glyph gets — because those integers come from
the host font scaler (grid-fitted per size) and are not derivable from
font tables. The engine records (family, size) misses for the host to
measure and inject (`take_host_line_metric_requests`), and the browser
binding converges in two passes (measure → inject → forced reflow →
re-complete). Baselines follow the same host-fitted metrics: CSS leading
with the host's floored half-leading, `floor((lineHeight - (asc + desc))
/ 2) + asc`, which applies to declared line-heights just as much as to
`normal`. Work queue: tables, floats, margin-box.

## Real-book and real-corpus conformance

`tools/conformance/real-book.mjs <book.epub>` turns any EPUB into a
conformance corpus: every element is stamped with an id, Chromium records
its border box at the engine's flow width, the engine lays the same
(stamped) book out continuously, and the two are joined element by element.
Deltas are **local** — horizontal offset from the containing box, vertical
advance from the previous sibling's bottom — so one early mistake is
reported where it happens instead of repainting every box below it.

`tools/conformance/real-corpus.mjs <dir>` runs that over a directory of
books and ranks them worst-first with each book's dominant defect classes.
A class that costs 0.3% in one book and 8% in nine others is the one to
take next; a single book cannot tell you that.

Both sides must run the same fonts. The truth page pins the engine's serif
for rendering _and_ for metric measurement, and asserts the face reached
`loaded` — a 404'd pin silently measures the browser's default font, which
is exactly how a visibly broken page once scored 100%.

### Line-end fullwidth closer trimming (probed, implemented)

Chromium trims an adjacent CJK punctuation pair (`。」` costs 8 + 16, not 32)
— the engine does this — and additionally trims the **trailing** closing
punctuation's blank right half at a line end, so a line whose first
overflowing character is a fullwidth closer keeps it when the trimmed half
fits. An earlier paragraph measurement was read as a half-width `。` hanging
past the content edge; a per-character probe against the pinned Chromium
(`tools/conformance/line-end-trim-probe.mjs`, 147.0.7727.15) refuted that:

- Eligible: fullwidth closing brackets (Unicode `Pe`, Blink `kClose`) and
  closing quotes `’ ”` (`kCloseQuote`). Trimmed advance is 8 at 16px.
- Excluded: `。 、 ， ． ： ；` (`kDot`/`kColon`/`kSemicolon`) and
  `！ ？ ・` — these never trim at a line end.
- The trimmed line must still **fit** — nothing hangs past the content
  edge; if even the half width overflows, the line breaks.
- A break opportunity must exist after the candidate (`」」` refuses).
- Pair trim and line-end trim compose (`。」` at a line end: 8 + 8).

This matches Blink main's `ShapingLineBreaker::ShapeLine` exactly. Before
the fix the engine always broke instead, costing one extra line on long
paragraphs — the dominant defect class in the corpus (97 of 98 `p height`
offenders in one book were exactly one line too tall).

### SVG geometry presentation attributes (implemented)

The SVG-wrapped image idiom — `<figure><svg width="100%" viewBox="0 0 W H">
<image .../></svg></figure>` — is how most Japanese EPUBs ship full-page
illustrations. The parser already folds such an `<svg>` into an image node,
but the fragment engine styles that node through Stylo, keyed by the source
`<svg>` element, so a `style` string synthesized in the parser never reaches
it. `width`/`height` on `<svg>` are presentation attributes (SVG 2 §7.2),
and Stylo is told about them the way it is told about `body@bgcolor`: a
presentational hint (`crates/rito-stylo/src/dom/mod.rs`, consumed through
`synthesize_presentational_hints_for_legacy_attributes` in `dom/traits.rs`),
which cascades below author styles. Bare numbers are user units (px);
values a browser would accept but the hint cannot express are recorded as
degradations, not silently dropped.

Before the fix, over the 126-book corpus: 464 `svg height` + 101
`svg width` offending boxes, the whole of `chapter0.xhtml` in thirteen
volumes of one series (0 of 15 boxes within tolerance), and every SVG
cover. After: that chapter0 measures 14/15, and the `svg` defect classes
are gone from the per-book reports.

### Truth must resolve generic families to the pinned face

The geometry recording pass rewrites every element's `font-family` so
generic keywords (and the end-of-list fallback) resolve to the pinned
serif — exactly how the engine serves them. A book that declares
`font-family: cnepub, serif` whose custom face cannot load (a `res:///`
device font) would otherwise render the truth through the browser's
default serif: Times's proportional `“ ”` against the pin's fullwidth
ones is a one-glyph width difference per line that breaks a line earlier
and reads as a paragraph-height defect — 77 of one book's 98 one-line-off
paragraphs disappeared when the truth was re-recorded through the pin.
