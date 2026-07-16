# Rust Core Plan

> **Active priority:**
> [`native-core-usability-roadmap.md`](./native-core-usability-roadmap.md) owns
> the current phase order. Complete bounded pagination, native interaction and
> the usability gate before resuming broad display-parity or wire-format work.
> This document remains authoritative for migration boundaries, package shape
> and implementation constraints.

This document defines the Rust rewrite plan for Rito core. It complements:

- [`ts-core-implementation-map.md`](./ts-core-implementation-map.md), which maps
  the current TypeScript implementation.
- [`native-reader-architecture.md`](./native-reader-architecture.md), which
  records reader runtime, session, frame, and platform-shell lessons from the
  TS and Flutter spike.
- [`native-reader-ui-plan.md`](./native-reader-ui-plan.md), which owns product UI
  and interaction design.

The decision is explicit: the long-term core source of truth should be Rust.
The current TypeScript implementation remains the migration oracle through the
Rust usability gate. After that gate, visual authority moves to the controlled
WebView/DOM harness defined by the active roadmap; the TypeScript oracle remains
only as a historical regression tripwire. It should not keep absorbing new
cross-platform reader runtime work.

## Principles

- Rebuild the full Rito core capability set in Rust, not a narrow app-shell
  subset.
- Preserve the proven boundaries: EPUB/resources, XHTML, CSS/style, layout,
  pagination, display-list, interaction, runtime.
- Keep TypeScript fixtures, render-command goldens, and pixel tests as migration
  oracles.
- Keep public API small and capability-oriented.
- Keep `@ritojs/kit` and `@ritojs/react` thin over `@ritojs/core`.
- Use npm for JavaScript/Web distribution.
- Keep Rust `staticlib` / `cdylib` distribution possible for native consumers.

## Naming

Public package and API names must describe capability, not implementation
medium, migration history, or transport.

Use names from this vocabulary on stable surfaces:

- `core`
- `reader`
- `document`
- `revision`
- `frame`
- `resource`
- `controller`

Avoid public names that advertise:

- implementation language
- browser or platform target
- transport format
- migration status
- temporary crate or workspace names

Implementation-specific names may still appear in private crate names, build
scripts, target triples, generated output, and comments that explain the current
migration state. They should not leak into package names, app-facing classes, or
controller APIs.

## Product Shape

Keep the product model to two public concepts:

1. **Core**: `@ritojs/core`. It owns EPUB parsing, resource ownership,
   CSS/style, layout, pagination, display lists, interaction geometry, search,
   locators, document/revision/frame runtime state, generated browser bindings,
   resource transfer, and optional worker initialization.
2. **Reader UI packages**: `@ritojs/kit` and `@ritojs/react`. They own
   controller state and UI integration. They consume `@ritojs/core`; they do not
   carry Rust/WASM runtime adapters themselves.

Everything else is implementation detail.

Current workspace paths are allowed to be explicit because they are build
structure, not product names:

```text
crates/
  rito-core/          # Rust core
  rito-wasm/          # internal browser-target binding crate

packages/
  rito/               # stable package; Rust-backed implementation target
  rito-core-wasm/     # private WASM build and decoder workspace
  kit/
  react/
```

Do not put Rust source under `packages/rito/src`. Cargo and pnpm have different
build graphs, Rust needs native test binaries, and native Swift/Kotlin/Flutter
bindings should not inherit the JavaScript package layout.

## Package Model

The intended public package set should stay small:

```text
@ritojs/core      # stable core package; Rust replaces the TS implementation here
@ritojs/kit       # controller and UI orchestration
@ritojs/react     # React bindings
```

The browser-binding workspace package is private build tooling, not a future
public dependency. `@ritojs/core` consumes it only while building: the binding
and decoder modules are bundled and the generated `.wasm` is copied into the
public package artifact.

Rust crates can be published later only if real Rust-native consumers appear.
Until then, they remain workspace crates.

### Internal WASM Build Workspace

`packages/rito-core-wasm` is the JavaScript-facing build workspace for the Rust
browser binding. Its responsibilities are:

- build `crates/rito-wasm` for `wasm32-unknown-unknown`
- run `wasm-bindgen` and collect generated JavaScript, TypeScript, and `.wasm`
  artifacts
- hold the thin browser wrapper around the generated `RitoWasmDocument`
- hold the packed frame command-buffer decoder and its focused tests
- provide smoke/verify scripts for the Rust-backed reader runtime

It is not a product package. It must remain `private: true`, must not be
documented as a user dependency, and must not be imported by `@ritojs/kit`,
`@ritojs/react`, or apps. Only `@ritojs/core` internals and diagnostics may use
it.

The public release boundary is already complete:

1. `@ritojs/core` builds the real browser artifact through the private
   workspace.
2. `tsdown` bundles the private binding/decoder imports into the public core
   output.
3. The core build copies and validates `rito_wasm_bg.wasm` beside the public
   entry chunks.
4. Release pack checks reject private workspace runtime dependencies/imports,
   verify the WASM bytes, and smoke-test an isolated install and import.

Consolidating the workspace into `packages/rito` remains optional maintenance,
not a release-readiness gate. If it is done later, keep Rust source in `crates/`
and preserve the same build, artifact, and tarball invariants.

## Entry Point Strategy

The production reader API should come from the root package:

```ts
import { createReader } from '@ritojs/core';
```

React reader and kit must depend on the root `@ritojs/core` reader facade, not
legacy TypeScript package subpaths. The old TypeScript Canvas reader is now
source-only reference code for golden, diagnostic, and parity work.

Migration order:

1. Add the Rust-backed reader implementation behind `@ritojs/core` root exports.
2. Keep the old TypeScript implementation behind an internal `src/reference`
   facade for golden, diagnostic, and parity work. It is a reference oracle, not
   the production implementation.
3. Move `@ritojs/react` imports to the root `@ritojs/core` and `@ritojs/kit`.
4. Make `@ritojs/kit` consume the same small root reader capability surface.
5. Remove legacy package exports and keep the TypeScript implementation
   reachable only through source-level reference imports.

App-facing code must use root `@ritojs/core`; tests and diagnostics should
import the reference facade directly from source aliases.

Do not add Rust runtime adapters inside `apps/reader`. If the app needs special
loading behavior, expose it through `@ritojs/core` first.

## Core Reader Contract

`@ritojs/kit` should depend on `@ritojs/core` through a small reader capability
surface. The surface can be named `BrowserReader` internally if that keeps kit
code clear, but it is not a separate public package.

```text
BrowserReader
```

The contract should cover:

