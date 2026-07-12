# Current Development Status

This is the handoff entrypoint for contributors and coding agents continuing the
Rust-backed core migration.

Read this file first, then follow the links in the order below. Do not start
from the historical native reader or Flutter spike docs unless you need context
for a specific decision.

## Immediate Reading Order

1. [`native-core-usability-roadmap.md`](./native-core-usability-roadmap.md)
   - This owns the active phase order: usable Rust reader, controlled
     DOM/WebView baseline transition, then long-term capability and performance
     work.
2. [`native-core-rust-plan.md`](./native-core-rust-plan.md)
   - Read: Principles, Product Shape, Package Model, Entry Point Strategy,
     Communication Strategy, Current State, Remaining Gaps, Active Usability
     Execution Plan, Verification Gates.
   - This owns migration boundaries, package shape and implementation
     constraints; older work-order sections do not override the active roadmap.
3. [`browser-reader-thin-shell-plan.md`](./browser-reader-thin-shell-plan.md)
   - Read to understand why the browser TypeScript shell is intentionally small
     and what TypeScript is still allowed to own.
4. [`ts-core-implementation-map.md`](./ts-core-implementation-map.md)
   - Read when comparing Rust output to the old TypeScript implementation.
   - The old TS implementation is a reference oracle, not production code.
5. [`rendering-diagnostics.md`](./rendering-diagnostics.md) and
   [`testing-pipeline.md`](./testing-pipeline.md)
   - Read before fixing visual parity problems or changing golden fixtures.
6. [`binary-wire-v2-inventory.md`](./binary-wire-v2-inventory.md)
   - Read before implementing `RITORB1`; it records the current JSON hot paths
     and the first runtime-bundle migration boundary. Binary-wire expansion is
     currently deferred pending new end-to-end evidence.

## Current Product Direction

The long-term core source of truth is Rust.

The active product order is:

1. finish a genuinely usable Rust reader, including bounded incremental layout,
   complete native interaction wiring and a minimum performance floor;
2. move visual authority from the TypeScript migration oracle to a pinned,
   controlled WebView/DOM reference harness;
3. continue long-term rendering capability and broad performance work against
   that baseline.

See
[`native-core-usability-roadmap.md`](./native-core-usability-roadmap.md). Minimum
first-paint and page-turn performance is part of usability; broad tuning remains
later work.

