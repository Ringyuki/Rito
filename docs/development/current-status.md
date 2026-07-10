# Current Development Status

This is the handoff entrypoint for contributors and coding agents continuing the
Rust-backed core migration.

Read this file first, then follow the links in the order below. Do not start
from the historical native reader or Flutter spike docs unless you need context
for a specific decision.

## Immediate Reading Order

1. [`native-core-rust-plan.md`](./native-core-rust-plan.md)
   - Read: Principles, Product Shape, Package Model, Entry Point Strategy,
     Communication Strategy, Current State, Remaining Gaps, Immediate Execution
     Plan, Verification Gates.
   - This is the source of truth for the Rust core migration.
2. [`browser-reader-thin-shell-plan.md`](./browser-reader-thin-shell-plan.md)
   - Read to understand why the browser TypeScript shell is intentionally small
     and what TypeScript is still allowed to own.
3. [`ts-core-implementation-map.md`](./ts-core-implementation-map.md)
   - Read when comparing Rust output to the old TypeScript implementation.
   - The old TS implementation is a reference oracle, not production code.
4. [`rendering-diagnostics.md`](./rendering-diagnostics.md) and
   [`testing-pipeline.md`](./testing-pipeline.md)
   - Read before fixing visual parity problems or changing golden fixtures.
5. [`binary-wire-v2-inventory.md`](./binary-wire-v2-inventory.md)
   - Read before implementing `RITORB1`; it records the current JSON hot paths
     and the first runtime-bundle migration boundary.

## Current Product Direction

The long-term core source of truth is Rust.

```text
crates/rito-core
  EPUB, XHTML, CSS/style, layout, pagination, display commands,
  runtime document/revision/frame/resource/search/geometry ownership

crates/rito-wasm
  thin browser-target binding over Rust core

packages/rito
  @ritojs/core public npm package
  thin reader facade, browser loader, worker adapter, resource adapter

packages/kit
  controller, interaction helpers, overlays, storage, transitions

packages/react
  React hooks and components over core + kit
```

The old TypeScript core still exists only under
`packages/rito/src/reference/ts-core/**`. It must remain runnable for parity,
goldens, and diagnostics, but it must not leak back into production package
entries.

## Current Source Ownership

- Production root reader API:
  `packages/rito/src/reader/**`
- Browser-specific shell:
  `packages/rito/src/bindings/browser/**`
- Old TS reference oracle:
  `packages/rito/src/reference/ts-core/**`
- Source-only reference facade:
  `packages/rito/src/reference/index.ts`
- Kit-owned interaction helpers:
  `packages/kit/src/interaction/**`
- Private WASM build/decoder workspace:
  `packages/rito-core-wasm/**`

Do not re-create root `packages/rito/src/parser`, `style`, `layout`, `render`,
`runtime`, `interaction`, `dom`, `model`, or `utils` implementation directories.
Those names now belong to the old TS reference tree only.

## What Is Done

- Root `@ritojs/core` exports the Rust-backed `createReader` path.
- `@ritojs/kit`, `@ritojs/react`, and `apps/reader` consume the root core reader
  surface instead of legacy core subpaths.
- Legacy TS core source has been quarantined under `src/reference/ts-core/**`.
- The counted browser reader shell target has been hit:
  - `packages/rito/src/bindings/browser/reader/**`: 12 TypeScript files / 1524
    lines by `wc -l` (1536 under the architecture invariant's split-line count;
    hard ceiling 1550), plus a 3-line static `.mjs` worker-entry facade
  - `packages/rito/src/reader/**`: 6 files / 354 lines
  - the hardening increment is explicit revision release, a bounded 12-frame
    LRU cache, and regression-protected preview/full handoff between two workers
- Rust has the main runtime pieces in place: document handles, deterministic
  revisions, frame cache, resource transfer leases, locators, footnotes, text
  geometry, search, frame-resource prefetch, and packed frame command buffers.
- Display commands are typed in Rust, and JSON fixture views plus packed command
  buffers are derived from the same command model.
- The milestone parity suites are green for the current selected surface: all
  10 fixture books across 4 package/layout configurations, plus 30 exhaustive
  runtime render-command groups covering 189 cases and 378 render summaries.
- `RITOFCB2` is the current packed frame command-buffer ABI.
- `RITORB1` has a private, opt-in view-revision slice. Its Rust encoder and
  Rust/JavaScript decoders share a checked 574-byte cross-language golden
  vector; unsafe integers, malformed counts, and special object keys such as
  `__proto__` have explicit regression coverage.
- Repeated primitive values reuse existing value-table indexes without changing
  the V1 wire or either decoder. Full-revision calibrations for `book-01`,
  `book-06`, and `book-10` now produce binary payloads between 78.6% and 81.2%
  of their JSON byte lengths, instead of 111.4% to 117.9% before reuse.
