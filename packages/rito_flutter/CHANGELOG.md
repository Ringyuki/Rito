## Unreleased

### A line holds a text run per inline item

A line's text in one inline item is one text paint command and one text
page target, as the browser keeps one text fragment per inline item on a
line: the words, justification points and re-anchored ideographs it was
placed in stay inside it as the origins its clusters step from, so every
pixel is the same. A caret, a selection edge or a hit inside a run lands on
the cluster edges the run is drawn with instead of a proportional share of
its width, and a double tap selects the word the browser selects.

### A run's clusters are views of one table

`RitoTextPaintCommand.clusters` is a `RitoClusters`: the run's cluster
bytes, origins (x and y interleaved) and joins flags as `Uint32List`,
`Float32List` and `Uint8List` views of a table every run of the display
list shares, read where the message holds it. `RitoClusterPosition` is
gone; read cluster `i` as `bytes[i]`, `origins[2 * i]`, `origins[2 * i + 1]`
and `joins[i] == 1`. Runs that paint alike share one `RitoRunPaint`. The
text paint commands' constructors are no longer `const`.

### The engine runs on the calling isolate

`RitoNativeGateway` (formerly `RitoIsolateGateway`, still available as a
deprecated alias) calls the engine on the isolate that holds it instead of
a worker isolate: an answer is ready within the task that asked for it, so
the frame that asks for a layout can draw it, and no bytes are copied into
transfer buffers on the way. The reader controller lays the whole book out
four pages at a time, each step after the isolate's other work, instead of
512 pages a step. Opening a book and the first search hold the isolate
while they run. A host that asks for a relayout before a frame builds
(from `didChangeMetrics`) has the new page drawn in that frame. `RitoNativeWorkerTerminatedException` is deprecated:
nothing raises it.

### A range between two carets comes back with them

A text interaction that resolves the range between two caret addresses
answers with both carets, geometry and source point included, as a range
resolved from points does: a host that kept only the addresses of a
selection holds its ends as resolved.

### Clusters a pen reaches from the one before join its string

`RitoClusterPosition.joins` marks a cluster the one before it reaches by
its bare glyph advance, and the pen draws it inside the string started
before it: the text from each cluster that does not join up to the next
one is one paragraph, so a page of Latin text lays out a few hundred
paragraphs instead of one per character. Cluster origins arrive at
float32, the precision the canvas takes them at; the display list is
`RITODL1` format 3.

### Decoding an artifact allocates no view per number

The wire reader reads every number through one view of the message's
bytes; it made a view and a slice for each, which for a page of text cost
as much as laying the page out.

### A resize lays out only the spread it shows

A request at a new size lays the chapter out only through the spread the
reader stays on and the page after it, instead of the whole chapter. The
rest is laid out when a turn reaches it, or when a search, a text
interaction or a page table reads it; every spread is the one laying out
the whole chapter shows.

### Protocol and breaking changes

The artifact protocol is version 7 (was 6): the display list record no
longer carries a SHA-256 of its bytes. No host read it, and the engine
hashed the display list of every artifact it published, as for every
size of a window being resized. `RitoDisplayListPayload.semanticDigest`
is removed.

`RITONVQ1`'s layout query ends with a `whole` flag and `RITONVR1`'s page
table with `complete`. `RitoReaderSession.revisionLayout` takes `whole`
(default `true`, which is what it did until now): without it the table
holds the pages laid out so far, which `RitoRevisionLayout.complete`
reports. Locating a position no longer lays out the rest of its chapter.

`RitoReaderSession.advanceBackground` takes `maxPagesPerQuantum` (was
`maxTopLevelNodesPerQuantum`, which no layout read): a step lays the
publication out by at most that many pages, and its candidate comes with
the step that lays the last page out. `RitoReaderController.paginationQuantum`
counts pages too; its default of 512 lays most books out in one step.

## 0.7.0 - 2026-10-17

### Ranges across paragraphs inside one wrapper resolve