- open and close a publication
- create layout revisions
- keep the active frame usable while a new revision warms
- get spread frames
- navigate by locator and TOC
- prefetch nearby frames and resources
- search
- resolve selection, search, and annotation geometry
- read resource payloads
- expose metadata, TOC, and progression state

The contract is async-first. Current synchronous code can be wrapped internally,
but public controllers should not encode synchronous assumptions.

The Rust-backed implementation must enter at the `@ritojs/core` boundary.
Do not put Rust runtime adapters in the reader app.

## TypeScript Reader-Session Cleanup

The TypeScript `runtime/reader-session` experiment has been removed from
`@ritojs/core`. It was never public, was not consumed by the stable reader, and
the Flutter spike showed that continuing to harden a JavaScript-to-platform
message layer would not solve font, image, render parity, or lifecycle problems.

Keep the lessons, not the implementation:

- long-lived document sessions are useful;
- layout revisions need explicit IDs and stale-response gates;
- spread frames are a good consumption unit;
- debug/control views should stay JSON-dumpable for fixtures and diagnosis;
- resource bytes need explicit transfer ownership;
- unknown messages must be parsed before trusted runtime code.

Do not port the TypeScript command shapes line-for-line. Reintroduce
session/revision APIs only after Rust core models, layout, display lists, and
resource ownership are solid.

## Communication Strategy

Runtime communication is **binary-first**. JSON is a debug and migration format,
not the final internal runtime transport.

The boundary classes are:

1. **Public JavaScript API**
   - Exposes normal typed JavaScript objects so `@ritojs/kit`, React, tests, and
     applications stay ergonomic.
   - This API must not expose implementation names such as Rust, wasm, worker,
     or binary format versions.
2. **Debug, fixture, and golden output**
   - Keeps JSON dump paths even after binary APIs exist.
   - JSON remains the migration oracle because it is readable, diffable, and
     useful for parity diagnosis.
3. **Internal runtime transport**
   - Uses versioned binary payloads for hot and warm paths.
   - Rust owns the schema. TypeScript DTO declarations are generated from the
     Rust/schema source of truth, not hand-maintained.
   - JavaScript decodes lazily at the facade boundary instead of eagerly
     materializing full revision objects.

The migration may temporarily keep JSON string methods for control metadata, but
that is technical debt. New runtime features should not add new JSON-only hot
paths. Existing `*Json` wasm methods must be removed from performance-sensitive
flows in favor of generated typed bindings or binary payloads.

The preferred runtime shape is:

```text
DocumentHandle
  -> RevisionHandle
     -> FrameHandle
        -> PackedFrameCommandBuffer
        -> FrameStringTable
        -> FrameResourceTable
        -> ResourceTransferHandle
```

Keep fixture/replay JSON even after binary APIs exist. It is the migration
oracle and the easiest way to debug parity failures.

### Binary Wire V2 Requirements

The next wire-format milestone must replace JSON string transport on runtime hot
paths with versioned binary payloads:

- `RITOFCB2` remains the packed frame command buffer for display commands.
- Add a runtime bundle format, tentatively `RITORB1`, for revision/frame
  metadata that is currently moved through JSON strings.
- Bundle payloads must include magic, version, command/table counts, byte
  lengths, checksums or stable hashes for parity tests, and strict bounds checks.
- Use string, resource, page, target, and geometry side tables so repeated data
  is interned once per bundle.
- Use handles for document, revision, frame, and resource leases. Binary bytes
  are transferred explicitly and released explicitly.
- Keep a generated JSON dump path from the same Rust structs for fixtures and
  diagnostics; do not maintain separate JSON and binary source models.
- Add tests that assert the JSON fixture view and decoded binary view agree on
  command count, hashes, resource refs, page targets, and geometry metadata.

Exit criterion: normal reader open/reflow/frame/resource/search/geometry flows
do not require Rust-to-JavaScript JSON string serialization on the hot path.

## Current State

The current branch has the Rust-backed native baseline and its main parity path
in place:

- Rust workspace with `rito-core` and browser binding crates.
- Private binding workspace for generated browser bindings.
- EPUB ZIP loading, package/resource parsing, TOC parsing, XHTML parsing, CSS
  parsing, selector matching, style resolution, layout, pagination, spreads,
  display-list summaries, hit maps, text positions, link maps, and search flow.
- Runtime document handles, deterministic revisions, frame cache, resource
  lookup, transfer leases, locators, footnotes, text geometry, frame-resource
  prefetch, and search responses.
- Root `@ritojs/core` now exports a Rust-backed `createReader` path for the
  React reader stack. The previous TypeScript reader remains available only
  through the source-only `src/reference/index.ts` facade as the migration
  oracle.
- `@ritojs/kit` and `@ritojs/react` now consume the root `@ritojs/core` reader
  entry, with an architecture invariant preventing app-facing reader code from
  falling back to removed legacy core subpaths.
- Browser runtime reflow is split into an explicit pipeline: the reflow
  scheduler owns timing and queueing, the revision pipeline owns
  preview/full-revision commit, and browser resource code only applies
  Rust-owned frame-window results plus image/font decode lifecycle.
- Resize now treats high-frequency viewport changes as a hot runtime path:
  React state is no longer the resize delivery mechanism, preview revisions skip
  TOC target generation, and the commit frame buffer is bundled with preview
  revision responses to avoid a second worker round trip.
- Resize preview and canonical layout state are separate. Preview reflow only
  replaces the current visual frame and invalidates that spread's content slot;
  full revision commit remains the only path that updates `pages`, `spreads`,
  navigation, TOC targets, and `layoutCommitted`.
- Active resize previews are anchored by the current canonical page's progress
  within its chapter, so the bundled preview frame targets the same reading
  region instead of always rendering the chapter-window start.
- Mixed-content visual previews commit their frame before selected image bytes
  finish platform decode, then invalidate only if that exact preview remains
  active. Navigation, replacement, and disposal suppress stale completion;
  image-dominated previews retain their blocking first-paint behavior.
- Pinned Browser font registration now uses a revision-bound Rust manifest
  derived from the exact static, shapeable EPUB faces admitted to measurement
  and referenced by that layout. Font data may load in parallel, but the whole
  set is added to `document.fonts` atomically in Rust source order before the
  candidate revision commits; failure and staleness roll back. The browser
  shell no longer warms/probes frames or scans decoded display-list commands to
  infer font policy. Legacy readers keep the old best-effort declared-face
  loader; pinned readers never register manifest-external declarations.
- Layout image sizing, eager EPUB resource reads, and runtime resource transfer
  use one Rust href resolver. Exact raw source/key matches retain precedence;
  remaining matching removes URL query/fragment suffixes before canonical path
  lookup, then applies one percent-decoding pass symmetrically. Leading-relative
  exact paths beat longer suffix candidates, while canonical conflicts,
  malformed escapes, suffix slashes, and double encoding terminate safely.
