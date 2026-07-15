# Native Core Usability And Baseline Roadmap

Status: active direction record, 2026-07-14.

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

1. Greedy leaf paragraphs now yield both between completed line boxes and
   inside one pending line at the root and through ordinary in-flow transparent
   container trees. Break search, cached prefix/style-slice measurement,
   line-break scanning, UTF-16 run copy, leading-space skip,
   trailing-whitespace trim, measurement and shaping retain state across public
   quanta without publishing a partial line or block. ASCII word-boundary
   discovery, generated hyphen points, candidate probing and the final choice
   now survive a yielded candidate measurement instead of rerunning the Liang
   dictionary. Width/effective-height accumulation plus vertical and
   non-justify center/right run shifting also resume one run at a time, and
   publish no position, height or line until finalization succeeds; Optimal
   eagerly drains that shared finalizer with its existing width rule. Justify
   gap analysis resumes per run and per UTF-16 scalar, retains a partially
   consumed astral scalar safely and hands off its per-run plan without a
   second scan. Distribution then resumes per run and retained-shape spacing
   per UTF-16 scalar plus cluster commit. Inter-character counts match the
   TypeScript baseline's extended-grapheme semantics through a rolling,
   metered `GraphemeCursor`; exact-shape safety consumes the same per-run gap
   count. Every recursive session shares one 32-node descendant
   quantum and the text-work meter, and one public request keeps that meter
   across chapter boundaries. A later request starts
   with a fresh meter. Each session also captures a process-local logical font
   layout-profile token and rejects resume under a different fallback/face
   profile; the same token isolates shared width-cache entries between font
   assemblies. Individual font measurement and Rustybuzz calls remain indivisible,
   and one oversized operation may run on a fresh quantum to avoid livelock.
   Exact-shape post-processing now avoids per-cluster text-prefix rescans for
   Rustybuzz byte-to-UTF-16 ranges, grapheme constraints and spacing, with
   10,000-cluster operation-count guards and bit-level compatibility oracles.
   Ordinary inline and Ruby candidate traversal and annotation scalar copy now
   resume under the shared text meter. Ordinary None/upper/lower/capitalize
   transforms use a resumable exact UTF-8/UTF-16 preflight, paid exact-capacity
   logical/painted buffer admission and a second metered scalar assembly.
   Ordinary non-contextual assembly therefore performs no buffer growth.
   Whole-segment UTF-16-length-changing mappings fall back without transformed
   assembly, while changed equal-length output uses the resumable grapheme-
   boundary comparator. Ruby annotation output and each final base-text copy
   now use paid exact-capacity reservation plus scalar-metered assembly; a
   separate paid seal publishes the source shared during application, and empty
   annotations allocate neither output nor seal. Node forests, discard, Ruby
   ownership and the complete outer candidate collector now have composable
   budget-capable cleanup cursors. Direct collector `Drop` still drains the same
   state machine synchronously, and runtime/session cancellation does not
   schedule it yet. Paint-ready `RuntimeBlock<LineBox>` trees now also have an
   unboxed-root, intrusive-carrier cleanup cursor that releases each `LineRun`
   separately and drains the same state on partial cursor `Drop`. Page and
   block-vector, page, page-vector, open-page-accumulator and
   `ContinuousPaginationSession` cursors now compose it with explicit nested
   retirement, page paint, layout config and owner units. Chapter, continuation
   and revision owners compose the same cursors in production. Persistent
   `LayoutConfig` font-measurement maps and built-layout chapter-start indexes
   are released entry by entry. Scheduled revision retirement and active continuation
   cancellation also release revision interactions under a cursor, and the
   scheduled revision releases its required-font catalog face by face. Normally
   completed chapters now transfer their whole drained continuation owner to the
   same queue: 41 cursor units and 42 including queue retirement, with one fixed
   64-unit service per completion. Both non-panic orphan-work paths now transfer
   the whole `available_interactions` vector into one regular resumable queue
   job. A later chapter-start failure admits it inside `advance_record`, while
   missing-revision publication admits it inside `apply_work`; the shared helper
   does not service, leaving each existing outer error/publication boundary to
   service once after all related owners are admitted. Orphan page batches still
   drain synchronously through their page-vector cursors, and orphan completed
   idrefs still destroy synchronously. The document-wide chapter-text-index
   cache and temporary wire clones still drop directly;
   transient
   request/bundle configuration owners do too. JSON paint and a final shared
   logical-flow owner remain indivisible payload residuals. Contextual
   Final_Sigma whole-string allocation/growth and
   those unbudgeted direct-destruction paths,
   source sharing/allocation, remaining line-context metadata work, container
   startup, mapping seal and path/buffer boxing, downstream per-run ruby tag/
   paint operations, the leaf marker/paint seal, atomic Liang point generation,
   visually decorated or floated containers, Optimal paragraphs and tables
   therefore still prevent a complete wall-clock hard bound. A test-only
   ordered, text-hashed trace covers prefix probes,
   line-break scans, cache outcomes and actual Rustybuzz subruns; exact
   trace-on/off and eager/bounded equivalence make it the regression oracle for
   this resumable sequence. The first publication-wide footnote scan is now
   single-pass, but still remains outside the layout budget.
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
- stops inside a large XHTML spine item between top-level nodes and through
  ordinary transparent descendant containers;
