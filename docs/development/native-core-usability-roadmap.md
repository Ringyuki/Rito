# Native Core Usability And Baseline Roadmap

Status: active direction record, 2026-07-11.

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

Two large usability gaps remain:

1. Layout is still batch-oriented. A selected chapter, including a very large
   single-file chapter, is fully laid out and paginated before it can be used.
2. The native interaction primitives already present in Rust/WASM are not wired
   through the production worker and public Reader surface. Much of selection,
   links, annotations, highlights, positioning and accessibility therefore
   remains in TypeScript compatibility code.

The browser shell also owns more session policy than the desired thin-adapter
boundary, including reflow sequencing, preview/full handoff, revision commit
policy and some cache/font-reflow decisions.

## Phase 1: A Usable Rust Reader

### 1. Bounded, Stateful Pagination

Replace chapter-count preview with a bounded layout session:

- define an initial page/window, node and/or time budget;
- stop inside a large XHTML document without completing the chapter;
- retain an opaque continuation cursor and resume without rebuilding completed
  work;
- support cancellation and stale-revision disposal;
- grow navigation, text indexes and page totals incrementally;
- preserve a stable source locator across reflow and window growth;
- request only the resources needed by the active and warm windows;
- propagate the budget through block and line layout rather than truncating an
  already completed full layout.

Define revision identity before exposing asynchronous interaction or
continuation APIs. A revision handle must distinguish Worker/session identity
and browser commit generation in addition to the Rust-local revision id. The
incremental form must also expose whether it is ready, complete, cancelled or
failed, the currently known spread extent and an optional final extent. Rust
revision ids are not globally unique across the foreground and full-reflow
Workers.

The source locator contract must represent a source point or range and a stable
progression, not only an href. It must define how a locator into an unpaginated
region requests growth/seek work and how the same locator is resolved after a
font or viewport reflow.

The first useful frame must not depend on laying out the first eight chapters,
one entire large chapter or the full publication.

### 2. Complete Native Interaction Wiring

Expose Rust-owned semantic and geometry operations through the worker and
public Reader contract:

- page targets and links;
- point hit testing;
- text positions and text-range geometry;
- selection anchors, focus movement and selected text;
- search-result highlight geometry;
- annotation anchors and resolution after reflow;
- source locators, bookmarks and reading-position restoration;
- footnote targets;
- accessibility reading order and semantic ranges.

The first vertical slice is current-visible-spread link, image and footnote
targets plus typed href locator resolution. Selection follows only after Rust
provides point-to-caret hit testing, exact shaped character boundaries,
selected text and precise range geometry. Linear interpolation across a
variable-width run is not an acceptable final selection implementation.

Interaction responses and host caches must bind to the complete revision
handle. A visual preview must either expose its own active presentation handle
or explicitly disable interaction until the canonical revision commits; host
code must never hit-test old canonical pages against a newer preview frame.

Remove compatibility placeholders such as empty page content and the synthetic
`text.length * 8` measurer once their callers use the native contract.

DOM events, clipboard access, accessibility nodes and overlay painting remain
host responsibilities. The semantic target, source position, range and layout
geometry must come from the core.

Full-publication search must operate on source/chapter text indexes and return
locators. Searching only the currently laid-out pages would silently omit
unpaginated content; result geometry is resolved lazily for the active window.

### 3. Finish The Thin Session Boundary

Move policy into Rust-authored session plans where it affects reader semantics:

- reflow state and revision transitions;
- bounded continuation and cancellation;
- preview/canonical revision handoff;
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
   incremental continuation contract. **Core contract implemented; host
   version binding remains.**
2. Implement bounded initial layout and resumable window growth. **Core-only
   path implemented; WASM/Worker integration, sub-node budgets and
   cross-chapter footnote policy remain.**
3. Expose current-visible-spread link, image and footnote targets through WASM,
   worker and public Reader.
4. Add precise native point/range geometry, then migrate Kit selection,
   highlights, annotations, positions and accessibility.
5. Reduce browser session policy to explicit core-requested host operations.
6. Establish the real-book usability and stage-specific performance gate.
7. Build the pinned WebView/DOM reference harness.
8. Declare the baseline transition, then resume broad rendering and performance
   work.

## Explicitly Deferred

- Expanding `RITORB1` or making it the default without new end-to-end evidence.
- Broad CSS/display work that does not block the usability gate.
- Micro-optimizing eager whole-book layout instead of implementing bounded
  continuation.
- Deleting the TypeScript oracle before the baseline transition is complete.
- Treating an arbitrary, unpinned browser screenshot as a canonical baseline.
