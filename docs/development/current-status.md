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
- The production Browser Reader now uses the bounded core/WASM/Worker session.
  The legacy `createViewRevision` preview/deferred-full scheduler has been
  removed rather than retained as a second state machine. As measured on
  2026-07-13, `packages/rito/src/bindings/browser/reader/**` contains 20
  TypeScript files / 2399 physical lines, plus the static `.mjs` worker-entry
  facade; `packages/rito/src/reader/**` contains 5 files / 637 physical lines.
  This is above the original thin-shell target because exact interaction,
  bounded candidate/current session ownership and revision-safe resource
  lifecycle are explicit browser responsibilities. It is no longer growth from
  the deleted legacy scheduler, and it does not justify another browser-owned
  reader state machine.
- Rust has the main runtime pieces in place: document handles, deterministic
  revisions, frame cache, resource transfer leases, locators, footnotes, text
  geometry, search, frame-resource prefetch, and packed frame command buffers.
- The production bounded runtime has one-shot continuation cursors,
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
  retained shaped cluster edges, and document-order ranges revalidate both
  carets, traverse exact retained logical flows within one chapter, preserve
  unpainted soft-wrap text and native block separators, return source locators
  and exact per-page rectangles, and work across pagination. Cross-chapter
  ranges, host-measured runs, unavailable source spans, illegal grapheme interiors
  and unsupported transforms return typed unavailable results. The
  versioned WASM/direct/Worker transport validates request echoes and response
  semantics, and Browser Reader exposes an optional atomic `textSelection`
  capability. Browser carets are opaque objects whose raw Rust addresses are
  privately bound to the worker session, revision version, and commit
  generation. Kit now treats this capability as authoritative, coalesces async
  pointer samples with latest-result ownership, projects exact page rectangles,
  drives copy and selection UI from native text, and creates persistent
  annotation targets directly from the returned source range. Rust now also
  projects a durable `{ href, sourceRange }` atomically through one committed
  revision. The WASM/Worker/Browser contract checks both lazy-pagination
  endpoints, request identity, exact shapes and page/spread ownership; Kit uses
  it for cached annotation overlays and hit testing without reconstructing a
  legacy HitMap. Pending, unavailable, preview and stale results fail closed.
  Cross-flow selection/annotation geometry now resolves exact source-backed flows
  in document order, including across pages, while chapter boundaries and runs
  without deterministic shapes remain unavailable rather than using interpolated
  geometry. Legacy layout-local selection and annotation projection remain only
  for Readers without the native capabilities.
- Rust core now also derives a revision-bound, document-order accessibility tree
  from retained page layout. The exact-version WASM/direct/Worker path validates
  recursive roles, heading levels, link/image fields, finite page-content bounds,
  revision/page ownership and unknown fields. Soft-wrap whitespace is restored
  only from a proven shared logical text flow, while fully clipped text is omitted.
  Browser Reader exposes the tree through optional `getPageSemantics`; Kit treats
  its presence as authoritative, clears it during previews and revision changes,
  discards stale reads, distinguishes decorative from unknown-alt images, and
  routes mirrored link activation back through revision-bound native targets.
  Retained layout can still flatten some list/table container detail, and there is
  not yet a cross-page semantic identity model.
- The production Kit/app interaction slice now exercises those native contracts
  end to end. The accessibility mirror remains populated across page navigation;
  mirrored links dispatch through revision-bound native targets; standalone-image
  clicks wait for the Rust resource transfer, keep latest-request ownership and
  revoke stale or disposed Blob URLs. Footnote HTML is serialized through a Rust
  allowlist sanitizer that unwraps unknown elements, escapes text and attributes,
  drops event/style attributes and host CSS classes, rejects active or malformed
  URL schemes, and omits auto-fetching image sources while preserving safe note
  structure. At an incomplete known-extent boundary, Next
  remains enabled and grows/commits the following bounded spread before navigation
  instead of treating the partial extent as the end of book.
- Native search results now carry either a durable exact `{ href, sourceRange }`
  or typed `sourceUnavailable`. The source range is emitted only when every
  logical slice in the match is continuously and exactly mapped; generated gaps,
  cross-flow matches, unproven chapter ownership, and a raw parsed-source slice
  that differs from the logical match fail closed. WASM/Worker and Browser
  preserve the revision-bound response and expose only the durable source
  identity publicly. Search still drains the bounded session eagerly and has no
  publication source index. Kit projects only visible-spread resolved sources
  through the lazy `resolveExactSourceRange` overlay cache; pending, unavailable
  and missing sources fail closed without a legacy HitMap fallback. A production
  Worker E2E now searches the demo's embedded-font `第1话`, observes the exact
  source-range read and proves the same-page Canvas changes when the highlight is
  cleared.
- The private JavaScript facade and Worker transport preserve complete revision
  handles for bounded advances and version-gated reads, reject skipped or
  mismatched versions, round-trip failed-revision cleanup state, and perform
  exact versioned release. A private bounded session controller now coalesces
  spread, source-locator and completion targets with latest-request priority,
  permits only one continuation
  quantum in flight, yields between quanta, avoids starting another quantum
  when a retarget is already available, refreshes an exact slim presentation
  only after the requested target becomes available, warms frames and
  resources at the exact accepted version, and cancels/releases the latest
  handle after races or failures. The presentation carries revision,
  navigation, TOC and font contracts while deliberately omitting cumulative
  footnote and chapter-text aggregates. Exact aggregate bundle, search,
  footnote and chapter-text reads still cross both in-process and Worker
  transports for explicit consumers. Source-locator responses echo their
  normalized request, stale target failures are discarded, and recoverable
  locator/frame reads no longer destroy a healthy session. Browser
  frame, resource, search and destructive release paths no longer use
  revision-ID-only operations. Browser initial load, reflow, navigation growth
  and completion now select this bounded path in production.
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
- The Reader app now owns and loads a licensed v1 deterministic fallback before
  it creates any Reader: Tinos Regular as `serif`/`und` and Source Han Serif CN
  Regular as `serif`/`zh-hans`. Core and React retain an explicit optional policy
  rather than bundling or fetching a universal default. A completed real-WASM
  comparison succeeded for all 39 Downloads EPUB inputs (36 unique contents).
  On unique contents, exact base-text run coverage rose from 3.00% to 99.95% and
  exact UTF-16 coverage from 2.40% to 99.95%; unique page count moved from 13,807
  to 13,808. The residual unavailable text comprises 626 host-fallback UTF-16
  code units and 2,219 explicitly synthetic units. This closes the first
  licensed serif shaping/Canvas-selection proof, not locale-specific CJK,
  `sansSerif`, or `monospace` completeness.
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
- Mixed-content bounded snapshots commit without waiting for image decode, then
  invalidate once the selected image resources enter the browser cache. The
  completion is ignored after navigation, candidate replacement, or disposal;
  image-dominated snapshots keep their existing blocking first-paint behavior.
- The milestone parity suites are green for the current selected surface: all
  10 fixture books across 4 package/layout configurations, plus 30 exhaustive
  runtime render-command groups covering 189 cases and 378 render summaries.
