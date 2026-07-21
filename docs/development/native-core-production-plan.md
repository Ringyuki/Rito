# Rito Native Core Production Execution Plan

**Status:** active, single execution plan  
**Started:** 2026-07-19  
**Owners:** Rito core and HikariNagi product integration  
**First delivery:** HikariNagi C-end Web + Mobile-ready RC after Round 4  
**Browser-grade delivery:** Round 10 for the horizontal reflow profile; Rounds
11–14 when the approved product support matrix requires the extended profile

This document is the source of truth for work required to make Rito Native Core
usable by HikariNagi and other platform adapters, then move it toward
browser-grade rendering. Existing roadmaps and evaluations remain design
history and supporting evidence. If an older document conflicts with the
order, exit gates, freeze policy, or deletion policy below, this plan wins.

A round is an implementation-and-verification unit, not a calendar day. A round
ends only when every hard exit gate is green and its evidence is committed. A
failed gate extends the same round; it does not become deferred debt in the next
round. Independent work may run in parallel, but authority cutovers follow the
order below.

## Current Execution Status

| Round | Status                     | Current evidence                                                                                                                                                                                                                                                                                                                                     |
| ----- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Reopened for deep chapters | Chapter-local rollover is previously verified. Retained exact and adjacent ownership are now statically implemented through Core, Web, FFI, and Flutter. None of this continuation has rerun the guarded matrix. Cold deep seek is still `O(prefix)`; evicted-window restoration, a strict byte cap, checkpoints, and the full guarded matrix remain |
| 2     | In progress                | Same-revision `RITONAV1`, the earlier actor replacement path, Browser rapid-seek replacement, and Hikari Web latest-wins ownership have prior green evidence. Exact and adjacent continuation now use one Core quantum per host turn on Web and Flutter; guarded cancellation/latency evidence and a same-output TypeScript comparison remain        |
| 3     | In progress                | Fixed-width foreground/background CAS, publication projection, retained exact/adjacent ownership, and prepare-before-adopt are statically connected through WASM/Worker and FFI/Flutter. Owned decoded-image resource preparation is the active Mobile adapter task; all new adapter work remains unverified                                         |
| 4     | Started                    | HikariNagi Web now types initial and replacement foreground CAS, blocks navigation until initial adoption, and fail-closes inconsistent committed ACKs while preserving the existing animation. The seam remains flag-gated and falls back because Kit has no product adapter; native Web E2E and Mobile LN route integration remain                 |
| 5–14  | Pending                    | No production authority cutover before the browser oracle and provider gates exist                                                                                                                                                                                                                                                                   |

This table records execution state only. A round is complete solely under its
hard gates and evidence requirements below.

### Terminology and platform boundary

- **The product App means HikariNagi C-end Web and Mobile together.** Web's
  current reader integration lives under
  `apps/consumer/web/app/components/hikari-reader/**` and consumes
  `@ritojs/core/web` plus `@ritojs/kit`. Mobile lives under
  `apps/consumer/mobile/**` and is a Flutter application; its light-novel/Rito
  adapter is a delivery target, not an implementation allowed inside Core.
- **`Rito/apps/reader` is not the product App.** It is Rito's browser demo,
  instrumentation surface, and deterministic E2E harness. A passing test there
  is core/adapter evidence, not proof that HikariNagi integration is complete.
- **Rito Core is platform-independent.** `rito-core`, its session/artifact
  contracts, parser, style, layout, pagination, interaction, and display data
  must not depend on DOM, Canvas, Worker, WebView, Flutter, Vue, HikariNagi, or
  any operating-system UI framework.
- Browser WASM/Worker/Canvas is the Web platform adapter, not the architecture.
  Mobile must consume the same semantic core contract through a mobile/native
  binding and renderer adapter. The committed Mobile M3 contract requires
  `rito-ffi`/FRB plus `rito_flutter` delivered from the Rito repository and
  Flutter-side rendering; it explicitly forbids a WebView transition for the
  light-novel reader. Server, Flutter, Skia, or future adapters must remain
  interchangeable at the same boundary; Flutter/Dart types may exist in a
  Mobile adapter package but never in `rito-core`.
- Chromium/WebKit are controlled correctness oracles. They do not become a DOM
  dependency or runtime requirement of Rito Core.

### 2026-07-19 implementation checkpoint

- An exact source point captured two turns into `Section001.xhtml` now owns the
  first visible Canvas frame, restored page/spread projection, and first
  successful frame-window read after reload. The guarded real-browser gate
  passes 1/1; it no longer accepts merely landing somewhere after spread 0.
- The deterministic first-publication matrix now covers start/middle/tail
  source points across single/double spreads, six viewport shapes, cold/stale
  frame caches, delayed required fonts, and unavailable optional font boxes.
  All 12 locator combinations prohibit a spread-zero publication or cache
  writeback; the guarded package suite passes 143 files / 2080 tests.
- Rust vertical-font calibration now accepts legal CSS `line-height: 0`, which
  removes a permanent same-descriptor demand that fresh Workers could not fix.
  Unmeasurable optional font boxes no longer block pagination or paint.
- Rapid locator bursts coalesce behind one current owner: a deterministic ten
  seek test publishes only the final target and drops late stale results.
- A newly accepted intent synchronously reduces continuation work to one
  quantum. Once an exact target becomes active, no-preview work promotes to 16;
  preview-backed animation retains the `1 -> 4 -> 16` composite/settle path.
- Legacy layout is feature-frozen by an architecture test. Migrated runtime
  readers can enter page and text-interaction output only through
  `ChapterEngineSession`; the root module inventory and non-test legacy source
  budget cannot grow silently, and old builders remain in explicit adapters.
- This private Rust seam is not protocol v1 and is not consumable by HikariNagi:
  it still lacks an owned fixed-width ABI, complete reader-session lifecycle,
  `rito-ffi`, and `rito_flutter`. Browser gates below are adapter evidence only
  until the real Web and Mobile integrations pass.
- The final guarded WASM rebuild peaked at 1.06 GiB process-tree RSS; the exact
  Worker/Canvas E2E peaked at 1.25 GiB and the largest verification step
  (Clippy with warnings denied) peaked at 2.12 GiB, all below the 3 GiB hard
  stop.

### 2026-07-20 protocol and product checkpoint

- Core's typed `RITODL1` validator is green 10/10; `ReaderSessionV1`,
  `RITOART1`, and fixed 60-byte `RITONAV1` are green 21/21. Same-revision
  published adjacent turns perform no layout, preserve live sibling resource
  ownership, and fail closed at chapter/cap boundaries.
- The C ABI is green 24/24 including its C11 public header and architecture
  invariants. Its actor admits at most eight active-plus-queued commands and
  uses one active plus one replaceable queued foreground-navigation slot;
  publication/resource/release/background commands retain FIFO ownership.
- Core Reader v1 is green 40/40, the Rust FFI boundary is green 24/24, and the
  rebuilt Core-WASM JavaScript contract is green 260/260. Fixed-width binary
  identities remain JavaScript `bigint`. Flutter static analysis is clean and
  its complete suite is green 83/83. One test opens the real `book-10.epub`
  through the bundled Rust Native Asset, decodes Core's typed artifact, turns
  through `RITONAV1`, then releases and disposes native ownership.
- Immutable `RITOPUB1` publication metadata now crosses Core, FFI, WASM,
  Worker, and the public Browser `session.readPublication()` API. It preserves
  canonical spine identities and nested typed TOC targets, is capped at 16 MiB,
  keeps `u64` identities as `bigint`, and is read lazily so it adds no work to
  open or first-frame publication.
- Flutter Native Assets now builds the host, Android arm/arm64/x64, and iOS
  device/simulator Rust targets with isolated `CARGO_TARGET_DIR`, `--locked`,
  release mode, and one Cargo job. The default product path uses `@Native`
  asset IDs; an explicit dynamic-library path remains diagnostic-only.
