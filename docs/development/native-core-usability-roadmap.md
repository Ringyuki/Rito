# Native Core Usability And Baseline Roadmap

Status: active direction record, 2026-07-13.

This document owns the phase order for the Rust reader. The more detailed
architecture and migration documents remain authoritative for boundaries and
implementation constraints, but their older display-parity or wire-format
priorities do not override this roadmap.

## Product Direction

Work proceeds in this order:

1. Make the Rust engine genuinely usable as a reader.
2. Replace the TypeScript migration oracle with a controlled WebView/DOM
   rendering baseline.
3. Continue long-term rendering-capability expansion and broad performance
   tuning against that baseline.

This order has one important qualification: bounded initial work and a minimum
latency floor are part of usability. Incremental pagination cannot be deferred
as optional optimization work. Micro-optimization and broad throughput tuning
belong to the later performance phase.

## Current Baseline

The production content path is already Rust-backed:

- EPUB/ZIP, OPF, navigation and resource indexing;
- XHTML and CSS processing;
- style resolution, text shaping, layout, line breaking and pagination;
- navigation, search, footnotes and text geometry;
- display commands, packed frames, revisions and Rust-side caches.

The old TypeScript engine under `packages/rito/src/reference/ts-core/**` is a
source-only migration oracle. It is not a production fallback.

The production Browser Reader now selects the bounded core/WASM/Worker session.
It publishes stable partial extents, grows spreads and locators without rebuilding
committed work, and no longer uses the legacy `createViewRevision`
preview/deferred-full scheduler. Page/link/image/footnote targets, exact
selection/copy, source annotations, reading-position restoration and
visible-spread accessibility are wired through the public Reader and Kit.

The remaining usability work is narrower but still release-blocking:

1. A single large paragraph, table or contextual shaping call remains atomic,
   and the first publication-wide footnote scan remains outside the layout
   budget.
2. Search still drains pagination eagerly and searches laid-out page text. It
   now returns a proven durable source range and resolves visible geometry
   lazily, but still needs a publication source/chapter index.
3. Exact text and annotation geometry remains same-logical-flow; cross-flow
   selection is a deliberate capability gap.
4. The Reader app now has a licensed, app-owned v1 serif fallback and real-book
   shaping/paint proof. It is not a locale-complete, sans-serif, or monospace
   policy, and its cold-start and memory cost still belong in the release gate.
5. The browser shell still owns some candidate/current-session, commit,
   cache and font-reflow policy that should become explicit Rust-authored host
   operations.
6. The 2026-07-13 74-EPUB smoke and complete strict reader parity matrix are
   green, but the formal named-machine usability and latency gate has not been
   declared.

## Phase 1: A Usable Rust Reader

### 1. Bounded, Stateful Pagination

Production now uses a bounded layout session rather than chapter-count preview.
It already:

- defines an initial top-level-node budget and stable partial page window;
- stops inside a large XHTML spine item between top-level nodes;
- retains an opaque continuation cursor and resumes without rebuilding completed
  work;
- supports cancellation and stale-revision disposal;
- grows navigation and page totals incrementally and preserves a stable source
  locator across reflow and window growth;
- requests the resources needed by active and warm windows.

The remaining bounded-layout work is to propagate a resumable budget inside one
large top-level block/table/paragraph and its shaping work, rather than treating
that node as an atomic quantum. Publication-wide source indexes must likewise be
budgeted instead of front-loading a full-spine scan.

Revision identity is now defined across the asynchronous interaction and
continuation APIs. A browser-side ownership handle distinguishes Worker/session
identity and browser commit generation in addition to the Rust-local revision id. The
incremental form exposes whether it is ready, complete, cancelled or
failed, the currently known spread extent and an optional final extent. Rust
revision ids are not treated as globally unique across Worker sessions.

The source locator contract represents a source point or range and stable
progression, not only an href. Locators into unpaginated regions request bounded
growth and are re-resolved after font or viewport reflow.

The first useful frame no longer depends on laying out the first eight chapters
or the full publication. It can still depend on one atomic large top-level node,
which is the remaining latency violation.

Exact bounded publication has algorithmic constraints that must remain explicit:

- greedy line prefixes can become stable and publish incrementally once
  widow/orphan lookahead and open-block paint edges are preserved;
- optimal paragraph breaks depend on the complete paragraph. Item construction
  and dynamic programming can yield between budgets, but the paragraph cannot
  publish before completion unless a forced-break boundary proves a prefix;
- auto table column widths depend on a whole-table intrinsic-width prepass. The
  prepass can be resumable and rows can publish after widths freeze;
- one contextual shaping call, especially a huge `nowrap` run, is an atomic
  black box unless it moves to interruptible/background native execution;