- On 2026-07-16 the production bounded reader passed all 75 EPUBs then present
  in Downloads in 29.6 seconds with three Playwright workers. The strict
  TypeScript-reference/Rust Reader parity review also passed all 237
  case/profile records with zero differing pixels across the single, narrow,
  wide, DPR 2 and double-page profiles.
- The production release-protocol E2E now records request and response revision
  handles through continuation, transfer release, cancellation, exact revision
  release and Worker dispose acknowledgement. It passed three consecutive runs;
  a replacement session cannot reuse or replace the physical Worker until the
  old session has acknowledged disposal.
- Strict named-machine latency and physical-footprint gates now complement the
  functional and pixel evidence. They intentionally remain red when a threshold
  is exceeded; current results are recorded below rather than hidden by widening
  the limits.
- `RITOFCB2` is the current packed frame command-buffer ABI.
- Native revision-cache entries serving normal reader frame windows now retain
  only `RITOFCB2` metadata/bytes. The browser still keeps its decoded Canvas
  frame window. The legacy full `RuntimeFrame` JSON tree is materialized from
  the immutable revision layout only when a compatibility frame API requests
  it, then cached in the same native LRU entry. This does not make packing
  JSON-free: payload-table encoding and the current command hash still
  construct transient JSON values.
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
- The normal reader E2E suite now asserts the production bounded WebWorker
  protocol (`open`, bounded revision control, exact presentation/frame reads)
  and rejects a fallback to legacy `createViewRevision`. The former app-level
  JSON/`RITORB1` ABBA harness was retired because the bounded production path
  does not use that legacy transport selector. Low-level binary compatibility
  and decode performance remain covered in `@ritojs/core-wasm`.
- `RITO_READER_PROFILE_EPUB=/absolute/path/book.epub pnpm test:e2e:load-profile`
  records page-clock load milestones, every bounded Worker round trip, revision
  extent, Long Tasks, and post-load font-reflow work without mutating production
  messages. The Downloads smoke remains the broad real-book functional gate.
- `RITO_READER_USABILITY_GATE=/absolute/path/gate.json
RITO_READER_MACHINE_ID=<id> pnpm test:e2e:usability-gate` applies a strict
  manifest that pins machine, OS, browser/version, DPR, normal/reflow viewports,
  EPUB SHA-256 digests, run count and every stage threshold. Each case/run uses
  a fresh bundled Chromium process and BrowserContext. The first process-per-run
  three-run calibration added by `b0b192a` covers `book-01`, `book-04` and
  `book-10`; its worst fixture p95s are 71.6 ms `open`, 61.1 ms
  bounded-to-presentation, 2.3 ms frame warm, 259.5 ms input-to-first-Canvas,
  14.1 ms cached turn, 60.8 ms deferred growth, 184.5 ms reflow and 76.0 ms
  measured-window Long Task. The earlier `12e4f82` shared-browser-process
  calibration produced the separate 67.5/62.0/2.4/249.3/14.0/47.8/201.4/70.0
  ms series; it is pre-isolation history, not the same baseline. Canvas settling
  isolates stages and observes animation Long Tasks but is excluded from
  first-frame latency.
- The 2026-07-16 release-candidate rerun did not pass the latency gate. `book-01`
  reached 809.6 ms navigation-to-first-Canvas, 549.3 ms input-to-first-Canvas,
  98.5 ms cached turn, 474.5 ms reflow and a 140 ms maximum Long Task, exceeding
  their recorded 700/500/50/300/120 ms limits. The gate stopped before later
  fixtures, so this is an active release blocker rather than a new baseline. An
  isolated `b0b192a` worktree reproduced the same class of failure while three
  shared-process profiles stayed below their limits; the red result is a
  pre-existing cold-process/outlier problem, not a regression from the current
  lifecycle changes.
- `pnpm test:e2e:memory-gate` launches three isolated browser scenarios, records
  stable physical-footprint checkpoints around load, growth, reflow, eight
  replacements and terminal disposal, and verifies the complete Worker-session
  release sequence. On 2026-07-16 every one of 33 sessions acknowledged dispose,
  all six physical Workers terminated and no Worker remained live. One run's
  replacement growth was 107.719 MiB against a 96 MiB limit (the other two were
  38.188 and 65.860 MiB), so the aggregate gate remains red. The outlier carried
  a roughly 52 MiB page backing-store peak while page JS/DOM/Worker ownership
  stayed bounded; current evidence points to Chromium/Canvas allocator high-water
  behavior, not an unreleased Rust document or Worker session.
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