- Flutter worker operations now use a removable bounded pending registry;
  worker exit/error fails pending operations, close failure is retryable, and
  malformed artifacts or cleanup failures fail-close the whole session.
  TransferableTypedData avoids an isolate-message copy only: Dart-to-FFI still
  copies input and there is no application-level transfer ACK, so this is not
  an end-to-end zero-copy claim.
- The Browser Canvas presenter prepares artifact fonts and images before paint,
  retains current and incoming artifacts through the existing page animation,
  and fails closed on unsupported paint or terminal resource errors. It does
  not remove, shorten, or replace the configured product animation.
- HikariNagi Web's current published 0.13 adapter eagerly creates its controller
  at spread zero. The product now restores the persisted position while that
  canvas is still detached and mounts only after the jump. Its Native-v1 seam
  forwards the exact saved locator as Core's first artifact request, waits for
  `firstFrameCommitted`, retains both animation artifacts, and uses monotonic
  latest-wins TOC ownership. The focused tests are green 4/4, as are ESLint and
  Nuxt typecheck; the configured transition remains unchanged. This is a
  compatibility bridge and staged seam, not the native package cutover.
- The rolling cached-adjacent benchmark now has a complete guarded `book-10`
  run at
  `benchmarks/core-performance/results/book-10-adjacent-20260720-r4`:
  production's median is 18.845 ms for ten turns (turn p50 1.594 ms, p95
  4.754 ms, max 5.277 ms) versus 0.830 ms for the TypeScript reference. Six of
  ten visible spreads match raw RGBA, but four text spreads differ, so all six
  pairs are parity-ineligible and the official speed ratio is `null`. These raw
  values show that the legacy public `createReader` path is currently slower;
  they are not a Native Core advantage and cannot satisfy the Round 4 2x gate.
- A separate release-mode Reader-v1 implementation probe over eight identical
  visible turns and six alternating samples is output-stable: same-revision
  adjacent reuse has a 4.613 ms median (0.577 ms/turn) versus 262.655 ms for
  native reseek/re-layout (32.832 ms/turn), a 56.94x ratio. This proves the
  adjacent fast path avoids repeated native layout; it is not a TypeScript
  comparison and therefore does not satisfy the product performance gate.
- A separate production-only Browser Reader v1 run is frozen at
  `benchmarks/core-performance/results/book-10-reader-v1-adjacent-20260720-r1`.
  Six fresh Chromium processes produced 60 exact adjacent turns. The complete
  Core request + resource prepare + Canvas paint path measured p50 3.730 ms,
  p95 9.616 ms, and max 10.315 ms; the Core request segment alone measured p50
  1.700 ms, p95 3.474 ms, and max 3.980 ms. Canvas paint is the main tail
  contributor at p95 6.537 ms. Exact initial open at
  `Section011.xhtml#progression=0` measured p50 162.263 ms total: 132.030 ms
  open/request, 0.417 ms prepare, and 29.690 ms paint. The harness rejects a
  book-start artifact, white output, hash drift, and an early ownership release.
  It does not invoke or simulate the product animation and emits no TypeScript
  ratio. This proves that specific chapter locator, not arbitrary deep locators.
- Browser frame-window scheduling now admits one active RPC and one replaceable
  latest queued target. Rapid TOC bursts settle superseded promises instead of
  replaying every intermediate center; same-center requests deduplicate, an
  active response can satisfy the queued center, and LRU eviction invalidates
  only the evicted spread's completed coverage. The Worker API cannot cancel an
  already active RPC yet, so the final target may still wait for that single
  request to finish.
- The same run confirms that all ten production spreads are nonblank after
  image-resource readiness was made fail-closed. Browser rendering now keeps
  the old Canvas intact while a required image is pending and converts missing,
  transfer, decode, and unsupported-runtime outcomes into an exact-revision
  terminal error instead of a white success or endless warm loop. The product
  page-transition animation remains unchanged.
- The Stylo bridge now carries the CSS initial `background-repeat: repeat`
  value through the typed style contract. Before this fix, the default value
  rejected ordinary URL backgrounds and caused 49/97 legacy WASM tests to fail;
  the full 97-test Rust WASM suite is green after the fix. Other unsupported
  background modes still fail closed and remain explicit compatibility work.
- Chapter-local rollover now moves the live layout/pagination continuation into
  a fresh bounded revision and retains two adjacent windows. This removes the
  fixed 16-page publication ceiling for sequential work in the implementation,
  but guarded full-matrix verification is still pending. It does not start
  layout near a deep locator: cold seek still styles the whole XHTML and lays
  out every required prefix block. Publication-global continuation also retains
  the complete built layout and source caches. Neither cost may be hidden by
  increasing the page cap.
- The older full-book phase-split probe at
  `benchmarks/css-engine-spike/results/book10-bounded-pagination-probe-20260719-phase-split.json`
  remains useful only as attribution for its exact workload: 1728.048 ms total,
  of which session/layout advance consumed 894.040 ms (51.7%) and start-chapter
  work 721.740 ms (41.8%). Inside start-chapter, style resolution consumed
  516.617 ms and document-window work 165.077 ms, while CSS rule assembly was
  only 0.863 ms. This shows that parsing stylesheet rules was not that run's
  bottleneck; it does **not** prove the current Reader-v1/Stylo path has the same
  distribution, and it is not a TypeScript comparison.
- Every heavy verification command in this continuation ran serially under the
  3 GiB process-tree guard. The observed peak was 2322.3 MiB during Hikari Nuxt
  typecheck; the final Reader-v1 release probe peaked at 1244.7 MiB. No
  unbounded parallel build/test process was used.

### 2026-07-20 unverified implementation continuation

The items in this subsection are implemented source changes, **not new green
evidence**. The execution environment refused the next guarded verification
command, so none of these items may inherit the older pass counts above.

- Core retains one unpublished exact-seek owner across strictly increasing
  request IDs. Every adapter retry is limited to one Core quantum per host turn;
  only an explicit typed pending state is retryable, and no page-one artifact is
  produced while the target remains unresolved.
- FFI status `RITO_STATUS_EXACT_SEEK_PENDING_V1 = 9` distinguishes that retained
  owner from terminal `TARGET_NOT_PUBLISHED = 6`. Web uses the equivalent
  internal typed pending payload plus Core's boolean query; neither adapter
  parses error text.
- Web continuation now prefers `scheduler.yield()`, then `MessageChannel`, and
  uses `setTimeout(0)` only as a last runtime fallback. This removes the former
  nested-timer retry chain without changing the page animation.
- Foreground artifact creation and visibility are now separate Core operations.
  `request_artifact` and `request_adjacent` create live candidates;
  `RITOFGH1`/`RITOFGA1` performs a fixed-width compare-and-swap adoption only
  after the host accepts the result. This closes the stale-result window in
  which a rapid seek could leave Core's background intent pointing at a
  released artifact.
- Adjacent navigation now retains the same source/direction/page-cap intent
  across strictly increasing request IDs. Core preserves both same-chapter
  continuation and cross-chapter exact ownership; Web performs one quantum per
  host turn with a typed `pending-adjacent` response, a 4096-attempt hard cap,
  latest-wins cancellation, and explicit foreground CAS. FFI/Flutter uses the
  dedicated ABI status `10`, the same one-quantum scheduling rule, and syncs
  internally consumed request IDs back to the public session baseline.
- Background work yields while any foreground candidate, retained exact seek,
  or retained adjacent intent exists. Worker wire loss after artifact creation
  and malformed foreground/background adoption acknowledgements now fail-close
  instead of leaving Core, Worker, and host visibility out of sync.
