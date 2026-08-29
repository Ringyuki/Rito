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