A source range spanning paragraphs that a chapter wraps in one element
(a `<div>` around the text) resolved as unavailable: the paragraphs
shared their wrapper's block, so their text ran together and no longer
matched the source. Each paragraph now counts as its own, so such a
highlight gets its rects, and a selection across paragraphs copies with
the blank line between them.

### A relayout no longer waits behind the whole-book pagination

`RitoReaderController` started paginating the whole book again right
after every `relayout`, and a pagination step holds the session for as
long as the book takes, so a relayout requested meanwhile (the next size
of a window being resized) waited for it. Pagination now waits until no
relayout has been asked for `RitoReaderController.layoutSettle` (300 ms).

### A page lays out only the characters no page has painted yet

The page painter lays each character of a run out as its own paragraph
and meant to keep them across paints, but kept them on a target it made
anew for every paint: every page, and a page painted again (a turn
settling, a neighbour's texture), laid out every distinct character it
showed. One cache now serves every page and session, keyed by the
character, its font family stack, size, weight and slope and its ink; it
keeps at most 2048 (some twelve megabytes), dropping the least recently
used first. Measured under
flutter_tester on 450-character pages of a CJK book: a new page from
about 10 ms to 2 ms, a page painted again from 10 ms to under 1 ms.

### Box shadows paint as Chromium paints them

A box whose corners are rounded differently cast a square-cornered shadow
that showed past its rounded corners; the shadow now takes each corner's
radius. A spread shadow on a square box stays square, a corner smaller
than the spread grows by the CSS corner correction, and the shadow is cut
out along the box's rounded outline, one pixel inside an opaque
background, so no thin grey line shows along its edges. Only the blurred
shadow paints: the shape it is cast from was also drawn, unblurred, as a
hard ring around any box with a spread.

### Floated images, `::before` and `::after`, and `position: absolute`

The engine lays out three more pieces of CSS that chat-style pages
(avatars beside speech bubbles with pointed tails) are built from. A
floated image that opens its block's content floats, with the following
lines and floats beside it; it used to stay an inline image on a line of
its own. `::before` and `::after` are generated, as text, a block, a
float or an absolutely positioned box by their `display`, `float` and
`position`, showing their strings and `attr()` values (`counter()`,
quotes and images show nothing). `position: absolute` takes a
block-level box out of the flow and places it against its nearest
positioned ancestor by its insets.

### No blank page before an illustration that follows an empty element

An illustration sized to the page left a blank page before it when it
followed an element with no height, such as a `<div>` holding only an
anchor: the empty element took no space but counted as content, so the
illustration's line, a few pixels taller than the page, broke to the
next page instead of overflowing on this one as it does in a browser. An
element with no height now leaves the page empty, as in Chromium; its
margins still take space, and a forced break after it still starts a new
page.

## 0.6.0 - 2026-10-16

### Page turns tell an effect which page is which, as on the web

`RitoPageTurnPages.spread(slot)` says which spread of the book a slot
shows, like `TransitionPage.spread` in `@ritojs/kit`: what tells a page
from every other from one turn to the next, in reading order. The next
page's is one more than the current page's and the previous page's one
less; a page keeps it as turns move it between slots, and when background
pagination renumbers it; a jump or a relayout numbers its page apart from
every page before it. It is counted by the turn controller, not taken from
the engine's page indexes, which start again at each chapter until the
whole book is laid out. **Breaking** for a class that implements
`RitoPageTurnPages`: it adds `spread`.

`RitoPageTurnTouch.farthest`, like `TransitionTouch.farthest`, is where
the finger was when it had carried the turn farthest the way the turn
goes; a finger short of it has come back. Frames and the release a
`RitoPageTurnPhysics` judges both carry it; a touch built without it is
at its farthest.

### Prewarming rasterizes the pages a turn starts from

`RitoPageTurnController(prewarm: true)` laid out both neighbours ahead
but rasterized no page until a turn's first frame drew it, which then
drew the page on screen and the incoming one. Now, once nothing moves,
it rasterizes the page on screen and both neighbours, one per task of the
event loop between frames, and does again when one changes at rest (an
image landing late, `invalidatePages`, a new pixel ratio): a turn starts
with nothing to draw. Three page images stay in memory at rest, as the
web reader keeps three. A controller disposed before that work is done
cancels it.

## 0.5.0 - 2026-10-14

### Unsupported sizing keywords no longer fail a chapter

A block or image sized with `fit-content`, `min-content`, `max-content`,
`fit-content()`, `-webkit-fill-available` or `stretch` used to fail its
chapter's layout. Until these sizes are computed they lay out as `auto`
(an image keeps its natural size), an intrinsic `max-width` caps nothing,
and the rest of the element's style — numeric widths and caps, padding,
margins and borders — still applies. A float with `stretch` or
`-webkit-fill-available` fills the available width; with the other
keywords it shrinks to fit.

### A peek leaves a pending navigation adoptable

`RitoReaderSession.peek` and `peekSpread` consume a request id without
being a navigation. One made between `requestArtifact` or `turn` and the adoption
of its result used to make that adoption fail as stale; the engine now
compares a candidate only against foreground requests, as the peek's
contract already said.

### A revision's page table, and any spread of it

`RitoReaderSession.revisionLayout` answers the page table of the revision
behind a page (`RitoRevisionLayout`): its spreads (`RitoSpreadPages`), the
pages of each chapter it lays out (`RitoChapterPages`) and where its TOC
entries land (`RitoTocTargetPage`). A page shown from a fresh request is
laid out with its chapter alone, so the table covers that chapter and
counts pages from zero; once the whole book is adopted it covers the
book. `peekSpread` publishes any spread the table lists as a prepared
read-only artifact at the cost of a peeked turn, and `commitSpread` makes
it the visible page with a compare-and-swap, so a jump to a known page no
longer goes through a locator and a layout request.

### Hit entries say what they are

Each `RitoHitEntry` carries the engine's classification — `RitoHitKind`
`text`, `link`, `image`, `footnote` or `footnotePending` — and, for a
link, where it leads (`targetLocator`) and what its destination is called
(`destinationLabel`). `RitoHitResolver` decides a tap by the kind and no
longer infers it from the fields an entry happens to carry, so a tap
resolves the way it does in the web reader.

### Geometry on every page of a range

`textInteraction` and `exactSourceRange` take `everyPage`: rects and caret
geometry then reach every page of the revision the range covers, each in
the display-list space of the spread that draws its page, so a host can
hold a selection or a highlight across spreads from one artifact. Without
it an answer covers the pages the artifact draws, as before.

### Faces the host cannot load

`RitoReaderSession.markFontFamiliesUnavailable` tells the engine of
publication faces the platform refused to load, by the family an artifact
lists them under. The next request lays out without them, so a run is
never measured with one face and painted with another.

### Overrides that yield to the publication

`RitoLayoutRequest.lineHeightForce` and `fontFamilyForce` say whether the
line-height and font-family overrides outrank the publication's own
declarations. Both default to `true`, which is what the overrides did
until now.

### Protocol and breaking changes

The artifact protocol is version 6 (was 5): a hit entry gains its kind,
target locator and destination label. `RITOTIQ1` and `RITOESQ1` end with
the every-page flag, `RITONVQ1`/`RITONVR1` gain the layout query and its
page table, the layout request gains the two force flags, and `RITOSPQ1`
asks for a spread by its position. The C ABI gains `rito_peek_spread` and
`rito_mark_font_family_unavailable`. `RitoReaderGateway` gains
`peekSpread`, which a custom gateway must implement
(`markFontFamiliesUnavailable` is on the optional `RitoFontGateway`), and
`RitoHitEntry.kind` is required of code that builds hit entries itself.

### Faster layout changes

The engine parses a publication's stylesheets once per worker instead of
once per chapter per layout, and its layout cache evicts in logarithmic time
(a full cache used to scan every entry on each insert, which made layouts
after the first slower than the first).

### Page turns and a reader controller

`RitoReaderController` owns the page a session shows: turns, jumps and
relayouts replace it and release the page they replaced, neighbours are
peeked once per page and released with it, background pagination adopts
the renumbered page by itself, and all session work runs one operation at
a time. `RitoPageTurnController` turns pages over it with the web
reader's physics and lifecycle (one start and exactly one end per turn,
with an outcome), committing on the reader while the animation plays,
prewarming neighbours and redrawing a page whose images land late.
`RitoPageTurnView` paints the turn with `RitoPageTurnEffects.slide`,
`cover`, `fade` or `none`, a layered effect, or an effect that paints the
frame itself from the page images. How a turn moves and looks is the
application's to replace: a frame tells an effect what is moving the turn
(`phase`), how fast, and where the finger took hold and where it is
(`touch`); an effect on a clock of its own asks for repaints (`repaint`);
and a `RitoPageTurnPhysics` subclass decides how far a finger carries the
turn (`travel`), how the ends of the book resist (`resist`), whether a
release turns the page (`lands`) and the `Simulation` that carries the
turn to rest (`settle`), which also decides when the turn is over. The
controller's drag methods take the finger's position and its velocity as
an `Offset`. A turn or a finger that arrives while a turn is on screen
cuts into it: that turn ends once the reader has landed it, wherever its
picture is, and the next begins where the page is and as fast as it moves
(`RitoPageTurnPhysics.begins` says otherwise; a release is judged by how
far the finger carried the turn, `RitoPageTurnRelease.from` being where it
took it; `RitoPageTurnController.isMoving` is true while a turn or what is
left of one is on screen).