- Safe canonical ZIP images that are absent or mislabeled in the OPF manifest
  are indexed as tolerant fallbacks. Production runtime open reads only central-
  directory metadata, while eager diagnostics load bytes immediately; manifest
  media types and hrefs win by resolved physical entry identity. Literal `%`,
  `?`, and `#` in fallback filenames are URL-escaped without losing the exact
  central-directory entry used for lazy reads.
- Rust package/layout parity matches the TypeScript fixture matrix for
  `book-01` through `book-10` across all 4 selected greedy/optimal viewport
  configurations.
- Runtime render-command exact-hash parity passes all 30 selected groups,
  covering 189 cases and 378 render summaries.
- Packed frame command buffer with a stable V2 manifest, command metadata,
  resource metadata, payload tables, and JavaScript decoder tests.
- The production browser Canvas path owns dispatch and state execution for all
  12 validated frame-command kinds in
  `src/bindings/browser/frame-command-renderer.ts`. The historical
  `canvasDisplayListRenderer` is no longer present in the production bundle;
  production helpers own rounded paths, image href resolution, block
  decoration, text/ruby painting, and runtime theme contrast resolution.
  Production/reference Canvas-record differentials cover block backgrounds,
  images, straight/uniform/split borders, shadows, layer ordering, and local
  state restoration on paint failures. Text/ruby differentials additionally
  cover fonts, spacing, theme colors, inline decoration, ruby measurement, and
  real Offscreen/DOM scratch-canvas shadow records. Semantic paint values retain
  their source precision until the packed-frame ABI conversion. Font-aware
  layout now respects declared family order, CSS style/weight face matching,
  reverse-source composite ordering, and cross-family glyph fallback. The
  exact-pixel gate exercises family and descriptor choices with real EPUB fonts
  and a nested resource image referenced through a percent-encoded href. Exact
  marker colors plus a same-basename decoy prove the selected bytes reached
  `drawImage`; focused unit tests protect composite order and cross-family
  fallback. It also uses a non-three-decimal block opacity to keep geometry-
  summary rounding out of that path. The built reader sourcemap
  contains no `src/reference/**` sources, and the public DTS is unchanged.
- Private `RITORB1` view-revision metadata with cross-language golden coverage,
  safe-integer/count validation, multi-mode JSON/binary agreement tests, a real
  WebWorker smoke, an opt-in ABBA reader-session harness, and wire-compatible
  primitive value reuse. Representative full revisions are now about 79% to
  81% of their JSON byte lengths. The A/B report now separates raw bytes, Rust
  encode, complete WASM method, JavaScript decode, worker processing, and worker
  round-trip time. The JavaScript decoder now computes the unchanged FNV-1a
  checksum with exact u32 lanes and avoids descriptors for ordinary object keys.
  The low-level V1 decoder exposes a generic recursive JSON payload, while the
  JSON/binary view adapters validate operation-specific discriminants and core
  structure before narrowing to the view-revision response. Generated package
  entries source both decoder signatures from the adjacent runtime declarations.
  The Rust encoder now writes its pre-sized string table directly into the final
  bundle allocation, removing a whole-section temporary without changing the
  checked V1 bytes. It also reuses one recursive container-index scratch buffer,
  consumes the normalized JSON tree, and gives each unique string one owner
  while restoring encounter order before output. The JavaScript decoder safely
  preallocates declared string/value/array tables only after count-range checks
  and continues to reject forward/self references.
  The repeated local evidence matrix found stable size savings but materially
  higher eager encode/decode elapsed cost, so JSON remains the default and the
  current decision remains no-go after the first materialization pass. A second
  machine class is still required before any reconsideration.
- Reader-private full chapter-text transport deduplication on both JSON and
  `RITORB1`. Each Reader/publication inlines the document-stable entries once,
  shares them across its foreground/full-reflow clients, and sends a scoped
  reference on later full revisions. Preview responses remain inline, the
  facade returns a fresh copy of the original revision-scoped shape, and the
  generic V1 wire/golden remains unchanged.
- Generated browser binding smoke path that opens a fixture book, creates a
  revision, reads a frame, queries targets/search, and reads/releases a resource
  transfer.

This is the production core baseline, though display parity and runtime/wire
hardening remain active work. The old TypeScript implementation is physically
quarantined under `src/reference/ts-core`, and the public package artifact no
longer has a runtime dependency on the private WASM workspace. The remaining
production browser binding has no direct reference edge. Frame-command
execution, rounded paths, image href resolution, block decoration, and
text/ruby painting are production-owned; the TypeScript reference renderer is
source-only parity and diagnostic code. A focused Playwright differential now
loads the published production build and the reference reader in the same
Chromium process, waits for the production full revision and frame, and requires
exact pixels for representative Canvas paint features.

Current source ownership is:

- `src/reader/` is the small public reader facade and type surface.
- `src/bindings/browser/reader/` is below its guarded shell budget. It owns
  browser worker setup, request correlation, resource decoding, Canvas
  presentation, and the minimum platform scheduling needed to apply Rust-owned
  view revisions. Frame/resource warm planning is Rust-owned and exposed as a
  single worker boundary call; the browser shell only decodes/caches browser
  frames and image resources.
- Browser-binding imports of old TypeScript parser/layout/render/runtime
  contracts are now zero and guarded as such. The 12-kind command dispatcher,
  Canvas state machine, rounded-path helper, image href resolver, block
  decoration, text/ruby renderer, and runtime theme-color adapter all live under
  the production browser binding.
- `src/reader/types.ts` owns the root reader's structural public types. The
  browser binding no longer imports Reader API shapes from the TypeScript
  reference tree, and no production browser-binding bridge to TS reference
  render code remains.
- `src/reader/layout-config.ts` owns the lightweight root `createLayoutConfig`
  helper used by kit. The root package no longer needs the legacy TS layout
  config factory for this public reader contract.
- `src/reference/ts-core/` now physically contains the old TypeScript core
  implementation. `src/reference/index.ts` is the canonical reference facade for
  parity/golden/diagnostic consumers.
- Root `src/parser`, `src/style`, `src/layout`, `src/render`, `src/runtime`,
  `src/interaction`, `src/dom`, `src/model`, and `src/utils` have been removed
  as implementation roots. Compatibility entries and tests now point at
  `src/reference/ts-core/**` explicitly.
- The root package no longer exports old TS primitive APIs or compatibility
  subpaths. Legacy parser, layout, render, runtime, and interaction helpers are
  source-only under `src/reference/**`; kit-owned interaction helpers live under
  `packages/kit/src/interaction/**`.

## Remaining Gaps