1. **Bounded-layout hard limits**
   - Production now uses the bounded revision path with top-level-node budgets,
     one-shot versioned cursors, cancellation, stable partial extents, lazy
     chapter/image loading and resumable page-window growth. Browser and Kit
     publish partial extents correctly; Next at the known boundary requests and
     commits more work instead of disabling navigation.
   - Greedy leaf paragraphs now resume both between completed line boxes and
     inside one pending line at the root and through ordinary in-flow
     transparent container trees. Break search, cached prefix/style-slice
     measurement, line-break scanning, leading-space skip, trailing-whitespace
     trim, UTF-16 run copy, measurement and shaping all retain their state
     across public quanta. ASCII hyphenation also preserves word-boundary
     discovery, generated points, the reverse candidate cursor and the selected
     result, so a yielded candidate measurement does not rescan the word or
     rerun the Liang dictionary. The dictionary calculation itself, like an
     indivisible font measurement or Rustybuzz call, is admitted as one atomic
     operation. A fresh quantum may admit one oversized operation to avoid
     livelock, so this is not by itself a wall-clock preemption guarantee.
   - All active descendants share one 32-node accept/start meter and the same
     text-work meter. One public continuation request also shares that text
     meter across every chapter it visits instead of resetting it at chapter
     boundaries; the next public request receives a fresh meter. Flat
     containers retain one private tail block so completed children can seal
     stable pages without later mutating `id` or page-break semantics. No
     unfinished line or block is published, and eager/bounded pages, frame
     commands and ordered text-work traces remain identical.
   - A resumed Greedy line-layout session must use the same logical font
     inputs. Each session captures a process-local layout-profile token derived
     from fallback mode/profile and the ordered face descriptors/fingerprints,
     then rejects a resume under a different profile instead of silently
     restoring with inconsistent metrics. The same token partitions the shared
     width cache so separate revision font assemblies cannot reuse stale
     measurements.
   - Exact real-font post-processing no longer rescans the text prefix for
     every retained cluster. Rustybuzz byte clusters are converted to UTF-16 in
     one source pass, grapheme endpoints use a compact sorted index and spacing
     consumes LTR or RTL clusters with one directional cursor. That spacing
     cursor now retains UTF-16 scalar and cluster-commit state across layout
     quanta. Operation-count
     regressions cover 10,000-cluster lines, and bit-level oracles preserve the
     former spacing, merge and malformed-cluster semantics. Rustybuzz itself
     remains an indivisible operation.
   - Exact source-mapping boundary checks no longer rescan the complete logical
     flow for every wrapped run. Each finalized flow retains only the UTF-16
     offsets inside surrogate pairs (zero entries for BMP-only text), so checked
     run subslices validate boundaries in logarithmic time without weakening
     invalid-surrogate rejection. Logical-flow assembly now resumes inside the
     production Greedy leaf: a paid preflight counts every candidate and UTF-16
     scalar, and the text, surrogate-interior, span and assignment buffers are
     reserved from exact counts in paid steps. Every reserve that can grow a
     buffer first receives an `InlineCollection` atomic admission sized from
     preflight; a zero-growth or already-capacious step consumes only one
     resumable unit. Successful steps advance exactly once, so a later yield
     cannot re-admit or move an earlier allocation. Text and mapping metadata
     are copied incrementally, and assignments commit one segment at a time
     while the finalizer retains ownership. No partial
     success or global `FlowTooLong` failure can escape across a continuation.
     Exact source ranges that overflow `usize` now fail the whole flow closed
     instead of panicking or producing an invalid mapping. After mapping, a
     second resumable two-pass builder now prepares the production Greedy line
     context: it preflights display UTF-16 scalars, reserves exact text/range
     capacities in paid steps, and assembles the final string, UTF-16 boundary
     and newline indexes, style ranges and atoms without a seal-time rescan.
     Initial-completion and long-run monotonic-width predicates are accumulated
     during those paid passes, including the existing empty-segment semantics.
     The independent eager builder remains the equivalence oracle. Before
     mapping, the production Greedy leaf now owns an explicit candidate-
     collection phase. Ordinary inline and Ruby candidate traversal use an
     iterative owned frame stack; node dispatch, UTF-16 text assembly, segment
     commit and frame exit consume the shared text meter, including an astral
     scalar split across quanta. Ruby direct-child grammar, base traversal,
     annotation extraction and per-scalar annotation application also resume
     without publishing a partial segment vector. Frame-local first/last-text
     summaries preserve nested borders and margins without rescanning completed
     segments. Ruby annotation extraction now performs a resumable UTF-8/UTF-16
     size preflight, admits its exact-capacity output allocation in a paid step
     and assembles that output in a second scalar-metered pass without growth.
     A separate paid seal publishes one shared annotation source; application
     retains that source while each resulting base `TextSegment` pays an exact-
     capacity reserve, scalar-copies the annotation and commits only the
     completed `String`. Empty annotations allocate neither output nor shared
     seal. Ruby base grouping now preflights each direct-child prefix under the
     shared meter, checked-counts its base nodes, and reuses an `rb` seed vector
     without copying. A required growth pays one atomic admission sized to the
     final group before `reserve_exact`; a second metered pass gathers the
     prefix without further growth, resumes inside ignored-subtree discard, and
     consumes `rt`/`rb` boundaries only after the complete group is private.
     Empty groups and seeds with sufficient spare capacity allocate nothing and
     consume no atomic slot. Generic segment commit now retains one segment
     directly instead of allocating a single-element temporary vector. A full
     candidate output pays atomic admission by its checked post-commit length
     before an amortized `reserve(1)`; the ready commit retains that capacity
     across a yielded append unit, publishes exactly once without further
     growth, and updates text summaries only after the successful push. Spare
     output capacity consumes no atomic slot. The generic candidate traversal
     stack now retains its initial root outside an empty `Vec`; each required
     stack growth pays atomic admission by the checked post-push depth before
     an amortized `reserve(1)`, and every production push asserts that it uses
     the retained spare slot without changing capacity. Ordinary inline and
     Ruby dispatch preflight that slot before consuming the parent iterator or
     node unit. A ready Ruby base requests capacity without moving its nodes or
     recording `output_start`; a successful reserve survives a later unit yield
     without repeated admission. Spare frame capacity consumes no atomic slot,
     and cancellation drains an unstacked initial root iteratively. The shared
     ignored-subtree discard traversal follows the same ownership protocol: its
     root iterator stays outside an empty stack until checked post-depth
     admission, nested children preflight capacity before node/unit consumption,
     and every push uses a retained slot without growth. This single resumable
     traversal covers ordinary ignored children, skipped Ruby group nodes and
     ignored children on raw annotation text; spare capacity consumes no atomic
     slot, while cancellation drains both the unstacked root and nested frames
     iteratively. Ruby annotation traversal now also retains its root outside an
     empty stack, preflights every non-text child frame before parent/node-unit
     consumption, including empty child frames, and pushes only into an admitted
     slot. A completed annotation text scan remains owned until checked post-part
     count admission and an amortized reservation succeed; retry neither recounts
     UTF-8/UTF-16 lengths nor repeats a successful admission, and both frame and
     part pushes assert no capacity growth. Spare capacity consumes no atomic
     slot, while cancellation drains an unadmitted annotation root iteratively.
     Candidate cancellation cleanup now drains every owned `StyledNode` forest
     sequentially through an intrusive iterative cursor. The cursor stores its
     parent and sibling traversal state in slots freed from existing child
     vectors; focused tests assert unchanged capacity for every carrier push.
     The shared layout cleanup primitive now seals owned `Vec`, borrowed `Vec`
     and owned `VecDeque` iterator sources behind the same explicit structural
     budget: each step performs exactly one descend or release transition, an
     empty iterator completes with zero consumption, and completion reports only
     the units actually consumed. The deque path consumes wrapped ring-buffer
     storage directly without collecting or making it contiguous. Existing
     synchronous helpers and `Drop` drain that same cursor, including roots that
     have not become active yet, without collecting another forest or allocating
     traversal scratch.
     Budgeted owner cursors now compose it across `PendingNodeDiscard`,
     `PendingRubyAnnotation`, every `PendingRubyFrame` state and all retained
     Ruby group payloads. Empty sources, source handoff, optional ownership slots
     and final owner release are explicit cleanup units; partial cursor
     destruction drains the same state machine. The existing collector `Drop`
     path also drains the Ruby-frame cursor synchronously, so ordinary frames,
     shared discard, Ruby group and annotation state, and the active atomic node
     require no aggregate traversal-scratch allocation or growth. A crate-private
     outer candidate cursor now composes those primitives across the initial
     root, each ordinary or Ruby frame, discard, active text or atomic work,
     pending commit, output segments, whitespace/image ownership and final
     collector release. Frames and output are popped one at a time, empty source
     and nested-cursor retirement transitions are explicit units, partial cursor
     destruction drains the same state machine, and the normal collector keeps
     no cleanup-only state. Its existing `Drop` path constructs that state on the
     stack and drains it synchronously. Paint-ready `RuntimeBlock<LineBox>` trees
     now have a separate budget-capable cleanup cursor. The top-level root stays
     unboxed, nested blocks reuse a vacated child-vector slot as their traversal
     carrier, and every line run is released separately instead of hiding an
     unbounded `LineBox.runs` drain in one unit. Root/line source transitions,
     block shells, images, rules, source retirement and final root ownership are
     explicit units; partial cursor destruction drains the same state. Focused
     tests cover 16K-deep and 16K-wide trees with zero carrier-capacity growth.
     JSON paint and each individual run payload, including a final
     `Arc<LogicalTextFlow>` owner, remain indivisible destructor residuals. The
     direct child-vector façade now exposes the same forest cleanup without
     manufacturing a synthetic root block: its source handoff and nested-cursor
     retirement are explicit units, so an empty field costs two units and a
     completed-line field costs `sum(run count + 3) + 2`. Partial destruction,
     including panic unwinding over a 16K-deep child forest, drains the same
     iterative state. A single outer `ContinuousLayoutSession` cleanup driver
     now composes that façade with all three queued-node forests, active leaf or
     container state, float/list state and the shared image index. Leaf cleanup
     reuses the candidate cursor while mapping finalization, line-context
     building and greedy-line state remain explicit atomic destructor residuals.
     Container cleanup releases its optional tail block and node forest, then
     hands its unique boxed child session back to the outer driver; no inner
     cursor owns a recursive `Drop` path. Empty sessions cost exactly 14 units,
     every empty no-tail container layer adds 19, and a `k`-layer chain costs
     `19k + 14`. Focused tests cover exact q=1 accounting, wrapped node deques,
     leaf candidate composition, tail blocks, immediate and pre/post-child-
     handoff drops, and 16K nested sessions during panic unwinding without a
     cleanup-only traversal allocation. The block-vector, page, page-vector,
     open-page-accumulator and `ContinuousPaginationSession` cursors now compose
     that primitive over sealed pages and open blocks, with explicit source
     activation/retirement, nested cursor retirement, page paint, a bounded
     scalar pagination-policy snapshot and owner transitions;
     partial cursor destruction drains the same state machines. A block vector
     costs `sum(block units) + block count + 2`; an accumulator costs
     `page-vector units + block-vector units + 6`. A shared persistent-owner
     `LayoutConfig` cursor releases both flat font-measurement maps and both nested
     family-to-glyph maps one entry at a time. With `F` flat entries, `N` inner
     entries and `O` outer family keys, it costs `F + N + 2O + 6`; B-tree
     iterator construction/advancement retains the standard library's
     logarithmic internal work, but whole-map `O(n)` destruction no longer sits
     in one cleanup unit. The pagination session no longer clones the entire
     `LayoutConfig`; page geometry is copied into its accumulator and it retains
     only the three-field pagination policy needed by later splits. Its cleanup
     cost is therefore `accumulator units + 3`, or 13 units when empty,
     independent of host font-measurement map size. This also removes the large
     direct config drop from eager pagination and normal completed-chapter
     disposal. Owned full, initial-preview and active-chapter-preview runtime
     requests now transfer their `LayoutConfig` allocation directly into the
     retained revision instead of borrowing it, cloning every measurement map,
     then directly dropping the request copy. Chapter-window normalization also
     clears `first_page_alone` in that owned config rather than cloning it.
     Allocation-identity tests cover both the public full-bundle and active-window
     bundle paths. A deferred view preview still needs exactly two persistent
     configs—one in the preview revision and one in its full-reflow follow-up—but
     no longer creates a third short-lived request owner. Active-view probing now
     also happens before that clone, so a missing active chapter falls back to a
     full revision with the original config and no discarded preview copy.
     Complete configs rejected before revision ownership are now transferred to
     the runtime cleanup queue instead of being destroyed inline. This covers
     owned prefix/window construction errors, standalone active-preview
     no-match/errors, view-preview preflight errors, invalid preserve locators,
     and bounded-request invalid budgets or layout-key/footnote/font preflight
     failures. Bounded initialization keeps one owned config through every
     fallible preflight and creates its sole persistent revision clone plus the
     revision footnote payload only after they all succeed.
     A standalone config cursor costs `F + N + 2O + 6` units and its queue job
     costs `F + N + 2O + 7`; an empty job costs 7 units, while the 256-entry
     regression fixture costs 263 and demonstrably resumes after its first
     64-unit service. An invalid preview locator batches the original request
     config with retirement of the preview revision that owns the cloned config.
     If construction of that cloned preview revision itself fails, those are two
     distinct producer admissions and therefore receive two fixed service calls,
     for a bounded total of 128 units. The chapter-session cursor now
     releases its paginator before its continuous-layout state, with explicit
     source and nested-retirement boundaries. Its exact cost is
     `pagination units + layout units + 5`, so an
     empty finished or unfinished chapter costs 32 units. Immediate, partial,
     boundary and panic-unwind drops drain the same cursor, including a 16K-deep
     queued node forest. `RuntimeRevisionInteractions` now has its own composed
     cursor for the persistent owners covered here. It retires each footnote and
     completed-chapter idref separately, and a materialized chapter-text index
     releases each span before its index shell. With `F` footnotes, `C` completed
     idrefs and `S_i` spans in materialized index `i`, a `FullDocument` source
     costs `F + C + 5` units; a materialized source costs
     `F + C + 6 + sum(S_i + 6)`, while one standalone index costs `S + 4`.
     Bounded chapter startup now moves its materialized text index directly into
     continuation work and then the revision. It does not clone the
     publication-wide footnote map or replace equal entries when later chapters
     publish. The active chapter retains only completed idrefs until chapter
     completion. Its outer cursor releases unpublished pages before the chapter
     session, then retires each retained idref before the chapter idref and
     scalar shell. Its exact cost is
     `page-vector units + chapter-session units + completed-idref count + 7`;
     an empty active chapter costs 41 units and one empty unpublished page costs
     46 cleanup units. Focused tests compose a 16K-deep page with a 16K-deep
     queued node tree and wide completed-idref owners, lock the release order
     and cover immediate, boundary and panic-unwind destruction.
     A continuation-record cursor immediately guards an optional active chapter
     before releasing layout config, layout key, revision id and its scalar
     shell. The redundant continuation-side chapter-start index has been
     removed; the published runtime layout remains the source of truth for
     chapter boundaries. A record without an active chapter costs
     `layout-config units + 5`; active records cost
     `active-chapter units + layout-config units + 6`, so empty and
     one-empty-page active records cost 53 and 58 units respectively.
     Non-empty and extreme-scalar tests lock every flat-field boundary while a
     16K-deep active record remains stack-safe during immediate and panic-unwind
     drops. A built-layout cursor now composes the page-vector and layout-summary
     cursors before releasing each chapter-start entry. The summary cursor
     retires each pagination chapter-map entry before its remaining diagnostic
     shell and costs `CM + 3` for `CM` summary chapter-map entries. Built-layout
     cost is therefore `PV + CM + CS + 7` for page-vector cost `PV` and `CS`
     chapter-start entries; empty and one-empty-page layouts cost 9 and 14 units, while a
     single 16K-deep block page remains stack-safe. Detailed full-publication
     diagnostic vectors and JSON values remain one summary-shell residual. A
     detached frame-cache owner keeps its frame map and LRU order
     together and now composes a persistent cursor for each cached frame. Let a
     packed frame contain `R` resource-table entries, `F` font-family entries,
     `S` string-table entries and `P` payload-table entries. Its cached-frame
     cursor costs exactly `CF = 7 + R + F + S + P` units. If the same owner also
     has a materialized compatibility JSON frame with `C` commands, `I` resource
     images and `J` font families, that adds `C + I + J + 4` units. Each of those
     entries is retired separately; the packed byte allocation is one explicit
     unit, while scalar metadata and the bounded command-kind maps stay in the
     final shell. Each legacy command is still one indivisible nested JSON
     `Value` residual. A frame cache containing nested costs `CF_i` therefore
     costs exactly `FC = 3 + sum(CF_i + 1)` units, including one explicit
     retirement unit per completed nested cursor. The cursor retains an active
     cached-frame cleanup instead of letting a temporary guard synchronously
     drain the remaining payload. The revision cursor turns its optional required-font catalog
     into an iterator at the revision-source boundary and releases one face per
     unit; with `R` faces it adds exactly `R` units. The
     runtime-revision cursor releases its cache before the built layout and
     config, then composes the required-font iterator and interactions cursor
     before its scalar shell. If the nested costs are `FC`, `BL`, `LC` and `RI`,
     and the catalog contains `R` faces, the
     revision costs exactly `FC + BL + LC + R + RI + 7`. Empty
     `FullDocument` and one-empty-page revisions cost 30 and 35 units, and a
     single `N`-deep block page costs `2N + 36`. Immediate, nested-boundary and
     partial-cache tests cover the composed owner, including a full cache
     followed by a 16K-deep layout, wide interactions and font catalogs.
     This coverage now also includes normal completed-chapter retirement.
     `finish_current_chapter` transfers completed idrefs into publication work,
     then admits the remaining whole `RuntimeChapterContinuation` to the runtime
     queue instead of synchronously destroying its finished layout session,
     idref and scalar shell. That completed owner costs exactly 41 cursor units
     and 42 units including queue retirement, so every completion's immediate
     64-unit service has positive aggregate headroom; a repeated-arrival test
     keeps the job count bounded even behind permanent regular backlog. The
     two non-panic orphan-work paths now also move the complete
     `RuntimeContinuationWork` owner into one regular resumable queue job. A
     later chapter-start failure retires it inside `advance_record`, while
     missing-revision publication retires it inside `apply_work`. The shared
     helper does not service this admission: the existing outer
     error/publication boundary performs the one fixed service after admitting
     its continuation, revision/frame-cache and work owners, avoiding either an
     early service miss or a double service. The outer cursor releases every
     page batch through its page-vector cursor before advancing the whole
     interactions vector as one nested cursor, then retires every completed
     idref and the work shell. If page-vector batch `b` costs `P_b`, the work owns
     `C` completed idrefs, its nested interactions-vector cursor costs `I`, and
     `A` is one when that vector is non-empty and zero otherwise, the work cursor
     costs exactly `W = 4 + Σ(P_b + 3) + C + A * (I + 1)`. Its single queue
     job costs `Q = W + 1`. Production-shaped non-empty work containing `N`
     chapter interactions with `S_i` text spans therefore costs exactly
     `Q = 8 + Σ(P_b + 3) + C + 13N + ΣS_i`. Tests cover a later-chapter
     startup failure, missing-revision publication, exact page/interaction/idref
     boundaries, one-job admission and partial/panic-unwind cleanup across deep
     pages and unread spans. `RuntimeDocument.full_chapter_text_indices` and
     temporary bundle/presentation/serialization clones still destroy their
     aggregate owners directly. Generated cached frames now retire legacy
     commands, legacy resource/font entries and packed
     resource/font/string/payload entries in bounded structural units. A single
     legacy command's nested JSON tree, the
     packed byte allocation and individual string allocator releases remain
     indivisible residuals, as do the detailed full-publication summary shell and
     the named direct paths. Native frame-cache prefetch now warms a packed-only owner
     without allocating or cloning the legacy JSON command tree. Compatibility
     frame reads materialize that tree from the immutable revision layout on
     demand; a projection mismatch fails before cache mutation or LRU refresh.
     WASM resource prefetch reads unique image hrefs from packed metadata, while
     packed metadata and bytes use separate narrow core projections instead of
     cloning both halves twice. The private cached-frame owner and display-list
     construction carrier no longer implement `Clone`, and page indexes move
     only into a materialized compatibility frame. Packed-only and materialized
     entries remain one native cache owner, but materializing compatibility JSON
     adds its command, resource-image, font-family and shell units to that
     owner's cleanup cost.
     These changes remove persistent and transient full-payload copies without
     changing the frame or command-buffer wire.
     Partially deserialized
     configs that never form a complete owner and deferred follow-up/config
     serialization or adapter/transport-side `LayoutConfig` owners can still
     clone or drop directly. Empty-policy `layout_key` hashing now streams the
     compact layout-config JSON directly into SHA-256. The pinned-policy branch
     retains one complete JSON buffer because the existing byte contract places
     its length before the JSON, but segmented hashing removes the former second
     identity buffer and full-config copy without adding a second serialization
     pass. Legacy JSON/`RITORB1` view endpoints synchronously drop serialized
     follow-up configs but are not used by that production path. Eager preview
     and full bundle creation now keep the inserted revision provisional through
     bundle metadata and initial-frame finalization; any post-insert error
     releases it through the same budgeted revision cleanup queue without
     reusing its ID. The WASM eager, view, reader and bounded-create transports
     now extend that provisional state through initial-frame warm/prefetch and
     final JSON/`RITORB1` encoding. Previous-revision transfers remain owned
     until commit while response counts expose the post-commit view; on a
     recoverable transport error they remain intact while the exact new
     revision and leases are released.
     Continuation, cancellation and versioned-release mutations still commit
     before their infallible-in-practice JSON response is encoded.
     These
     cursors establish structural stack safety for their guarded persistent
     owners rather than an end-to-end wall-clock hard bound. Ordinary
     `RuntimeBlock` / `RuntimePage` destruction remains recursive outside the
     guarded owners. Production runtime retirement now uses a private two-lane
     queue: continuation records, normally completed chapters, revisions,
     complete orphan continuation-work results, detached frame caches,
     individual LRU frames and complete transient configs are removed from their
     logical owners first, then advanced in unit quanta.
     Low frame backlog alternates
     with regular work. At the 24-owner high-water mark it receives bursts of at
     most eight frame-lane units,
     so regular retirement cannot starve. Every cleanup-queue-admitting producer
     batch ends with a fixed 64-unit service call. The closed production
     job-admission bound is at most one
     cache (holding up to 12 frames), revision or config owner per lifecycle
     mutation, one 42-unit completed-chapter owner per chapter completion with
     its own immediate service, one aggregate orphan-continuation-work job per
     failed work batch, two individual frame owners per cache miss, or two
     separately admitted config owners when preview-clone construction fails.
     The fixed service quantum guarantees progress, not frame-owner retirement
     or cleanup throughput: a wide cached-frame payload remains one resumable
     frame-lane owner after the first service, and sustained frame arrival may
     exceed the available service units. The 24-owner high-water mark counts
     owners rather than retained bytes, so its bounded priority bursts are not
     generic memory backpressure and do not prevent frame-owner accumulation.
     Aggregating the entire `RuntimeContinuationWork` closes the
     per-batch job-admission count, not a global 64-unit hard-backpressure proof:
     the job's cost grows with page-tree, chapter and span counts, so one service
     guarantees progress but may leave its single resumable regular job queued.
     Empty work is not admitted; completed-idref-only work with one idref costs 6
     units including queue retirement. Each queued job also has a separate
     retirement unit, making the minimum queue costs 12 for an inactive
     continuation, 42 for a completed chapter, 31 for an empty `FullDocument`
     revision, 4 for an empty frame cache, 8 for a packed-only cached frame with
     empty tables and 7 for an empty transient config. An empty
     materialized-index revision plus the other empty real jobs, as used by the
     mixed fixture, costs 111 units; its materialized cached-frame fixture has
     empty command/resource tables but one legacy and one packed font family and
     therefore costs 14 units including queue retirement. The total includes
     every queue retirement.
     Release, cancel, successful/failed continuation publication, initial
     continuation failure, cache invalidation and LRU eviction all transfer
     owners through this queue without changing the core, WASM or browser wire
     contract. `RuntimeDocument::Drop` synchronously drains already-retired jobs,
     then iteratively drains every active continuation and revision; a focused
     small-stack test combines queued and active 16K-deep revisions, 16K-wide
     cached-frame payloads and an active continuation. End-to-end runtime-owner
     destruction is therefore
     structurally stack-safe, but it is not a wall-clock bound because each
     legacy command's nested JSON `Value`, flat allocation release and the named
     direct-destruction paths remain indivisible.
     `RuntimeChapterLayoutSession` no longer amplifies that owner by cloning the
     full host-measurement `LayoutConfig` or each newly sealed page from an
     ever-growing paginator snapshot. Sealed page
     batches now move directly into the advance result, while a persistent
     emitted-page count preserves chapter-local indexes and first-page spacing
     history after each drain. The open page remains private in the paginator.
     This removes the duplicate retained page tree; the single moved page owner
     now composes through the scheduled continuation-record cursor; final
     document destruction drains the same cursor synchronously.
     Runtime pagination publication no longer clones the complete chapter map,
     rebuilds every known spread as JSON, clones those values for hashing and
     replaces the full summary after every bounded quantum. Runtime-only eager
     and bounded summaries retain the public summary schema but keep diagnostic
     spread details, samples and hashes empty; the full publication/golden path
     remains unchanged. Each append now updates the current chapter's spread
     contribution and all mirrored page/spread extents in place, costing
     `O(new pages + log chapters)` rather than accumulating near
     `O(total pages²)`. Incomplete double-spread publication also uses the
     retained-tail parity invariant instead of cloning chapter starts and
     rebuilding all spread slots. Exhaustive small chapter partitions and valid
     continuation states compare both formulas against the original slot
     builder, including `first_page_alone`, empty chapters, odd completed tails
     and same-chapter continuation. The continuation record's now-unused
     chapter-start B-tree and its budgeted cleanup stage were removed as part of
     the same state reduction.
     Active layout continuations now live in a private bidirectional store:
     cursor-to-record lookups preserve the existing continuation error order,
     while revision-to-cursor lookup lets cancel, release and follow-up failure
     remove only their exact owner in `O(log C)` instead of scanning all active
     cursors. Partial continuation commit replaces only that revision's cursor;
     invalid, stale, missing and swapped-cursor requests leave both indexes
     untouched. Removed payloads are transferred to the runtime cleanup queue;
     only final document destruction drains any remainder synchronously.
     Ordinary None/upper/lower/capitalize transforms now use a resumable exact
     UTF-8 and UTF-16 preflight, paid exact-capacity admission for their logical
     and painted buffers, and a second metered scalar assembly.
     Ordinary non-contextual assembly therefore performs no buffer growth.
     A whole-segment mapping that changes UTF-16 length falls back to logical
     text without assembling transformed output. Changed equal-length output
     combines a paid scalar-boundary summary with resumable extended-grapheme
     UTF-16 boundary streams from the shared `GraphemeCursor` scanner, without
     allocating the eager boundary vectors. Images and inline blocks move their
     owned style/source data after a paid atomic admission. The borrowed eager
     collector and eager transform-boundary builder remain independent
     equivalence oracles. Unicode Final_Sigma remains a paid whole-string
     atomic lowercase allocation/growth residual. Candidate node-forest cleanup
     remains stack-safe and scratch-stable, while discard, Ruby and complete
     collector ownership transitions now compose over it under an explicit
     budget. The collector's direct `Drop` entry point still drains
     synchronously. Runtime page trees, standalone block/page vectors, the
     open-page accumulator,
     pagination session, unpublished chapter batches and built revisions now
     compose iterative cleanup cursors; revision and continuation lifecycle paths
     schedule their composed outer owners, while standalone/direct drops remain
     synchronous. The paid atomic parser-source `Arc<str>` conversion,
     source-path duplication,
     context/style/value clones, line-break metadata normalization and B-tree
     node allocation remain separate indivisible residual operations.
   - Literal U+FFFC inside a text segment is now preserved as text; only an
     actual inline atom is intercepted by the atom map. Greedy and Optimal
     wrapped-run source offsets also use checked arithmetic and drop overflowing
     legacy path/text/offset provenance as one fail-closed group instead of
     panicking, wrapping or falling back to source offset zero. That optional
     absolute metadata remains decoupled from the relative text-mapping range.
   - Wrapped text runs now share their immutable parser `source_text` through
     `Arc<str>` instead of copying the complete source node into every line, and
     ruby extraction moves base runs into its output instead of deep-cloning
     text, paint and retained shape data. Runtime display commands still encode
     their own `sourceText` payload; deduplicating that wire representation is a
     separate protocol optimization.
   - Greedy line finalization now retains a shared Rust state machine after run
     construction. Width/effective-height accumulation, vertical run shifts and
     non-justify center/right horizontal shifts consume work one run at a time,
     survive a yielded quantum and commit position, height and the completed
     `LineBox` only after finalization succeeds. Optimal's eager path drains the
     same finalizer while preserving its distinct paint-bound width rule.
     Justify gap analysis also resumes per run and per UTF-16 scalar, including
     an astral scalar split across quanta, and moves its completed per-run plan
     without a second scan. Distribution then resumes per run; retained exact
     shape spacing resumes per UTF-16 scalar and cluster commit, while malformed
     cluster partitions fail closed. Inter-character gap counts now match the
     TypeScript baseline's extended-grapheme semantics through a rolling
     `GraphemeCursor`: each forward call sees at most two paid scalars and each
     requested pre-context call sees one. The same grapheme count provides the
     exact-shape safety check without a second scalar scan; word justification
     and base CSS letter spacing keep their distinct existing paths. Ruby
     grouping now resumes one input run at a time, retains an open group across
     yields, reuses the original vector for plain lines and allocates the exact
     output length only for ruby lines, without publishing a partial `LineBox`.
     Exact tag comparison plus the first run's tag/selected paint clones are
     still indivisible inside that paid run. Ordinary and Ruby candidate
     collection, annotation scalar copy and transform-boundary comparison now
     resume in the preceding production phase. Contextual Final_Sigma and the
     named allocation/provenance operations above remain atomic or indivisible.
     Line-context scalar assembly is also metered.
     Its bounded-prefix policy also resumes CSS family parsing, valid-face scans
     and long face-family comparisons before consuming segment text. Completed
     leaf lines are offset, wrapped and height-accounted as each bounded batch is
     emitted, so leaf close no longer maps and rescans every accumulated line.
     Style clones and allocations, child-vector growth, line-break metadata,
     B-tree insertion, list markers and final block paint/border metadata remain
     atomic residuals.
   - This is not yet the complete default-Greedy hard bound. Contextual
     Final_Sigma whole-string lowercase allocation/growth, remaining context
     metadata work, container startup and owned margin-collapse preparation,
     mapping seal and path/buffer boxing, source-text sharing/allocation,
     stack-safe but synchronous O(n) candidate cleanup and unbudgeted outer
     continuation/session disposal,
     the downstream per-run ruby tag/paint operations, atomic Liang point
     generation, the leaf marker/paint seal, visually decorated or floated
     containers, tables and Optimal paragraphs still contain unmetered or
     atomic regions.
   - A `cfg(test)` passive text-work trace now records each Greedy prefix-probe
     range, the lazy at-most-once-per-paragraph line-break scan, high-level
     measure/shape requests, both width-cache lookup sources and the exact
     UTF-16 font subruns that actually enter Rustybuzz. One ordered event stream
     retains stable text hashes. Trace-on/off tests compare mock and real-font
     `LineBox` values field for field, while fallback/cache tests prevent
     request counts from being mistaken for real shaping work. Production
     builds carry no trace path. The trace is now the regression oracle for the
     resumable text-work sequence rather than merely evidence for a future
     meter.
   - Publication-wide cross-chapter footnote filtering now collects targets and
     candidate definitions in one cached, resource-light spine scan instead of
     parsing every XHTML source twice, and sanitizes note payloads only after
     their targets are known. A local five-book, five-run Node/WASM diagnostic
     reduced the cold-minus-warm upper-bound median from 22–141 ms to 5–26 ms.
     That first scan is still outside the layout budget and remains a bounded
     latency gap rather than a completed release measurement.