- publication-wide cross-chapter footnote exactness requires a cached,
  resource-light source index. It may scan XHTML targets and note candidates,
  but must not retain every chapter DOM or mark lazy chapters/resources loaded.

The eager entry point should eventually drain the same resumable state machines
with an unbounded budget. Maintaining separate eager and bounded algorithms
would make exact final equivalence progressively harder to prove.

### 2. Complete Native Interaction Wiring

The worker and public Reader contract now expose Rust-owned semantic and
geometry operations for:

- page targets and links;
- point hit testing;
- text positions and text-range geometry;
- selection anchors, focus movement and selected text;
- durable search-result source ranges and lazy visible-result highlight geometry;
- annotation anchors and resolution after reflow;
- source locators, bookmarks and reading-position restoration;
- footnote targets;
- accessibility reading order and semantic ranges.

The first vertical slice was current-visible-spread link, image and footnote
targets plus typed href locator resolution. Exact point-to-caret hit testing,
shaped character boundaries, selected text and precise same-flow range geometry
now back selection/copy/annotation UI. Linear interpolation across a
variable-width run is not an acceptable extension for cross-flow or unavailable
content.

Exact text interaction also requires shaping provenance from the same font
bytes used to paint the run. EPUB-provided fonts can satisfy that invariant
inside Rust. A browser-supplied table of generic/system-font character and pair
widths cannot reconstruct glyph clusters, ligature carets, script direction or
legal grapheme boundaries. Such a run must report text geometry as unavailable
until the reader either uses a pinned fallback font visible to both Rust and
Canvas, or gains an equally explicit host-shaping contract. It must never fall
back to per-character width interpolation. Ligatures without authoritative
internal caret data are selectable only as atomic clusters.

The deterministic path uses pinned fallback font assets shared by Rust shaping
and a uniquely aliased browser `FontFace`; a font present only in Rust, while
Canvas still resolves `serif` or a platform family independently, does not close
the contract. Host/DOM shaping remains a possible explicit platform-dependent
mode and a useful reference harness, not the default native layout policy.

The first production Reader-app preset is app-owned rather than a hidden core or
React default. It combines Tinos Regular as `serif`/`und` with Source Han Serif
CN Regular as `serif`/`zh-hans`. Both are static, licensed assets with audited
SHA-256 identities. This is the v1 generic-serif baseline, not a claim of
locale-specific CJK typography or complete `sansSerif`/`monospace` coverage.
Other hosts remain responsible for choosing, licensing, packaging, and loading
their own policy before they create a Reader.

The private exact-version shape diagnostic and real-WASM corpus runner provide
the selection evidence without widening the public Reader API. The completed
2026-07-13 comparison opened and fully paginated all 39 top-level EPUB inputs
(36 unique contents) in both profiles. On unique contents, exact base-text run
coverage rose from 3.00% without the policy to 99.95% with it; exact UTF-16 text
coverage rose from 2.40% to 99.95%. The pinned profile left 626 UTF-16 code units
on host fallback and 2,219 explicitly synthetic units unavailable. Unique page
count moved from 13,807 to 13,808, so this proves shared shaping/paint selection
and interaction coverage rather than page-count or pixel equivalence. Ruby
annotation paint runs remain excluded from the base-text statistic. Local
runner timings are retained in the ignored report and are uncalibrated smoke
evidence, not a first-paint performance gate. The separate 2026-07-13 production
Downloads smoke opened and rendered 74 EPUBs through the bounded reader.

Visual text and logical selection text are separate streams. Soft pagination
wraps do not insert logical newlines, discretionary hyphens do not advance the
source range, and selected text is not reconstructed from painted runs. Forced
breaks and source-node boundaries require explicit logical provenance retained
through line breaking.

Rust layout now retains an Arc-backed logical text flow and exact UTF-16 run
slices through greedy/optimal line breaking and pagination. Generated content,
parser-restored whitespace, non-linear transforms and synthetic hyphens remain
typed unavailable instead of inventing source coordinates. The runtime also
owns a validated, document-lifetime pinned-font policy, and font-aware layout
now injects its locale-ordered aliases once into the resolved family stack used
by both Rust shaping and paint commands. Shapeable author EPUB faces remain
first, host-only names are removed, pinned aliases are reserved against EPUB
collisions, and a missing glyph can fall through the complete same-role chain.
Pinned-policy v1 rejects variable fonts until axis coordinates become part of
the contract. Raw WASM and Worker sessions now carry separate face buffers and
canonical bytes-free Rust policy identities. The Browser reader retains its own
font bytes, transfers fresh copies to every Worker, atomically registers the
Rust aliases before initial reflow, and rolls back the complete session on any
required-font failure. Pinned revisions also expose a strict, revision-bound
manifest of the static EPUB faces Rust actually accepted whose families the
current layout references. Browser commit verifies their byte fingerprints,
waits for the complete conservative set, registers it atomically, rejects
mismatched Worker manifests, and permanently disables the declared-face legacy
loader for the pinned session. Exact used-face provenance and document-scoped
family aliases remain before multiple readers can share the global
`FontFaceSet` deterministically. The licensed serif app preset and real-book
proof are complete; locale-specific presets, `sansSerif`/`monospace` coverage,
embedded-face first-paint hardening, and classification of the small residual
unavailable set remain.