These are the real gaps against this plan:

1. **Reference quarantine maintenance**
   - The old TypeScript core is physically quarantined under
     `src/reference/ts-core/**` and guarded by architecture invariants.
   - Keep reference imports convenient for fixture generation, golden
     comparison, and diagnostics through `src/reference/index.ts`.
   - Keep compatibility source files for diagnostics only; do not publish them
     as package subpaths.
   - Production source must not import `src/reference/**`. Command dispatch,
     Canvas state, transforms, clipping, rounded paths, image href resolution,
     block/text/ruby painting, page/image/HR painting, theme contrast, and
     pixel-ratio scaling are production-owned. Keep the old renderer runnable
     only as a source-level parity and diagnostic oracle.
2. **Core parity hardening**
   - Continue tightening the CSS subset already supported by the TS core.
   - Continue line-breaking and typography policy hardening.
   - Keep font-aware shaping opt-in until fallback policy is stable.
   - Keep exact display-list parity as the main render contract gate.
3. **Runtime and binding hardening**
   - Keep revision/frame/resource lifecycle tests strict.
   - Continue moving preview, full reflow, active frame, and frame-cache policy
     from the browser shell into Rust-owned runtime APIs.
   - Keep frame/resource warm policy behind the Rust-owned warm-window API; the
     browser shell should only perform platform-specific command-buffer decode,
     Canvas-frame cache, and image decoding/cache work.
   - Keep resource transfer leases independent so duplicate consumers do not
     invalidate one another.
   - Keep JSON frame output and packed frame output sourced from the same
     typed display-list commands. Rust revision-cache entries serving the
     production reader retain only the packed owner; compatibility `getFrame`
     reads materialize and retain the exact JSON projection on first demand. Do
     not reconstruct that projection from lossy packed records.
   - The reader cache currently removes repeated serialization and cross-worker
     delivery of full chapter-text entries. Full revision records now use a
     document-owned lazy scope, so a reader cache hit also skips Rust index
     construction and cloning while explicit revision reads materialize on
     demand. Preview/window revisions keep their own scoped snapshots. The
     first inline full response still materializes and copies the map; optimize
     that only if a measured case justifies more ownership complexity.
   - Keep `RITORB1` opt-in. The local decode/ABBA evidence is an explicit no-go
     for a default switch: bytes are smaller, but eager encode/decode costs are
     materially higher. The first scratch/string-owner/preallocation pass did
     not reverse that result; repeat the matrix on another machine class and do
     not extend the wire to search/geometry until the view-revision slice earns
     a default decision.
4. **Binary render path**
   - Current packed buffers are a V2 ABI, not the final renderer-ready contract.
   - V3 should reduce per-command object allocation and make renderers consume
     typed numeric/string/resource tables directly.
5. **Core package wiring**
   - The private binding workspace is a build-time input behind `@ritojs/core`;
     its modules and WASM artifact are bundled into the public tarball with no
     private runtime dependency.
   - The Rust-backed `createReader` is now exported from the root package.
   - Keep the release pack and isolated-install checks green as bindings evolve.
   - Keep legacy TypeScript compatibility code source-only, not package API.
   - Finish typed declarations around revisions, frames, command buffers,
     resources, search, locators, geometry, and errors.
   - Verify Vite, Next/basic ESM, worker loading, transfer reads/releases, and
     generated artifact freshness.
6. **Kit integration**
   - Make kit consume the small `@ritojs/core` reader capability surface.
   - React reader imports root `@ritojs/core` and kit-owned interaction types.
   - Run controller behavior tests against the Rust-backed `@ritojs/core` path.
   - Keep React thin over kit.

Not in this plan:

- full browser CSSOM;
- a complete browser layout subsystem;
- more Flutter app scaffolding;
- public exposure of temporary runtime/session command shapes;
- platform UI design.

## Phases

### 1. Reference Lock

Keep the TypeScript implementation and fixtures as the oracle. Do not expand app
UI or platform message layers while core parity is being established.

Exit criterion: fixture and render-command generation are stable, documented,
and checked in CI.

The previous two-step reference layout is no longer strict enough. Keeping
parser/layout/render/runtime primitives in root `src/` makes the old TS core
look like production code and makes accidental imports too easy.

The corrected reference layout is:

```text
packages/rito/src/
  index.ts                 # production package facade
  reader/                  # small public reader contract/facade
  bindings/                # browser/platform package shell
    browser/reader/
  compatibility/           # temporary public/subpath compatibility facades
  reference/               # old TS implementation and diagnostic oracle
    ts-core/
      parser/
      style/
      layout/
      render/
      runtime/
      interaction/
      dom/
      web/
      utils/
    index.ts
```

The physical move should happen in one dedicated source-layout change, with
import rewrites and invariants updated in the same change. The old TypeScript
core must not be deleted yet; it remains the parity oracle. It must, however,
be named and located as reference code, not as the production implementation.

Compatibility rules:

- `src/index.ts` should expose the Rust-backed production reader surface and
  lightweight reader-facing structural helpers only.
- `src/compatibility/**` may re-export old TS primitives for source-level
  diagnostics, but it must not become a package export.
- `src/bindings/**` must not import `src/reference/**`.
  `src/bindings/browser/frame-command-renderer.ts` must remain reference-free.
- `@ritojs/kit`, `@ritojs/react`, and apps must not import `src/reference/**` or
  removed legacy core subpaths for the main reader API.
- Golden, fixture, diagnostic, and parity tools should import the reference
  implementation through `src/reference/index.ts` or explicit source aliases,
  not through production package entries.

### 2. Rust Core

Port the core capability set in layers:

- EPUB and resource model
- XHTML source tree
- CSS/style/cascade subset supported by the current implementation
- layout, typography, pagination, spreads
- display-list generation
- hit maps, text positions, selection/search/annotation/locator primitives

Exit criterion: Rust fixture and render-command parity pass for the selected
matrix, and remaining differences are documented as intentional.

### 3. Runtime

Add Rust-owned document handles, layout revisions, frame cache, resource refs,
transfer leases, locator/search/footnote/geometry APIs, and packed frame buffers
over proven core primitives.

Exit criterion: JavaScript can open a publication, create a revision, request a
frame, search, resolve geometry, and fetch resources without embedding bytes in
JSON control payloads.

### 4. Core Package Wiring

Ship the Rust-backed implementation through `@ritojs/core`.

Exit criterion: typed package surface, generated artifact freshness, browser
loading, worker loading, transfer reads/releases, and packed-buffer decoding are
verified.

### 5. Kit Integration

Make `@ritojs/kit` consume the core reader capability surface. Keep React thin
over kit.

