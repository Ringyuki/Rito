# Known Defects — found by gate runs, 2026-07-21

Recorded from real-book smoke and the load-profile gate. Each is a real defect
with a known trigger; none is speculative. Ordered by how much it blocks
delivery, not by how deep the code is.

## Fixed in the second pass (2026-07-21, later)

### Chapter-local frame resource payloads reported the wrong href (core)

The former OPEN item below. `store_chapter_local_resource`
(`crates/rito-wasm/src/chapter_local/frame.rs`) reported the
manifest-canonical `resource.href` while the frame's `resource_table` keys by
the display-command href; resolution tolerates relative/percent-encoded forms,
so the two strings diverge (book-01 `Theatre01.xhtml`) and
`requireFrameResourceRefs` rejected the aggregate as "unreferenced". The
payload now echoes the lookup key. Same-family fix in Reader v1:
`read_resource` (`crates/rito-core/src/runtime/reader_v1/session.rs`) now also
echoes the requested href instead of the canonical one — the Dart session
validates the response against the reference it asked for, so the FFI path had
the identical latent mismatch. Usability gate: book-01 including the far-TOC
theatre jump now passes.

### EOCD preflight rejected real books with upload trailers (core)

`preflight.rs` (new in e330bcb) required the ZIP end-of-central-directory
comment to end exactly at EOF. Books saved from multipart HTTP uploads keep a
`------WebKitFormBoundary...--` trailer (and often a prefix, which the central
directory shift scan already tolerated), so byte-identical, previously-passing
corpus books were refused as "Invalid EPUB ZIP end of central directory"
(book-04 and 2/81 smoke books). The scan now runs a strict exact-EOF pass
first, then accepts exactly one in-bounds footer; two parseable candidates
stay fail-closed. Real-book smoke: 79/81 -> 81/81; gate book-04 passes.

### A typed chapter-local worker error disposed the whole reader session

`mutationResult` (`reader-worker-chapter-local-client-runtime.js`) disposed
the shared Worker session whenever a create rejected with no recoverable
owner, and double-released the predicted N+1 owner on continue — but a typed
`{ok:false}` reply proves the worker-side payload runtime already rolled back
(or freed) its own owner. An optional preview failure therefore killed the
session the main TOC jump was running on: the concrete "preview failure fails
the whole TOC jump" mechanism. Typed worker errors now propagate without
disposal or client-side rollback; channel-level failures (worker death,
postMessage loss) keep the dispose. The worker payload runtime now also frees
the document when a committed advance carries no valid owner identity, so the
"typed error ⇒ already contained" invariant holds in every corner.

### Flutter adapter could not compile, then failed 24/141 tests

`reader_session.dart` tested `gateway is RitoResumableExactSeekGateway` on a
declared `RitoReaderGateway`; Dart never promotes to an unrelated interface,
so all five capability calls were undefined methods. Rewritten as if-case
patterns that bind the capable view. After the compile fix, first-ever test
runs surfaced: the lifecycle mock modeled the old canonical-href gateway
behavior (fixed with the core echo fix above), one font test contradicted the
pinned no-resource-fails contract, and two architecture assertions were
malformed (`allMatches(...)` compared to a number; a source string that never
existed). Suite now 141/141 with `dart analyze` clean of errors.

## RESOLVED in the third pass — book-10 far-TOC request budget

**Was: p95 18 > 16 window ops. Now: 9 ops, first frame 92.7 ms — every
usability gate threshold passes on all three corpus books.** The fix is the
designed one below: chapter-local create/continue accept an optional
`maxQuanta` (1..=16, absent = 1 = old behavior). Core loops advance + append
plus a locator-resolution check per meter and publishes once, stopping the
moment the target resolves — no overshoot, and the work that produces the
first visible frame is front-loaded. The browser preview passes `maxQuanta: 4`
(`LOCAL_QUANTA_PER_REQUEST` in `chapter-local-preview/task.ts`); Reader v1's
own quanta loop and rollover stay at one meter. The JS request validators
forward the field and scale the advance work bound to `nodes × quanta`.

Attribution history (kept because the refuted path is easy to re-propose):

- The 18-op window held chapter-local create + 8 continues (the preview)
  interleaved 1:1 with resolve + 8 `continueRevisionTowardSourceLocator`
  (the parallel exact path at its pre-composite `quanta=1` batch level).
  Each continue sealed ≈1 page because one Worker request ran one
  `LayoutWorkMeter` whose line/text quanta drain after roughly a dense page.
- Preview OFF is far worse (measured A/B): 146 requests, 2087 ms first
  frame. The preview is a large net win.
