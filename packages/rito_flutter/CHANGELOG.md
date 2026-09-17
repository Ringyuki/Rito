## Unreleased

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