- resumes Greedy leaf paragraphs between completed lines and inside a pending
  line, retaining break/measure/shape, UTF-16 run-copy, leading-space and
  trailing-trim state plus final width/height, vertical-shift and non-justify
  horizontal-shift state while withholding unfinished output from pagination;
- shares one text-work meter through every descendant and chapter visited by a
  public request, then starts a fresh meter for the next request;
- captures the logical font layout profile used to start a Greedy line session
  and rejects an inconsistent profile on resume;
- shares a 32-node accept/start meter across every active descendant session,
  streams stable flat-container children with a one-block tail lookbehind, and
  preserves list, margin, anchor and page-break state across yields;
- retains an opaque continuation cursor and resumes without rebuilding completed
  work;
- supports cancellation and stale-revision disposal;
- grows navigation and page totals incrementally and preserves a stable source
  locator across reflow and window growth;
- requests the resources needed by active and warm windows.

An owned candidate phase now resumes ordinary inline DFS, Ruby grammar/base
traversal, annotation extraction and scalar application, UTF-16 text assembly,
segment commit and frame exit before logical-flow mapping, while withholding the
whole segment vector. Ordinary None/upper/lower/capitalize transforms now
preflight exact UTF-8/UTF-16 sizes resumably, admit exact-capacity logical and
painted buffers in paid steps, and assemble scalars in a second metered pass.
Ordinary non-contextual assembly therefore performs no buffer growth.
Whole-segment mappings that change UTF-16 length fall back without transformed
assembly; changed equal-length output uses the shared resumable extended-
grapheme boundary comparator. Logical-flow mapping preflight, exact text/
surrogate-interior/span/assignment reservation, assembly and assignment commit
then resume in the production Greedy leaf. A reservation that can grow its
buffer receives one direct `InlineCollection` atomic admission, preserving the
fresh-quantum oversized escape; a zero-growth or already-capacious step consumes
only resumable work. Ruby annotation
extraction now performs a resumable UTF-8/UTF-16 size preflight, admits its
exact-capacity output allocation in a paid step and assembles that output in a
second scalar-metered pass without growth. A separate paid seal publishes one
shared annotation source; application retains that source while each resulting
base `TextSegment` pays an exact-capacity reserve, scalar-copies the annotation
and commits only the completed `String`. Empty annotations allocate neither
output nor shared seal. Line-context display preflight and indexed assembly
follow under the same text meter,
withholding the context until its paid seal. Ruby base grouping now preflights
each direct prefix, checked-counts its base nodes, reuses `rb` seed capacity and
pays atomic admission before a required exact reservation. Its second metered
pass gathers without implicit growth and resumes inside ignored-subtree discard.
Generic segment commit now directly owns one pending segment instead of a
single-element vector, admits full-output growth by the checked post-commit
length, retains a completed amortized reservation across yield, and updates its
summary only after the no-growth push. Generic candidate traversal frames now
admit checked post-depth growth before an amortized reservation, preserve the
initial root outside the stack until admission, and consume ordinary inline or
Ruby-base payloads only after a no-growth push slot exists. Shared ignored-
subtree discard now retains its root iterator outside an empty stack, admits
checked post-depth growth before consuming nested nodes, and pushes without
growth across ordinary, Ruby-group and raw-annotation-text owners. Ruby
annotation extraction now applies checked post-depth admission to its unstacked
root and every non-text child frame, including empty frames, and checked post-
part-count admission to completed text scans before no-growth publication. A
denied part reserve retains the completed scan without recounting its UTF-8 or
UTF-16 lengths. Candidate cancellation now drains each owned node forest through
an intrusive cursor without aggregate traversal-scratch allocation or growth.
Its O(n) drain and the enclosing runtime/session disposal remain synchronous and
unbudgeted. Sealed page batches now move out of the chapter paginator on every
advance instead of being cloned from retained page history. A persistent emitted-
page count preserves chapter-local indexes and first-page spacing after each
drain, while the open page remains private; cancellation therefore owns one page
tree rather than a duplicated paginator copy. Runtime-only eager and bounded
summaries now keep diagnostic spread details, samples and hashes empty while the
full publication/golden summary remains unchanged. Each bounded append updates
only its current chapter contribution and mirrored extents in place; incomplete
double-spread publication uses retained-tail parity instead of cloning chapter
starts and rebuilding every spread. This removes the two near-`O(total pages²)`
pagination-summary/publication scans while preserving exact slot-builder parity
for single/double spreads, `first_page_alone`, empty chapters and odd completed
tails. The now-unused continuation-side chapter-start B-tree and its cleanup
stage are gone; the published runtime layout remains authoritative for chapter
boundaries. The remaining bounded-layout work also uses a private revision-to-cursor
reverse index, so cancel, release and
follow-up failure remove one exact continuation instead of scanning the full
cursor table. Forward lookup remains authoritative for the established stale/
missing/owner-mismatch error order. The remaining bounded-layout work starts
with the remaining cancellation residuals,
candidate/context allocation, clone and metadata residuals, container startup,
downstream per-run ruby tag/paint work and the leaf marker/paint seal.
Contextual Final_Sigma remains a paid whole-string atomic allocation/growth
residual. Sealed owned/borrowed `Vec<StyledNode>` and owned
`VecDeque<StyledNode>` iterators can now release one structural descend/release
transition per explicit cleanup unit, with zero-unit empty completion and
synchronous `Drop` draining the same cursor without aggregate scratch. Wrapped
deque storage is consumed directly without collection or reallocation. Discard,
Ruby annotation, every Ruby frame state, retained Ruby group payload and the
full candidate collector compose over that primitive with explicit source,
nested-retirement and ownership-transition units. One outer linear driver now
composes queued `ContinuousLayoutSession` node forests, active leaf/candidate
state, completed children, optional container tails and unique boxed descendant
sessions. Empty sessions cost 14 cleanup units and each empty no-tail container
layer adds 19; 16K chains, immediate drops, child-handoff boundaries and panic
unwinding all use that same allocation-free driver without recursive session
destruction. Mapping-finalizer, context-builder and greedy-line owners remain
declared atomic destructor residuals. A chapter-session cursor now composes the
paginator and continuous-layout cursors in that order, costs their combined
units plus five explicit boundaries, and drains 16K queued-node owners through
the same path during partial or panic-unwind drops. The paginator now snapshots
only page geometry and the bounded three-field pagination policy instead of
cloning the complete host-measurement `LayoutConfig`; empty paginator cleanup is
13 units and empty chapter-session cleanup is 32. Large font-measurement maps no
longer affect that session cost or get dropped directly when eager pagination or
a normally completed chapter disposes the paginator. Successful owned full,
initial-preview and active-chapter-preview requests now move the same config
allocation into the retained revision; the chapter-window path mutates its
owned `first_page_alone` flag in place. This removes the former measurement-map
clone plus direct request-config drop. A deferred view preview retains the two
configs it genuinely needs for the preview revision and full-reflow follow-up,
without a third short-lived owner. Active-preview existence is resolved before
that clone, so a no-match fallback moves the original config straight into its
full revision. Complete configs that fail before a revision can take ownership
now enter the runtime cleanup queue. Owned prefix/window construction errors,
standalone active-preview no-match/errors, view-preview preflight errors and
invalid preserve locators are covered, as are bounded-request invalid budgets
and layout-key/footnote/font preflight failures. Bounded initialization retains
one owned config through those fallible steps and creates its sole persistent
revision clone and footnote payload only after they all succeed. A standalone
config queue job costs
`F + N + 2O + 7` units, so the empty case costs 7 and a 256-entry regression
fixture costs 263, resuming after its first 64-unit service. Invalid preview
locators batch the original request config with the rejected preview revision.
Failure while constructing the cloned preview revision represents two distinct
producer admissions and receives two fixed service calls, bounding that path at
128 structural units.
`RuntimeRevisionInteractions` now has a budgeted cursor for these guarded
persistent owners. With `F` footnotes and `C` completed idrefs, a
`FullDocument` source costs `F + C + 5`; a materialized source costs
`F + C + 6 + sum(S_i + 6)` for `S_i` spans in index `i`, while a standalone
index costs `S + 4`. Bounded chapter startup now moves its materialized text
index into continuation work and then the revision, without cloning or later
replacing the publication-wide footnote map. The active chapter retains only
completed idrefs until chapter completion. Its cursor releases unpublished
pages before the chapter session and then retires those idrefs before the
chapter idref/scalar shell. Its exact cost is `V + CH + C + 7` for page-vector,
chapter-session and `C` completed-idref units. Empty active owners cost 41
units, one empty unpublished page costs 46, and combined deep page/node or wide
completed-idref owners remain stack-safe through immediate, boundary and
panic-unwind drops. The
continuation-record cursor now immediately guards that active owner, then
releases the budgeted layout config, identity strings and scalar shell. The
redundant continuation-side chapter-start index has been removed; the published
runtime layout remains authoritative for chapter boundaries. With empty
configuration maps, inactive records cost 11 units and empty active records
cost 53. Built layouts,
detached frame caches and runtime revisions now compose these primitives. The
layout-summary cursor retires each runtime pagination chapter-map entry before
its lean remainder; with `CM` summary chapters its exact cost is `CM + 3`, and
empty/one-page built layouts now cost 9/14 units. Detailed full-publication
summary diagnostics remain one residual owner unit. The
scheduled revision also turns its required-font catalog into an iterator and
retires one face per unit; `R` faces add exactly `R` units. Its exact total is
`FC + BL + LC + R + RI + 7` for frame-cache,
built-layout, layout-config, required-font and interaction cleanup. An empty
`FullDocument` revision costs 30 units. The minimal queue fixture uses an empty
materialized source, so that revision plus its queue-job retirement costs 32.
The production runtime schedules continuation, completed-chapter, revision,
orphan-interaction-vector, cache, LRU-frame and complete transient-config owners
through a private two-lane cleanup queue. For nested interaction costs `I_i`, an
orphan vector cursor costs exactly `2 + sum(I_i + 1)` units and its queue job
costs `3 + sum(I_i + 1)`. A production vector for `N` chapters containing
`S_i` text spans costs `3 + 13N + sum(S_i)` queue units.
Each cleanup-queue-admitting producer batch advances 64 structural units; the
closed job-admission bound is at most 12 frame owners per lifecycle mutation,
one ordinary config owner, one 42-unit owner per completed chapter with an
immediate service, one aggregate orphan-interaction vector per failed work
batch, or two separately admitted configs on preview-clone construction
failure. Tests
over repeated batches keep the physical frame backlog at zero without starving
regular work. The vector aggregation bounds one failed batch to one new regular
job; because its exact cost grows with chapter/span count, it does not turn the
fixed 64-unit service into global hard backpressure. One quantum guarantees
progress and may leave that single job resumable. Final document
drop drains queued and still-active owners through the same iterative cursors.
`RuntimeBlock` trees, standalone block/page vectors, direct child vectors, the
open-page accumulator and
`ContinuousPaginationSession` now have iterative cursors, including per-run
line cleanup. This new interaction/font coverage applies only to scheduled
`RuntimeRevision` retirement, active `RuntimeChapterContinuation` cancellation,
normal completed-chapter retirement and queued orphan `available_interactions`.
Orphan page batches and completed-idref sets still retire synchronously;
`RuntimeDocument.full_chapter_text_indices` and
temporary bundle/presentation/serialization clones still destroy aggregate
owners directly. Native revision-cache warming now retains only the packed
frame owner; compatibility JSON frames materialize from the immutable revision
layout on first demand and remain in the same LRU entry. Resource prefetch reads
image hrefs from packed metadata, and WASM metadata/bytes reads use narrow core
projections instead of cloning both command-buffer halves. Packed-only and
JSON-materialized entries keep the same native one-owner cleanup accounting.
Detailed summary shells and cached frame payloads remain indivisible, while
partially deserialized configs and deferred follow-up/config serialization or
adapter/transport-side configuration owners can still clone or drop directly.
Empty-policy `layout_key` hashing now streams compact layout-config JSON directly
into SHA-256. The pinned-policy branch retains one complete JSON buffer because
the existing byte contract places its length before the JSON, but segmented
hashing removes the former second identity buffer and full-config copy without
adding a second serialization pass. Serialized follow-up configs are still
dropped synchronously by legacy view endpoints outside that path. Eager preview
and full bundle creation now keep each inserted revision provisional until
bundle metadata and initial-frame finalization both succeed; post-insert errors
release it through the budgeted revision cleanup queue without reusing its ID.
The WASM eager, view, reader and bounded-create transports extend that
provisional state through initial-frame warm/prefetch and final JSON/`RITORB1`
encoding. Previous-revision transfers remain owned until commit while response
counts expose the post-commit view; on a recoverable transport error they
remain intact while the exact new revision and leases are released.
Continuation, cancellation and versioned-release mutations still commit before
their infallible-in-practice JSON response is encoded.
Guarded persistent-owner cancellation is therefore structurally stack-safe,
but this is not an end-to-end wall-clock hard bound. Next make the currently atomic Liang point
calculation bounded and extend the same
coverage to visually decorated and floated containers, auto-layout tables and
Optimal paragraphs. Individual font calls remain indivisible even though their
surrounding measure/shape stages resume.
Publication-wide source indexes must likewise be budgeted instead of
front-loading a full-spine scan.

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
or the full publication. Once inline candidates are collected, logical-flow
mapping, display-text line-context assembly, transparent-container descendant
traversal and Greedy break/measure/shape, UTF-16 run-copy and whitespace work
advance through metered stages across public quanta. Candidate-collection
allocator, context/source-copy, frame payloads, the slim completed
chapter-session shell and aggregate owners on orphaned-interaction,
document-index and temporary wire-clone paths remain synchronous residuals,
alongside line-context metadata,
one container/paragraph-preparation
pass, the leaf marker/paint seal, decorated or floated composite, table or
Optimal paragraph can still violate the intended latency bound. Each individual
measurement or Rustybuzz call is also indivisible, and the fresh-quantum
oversized-operation escape prevents livelock rather than imposing a strict
wall-clock bound.

