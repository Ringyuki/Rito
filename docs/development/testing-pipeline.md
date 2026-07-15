# Testing Pipeline

Rito is an EPUB rendering library, so regressions must be caught at the
earliest useful layer and again at the final rendered output. The test pipeline
is split by speed and risk: fast module tests run by default, structured golden
tests protect the full layout chain, render command goldens protect display-list
construction plus the default Canvas backend record stream, and pixel goldens
protect browser-rendered output.

## Layers

| Layer                 | Command                                                                                              | Purpose                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Unit                  | `pnpm test:unit`                                                                                     | Module-level parser, style, layout, render helper, kit, and React tests.                                       |
| Integration           | `pnpm test:integration`                                                                              | Small end-to-end core flows and focused rare-feature render chains.                                            |
| Structured golden     | `pnpm test:golden:books`                                                                             | Full-book parser -> style -> layout -> pagination snapshots for real EPUB fixtures.                            |
| Render golden         | `pnpm test:golden:render`                                                                            | Auto-selected real-book feature pages summarized as display-list plus Canvas backend record goldens.           |
| Pixel golden          | `pnpm test:golden:pixel`                                                                             | Browser Canvas PNG output compared against checked-in image goldens.                                           |
| DOM-free reference    | `pnpm --filter @ritojs/core test:dom-free:reference`                                                 | Built TypeScript reference parses and paginates an EPUB in a real Node worker without bundled DOM parser code. |
| Reader e2e            | `pnpm test:e2e`                                                                                      | Demo reader behavior: load, navigation, TOC, search, settings, and reflow.                                     |
| Reader load profile   | `RITO_READER_PROFILE_EPUB=/abs/book.epub pnpm test:e2e:load-profile`                                 | Opt-in production bounded-Worker phase timings, revision extents, Long Tasks, and browser errors.              |
| Reader usability gate | `RITO_READER_USABILITY_GATE=/abs/gate.json RITO_READER_MACHINE_ID=<id> pnpm test:e2e:usability-gate` | Strict named-machine, pinned-corpus latency thresholds for production Reader load and turn paths.              |
| Coverage              | `pnpm test:coverage`                                                                                 | V8 coverage for all published packages, checked against package baselines.                                     |
| Dependency audit      | `pnpm audit:dependencies`                                                                            | Fails on high-severity advisories in the resolved workspace dependency graph.                                  |

## Current Gates

### Local Development

Use the default test command while iterating:

```bash
pnpm test
```

This runs regular Vitest suites and skips opt-in full-book and render golden
tests.

### Pull Requests

The CI workflow uses:

```bash
pnpm run test:ci
```

This includes:

- typecheck
- lint
- format check
- unit tests
- integration tests
- structured full-book golden tests
- render command golden tests
- build
- DOM-free TypeScript reference verification in a real Node worker

CI also audits the exact frozen dependency graph and rejects high-severity
advisories with `pnpm run audit:dependencies`.

The GitHub CI workflow also installs Chromium and runs:

```bash
pnpm test:e2e
```

Pixel goldens run in a separate macOS CI job:

```bash
pnpm test:golden:pixel
```

V8 coverage runs in a parallel CI job and publishes its HTML reports as build
artifacts:

```bash
pnpm test:coverage
```

The structured golden step is intentionally part of the PR gate. It covers
real EPUBs across multiple layout configs and catches regressions in page
counts, chapter ranges, line boxes, text runs, paint data, and sampled page
details.

The unit gate also includes golden inventory and coverage invariants. Inventory
validates that book fixtures are flat and registered in the manifest, and that
layout, render-command, and pixel goldens exactly match their configured
fixture/case sets. Coverage validates that render-command goldens still cover
the required selected page features, display-list command families, and Canvas
backend record families, and that pixel goldens still cover the required
final-output feature tags. This prevents stale
or missing golden files from silently weakening the slower regression gates.