2. **Native interaction follow-through**
   - Page targets, links, footnotes, standalone images, exact selection/copy,
     source annotations, revision-safe annotation projection, visible-spread
     accessibility and portable reading positions are wired through Rust,
     WASM/Worker, Browser Reader and Kit. Native capability presence remains
     authoritative and fails closed rather than mixing revisions or falling
     back to legacy hit geometry.
   - Search transports an exact durable source range when it can prove one, and
     Kit resolves visible-result highlights lazily without a legacy fallback.
     Full-publication search itself still forces eager completion and needs a
     source/chapter index rather than scanning only laid-out pages.
   - Exact text/annotation geometry now spans retained logical flows in document
     order within one chapter and continues to fail closed for unsupported source
     or shaping provenance. Controlled Reader E2E sends real Canvas drags across
     visual lines and adjacent paragraphs, preserves the highlight after pointer-up
     and verifies exact clipboard separators (`\n` within the fixture flow and
     `\n\n` between paragraphs). Rust also owns ICU dictionary word boundaries and
     retained-flow paragraph boundaries, with package-language tailoring and an
     invariant fallback. Kit maps mouse double/triple click and touch long press to
     those units; repeated-click drag keeps the original semantic unit as its
     anchor. Mouse behavior passes production Reader E2E. Trusted Chromium touch
     input now also drives the production Worker/Canvas path: long-press word
     selection, cross-line extension with immediate release, retained highlight and
     cancellation semantics all pass alongside the synthetic lifecycle tests. The
     correctness-complete ICU auto constructor adds approximately
     2.5 MB raw / 1.9 MB gzip / 1.67 MB Brotli to the release WASM and raises its
     initial linear memory from 23 to 60 pages. Dictionary-only is larger, while
     LSTM-only and non-complex constructors fail CJK/Japanese/Thai parity, so this
     is an explicit bundle/memory debt rather than a constructor downgrade.
   - Image-only or blank pages still need a durable source-anchor fallback.
     After that, remove compatibility geometry required only by legacy Readers.
   - Remove empty-page-content and synthetic-measurer compatibility stubs after
     their callers use native semantic and geometry queries.
