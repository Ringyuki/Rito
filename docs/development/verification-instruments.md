# Verification Instruments

The acceptance criterion for layout and paint is pixel identity with
pinned Chromium, page by page, on real books. The instruments below
measure that and its supporting invariants; none is a substitute for the
pixel walk when a layout or paint rule changes.

## Pixel walk (the acceptance instrument)

```bash
cd tools/corpus-oracle
RITO_READER_URL=http://127.0.0.1:4174/ RITO_WALK_DSF=1 \
  node pixel-walk.mjs /path/to/book.epub /path/to/out [maxPages]
```

Walks every page of a book through the real reader (the `@ritojs/reader`
build served at `RITO_READER_URL`) and through Chromium laying the same
chapter into multicol columns of the engine's content box, with the
book's own CSS and fonts. Pages pair chapter-page k with truth-column k;
page-count drift is reported first and never realigned away. The metric
is the count of differing pixels per page; the target is zero.
`RITO_WALK_DSF` sets the device pixels per CSS pixel on both sides.

Rules that experience has made binding:

- Run walks one at a time. Concurrent walks poison each other's captures.
- The verdict is `report.md` on disk, not a notification.
- Serve a fresh reader build (`pnpm --filter @ritojs/reader build` then
  `vite preview`); the browser runs the prebuilt WASM, so a Rust change is
  invisible until `pnpm --filter @ritojs/core-wasm build` ran.
- Prune capture trees after harvesting; they are hundreds of megabytes.
- Refactors are verified by comparing the engine captures byte for byte
  against a baseline walk of the same book.

`pixel-ab-full.mjs` is the whole-book variant with an ink-weighted diff
and a worst-page gallery; `unpack-corpus.mjs` prepares a corpus for the
oracle scripts. The other scripts in `tools/corpus-oracle` are focused
probes kept because they settled specific laws (punctuation matrices,
advance diffs, image and text command dumps).

## Paint parity (the two pens)

```bash
node tools/paint-parity/run.mjs [outRoot]
```

Lowers the fixture corpus in the engine (`cargo test -p rito-core --lib
lower_paint_parity_fixtures`, env-gated), blits the same `RITODL1` bytes
through the browser pen (oracle) and the Flutter pen, and diffs the
bitmaps. `budgets.json` pins each fixture's allowed diff-pixel count and
channel delta; `diff.mjs` exits non-zero when a fixture exceeds its
budget or has none. The residuals are rasterizer differences on identical
device geometry, itemized in `EXEMPTIONS.md`. Run it whenever a pen or the
lowering changes. The fixtures are the browser pen's JSON shape; the
engine writes them from its own painter output (the ignored
`write_vertical_paint_parity_fixture` test regenerates the vertical one).

## Line baseline against Chromium

`apps/reader/tests/e2e/browser-fragment-baseline.e2e.test.ts` lays whole
chapters out through the production pipeline with the
`chapter-fragment-probe` example (`cargo build --release --example
chapter-fragment-probe -p rito-core`) and compares every line's text and
ink geometry against pinned Chromium rendering the same chapters with the
same font bytes. It is report-first: it asserts harness integrity and
writes the diff report. `browser-parley-spike.e2e.test.ts` does the same
for plain paragraphs through the `rito-inline-spike` binary and skips
when the binary is not built.

## Reader diagnostics hook

The browser reader installs `globalThis.__ritoReaderDiagnostics` on the
page: host line metrics, the committed revision, `frame(spreadIndex)`,
`spreadImagesSettled(spreadIndex)` (await it before screenshotting a
spread — the paint path keeps the previous canvas while a bitmap
decodes), `imageState(href)`, `warmFrameWindowDump(spreadIndex)` and
`chapterFragmentProbe(idref)`. Harnesses use this hook instead of adding
probes to production messages.

## Render diagnostic case

```bash
RITO_DIAG_CASE=<case-id> pnpm diagnose:render
```

Renders one spread of a book placed under
`packages/rito/test-results/render-diagnostics/cases/<case-id>/` through
the production reader, captures a Chromium reference of the chapter named
in `case.json`, and writes screenshots, computed styles, DOM rects and a
pixel diff into the case's `artifacts/` directory.

## Pixel suite

`pnpm test:golden:pixel` runs the built production reader in Chromium and
proves that the engine's exact text ranges land on the glyphs the Canvas
painted across the author's and a pinned fallback face
(`packages/rito/tests/golden-pixel/`).

## Architecture guards

- `crates/rito-core/tests/render_architecture_invariants.rs` — the render
  module depends on no style, DOM or CSS engine and recovers no paint
  field through JSON.
- `crates/rito-core/tests/workspace_smoke.rs` — the engine module
  inventory.
- `crates/rito-core/tests/ua_image_policy_mirror.rs` — the UA stylesheet's
  image policy and the pixel walk's truth injection stay the same rule.
- `packages/rito/tests/unit/architecture-invariants.test.ts` — one public
  entry, one engine, retired shapes stay retired.
- `packages/rito/tests/unit/browser-reader-architecture-invariants.test.ts`
  — the browser shell is a thin blitter with no layout or paint law.
- `packages/rito_flutter/test/architecture_test.dart` and
  `protocol_version_parity_test.dart` — the Dart adapter mirrors the
  protocol.