- **Bigger quanta for everyone is refuted by measurement.** A bounded
  meter-refill in `advance_record` (4 meters/request) was implemented and
  reverted: it doubled preview CPU through overshoot (the target-resolution
  check only ran between requests) and head-of-line-blocked the preview
  behind packed exact-path ops on the single worker thread — first frame
  went 100 → 180 ms and window ops 18 → 21-23. The shipped fix differs
  exactly in checking resolution per meter inside the mutation.

## Round 5 started — the browser is now the only baseline

Decision (2026-07-21): the TypeScript core is demoted from visual authority to
regression fixture, exactly as the deletion ledger prescribes. The pinned
browser is the only layout baseline from now on.

First working increment, `apps/reader/tests/e2e/browser-line-baseline.e2e.test.ts`
(report-first; thresholds gate only after their independent baseline review):

- Pinned bundled Chromium renders one dense fixture chapter (book-01
  Section001) at the native content width with the same pinned font bytes,
  registered under the same `__RitoPinned_<sha256>` family names the native
  paint commands carry, so font resolution is identical by construction.
- Per-character Range geometry merges into browser lines; the native side
  decodes the same chapter's paintText commands per page. The comparator
  reports line-break parity, first divergence, and x/width deltas to
  `test-results/browser-baseline/section001-line-baseline.json`.
- First run: **the first 401 lines match the browser exactly, line by line,
  with x/width deltas p50 = p95 = 0 px** (max 3.8/7.7 px inside matched
  lines). Font measurement and greedy line breaking agree with Chromium on
  plain paragraphs.
- The first divergence was not a line-breaking bug: the oracle page rendered
  an `epub:type="footnote"` aside into the flow, which a reader excludes, and
  the broken noteref inline image (404 placeholder width) shifted that
  paragraph's break. Second increment fixed both in the pinned capture
  procedure (footnote asides leave the flow; chapter resources resolve to the
  real EPUB bytes) and replaced the index-wise comparator with LCS alignment
  so one shifted break cannot misalign every later line.
- **Third increment: the whole book.** The harness now opens the fixture
  once and sweeps every paginated text chapter
  (`test-results/browser-baseline/book-01-line-baseline.json`). book-01,
  11 chapters, 6609 native lines: **corpus parity 99.39%; 7 of 11 chapters
  match Chromium 100% line-for-line**, x/width deltas p50 = p95 = 0 px on
  matched lines. Body-text parity excluding the contents page is 99.83%.
  The complete divergence classification:
  1. **`contents.xhtml` (29 native / 101 browser lines, parity 0)** — a
     float layout (`fl`/`fr` columns, negative margins, clears). Floats are
     a Round-11 formatting context; the current profile's pragmatic float
     handling is a known approximation, and the oracle's single-column line
     model does not apply to two-up float columns either. Classified
     out-of-profile, not a new engine bug.
  2. **Latin-in-CJK break clusters** (inline noteref image, "8x4",
     "#metoo"; ~10 lines across two chapters): native fits 3-5 more
     characters per line than Chromium — suspected narrow native
     measurement of short latin runs inside CJK text.
  3. **Katakana + interpunct cluster** ("カルロ・ゼン", 3 lines): native
     fits one character fewer than Chromium — opposite direction, so the
     mixed-script measurement difference is not a single constant bias.
  4. One pure-CJK-looking cluster in Section002 (2 lines) pending a
     closer look at its markup.
     **Fourth increment — layer attribution closed the investigation.**
     The three "14.4 px" clusters were an oracle defect, not an engine one:
     `setContent` pages live on about:blank, so root-relative resource URLs
     never became network requests and every inline noteref image rendered
     as a broken-image placeholder whose width skewed the breaks. The
     oracle now serves its page over a routed http origin; those clusters
     vanished and body-text parity rose to **99.91%** (6574/6580 lines).
     `browser-measure-diagnosis.e2e.test.ts` then rendered each remaining
     divergent line as an unwrapped run and compared widths: **every
     remaining cluster measures 0 px apart** (katakana interpunct:
     1.33 px). The native measurement layer agrees with Chromium exactly;
     all residual divergence (closing-punctuation line ends and the
     interpunct line) is frozen-line-break-policy territory. Per the
     freeze policy these are not fixed in the legacy engine — they are
     archived, with ready repros, as the Round-8 differential corpus the
     oracle exists to collect. Final book-01 classification: one float
     contents page (Round 11), zero measurement divergences, and a small
     closing-punctuation break-policy set (Round 8).

## Round 5 dependency-cut verdict: GO on Parley for the Round-8 inline engine

`crates/rito-inline-spike` (never in a production dependency graph) feeds
Parley 0.11 the identical inputs the Chromium oracle uses — same font bytes,
size, 2 em first-line indent (as an in-flow inline box), 372 px advance —
and `browser-parley-spike.e2e.test.ts` compares line breaking on every plain
paragraph of book-01's eight body chapters:

