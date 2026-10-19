# Testing Pipeline

Regressions are caught at the earliest useful layer and again at the
rendered output. Fast module tests run by default; browser and device
gates run in CI and before a release; the pixel walk against pinned
Chromium is the acceptance instrument for layout and paint work and runs
by hand.

## Layers

| Layer        | Command                                                                       | Purpose                                                                                             |
| ------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Rust         | `pnpm rust:check`                                                             | `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace` |
| WASM         | `pnpm rust:wasm:check`, `pnpm --filter @ritojs/core-wasm build && test`       | wasm32 target check, the generated binding, Node tests of the decoders and session protocol         |
| Static       | `pnpm audit:dependencies`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | advisories, types, ESLint, Prettier                                                                 |
| Unit         | `pnpm test:unit`                                                              | Vitest suites of core, kit and react, including the architecture invariants                         |
| Browser unit | `pnpm --filter @ritojs/core test:browser`                                     | core's WebGL2 GPU pen in headless Chromium against the canvas pen; part of `test:unit` and coverage |
| Integration  | `pnpm test:integration`                                                       | the public entry's export surface; no book is opened                                                |
| Pixel suite  | `pnpm test:golden:pixel`                                                      | the built reader in Chromium: engine text geometry against the painted canvas                       |
| Reader e2e   | `pnpm test:e2e`                                                               | the demo reader in Chromium: load, navigation, TOC, search, settings, reflow, selection             |
| Flutter      | `flutter test` in `packages/rito_flutter`                                     | protocol decoders, the pen, session lifecycle, the paint-parity render test                         |
| Coverage     | `pnpm test:coverage`                                                          | V8 coverage for the published packages                                                              |
| Paint parity | `node tools/paint-parity/run.mjs`                                             | the two pens on identical `RITODL1` bytes, budget-gated; the GPU pen held to the canvas pen exactly |
| GPU pen      | `node tools/gl-pen-parity/run.mjs`                                            | real books through both web pens, compared pixel for pixel                                          |
| Pixel walk   | `tools/corpus-oracle/pixel-walk.mjs`                                          | the pages of a real book against pinned Chromium; the acceptance instrument                         |

`pnpm run check` (`test:ci`) is the local aggregate: bootstrap, typecheck,
lint, format check, unit, integration and build.

## Continuous integration

CI runs on pull requests targeting `master`; master is protected by
required checks with branches required to be up to date, so the PR round
verifies the exact merge result. The jobs run in parallel:

- Rust Checks — `pnpm rust:check` on the pinned toolchain
- WASM Bindings — wasm32 check, `@ritojs/core-wasm` build and tests
- Static Checks — audit, typecheck, lint, format
- Unit & Golden Tests — unit and integration suites
- Build & Pack — the full build and `pnpm release:pack-check`
- Reader E2E — sharded four ways, with the canvas-pixel suites excluded
- Pixel Golden — on macOS with Playwright's bundled Chromium
- Coverage Gate

The canvas-pixel e2e suites (selection, touch selection, production
pinned font) run in the separate `pixel-e2e.yml` workflow on pull
requests targeting master and on master pushes. The Release workflow reruns the full check before publishing.

## Pixel suite

`packages/rito/tests/golden-pixel/` runs the built production reader in
Chromium and checks what reaches the canvas against what the engine
reports: today one spec proves that the exact text ranges the engine
resolves land on the glyphs the Canvas painted across the author's face
and a pinned fallback face. There are no checked-in PNG baselines. CI runs
it on macOS with Playwright's bundled Chromium.

```bash
pnpm test:golden:pixel
RITO_PIXEL_WORKERS=4 pnpm test:golden:pixel
```

Whole-book pixel verification against pinned Chromium is the pixel walk in
[Verification Instruments](./verification-instruments.md).

## Reader e2e

The suite lives in `apps/reader/tests/e2e/`, builds the demo reader with
Vite, starts `vite preview` and runs Playwright against the production
bundle. `reader-session-log.ts` reads the reader's own log of every
request it sent its session and how it was answered, for a test that has
to say which protocol a reader spoke or that none of it failed.

Opening, font-change and page-turn latency are measured by the acceptance
probe, against a production build served by `vite preview --port 4317`:

```bash
BOOK=/abs/book.epub VIEW=phone RUNS=3 node tools/reader-accept/accept.mjs
```

It drives the public controller, takes "the new page is on screen" from
the canvas pixels changing, and prints the median of its runs as one JSON
line: `open` (file handed over to first page), `pageNumbers` (first page
to the layout that covers the whole book), `fontSize` (first change and
the next), `family` and `familyBack`, `turn` (key press to first changed
frame) and `panelFontSize` (one step of the settings panel's slider).
`VIEW=desktop` measures a 1280×860 double-page viewport. Timings move by
tens of milliseconds with whatever else the machine is doing; compare
two builds by measuring them in turn on the same quiet machine.
`accept-all.sh <out.jsonl>` measures three books in both viewports and
starts each row only once the machine's load is low.

When a turn measures slow, `turn-trace.mjs` in the same directory says
where the time went: one timeline per turn with the key event, every
session request and how long it took, and every animation frame with its cost and
the Canvas calls it made. `SAMPLE=none` traces without reading the canvas
back, and `RASTER_FIRST=1` rasters every drawn canvas before each turn,
the control for a first frame that pays for a buffer the browser had only
recorded.

## Flutter

```bash
rm -rf packages/rito_flutter/.dart_tool/hooks_runner
cd packages/rito_flutter && flutter test
```

The Native Assets hook compiles `rito-ffi` from the tracked source
closure. Clear `hooks_runner` after a Rust change, or the tests run
yesterday's engine.

## Failure policy

A failing gate is classified before anything is updated:

- parser or EPUB compatibility
- cascade or computed style
- layout geometry or line breaking
- pagination
- paint or lowering
- a pen

Goldens and budgets are updated only after the new output is shown to be
the browser's. When a law changes, every suite that encodes it is updated
in the same change: a Rust test, a Node decoder test, a Dart test and a
fixture can each hold the old value, and a stale one reads as flaky.
