# Direct FFI integration

For hosts that are neither web nor Flutter (React Native, native apps,
game engines): bridge the engine through its C ABI directly.

## What you consume

- **`crates/rito-ffi`** — build it yourself from this repository
  (`cargo build --release -p rito-ffi` → `librito_ffi`). The crate is
  not published to crates.io and no prebuilt binaries are distributed;
  pin a commit of this repository and rebuild when you move it.
- **`crates/rito-ffi/include/rito_ffi.h`** — the ABI contract. Every
  function, status code, ownership rule, and the cost model live in its
  comments; treat it as the reference, not this page.
- **Wire messages** — requests and responses cross the ABI as
  length-framed binary messages (`RITOREQ1`, `RITOART1`, `RITODL1`,
  `RITONAV1`, …). If you hand-write a decoder, you own keeping it in
  lockstep with the engine commit you build (see below).

The engine, its wire encoding, and your decoder must always come from
the same commit. There is no cross-version wire compatibility
guarantee inside a major protocol version: fields are appended as the
paint domain grows, and a stale decoder misreads the byte stream.

## Non-negotiable contracts

- **Pinned font policy is required.** Chapter-local pagination shapes
  with pinned faces only — an open without a pinned font policy fails
  closed. This is what makes page N the same page on every platform.
- **One-pass cost model.** Opens, seeks, and cross-chapter turns build
  the whole target chapter in one call. There is no window pumping and
  no cooperative-retry loop for an exact target, and `RITOREQ1` /
  `RITONAV1` carry no work budget. A backward cross-chapter turn lands
  directly on the previous chapter's final page.
- **Open locators are treated as persisted data.** A saved source point
  or anchor that no longer resolves degrades to the locator's
  progression, then to the chapter start; `matchedBy` on the artifact
  reports what actually resolved. Only an unknown href fails an open.
- **Candidates are invisible until adopted.** Every foreground result
  is a candidate; commit it through
  `rito_adopt_foreground_candidate` with the compare-and-swap
  expectation, exactly as the header describes.
- **Taps resolve against the artifact's hits, not its paint commands.**
  Each page's hit entries are the engine's account of links, note
  anchors (with the canonical footnote key and whether its definition
  is indexed yet) and images, already in display-list space. Resolve in
  hit order — text runs, then block-level link boxes, then images — so a
  link wrapping an image resolves as the link; `RitoHitResolver` in
  `rito_flutter` is the reference. Paint commands still carry `href`
  and `alt` for older bridges, but they are not the hit surface.

- **A stored highlight is projected by the engine, not rebuilt by the
  host.** Persist what a range _is_ — the manifest href plus the
  source-tree node paths and UTF-16 offsets of its endpoints — and ask
  `rito_resolve_exact_source_range` where it lands now. Do not try to
  derive that from an artifact's hits: a run's mapping back to its
  source node is piecewise (collapsed whitespace leaves gaps, and a run
  split at a space shares its seam offset with the next run), the hit
  entries carry no source offsets, and a range start and a range end
  resolve a seam differently. The call also checks the text it landed
  on against the range's own source text, so an anchor whose text has
  since changed reports unavailable instead of painting over unrelated
  words. `rito_get_text_range_geometry` remains the op for a range you
  already hold in page coordinates.
- **Selection runs through the engine, exactly as on the web.**
  `rito_resolve_text_interaction` answers the five queries a browser
  reader runs (`RITOTIQ1` → `RITOTIR1`): the caret at a point, the range
  between two carets (a dropped handle), a kept caret extended to a
  point (a moving handle or a character-wise drag), the range two points
  span widened to words or paragraphs, and a caret movement by
  character, word, line, paragraph or chapter edge. Points and geometry
  are in the artifact's display-list space; a caret address names the
  revision behind the artifact it came from, so reuse it only with
  artifacts of that revision. Word boundaries come from the engine's
  segmenter, so CJK text selects words the same way it does in a browser.
- **Annotations are stored as the engine writes them.**
  `rito_resolve_annotation` (`RITOANQ1` → `RITOANR1`) builds the target
  for a selection's source range and locates a stored one, both as the
  engine's canonical JSON — persist those bytes as they are. Locating
  runs the cascade every host runs (the source range checked against its
  quote, then the best-context quote, then the stored offsets, then the
  length-scaled position) and returns the target re-anchored where it
  landed; project that through `rito_resolve_exact_source_range` to paint
  it.
- **Reading positions are the engine's answer.** `rito_resolve_navigation`
  (`RITONVQ1` → `RITONVR1`) names the TOC entry a page or a source position
  reads under (by its `toc_id`), places a stored locator in an artifact's
  revision (the page, whether this artifact draws it, or that its chapter
  is not laid out), and orders two source positions in reading order. Use
  it for chapter titles, bookmark checks and turn direction rather than
  matching hrefs or comparing node paths yourself.

## Keeping a hand-written decoder honest

The Dart decoder in `packages/rito_flutter/lib/src/protocol/` is the
reference implementation of the wire reader and is updated in the same
commit as any engine-side encoding change. When you bump your pinned
commit, diff that directory (and `render/commands/reader_wire/` on
the Rust side) against your bridge.