```text
crates/rito-core
  EPUB, XHTML, CSS/style, layout, pagination, display commands,
  runtime document/revision/frame/resource/search/geometry ownership

crates/rito-wasm
  thin browser-target binding over Rust core

packages/rito
  @ritojs/core public npm package
  thin reader facade, browser loader/worker/resource adapters,
  production Canvas frame-command executor

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
- The counted browser reader shell previously reached its 1550-line target.
  Subsequent revision/session and native-interaction hardening has grown
  `packages/rito/src/bindings/browser/reader/**` to 15 TypeScript files / 2052
  physical lines, plus the static `.mjs` worker-entry facade. The temporary
  invariant ceiling is 2100 split-counted lines because the exact-version
  interaction adapter, visible-page LRU and preview gate are browser revision
  lifecycle responsibilities and remain in the counted directory. The bounded
  production switch must delete the legacy preview/deferred-full scheduler and
  return this shell below the documented ceiling; adding a second browser-owned
  state machine is not acceptable.
  - `packages/rito/src/reader/**`: 6 files / 449 physical lines, under a temporary
    470-line public-contract ceiling for stable interaction and locator types
  - the hardening increment is explicit revision release, a bounded 12-frame
    LRU cache, and regression-protected preview/full handoff between two workers
  - deferred preview follow-ups carry the complete Rust-authored full request;
    the browser only applies live-spread and Worker-session adjustments, while
    the private reader client rejects and releases semantically mismatched plans
- Rust has the main runtime pieces in place: document handles, deterministic
  revisions, frame cache, resource transfer leases, locators, footnotes, text
  geometry, search, frame-resource prefetch, and packed frame command buffers.
- The experimental bounded runtime now has one-shot continuation cursors,
  cancellation, partial/final extents and stable-prefix publication. Every
  revision-scoped core read also has a version-gated form, stale releases are
  rejected before mutation, resource-transfer leases are owned by the exact
  revision version, and post-cursor engine failures return the new failed
  revision summary for deterministic cleanup.
- Raw WASM exposes bounded create/continue/cancel plus version-gated frame,
  resource, locator, interaction, geometry, metadata and release operations.
  `unknown-revision` and `stale-revision-version` are stable wire error codes.
- Visible-page targets are now typed Rust values rather than diagnostic JSON.
  They distinguish text, link, standalone image and exact-revision footnote
  targets; keep page-content bounds; preserve the source EPUB href; and carry
  separate canonical source and internal-destination locators. The legacy
  hit-map diagnostic JSON and golden hashes remain unchanged.
- Rust core now exposes version-gated exact text interaction independently of
  the legacy interpolated geometry diagnostic. Point hit testing chooses only
  retained shaped cluster edges, and same-flow ranges revalidate both carets,
  require one `Arc`-identified logical flow, preserve unpainted soft-wrap text,
  return source locators and exact per-page rectangles, and work across
  pagination. Host-measured runs, unavailable source spans, illegal grapheme
  interiors and unsupported transforms return typed unavailable results. WASM,
  Browser Reader and Kit wiring remain.
- The private JavaScript facade and Worker transport preserve complete revision
  handles for bounded advances and version-gated reads, reject skipped or
  mismatched versions, round-trip failed-revision cleanup state, and perform
  exact versioned release. A private bounded session controller now coalesces
  target spreads with latest-request priority, permits only one continuation
  quantum in flight, yields between quanta, avoids starting another quantum
  when a retarget is already available, refreshes complete navigation
  snapshots, warms frames and resources at the exact accepted version, and
  cancels/releases the latest handle after races or failures. The
  production-reader switch is still pending.
- Display commands are typed in Rust, and JSON fixture views plus packed command
  buffers are derived from the same command model.
- Font-aware layout now follows declared `font-family` order, treats omitted
  face descriptors as `normal 400`, applies CSS style/weight matching before
  glyph fallback, and checks equal-descriptor composite faces in reverse source
  order. A missing glyph advances to the next family rather than a weaker face
  from the selected family. Pinned revisions now carry a revision-bound manifest
  containing the static, Rust-shapeable EPUB faces whose families that layout
  references. The browser reads those resources from the candidate revision,
  verifies their Rust-authored byte fingerprints, waits for every `FontFace` to
  load, then commits them atomically in Rust source order before the revision
  becomes visible. Failure or staleness rolls back only that candidate. Legacy
  readers retain their opportunistic, best-effort loader.
- Image-size lookup, eager document reads, and runtime resource transfers now
  share one ambiguity-aware href resolver. An exact raw source/key match wins;
  remaining matching strips URL query/fragment suffixes before path lookup,
  then applies one valid percent-decoding pass symmetrically to source and
  resource keys. Stripped relative exact paths beat longer suffix candidates,
  while malformed escapes, double encoding, suffix slashes, and canonical-key
  collisions cannot trigger a shorter guess.
- Rust now also indexes safe, canonical image files that are present in the ZIP
  but absent or mislabeled in the OPF manifest, matching the reference reader's
  real-world tolerance. Runtime open scans central-directory metadata only;
  bytes, hashes, and intrinsic dimensions remain lazy until a chapter or
  transfer actually uses the image. Manifest resources retain precedence by
  resolved ZIP entry identity, including percent-encoded manifest hrefs.
  Physical fallback names containing `%`, `?`, or `#` receive URL-safe logical
  hrefs and retain exact central-directory identities for later lazy reads.
- Mixed-content visual previews commit without waiting for image decode, then
  invalidate once the selected image resources enter the browser cache. The
  completion is ignored after navigation, preview replacement, or disposal;
  image-dominated previews keep their existing blocking first-paint behavior.
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
- The encoder precomputes the string-table byte length and writes that table
  directly into the final bundle allocation. This removes one whole-section
  buffer and copy while the checked cross-language V1 bytes remain identical.
- The encoder now reuses one recursive container-index scratch buffer, consumes
  the normalized JSON tree as it walks it, and keeps each unique string in one
  owner before restoring encounter order for final output. A `book-01` full
  payload no longer creates 19,289 per-container index vectors or duplicates
  the 312,589-byte unique string set into both the ordered table and lookup map.
- The JavaScript `RITORB1` decoder keeps the same FNV-1a checksum and object
  semantics while avoiding per-byte `BigInt` work and unnecessary property
  descriptors. Cross-language goldens and malformed-checksum rejection remain
  unchanged, and the dominant browser decode hotspots are removed. Its low-level
  payload contract is now the generic recursive JSON value supported by V1;
  JSON and binary view-revision adapters validate their discriminants and core
  structure before returning the operation-specific typed response.
- String, value, and nested-array tables now preallocate their declared sizes
  after validating that every count fits the remaining section. Back references
  remain valid, forward/self references remain rejected, and malicious counts
  cannot trigger the allocation before the range check.
- Full reader revisions now inline document-stable `chapterTextIndices.entries`
  once per Reader/publication. That Reader's foreground and full-reflow clients
  share a private cache, so later full revisions carry a validated scope
  reference on either JSON or `RITORB1`; previews remain inline. The facade
  hydrates a fresh snapshot into the unchanged public revision shape and does
  not expose the private scope key.
- The normal reader E2E suite exercises a real `RITORB1` WebWorker session, and
  `pnpm test:e2e:wire-ab` runs fresh-context JSON/binary ABBA sessions through
  initial preview, deferred full layout, settings reflow, and real page turns.
  The opt-in report now separates raw wire bytes, Rust encode time, the complete
  WASM method call, JavaScript decode time, worker processing, and worker round
  trip, grouped independently for initial preview/full and reflow preview/full
  revisions. Local runs have matched all revision/spread results with no console
  or page errors.
- JSON remains the production default. The local evidence matrix now includes
  15 fresh-process decode runs across `book-01`, `book-06`, and `book-10`, plus
  three full WebWorker ABBA runs for `book-01`. Binary payloads are consistently
  about 79%–81% of JSON, but eager binary encode/decode is several times more
  expensive. The recorded decision is no-go for a default switch; see
  [`binary-wire-v2-evidence.md`](./binary-wire-v2-evidence.md). Cross-machine
  evidence is still required before reconsidering that decision. The first
  local materialization pass is complete; it did not reverse the no-go.
- Package export guards keep `@ritojs/core` limited to the root entry and
  `./package.json`.
- The public core build bundles the private WASM workspace's JavaScript modules,
  copies the generated `.wasm`, and passes tarball checks that reject private
  runtime dependencies/imports and smoke-test an isolated install.

## Main Remaining Gaps

1. **Bounded, stateful pagination**
   - The production reader still lays selected chapters as complete batches.
     The Rust core now has an opt-in bounded revision path with top-level-node
     budgets, one-shot versioned cursors, cancellation, stable partial extents,
     lazy chapter/image loading and resumable page-window growth. It is not yet
     selected by the browser reader; raw WASM, private JavaScript/Worker
     primitives and the coalescing session controller are available.
   - A single large paragraph/table remains atomic, and publication-wide
     cross-chapter footnote filtering still needs a lazy-safe indexing policy
     before the bounded path can claim universal eager equivalence.
   - The legacy browser shell still issues several frame/resource/search and
     destructive release operations by revision ID only. Those paths are safe
     only while a revision ID is immutable; they must be replaced with exact
     session/id/version requests before same-ID bounded advances are selected.
   - Initial paint must not require eight complete chapters, one complete large
     chapter or the complete publication.
2. **Native interaction wiring**
   - Rust/WASM now owns typed page targets, text positions and range geometry.
     Exact-version Worker reads for page targets, individual footnotes and href
     locators are implemented with field-level response validation. The public
     Reader now exposes an optional atomic interaction capability backed by the
     complete Worker/session, revision-version and browser-generation handle;
     page targets are cached in a bounded revision-scoped LRU, and visual
     previews explicitly disable all reads. Kit now atomically installs the
     current spread's native targets and uses them for exact footnotes, internal
     locator navigation, external links and standalone images without falling
     back to legacy hit geometry.
   - Migrate Kit selection, highlights, annotations, reading positions and
     accessibility after precise native point/caret and range geometry lands.
   - Remove empty-page-content and synthetic-measurer compatibility stubs after
     their callers use native semantic and geometry queries.
3. **Thin session ownership**
   - Reflow sequencing, preview/full handoff, revision commit and some cache and
     font-reflow policy still live in the browser shell.
   - Keep browser operations in the host, but move reader state transitions and
     resource/window intent into Rust-authored session plans.
4. **Usability and performance gates**
   - Run a representative real-book corpus through open, first paint,
     navigation, resize, typography changes, interaction, cancellation and
     disposal.
   - Measure document open, bounded initial layout, first frame, deferred
     growth and page turns independently on a named machine/browser setup.
   - Minimum first-paint and page-turn latency is a usability requirement, not
     deferred micro-optimization.
5. **Controlled baseline transition**
   - After the usability gate, build a pinned WebView/DOM reference harness and
     make it the visual authority for future rendering work.
   - Keep the TypeScript oracle runnable as a historical regression tripwire,
     but stop treating it as the authority after the transition.
6. **Deferred migration work**
   - Continue targeted display fixes only when they block usability or protect
     an already supported behavior.
   - Keep `RITORB1` private and opt-in; local evidence remains a no-go for a
     default switch. Do not expand it without new end-to-end evidence.
   - Generated Rust/schema-owned boundary types remain desirable after the
     native Reader contract stabilizes.

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
- Do not resume broad display-parity or binary-wire expansion before the
  bounded-layout and native-interaction usability work.
- Do not move semantic interaction targets, source ranges or layout geometry
  into host-owned heuristics; the browser should adapt core-owned results.
- Do not delete the TypeScript oracle before the controlled DOM/WebView
  baseline transition is complete.

## Verification Commands

Focused loop:

```sh
pnpm run rust:parity:fast
pnpm --filter @ritojs/core-wasm run test
pnpm --filter @ritojs/core-wasm run typecheck
pnpm --filter @ritojs/core run typecheck
pnpm --filter @ritojs/core run test
pnpm test:e2e:wire-ab
RITO_EPUB_SMOKE_DIR="$HOME/Downloads" pnpm test:e2e:downloads-smoke -- --workers=3
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

Work in roadmap order:

1. Define revision/session identity, partial extent, source locators and the
   incremental continuation contract.
2. Implement bounded initial layout and resumable window growth, including the
   large-single-XHTML case.
3. Connect the implemented typed current-visible-spread target and
   exact-version Worker contract to the public Reader and Kit click path.
4. Add precise native point/range geometry, then migrate Kit selection,
   highlights, annotations, reading positions and accessibility.
5. Reduce browser session policy to explicit core-requested host operations.
6. Establish the real-book usability and stage-specific performance gate.
7. Build the pinned WebView/DOM reference harness and declare the baseline
   transition before broad display or performance work resumes.

## Immediate Next Implementation Plan

Start with the revision/locator and bounded-pagination contract. The first
implementation slice must:

1. define a revision handle that distinguishes Worker/session identity, Rust
   revision id and browser commit generation;
2. define ready/complete/cancelled/failed state, known spread extent and
   optional final extent;
3. define source point/range locators and unpaginated seek/grow behavior;
4. define the Rust-owned continuation state without exposing internal layout
   structures in the public API;
5. lay out a bounded initial page window and return a continuation;
6. resume the same revision without rebuilding already committed work;
7. cancel stale work and preserve source position across reflow;
8. prove with a large single-XHTML fixture that first paint no longer waits for
   the complete chapter;
9. report stage-specific timings separately from full-publication completion.

Design the continuation contract with interaction indexes and source locators
in mind. Do not build another pagination surface that later forces selection or
annotation geometry back into TypeScript.

## Archived Binary-Wire Implementation Record

The record below documents completed `RITORB1` work and remains useful evidence.
It is not the current implementation priority.

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

The repeated local decode/ABBA matrix met semantic and page-turn no-regression
criteria but produced a no-go default decision because eager binary
encode/decode remains materially more expensive. Keep the binary path opt-in,
optimize materialization, and repeat the matrix on another machine class before
reconsidering the default. Do not expand into search or geometry merely because
the payload is smaller. A later reader-private cache reduced repeated full
chapter-text transport to roughly 3% of its inline size for both wires, but it
does not remove the first inline payload or establish a binary speed advantage.