- Browser Canvas resource preparation and Flutter font preparation are bounded
  to four concurrent reads. Both use a work-pool rather than unbounded fan-out,
  keeping headroom below the Browser Worker's eight-message limit without
  serializing all resource I/O.
- Flutter publication, foreground/background adoption, one-quantum
  exact/adjacent continuation, resource identity validation, and an optional
  pre-adoption resource hook are statically connected. The default path still
  lacks owned, decoded image leases and WOFF/WOFF2 registration.
- Hikari Web's structural contract now requires proof of initial foreground
  adoption before a stack can exist. Replacement commits carry their CAS ACK;
  the owner changes current only after validating it and fail-closes the whole
  stack if a supposedly committed ACK is inconsistent. Kit capability
  negotiation remains fail-closed and no missing capability is advertised.
- A feature-gated Reader-v1 stage probe now records same-process fresh-session
  open, exact request, bounded parser/style/layout/pagination sub-stages,
  artifact encoding, and disposal for fixed `book-10` input. It has not run and
  cannot yet be cited as performance evidence.

### Immediate RC blockers after this checkpoint

1. Retained exact/adjacent ownership and foreground adoption are statically
   connected through Core, Web, FFI, and Flutter, but the complete guarded
   cross-language matrix has not rerun. An implicit page-one artifact remains
   forbidden.
2. The local page cap is not a byte cap. Resumable fragmentation and measured
   ownership limits are still required before adversarial blocks and live
   animation artifacts can be called memory-bounded.
3. `RITOPUB1` removes TOC/spine guessing, but Reader v1 still lacks the complete
   product interaction surface required by HikariNagi: exact selection and
   annotation projection, link/footnote/image actions, search, reading-position
   round trips, resize/reflow, theme, and typography. Kit must not claim those
   capabilities or wrap a legacy controller around native artifacts.
4. The HikariNagi Native-v1 negotiation seam therefore still falls back: Kit
   has no production `browserReaderV1ProductAdapter`, Web has no native product
   E2E authority, and Mobile has no final LN route consuming `rito_flutter`.
5. No performance exit gate is met until a controlled Reader-v1/TypeScript
   comparison has identical visible output. Production-only Reader-v1 latency
   can guide optimization, but it cannot be presented as the required 2x ratio.
6. Browser artifacts do not yet pin a Core-resolved unique face alias and exact
   fallback policy. Registering and selecting raw CSS family names can collide
   with global or system faces, so browser-grade typography and pixel parity
   are not yet proven.
7. Flutter's default font registrar rejects WOFF/WOFF2. A production-safe
   decoder/transcoder or registrar path is required for common embedded EPUB
   fonts.
8. Flutter `RITOPUB1`, foreground adoption, background advance/handoff, and
   retained adjacent are statically implemented; owned decoded-image leases are
   the active follow-up. The prior 83/83 suite validates only the older
   artifact/navigation/resource/lifecycle surface and does not cover these new
   changes or the complete Mobile Reader-v1 product contract.
9. Hikari persisted-locator and first-frame logic is implemented, but the
   Native-v1 path is not reachable without Kit's product adapter. Mobile still
   has no Hikari LN route consuming `rito_flutter`.
10. Exact foreground work now resumes its unpublished owner one host-scheduled
    quantum at a time. It still has no persistent checkpoint/materialized-window
    import, so a cold uncached deep seek remains `O(prefix)` and cannot claim
    browser-like random-access latency.
11. Candidate generation is no longer visibility publication in Core. Every
    product adapter must prepare resources, re-check latest intent, and perform
    the foreground CAS before paint; stale or failed candidates must remain
    explicitly releasable while the old animation source stays live.

### Deep-chapter rollover and checkpoint audit

The chapter-local rollover is an exact **in-process, forward-only state move**.
The real break token is the live `RuntimeChapterLayoutSession` object graph held
by the continuation record: continuous-flow `y`, collapsed margin, floats,
list state, active leaf/container state, plus the paginator's open page, used
height, previous-block geometry, policy, and page ordinal. Moving this state
preserves the current engine's forward semantics and avoids relaying an already
processed prefix on each adjacent turn.

It is not a reusable checkpoint. The public cursor is only an opaque lookup key;
the underlying state is neither cloneable nor serializable, cannot be imported
by a new session, and is consumed when rolled forward. The source-locator index
maps source text paths and anchors to already sealed page runs; it has no mapping
from a source position to a restorable formatting-flow state. Therefore:

- first open at an uncached deep locator remains `O(prefix)` layout after
  whole-chapter parse/style, even though only the target window is returned;
- a previously built exact window can be fast only if its immutable artifact is
  cached under the same publication/layout/font identity;
- exact random access can begin near a locator only from a valid predecessor
  checkpoint. With no checkpoint, exact prefix replay is required. A guessed
  height or direct DOM/source-node start is an approximate mode and is forbidden
  on the production path.

The rollover audit now has two resolved correctness items and one unresolved
memory blocker:

1. **Spread phase is fixed.** Chapter page origin now crosses rollover, and the
   narrow-window double-spread/`firstPageAlone` result matches a wider reference
   window by exact page indexes.
2. **Evicted predecessors fail closed.** Retained reverse navigation crosses a
   live previous window; an evicted predecessor returns
   `Blocked/TargetNotPublished` instead of being mistaken for a chapter
   boundary. Exact restoration/replay of that evicted window still requires a
   checkpoint.
3. **The page cap is not yet a strict memory cap.** A long paragraph accumulates
   completed lines until its block finishes, and pagination of one completed
   block is atomic. One paragraph/table/block can therefore place an arbitrary
   number of pages in the unpublished tail before the 16-page publication cap
   is applied. Live artifacts may also pin revisions outside the two-window
   retention queue. Peak ownership must be byte-bounded, and block/page
   fragmentation must be resumable.

The minimum exact checkpoint is versioned, renderer-neutral data containing:

- a publication/chapter/style/resource digest, the runtime layout key, exact
  font and image identities, line-breaking/hyphenation policy, and layout ABI;
- an ordered source frontier and next formatting-tree path;
- continuous-flow `y`, previous collapsed margin, active floats, container
  stack, list/counter stack, and any pending container tail;
- chapter page ordinal, first-page/spread phase, previous-block geometry, used
  height, and the bounded open-page fragment;
- total block/page progress and a checksum used to fail closed on corruption or
  identity mismatch.

Raw Rust structs, `StyledNode`, `LineContext`, and implementation enum layouts
are not a persistence format. Core imports/exports opaque versioned bytes; Web
IndexedDB, Mobile storage, or another host supplies storage without becoming a
Core dependency. The first checkpoint slice may yield only at stable block/page
boundaries. Page-granular checkpoints for a giant paragraph require a later
leaf fragmentation token carrying line/source/shaping and widows/orphans state.

Deep-chapter delivery is split into three implementation increments; these are
sub-steps of the existing RC rounds and do not renumber this plan:

1. **Exact sequential fallback:** harden rollover with chapter page/spread
   origin, correct missing-predecessor behavior, bounded `Ready | Pending` seek
   steps that retain work after the foreground budget, prefix-page discard, and
   ownership/byte telemetry. This is production-correct but cold deep seek
   remains `O(prefix)`.
2. **Exact materialized-window cache:** persist session-neutral target windows
   (typed display list, page interaction/semantic data, source interval, and
   resource references), prioritizing the last reading position and visited TOC
   targets. A cache hit rebinds new session/revision/artifact identities and
   performs no layout. Every entry is rejected on checkpoint-key mismatch.
3. **Forkable persistent break tokens:** replace owned pending-node queues with
   immutable shared formatting input plus indexed flow cursors, make paginator
   block splitting yield after page seals, add nested-container and leaf
   fragmentation tokens, and build predecessor checkpoints in bounded
   background work. A warm seek then replays at most the configured checkpoint
   interval. A never-visited cold target becomes sublinear only when checkpoint
   construction was completed earlier; the work cannot be eliminated, only
   moved off the critical path.