The integration gate includes focused EPUB fixtures for rare but high-risk
features that may not appear in the current real-book corpus. For example,
block opacity is checked through EPUB loading, CSS resolution, layout paint, and
Canvas `globalAlpha` rendering even when no checked-in full book happens to use
that style.

### Release Checks

Release workflows should run the PR gate plus packaging checks:

```bash
pnpm run test:ci
pnpm test:golden:pixel
pnpm test:e2e
pnpm release:pack-check
```

## Structured Golden Books

Fixtures live in:

```text
packages/rito/tests/fixtures/books/
```

Golden outputs live in:

```text
packages/rito/tests/golden/layout/
```

Commands:

```bash
pnpm test:golden:books:smoke
pnpm test:golden:books
pnpm test:golden:books:update
```

Useful filters:

```bash
RITO_BOOK_LIMIT=1 pnpm test:golden:books
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:books
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:books:update
```

Use structured golden tests for layout-chain regressions. Mutation checks have
already shown they catch changes in text measurement and inline border
start/end handling.

## Render Command Golden

Render command goldens live in:

```text
packages/rito/tests/golden/render-commands/
```

Commands:

```bash
pnpm test:golden:render
pnpm test:golden:render:update
```

Useful filters:

```bash
RITO_BOOK_LIMIT=1 pnpm test:golden:render
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render
RITO_GOLDEN_CONFIGS=default.greedy pnpm test:golden:render:update
```

For every render-tier book and golden layout config, the suite paginates the
real EPUB, selects the first and last pages, then selects the strongest page for
each render feature found in that result: text, image, inline atom, ruby,
horizontal rule, inline background, inline border, text shadow, decoration,
block background, block border, transform, opacity, and clipping. Each selected
page is summarized at DPR 1 and DPR 2.

Each variant records both the platform-neutral `DisplayList` summary and the
normalized Canvas backend records produced by the default Canvas renderer. Text
arguments are hashed, image arguments are normalized to fixture hrefs, and
numeric coordinates are rounded. This catches regressions in display-list
construction, backend draw order, fill/stroke setup, inline borders, ruby
placement, horizontal rules, images, high-DPI scaling, and clipping without
depending on browser pixels.

Use this layer when changing `render/**`, paint-ready layout types, or page
composition rules.

## Pixel Golden

Pixel goldens live in:

```text
packages/rito/tests/golden/pixels/
```

Commands:

```bash
pnpm test:golden:pixel
pnpm test:golden:pixel:review
pnpm test:golden:pixel:update
```

Useful filters:

```bash
RITO_PIXEL_BOOKS=book-03 pnpm test:golden:pixel
RITO_PIXEL_PROFILES=single-narrow pnpm test:golden:pixel:review
RITO_PIXEL_LINE_BREAKING=optimal pnpm test:golden:pixel
RITO_PIXEL_SPREADS=0,1 pnpm test:golden:pixel:review
RITO_PIXEL_WORKERS=4 pnpm test:golden:pixel
RITO_PIXEL_SCOPE=full pnpm test:golden:pixel:update
RITO_PIXEL_BASELINE_ROOT=/path/to/baselines RITO_PIXEL_SCOPE=full pnpm test:golden:pixel
```

The committed suite renders curated spreads of every render-tier book in
Chromium through the source reference reader, reads the final
canvas as PNG, and compares it with `pixelmatch`. Each render-tier book is
covered by this matrix:

- `single-default`: `greedy`, `optimal`.
- `single-narrow`: `greedy`, `optimal`.
- `single-wide`: `greedy`.
- `single-default-dpr2`: `greedy`.
- `double-default`: `greedy`.

This keeps checked-in PNGs focused on covers, production notes, introductions,
color pages, tables of contents, body text, post-body content, narrow
line-breaking stress, wide layouts, DPR 2 rendering, and double-page spread
composition. Each run stores a `summary.json`; changes to spread count,
viewport, DPR, spread mode, or line-breaking mode are treated as golden
regressions.