### Pages never wait for their images

`RitoArtifactImageCache.prepare` returns its lease at once and each image
joins it as it lands, so a page turn presents immediately. The lease is a
`Listenable` and `RitoPageSurface` repaints from it: an image under a
second on its way paints nothing, then its loading placeholder (a block
tinted toward the text colour with a picture icon); a late image fades in
over it in 150ms; a failed one paints a broken-picture placeholder. A
read that failed because the host could not load the image's shard
(`RitoTransientResourceFailure`) is read again after 2s, 5s and then every
15s while a page shows the artifact, and at once when one shows it again.
`RitoPreparedArtifact.imagesSettled` completes once every image has landed
or failed, for a host capturing a finished page.

### Publications delivered as shards

`RitoReaderSession.openShards` opens a book split by `rito-pack` from its
skeleton shard. The skeleton carries every chapter, stylesheet and font
and every image's size, so opening, seeks, turns, peeks and whole-book
pagination behave exactly as on a session opened from the whole EPUB.
Each image sits in a shard of its own: the engine names it the first time
the image is read, and the gateway loads it through the `loadShards`
callback, hands it to the native session and retries the read. While the
native worker is idle, the gateway supplies image shards ahead of need,
nearest the chapter being read first, one at a time. Encrypted shards carry their own 32-byte keys.
`ritoNativeStatusResourcePending` reports a call whose shards could not be
supplied, with the shard ids in `RitoNativeException.pendingShards`; the C
ABI gains `rito_open_shards_with_pinned_fonts`, `rito_supply_shard`,
`rito_content_shards_near` and
`RITO_STATUS_RESOURCE_PENDING`, whose `error_out` carries a `RITOPSH1`
message.