`RITODL1` is written at format version 2 only: the device-resolved
primitive list the engine lowers every frame to (the byte layout is in
[Wire Format](../development/wire-format.md)). The header carries the
render ratio (u32 format version, f64 ratio, u32 primitive count), every
coordinate is a device pixel on the grid the host rasterizes, and the
opcodes are state, transforms, clips, fills, strokes, shadows and images
plus text and ruby runs. Text and ruby runs are the exception to the
device grid: their lengths stay in CSS pixels and a host draws them under
a `scale(ratio)` transform, because glyph rasterization follows the CSS
font size (a synthetic-bold run drawn at the device size on the device
grid rasters different ink from the browser's). A run carries only glyph
paint — font, colour, text shadows: its inline box (background band,
padding, border edges) and its decoration line arrive as fill and stroke
primitives around it, and its letter and word spacing are already in its
cluster origins. Every run carries the origin of every
cluster (UTF-8 byte offset into its text, absolute CSS x and y — its
alphabetic baseline, for a text run and an annotation alike) with
spacing, justification and the browser's fixed-point advances already
applied: a host draws each cluster at its origin with its own spacing
off and never places a glyph itself. An outside list marker is such a
run: the engine shapes the marker string, sizes its box on the layout
grid and sends the box's left edge and cluster origins. A ruby
annotation arrives the same way: the engine distributes it over its base
by the computed `ruby-align` — along a horizontal base or down a
vertical one. A vertical column arrives as runs of upright glyphs
stepped down the column, its corner marks shifted, and each rotated mark
as its own run under a quarter-turn transform primitive about its em
center. Every raster decision for blocks and inline
boxes — border bands and dash cadences, rounded rings, box shadows,
background sizing and tiling, decoration lines — is resolved in the
engine on the CSS grid and scaled last; a host blits paths, draws
images, and rasters glyphs at the origins it is given.
The Rust encoder (`reader_wire/encode/lowered.rs`) and the Dart
decoder (`protocol/primitive_decoder.dart`) are the reference;
`packages/rito-core-wasm/tests/fixtures/reader-session-primitive-list.hex`
holds bytes the live encoder wrote for one of every primitive, and a
Rust test keeps it in step. Format 1, the semantic display list, is no
longer written; a decoder rejects it by its version field. The same
bytes back the reader worker's frame command buffer, whose metadata
carries the ratio and primitive count beside the semantic frame's
command count, kind counts and hash.

Wire changes landed when revisions became complete on creation (reader
protocol version 5):

- Artifacts and publications stamp protocol version 5; a decoder pinned
  to 4 must move with it.
- The artifact record no longer carries the `terminal extent` bool after
  `height`: the `book page index` and `book page count` options follow
  the height directly, and both are present on every artifact of a
  whole-book revision (a revision holds its complete page table from the
  moment it exists).
- `adjacent availability` has three tags: 0 available, 1 chapter
  boundary, 2 terminal. The former `pending` (1) and `blocked` (4) tags
  described spreads a revision had not laid out yet; no revision is ever
  in that state.
- The search response (`RITOSRS1`) no longer carries the `scope complete`
  bool after `searched page count`; the count is the page table of the
  revision behind the artifact.
- A `complete` background advance carries no artifact: the first
  publication candidate already numbers its page against the book total.

Wire changes landed with the paint-geometry lowering (reader protocol
version 3, rito_flutter 0.3.0 era):

- The artifact request's layout record gained a trailing f64 `render
ratio` — device pixels per CSS pixel the host rasterizes at (its
  devicePixelRatio; 1 for a 1:1 canvas). Every raster snap in the
  display list lands on that grid. It is a paint parameter: pagination,
  page counts and revision identity are identical at every ratio, and
  an adjacent request inherits the session's current ratio. A ratio that
  is not finite and positive fails the request with `InvalidLayout`.
- Artifacts and publications stamp protocol version 3; a decoder pinned
  to 2 must move with it.
- Text and ruby runs (opcodes 12 and 13) carry glyph paint only — font,
  colour, text shadows — followed by line height, link target, source
  text and offset, then the cluster list: `u32` count and, per cluster,
  `u32` UTF-8 byte offset, `f64` x, `f64` y. The run's inline box and
  decoration line, its spacing, its `ruby-align`, the right-aligned
  marker flag and the vertical flag no longer exist on the wire: every
  glyph is placed by its origin, a column's rotated marks arrive as
  their own runs under a transform primitive.
- A ruby run's cluster origins are alphabetic baselines like a text
  run's (they were the annotation's em-box top): the engine places the
  annotation line over its base and a host draws every cluster the
  same way whichever run it belongs to.

Wire changes landed with the chapter-local one-pass cutover
(rito_flutter 0.2.0 era) that a hand-written decoder must mirror:

- `paintBlock.background.size` gained tag 4 (explicit axes): the tag
  byte is followed by two optional lengths (presence byte, then unit
  tag + f64 each); a missing axis is `auto`.
- Run paints gained a tail: one optional pair of f64 inline-box
  offsets (top, bottom — relative to the run rect top), then two bool
  bytes (`boxStart`, `boxEnd`).