3. **Thin session ownership**
   - The legacy preview/full scheduler is gone. Candidate/current bounded-session
     sequencing, revision commit, and some cache/font-reflow decisions still live
     in the browser shell and must be reduced to explicit core-requested host
     operations without hiding policy in another TypeScript directory.
   - Keep browser operations in the host, but move reader state transitions and
     resource/window intent into Rust-authored session plans.
4. **Usability and performance gates**
   - The 75-EPUB smoke and complete strict reader parity run are green. Every
     strict named-machine sample now uses a new bundled Chromium process and
     measures browser launch, production pinned-font/app readiness, navigation
     to first Canvas, bounded presentation/frame work, cached turn, deferred
     growth, reflow and measured-window Long Tasks across three pinned fixtures.
   - Memory limits and the cancellation/disposal release protocol are now
     executable and recorded. The release protocol is green; the current
     latency and replacement-growth measurements exceed their pinned limits.
     Those two red gates, rather than missing instrumentation, block the formal
     Phase 1 declaration.
   - Minimum first-paint and page-turn latency is a usability requirement, not
     deferred micro-optimization.
   - The licensed Reader-app v1 serif fallback and its real-book
     Rust-shaping/Canvas-paint proof are complete. Its source fetch/hash,
     browser registration and first-layout cost now enter the isolated-process
     gate. Measure duplicate-Worker memory, then decide whether the remaining
     locale, `sansSerif`, `monospace`, and 626 host-fallback UTF-16 units require
     another Phase 1 preset.
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
  remaining formal usability declaration work and controlled baseline
  transition.
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
RITO_READER_PROFILE_EPUB=/absolute/path/book.epub pnpm test:e2e:load-profile
RITO_READER_USABILITY_GATE=/absolute/path/gate.json RITO_READER_MACHINE_ID=<id> pnpm test:e2e:usability-gate
pnpm test:e2e:release-protocol
pnpm test:e2e:memory-gate
RITO_EPUB_SMOKE_DIR="$HOME/Downloads" pnpm --filter @ritojs/reader exec playwright test -c playwright.config.ts tests/e2e/reader-downloads-smoke.e2e.test.ts --workers=3
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