Exit criterion: existing reader flows pass through the core reader contract, and
tests exercise the Rust-backed `@ritojs/core` path in the reader stack.

## Active Usability Execution Plan

The next milestone is not more broad display or wire work. Execute the active
roadmap in this order:

1. define cross-Worker revision identity, partial extent, source locators and
   the incremental continuation contract;
2. implement bounded, resumable pagination inside the Rust layout/runtime
   session, including large single-XHTML publications;
3. expose current-visible-spread link, image and footnote targets through WASM,
   Worker and the public Reader;
4. add precise native point/range geometry, then migrate Kit selection,
   highlights, annotations, positions and accessibility; **the version-gated
   Rust core, WASM/Worker transport, opaque Browser Reader point/document-order
   capability, and Kit exact selection/highlight/copy/source-annotation target
   creation plus revision-safe native annotation re-projection are implemented;
   reading positions, accessibility, and cross-logical-flow ranges are implemented;**
5. reduce the browser shell to core-requested host operations;
6. pass the real-book usability and stage-specific performance gate;
7. build the controlled WebView/DOM harness and deliberately transition the
   rendering baseline.

See
[`native-core-usability-roadmap.md`](./native-core-usability-roadmap.md) for the
acceptance criteria and deferred work.

## Historical Migration Execution Record

The React reader now runs through Rust-backed root `@ritojs/core`, and the
source-layout reset is complete. Current work should preserve that baseline
The checklist below records the migration work that established it. Any older
display-parity or binary-wire priority in this record is superseded by the
active usability roadmap.

1. **Quarantine the old TypeScript core - done, still reducing shims**
   - Browser binding guardrails prohibit all imports from `src/reference/**`.
     Production command execution and its path/image/block/text/theme helpers
     must remain reference-free.
   - The old TS implementation now lives under `src/reference/ts-core/**`:
     parser, style, layout, render, runtime, interaction, dom/web helpers, and
     supporting utilities/models.
   - Keep `src/reference/index.ts` as the only canonical source entry for
     parity/golden/diagnostic consumers.
   - Do not delete old TS code in this step. It is still needed to compare Rust
     display details and fixture behavior.
   - Root old-core directories are no longer kept as generated shims; test and
     diagnostic imports were retargeted to `src/reference/ts-core/**`.
   - Do not let reference imports leak through production package entries. The
     historical display-list dispatcher and all temporary paint, path, image,
     and text/ruby hooks are absent from the production build graph.
2. **Tighten public and compatibility entries**
   - Keep root `@ritojs/core` focused on the Rust-backed reader and the small
     public capability surface.
   - Legacy subpath/top-level implementation files have been removed from
     `src/`. The source-only compatibility/reference code lives under
     `src/compatibility/**` and `src/reference/**` for golden/parity tooling.
   - Root legacy primitive exports have been removed from `src/index.ts`.
     Legacy TypeScript primitives are not package exports.
   - Do not add `@ritojs/core/web`, `@ritojs/core/advanced`, or focused legacy
     subpaths back to `package.json`.
   - Add package/public-entry invariants that fail if a stable entry imports
     `src/reference/**` except through explicitly named compatibility files.
3. **Keep the browser binding thin**
   - `src/bindings/browser/reader/**` may keep browser-specific shell work:
     WASM loading, worker setup, request correlation, Canvas presentation,
     ImageBitmap/object URL/FontFace lifecycle, and conversion to the existing
     `Reader` contract.
   - Browser binding files must not consume the historical TS display-list
     renderer or any other reference implementation module.
   - It should not grow new core policy. Preview/full revision scheduling,
     active frame policy, frame-cache policy, and resource warm decisions should
     continue moving into Rust runtime APIs.
   - The next Rust downshift target after the source-layout reset is the reflow
     pipeline: Rust should own the preview/full revision plan and return
     explicit work items for frame/resource presentation.
   - Deferred preview responses now include a complete Rust-authored full view
     request. The browser timer consumes that request directly, overriding only
     the live active spread and removing cross-Worker revision ids. The private
     reader client validates that the request preserves the preview layout and
     line-breaking semantics before it can reach browser commit state.
   - Revision bundle creation has moved into `rito-core`: preview/full
     creation fields, TOC inclusion, initial-frame decision, and
     revision-scoped metadata are core runtime semantics. The wasm layer only
     parses JSON, releases previous transfer leases, and creates resource
     transfer payloads for the selected initial frame.
   - The old generic Rust `RuntimeRevisionBundleRequest` entrypoint has been
     removed. Runtime callers can no longer assemble arbitrary preview
     limit/window/TOC/initial-frame policy through one public request type; they
     must use the dedicated initial-preview, active-preview, or full-revision
     bundle APIs.
   - Prefix/window revision creation remains an internal runtime implementation
     detail for those bundle APIs and parity tests, not a public runtime
     surface.
   - Standalone Rust navigation/TOC helper methods are no longer public
     `RuntimeDocument` methods. External Rust parity callers read those values
     through `revision_bundle()` so there is one revision metadata source of
     truth.
   - Preview/window revision bundles must not force full-document preparation.
     Footnotes and chapter text indices are stored on the revision record at
     creation time and read back from that record.
   - Full reader revisions use a publication-scoped private transport cache for
     document-stable chapter text indices. Cache identity is committed only
     after document open succeeds; scope/reference validation failures release
     the newly created revision, and public callers always receive fresh
     hydrated entries rather than the mutable cached object.
   - Active resize preview is now a single worker/core operation from the
     browser binding's perspective. The binding passes the canonical layout,
     previous revision, and active spread; the worker asks Rust for the active
     chapter/progress and creates the chapter-window revision in one path. This
     removes the old browser-side two-step preview policy and one worker
     roundtrip.
   - The browser binding no longer pre-screens active-preview eligibility using
     publication chapter counts. It asks the Rust runtime for an active preview
     when a previous revision exists, and Rust decides whether one is available.
   - The standalone browser-worker `activeChapterPreview` command has been
     removed. Active-chapter lookup is no longer a caller-visible worker API;
     it is an internal part of active preview revision creation.
   - Initial preview revision creation is also a core runtime operation. The
     browser binding no longer owns the preview chapter-limit constant or builds
     the preview bundle request by hand.
   - The generic browser-worker `createRevision` request is now full-revision
     only. Preview chapter limits, preview chapter indexes, TOC inclusion, and
     initial-frame policy are no longer caller-settable browser-worker fields;
     those choices live in dedicated Rust runtime bundle APIs.
   - Full revision creation now also uses the Rust-owned revision bundle path.
     The browser binding passes only the current active spread as reader
     context; Rust clamps that spread to the new revision, chooses the initial
     frame, and returns frame/resource payloads with the revision bundle.
   - The browser/WASM binding no longer exposes generic `createRevisionBundle`,
     standalone `revisionBundle`, standalone `tocTargets`, standalone
     `activeChapterPreview`, or standalone `initialFrameDecision` APIs. Those
     are Rust runtime internals behind dedicated initial-preview,
     active-preview, and full-revision bundle calls.
   - The binding also no longer exposes legacy `createRevision` +
     `revisionNavigation` sequencing. A browser caller creates a Rust revision
     through the bundle APIs and receives navigation/TOC/interaction metadata in
     the same response.
   - Nearby frame resource warming now uses a Rust runtime plan. Browser code
     still decodes ImageBitmap/ObjectURL resources, but it asks Rust which
     spread indexes to warm instead of owning priority offsets locally.