Interaction responses and host caches bind to the complete Worker/session,
revision-version and browser-generation ownership handle. Candidate growth
suspends exact reads until its committed presentation is current; host code does
not hit-test an older page snapshot against newer bounded layout state.

The Rust target DTO, exact-version Worker transport, Browser Reader cache and
bounded-growth gate are implemented. Kit consumes native current-spread link,
footnote and standalone-image targets without legacy hit-map fallback. Rust
core now also resolves exact cluster carets and same-logical-flow ranges through
version-gated APIs, including selected source text, durable source locators and
cross-page geometry. The WASM/direct/Worker transport and opaque Browser Reader
`textSelection` capability are implemented with full session, revision, and
commit-generation ownership. Kit now consumes it for exact selection geometry,
copy text and source-range annotation target creation with coalesced latest-wins
pointer reads and revision/spread cancellation. Durable source ranges now have a
separate atomic exact-projection API across Rust, WASM/Worker and Browser Reader.
Kit caches those revision-owned rectangles, invalidates them before a new layout
is painted, and never falls back to compatibility HitMaps while the capability
exists. Selector fallbacks produce a source range before asking Rust for geometry.
The initial API is intentionally limited to a single logical text flow and exact
retained shapes. The legacy interpolated diagnostic has not been promoted to
selection-ready geometry and remains only for Readers without native capabilities.

Visible-spread accessibility semantics now populate the Kit mirror across page
navigation, and mirrored links return to revision-bound native target dispatch.
Image clicks wait for the native resource transfer and revoke stale/disposed Blob
URLs. Footnote structure is preserved only through a Rust allowlist sanitizer;
active attributes and URL schemes are dropped. Partial-extent Next navigation
grows and commits the following spread rather than treating the known boundary
as final.

Remove compatibility placeholders such as empty page content and the synthetic
`text.length * 8` measurer once their callers use the native contract.

DOM events, clipboard access, accessibility nodes and overlay painting remain
host responsibilities. The semantic target, source position, range and layout
geometry must come from the core.

Native search now returns either a proven durable `{ href, sourceRange }` or
typed `sourceUnavailable`; exact coverage must be continuous through the whole
match and the parsed-source slice must equal the logical match. It still forces
bounded completion and searches laid-out page text.
Full-publication search must move to a source/chapter text index so it can avoid
both omission and eager pagination. Kit resolves `resolveExactSourceRange`
geometry only for visible results; pending, unavailable and missing source fail
closed without a legacy HitMap fallback.

### 3. Finish The Thin Session Boundary

Move policy into Rust-authored session plans where it affects reader semantics:

- remaining reflow state and candidate/current revision transitions;
- bounded continuation and cancellation intent beyond the implemented host pump;
- candidate commit/retirement policy;
- resource and frame-window planning;
- font readiness and reflow intent;
- layout-configuration semantics.

The host remains responsible for Worker and WASM startup, timers,
`postMessage`, Canvas command execution, `FontFace`, browser font measurement,
Blob/ImageBitmap decoding, device-pixel ratio and UI callbacks. A host may
execute an operation requested by the core; it should not independently invent
reader state transitions.

### 4. Usability Gate

The Rust reader is usable only when a representative real-book corpus can:

- open, paint, navigate, resize and change typography reliably;
- produce first paint without full-chapter or full-book layout;
- turn cached and uncached pages within documented stage-specific budgets;
- select, copy, follow links, search, highlight, annotate, restore position,
  open footnotes and expose accessible reading order through the native path;
- cancel and dispose stale work without revision mismatches or leaked state;
- recover from malformed-but-tolerable EPUB content with actionable errors;
- keep the production graph free of TypeScript reference-core imports.

Current evidence is green: on 2026-07-13 the bounded production reader passed 74
Downloads EPUBs, and the complete demo-reader parity matrix passed strict
zero-threshold comparison across its single, narrow, wide, DPR 2 and double-page
profiles. This is regression evidence, not yet the formal usability declaration.

Performance gates must name the machine class, browser/WebView version,
viewport, corpus and measured stage. At minimum, record document open, initial
bounded layout, first frame, deferred window growth and page-turn latency
separately. A whole-book completion number is not a substitute for first-paint
latency.

The TypeScript parity and golden suites remain migration gates during this
phase. Intentional differences require explicit review; they are not silently
accepted because the Rust result looks plausible.