1. Complete the remaining host-native selection behavior: touch handles, edge
   autoscroll and platform keyboard semantics. Cross-flow and reverse-direction
   exact selection/copy, pointer-up persistence, word/paragraph granularity and
   link-preview chapter context are now green in production-path Reader E2E.
2. Make the existing latency and memory gates green without weakening their limits. The
   cancellation/disposal protocol is already green; investigate the main-thread
   Canvas/frame presentation long tasks and the replacement backing-store
   high-water that currently fail the latency and memory gates. Include the ICU
   word-segmentation code/data and eager linear-memory increase in that work;
   shrinking it requires a scoped data provider or a deliberate host-segmenter
   boundary, not a less-correct ICU constructor. Granular pointer samples also
   rescan retained chapter runs and recompute ICU boundaries today; measure that
   path and add revision-scoped indexes/caches only when the latency data calls for
   them.
3. Move the publication-wide footnote scan inside a measured source-index
   budget.
4. Replace eager completed-layout search with a durable publication source index
   while retaining the implemented lazy, fail-closed exact-source geometry.
5. Continue the default-Greedy hard bound by addressing the remaining
   per-command nested JSON and flat-allocation frame residuals, the document-wide
   chapter-text-index and font/catalog owners that still bypass scheduled
   revision or active-continuation cleanup, and transient configuration owners
   before claiming an end-to-end wall-clock cleanup bound. Preserve the cleanup
   queue's closed producer-job admission rule when adding bulk lifecycle
   operations, and instrument frame-cleanup throughput, owner/byte backlog and
   atomic command/allocation latency before deciding whether the current 64-unit
   service quantum needs time-aware scheduling or memory backpressure.
   Then cover candidate/context allocation, clones,
   metadata and seals, container startup, strict downstream
   ruby tag/paint work and the leaf marker/paint seal. Keep contextual
   Final_Sigma whole-string lowercase allocation/growth as an explicit paid
   atomic residual. Make the currently atomic Liang point calculation bounded,
   then carry continuation through decorated/floated containers and split table
   prepass/rows and Optimal preparation while preserving
   eager/bounded final equivalence. Measurement and shaping stages are already
   scheduled resumably, although each underlying font call remains
   indivisible.