Exact bounded publication has algorithmic constraints that must remain explicit:

- Greedy leaf line layout now persists break search, prefix/style-slice
  measurement, line-break scan, UTF-16 run copy, leading-space skip,
  trailing-whitespace trim, measure/shape stages, final width/height
  accumulation and vertical plus non-justify horizontal run shifting through
  transparent container trees.
  It withholds the unfinished line and paragraph; publishing a stable paragraph
  prefix still requires widow/orphan lookahead and open-block paint edges;
- transparent-container startup still uses the existing owned margin-collapse
  preparation, which can clone a large child slice before the descendant meter
  starts; this remains an explicit atomic preparation gap;
- logical-flow source-mapping preflight, scalar copy and per-segment assignment
  commit are covered by the shared text-work meter and retain the owned segment
  vector across yields, so no partial mapping can enter line layout. The
  following line-context builder meters display-scalar preflight and assembly,
  builds UTF-16/newline indexes without a final rescan and withholds the context
  until seal. Its bounded-prefix font setup now parses CSS family lists, scans
  valid faces and compares even long family names across resumptions before it
  consumes the segment text. Ordinary candidate collection now uses an owned,
  iterative production state machine: node dispatch, UTF-16 text assembly,
  segment commit and inline-frame exit are metered, and completed prefixes stay
  private. Ruby direct-child grammar and base traversal, annotation extraction
  and scalar copy now resume under that meter. Ordinary None/upper/lower/
  capitalize transforms use resumable exact UTF-8/UTF-16 preflight, paid exact-
  capacity logical/painted buffer admission and second-pass scalar assembly.
  Ordinary non-contextual assembly therefore performs no buffer growth.
  UTF-16-length-changing whole-segment mappings fall back without transformed
  assembly; changed equal-length output uses the resumable grapheme-boundary
  comparator. Final_Sigma whole-string lowercase allocation/growth remains a
  paid atomic operation. Ruby annotation output and per-base text copies now use
  paid exact-capacity reservations and scalar-metered assembly. Ruby base-group
  vectors now use checked direct-prefix preflight, paid reservation when needed
  and a no-growth gathering pass while reusing `rb` seeds. The generic candidate
  traversal stack now admits checked post-depth growth before an amortized
  reservation, preserves the initial root outside that stack until admission,
  and consumes ordinary inline or Ruby-base payloads only after a no-growth push
  slot exists. Shared ignored-subtree discard applies the same preflight and no-
  growth push protocol to its root and nested frames. Annotation traversal and
  part vectors now preflight checked post-size growth and push only into retained
  capacity. Candidate cancellation now reuses existing child-vector slots, so
  its traversal needs no aggregate scratch allocation or growth; the drain and
  direct collector drop remain synchronous. Enclosing runtime continuation and
  revision retirement is scheduled through the private cleanup queue, with any
  remainder drained synchronously at final document drop.
  Chapter pagination now moves sealed batches into continuation ownership rather
  than retaining and cloning the same pages in the paginator; persistent page
  history keeps indexes and first-block spacing stable across those drains.
  Active continuations maintain an exact cursor/revision bidirectional index;
  terminal cursor lookup/removal is logarithmic in cursor count and invalid
  requests do not mutate either side of the index. Removed continuation payloads
  transfer to the runtime cleanup queue instead of being destroyed inline.
  Source-text sharing
  and context allocation remain atomic; style/value
  clones, line-break metadata and B-tree insertion remain indivisible operations.
  Mapping seal/`Arc` publication plus boxing completed buffers and moved source
  paths are likewise indivisible.
  Ruby grouping traversal now resumes per input run and withholds the complete
  line across yields, but exact tag comparison and the first run's tag/selected
  paint clones remain indivisible per-run work. Exact
  mapping boundary checks use a sparse index of
  surrogate-pair interiors rather than rescanning the logical flow per wrapped
  run; wrapped runs share parser source text and ruby extraction moves retained
  run allocations rather than cloning them. ASCII hyphen word discovery and
  candidate probing resume, but one Liang point-generation call remains atomic;