- The JavaScript `RITORB1` decoder keeps the same FNV-1a checksum and object
  semantics while avoiding per-byte `BigInt` work and unnecessary property
  descriptors. Cross-language goldens and malformed-checksum rejection remain
  unchanged, and the dominant browser decode hotspots are removed.
- The normal reader E2E suite exercises a real `RITORB1` WebWorker session, and
  `pnpm test:e2e:wire-ab` runs fresh-context JSON/binary ABBA sessions through
  initial preview, deferred full layout, settings reflow, and real page turns.
  The opt-in report now separates raw wire bytes, Rust encode time, the complete
  WASM method call, JavaScript decode time, worker processing, and worker round
  trip, grouped independently for initial preview/full and reflow preview/full
  revisions. Local runs have matched all revision/spread results with no console
  or page errors.
- JSON remains the production default. Local A/B runs are evidence that the
  opt-in path does not reproduce the old page-turn regression, not enough data
  to claim a general speedup. The initial payload-size blocker is addressed,
  the timing instrumentation now exists, and a fixed-payload microbenchmark on
  a real fixture isolates eager JSON/RITORB1 decode from layout and encoding.
  Current local samples still show a CPU cost for eager binary decoding;
  representative books and machines need repeated measurements before a default
  decision.
- Package export guards keep `@ritojs/core` limited to the root entry and
  `./package.json`.
- The public core build bundles the private WASM workspace's JavaScript modules,
  copies the generated `.wasm`, and passes tarball checks that reject private
  runtime dependencies/imports and smoke-test an isolated install.

## Main Remaining Gaps

1. **Display parity**
   - Continue comparing Rust output against the TS reference/golden pipeline.
   - Focus on the CSS/layout/display-list subset already in the plan.
   - Do not invent new broad scope such as a full browser CSSOM unless the plan
     is explicitly changed.
2. **Binary-first runtime wire**
   - `RITORB1` now has a private first slice for the normal reader
     view-revision response, including the bundled initial frame-window and
     resource payload metadata already present in `WasmViewRevisionResponse`.
   - The binary reader path is still opt-in only. The A/B harness and always-on
     browser smoke now exist, and the A/B report separates raw-wire,
     Rust-encode, full-WASM-call, JavaScript-decode, worker-processing, and
     round-trip measurements. The next milestone is repeated representative
     trend data before deciding whether to make it default.
   - Keep `RITOFCB2` for frame commands; `RITORB1` owns runtime metadata
     currently moved through JSON.
3. **Generated boundary types**
   - Raw wasm-bindgen types are generated, but many business DTO types in
     `packages/rito-core-wasm/src/types/**` are still hand-written.
   - Long term, Rust/schema should generate TypeScript DTO declarations.
4. **Browser presentation adapter**
   - `packages/rito/src/bindings/browser/rendering.ts` is the remaining guarded
     production adapter that delegates Canvas rendering to the TS reference
     display-list renderer.
   - This dependency is visible and intentional for parity, but it is not the
     final renderer-ready boundary.

## Do Not Do

- Do not add `@ritojs/core/web`, `@ritojs/core/advanced`, or legacy focused
  subpaths back to `package.json`.
- Do not put Rust runtime adapters in `apps/reader`.
- Do not move Rust source into `packages/rito/src`.
- Do not delete `packages/rito/src/reference/ts-core/**`; it is still needed for
  parity and diagnostics.
- Do not add new TypeScript reader runtime policy when the same decision can be
  moved into `crates/rito-core`.
- Do not expose temporary Rust/WASM/binary implementation names on public API
  surfaces.

## Verification Commands

Focused loop:

```sh
pnpm run rust:parity:fast
pnpm --filter @ritojs/core-wasm run test
pnpm --filter @ritojs/core-wasm run typecheck
pnpm --filter @ritojs/core run typecheck
pnpm --filter @ritojs/core run test
pnpm test:e2e:wire-ab
```

Milestone loop:

```sh
pnpm run rust:parity:full
cargo test -p rito-core
cargo test -p rito-wasm
cargo clippy -p rito-core --all-targets -- -D warnings
cargo clippy -p rito-wasm --all-targets -- -D warnings
pnpm --filter @ritojs/core-wasm build
pnpm --filter @ritojs/core-wasm test
pnpm --filter @ritojs/core-wasm typecheck
pnpm --filter @ritojs/core typecheck
pnpm --filter @ritojs/core test
pnpm --filter @ritojs/core build
pnpm lint
git diff --check
```