### Line heights match the web reader

The engine now derives `line-height: normal` geometry — plain lines,
ruby annotations and super/subscript lines — from the fonts it shapes
with, the way Chromium does. A browser host used to measure these with
the DOM while a native host fell back to shaped metrics, so the same
book could paginate differently; both now get identical lines.

### Selection runs through the engine, exactly as on the web

`RitoReaderSession.textInteraction` answers the five queries a browser
reader runs, with the same engine code: `RitoCaretQuery` (the caret at a
point), `RitoRangeQuery` (the range between two carets, as when a handle
is dropped), `RitoRangeToPointQuery` (a kept caret extended to a point,
as while a handle or a character-wise drag moves),
`RitoRangeFromPointsQuery` (the range two points span, widened to words
or paragraphs) and `RitoMovementQuery` (a caret step by character, word,
line, paragraph or chapter edge, keeping its column across vertical
steps when the returned preferred positions are passed back). Word
boundaries come from the engine's segmenter, so CJK text selects words
the way it does in a browser. Points and geometry are in the artifact's
display-list space, and a `RitoCaretAddress` names the revision behind
the artifact it came from.

### Annotation targets are built and located by the engine

`RitoReaderSession.createAnnotationTarget` builds the target for a
selection's source range and `resolveAnnotationTarget` locates a stored
one, trying the source range (checked against its quote), then the quote
with the best-matching context, then the stored offsets, then the
length-scaled position, and returning the target re-anchored where it
landed with the `RitoAnnotationLevel` that found it. A
`RitoAnnotationTarget` carries the engine's canonical JSON in `json` —
the bytes a browser host stores for the same range; persist it as it is
— and its decoded contents, so the adapter never parses JSON.