4. **Core root reader wiring - done**
   - Internal Rust-backed reader implementation lives under `packages/rito/src`.
   - `createReader`, `Reader`, and `ReaderOptions` are available from
     `@ritojs/core` root.
   - Root reader loading uses the runtime/decoder boundary and lets the worker
     client choose execution mode; it must not force full WASM initialization on
     the UI thread before worker selection.
   - The internal binding workspace remains private and build-time-only; its
     output is bundled into `@ritojs/core`.
   - The TypeScript reader is preserved through `src/reference/index.ts` for
     reference use only. It is not a package subpath.
   - Source-only reference imports go through `src/reference/index.ts`; no
     public `@ritojs/core/reference` subpath is exported.
5. **Minimum render path - done, still hardening**
   - EPUB bytes open through Rust.
   - Layout revisions are created from existing `ReaderOptions`.
   - Validated Rust frame-command buffers are executed by the production-owned
     browser Canvas command executor. Production helpers own rounded paths,
     image href resolution, block decoration, text/ruby painting, and runtime
     theme contrast. Reference code is not part of the production render graph.
   - Image resources use Rust transfer leases and are prewarmed best-effort.
   - Browser font registration uses Rust `@font-face` summaries.

- Reflow queueing and revision commit are explicit pipeline stages. Frame
  resource warm policy stays behind the Rust warm-window API; browser code
  only applies returned buffers/resources and performs platform decode.
- Reflow failures are recorded and logged instead of being silently swallowed;
  initial open fails if no visible revision can be produced.
- Preview resize commits carry their first frame in the revision response;
  later random frame reads still use the normal frame API.
- Preview resize no longer commits a chapter-window revision as the reader's
  canonical revision; it is a visual current-frame override until the deferred
  full revision lands.
- Preview resize requests pass chapter progress to the worker, which chooses
  the bundled preview frame after creating the window revision.
- Runtime revision records now retain the interaction metadata that belongs
  to the prepared document used for that revision. This keeps preview
  revisions cheap and prevents later bundle reads from accidentally walking
  the full publication.
- The initial preview chapter limit is owned by Rust runtime. Browser code
  only forwards layout and line-breaking choices and consumes the returned
  bundle/frame/resource payloads.
- The committed revision frame is selected by Rust and exposed as
  `frameSelection`. Browser code no longer infers the commit/display spread
  from the returned warm-window plan or assumes spread `0`.
- Full initial-frame selection is owned by Rust runtime. Browser code no
  longer clamps the committed spread index; it forwards active spread context
  and commits the initial frame selected by the runtime bundle.
- Preview revision creation is now a single Rust-owned API. Browser worker
  protocol no longer has separate initial-preview and active-chapter-preview
  commands; it forwards optional previous-revision/active-spread context and
  consumes the preview bundle selected by Rust.

6. **Minimum interaction compatibility - ongoing**
   - Provide pages/spreads/chapter map/TOC enough for current kit navigation.
   - Keep search, annotations, and selection either backed by Rust APIs or
     explicitly compatibility-limited until the kit contract is narrowed.
   - Do not fake successful behavior where geometry is not available.
   - Exact Rust point-to-caret and document-order range resolution across retained
     logical flows now rejects chapter boundaries plus host-shaped,
     source-unavailable and transform-unsupported runs instead of interpolating
     them. Its strict WASM/Worker transport and revision-bound
     Browser Reader capability are implemented. Kit uses that capability
     authoritatively with async cancellation and source-range annotations;
     Readers without it retain the legacy selection engine.
7. **React reader switch - done**
   - `@ritojs/react` imports root `@ritojs/core`.
   - `@ritojs/kit` consumes the same root reader surface.
   - The existing reader app builds against the Rust-backed root API.
8. **Subpath cleanup - done**
   - `@ritojs/core` package exports are limited to the root entry and
     `./package.json`.
   - Removed legacy source-level subpath shims from `src/`.
   - `@ritojs/kit` owns controller-level selection/search/annotation/position,
     hit-map, a11y, and DOM interaction helpers.
   - React and app code import `@ritojs/core` root plus `@ritojs/kit`; they do
     not import legacy core subpaths.
   - Architecture invariants fail if app-facing reader code imports
     `@ritojs/core/web`, `@ritojs/core/advanced`, `@ritojs/core/selection`, or
     related legacy subpaths.

## Verification Gates

Use focused gates during normal rounds:

```text
pnpm run rust:parity:fast
pnpm --filter @ritojs/core-wasm run test
pnpm --filter @ritojs/core-wasm run typecheck
RITO_READER_PROFILE_EPUB=/absolute/path/book.epub pnpm test:e2e:load-profile
```

Use milestone gates before claiming parity or release readiness:

```text
pnpm run rust:parity:full
pnpm run rust:wasm:verify
pnpm lint
pnpm --filter @ritojs/core run typecheck
pnpm --filter @ritojs/core run build
```

`rust:parity:full` includes the ignored 10-book × 4-config package/layout
fixture matrix and the ignored 30-group exhaustive runtime render-command
matrix. Ordinary `cargo test` does not run either milestone suite.

Do not expand the fixture book matrix casually. Add fixtures only when a new
class of TS behavior needs coverage.

## Open Decisions

- Final font fallback and shaping policy.
- Whether Rust stops at display-list generation or also owns final pixel
  painting for selected platforms.
- Which session/revision lessons become public API and which stay internal.

## Cleanup Gate Before More Display Work

The Rust-backed reader now runs through the React reader stack, but the
implementation must be cleaned up before more visual correctness work is added.
This is not optional polish: the current branch already has enough runtime,
worker, preview, and resource scheduling code that continuing to patch display
bugs directly would make the migration harder to reason about.

Required cleanup:

