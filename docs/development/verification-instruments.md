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

`prune-walks.sh` drops the capture trees (`engine/`, `truth/`, `gallery/`,
`book/`) of every `walk-*/` directory in `tools/corpus-oracle` except the
ones named as arguments, keeping each `report.md`.

The other scripts in `tools/corpus-oracle` are focused probes, all run
from that directory. They fall into three groups.

Line-break oracle against the native probe binary (build it first with
`cargo build --release --example chapter-fragment-probe -p rito-core`):

- `node unpack-corpus.mjs <epub-dir> <workspace-dir>` — unpacks every
  EPUB and writes the manifest the oracle scripts consume (spine-ordered
  chapter files and `@font-face` bindings).
- `RITO_ORACLE_DIR=<workspace-dir> node corpus-ab.mjs` — lays every
  manifest chapter out through `chapter-fragment-probe` and through
  pinned-font Chromium and scores the two by line-break points, writing
  `corpus-ab-report.json` into the workspace.

Reads of the live reader (`RITO_READER_URL`, default
`http://localhost:5173/`), through `__ritoReaderDiagnostics`:

- `node geometry-check.mjs <book.epub>` — viewport, shell, canvas buffer
  and revision keys the reader is actually using.
- `node wasm-probe-dump.mjs <book.epub> <idref> <out.json> [--no-warm]` —
  the WASM pipeline's page-by-page chapter lines
  (`chapterFragmentProbe`), after a full warm traversal like the walk.
- `node text-cmd-dump.mjs <book.epub> <spread> <needle...>` — the
  `text`/`ruby` primitives of one spread whose JSON matches a needle
  (run text, rect, paint, cluster origins).
- `node image-cmd-dump.mjs <book.epub> [spreadCount=8]` — the
  `draw-image` primitives (`src`, `dest`) of the first spreads.

Chromium measurements of one chapter file under the pixel walk's pin
rewrite (multicol 640×850, Tinos + Source Han Serif pinned), or of a
synthetic replica, via `Range` rects:

- `node char-advance-probe.mjs <chapter.xhtml> [pIndex] [maxChars]` —
  per-character left edges and advances of the Nth `<p>`.
- `node toc-break-probe.mjs <chapter.xhtml> [selector]` — each block's
  border box and line boxes with the column they landed in.
- `node melancholy-probe.mjs <chapter.xhtml> <marker>` — per-character
  rects of the text node containing the marker, grouped by line.
- `node natural-advance-diff.mjs <chapter.xhtml> [marker]` — unjustified
  per-character advances of that text node in the real file versus a
  synthetic replica of the same text; prints the first divergences.
- `node melancholy-full-replica.mjs` — a fixed synthetic replica of one
  known paragraph (ancestor styles reproduced); prints its lines and the
  advances of the closing punctuation.
- `node punct-pair-matrix.mjs` — the advance of every ordered pair of
  fullwidth punctuation classes in `中A B中`, full versus compressed.
- `node punct-squeeze-probe.mjs` — whether a fullwidth stop before a
  closing bracket compresses only when the line would otherwise overflow,
  swept over widths and alignments.

## Native example probes

Built with `cargo build --release -p rito-core --examples`; the binaries
land in `target/release/examples/`. Each opens the book with a pinned
serif face because the fragment engine shapes with pinned faces only —
a document without one cannot paginate. The reader pins
`apps/reader/src/assets/fonts/Tinos-Regular.ttf` as its serif face.

- `anchor-roundtrip-probe <epub> <serif-font-path> [width] [height]` —
  paginates the book once (default 420×640 single page, 24px margins),
  captures every page's reading anchor, resolves the locator back and
  counts pages whose locator resolves elsewhere, anchors that were
  unavailable, and resolutions left pending.
- `layout-engine-bench <epub> <serif-font-path>` — one whole-book
  pagination at 420×640; prints wall-clock milliseconds and page count.
- `open-timeline.mjs <epub> [url]` (in `tools/corpus-oracle/`) — times one
  book's open in the running reader, printing every worker message the page
  sends and receives on one clock.
- `memory-stage-probe <epub> <serif-font-path>` — resident bytes after
  each stage of opening and paginating one book, then after releasing
  the revision, paginating a second time, and dropping the document.
  The second pagination is the reading that matters: if it costs only a
  few megabytes, the first pass's memory was released and reused, so a
  high number after the first pass is the allocator holding pages rather
  than the engine retaining them. That distinction decides nothing on a
  native host, where the allocator reuses what it holds, and everything
  in the browser, where a WebAssembly heap only grows and the
  high-water mark becomes the floor.
- `chapter-fragment-probe < request.json` — the native side of the
  line-baseline instruments below; the request fields are documented in
  `crates/rito-core/examples/chapter_fragment_probe.rs`.

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
chapter-fragment-probe -p rito-core`; the test skips when the binary is
absent) and compares every line's text and ink geometry against pinned
Chromium rendering the same chapters with the same font bytes. It is
report-first: it asserts harness integrity and writes the diff report. `browser-parley-spike.e2e.test.ts` does the same
for plain paragraphs through the `rito-inline-spike` binary and skips
when the binary is not built.

## Reader diagnostics hook

The browser reader installs `globalThis.__ritoReaderDiagnostics` on the
page: the font availability epochs, the committed revision, `frame(spreadIndex)`,
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