- completed Greedy leaf lines are offset and wrapped as runtime children when
  each bounded line batch is emitted, while the maximum child bottom is retained
  incrementally. Closing a leaf therefore no longer maps and then rescans every
  completed line. Child-vector growth, list-marker insertion plus block
  paint/border/style metadata are still atomic leaf residuals;
- optimal paragraph breaks depend on the complete paragraph. Item construction
  and dynamic programming can yield between budgets, but the paragraph cannot
  publish before completion unless a forced-break boundary proves a prefix;
- auto table column widths depend on a whole-table intrinsic-width prepass. The
  prepass can be resumable and rows can publish after widths freeze;
- measure and shape stages yield before an operation and resume afterward, but
  one font measurement or contextual Rustybuzz call remains an indivisible
  black box. A huge `nowrap` operation may use the fresh-quantum oversized-work
  escape unless shaping moves to interruptible/background native execution;
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
   until commit. Greedy leaf paragraphs now persist break/measure/shape,
   UTF-16 run-copy, leading-space and trailing-trim state inside a pending line,
   then persists final width/height accumulation plus vertical and non-justify
   horizontal run shifts before publishing the line; eager layout drains the
   same state machine. Ordinary transparent
   descendant containers share a 32-node recursive meter, while one public
   request shares its text-work meter across every chapter it visits. Stable
   completed children can publish before their ancestor closes, but no partial
   line or block is exposed. A process-local font layout-profile token rejects
   inconsistent resume inputs. Logical-flow source-mapping assembly and commit,
   followed by display-text line-context preflight/indexed assembly, now resume
   before line layout. Ordinary inline candidate collection precedes them as an
   owned resumable phase, including Ruby grammar/base traversal and annotation
   scalar work; ordinary None/upper/lower/capitalize transform preflight,
   exact-capacity buffer admission and scalar assembly, transform grapheme-
   boundary comparison, font-family parsing and valid-face discovery inside the
   bounded-prefix policy resume as well, and completed leaf lines are converted
   plus height-accounted incrementally. Ruby annotation output and each base
   text copy use paid exact-capacity reservation and scalar assembly, followed
   by commit only after completion. Contextual Final_Sigma whole-string
   allocation/growth, frame cleanup payloads and aggregate interaction,
   index, font or wire-clone owners outside the guarded scheduled
   revision/active-continuation paths, remaining
   context metadata, container
   startup, mapping seal and path/buffer boxing, downstream per-run ruby tag/
   paint work, the leaf marker/paint seal, atomic Liang point generation,
   decorated/floated
   containers, tables and Optimal layout retain unmetered or atomic regions;
   individual font calls are still indivisible and may use the oversized-work
   escape.
   The cross-chapter footnote index is lazy-state-safe and single-pass, but its
   first full-spine scan is still outside the layout budget.**
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