6. Reduce remaining browser session policy to explicit core-requested host
   operations.
7. Build the pinned WebView/DOM reference harness and declare the baseline
   transition before broad display or performance work resumes.

## Immediate Remaining Implementation Plan

The revision/locator contract, bounded production switch and principal native
interaction transports are complete. Cross-flow selection/copy and
chapter-context link previews now pass production-path Reader E2E. ICU-backed
word and retained-flow paragraph selection are wired to mouse repeated click and
touch long press, and both now pass production-path input E2E; end-user interaction
parity still needs touch handles, edge autoscroll and platform keyboard semantics. Greedy
leaf layout is resumable through
ordinary transparent container trees without changing final pagination. A
pending Greedy line now preserves break/measure/shape, UTF-16 run-copy,
leading-space, trailing-trim, ASCII-hyphen candidate and line-finalization
geometry/vertical-shift state across public quanta, and one public request
shares its text-work meter across chapter boundaries. Exact ordered text-work
traces remain unchanged, while a captured font layout-profile token prevents
restore under inconsistent logical font inputs. The footnote index performs
one spine parse instead of two. Ruby grouping traversal now resumes per input
run without publishing a partial line; exact tag/paint work remains indivisible.
Logical-flow mapping preflight, four exact destination-buffer reservations,
assembly and assignment commit now resume in the production Greedy leaf
without exposing partial mappings. A growing reservation receives one atomic
admission directly, preserving the fresh-quantum oversized escape, while an
already-capacious step consumes only resumable work. Display-text
line-context preflight, indexed assembly and seal now resume immediately after
it without exposing partial context or rescanning the completed string.
Bounded-prefix font-family parsing and valid-face discovery resume inside that
builder. An owned production candidate collector now precedes mapping and
resumes ordinary inline DFS, Ruby grammar/base traversal, annotation extraction
and scalar application, UTF-16 text assembly, atom commit and inline-frame exit
without publishing a partial segment vector. Changed-but-equal-length transform
linearity also resumes through paid scalar summaries and shared extended-
grapheme boundary streams. Ordinary None/upper/lower/capitalize transforms now
use resumable exact UTF-8/UTF-16 preflight, paid exact-capacity logical/painted
buffer admission and second-pass metered scalar assembly without ordinary
non-contextual buffer growth; whole-segment UTF-16-length-changing mappings fall
back without transformed assembly. Ruby annotation extraction now preflights
UTF-8/UTF-16 sizes resumably, pays for an exact-capacity output, assembles it in
a second scalar pass and pays a separate shared-source seal. Its traversal root
stays outside the frame stack until checked post-depth admission, non-text child
frames preflight before parent consumption and push without growth, and a
completed raw-text scan waits for checked post-part-count admission without
recounting its UTF-8/UTF-16 lengths. Each base text segment then reserves and
scalar-copies its own exact-capacity annotation before commit; empty annotations
allocate neither output nor seal. Completed leaf
lines are converted and height-accounted as their line batch is emitted,
eliminating the line-count-dependent close scan. Ruby base groups now preflight
direct prefixes, reuse `rb` seed capacity, pay before required growth and gather
without implicit reallocation. Generic candidate commit now directly retains
one pending segment and admits output growth before an amortized reservation;
the append and summary update resume separately without re-admission. Generic
candidate traversal frames now admit checked post-depth growth before consuming
their node or Ruby-base payload, retain spare capacity across a unit yield, and
push without growth; an unstacked initial root remains cancellation-safe. The
shared ignored-subtree traversal now applies the same preflight and no-growth
push protocol to its root and nested frames across ordinary, Ruby-group and raw-
annotation-text owners. Candidate cancellation now releases each owned forest
without aggregate traversal-scratch allocation or growth, but its O(n) drain and
the enclosing runtime/session disposal path remain synchronous. Sealed pagination
pages now move into each chapter advance instead of being cloned while the
paginator retains them, so cancellation owns one page tree rather than two; the
open page and page-number/spacing history stay in the session. Active cursor
cleanup also uses an exact revision-to-cursor index rather than scanning the
whole continuation table, while preserving the public error priority and one-
shot cursor contract. Runtime pagination summary construction and extent
refresh are now lean and incremental; the next bounded-layout slice should
address the remaining per-command JSON, flat-allocation and direct-destruction
cleanup residuals, together with candidate/context allocation and clone
residuals, line-context metadata work, container startup and the leaf
marker/paint seal, before making
Liang point generation itself resumable and extending the same discipline
through decorated/floated containers, tables and Optimal layout.
Individual font calls and the Liang dictionary call remain indivisible; the
oversized-operation escape means the public quantum is not yet a complete
wall-clock hard bound.
The cold browser-process/pinned-font, memory and cancellation/disposal gates are
now reproducible. Keep the release protocol green and close the measured latency
and replacement-memory overruns without changing the recorded limits. Then move the
single-pass source scan under an explicit budget and reuse a durable source
index for full-publication search. Keep search result geometry lazy and
active-window only. Classify the v1 serif preset's residual locale/role gaps
from that release evidence, and specify which remaining browser session
decisions are semantic policy that Rust must author versus unavoidable host
operations.

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