1. **Rust module boundaries**
   - Split `crates/rito-core/src/runtime.rs` into smaller runtime modules for
     document/revision/frame/resources/navigation/search/interaction. Revision
     creation and frame-cache operations are now split out of the root runtime
     file; `runtime.rs` is back under the soft file-size limit.
   - Split `crates/rito-core/src/render.rs` so display command modeling,
     packed command-buffer encoding, hashing, and resource-ref summaries are not
     maintained in one file. This is now split under `render/commands/`.
   - Split EPUB preparation/layout bridge helpers out of
     `crates/rito-core/src/epub.rs`. The root module now holds public package
     models and re-exports; document opening, prepared source data, font-aware
     measurement setup, path helpers, and layout bridging are separate modules.
   - Keep production code free of state-invariant `expect(...)` calls where a
     structured core error can be returned.
2. **TypeScript source ownership**
   - The old TS core now lives in one reference tree instead of root package
     source. The former root `src/parser`, `src/style`, `src/layout`,
     `src/render`, `src/runtime`, `src/interaction`, `src/dom`, `src/model`, and
     `src/utils` directories were historical implementation locations and are
     no longer present.
   - The reference tree remains available for fixture generation, golden
     comparison, and diagnostics.
   - Add invariants that prohibit `src/reader/**`, `@ritojs/kit`,
     `@ritojs/react`, apps, and all browser binding files from importing
     `src/reference/**`; keep the complete production Canvas graph
     reference-free.
   - Add invariants that force any stable package entry using the old TS core to
     go through `src/compatibility/**`, so compatibility debt is visible and
     removable.
3. **TypeScript browser glue naming**
   - Do not keep browser host implementation files under `src/reader/`. That
     directory is now limited to the public reader contract and facade:
     `create-reader.ts`, `index.ts`, `instance.ts`, `layout-config.ts`,
     `model.ts`, and `types.ts`.
   - `src/reader/types.ts` owns its public reader shape directly. It must not
     import `src/reference/**`; the old TS core is allowed to influence
     compatibility code and parity tests, not the production reader contract.
   - Reader API structural types used by the browser binding come from
     `src/reader/types.ts`, not from the old TS reference tree. No reference
     import remains in the production browser binding.
   - Root `@ritojs/core` exports the reader-facing structural types and
     `createLayoutConfig` from `src/reader/**`. Kit may still call legacy
     interaction helpers from compatibility subpaths, but those casts must stay
     explicit and centralized instead of leaking old layout node types into the
     root reader contract.
   - The current browser host shell lives under
     `src/bindings/browser/reader/` to make its platform/binding role explicit
     while Rust runtime ownership continues to move down into `crates/`.
   - Do not keep a long-lived pile of implementation-specific files behind the
     public `@ritojs/core` root export.
   - Keep implementation-language names out of app-facing and package-facing
     APIs. Private build artifacts may still mention Rust/WASM when they refer
     to actual target artifacts.
   - Browser reader binding methods are split by capability under
     `bindings/browser/reader/methods/` instead of keeping
     render/layout/navigation/search/resource/lifecycle behavior in one adapter
     file.
   - Browser reader pipeline code is grouped under
     `bindings/browser/reader/pipeline/` instead of leaving reflow,
     revision-commit, revision-worker, and visual-preview files in the binding
     root.
   - Browser reader state construction and state-specific types are grouped
     under `bindings/browser/reader/state/`; the shared `types.ts` file should
     stay focused on worker/WASM/frame boundary types.
   - Browser reader frame-window application lives under
     `bindings/browser/reader/frame-cache.ts`, separate from layout option
     construction. It applies Rust-returned frame command buffers and spread
     resource bytes; it does not choose nearby spread offsets itself.
   - Browser reader image/font resource code lives under
     `bindings/browser/reader/resources/` and is limited to platform decode,
     registration, object URL, and lifecycle concerns.
   - Browser reader navigation projection lives under
     `bindings/browser/reader/navigation-model.ts`, so the compatibility Page /
     Spread shape is isolated from layout config and revision commit code.
   - Browser reader facade assembly is split from accessor definition:
     `reader.ts` should remain the create/open/bootstrap path, while
     `reader-accessors.ts` owns property accessors over committed state.
   - Private `@ritojs/core-wasm` imports are centralized behind
     `bindings/browser/reader/core-contracts.ts` and
     `bindings/browser/reader/wasm-module.ts`; other browser binding files
     consume local core contracts only.
   - Browser worker client code is split into worker creation, request
     correlation, payload validation, and method adapters; the top-level file is
     now only the factory.
   - The shared request-to-client method adapter is split under
     `bindings/browser/reader/worker-client-adapter/` by lifecycle, revision,
     frame, resource, and interaction capability. The root adapter file should
     only compose those pieces.
   - Worker protocol definitions are split under
     `bindings/browser/reader/worker-protocol/` into message payload types and
     the client interface; the root `worker-protocol.ts` should stay a re-export
     surface.
   - Browser worker and in-process fallback share the same request-to-client
     method adapter. The in-process fallback now only provides a local request
     boundary and module initializer; it no longer duplicates revision/frame/
     resource/search method logic.
   - The old TypeScript reader and old TypeScript core should be reachable
     through `src/reference/index.ts` for parity and diagnostic use. Production
     reader binding files and app-facing packages must not import it.
