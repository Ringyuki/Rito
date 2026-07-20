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

## Round 2 additions

- Shared color canonicalization moved into `layout/summary_json.rs`
  (`canonical_color` + `canonicalize_color_keys` deep walker) and applied at
  the two summary boundaries that embed raw author color strings: pagination
  page details (`pagination_flow.rs`) and display-list flow command values
  (`display_list_flow.rs`). Both now also fold CSS **named** colors to hex —
  legacy stored `red`, Stylo materializes `#ff0000`. The TS exporter carries
  the identical table and walker (`NAMED_COLOR_HEX`, `canonicalizeColorKeys`)
  applied to `summarizePaginationFlowPage` and
  `normalizeDisplayListFlowCommand`. Note the JS table must stay at module
  top level — declaring it beside its helper hits a TDZ error at export time.

With this, `book-01/smoke.greedy` clears the pagination page digests and the
display-list spread digests.

## Round 3: the specified-value flag

The projection now reports cascade provenance for the one property whose
consumer contract needs it. `crates/rito-stylo/src/projection/inline_v1/specified.rs`
walks the element's rule node (`ComputedValues::rules`, all cascade levels
under the adapter's single shared lock) and reports whether `line-height` is
declared for this element; `FontStyleV1.line_height_is_declared` carries it,
overlaid per element in `project_element` exactly like `text_flow.language`
(the base style cache is keyed by `ComputedValues` pointer, and shared styles
share a rule node, so the overlay is the correct place).

`materialize_font` consumes it: a declared length yields
`ratio = px / own font-size`; an inherited one keeps the ancestor's ratio.
**All `lineHeight` ratios now match the oracle across every chapter** — the
remaining inline-layer diff is `lineHeightPx` only.

## Current wall (next session starts here)

`lineHeightPx` for _inherited_ line-height lengths. Two chapters demand
contradictory formulas, which is the proof that one more legacy rule is still
missing:

| case                               | own font | our px (ratio x own) | oracle px | oracle rule implied       |
| ---------------------------------- | -------- | -------------------- | --------- | ------------------------- |
| `title.xhtml` sample 4/5 seg 0     | 9.6      | 9.6                  | 16        | inherited length verbatim |
| `title.xhtml` sample 2 seg 1/3     | 14.4     | 17.28                | 14.4      | inherited length verbatim |
| `message.xhtml` continuous block 1 | —        | passes               | passes    | ratio x own font          |

Both formulas were implemented and measured end to end:

- **px = inherited computed length** (CSS length inheritance, Stylo's value):
  clears `title.xhtml`, but breaks `message.xhtml` continuous blocks —
  children shift uniformly 2px, container +4px.
- **px = ratio x own font size** (current): `message.xhtml` continuous blocks
  pass and the run reaches `book-02`, but `title.xhtml` keeps the px diff
  above.

To measure the two layers independently, temporarily guard the inline-segment
assertions in `crates/rito-core/tests/rust_fixture_package.rs` behind an env
var — the harness aborts at the first failing layer, so an inline failure
hides everything downstream. That trick is what proved the two cases are
genuinely contradictory rather than one masking the other.

The missing rule is most likely in the retired parser's
`clears_line_height_px` interaction (`style.rs`): a **unitless** declaration
clears `lineHeightPx` while an em/percent one keeps it, so the pixel value a
descendant inherits depends on _how_ the ancestor declared it. Extending the
projection flag to report the declared line-height _kind_ (unitless number vs
length/percentage) would let the materializer pick the right formula per
inheritance chain instead of guessing one globally.

After that, continuous blocks resume at `book-02 / smoke.greedy: line break
input summary mismatch`, then the remaining configs and books repeat the loop.

## Also unverified still

- E2E gates (release-protocol, memory-gate, usability) and the Downloads
  smoke have not rerun after today's Rust changes; WASM was rebuilt earlier
  but before the parity fixes — rebuild before browser testing.
- Flutter suite not rerun this session.