- **3810 / 3812 paragraphs break identically to pinned Chromium
  (99.95%)**; 5993 / 5998 lines.
- Both residual paragraphs are character-level details, not algorithmic
  gaps: a full-width curly-quote boundary (font-fallback width choice) and
  the カルロ·ゼン interpunct paragraph — where **Parley agrees with the
  native engine** and Chromium is the outlier.
- Parley is DOM-free, pure Rust, takes plain text plus typed styles, and
  returns run/line geometry — the input boundary the plan requires for
  emitting the Rito-owned fragment contract.

Verdict: Parley is the Round-8 inline/text line-breaking substrate. The two
character-level calibration points ride along as oracle cases. With this,
Round 5's exit conditions are substantially met: the oracle is reproducible,
corpus shards run automatically (whole-book line baseline + paragraph-level
spike), and the dependency strategy is demonstrated. Next: Round 6 fragment
substrate (`FormattingTree` / `ConstraintSpace` / `FragmentTree` /
`BreakToken`).

## Round 6 closed — fragment substrate, cache model, and shadow wiring

`crates/rito-fragment` is the Rito-owned layout contract every replacement
formatting engine targets: `FormattingTree + ConstraintSpace + BreakToken ->
FragmentTree` behind the `FormattingContext` provider trait (cancellation via
cooperative `CancelFlag`, typed `LayoutError`, `intrinsic_inline_sizes`).
The hard gate's testable half is covered by 19 crate tests: creation,
replay-equals-recompute through the input-keyed `FragmentCache`
(tree-fingerprint + root + constraint bits + break token), node-level
invalidation, cancellation purity, canonical serialization (round-trip,
byte determinism, fail-closed decoding), release-to-zero, and a byte budget
that is never exceeded with deterministic LRU eviction.

The wiring half connects fragment artifacts to protocol v1 behind an
explicit engine-provider flag, fail-closed on unknown providers:
`RuntimeDocument::fragment_shadow_report` (versioned:
`fragment_shadow_report_at`; wasm: `getFragmentShadowReportAtRevisionJson`)
derives a `FormattingTree` per published page of a real revision — one
unbreakable sized leaf per top-level production block — and lays it out
through the fragment cache with the stub block provider. Production
authority is untouched (`&self` read; summary and frame compared equal
before/after in tests). On the runtime fixture every page the production
engine filled also fits the fragment model's fragmentainer
(`fittingPageCount == shadowedPageCount`), every page replays from cache,
and the artifact digest is stable across runs.

Verification: rito-fragment 19, rito-core 1223 (4 new shadow tests),
rito-wasm 103 (1 new versioned JSON test), workspace clippy `-D warnings`
clean, core-wasm rebuilt, vitest core 2115 / kit 673 / react 30 green.
Next: Round 7 — typed Stylo bridge, delete JSON style materialization.

## Round 7 started — typed style tables (layout + inline) retained past materialization

The typed projections (`LayoutStyleTableV1` and `InlineStyleTableV1`:
interned styles plus dense node-to-id maps) used to be read exactly once —
flattened into the JSON `StyledNode.style` maps for the frozen engine — and
dropped. Both are now retained end to end on every production path:

- `ResolvedPreparedChapterStyle` carries both tables (each projection's
  `into_table()`); `layout_inputs` collects one pair per chapter;
  eager/window revisions store them at creation and
  bounded revisions move each chapter's table into the revision atomically
  with the chapter's first published work (`RuntimeContinuationWork