### Reading positions are the engine's answer

`RitoReaderSession.tocEntryAtPage` names the TOC entry (its `tocId`) a
page reads under — the last entry, in TOC order, whose target sits at or
before it, the rule the web reader's active entry follows — and
`tocEntryAtPosition` names the entry a source position reads under, on
the source alone, for a stored highlight's chapter. `locate` places a
stored locator in an artifact's revision (`RitoLocatedPage` with whether
the artifact draws it, `RitoNotLaidOut`, or `RitoLocationUnavailable`), and
`compareSourcePositions` orders two positions for a turn's direction. An
empty `<a id/>` marker, an image id or an id after the last text now
resolves where a browser scrolls to it instead of refusing the target.

### Protocol

The wire gains `RITOTIQ1`/`RITOTIR1`, `RITOANQ1`/`RITOANR1` and
`RITONVQ1`/`RITONVR1`, and the C ABI gains `rito_resolve_text_interaction`,
`rito_resolve_annotation` and `rito_resolve_navigation`.
`RitoReaderGateway` gains `textInteraction`, `annotation` and
`navigation`, so a custom gateway must implement all three.

## 0.4.0 - 2026-09-29

### A stored highlight is projected by the engine

`RitoReaderSession.exactSourceRange` asks where a durable source range
lands on the pages an artifact draws. Persist what a highlight _is_ —
the manifest href plus the source-tree node paths and UTF-16 offsets of
its endpoints — and pass it back; the answer is
`RitoExactSourceRangeResolution`, whose rects are in the artifact's
display-list space like `RitoHitEntry.bounds`.

This projection could not be rebuilt host-side. A run's mapping back to
its source node is piecewise: collapsed whitespace leaves gaps, and a
run split at a space shares its seam offset with the next run, which a
range start and a range end resolve differently. Hit entries carry no
source offsets at all. The call also checks the text it landed on
against the range's own source text, so an anchor whose text has since
changed reports `RitoExactSourceRangeStatus.unavailable` instead of
painting over unrelated words.

Rects cover only the pages this artifact draws. A range that resolved
elsewhere comes back resolved with no rects and `firstPageIndex` set:
navigate there and ask again. `textRangeGeometry` is unchanged and
remains the op for a range already held in page coordinates, such as a
live selection.

The wire gains `RITOESQ1` and `RITOESR1`, and the C ABI gains
`rito_resolve_exact_source_range`. The artifact protocol version is
unchanged.

### OpenHarmony builds compile rito-ffi for the OHOS targets