The full parity command includes both ignored milestone suites: the selected
10-book × 4-config package/layout fixture matrix and the 30-group exhaustive
runtime render-command matrix.

## Best Next Work

Pick one of these, in order:

1. Continue Binary Wire V2 implementation:
   - keep the production reader on JSON while repeating the opt-in `RITORB1`
     ABBA session across representative machines and larger/resource-heavy
     books;
   - use the existing private reader switch and instrumented
     `test:e2e:wire-ab` report to compare raw-wire, encode/decode, worker, and
     round-trip trends before making binary metadata default;
   - use `pnpm --filter @ritojs/core-wasm bench:runtime-wire` for repeated
     fixed-payload decode comparisons without layout/encode noise;
   - keep adding JSON/binary agreement tests for each moved payload;
   - keep `RITORB1` private to package internals until the public facade
     remains stable.
2. Continue display parity:
   - use TS reference diagnostics and render-command goldens;
   - fix Rust layout/display differences without adding new TS runtime policy.
3. Keep the internal WASM workspace release-safe while the wire evolves:
   - preserve the build-time-only dependency;
   - keep generated glue/decoder code bundled and the `.wasm` copied into the
     public core tarball;
   - keep isolated tarball install/import checks green.

## Immediate Next Implementation Plan

Start with Binary Wire V2. Do not begin by moving package directories or fixing
display details.

1. **Inventory current JSON hot paths**
   - Done in [`binary-wire-v2-inventory.md`](./binary-wire-v2-inventory.md).
   - List every `*Json` WASM method used by normal reader open, reflow,
     revision commit, frame metadata, resource planning, search, and geometry.
   - Classify each method as debug-only, cold public metadata, warm interaction,
     or hot runtime payload.
   - Mark which calls must remain for JSON fixture/debug output.
2. **Define `RITORB1`**
   - Done for the first slice in `crates/rito-core/src/runtime/bundle_wire.rs`.
   - It includes magic, version, table offsets/lengths, record counts, checksum,
     string interning, and strict Rust/JS bounds validation.
   - It starts with `createViewRevisionBundleBytes()`, covering the current
     `WasmViewRevisionResponse` object including selected-frame window metadata.
   - Do not include display commands; `RITOFCB2` already owns that path.
3. **Derive JSON and binary from one Rust model**
   - Done for `createViewRevisionBundle`: JSON and bytes are generated from the
     same typed `WasmViewRevisionResponse` model.
   - Agreement tests cover initial preview, active-chapter visual preview, full
     revision, and resource-bearing frame-window metadata.
   - Keep existing JSON dump/fixture view.
   - Add binary encoder from the same typed Rust structs.
   - Add Rust tests proving JSON view and binary-decoded view agree on revision
     id, spread/page counts, selected frame, frame hashes, resource refs, and
     geometry/table counts.
4. **Add JavaScript decoder and focused tests**
   - Done in `packages/rito-core-wasm/src/runtime-bundle-decoder-runtime.js`.
   - The decoder rejects wrong magic, unsupported version, truncated buffers,
     invalid table ranges, invalid UTF-8/string/value indexes, checksum
     mismatch, unsafe integers, and mismatched declared/decoded record counts.
   - Rust and JavaScript consume the same checked golden vector, including
     Unicode, nested/repeated values, safe integer boundaries, and an own
     `__proto__` data property.
   - Do not hand-maintain a second schema shape in JS beyond the decoder view.
5. **Migrate one hot path end to end**
   - First slice is wired behind the private reader wire switch, not on the
     default reader path.
   - The first candidate is now implemented as
     `createViewRevisionBundleBytes()`.
   - Keep the public `@ritojs/core` API object-shaped by decoding at the facade
     boundary.
   - Keep debug JSON methods available for fixtures and diagnostics.
   - A real WebWorker smoke is part of normal E2E, and the opt-in ABBA harness
     records revision round trips, committed spread counts, turn readiness,
     rAF gaps, long tasks, browser errors, raw wire bytes, Rust encode time,
     complete WASM method time, JavaScript decode time, and worker processing
     time.
6. **Only then expand**
   - Do not move search/geometry/page targets until the binary
     revision/frame/resource path is proven behind an opt-in switch.
   - Start generated TS boundary types after the Rust binary schema is stable
     enough to generate from.
   - Keep `packages/rito-core-wasm` private and build-time-only while the wire
     and type direction evolves; its generated output is already bundled into
     the public core artifact.

The local ABBA runs met the semantic and page-turn no-regression criterion for
the demo book. Keep the binary path opt-in until trend runs on representative
machines/books justify a default switch; the separate boundary instrumentation
is available, but one local measurement is not a stable performance trend. Do
not expand into search or geometry merely because these sessions passed or the
payload is now smaller.