## 1. Outcomes And Scope

### 1.1 Round 4: HikariNagi integration RC

The Round 4 RC supports the HikariNagi reader's common horizontal, reflowable
EPUB profile in both C-end Web and Mobile. Web and Mobile use different
transport/render adapters over exactly the same versioned, platform-neutral
core semantics. It must provide:

- correct initial-locator restoration on the first committed visible frame;
- responsive cached turns and cancellable, latest-wins navigation;
- bounded foreground and background work with enforced memory limits;
- each product surface's approved page-turn animation, with no shortened
  duration or removed frames used to pass a performance gate;
- a stable, renderer-neutral `ChapterEngineSession` / `PageArtifact` contract;
- explicit capability reporting and fail-closed handling outside the supported
  profile;
- lifecycle, correctness, latency, memory, and real-book evidence from both
  HikariNagi C-end surfaces.

Round 4 does **not** claim complete browser CSS compatibility. Unsupported
content is reported before publication so the consuming product adapter can
select an approved fallback; it is never silently laid out approximately.

### 1.2 Rounds 10–14: browser-grade Native P0

Browser-grade means that, for every feature declared supported by the active
profile, Rito passes the pinned browser geometry, pagination, pixel, and
interaction gates in Section 8. It does not mean that one native output can be
pixel-identical to every Chromium and WebKit version simultaneously.

- Round 10 is the earliest browser-grade exit for the horizontal reflow
  profile.
- Rounds 11–14 become mandatory when the approved product support matrix
  includes complex table/float/positioned layout, Flex/Grid, vertical writing,
  advanced ruby, complex bidi/scripts, or fixed-layout/SVG content.
- No release may use “Round 10” as shorthand for broad EPUB compatibility if
  any required product profile remains unsupported.

Chromium at a pinned revision is the primary geometry and screenshot oracle.
Pinned WebKit is a differential check. When they disagree, the applicable CSS
and EPUB specifications plus an explicit reviewed product decision determine
the expected result.

## 2. Non-negotiable Decisions

1. **Keep animation.** Layout, scheduling, or transport work may not remove,
   shorten, snap, or otherwise disguise the configured page-turn animation.
2. **Target first.** When initialization includes a locator, page 1 may never be
   committed as an intermediate initialized state. The first visible artifact
   must own the requested target.
3. **Same output before speed.** A performance result is eligible only when the
   candidate and baseline execute the same input, font, viewport, output scope,
   and correctness contract. Rendering fewer pages, doing less work, or
   producing different output invalidates the ratio.
4. **Bound all work.** Foreground layout, background growth, revision retention,
   transport, caches, and disposal have explicit budgets and cancellation.
5. **No permanent dual authority.** Migration may shadow-run an old and a new
   formatting context. Once the replacement passes its cutover gate, authority
   switches and the replaced implementation is deleted in that round or the
   immediately following deletion-only change.
6. **No platform UI dependency in Core.** Browser DOM remains an oracle and may
   only be a separately approved Web-product fallback. HikariNagi Mobile's LN
   reader explicitly forbids a WebView transition. Canvas, Worker, Flutter, and
   platform UI types are equally forbidden in the core layout/runtime ABI.
7. **Stylo remains the CSS authority.** Rito does not resume a general-purpose
   CSS parser/cascade implementation.
8. **Taffy is a component, not the architecture.** It may own Flex/Grid after
   passing differential tests. It does not replace inline text, tables,
   fragmentation, ruby, writing modes, or pagination.
9. **The fragment model is the destination.** The durable layout contract is
   `FormattingTree + ConstraintSpace + BreakToken -> FragmentTree`, from which
   immutable page artifacts and display lists are produced.
10. **Production failures are explicit.** A missing capability, invalid exact
    locator, incomplete source range, or unavailable artifact produces a typed
    state. It never falls through to a plausible-looking wrong page.

## 3. Immediate Freeze Policy

The existing general-purpose layout path is feature-frozen from the start of
Round 1. The freeze covers the current continuous-layout, inline/text,
line-box, table/float workaround, and paginator implementations.

Changes to frozen code are allowed only when they are:

- required to unblock migration behind the stable boundary;
- a P0 correctness fix for the already-supported Round 4 profile;
- a measured latency, cancellation, disposal, or memory fix needed to pass an
  existing hard gate;
- instrumentation, test isolation, or deterministic oracle work;
- an adapter needed to shadow, cut over, or delete a legacy authority.

The following are forbidden in frozen code:

- adding another CSS property or value by string lookup;
- adding a new formatting-context approximation;
- expanding the narrow Flex exception;
- implementing Grid, vertical writing, advanced ruby, bidi, table, or float
  behavior as another legacy special case;
- weakening an assertion or tolerance to preserve legacy output;
- making the host or renderer infer missing layout, locator, or pagination
  semantics;
- optimizing eager whole-book layout at the expense of target-first work.

Every allowed change in frozen code must identify the exit gate it fixes. A
change without such a gate belongs in the replacement engine or is rejected.

## 4. Stable Platform-neutral Integration Boundary

A consuming product or platform adapter integrates with a versioned semantic
boundary, not with a particular layout implementation, Stylo type, WASM
allocation, browser Worker protocol, renderer, or UI framework.

### 4.1 Internal engine-provider seam

The current private `ChapterEngineSession` and `PageArtifact` Rust types are an
internal migration seam between runtime readers and the legacy layout provider.
They are **not protocol v1 and are not an App ABI**: they remain crate-private,
borrow Rust lifetimes, and may change while replacement engines are introduced.
Their purpose is to stop runtime consumers from inspecting legacy layout trees.

HikariNagi Web, HikariNagi Mobile, WASM, FFI, and Flutter must never consume
these private traits directly.

### 4.2 Public cross-platform runtime protocol v1

Round 3 introduces an owned, publication-level reader protocol, conceptually
`ReaderSessionV1` plus `ReaderArtifactV1`. It owns:

- open from publication bytes/source, user style, viewport, font capabilities,
  and an optional exact initial locator;
- seek to an exact source locator or navigation target;
- request a visible page/window with explicit priority, deadline, and request
  identity;
- update viewport, typography, theme, or font readiness by creating a new
  revision;
- continue optional background growth under a budget;
- cancel superseded work using latest-wins semantics;
- release artifacts/resources and dispose the session with acknowledgement.

Checkpoint and materialized-window cache integration is additive to this
boundary. Core may accept and emit opaque, versioned, checksummed cache blobs
and a typed pending-seek identity; it never opens a platform database or file.
A cache entry is session-neutral and is rebound to fresh runtime identities only
after its publication, layout, resource, font, and engine identities match.

The primary wire uses owned buffers, fixed-width integer/offset types, explicit
session/revision/request/artifact identities, and explicit allocation/release
ownership. It contains no borrowed Rust pointer, `usize` ABI field,
`serde_json::Value` primary payload, JavaScript safe-integer assumption, or
platform object handle disguised as core data.

Bindings may expose WASM/TypeScript, C/FRB/Dart, or other platform-shaped
functions, but those are projections of the same semantic protocol. They may
change without rewriting product logic as long as versioned semantics and
conformance digests remain intact.

### 4.3 `ReaderArtifactV1`

A `ReaderArtifactV1` is immutable and renderer-independent. It carries only
stable, paint-ready or interaction-ready data:

- protocol version, session identity, revision identity, artifact identity;
- capability/profile identity and diagnostics needed for a typed fallback;
- exact source/locator range and whether the extent is partial or terminal;
- page/spread geometry and immutable paint/display commands;
- resource references with explicit ownership and release behavior;
- reading order, links, anchors, hit entries, selection/source mapping, and
  accessibility semantics;
