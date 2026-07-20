# Stylo TS-Parity Grind — 2026-07-20 Session Record

Working notes for making `rust:fixture-parity:full` green on the Stylo
production path. The ignored 10-book × 4-config matrix has not been green
since Stylo became the default CSS authority; this session burned down most
of the gap for `book-01/smoke.greedy` and established the repeatable method.

## Method (repeat until green)

1. `cargo test -p rito-core --features legacy-css-diagnostics --test
rust_fixture_package loads_real_epub_package_and_resources_to_match_ts_fixture
-- --ignored --exact` → first panic names the chapter and layer.
2. Detail is hash-only past the first 8 blocks. Both sides have sampling
   knobs: TS exporter takes `RITO_RUST_FIXTURE_BLOCK_SAMPLE_LIMIT`,
   `RITO_RUST_FIXTURE_BOOKS`, `RITO_RUST_FIXTURE_CONFIGS`,
   `RITO_RUST_FIXTURE_OUTPUT_ROOT`; the Rust test takes
   `RITO_RUST_FIXTURE_ROOT`. Export a full-sample fixture to a scratch root,
   point the test at it, and the panic dump then contains full actual and
   expected JSON for every mismatching block. (The Rust side's inline-segment
   sampling is hardcoded `take(8)` in `layout/segments.rs`; patch it
   temporarily to the same env var and revert. The continuous-block summary
   has its own independent `take(8)` — sample-count mismatches between the
   two sides under a raised limit are harness noise, not regressions.)
3. Classify each divergence:
   - Legacy-map semantics the materializer must reproduce → fix in
     `style/stylo_materialize*` / `style/backend.rs`.
   - Paint-equivalent representation drift (color case, zero-width borders)
     → canonicalize in BOTH summaries (`layout/style_values.rs`
     `summarize_segment_style` and `packages/rito/scripts/export-rust-fixtures.mjs`
     `summarizeSegmentStyle`) and regenerate fixtures with
     `pnpm --filter @ritojs/core run fixtures:rust:export`.
4. After every fix rerun `cargo test -p rito-core` — several unit tests
   codify materializer behavior and must move with it.

## Landed this session (all suites green: 1210 lib, clippy -D warnings)

- `MIGRATION_DISPLAY_UA_STYLESHEET` (`style/backend.rs`): `* { display:
block; }` as UA origin. The legacy map defaulted display to `block` for
  every element; only author CSS overrides. Box classification for layout
  comes from the parser, not this value.
- `objectFit: "fill"` default on every element (`value.rs
materialize_layout`); images still override with `contain`.
- Line-height legacy dual-key semantics (`value.rs materialize_font`):
  lengths store both the ratio of the element's own font size
  (`lineHeight`) and the pixels (`lineHeightPx`); `normal` keeps the
  inherited ratio (1.2 at the root).
- Text nodes inherit only the legacy-inheritable subset via the previously
  unwired `style/inheritance.rs` (box properties reset to defaults).
- Percentage lengths keep the zero px default alongside the `*Pct` helper
  key (`materialize_length_percentage`, percentage heights).
- f32→f64 snap-through-shortest-decimal (`value.rs snap_f32_decimal`) for
  every materialized scalar. This removes the cumulative continuous-flow `y`
  drift (f32 ULP ≈ 0.002 at y≈16k, visible at the summary's 3-decimal
  rounding).
- Summary color canonicalization both sides: hex lowercase + 3-digit
  expansion; zero-width borders normalize to `{#000000, none, 0}` because
  `border: 0` computes style `none` per CSS but `solid` in the retired
  parsers. Fixtures regenerated.
- `epub/prepared` unit tests updated where they codified pre-parity
  materializer behavior (percentage height keeps `height: 0`).

## Current wall (next session starts here)

`pagination flow page digest mismatch at 1` (cover page, book-01): the page
detail embeds BlockPaint border colors as raw author strings. Legacy carries
`#000` (from `.coverborder { border-color: #000 }`); Stylo materializes
`#000000`. `border_edge_value` / `block_border_paint`
(`layout/style_values.rs`) copy the raw string into paint JSON.

This raw-color-string class also reaches the display-list flow summaries and
the 30-group runtime render-command goldens, so a decision is needed rather
than another spot fix. Options, in order of preference:

1. Canonicalize color strings at every paint-construction boundary the
   goldens consume (`border_edge_value`, backgrounds, shadows, run paint) and
   apply the identical canonicalization in the TS exporter's corresponding
   dump paths, then regenerate all fixture families (`fixtures:rust:export`
   plus the render-command golden generator). Keeps the oracle strong except
   for color-string spelling, which is paint-equivalent.
2. Typed colors at the boundary (the deletion ledger's eventual plan) — too
   large for this gate now.

After book-01/smoke passes, the remaining 3 configs and 9 books repeat the
same loop; expect more small legacy-semantics gaps (list markers, ruby,
tables) with decreasing frequency.

## Also unverified still

- E2E gates (release-protocol, memory-gate, usability) and the Downloads
  smoke have not rerun after today's Rust changes; WASM was rebuilt earlier
  but before the parity fixes — rebuild before browser testing.
- Flutter suite not rerun this session.
