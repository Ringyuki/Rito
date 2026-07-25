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