- continuation/break-token identity required to request adjacent content;
- enough evidence to reject stale artifacts before they can be committed.

It must not expose:

- `StyledNode`, `ComputedStyle`, Stylo internals, DOM nodes, Taffy nodes, Servo
  nodes, or formatting-context implementation types;
- mutable layout trees or pointers whose lifetime is owned by a Worker/FFI
  call;
- CSS strings that a platform adapter or renderer must parse;
- a full nested JSON layout tree as the primary transport;
- host-invented page boundaries, locator corrections, or reading order.

Text output must declare a rendering profile. Font bytes/IDs, fallback choices,
metrics, clusters, and source mapping are revision-owned. If string-level text
commands are used for Mobile day 1, their tolerated reshaping difference is
explicit and tested; browser-invariant text requires glyph IDs/positions and
clusters rather than silently asking Flutter to reconstruct browser layout.

### 4.4 Boundary invariants

- Dependency direction is one-way:
  `HikariNagi Web -> @ritojs/core/web -> rito-wasm -> rito-core` and
  `HikariNagi Mobile -> rito_flutter -> rito-ffi -> rito-core`; `rito-core`
  never imports a platform adapter.
- Core conformance tests run as pure Rust without a browser, JavaScript, Dart,
  Flutter engine, Canvas, or operating-system graphics context.
- Fonts, images, clocks, cancellation, storage, and platform resources enter as
  typed capability inputs/handles. Core never reaches into a platform UI API.
- A revision is immutable after publication.
- A visible artifact is committed atomically; partial construction is never
  observable.
- An artifact can be accepted only by the session/revision/request that owns it.
- A newer seek or revision invalidates every older unpublished candidate.
- Release and dispose are idempotent and produce measurable ownership cleanup.
- The first committed artifact after open owns the supplied initial locator.
- Background work may extend known extent but may not mutate already-sealed
  artifacts.
- HikariNagi Web and Mobile adapter integration may start when Round 3 freezes
  protocol v1. Layout-engine replacement after that point must remain behind
  this boundary, and the protocol must remain usable without a browser, DOM,
  Flutter engine, or JavaScript runtime.

## 5. Four Rounds To The HikariNagi RC

### Round 1 — Correct initial target and first publication

**Scope**

- Trace the locator through the platform adapter, core request, native
  candidate, pagination, artifact publication, and renderer commit. Current
  browser evidence additionally traces Worker/WASM/Canvas, but those are not
  core protocol requirements.
- Resolve the target spine/chapter and target-local source position before
  foreground layout starts.
- Make the target page/window the first publishable foreground output. Exact
  cold fallback may process and discard prefix layout, but it may never expose
  those prefix pages as an initialized artifact.
- Gate publication so a default page cannot win while a supplied locator is
  unresolved.
- Keep bounded work and delayed-font behavior revision-safe.
- Resume a locator beyond one chapter-local window through exact rollover; do
  not raise the page cap or restart the chapter for each window.

**Deliverables**

- A single explicit initial-target state machine with typed failure states.
- A bounded `Ready | Pending` deep-seek state that survives exhaustion of one
  foreground budget and can continue in background without discarding completed
  exact work.
- Core-level first-accepted-artifact coverage plus real Worker + Canvas
  cold-start adapter E2E, not only unit coverage of a selected spread index.
- Fixtures covering supported locator/anchor kinds at chapter start, middle,
  and tail; single/double page; cached/uncached; representative viewport and
  delayed-font cases.
- Trace evidence identifying the first requested, published, accepted, and
  painted artifact.

**Hard exit gates**

- The first core-accepted visible artifact owns the requested locator in every
  supported case; the Web adapter's first Canvas frame must own that artifact.
- Page 1 is never accepted or displayed first when a different valid locator
  was supplied.
- No stale default candidate can overwrite the target after cancellation or a
  revision change.
- Missing/unsupported targets produce a typed result; no silent page-1
  fallback.
- A source locator beyond page 40 in one XHTML resolves to the same page,
  spread grouping, display-list semantic digest, text/hits/semantics, and source
  ownership as eager exact layout. Single and double spreads, including
  `firstPageAlone`, are mandatory.
- Crossing each rollover has no page gap, replay, or repeated first-page
  isolation. Navigating backward from an evicted same-chapter window never
  crosses a spine boundary by mistake.
- Existing animation behavior is unchanged.
- The focused tests, lifecycle tests, lint, typecheck, core tests, and builds are
  green.

The equivalent first-Flutter-frame gate is mandatory in Round 4 once
`rito_flutter` exists; the browser harness cannot satisfy it on Mobile's behalf.

**Not in this round**

- New CSS/layout features.
- Browser-grade layout replacement.
- Animation redesign or removal.

### Round 2 — Responsiveness, cancellation, and bounded memory

**Scope**

- Enforce priority lanes: visible target and animation support, then adjacent
  cache warming, then cancellable background growth.
- Make rapid seeks latest-wins across host queue, Worker, native candidate,
  publication, and frame acceptance.
- Coalesce progress/publication traffic and remove request/revision fan-out that
  does not contribute to the visible target.
- Add explicit cache, candidate, frame, backing-store, and continuation budgets.
- Add backpressure and deterministic cleanup; keep UI input and animation
  independent of background pagination.
- Enforce byte bounds on unpublished pagination tails and active block
  fragments; a nominal published-page cap does not qualify as a memory bound.

**Deliverables**

- Scheduler state/queue telemetry including priority, queue depth, cancellation
  latency, stale-result drops, platform-bridge round trips, artifact bytes, and
  owner counts. Web additionally records Worker traffic; Mobile records its
  native/Flutter bridge traffic.
- Memory-guarded named-corpus latency and memory reports.
- A 10-seek-in-one-second stress test plus replacement/open-close lifecycle
  tests.
- Removal of known unbounded queue, owner, or full-frame materialization paths
  found by the profiles.
- Deep-locator cold/warm checkpoint telemetry: source percentile, processed
  prefix pages/nodes, checkpoint distance, cache-hit kind, unpublished-tail
  high-water mark, active-fragment bytes, and retained/pinned revision owners.

**Hard exit gates**

- TOC input acknowledgement is at most 50 ms p95.
- For loaded content the target is visible within 250 ms p95; after 10 rapid
  seeks the final target is visible within 500 ms of the final input and no old
  target publishes afterward.
- For uncached local EPUB content feedback appears within 100 ms and the final
  target is visible within 1 second p95 on the named corpus.
- A cached page turn responds within 50 ms p95 and has the target artifact ready
  within 100 ms p95.
- At most 16 foreground core continuation requests occur before the first
  target frame; Web Worker messages and Mobile bridge calls are reported
  separately. Pending session queue depth remains bounded and stale work cannot
  accumulate.
- The configured animation duration and trajectory remain unchanged; frame time
  meets the display budget at p99, dropped frames stay below 1%, and a turn adds
  no UI-thread task longer than 50 ms on the named device. Web main-thread and
  Mobile main-isolate evidence are both required.
- The existing replacement-growth limit of 96 MiB passes. Twenty open/close
  cycles and 1,000 retained updates show no unbounded growth and at most 10%
  post-stabilization drift.
- Peak pagination ownership remains within the declared byte budget for a
  40-page ordinary chapter, a single 40-page paragraph, and a table/block whose
  atomic legacy output previously exceeded the local page cap. Two retained
  windows plus artifact-pinned revisions are all counted.
- Every benchmark/test process tree runs under the 3 GiB tripwire; no unguarded
  high-parallelism full-corpus or full-book command is accepted as evidence.

**Not in this round**