4. **Runtime state machine**
   - Keep preview reflow, full revision commit, frame cache, and resource warm
     as explicit pipeline stages.
   - Centralize lifecycle invariants so resize, navigation, and dispose do not
     depend on scattered flag checks.
   - Reflow scheduling helpers now live outside the main reflow orchestration
     file, so timer/microtask cleanup can be reused by lifecycle disposal.
   - Deferred full-revision commit and reflow error normalization are split out
     of the main reflow scheduler. `pipeline/reflow.ts` should stay focused on
     request queueing and choosing preview/full revision paths.
   - Browser reader state construction is split into grouped worker, layout,
     revision, resource, listener, and reflow initializers; `state.ts` remains a
     thin factory instead of owning every runtime field directly.
   - Worker script code is split into message boundary, document session
     dispatch, per-operation frame/revision/resource/locator helpers, response
     transfer selection, and error normalization. Source builds and published
     packages share the static `worker-entry.mjs` URL; `worker-main.ts` is the
     typed package-build entry and delegates startup to `worker-bootstrap.ts`.
   - Runtime navigation decisions that affect reader correctness now come from
     Rust: spread slots, active resize-preview chapter/progress, and flattened
     resolvable TOC targets are produced by `RuntimeDocument` and passed through
     the WASM boundary.
   - Revision metadata commit data is exposed as one Rust-owned revision bundle
     instead of being assembled by the browser worker from separate
     navigation/interaction/source-index calls.
   - Revision creation for the browser binding now goes through a single
     Rust/WASM creation result: Rust creates the revision, returns the revision
     bundle, decides the initial frame from explicit spread/progression input,
     decides the display spread slot for preview presentation, returns an
     initial frame window with packed command buffers plus resource transfer
     bytes, marks preview state, and releases previous revision transfer leases.
     The browser shell commits the Rust-selected frame/window and only performs
     platform image/font registration.
   - Frame resource warm policy no longer scans decoded commands in TypeScript:
     Rust frame metadata marks image-dominated frames, and the browser shell
     only performs the platform-specific byte transfer and image decoding.
     Initial and navigation warming both ask Rust for the revision-scoped warm
     window instead of hard-coding browser-side neighbor spreads. The browser
     worker now batches the warm-window lookup, frame command-buffer reads, and
     spread resource transfer reads into one response so navigation warmup does
     not fan out into render-miss frame reads or one resource request per spread.
     The older browser-worker `readFrameResources` and direct single-frame
     command-buffer commands have been removed; render misses now ask for the
     same Rust-owned frame window rather than TypeScript-owned per-spread or
     per-frame lookup paths.
     Direct WASM/browser entrypoints for standalone frame-resource warm plans
     and single-frame resource prefetch have also been removed. Browser code
     consumes the planned warm-window response as the one resource-warm
     boundary.
   - Revision commit no longer performs a browser-side warm fallback when the
     selected frame/window is missing. The browser shell commits only the
     Rust-selected revision bundle frame/window; missing data is a contract
     failure, not a cue to make a new browser-side runtime decision.
   - Browser worker revision responses carry the Rust `RevisionBundle` as one
     bundle field. They no longer duplicate `revision`, `navigation`,
     `tocTargets`, `footnotes`, or `chapterTextIndices` as browser-owned
     protocol fields; the browser shell only projects the bundle into the
     existing `Reader` compatibility state.
   - Browser reader state now keeps the committed Rust `RevisionBundle` as the
     single revision/navigation source. Page, spread, footnote, TOC, and
     chapter-text maps remain compatibility projections for the current
     TypeScript `Reader` interface.
   - The generic WASM `prefetchFrames` wrapper has been removed. Browser code
     uses the Rust-owned planned frame window API for both frame bytes and
     resource transfer payloads.
   - WASM revision bundle responses no longer expose a legacy standalone
     `initialFrame` decision or ad hoc top-level `displaySpreadIndex`. The
     Rust-selected commit/display target is represented by `frameSelection`,
     and `initialFrameWindow` carries the matching packed buffers/resource
     payloads. Browser code validates and commits that Rust selection instead
     of deriving it from warm-window fields.
   - Internally, Rust stores the display spread on `RuntimeInitialFrameDecision`
     itself. WASM does not receive a second ad hoc display-spread override when
     building the initial frame window.
   - The unused browser-worker `warmup` command has been removed. Runtime
     loading is expressed by the package loader, and document work begins at
     `open`; there is no separate worker protocol branch with no reader state.
   - Font fallback policy no longer probes frame windows in TypeScript. Pinned
     Rust revision bundles report the eligible EPUB faces whose families occur
     in text/ruby paint, and the browser shell only executes their
     revision-bound, fingerprint-verified `FontFace` readiness transaction.
   - Rust runtime and WASM boundary tests keep shared fixture builders and
     render-hash normalization helpers in focused test modules, so production
     assertions are not buried under fixture setup.
5. **Compatibility stubs**
   - Do not return fake success for unsupported reader capabilities. Either wire
     them to Rust APIs or make the limitation explicit.
   - `Reader.getFootnotes()` is now wired from Rust revision-scoped interaction
     data through the WASM wrapper and browser reader commit path.
   - `Reader.getChapterTextIndices()` is now wired from Rust revision-scoped
     source-index data through the WASM wrapper and browser reader commit path.
6. **WASM wrapper source of truth**
   - Avoid maintaining decoder/runtime code twice between
     `packages/rito-core-wasm/src/index.ts` and generated dist snippets.
     The frame command-buffer decoder runtime now lives in
     focused `src/frame-command-buffer-decoder-*.js` modules, and build scripts
     copy those implementations into dist instead of string-generating a second
     copy. Error normalization runtime is also sourced from
     `src/core-wasm-error-runtime.js`, and the generated document wrapper is
     sourced from `src/core-wasm-document-runtime.js`; TypeScript wrapper types
     are sourced from the focused files under `src/types/`, leaving
     `src/index.ts` as a thin export surface.
   - The Rust `rito-wasm` crate is split into a thin crate entry, document
     facade, per-operation revision/frame/interaction/resource modules,
     generated binding adapter, structured error model, JSON wire
     parsing/serialization, and tests instead of keeping all boundary code in
     `lib.rs`.
   - Keep command-buffer JSON fixture output and packed-buffer output sourced
     from the same typed command list.
   - Display commands now use a typed Rust enum internally; JSON fixtures and
     packed command buffers are derived from that same typed command list.
7. **Resource ownership**
   - One shared ambiguity-aware resource href resolver now feeds layout image
     dimensions, eager document lookup, and runtime transfer metadata/bytes, so
     a frame that sizes an encoded or rooted image path can also warm and paint
     the same resource.
   - Archive-image fallback discovery scans safe canonical central-directory
     entries without decompressing them. Unreferenced fallback images remain
     metadata-only in runtime documents; referenced images reuse the existing
     lazy dimension, byte-cache, transfer-lease, and browser decode path. URL-
     reserved physical filenames retain an entry-identity map, so encoded
     logical hrefs cannot redirect lazy reads to a percent-looking decoy.
   - Runtime image/font bytes now become document-owned lazy cache entries after
     first read; image bytes read for dimension detection are retained too, so
     resource lookup does not re-open the EPUB archive for the same binary.
   - Cached image dimension probes now borrow the retained byte slice without
     reopening the archive or cloning the image buffer. Runtime resource reads
     snapshot only small binary metadata before the mutable lazy-cache access,
     instead of cloning the cached resource payload.
   - Production Worker delivery consumes resource transfer leases atomically,
     moving the stored Rust byte vector into the WASM return ABI instead of
     cloning it first. Non-consuming read/release methods remain available for
     compatibility and diagnostics.
   - Font-aware revision creation batches lazy font loading through one archive
     reader before layout, instead of reopening the EPUB once per font.
   - Chapter image-reference discovery is cached per loaded chapter, and
     same-window image dimension loading reuses one archive reader.
   - Chapter range loading reuses one archive reader across the requested range
     instead of reopening the EPUB once per chapter.
   - Browser platform resource handling remains in
     `bindings/browser/resources.ts`; the counted reader shell only requests
     decode/cache work and applies lifecycle-safe invalidations.

After this cleanup gate, display correctness work can resume with less risk of
building on accidental architecture.