Every committed run samples the first three spreads, the last declared
frontmatter spread, and the beginning, middle, and end of the body. The full
every-profile/every-spread matrix remains available through
`RITO_PIXEL_SCOPE=full` with an external baseline root, so exhaustive release
investigations do not inflate the default Git checkout.

Compare and update mode use 2 Playwright workers by default. Use
`RITO_PIXEL_WORKERS` for larger local or CI machines. Review mode stays on one
worker because the report writer aggregates a single HTML output.

The exhaustive suite is opt-in:

```bash
RITO_PIXEL_SCOPE=full pnpm test:golden:pixel:update
RITO_PIXEL_SCOPE=full pnpm test:golden:pixel
```

Full scope covers every profile and every spread. Its default baseline root is
`packages/rito/test-results/pixel-full-baselines`, which is intentionally
outside the committed golden tree. Set `RITO_PIXEL_BASELINE_ROOT` when comparing
against a restored external baseline in release or nightly workflows.

Pixel golden baselines are committed for Playwright's bundled Chromium on
macOS, which matches the dedicated CI pixel job. Use the default browser when
updating PNG baselines:

```bash
pnpm exec playwright install chromium
pnpm test:golden:pixel:update
```

If the bundled browser is unavailable but a compatible local browser is
installed, pass a Playwright channel for local diagnosis only. Do not commit
PNG updates generated through a different channel:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:golden:pixel
```

The baseline shape:

```text
packages/rito/tests/golden/pixels/
  book-01/
    single-narrow/
      greedy/
        summary.json
        spread-0000.png
        spread-0001.png
      optimal/
        summary.json
        spread-0000.png
```

Pixel failures write Playwright test artifacts:

- `actual.png`
- `diff.png`

For human review, use:

```bash
pnpm test:golden:pixel:review
```

This runs the same browser rendering path and writes a static comparison report
without updating baselines:

```text
packages/rito/test-results/pixel-review/index.html
```

Each spread includes `expected.png`, `actual.png`, `diff.png`, `metadata.json`,
and an expected/actual overlay slider in the HTML report. Use this when a
structured or render-command golden changes but pixel output needs a manual
visual check before deciding whether to update the affected non-pixel
baselines. The report can jump directly to problem spreads and switch by book,
profile, and line-breaking mode.

## Reader E2E

Reader e2e lives in:

```text
apps/reader/tests/e2e/
```

Command:

```bash
pnpm test:e2e
```

The suite builds the demo reader app with Vite, starts `vite preview`, and runs
Playwright against the production bundle. It focuses on user-visible behavior
rather than exhaustive pixel diffs:

- load the demo EPUB and verify a nonblank Canvas render
- keyboard page navigation
- table-of-contents navigation
- search and jump to a result
- settings changes that trigger reflow and theme updates
- a real bounded WebWorker protocol assertion covering initial lazy layout,
  exact frame reads, and the absence of legacy view-revision calls

Reader e2e can use a smaller fixture set than render golden because its job is
runtime behavior, not visual coverage.

It uses the same local browser setup as pixel golden. If Playwright's bundled
Chromium is unavailable locally, pass a browser channel:

```bash
PLAYWRIGHT_BROWSER_CHANNEL=msedge pnpm test:e2e
```

For production Reader load work, run the opt-in bounded profile:

```bash
RITO_READER_PROFILE_EPUB=/absolute/path/book.epub pnpm test:e2e:load-profile
```

It loads the EPUB through the normal file-input and production Reader stack,
intercepts only Workers named `rito-browser-reader`, and attaches a JSON report.
All timestamps use the page clock. The report separates input/Worker startup,
`open`, bounded layout through presentation, frame warming, exact aggregate
reads, host commit, Canvas readiness, later font-triggered reflows, and Long
Tasks. It never adds fields to production messages. The old JSON/`RITORB1`
app-level AB harness was retired after production moved off
`createViewRevision`; use the core-wasm wire benchmark and compatibility tests
when working on that legacy transport.

To turn that instrumentation into a reproducible threshold gate, run:

```bash
RITO_READER_USABILITY_GATE=/absolute/path/gate.json \
  RITO_READER_MACHINE_ID=<id> \
  pnpm test:e2e:usability-gate