- Layout-engine substitution for its own sake.
- Eager full-book completion as a foreground success metric.
- Reducing animation work by changing the product animation.

### Round 3 — Freeze the platform-neutral protocol

**Scope**

- Implement and version `ChapterEngineSession` / `PageArtifact` protocol v1.
- Put current layout behind the boundary as a temporary provider.
- Make exact locator, partial extent, continuation, interaction, resource, and
  lifecycle semantics explicit.
- Move any remaining Web- or Mobile-owned layout policy into core requests or
  typed core results.

**Deliverables**

- Public contract and compatibility tests for protocol v1.
- A primary packed/binary artifact path and a bounded compatibility projection
  where migration still requires it.
- `crates/rito-ffi`: a thin, generated/bindable native session interface over
  the same protocol, with no layout policy or renderer inside the FFI layer.
- `packages/rito_flutter`: the git-dependency Flutter adapter required by
  HikariNagi Mobile M3. It owns Dart/FRB lifecycle, artifact decoding, resource
  access, and Flutter renderer integration—not EPUB parsing or pagination.
- Binding examples for Web and Mobile covering open-at-locator, turn, seek,
  reflow, cancellation, resource release, and dispose.
- A Web WASM/Worker projection and a Mobile native/Flutter projection that pass
  the same protocol conformance vectors and semantic digests.
- An engine-provider conformance suite that both the legacy adapter and every
  replacement formatting engine must pass.
- Additive conformance vectors for pending deep seek and opaque cache/checkpoint
  import rejection. Platform projections may store bytes differently, but Core
  alone decides whether an entry is valid and which artifact it represents.

**Hard exit gates**

- Neither HikariNagi Web nor Mobile imports layout, Stylo, DOM, Taffy, Servo, or
  paginator implementation types.
- Web WASM and Mobile FFI produce identical semantic digests for the same core
  input/revision/artifact vectors; transport encoding may differ, semantics may
  not.
- Direct Rust, WASM, and FFI/Dart replay the same conformance corpus; Android
  and iOS adapter build smoke is green before product handoff.
- Architecture tests reject DOM/Canvas/Worker/Flutter/UI dependencies in Core
  and reject borrowed pointers, `usize`, `serde_json::Value`, CSS value strings,
  or JS safe-number assumptions in the primary v1 wire.
- The text-rendering profile pins font identity/bytes, metrics, fallback,
  clusters, source mapping, and the declared string-vs-glyph command mode.
- Artifact acceptance rejects wrong session/revision/request identities.
- Packed and compatibility projections have identical semantic digests.
- Open/seek/reflow/release/dispose pass under Web Worker reuse/termination and
  Mobile session/bridge reuse/termination.
- Round 1 and Round 2 gates stay green through protocol v1.
- Public exports remain small, named, versioned, and architecture tests enforce
  the boundary.

**Not in this round**

- Freezing internal Rust/WASM/FFI function names as the product protocol.
- Exposing a mutable tree so Web or Mobile can repair core output.
- Broad CSS compatibility claims.

**Product handoff:** HikariNagi Web and Mobile integration can proceed in
parallel as soon as this round is green.

### Round 4 — HikariNagi Web + Mobile integration RC

**Scope**

- Integrate protocol v1 in the real HikariNagi C-end Web and Mobile paths.
- Keep Web on its browser adapter; implement the Mobile LN reader through
  `rito_flutter` with Flutter-side painting and no reader WebView.
- Exercise the named real-book corpus on release-like browsers, mobile devices,
  and builds.
- Complete capability detection/fallback routing for content outside the RC
  profile.
- Close packaging, lifecycle, observability, error, and compatibility gaps.

**Deliverables**

- A versioned Native Core RC, Web package, `rito-ffi`, and `rito_flutter`, with
  integration and compatibility notes.
- A declared RC capability matrix with no implicit “best effort” cells.
- Named-machine correctness, latency, animation, memory, cancellation,
  replacement, and disposal reports.
- A low-end Android device report covering native first frame, interruptible
  page-turn frame pacing, memory, typography reflow, and whole-volume bounded
  background work.
- A triaged unsupported-book report with explicit fallback behavior.

**Hard exit gates**

- All Section 8 product RC gates pass twice consecutively on both Web and Mobile
  from clean isolated sessions without threshold changes.
- The supported real-book corpus opens at the right first position, turns,
  seeks, resizes, changes typography, selects, links, searches, restores, and
  disposes through both product paths using the same core protocol semantics.
- Web and Mobile round-trip the same server-side position, bookmark, annotation,
  and reading-setting locators without converting them into platform-local page
  identities.
- Mobile renders core-produced page artifacts in Flutter and contains no
  WebView-backed light-novel reader or Dart-side pagination/layout repair.
- The controlled, same-output Native Core workload is at least 2× faster in
  median than the TypeScript reference baseline. End-to-end cold open is no
  more than 1 second p95 on each named Web and Mobile device; this does not
  require embedding the TypeScript baseline in Mobile.
- No production import of the TypeScript reference core or legacy CSS resolver
  exists.
- Unsupported content is rejected/routed before a wrong artifact is committed.
- Lint, typecheck, tests, architecture checks, and production builds are green.

**Not in this round**

- Claiming browser-grade correctness outside the RC capability matrix.
- Keeping a failed native path active because a later correction looks right.
- Blocking HikariNagi Web or Mobile integration on Rounds 5–14.

## 6. Rounds 5–14 To Browser-grade P0

### Round 5 — Controlled browser baseline and dependency-cut spike

**Scope and output**

- Pin Chromium, WebKit, fonts, DPR, viewport, UA/reader styles, color settings,
  fixture hashes, and capture procedure.
- Record computed values, fragment/line/page geometry, screenshots, locators,
  hit results, and reading order.
- Prototype a DOM-free input boundary for selective Servo-derived formatting
  algorithms and measure dependency size, memory, build, correctness, and
  upgrade surface.
- Produce a reviewed go/no-go per formatting context; do not approve a wholesale
  Servo/Blitz embedding.

**Hard gate**

The oracle is reproducible, the first WPT/EPUB/corpus shards run automatically,
and the chosen dependency strategy demonstrates that it can emit the Rito-owned
fragment contract without `script`, DOM, WebRender, or platform-adapter-visible
engine types.

**Not in this round:** permanent forks, broad ports, or performance claims from
different outputs.

### Round 6 — Fragment substrate and cache model

**Scope and output**

- Implement the Rito-owned `FormattingTree`, typed `ConstraintSpace`, immutable
  `FragmentTree`, `BreakToken`, intrinsic-size interfaces, and input-keyed
  fragment caches.
- Connect fragment artifacts to protocol v1 behind an engine-provider flag.
- Define formatting-context traits that allow selectively derived Servo
  algorithms and Taffy without leaking either into platform adapters or runtime
  consumers.

**Hard gate**

Fragment creation, caching, invalidation, cancellation, serialization, and
release pass deterministic and memory-bounded tests; a minimal block/inline
fixture can shadow-run without changing production authority.

Reader-semantic capabilities are engine-independent and must survive every
provider swap unchanged: footnote asides (and equivalent out-of-flow reader
content) stay excluded from the formatting-tree input, noteref/anchor/TOC
targets, footnote content extraction, hits/semantics, and selection/source
mapping keep their existing typed outputs. The browser oracle's pinned
capture procedure already encodes these semantics (the baseline is the
browser rendering what a reader renders); any fragment provider must pass
the same oracle without weakening that procedure.

**Not in this round:** another continuous-coordinate tree or page slicing after
unbounded full-document layout.

### Round 7 — Typed Stylo bridge; delete JSON style materialization

**Scope and output**

- Replace `Stylo -> materialize -> StyledNode.style JSON -> string lookup` with
  shared typed computed values/IDs consumed by the formatting tree.
