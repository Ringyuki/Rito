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
  retained shaped cluster edges, and same-flow ranges revalidate both carets,
  require one `Arc`-identified logical flow, preserve unpainted soft-wrap text,
  return source locators and exact per-page rectangles, and work across
  pagination. Host-measured runs, unavailable source spans, illegal grapheme
  interiors and unsupported transforms return typed unavailable results. The
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
  The first implementation deliberately supports one logical text flow; old
  cross-paragraph annotations and runs without deterministic shapes remain
  typed unavailable. Legacy layout-local selection and annotation projection
  remain only for Readers without the native capabilities.
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
- The production bounded reader also passed a 74-EPUB Downloads smoke run on
  2026-07-13.
  The complete demo-reader parity matrix passed its strict zero-threshold pixel
  comparison across the single, narrow, wide, DPR 2 and double-page profiles.
  These are strong regression results, but they do not replace the named-machine
  latency and usability gate below.
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
     scalar, buffers are reserved from exact counts in paid steps, text and
     mapping metadata are copied incrementally, and assignments commit one
     segment at a time while the finalizer retains ownership. No partial
     success or global `FlowTooLong` failure can escape across a continuation.
     Exact source ranges that overflow `usize` now fail the whole flow closed
     instead of panicking or producing an invalid mapping. Inline candidate
     collection and line-context construction remain eager; allocation plus
     boxing the completed buffers and moved source paths are also still
     indivisible operations.
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
     Exact tag comparison plus the first run's
     tag/selected paint clones are still indivisible inside that paid run;
     inline candidate collection and line-context assembly happen earlier and
     remain unmetered.
   - This is not yet the complete default-Greedy hard bound. Inline
     candidate collection/context construction, container startup and owned
     margin-collapse preparation, mapping allocation/seal/path boxing, the
     per-run ruby string/paint operations, atomic Liang point generation, leaf
     publication, visually decorated or floated containers, tables and Optimal
     paragraphs still contain unmetered or atomic regions.
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
   - Exact text/annotation geometry remains deliberately same-logical-flow.
     Cross-flow ranges are a future capability, not a reason to interpolate.
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
   - The 74-EPUB smoke and complete strict reader parity run are green, but the
     formal representative-corpus usability gate is not yet declared.
   - Exercise open, first paint, navigation, resize, typography changes,
     interaction, cancellation and disposal under a recorded release protocol.
   - Measure document open, bounded initial layout, first frame, deferred
     growth and page turns independently on a named machine/browser setup.
   - Minimum first-paint and page-turn latency is a usability requirement, not
     deferred micro-optimization.
   - The licensed Reader-app v1 serif fallback and its real-book
     Rust-shaping/Canvas-paint proof are complete. Measure its cold-start,
     duplicate-Worker memory, and first-layout cost under the named-machine gate,
     then decide whether the remaining locale, `sansSerif`, `monospace`, and 626
     host-fallback UTF-16 units require another Phase 1 preset.
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
  remaining formal usability gate and controlled baseline transition.
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

1. Complete the default-Greedy hard bound by incrementally metering inline
   candidate collection/context preparation, container startup, strict
   ruby tag/paint work and leaf publication, then make the currently atomic
   Liang point calculation bounded. Carry
   continuation through decorated/floated containers and split table
   prepass/rows and Optimal preparation while preserving
   eager/bounded final equivalence. Measurement and shaping stages are already
   scheduled resumably, although each underlying font call remains
   indivisible.
2. Move the publication-wide footnote scan inside a measured source-index
   budget.
3. Replace eager completed-layout search with a durable publication source index
   while retaining the implemented lazy, fail-closed exact-source geometry.
4. Reduce remaining browser session policy to explicit core-requested host
   operations.
5. Declare the representative-corpus usability and stage-specific performance
   gate using the green smoke/parity/font evidence plus named-machine latency,
   pinned-font startup, and memory data. Classify the residual locale/role
   coverage there instead of reopening the completed v1 serif proof.
6. Build the pinned WebView/DOM reference harness and declare the baseline
   transition before broad display or performance work resumes.

## Immediate Remaining Implementation Plan

The revision/locator contract, bounded production switch and principal native
interaction slices are complete. Greedy leaf layout is resumable through
ordinary transparent container trees without changing final pagination. A
pending Greedy line now preserves break/measure/shape, UTF-16 run-copy,
leading-space, trailing-trim, ASCII-hyphen candidate and line-finalization
geometry/vertical-shift state across public quanta, and one public request
shares its text-work meter across chapter boundaries. Exact ordered text-work
traces remain unchanged, while a captured font layout-profile token prevents
restore under inconsistent logical font inputs. The footnote index performs
one spine parse instead of two. Ruby grouping traversal now resumes per input
run without publishing a partial line; exact tag/paint work remains indivisible.
Logical-flow mapping preflight, assembly and assignment commit now resume in
the production Greedy leaf without exposing partial mappings. The next
bounded-layout slice should meter inline candidate collection and line-context
preparation, container startup and leaf publication before making Liang point
generation itself resumable and extending the same discipline through
decorated/floated containers, tables and Optimal layout. Individual font calls
and the Liang dictionary call remain indivisible; the oversized-operation
escape means the public quantum is not yet a complete wall-clock hard bound.
After the default-Greedy hard bound, move the single-pass source scan under an
explicit budget and reuse a durable source index for full-publication search.
Keep search result geometry lazy and active-window only. In parallel, measure
the completed v1 serif preset under the formal usability protocol, classify its
residual locale/role gaps, and specify which remaining browser session decisions
are semantic policy that Rust must author versus unavoidable host operations.

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