The Flutter-OH toolchain runs build hooks for a HarmonyOS build with a
Linux target and the OpenHarmony SDK's LLVM as the C compiler, so the
hook used to take it for a cross-architecture Linux desktop build and
refuse it. A C compiler under `openharmony/native/llvm/bin` now selects
`aarch64-unknown-linux-ohos`, `armv7-unknown-linux-ohos` or
`x86_64-unknown-linux-ohos` by architecture, links with that SDK's
`clang` against its `sysroot`, and ships `librito_ffi.so`. Other Linux
builds are unchanged.

Install the Rust target for the pinned toolchain, for example
`rustup target add aarch64-unknown-linux-ohos`. The HAP also has to
carry `NativeAssetsManifest.json`, which Flutter-OH bundles from the
release after `3.41.10-ohos-1.0.1`.

### Breaking

`RitoReaderGateway` gains `exactSourceRange`. A host that implements
that interface itself (a test double, usually) must add the member.

## 0.3.0 - 2026-09-14

Breaking, and larger than a point release: a frame is no longer a list of
paint commands, and the session no longer carries the bounded-work
surface. The artifact protocol is version 5 (was 3).

### A frame is a primitive list

`RitoDisplayList` and `RitoCommand` are replaced by `RitoPrimitiveList`
and `RitoPrimitive`. Every command type is gone with them —
`RitoPaintBlock`, `RitoPaintImage`, `RitoPaintPage`,
`RitoPaintHorizontalRule`, `RitoClipRect`, `RitoOpacity`,
`RitoTransform`, `RitoTranslate`, `RitoPushState`, `RitoPopState` — and
the fields that only they carried: `borderBox`, `boxSize`, `radius`.

The engine now resolves boxes, rules and page grounds itself and emits
what a canvas draws: `RitoPrimitiveFillRect`, `RitoPrimitiveFillPath`,
`RitoPrimitiveStrokePath`, `RitoPrimitiveDrawImage`,
`RitoPrimitiveText`, `RitoPrimitiveRuby`, `RitoPrimitiveShadow`,
`RitoPrimitiveClipPath`, `RitoPrimitiveOpacity`,
`RitoPrimitivePushState`, `RitoPrimitivePopState`,
`RitoPrimitiveTransform`, `RitoPrimitiveTranslate`. Paths arrive as
`RitoDevicePath` built from `RitoPathOp` values (`RitoPathMoveTo`,
`RitoPathLineTo`, `RitoPathRect`, `RitoPathArc`, `RitoPathEllipse`,
`RitoPathClose`) with `RitoFillRule`, `RitoStrokeCap` and
`RitoDashPattern`; a tiled background arrives as `RitoTilePlan`, a page
ground as `RitoFillGround`, and a transform as `RitoDeviceScale`,
`RitoDeviceRotate`, `RitoDeviceTranslate` or `RitoDeviceTransform`.

A host that walked commands and decided how to draw a block now walks
primitives and draws them. There is no layout decision left on the host
side, which is the point of the change.

### A text run carries cluster origins, not spacing

`RitoRunPaint` loses its letter- and word-spacing fields, `rubyAlign`
and `topAnchorAscentPx`. The engine folds spacing, justification and
annotation alignment into per-glyph-cluster origins, delivered as
`RitoClusterPosition` on the run's `clusters`. A pen draws each cluster
at the origin it is given and computes no placement of its own.

`renderRatio` is new on the layout: the device pixels per CSS pixel the
artifact was resolved at. `withLayout`, `withRenderRatio` and
`withRequestId` are new request helpers.

### The bounded-work surface is gone

- `RitoWorkBudget` is removed, with its `localPageCap`,
  `maxForegroundQuanta` and `maxTopLevelNodesPerQuantum` fields.
  `peek()` and `turn()` no longer take a `work:` argument — drop it at
  every call site. The session never read the budget: a target chapter
  is paginated whole in one native call.
- `RitoPendingExactSeekDriver` and `RitoPendingExactSeekLimitException`
  are removed with the exact-seek retry loop they drove, and
  `ritoNativeStatusExactSeekPendingV1` leaves the barrel. An exact open
  or seek returns either the artifact or a terminal error.
  `RitoResumableExactSeekGateway` stays: a seek issued while a
  superseded adjacent turn consumed native request ids still needs a
  substituted id.