- Retain style sessions, rule trees, inheritance, viewport/theme invalidation,
  generated content, and required animation state.
- Establish explicit property capability reporting.

**Hard gate**

Selector/cascade/value and production corpus parity are green, retained style
and invalidation performance meet existing style gates, memory remains bounded,
and production contains no JSON/string CSS lookup path.

**Not in this round:** reconstructing Stylo values as strings for adapter
convenience.

### Round 8 — Browser-grade inline and text formatting

**Scope and output**

- Implement/port inline item construction, whitespace, shaping, font fallback,
  segmentation, line breaking, bidi ordering, baseline/vertical-align, inline
  decoration fragmentation, source-offset mapping, and physical fragments.
- Select HarfBuzz/HarfRust/Parley components only through pinned Chromium
  differential and book-corpus evidence; Parley is not treated as a complete CSS
  inline engine.

**Hard gate**

The supported CSS Text/Fonts/Inline/Writing Modes horizontal shards and corpus
meet exact line-break/source-order gates and Section 8 geometry/pixel limits.
Selection and hit testing remain exact. The new inline/text provider becomes
authority for the passing profile.

**Not in this round:** keeping the legacy line breaker as an unbounded fallback
inside a supposedly supported profile.

### Round 9 — Block formatting and page fragmentation

**Scope and output**

- Implement/port block formatting, margin collapsing, intrinsic contribution,
  containing blocks, clearance hooks, and recursive break-token propagation.
- Move page/column fragmentation, `break-*`, widows/orphans, forced/avoid
  breaks, resource readiness, and resumable target-first pagination into the
  fragment engine.
- Emit sealed page artifacts directly from fragments.

**Hard gate**

Supported block/fragmentation WPT, EPUB tests, and the horizontal corpus pass;
initial locator, cached turn, TOC, animation, memory, and background-growth
gates remain green under the new authority. Pagination no longer depends on
laying out a complete continuous chapter first.

**Not in this round:** host-side page slicing or legacy paginator correction of
new fragment output.

### Round 10 — Horizontal browser-grade cutover

**Scope and output**

- Switch the horizontal reflow profile completely to typed style + fragment
  inline/block + fragment pagination.
- Delete the replaced continuous, inline/text, and paginator authorities and
  their production feature flags.
- Run the complete pinned horizontal WPT/EPUB/real-book and same-output
  performance/memory gates.

**Hard gate**

Section 8 browser-grade gates pass twice consecutively, protocol v1 remains
compatible across Web and Mobile, no legacy authority is reachable in
production, and unsupported extended features fail before publication.

**Not in this round:** calling the extended profile complete.

### Round 11 — Tables, floats, and positioned content (conditional)

**Trigger:** mandatory if any approved product P0 publication requires these
features.

Implement/port their full formatting-context and fragmentation behavior. Cut
over each context only after its WPT/EPUB/corpus geometry and page-break gates
pass, then delete the corresponding pragmatic legacy implementation. Narrow
cover/image exceptions do not count as general support.

### Round 12 — Flex and Grid through Taffy (conditional)

**Trigger:** mandatory if Flex/Grid is in the approved product P0 profile.

Adapt typed style, intrinsic/text measurement, writing direction, fragment
generation, and fragmentation around Taffy. Pass pinned browser differentials
for the declared subset. Delete the fixed-height, row/nowrap, single-image
legacy Flex exception after cutover. Do not route inline text or page
fragmentation through Taffy.

### Round 13 — Vertical writing, advanced ruby, bidi, and complex scripts

(conditional)

**Trigger:** mandatory for CJK vertical, advanced ruby, RTL/mixed-direction, or
complex-script product P0 content.

Complete logical/physical axis handling, vertical metrics, emphasis, ruby
alignment/overhang, bidi isolation/order, fallback, shaping, caret/source
mapping, and fragmentation. Pass writing-mode-specific first-locator,
navigation, selection, geometry, and pixel gates before enabling the profile.

### Round 14 — Extended cutover and final legacy removal (conditional)

**Trigger:** mandatory when any Round 11–13 work is required or when the product
P0 includes fixed-layout/SVG integration.

Finish fixed-layout/resource integration required by the declared profile,
remove all remaining dual-engine flags and compatibility layout trees, rehearse
upstream dependency upgrades, and run the full production corpus twice from
clean isolated processes. The round ends only with a single production
authority per formatting context and an explicit unsupported matrix for
everything outside P0.

## 7. Deprecation And Deletion Ledger

| Legacy item                                                                   | State now                                 | Replacement                                                   | Deletion trigger                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| General-purpose legacy layout feature work                                    | Feature-frozen; test-enforced             | Fragment formatting contexts                                  | Freeze is immediate; code is removed context by context after its replacement passes cutover                      |
| `StyledNode.style` JSON map, `stylo_materialize`, CSS string lookup in layout | Deprecated; migration-only                | Typed shared Stylo computed values/IDs                        | Delete in Round 7 after selector/value/corpus parity, invalidation, and memory gates pass                         |
| Legacy inline item, line-break, line-box, and text authority                  | Frozen                                    | Browser-grade fragment inline/text provider                   | Delete its production authority after Round 8 gate; delete residual adapters at Round 10                          |
| Continuous-layout authority                                                   | Frozen                                    | Constraint-space fragment block layout                        | Delete when Round 9 pagination/geometry/locator gates pass, no later than Round 10 cutover                        |
| Legacy paginator/page-slicing authority                                       | Frozen                                    | BreakToken-driven fragment pagination                         | Delete with continuous authority after Round 9/10 cutover                                                         |
| Pragmatic table/float/position workarounds                                    | Frozen                                    | Browser-grade formatting contexts                             | Delete each context in Round 11 immediately after its differential cutover                                        |
| Narrow Flex cover exception                                                   | Frozen; no expansion                      | Taffy-backed Flex adapter                                     | Delete after Round 12 gate                                                                                        |
| Private borrowed `ChapterEngineSession` / `PageArtifact` seam as product ABI  | Forbidden; internal migration only        | Owned `ReaderSessionV1` / `ReaderArtifactV1`                  | Round 3 protocol and binding conformance gates                                                                    |
| Full nested JSON `RuntimeFrame` compatibility materialization                 | Deprecated; reads behind the private seam | Packed `ReaderArtifactV1` transport                           | Delete after protocol-v1 Web and Mobile adapters use the packed artifact and semantic-digest/lifecycle gates pass |
| JS safe-number assumptions and `serde_json::Value` in primary core wire       | Deprecated; adapter compatibility only    | Fixed-width owned v1 schema                                   | Move JS projection to WASM adapter and reject these types from primary v1 in Round 3                              |
| CSS value/color strings or renderer reshaping as an implicit paint contract   | Deprecated                                | Typed paint plus declared text profile                        | Web/Flutter conformance and pixel gates pass in Rounds 3–4                                                        |
| TypeScript core in production                                                 | Forbidden                                 | Rito Native Core                                              | No production import at Round 4; retain only as a historical test oracle until browser baseline is active         |
| TypeScript core as visual authority                                           | Temporary oracle                          | Pinned browser baseline                                       | Demote after Round 5 controlled baseline; keep only reviewed regression fixtures                                  |
| WebView/DOM/Canvas/Flutter inside Native Core                                 | Rejected                                  | Platform-neutral core; browser oracle and UI stay in adapters | Never introduced; Mobile LN WebView is also forbidden                                                             |
| Migration engine flags/adapters                                               | Temporary only                            | One authority per profile/context                             | Delete after two consecutive clean cutover runs and rollback evidence is archived; no indefinite fallback flag    |

Deletion means removal from the production dependency graph and code path, not
merely making a flag default to off. Test-only historical fixtures may remain in
an explicitly named reference area when they provide unique regression value.