.chapter_style_tables`; retired work drops them with its batches; a
  chapter that completes with zero pages still publishes its table).
- `RuntimeRevision.chapter_style_tables: BTreeMap<idref,
RuntimeChapterStyleTables { layout, inline }>` is the storage the fragment
  pipeline will consume; memory is interned records plus two `Option<u32>`
  slots per source node.
- `style_table_summary` / `style_table_summary_at` /
  `getStyleTableSummaryAtRevisionJson` report per-chapter coverage
  (layout and inline interned/assigned/node counts) and a platform-stable
  FNV-1a digest over both tables' full content (every integer write pinned
  little-endian, `usize` widened to 8 bytes, so wasm32 and native produce
  identical digests).

Evidence: identical configurations project identical digests; bounded
revisions grow tables chapter by chapter as work publishes; rito-core 1236
tests, rito-wasm 104, clippy -D warnings, vitest core 2115 / kit 673,
81-book smoke all green. Also fixed pre-existing breakage: the
`legacy-css-diagnostics` resolver did not compile (missing `capabilities`
field).

Remaining for Round 7: have the fragment pipeline consume real interned
style ids (with the inline/block tree builder), and delete the JSON
materialization — the last step is only possible at cutover, when the
frozen engine (the sole JSON consumer, ~246 string lookups) is deleted
with it.

## Round 8 started — the Parley inline provider lays out through the fragment contract

The fragment contract now represents inline content:
`FormattingNodeContent::InlineFlow` (ordered `InlineItem::Text` runs with
typed inline-style references), `Fragment::Line` / `Fragment::Text` output
fragments (canonical serialization tags 1 and 2), and style tables carried
by the tree itself (`FormattingTree::with_styles`; the fingerprint covers
table content, so a style edit can never replay stale fragments; a tree
with inline flows but no tables fails closed).

`crates/rito-inline` implements the provider: `ParleyInlineContext`
registers exactly the font bytes it is constructed with (never a platform
font database), maps typed styles onto Parley ranged styles (families,
size, weight, slant, line-height; `text-indent` as the in-flow inline box
at offset zero the dependency spike validated), and emits line/text
fragments with baseline and geometry. Fragmented constraint spaces, break
tokens, and non-text inline items fail closed — fragmentation belongs to
the block container.

The dependency-spike harness now measures the production provider path
instead of raw Parley: `rito-inline-spike` builds a typed
`FormattingTree` per paragraph and lays it out through
`ParleyInlineContext`. **Browser parity is unchanged at 3810/3812
paragraphs (99.95%, 5993/5998 lines)** — the whole contract pipeline
(tree construction, style tables, provider, fragment output) introduces
zero line-break deviation against pinned Chromium.

Verification: rito-fragment 23 tests, rito-inline 8 (determinism, cache
replay, multi-line reassembly, first-line indent, geometry, intrinsic
sizes, fail-closed paths), rito-core 1236, clippy -D warnings, fmt clean.

Glyph-run geometry landed next: `Fragment::Text` is now emitted per glyph
run with exact inline offsets and advances, `LineFragment` carries its
trailing-whitespace advance, and the spike harness compares per-line ink
geometry (first-glyph x, whitespace-free width) against per-character
Range rects in pinned Chromium. **Across all 5993 break-identical lines:
x delta p50 = p95 = max = 0 px; width delta p50 = p95 = 0 px, max =
0.648 px.** The provider's glyph positioning is browser-exact on the plain
paragraph profile; the sub-pixel width tail is the same font-fallback
width residue the dependency spike identified.

Still ahead in Round 8: whitespace collapsing at tree construction,
mixed-style paragraphs (multiple runs per line through real style
boundaries), and the whole-book browser-line-baseline oracle wired to the
provider as its cutover gate (needs the block container from Round 9 to
compose paragraphs).

## Round 9 started — the block formatting context paginates real paragraphs

The provider contract now takes an explicit node: `FormattingContext::layout
(tree, node, space, token, cancel)` lays out the subtree rooted at `node`,
which is what lets a parent context invoke child contexts on child nodes
(the fragment cache keys on the node accordingly). All providers and the
shadow diagnostic migrated; behavior is unchanged.

`crates/rito-block` introduces `BlockFormattingContext<I>`: vertical block
flow over sized leaves and inline flows, with fragmentainer pagination.
Lines are the atomic pagination unit for paragraphs — an inline flow lays
out once in continuous space through the input-keyed fragment cache
(resumed fragmentainers replay it instead of re-shaping), and the block
context decides which lines land in which fragmentainer, resuming from
`BreakTokenStage::Inside { consumed_block_size }`. Nested block containers
and margins fail closed until their increments land.

Contract tests (deterministic fake inline provider): exact line-per-page
distribution (7 lines / 25px fragmentainers → 2+2+2+1), deterministic
resumption, leaves and paragraphs sharing fragmentainers, forced progress
when a line is taller than a fresh fragmentainer, continuous no-break,
nested-block and leaf-root fail-closed, cancellation. Integration test
(real `ParleyInlineContext` + pinned Tinos): two indented paragraphs
paginated through narrow fragmentainers reassemble losslessly — no line
lost or duplicated across page boundaries — and a repeat pagination is
byte-identical through the cache.

Verification: engine crates 40 tests (fragment 23, inline 9, block 8),
rito-core 1236, clippy -D warnings, fmt clean; the browser parity spec is
unchanged after the contract migration (3810/3812, x delta p95 = 0,
width delta max = 0.648px).

Block margins landed next. `LayoutFormattingStyleV1` gained `margin`
(physical sides, `LengthPercentageOrAuto`) and `padding`
(`NonNegativeLengthPercentage`), projected from Stylo alongside the other
layout fields (anchor-positioning margins fail closed). The 81-book smoke
passes with the extended projection: the wider contract rejects no real
book. The block context resolves vertical margins from the tree's typed
layout table (percentages against the containing inline size, `auto` to
zero, missing tables fail closed) and applies CSS collapsing between
adjacent siblings — max of positives plus min of negatives — with the
container as a formatting-context root (no through-collapse) and the
trailing bottom margin kept inside it. A margin that meets an unforced
fragmentainer break is truncated to zero, so a resumed child starts flush
at the page top, matching CSS fragmentation.

rito-block is at 14 tests (margin collapse, negative margins, percentage
resolution, auto-to-zero, break truncation, fail-closed missing styles, on
top of the pagination suite); engine crates 46 total; rito-core 1236;
81-book smoke green.

Nested block containers landed next: containers lay out recursively, and
a break inside one comes back as a token whose `resume_path` names the
whole ancestor chain (`[inner, paragraph]`, or `[2, 1, 0]` through three
levels), so resumption re-enters exactly the interrupted subtree —
verified deterministic and lossless across pages at every nesting depth.
Each container is a formatting-context root for margins; the parent-child
through-collapse of plain `display: block` wrappers is an explicit
remaining gap tracked for the oracle round. rito-block is at 17 tests;
engine crates 49; total suite 1285.

The chapter tree builder landed next (`rito-core/src/fragment_bridge.rs`):
parsed chapter nodes plus the typed projection tables become a
`FormattingTree` — block elements to block containers, runs of
inline-level content to inline flows, `display: none` subtrees dropped,
inline content beside block siblings wrapped in CSS-style anonymous block
boxes (via a free `intern` on the layout table), and white space collapsed
at construction with browser-exact space ownership (a collapsed space
belongs to the run that produced it; the first space of a cross-node
sequence wins). Unrepresentable content — images, preserved white space —
fails closed with the construct named. The builder also returns a
formatting-node → source-node map for interaction wiring.

The end-to-end test is the milestone: a real XHTML chapter resolved
through Stylo projection, built into a tree, and paginated by
`BlockFormattingContext<ParleyInlineContext>` reassembles every paragraph
losslessly across pages — real book content flows through the entire new
engine pipeline for the first time. Style boundaries split shaping runs
exactly (plain / bold span / plain, with the boundary space on the
correct side). rito-core 1239 tests; engine + contract crates 137;
81-book smoke green (table Clone and the free intern changed no
projection behavior).

The representability diagnostic landed next: `chapter_tree_report`
(versioned: `chapter_tree_report_at`; wasm:
`getChapterTreeReportAtRevisionJson`, plus JS wrappers) builds the
fragment tree for every chapter whose typed tables the revision retains
and reports, per chapter, either the tree's size and fingerprint or the
exact fail-closed reason. First corpus run over the 46-book smoke
directory (38 books open; the 8 failures are the known style-resolution
fail-closed set): **1239 chapters, 519 representable (41.9%); of the 720
blocked chapters, 718 name inline images and 2 a missing body node.**
Images are effectively the only real blocker — implementing image content
in the fragment tree takes corpus representability to ~99.8%.

Image content landed next. `InlineItem::Image` carries intrinsic
dimensions plus typed style references; display sizing happens at layout
time in the inline provider (auto/fixed/ratio, `max-width` cap with
percentages against the available inline size; unsupported sizing keywords
fail closed). Images ride Parley's in-flow inline-box mechanism — the same
one the indent spike validated — and come back as `Fragment::Image` with
exact geometry (serialization tag 3). The bridge collects per-chapter
dimensions from the already-loaded image resources, and the collector
keeps browser space semantics around atomic inlines.

**Corpus representability jumped from 41.9% to 99.84% (1237/1239
chapters)**; the two residuals are chapters with no body source node.
rust suite 1397 tests; vitest core 2115; 81-book smoke green.

**The fragment-engine browser oracle is live.** `chapter-fragment-probe`
(a rito-core example binary) runs whole chapters through the full
production pipeline — parse, Stylo projection, reader-filtered fragment
tree via the new pub `RuntimeDocument::chapter_formatting_tree` seam
(footnote asides leave the flow exactly as production paginates), Parley
block layout — and `browser-fragment-baseline.e2e.test.ts` diffs every
line's text and ink geometry against pinned Chromium. Along the way the
`<br>` convention was wired (the parser encodes it as a text node holding
exactly one newline, the frozen engine's convention; the bridge now emits
it as a forced break) and the comparison stays text-symmetric (image-only
lines belong to the pixel oracle).

**First cutover-gate reading, book-01, 8 body chapters, 6319 text lines:
line-break parity 99.83% (6308 matches), x delta p50 = p95 = 0 px, width
delta p50 = p95 = 0 px; 5 of 8 chapters at 100%.** Every remaining
divergence is a character-level calibration point the dependency spike
already identified (closing-punctuation break exceptions — 9点/700日元/
一口咬定 — and the カルロ·ゼン interpunct, where Parley agrees with the
frozen engine and Chromium is the outlier).

Vertical convergence started next: the oracle now compares line-box y as
well. Two engine fixes landed from its first readings. (1) Root-edge
margin collapse: the chapter root behaves like a plain block box — the
first child's top margin and the last child's bottom margin escape the
container, so content starts flush at the top exactly like a browser
chapter body (nested containers keep formatting-context-root semantics
until the full through-collapse protocol). (2) The line-box model: Parley's
block min/max coordinates track ink extents, which drift from the CSS
line-height stack by rounding and leading distribution; line boxes now
stack by accumulated line height with the baseline at half-leading +
ascent, matching what per-character range rects expose in a browser.

y readings after both fixes: small chapters sit at a constant offset
(Section002 9.8px, Section006 4.1px — the chapter-heading block's
one-time height difference), while illustration-heavy chapters still
accumulate (p50 333px), pointing at image display sizing/centering and
unimplemented text-align (the 179.8px x-delta max matches a centering
difference). Line-break parity and x/width stay at 99.83% / p95 = 0.

text-align and the atomic-inline line box landed next, driven by the
oracle's drift curve. Parley's `align()` is wired from the typed
`text-align` (centered headings and illustrations; the Servo-internal
`-moz-*` values behave as their physical counterparts): **x delta max
dropped from 179.8px to 5.6px**. Lines holding an atomic inline are sized
by the CSS envelope — baseline-aligned content ascent plus descent, never
smaller than the paragraph's specified strut — instead of Parley's
inflated inline-box line height (577.8px vs the browser's 535.4px for a
531.4px illustration), and a block-final forced break no longer leaves a
phantom empty line (matching the browser's block-final `<br>` rule).
**y delta collapsed from p50 333px to p50 6.5px / p95 32.9px / max
42.3px.** The remaining vertical residue is a ~4px chapter-heading
one-time offset plus a slow sub-pixel-per-paragraph negative drift —
individual-pixel territory for the next pass.

Book-face pinning landed next. The chapter headings use a declared
`@font-face` family (`illus5`) whose font file is absent from the EPUB —
so the browser silently fell back to a system font, an oracle-environment
escape masking real differences. The capture procedure now pins every
declared family: present faces load their own bytes on both sides
(`ParleyInlineContext::register_named_font` binds bytes to the declared
name via fontique's FontInfoOverride, exactly like `@font-face`), and
missing faces map to the first pinned face in both the page CSS and the
probe. With fonts fully pinned the x delta max tightened to 4.3px and the
remaining y residue became precise: a constant per-heading-line ~3.2px
from `line-height: normal` font-metric models (the classic hhea/OS2
ascent-descent choice — the frozen engine solves this with its
`font_vertical_metrics` calibration samples, and the fragment engine will
consume the same mechanism), plus the `<sup>` noteref baseline-shift
residue. y currently p50 17.5px / p95 46.3px on the stricter oracle.

Round 9's remaining work before the gate closes: normal-line-height
metric calibration (reuse the production `font_vertical_metrics`
channel), sup/sub baseline shift, pagination-mode oracle, the full
through-collapse protocol, and the two calibration points' disposition —
then Round 10.

## Float column layouts: production defect (86 vol.1) and the honest gap

User-reported on 86―エイティシックス― `Text/illu4-t.xhtml` (character
introduction page): the page lays out as **paired float columns**
(`.box-left { width:49%; float:left }` / `.box-right { width:49%;
float:right }`). The browser renders two columns; the production frozen
engine loses the right column entirely and spills earlier content into
the page's top-right corner. The frozen engine's float support
(`continuous_float`) does not handle this pattern; per the freeze policy
this is not fixed in place — it is the strongest real-book evidence yet
for the fragment engine's float support.

The fragment tree builder previously accepted floated boxes silently and
would have stacked the columns vertically — wrong layout without an
error. It now fails closed naming the floated element. Honest corpus
representability: **96.37% (1194/1239)**; floats block 43 chapters
across the corpus (character pages, title pages, illustration captions —
exactly the 86 pattern, plus book-01's contents page already excluded
from the oracle profile).

Disposition: implement the paired-float-column profile in the block
formatting context (typed FloatV1/ClearV1 and percentage widths are
already projected; the browser screenshots give the acceptance
geometry). Until then the reports say precisely which chapters wait.

**The deeper lesson became a structural fix: the capability whitelist.**
The float leak proved that enumerating _unsupported_ things (a blacklist)
leaks by construction — anything not on the list mis-lays silently and
only a human can catch it. The bridge now inverts the default: every
field of every style used by a chapter must hold a value the engine
explicitly implements (or one that provably cannot affect layout, like
paint-only properties and CSS-inert combinations — inherited list
markers on non-list-items, clear without floats). Anything else fails
closed naming the field. A whitelist can only over-reject — visible in
the reports — never silently mis-lay. Two CSS-semantics refinements came
out of the fixture immediately: inherited-but-inert properties pass, and
box-level fields (margins/borders/vertical-align) are checked on actual
inline boxes, not on text runs borrowing an ancestor's style.

Honest corpus representability under the whitelist: **79.0% (979/1239)**,
and the complete gap list is twelve patterns: horizontal margins (57
chapters, includes margin:0 auto centering), vertical-align super (34 —
also blocks 5 of book-01's 8 oracle chapters, queue head), float columns
(30), letter-spacing (23), padding (29), word-break break-all (20),
sized blocks (36), nowrap (12), single-item flex (10), plus a small
tail. Notably ~55 of those chapters are pure wiring (letter/word
spacing, word-break, nowrap are existing Parley properties). The
distribution is convergent, not an open tail — the whitelist is now the
authoritative coverage dashboard, and the oracle records blocked
chapters instead of failing (report-first, rejection visible).

## Horizontal box model and vertical-align land; whitelist dashboard drives the queue

Under the capability whitelist the queue is data-ranked, and two heads
fell in one pass. `vertical-align: super/sub`: inline items carry an
accumulated `baseline_shift_px` resolved at tree construction (ancestor
chain walked once), the inline provider raises shifted runs and grows the
line box by the risen overflow (browser risen-line-box semantics), and
book-01's noteref chapters unlocked — 8/8 oracle chapters measured, 6 at
100% line parity. Horizontal box model: CSS block-level width resolution
(`margin + padding + width = containing width`) with auto-margin
centering, container padding framing the content area (blocking
parent-child collapse per CSS), per-child border-box placement, nested
containers sized by their border box, `box-sizing` added to the typed
contract and projected from Stylo.

Corpus representability: 79.0% → 80.6% (sup) → 88.4% (horizontal box) →
92.9% (Parley wiring: letter/word spacing, word-break, overflow-wrap,
nowrap straight into ranged styles) → **94.7%** (fixed heights — content
overflowing a fixed box still fails closed at layout time — and
max-width capping the horizontal model, including the
max-width+margin:auto centering pattern). Remaining queue: floats 43,
single-item flex 10, inline padding/border 9, tail 4. Oracle unchanged
at 99.83% parity, x p95 = 0, y p50 13.6 (heading strut metrics and
shift-constant calibration are the remaining y residue).

## OPEN — after the third pass

1. **Memory gate: 3 items over budget — attribution now complete.** Every
   dispose acknowledgement now reports the WASM linear-memory high-water mark
   (`wasmMemoryByteLength`), recorded per session in the gate's
   worker-lifecycle report. What the measurements establish:
   - **Core is exonerated.** Across every run the recycled Worker's WASM
     instance is 28.5 MiB after the first session and a flat 39.6 MiB from
     the third onward — no growth over eight replacement cycles. A recycle
     byte-budget is unnecessary; the earlier "wasm ratchet" hypothesis is
     refuted.
   - The `replacementGrowthMiB` overrun (measured 95.6 / 171.4 / 198.1 across
     runs against 96; one run passes) lives in renderer-internal, non-JS-heap
     memory: page JS heap (~6-9 MB), page backing store (~33 MB), GPU,
     browser, and network processes are all flat while the single renderer
     process saw-tooths upward. The `disposed` checkpoint falls **below** the
     `reflow` level, so nothing is retained unboundedly; product-side
     `ImageBitmap.close()` discipline is in place on every release path. The
     residue is decoded-image/Blink cache memory with lazy reclaim.
   - The checkpoint stability window (3 × 250 ms samples, ≤8 MiB range) is
     shorter than that reclaim cycle, which is exactly where the run-to-run
     variance comes from. Making the replacement checkpoints wait out the
     reclaim (or measuring retention at a settled point) is a
     **gate-methodology change that needs its independent baseline review**
     before it can be used to pass the gate.
   - The one failed open at ordinal 11 is `disposeThroughInvalidFile` — the
     scenario's deliberate invalid-file teardown; `releasedDocument: false`
     with no document created is benign.
   - Decoded bitmaps are now byte-bounded: book-01's 36 images decode to
     141.1 MiB total (front matter alone 82 MiB), previously resident for the
     whole session. `decoded-image-cache.ts` evicts least-recently painted
     bitmaps above a 96 MiB budget, protecting pending loads and the active
     spread; an evicted image re-warms on demand through the existing
     missing-image path. This bounds real full-book reading residency (the
     plan's Round-2 byte-budget requirement) but does **not** move this gate:
     the scenario never decodes past the budget, and a verification run
     measured the same metrics within run-to-run variance (loadedDelta
     196.9-205.0, peak 509.9-582.6, replacementGrowth 124.7-184.5, disposed
     208.8-224.0 — `disposedRetainedMiB` crossed its threshold in this batch
     purely on that variance). All four metrics stay open pending the
     sampling-methodology review above; iterating product changes against a
     noise-dominated measurement is explicitly not the next step.
2. **Release-path fail-granularity**: `releaseChapterLocalRevision` still
   fail-closes the session on any typed release error; distinguishing
   unknown-revision (benign, already gone) from a live-owner release failure
   would narrow the blast radius further.
3. Evidence coverage after the third pass: local `flutter test` (141/141)
   and every Rust/JS suite are green; the release-protocol E2E passes; the
   usability gate passed twice consecutively and real-book smoke is 81/81.
   **iOS simulator adapter build smoke passes**: a minimal
   `packages/rito_flutter/example` host app builds `Runner.app` with the
   Rust Native Asset compiled and embedded as `rito_ffi.framework`
   (a fat x86_64 + arm64 simulator binary; the missing rustup targets were
   the only obstacle and are named by the hook's own error). **Android build
   smoke passes**: `flutter build apk --debug --target-platform