- `RitoArtifact.terminalExtent` is removed; it was always true once a
  revision was created complete.
- `RitoAdjacentAvailability` loses `pending` and `blocked`, leaving
  `available`, `chapterBoundary` and `terminal`, and their wire tags
  renumbered.
- `RitoSearchResponse.scopeComplete` is removed; a search always covers
  the whole book.
- Every `V1` suffix leaves the Dart API, matching the engine and the C
  ABI. The names are otherwise unchanged.

### Taps resolve against hit entries

`RitoHitResolver` resolves taps against the artifact's hit entries — the
engine's own account of links, note anchors (with their footnote key and
pending state) and images, in display-list space. Hosts no longer read
semantics off what they paint; a link's text band widens by `linkSlack`
for coarse pointers and a link wrapping an image resolves as the link.

A painted text run carries the enclosing link's `href` again, and a hit
entry carries the image's alt text. 0.2.0's fragment cutover shipped both
as null, so a host resolving taps saw no links — a tap on a note anchor
fell through to the image viewer.

### Protocol

`RitoArtifactDecoder.protocolVersion` is 5 (was 3). A hand-written
decoder must follow every step: the display list became a primitive
list, version 4 removed the work record from artifact and adjacent
requests, and version 5 removed the artifact's terminal-extent flag and
the search response's scope flag and renumbered the adjacent
availability tags.

### Not breaking

A paginated book keeps its page table rather than its pages, so a
2624-page book paginates in 239 MB instead of 471 and a whole-book
search runs in 94 ms instead of 1888.

## 0.2.0 - 2026-08-29

- Chapter-local pagination builds the whole target chapter in one pass:
  backward cross-chapter turns land directly on the previous chapter's final
  page with no cooperative-retry loop, and background whole-book pagination
  publishes the book page count from the first candidate.
- Opening without a `pinnedFontPolicy` now fails closed (breaking): the
  fragment engine shapes with pinned faces only, which is what keeps pages
  identical across platforms.
- An open locator that no longer resolves degrades sourcePoint → progression →
  chapter start instead of refusing the book; `matchedBy` reports what
  actually resolved.
- Search hits on fragment-paginated books carry durable source locators again.
- The display protocol covers explicit `background-size` axes, border edge
  widths, and engine-computed inline box extents with open/close flags.
- The canvas pen matches the browser pen's measured geometry: CSS
  Backgrounds §5.5 radius overlap scaling, binary border bands with the
  browser's dash/dot cadences and double sub-lines, horizontal rules through
  the same border model, text shadows composited under the glyph at its own
  origin, and whole-pixel inline box edges. Residual differences are
  rasterizer-kernel classes, pinned by the paint-parity budget gate.
- EXIF quarter-turned JPEGs validate against the engine's presented dimensions
  (a rotated plate no longer fails artifact preparation).
- A failing image degrades to a recorded absence instead of blocking the page
  turn: `resolveImage` now returns null for it (breaking), the fault is
  reported through `FlutterError`, and the lease lists it in `failedImages`.

## 0.1.0 - 2026-07-31

- Introduce the Flutter adapter for Rito's native EPUB reader protocol, with
  typed artifact/display-list decoding and `CustomPainter` replay.
- Add isolate-backed reader sessions for open, seek, reflow, adjacent turns,
  background pagination, resource reads, search, and text-range geometry.
- Add explicit artifact ownership, latest-wins cancellation, prepared font and
  image resources, bounded caches, and page-turn-safe lifecycle handling.
- Add Native Assets builds for Android, iOS, macOS, Linux, and Windows from the
  pinned `rito-ffi` Rust source included in the published package.
- Add Canvas paint parity for typed colors, borders, radii, shadows,
  backgrounds, images, inline decoration, ruby, and font envelopes.