## Phase 2: Baseline Transition

After the usability gate, the visual authority moves from the last TypeScript
engine to a controlled WebView/DOM reference harness.

The reference environment must pin or record:

- browser/WebView engine and version;
- viewport, pagination container and device-pixel ratio;
- installed and EPUB-provided fonts plus font-readiness state;
- user-agent and reader styles;
- color profile, zoom and screenshot/capture procedure;
- fixture content and interaction state.

DOM output is evidence, not an unquestionable specification. When browser
engines disagree or EPUB/CSS behavior is ambiguous, standards, compatibility
requirements and explicit product decisions define the expected result.

The TypeScript oracle remains runnable as a historical regression tripwire, but
it stops being the authority for new rendering behavior. Rust structured and
pixel goldens become the durable project baseline and are updated only through
reviewed, intentional changes.

## Phase 3: Long-Term Capability And Performance

Once the new baseline is active:

- expand EPUB and CSS coverage, typography, writing modes and complex-script
  behavior;
- keep comparing against the controlled DOM/WebView reference corpus;
- optimize allocation, shaping, pagination, caches, transport and frame
  materialization using measured evidence;
- add platform renderers behind the stable frame contract;
- evolve binary wire formats only when end-to-end measurements justify them.

Performance work remains continuous, but it should optimize the bounded reader
architecture rather than make an eager whole-book pipeline faster.

## Ordered Work Queue

1. Define revision/session identity, partial extent, source locators and the
   incremental continuation contract. **Core, raw WASM and private JavaScript
   Worker version gates plus the bounded session pump are implemented.**
2. Implement bounded initial layout and resumable window growth. **Core and raw
   WASM paths, the coalescing session controller and the production Browser/Kit
   switch are implemented. Exact reads use complete revision handles, partial
   extents drive navigation growth, and bounded candidates suspend interaction
   until commit. Sub-node budgets remain. The cross-chapter footnote index is
   lazy-state-safe, but its first full-spine scan is still outside the layout
   budget.**
3. Expose current-visible-spread link, image and footnote targets through WASM,
   worker and public Reader. **Implemented through the public Reader and Kit
   click path, including bounded-growth gating and exact locator re-resolution.**
4. Retain exact shaping clusters/caret stops and logical text provenance in
   Rust layout; wire the existing versioned text diagnostics through the Worker
   without presenting their legacy interpolated geometry as selection-ready.
   **Implemented, including conservative unavailable barriers and render-golden
   equivalence.**
5. Prove the shared pinned-font/paint-alias path on a no-embedded-font real book
   and use shape-provenance diagnostics to choose the production fallback set.
   **The immutable policy, deterministic Rust family stack, direct WASM/Worker
   transport and pre-reflow Browser registration are implemented. The Reader
   app now ships the licensed Tinos plus Source Han Serif CN v1 serif preset;
   the 39/39-file corpus comparison reaches 99.95% exact run and UTF-16 coverage,
   and the production Browser proof closes the Rust-shaping/Canvas-alias cycle.
   Broader locale/role coverage and embedded-face first-paint hardening remain.**
6. Add precise native point/range resolution, then migrate Kit selection,
   highlights, annotations, positions and accessibility. **Rust core,
   WASM/Worker, Browser Reader, and Kit exact selection/highlight/copy/source
   annotation target creation, annotation re-projection and visible-spread
   accessibility are implemented. Portable source reading positions now cover
   capture, persistence, legacy archive migration, reflow projection and
   revision-safe restore/go-to. Reader-owned locator intents now atomically take
   over bounded growth, select the target Rust frame and verify its final exact
   projection. Cross-logical-flow annotation geometry and richer
   list/table semantic retention are follow-up capability extensions. Native
   search now transports durable exact source ranges and Kit resolves visible
   overlays lazily; eager completion and a missing publication source index
   remain separate search architecture work.**
7. Reduce browser session policy to explicit core-requested host operations.
8. Establish the real-book usability and stage-specific performance gate,
   including v1 pinned-font cold-start/memory cost and a decision on whether its
   residual locale/role gaps block release.
9. Build the pinned WebView/DOM reference harness.
10. Declare the baseline transition, then resume broad rendering and performance
    work.

## Explicitly Deferred

- Add a core source fallback for image-only or blank pages. Such pages currently
  return an explicit unavailable reading anchor and are not persisted by index.
- Expanding `RITORB1` or making it the default without new end-to-end evidence.
- Broad CSS/display work that does not block the usability gate.
- Micro-optimizing eager page-text search instead of building the durable
  publication source/chapter index.
- Deleting the TypeScript oracle before the baseline transition is complete.
- Treating an arbitrary, unpinned browser screenshot as a canonical baseline.
