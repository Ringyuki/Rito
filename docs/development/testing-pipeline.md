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
| WASM         | `pnpm rust:wasm:check`, `pnpm --filter @ritojs/core-wasm build && test`       | wasm32 target check, the generated binding, Node tests of the decoders and Worker helpers           |
| Static       | `pnpm audit:dependencies`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | advisories, types, ESLint, Prettier                                                                 |
| Unit         | `pnpm test:unit`                                                              | Vitest suites of core, kit and react, including the architecture invariants                         |
| Integration  | `pnpm test:integration`                                                       | end-to-end core flows against fixture books                                                         |
| Pixel suite  | `pnpm test:golden:pixel`                                                      | the built reader in Chromium: engine text geometry against the painted canvas                       |
| Reader e2e   | `pnpm test:e2e`                                                               | the demo reader in Chromium: load, navigation, TOC, search, settings, reflow, selection             |
| Flutter      | `flutter test` in `packages/rito_flutter`                                     | protocol decoders, the pen, session lifecycle, the paint-parity render test                         |
| Coverage     | `pnpm test:coverage`                                                          | V8 coverage for the published packages                                                              |
| Paint parity | `node tools/paint-parity/run.mjs`                                             | the two pens on identical `RITODL1` bytes, budget-gated                                             |
| Pixel walk   | `tools/corpus-oracle/pixel-walk.mjs`                                          | every page of a real book against pinned Chromium; the acceptance instrument                        |

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
pinned font) run in the separate `pixel-e2e.yml` workflow on master
pushes. The Release workflow reruns the full check before publishing.

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
bundle. Opt-in gates on a named machine:

```bash
RITO_READER_PROFILE_EPUB=/abs/book.epub pnpm test:e2e:load-profile
RITO_READER_USABILITY_GATE=/abs/gate.json RITO_READER_MACHINE_ID=<id> pnpm test:e2e:usability-gate
pnpm test:e2e:memory-gate
```

The load profile records Worker startup, open, layout, frame warming and
first Canvas timings from the page clock; the usability gate turns them
into thresholds pinned to an exact machine, browser and font policy; the
memory gate samples physical footprint across load, growth, reflow,
replacement and dispose scenarios.

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