## 8. Hard Release Gates

### 8.1 Eligibility and reproducibility

A performance comparison is rejected unless all of these are identical or
explicitly normalized:

- EPUB bytes and decoded source;
- engine/profile version and enabled feature set;
- viewport, DPR, spread mode, pagination style, zoom, theme, and user CSS;
- font files, fallback order, readiness timing, rasterizer, and shaping options;
- requested locator and exact output extent/pages;
- build mode, device identity, platform/browser/runtime version, session
  isolation, and cache state.

Before timing ratios are reported, the correctness gate for that workload must
pass. A bounded-first-frame run may be reported as first-frame latency, but may
not be compared with a full-layout run as “core speed.” A full-book timing with
different pages or paint output is diagnostic only and has no official ratio.

Deep-locator reports use the same EPUB at chapter source positions near 10%,
50%, and 90% and report these paths separately: cold with no checkpoint, exact
materialized-window hit, and exact predecessor-checkpoint restore at distances
0, 1, 4, and 8 pages. Each timed sample first verifies locator ownership,
spread page indexes, display-list semantic digest, page text, hit/semantic data,
source starts, and resource references against eager exact layout. A mismatch
removes that sample and its speed ratio from release evidence.

### 8.2 Correctness

For the supported profile:

- source text, reading order, locator ownership, anchors, links, glyph cluster
  order, line breaks, and page breaks match the pinned primary oracle exactly;
- interaction/source ranges are continuous and exact; generated gaps are typed;
- p99 fragment edge deviation is at most 0.25 CSS px and maximum deviation is
  at most 0.5 CSS px under pinned fonts and inputs;
- Web and Mobile receive identical page/line/source geometry and semantic
  artifact digests for identical inputs;
- each platform renderer's page screenshots reach SSIM >= 0.995 and at most
  0.5% changed pixels against its pinned platform baseline after the versioned
  antialiasing mask; Flutter and Canvas raster pixels are not compared as if
  their rasterizers were identical;
- every WPT and EPUB-test case declared inside the profile passes; expected
  failures are allowed only outside the profile and are listed in the capability
  matrix;
- every real-book mismatch has an owned classification: engine bug, unsupported
  capability, oracle difference, invalid publication, or reviewed product
  decision;
- an initial locator is present in the first committed artifact/frame, never a
  later corrective jump.

Threshold calculation, screenshot mask, corpus hashes, and browser/fonts are
versioned. They cannot be changed in the same change that is trying to pass a
failed gate without an independent baseline review.

### 8.3 Reader latency and animation

- The controlled Native Core workload, including EPUB decode, CSS, required
  fonts, target layout, and first correct artifact, is at least 2× faster in
  median than the same-output TypeScript reference baseline.
- End-to-end first visible frame is at most 1 second p95 on each named Web and
  Mobile device. Web Canvas and Flutter raster timing are reported separately;
  neither may substitute for the other.
- Cold deep-locator latency, exact-window cache-hit latency, and predecessor-
  checkpoint restore latency are reported independently with p50/p95, CPU,
  processed prefix work, checkpoint distance, and cache bytes. Rollover alone
  is not reported as random-access acceleration.
- The current named-Web and named-Mobile per-fixture usability manifests remain
  gates; when one conflicts with this plan, the stricter threshold applies.
- Cached turn acknowledgement is at most 50 ms p95 and target-artifact readiness
  at most 100 ms p95.
- Loaded TOC target is visible within 250 ms p95; rapid latest-wins and uncached
  targets meet the Round 2 bounds.
- Typography/viewport reflow meets the existing 300 ms named-fixture bound and
  never commits a stale revision.
- Animation duration and trajectory remain fixed. Frame time meets the actual
  display refresh budget at p99, dropped frames are below 1%, and no page turn
  introduces a Web main-thread or Mobile UI-isolate task longer than 50 ms.
- Background parsing/layout/pagination and progress reporting never block
  current-frame rendering, input acknowledgement, or animation.

### 8.4 Memory, cancellation, and lifecycle

- All builds, corpus runs, and benchmarks use bounded parallelism and a sampled
  3 GiB process-tree tripwire; CI/release evidence adds an OS/container-enforced
  limit.
- Replacement growth is at most 96 MiB on the named memory gate.
- Twenty open/close cycles and 1,000 retained updates have no unbounded growth
  and at most 10% memory drift after stabilization.
- At most one foreground and one bounded background candidate are owned per
  session; superseded unpublished artifacts cannot accumulate.
- Published-window count, artifact-pinned revisions, active block/leaf state,
  paginator open page, and unpublished tail are all charged to explicit byte
  budgets. A page-count cap without a bound for an atomic long block does not
  pass this gate.
- Ten rapid seeks are latest-wins through native work and publication. An old
  artifact can never overwrite the newest request.
- Release/dispose drains revisions, fragments, frames, resources, source
  indexes, caches, and binding/session ownership, then acknowledges completion.
  Web Worker handles and Mobile FFI/FRB handles are measured independently.
- No evidence run that exceeds the memory guard, omits output equivalence, or
  loses telemetry may be used to pass a round.

### 8.5 Engineering and architecture

Every round that changes production code runs, in proportion to the touched
surface:

- Rust format, tests, clippy, and relevant WASM builds/tests;
- TypeScript lint, strict typecheck, Vitest, architecture invariants, and builds;
- FFI ABI checks plus Dart/Flutter analyze, tests, Android/iOS build smoke, and
  native-handle lifecycle tests once those adapters exist;
- focused Web Reader E2E and Mobile Flutter integration/device tests, then the
  named usability, memory, release-protocol, and real-book corpus gates at
  milestone cutovers;
- `git diff --check` and a production dependency/import audit.

Layout remains platform/renderer independent. Platform renderers consume typed
paint-ready artifacts and do not parse CSS values. Public exports go through
the package entry points and never expose unstable internals.

## 9. Evidence Required At Every Round

Each completed round commits or links one compact evidence manifest containing:

- source commit and dirty-state declaration;
- exact commands and build profiles;
- named machine/runtime/browser/font/corpus identities and hashes;
- correctness result and unsupported-profile list;
- latency distribution with independent process/session sample count;
- peak process-tree RSS, WASM memory, JS heap where applicable, replacement
  growth, and lifecycle result;
- request counts, queue depth, cancellation/stale-publication result, and first
  committed locator for Reader rounds;
- changed production authority and legacy code deleted;
- remaining blockers assigned to the current or next explicit round.

“Tests pass” without the manifest is not completion. A benchmark with a
different output is labeled diagnostic and cannot support a performance claim.

## 10. Execution Order Starting Now

1. Enforce the freeze policy in review and reject new legacy layout features.
2. Execute Round 1 until the real first-Canvas locator gate and exact
   deep-chapter rollover gates are green. Then land the exact materialized-
   window cache before claiming warm-open speed; persistent break-token work
   continues behind the same boundary.
3. In parallel, profile Round 2 scheduling/memory using guarded, bounded runs;
   do not rerun uncontrolled full-book matrices.
4. Freeze protocol v1 in Round 3 and hand it to HikariNagi Web and Mobile
   integration immediately.
5. Produce the Round 4 RC while Round 5 browser-baseline and dependency-cut work
   proceeds behind the same provider boundary.
6. Migrate and delete one authority at a time in Rounds 6–10.
7. Execute Rounds 11–14 only for features in the approved product P0 support
   matrix, but never silently approximate an omitted feature.

The critical path to HikariNagi C-end Web and Mobile use is therefore exactly
four gated rounds. The browser-grade path is ten rounds for the horizontal
reflow profile and at most four additional gated rounds for the extended
profile. No future layout-engine decision is allowed to reopen the
platform-neutral integration boundary or reintroduce the frozen legacy
architecture.