```

The opt-in load-profile and usability-gate commands also write
`apps/reader/playwright-report/index.html`; the gate report contains each raw
run JSON attachment plus the aggregate threshold summary.

The manifest schema is strict. It pins the machine ID, platform, architecture,
CPU model, OS release, browser name and exact version, device-pixel ratio,
normal and reflow viewports, EPUB paths and SHA-256 digests, run count, and the
threshold for every measured stage. Unknown or mismatched environment and
corpus fields fail rather than silently producing incomparable data. Every
case/run gets a fresh `BrowserContext`; the browser process is shared, so this
is a warm shared-process document-load gate rather than a browser-process or
pinned-font cold-start measurement.

The gate records `open` round-trip, bounded-revision-to-presentation, frame
warm, input-to-first-Canvas, cached-turn first changed frame, deferred-growth
first changed frame, reflow first changed frame, and the maximum Long Task in
each measured action window. Waiting for the Canvas to settle isolates one
stage from the next and keeps animation Long Tasks in the observation window;
that wait is not added to any first-frame latency.
Long Tasks describe the Window main thread; Worker stalls remain visible in
the separately recorded Worker-operation durations.

The first three-run baseline was recorded on Apple M3, macOS release `25.5`,
Chromium `147.0.7727.15`:

| Fixture | Open | Bounded -> presentation | Frame warm | Input -> first Canvas | Cached turn | Deferred growth | Reflow | Max Long Task |
| ------- | ---: | ----------------------: | ---------: | --------------------: | ----------: | --------------: | -----: | ------------: |
| book-01 | 67.5 |                    40.8 |        2.4 |                 249.3 |        13.3 |            45.1 |  141.5 |          70.0 |
| book-04 | 63.5 |                    62.0 |        2.1 |                 246.4 |        12.9 |            47.8 |  201.4 |          70.0 |
| book-10 | 61.1 |                    34.8 |        2.0 |                 207.8 |        14.0 |            40.7 |  119.3 |          69.0 |

Values are nearest-rank p95 milliseconds across three runs, so each value is
the maximum of those three samples. This baseline closes the warm shared-process
document-load gate only. A formal Phase 1 usability declaration still requires
isolated browser-process/pinned-font cold-start measurements, memory limits,
and cancellation/disposal exercised under a recorded release protocol.

For a repeatable decode-only comparison on one fixed real payload, run:

```bash
pnpm --filter @ritojs/core-wasm bench:runtime-wire
RITO_WIRE_EPUB=/absolute/path/book.epub pnpm --filter @ritojs/core-wasm bench:runtime-wire
```

The command builds fresh WASM output, creates matching full-revision JSON and
`RITORB1` payloads once from `book-01` or the configured local EPUB, verifies
decoded equality, warms both decoders, and then alternates timed batches. Layout
and Rust encoding stay outside the measured region. The JSON output includes
payload sizes, raw timing samples, median/p95, runtime/machine context, and the
paired binary/JSON ratio.
`RITO_WIRE_BENCH_SAMPLES`, `RITO_WIRE_BENCH_TARGET_MS`,
`RITO_WIRE_BENCH_WARMUP_MS`, and `RITO_WIRE_BENCH_BATCH` can tune diagnostic
runs. This is not a CI threshold: compare multiple independent processes and
use the browser ABBA harness to confirm whether a decode change reaches the real
worker path.

## Failure Policy

Golden diffs should not be accepted by blindly running update commands. Before
updating goldens, identify which layer changed:

- parser or EPUB compatibility
- CSS cascade or computed style
- layout geometry
- line breaking
- pagination policy
- render paint behavior

Only update goldens after confirming the new output is intentional. When the
failure is a mismatch between Rito and a browser-rendered XHTML reference, follow
the [Rendering Diagnostics](./rendering-diagnostics.md) workflow before deciding
whether to fix code, document an unsupported feature, add an alternate baseline,
or update goldens.
