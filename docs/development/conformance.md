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

| cluster         | within 0.5px | max delta | notes                         |
| --------------- | ------------ | --------- | ----------------------------- |
| vertical-rhythm | 20.9%        | 43.8px    | paragraph spacing/line height |
| tables          | 0.0%         | 418.1px   | td/tr laid at full flow width |
| floats          | 63.8%        | 80.0px    | no line-box exclusion         |
| margin-box      | 0.0%         | 22.9px    | auto centering / offsets      |

No cluster is certified yet. The numbers above are the work queue, in
fix order: vertical-rhythm (drives whole-book pagination drift), tables,
floats, margin-box.