android-arm64` cross-compiles rito-ffi through the hook and embeds
   `lib/arm64-v8a/librito_ffi.so` in app-debug.apk (SDK, NDK 28.2, and
   licenses were already present; the `cmdline-tools` gap `flutter doctor`
   flags is not required by Gradle). On-device/runtime Flutter integration
   remains unrun.

## Fixed this pass

### Reader-v1 could not build from source

`reader-v1.ts` referenced `./reader-v1-worker-entry.mjs`, which only existed in
`dist/`. Any source-mode bundler (the demo app, a product Vite/Nuxt build)
failed to resolve it, so Reader-v1 had never actually run outside the packaged
artifact. Added the source facade next to the bounded path's existing one.

### CSS source gate refused ~30% of real books

The gate rejected a whole publication for any declaration outside a hardcoded
allowlist — author typos, extension-injected custom properties, `@charset`,
duplicate manifest entries, and CSS the typed contract cannot yet carry.
Rebuilt it as a classifier: Stylo is the authority on what CSS defines,
unrepresentable declarations are recorded (ignored/degraded) in a
publication-level `style_capabilities` report, and only security/unscannable
syntax still fails closed. Real-book smoke: 57/81 -> 79/81.

### `position` was a migration regression

The frozen layout engine supports `position`/relative offsets; the Stylo
migration dropped the field from `LayoutFormattingStyleV1`. Restored
`PositionV1` + physical inset through contract, projection, and materializer.
Also `@media` (Stylo evaluates it — the gate now scans the group), `z-index`
(no-op for the flow consumer), `text-wrap-mode` (already in the contract).

### reflow deadlock from a leaked exact-read suspension

resize / typography / spread / line-breaking all reflow through a bounded
session that suspends "exact reads" and hands them back on commit. Three paths
left the suspension stranded, so `waitForExactReads` spun forever with no
timeout and no error — a silent deadlock on core interactions. Fixes, all
defensive and worth keeping regardless of the root cause below:

- `restoreBrowserReaderExactReads` no longer throws when the controller is
  already dead (reading a dead snapshot); it returns false so the caller runs
  its retirement path instead of skipping cleanup.
- `retireBrowserReaderBoundedOwner` unconditionally releases a suspension the
  retired owner still holds — covers every session-death path at one point.
- `waitForExactReads` no longer throws when the current session is gone: a
  reflow builds its own candidate, so a missing session just means no in-flight
  reads to drain; the anchor capture falls back to the last active spread. A
  bounded timeout reclaims a session whose gate never reopens.

## RESOLVED in the second pass — the reflow deadlock's true trigger

(Kept for the trigger analysis; the fix is recorded above.)

**`createBoundedChapterLocalRevision` returns a frame with an unreferenced
image resource.** Core-level data inconsistency: a chapter-local frame lists an
image in its `resources` whose href is absent from that frame's
`resourceTable`, so `requireFrameResourceRefs`
(`packages/rito-core-wasm/src/chapter-local-frame-validation-runtime.js:170`)
rejects it. That rejection tears down the worker, which is what stranded the
reflow suspension above.

Trigger: TOC jump to a far chapter with an image (book-01 `Theatre01.xhtml`).

Why it is not being fixed now: chapter-local preview is an **optional,
unverified** acceleration exposed through a pluggable capability
(`chapter-local-capability.ts`, `Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation')`).
It is part of the `e330bcb` "statically connected, not new green evidence"
batch. The defensive fixes above already turn its failure from a deadlock into
a recoverable error. The remaining product gap is that a preview failure fails
the whole TOC jump instead of falling back to an ordinary jump — a
fail-granularity problem to fix in the kit/browser layer, not a reason to chase
the core resource-table inconsistency before the feature is even validated.

Fix the core inconsistency when chapter-local preview enters real validation.
Locate at the `createBoundedChapterLocalRevision` aggregate response builder in
`crates/rito-core` — its resource set and resource table must be built from one
source of truth.
