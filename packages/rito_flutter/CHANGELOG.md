## Unreleased

Breaking. The retired bounded-work surface leaves the session, so three
types and two parameters go with it, and the artifact protocol is
version 5.

- `RitoWorkBudget` is removed. `peek()` and `turn()` no longer take a
  `work:` argument — drop it at every call site. The session never read
  the budget: a target chapter is paginated whole in one native call, so
  there was nothing to bound.
- `RitoPendingExactSeekDriver` and `RitoPendingExactSeekLimitException`
  are removed with the exact-seek retry loop they drove, and the status
  constant `ritoNativeStatusExactSeekPendingV1` leaves the barrel. An
  exact open or seek now returns either the artifact or a terminal
  error; there is nothing to retry. `RitoResumableExactSeekGateway`
  stays: a seek issued while a superseded adjacent turn consumed native
  request ids still needs a substituted id.
- `RitoArtifact.terminalExtent` is removed. It was always true once a
  revision was created complete.
- `RitoAdjacentAvailability` loses `pending` and `blocked`; the three
  remaining values are `available`, `chapterBoundary` and `terminal`.
  Their wire tags renumbered, which is part of the protocol bump.
- `RitoSearchResponse.scopeComplete` is removed; a search always covers
  the whole book.
- Every `V1` suffix leaves the Dart API, matching the engine and the C
  ABI. The names are otherwise unchanged.
- `RitoArtifactDecoder.protocolVersion` is 5 (was 3). A hand-written
  decoder must follow both steps: version 4 removed the work record from
  the artifact and adjacent requests, version 5 removed the artifact's
  terminal-extent flag and the search response's scope flag, and
  renumbered the adjacent availability tags.

Not breaking, but worth knowing: a paginated book now keeps its page
table rather than its pages, so a 2624-page book paginates in 239 MB
instead of 471, and a whole-book search runs in 94 ms instead of 1888.

## 0.3.0 - 2026-09-07

- `RitoHitResolver` resolves taps against the artifact's hit entries — the
  engine's own account of links, note anchors (with their footnote key and
  pending state) and images, in display-list space. Hosts no longer read
  semantics off paint commands; a link's text band widens by `linkSlack`
  for coarse pointers and a link wrapping an image resolves as the link.
- Painted text and image commands carry the enclosing link's target and an
  image's alt text again. 0.2.0's fragment cutover shipped them as null, so a
  host resolving taps against the display list saw no links — a tap on a note
  anchor fell through to the image viewer.

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
